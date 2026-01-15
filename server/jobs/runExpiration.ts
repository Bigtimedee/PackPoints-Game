import "../db";
import { expirationEngine } from "../services/expirationEngine";

async function main() {
  console.log("Starting PackPTS expiration job...");
  console.log("Time:", new Date().toISOString());

  try {
    console.log("\n--- Running date-based expiration ---");
    const expirationResult = await expirationEngine.runExpirationJob(false);
    console.log(`Expired ${expirationResult.expiredBuckets} buckets`);
    console.log(`Total points expired: ${expirationResult.totalPointsExpired}`);
    if (expirationResult.errors.length > 0) {
      console.log("Errors:", expirationResult.errors);
    }

    console.log("\n--- Running inactivity-based expiration ---");
    const inactivityResult = await expirationEngine.runInactivityExpiration(false);
    console.log(`Users affected: ${inactivityResult.usersAffected}`);
    console.log(`Buckets expired: ${inactivityResult.bucketsExpired}`);
    console.log(`Total points expired: ${inactivityResult.totalPointsExpired}`);
    if (inactivityResult.errors.length > 0) {
      console.log("Errors:", inactivityResult.errors);
    }

    console.log("\nExpiration job completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("Expiration job failed:", error);
    process.exit(1);
  }
}

main();
