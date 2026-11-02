import { describe, expect, it } from "vitest";
import { ctWallTime, missedFeedRows, selectDueRows, type IgQueueRow } from "../services/igPublish";

const env = { IG_PUBLISH_ENABLED: "true" } as NodeJS.ProcessEnv;

function row(id: number, kind: IgQueueRow["kind"], at: Date, extra: Partial<IgQueueRow> = {}): IgQueueRow {
  return {
    id, kind, mediaPath: `m${id}.jpg`, caption: "c", scheduledFor: at, status: "queued", containerId: null, igMediaId: null,
    error: null, approvalHash: "h", utmContent: `${id}-A`, utmMedium: "feed", utmCampaign: "w2", platform: "ig", variant: null,
    testId: null, trial: false, insights: null, abTestId: null, createdAt: at, publishedAt: null, ...extra,
  } as IgQueueRow;
}

describe("instagram feed spacing guard", () => {
  it("11/1 replay: a 10 AM row waits for the 11 AM slot and never doubles with the 11 AM row", () => {
    const rows = [row(42, "FEED", ctWallTime("2026-11-01", 10, 0)), row(30, "FEED", ctWallTime("2026-11-01", 11, 0))];
    expect(selectDueRows(rows, ctWallTime("2026-11-01", 10, 1), "ig", env)).toEqual([]);
    expect(selectDueRows(rows, ctWallTime("2026-11-01", 11, 3), "ig", env).map((r) => r.id)).toEqual([42]);
    rows[0] = { ...rows[0], status: "published", igMediaId: "m", publishedAt: ctWallTime("2026-11-01", 11, 4) };
    expect(selectDueRows(rows, ctWallTime("2026-11-01", 11, 8), "ig", env)).toEqual([]);
    expect(selectDueRows(rows, ctWallTime("2026-11-01", 11, 38), "ig", env).map((r) => r.id)).toEqual([30]);
  });

  it("skips a same-day feed more than 45 min past its slot as missed", () => {
    const rows = [row(30, "FEED", ctWallTime("2026-11-01", 11, 0))];
    expect(missedFeedRows(rows, ctWallTime("2026-11-01", 11, 44), "ig", env)).toEqual([]);
    expect(selectDueRows(rows, ctWallTime("2026-11-01", 11, 46), "ig", env)).toEqual([]);
    expect(missedFeedRows(rows, ctWallTime("2026-11-01", 11, 46), "ig", env).map((r) => r.id)).toEqual([30]);
  });

  it("defers a feed due within 30 min of a published feed, then posts it", () => {
    const done = row(1, "FEED", ctWallTime("2026-11-02", 11, 0), { status: "published", igMediaId: "m", publishedAt: ctWallTime("2026-11-02", 11, 0) });
    const next = row(2, "FEED", ctWallTime("2026-11-02", 11, 15));
    expect(selectDueRows([done, next], ctWallTime("2026-11-02", 11, 16), "ig", env)).toEqual([]);
    expect(selectDueRows([done, next], ctWallTime("2026-11-02", 11, 31), "ig", env).map((r) => r.id)).toEqual([2]);
  });

  it("does not hold a feed while another feed container is mid-publish", () => {
    const inflight = row(1, "FEED", ctWallTime("2026-11-02", 11, 0), { status: "container_created", containerId: "c" });
    const next = row(2, "FEED", ctWallTime("2026-11-02", 13, 0));
    expect(selectDueRows([inflight, next], ctWallTime("2026-11-02", 13, 1), "ig", env).map((r) => r.id)).toEqual([1]);
  });

  it("1 PM feeds 11/2 to 11/5 each post on their own day at 1 PM", () => {
    const rows = [44, 45, 46, 47].map((id, i) => row(id, "FEED", ctWallTime(`2026-11-0${2 + i}`, 13, 0)));
    expect(selectDueRows(rows, ctWallTime("2026-11-02", 12, 59), "ig", env)).toEqual([]);
    expect(selectDueRows(rows, ctWallTime("2026-11-02", 13, 2), "ig", env).map((r) => r.id)).toEqual([44]);
    expect(missedFeedRows(rows, ctWallTime("2026-11-02", 13, 2), "ig", env)).toEqual([]);
  });

  it("leaves stories and reels untouched by the feed guard", () => {
    const rows = [row(1, "FEED", ctWallTime("2026-11-02", 11, 0)), row(2, "FEED", ctWallTime("2026-11-02", 11, 0)), row(3, "REEL", ctWallTime("2026-11-02", 11, 0))];
    const out = selectDueRows(rows, ctWallTime("2026-11-02", 18, 1), "ig", env).map((r) => r.kind);
    expect(out.filter((k) => k === "FEED")).toHaveLength(0);
    expect(out).toContain("REEL");
  });
});
