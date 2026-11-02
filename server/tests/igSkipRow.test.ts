import { afterEach, describe, expect, it } from "vitest";
import { createMemoryStore, ctWallTime, selectDueRows, setIgDepsForTests, updateQueuedRow } from "../services/igPublish";

afterEach(() => setIgDepsForTests(null));

describe("instagram QA skip one row", () => {
  it("marks only the queued row skipped and it is never selected", async () => {
    const store = createMemoryStore();
    setIgDepsForTests({ store, env: {} });
    const at = ctWallTime("2026-11-04", 17, 0);
    const a = await store.insert({ kind: "REEL", mediaPath: "a.mp4", caption: "A", scheduledFor: at, status: "queued", approvalHash: "h", utmContent: "a" });
    const b = await store.insert({ kind: "REEL", mediaPath: "b.mp4", caption: "B", scheduledFor: ctWallTime("2026-11-04", 13, 30), status: "queued", approvalHash: "h", utmContent: "b" });
    const skipped = await updateQueuedRow(a.id, { skip: true });
    expect(skipped.status).toBe("skipped");
    expect(skipped.error).toBe("pulled_by_qa");
    expect(skipped.mediaPath).toBe("a.mp4");
    expect((await store.get(b.id))?.status).toBe("queued");
    expect(selectDueRows(await store.list(), ctWallTime("2026-11-04", 18, 1), "ig", {}).map((r) => r.id)).toEqual([b.id]);
    await expect(updateQueuedRow(a.id, { skip: true })).rejects.toThrow(/not_queued/);
    await expect(updateQueuedRow(b.id, { skip: false })).rejects.toThrow(/bad_skip/);
    await expect(updateQueuedRow(b.id, { skip: true, caption: "x" })).rejects.toThrow(/bad_patch/);
  });
});
