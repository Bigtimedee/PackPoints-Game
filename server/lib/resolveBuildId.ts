import { execSync } from "child_process";
import { pickBuildId } from "../../shared/buildVersion";

let cached: string | undefined;

function readGitSha(): string {
  try {
    return execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/** One id per process. Build script sets PACKPTS_BUILD_ID before Vite runs. */
export function resolveBuildId(): string {
  if (cached) return cached;
  cached = pickBuildId({
    explicit: process.env.PACKPTS_BUILD_ID,
    railwaySha: process.env.RAILWAY_GIT_COMMIT_SHA,
    gitSha: readGitSha(),
    now: Date.now(),
  });
  return cached;
}
