import "../db";
import { expirationEngine } from "../services/expirationEngine";

async function main() {
  console.log("Starting liability snapshot job...");
  console.log("Time:", new Date().toISOString());

  try {
    const result = await expirationEngine.createLiabilitySnapshot();

    if (!result.success) {
      console.error("Failed to create snapshot:", result.error);
      process.exit(1);
    }

    console.log("Liability snapshot created successfully.");
    console.log("Snapshot date:", result.snapshot?.asOfDate);
    console.log("Total outstanding:", result.snapshot?.totalOutstanding);
    console.log("Expiring in 30d:", result.snapshot?.expiring30d);
    console.log("Expiring in 60d:", result.snapshot?.expiring60d);
    console.log("Expiring in 90d:", result.snapshot?.expiring90d);
    console.log("Projected breakage:", result.snapshot?.projectedBreakage);

    process.exit(0);
  } catch (error) {
    console.error("Liability snapshot job failed:", error);
    process.exit(1);
  }
}

main();
