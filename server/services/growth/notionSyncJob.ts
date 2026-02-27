import { registerJob } from "./jobRunner";
import { syncContentToNotion } from "../notion/exportContentToNotion";

registerJob("sync_content_to_notion", async () => {
  const result = await syncContentToNotion();

  return {
    synced: result.synced,
    errors: result.errors,
    skipped: result.skipped,
  };
});

console.log("[NotionSync] Job registered: sync_content_to_notion");
