/**
 * Facebook Page publisher. Off unless FB_PUBLISH_ENABLED=true and both
 * FB_PAGE_TOKEN and FB_PAGE_ID are set. The token is read at call time and
 * never logged. Photo, link, and Reel calls use graph.facebook.com.
 * Reel variant groups of 2 to 4 are uploaded as drafts and sent to
 * /{page-id}/ab_tests. A single Reel is published. Every file still has to
 * match server/assets/ig/APPROVED.json.
 */
import {
  fbGraphBase,
  graphJson,
  igPublicMediaUrl,
  inspectMedia,
  logIg,
  publisherEnv,
  publisherFetch,
  queueStore,
  rowIsDue,
  selectDueRows,
  trackingUrl,
  type IgQueueRow,
} from "./igPublish";
import { ctNow } from "./daily5XWatch";

export function fbPublishEnabled(e = publisherEnv()): boolean {
  return e.FB_PUBLISH_ENABLED === "true";
}

export function fbCredsReady(e = publisherEnv()): boolean {
  return Boolean(e.FB_PAGE_TOKEN?.trim() && e.FB_PAGE_ID?.trim());
}

export function fbOptimizationGoal(testId: string | null): "LINK_CLICKS" | "AVG_TIME_WATCHED" {
  return testId === "cta" ? "LINK_CLICKS" : "AVG_TIME_WATCHED";
}

export type FbDryRun = {
  status: "dry_run" | "not_found" | "wrong_platform" | "bad_ab_group";
  id?: number;
  kind?: IgQueueRow["kind"];
  wouldSkip?: boolean;
  reason?: string;
  endpoint?: string;
  body?: Record<string, unknown>;
  reels?: Array<{ id: number; mediaPath: string; video_state: "DRAFT" | "PUBLISHED" }>;
  abTest?: Record<string, unknown>;
};

function sameDayGroup(rows: IgQueueRow[], row: IgQueueRow): IgQueueRow[] {
  if (!row.testId) return [row];
  const day = ctNow(row.scheduledFor).day;
  return rows.filter((other) =>
    other.platform === "fb"
    && other.kind === "REEL"
    && other.testId === row.testId
    && other.status === "queued"
    && ctNow(other.scheduledFor).day === day
  );
}

export function fbAbTestBody(rows: IgQueueRow[], videoIds: string[]): Record<string, unknown> {
  const control = rows.find((row) => row.variant === "A") ?? rows[0];
  const controlIndex = rows.findIndex((row) => row.id === control.id);
  return {
    name: rows[0].testId || `test-${rows[0].id}`,
    description: "PackPTS reel test",
    optimization_goal: fbOptimizationGoal(rows[0].testId),
    control_video_id: videoIds[controlIndex] ?? videoIds[0],
    experiment_video_ids: videoIds,
    duration: 86400,
  };
}

function photoBody(row: IgQueueRow): Record<string, unknown> {
  return { url: igPublicMediaUrl(row.mediaPath), caption: row.caption, published: true };
}

function linkBody(row: IgQueueRow): Record<string, unknown> {
  return { message: row.caption, link: trackingUrl(row) };
}

export async function dryRunFb(id: number): Promise<FbDryRun> {
  const store = queueStore();
  const rows = await store.list(500);
  const row = rows.find((item) => item.id === id) ?? null;
  if (!row) return { status: "not_found", id };
  if (row.platform !== "fb") return { status: "wrong_platform", id };
  const media = await inspectMedia(row.mediaPath);
  if (!media.ok || media.hash !== row.approvalHash.toLowerCase()) {
    return { status: "dry_run", id, kind: row.kind, wouldSkip: true, reason: !media.ok ? media.reason : "hash_not_approved" };
  }
  if (row.kind === "PHOTO") {
    return { status: "dry_run", id, kind: row.kind, wouldSkip: false, endpoint: "/photos", body: photoBody(row) };
  }
  if (row.kind === "LINK") {
    return { status: "dry_run", id, kind: row.kind, wouldSkip: false, endpoint: "/feed", body: linkBody(row) };
  }
  if (row.kind === "REEL") {
    const group = sameDayGroup(rows, row).sort((a, b) => a.id - b.id);
    if (group.length > 4) return { status: "bad_ab_group", id, kind: row.kind };
    if (group.length >= 2) {
      return {
        status: "dry_run",
        id,
        kind: row.kind,
        wouldSkip: false,
        endpoint: "/ab_tests",
        reels: group.map((item) => ({ id: item.id, mediaPath: item.mediaPath, video_state: "DRAFT" as const })),
        abTest: fbAbTestBody(group, group.map((item) => `video-${item.id}`)),
      };
    }
    return {
      status: "dry_run",
      id,
      kind: row.kind,
      wouldSkip: false,
      endpoint: "/video_reels",
      reels: [{ id: row.id, mediaPath: row.mediaPath, video_state: "PUBLISHED" }],
    };
  }
  return { status: "dry_run", id, kind: row.kind, wouldSkip: true, reason: "bad_kind" };
}

async function postForm(pageId: string, token: string, edge: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ ...fields, access_token: token });
  return graphJson(`${fbGraphBase()}/${encodeURIComponent(pageId)}/${edge}`, { method: "POST", body: params }, token);
}

async function uploadReel(pageId: string, token: string, bytes: Buffer, videoState: "DRAFT" | "PUBLISHED", description: string): Promise<string> {
  const started = await postForm(pageId, token, "video_reels", { upload_phase: "START" });
  const videoId = String(started.video_id ?? "");
  const uploadUrl = String(started.upload_url ?? "");
  if (!videoId || !uploadUrl) throw new Error("reel_start_failed");
  const doFetch = publisherFetch();
  let response: Response;
  try {
    response = await doFetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: `OAuth ${token}`, offset: "0", file_size: String(bytes.length) },
      body: new Uint8Array(bytes),
    });
  } catch {
    throw new Error("reel_upload_failed");
  }
  if (!response.ok) throw new Error(`reel_upload_${response.status}`);
  await postForm(pageId, token, "video_reels", {
    upload_phase: "FINISH",
    video_id: videoId,
    video_state: videoState,
    description,
  });
  return videoId;
}

async function publishAbGroup(rows: IgQueueRow[], pageId: string, token: string): Promise<void> {
  const store = queueStore();
  const videoIds: string[] = [];
  for (const row of rows) {
    const media = await inspectMedia(row.mediaPath);
    if (!media.ok || media.hash !== row.approvalHash.toLowerCase()) {
      await store.markSkipped(row.id, !media.ok ? media.reason : "hash_not_approved");
      throw new Error("ab_member_skipped");
    }
    videoIds.push(await uploadReel(pageId, token, media.bytes, "DRAFT", row.caption));
  }
  const body = fbAbTestBody(rows, videoIds);
  const json = await graphJson(
    `${fbGraphBase()}/${encodeURIComponent(pageId)}/ab_tests?access_token=${encodeURIComponent(token)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    token,
  );
  const abTestId = String(json.id ?? "");
  if (!abTestId) throw new Error("ab_test_missing");
  for (let i = 0; i < rows.length; i++) {
    await store.markAbTest(rows[i].id, videoIds[i], abTestId);
  }
}

async function publishFbRow(row: IgQueueRow, pageId: string, token: string, now: Date): Promise<void> {
  const store = queueStore();
  const media = await inspectMedia(row.mediaPath);
  if (!media.ok || media.hash !== row.approvalHash.toLowerCase()) {
    await store.markSkipped(row.id, !media.ok ? media.reason : "hash_not_approved");
    return;
  }
  if (row.kind === "PHOTO") {
    const json = await postForm(pageId, token, "photos", {
      url: igPublicMediaUrl(row.mediaPath),
      caption: row.caption,
      published: "true",
    });
    const id = String(json.id ?? json.post_id ?? "");
    if (!id) throw new Error("photo_missing");
    await store.markPublished(row.id, id, now);
    return;
  }
  if (row.kind === "LINK") {
    const json = await postForm(pageId, token, "feed", { message: row.caption, link: trackingUrl(row) });
    const id = String(json.id ?? "");
    if (!id) throw new Error("link_missing");
    await store.markPublished(row.id, id, now);
    return;
  }
  if (row.kind === "REEL") {
    const videoId = await uploadReel(pageId, token, media.bytes, "PUBLISHED", row.caption);
    await store.markPublished(row.id, videoId, now);
  }
}

export async function runFbDaily(now = new Date()): Promise<{ status: string; results?: Array<{ id: number; status: string }> }> {
  const e = publisherEnv();
  if (!fbPublishEnabled(e)) return { status: "disabled" };
  if (!fbCredsReady(e)) return { status: "not_armed" };
  const pageId = e.FB_PAGE_ID?.trim() ?? "";
  const token = e.FB_PAGE_TOKEN?.trim() ?? "";
  const store = queueStore();
  const rows = await store.list(500);
  const due = selectDueRows(rows, now, "fb", e);
  const handled = new Set<number>();
  const results: Array<{ id: number; status: string }> = [];
  for (const row of due) {
    if (handled.has(row.id)) continue;
    try {
      if (row.kind === "REEL" && row.testId) {
        const group = sameDayGroup(rows, row).sort((a, b) => a.id - b.id);
        if (group.length > 4) {
          for (const member of group) {
            await store.markSkipped(member.id, "bad_ab_group");
            handled.add(member.id);
            results.push({ id: member.id, status: "bad_ab_group" });
          }
          continue;
        }
        if (group.length >= 2) {
          if (!group.every((member) => rowIsDue(member, now, e))) continue;
          await publishAbGroup(group, pageId, token);
          for (const member of group) {
            handled.add(member.id);
            results.push({ id: member.id, status: "ab_test" });
          }
          continue;
        }
      }
      await publishFbRow(row, pageId, token, now);
      handled.add(row.id);
      results.push({ id: row.id, status: "published" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "fb_failed";
      logIg("error", `facebook post ${row.id} failed: ${message}`);
      if (row.status === "queued") await store.markFailed(row.id, message.slice(0, 200));
      handled.add(row.id);
      results.push({ id: row.id, status: "failed" });
    }
  }
  return { status: "ran", results };
}
