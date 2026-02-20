import { db } from "../../db";
import { growthJobRuns, growthContentPlans, growthContentItems } from "@shared/schema";
import { eq, desc, and, sql, gte } from "drizzle-orm";
import { getOpenAIHealthStatus } from "./openaiAdapter";
import { getStatus as getCircuitBreakerStatus } from "./circuitBreaker";

export type HealthLevel = "GREEN" | "YELLOW" | "RED";

export interface PipelineStageHealth {
  stage: string;
  status: HealthLevel;
  message: string;
  lastRun?: { status: string; at: string; error?: string } | null;
}

export interface PipelineHealthReport {
  overall: HealthLevel;
  openai: { status: HealthLevel; source: string; lastCheck: any };
  circuitBreaker: { status: HealthLevel; isOpen: boolean };
  stages: PipelineStageHealth[];
  summary: string;
}

function getChicagoDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

export async function getPipelineHealth(): Promise<PipelineHealthReport> {
  const today = getChicagoDate();
  const stages: PipelineStageHealth[] = [];

  const openaiHealth = getOpenAIHealthStatus();
  const openaiStatus: HealthLevel = openaiHealth.ok ? "GREEN" : (openaiHealth.lastCheck ? "RED" : "YELLOW");

  const cbStatus = getCircuitBreakerStatus();
  const cbIsOpen = cbStatus.state === "OPEN";
  const cbHealth: HealthLevel = cbIsOpen ? "RED" : "GREEN";

  const jobNames = [
    { name: "generate_daily_plan", label: "Daily Plan Generation" },
    { name: "generate_content_items", label: "Content Item Generation" },
    { name: "auto_post_ready_content", label: "Auto-Posting" },
    { name: "generate_daily5_announcement", label: "Daily 5 Announcement" },
    { name: "generate_daily5_recap", label: "Daily 5 Recap" },
  ];

  for (const job of jobNames) {
    const [lastRun] = await db.select().from(growthJobRuns)
      .where(eq(growthJobRuns.jobName, job.name))
      .orderBy(desc(growthJobRuns.startedAt))
      .limit(1);

    if (!lastRun) {
      stages.push({
        stage: job.label,
        status: "YELLOW",
        message: "Never run",
        lastRun: null,
      });
      continue;
    }

    let stageStatus: HealthLevel = "GREEN";
    let message = `Last run: ${lastRun.status}`;

    if (lastRun.status === "FAILED") {
      stageStatus = "RED";
      message = `FAILED: ${lastRun.error?.slice(0, 150) || "Unknown error"}`;
    } else if (lastRun.status === "RETRY_PENDING") {
      stageStatus = "YELLOW";
      message = `Retrying: ${lastRun.error?.slice(0, 150) || "Unknown error"}`;
    } else if (lastRun.status === "SKIPPED") {
      const details = lastRun.details as any;
      if (details?.dependencyFailed) {
        stageStatus = "RED";
        message = `BLOCKED: ${details.reason || "Upstream dependency failed"}`;
      } else {
        stageStatus = "GREEN";
        message = details?.reason || "Skipped (normal)";
      }
    } else if (lastRun.status === "SUCCEEDED") {
      const details = lastRun.details as any;
      if (details?.posted === 0 && details?.reason === "No ready items" && job.name === "auto_post_ready_content") {
        const [todayPlan] = await db.select().from(growthContentPlans)
          .where(and(eq(growthContentPlans.date, today), eq(growthContentPlans.status, "ACTIVE")))
          .limit(1);

        if (!todayPlan) {
          const [failedPlan] = await db.select().from(growthJobRuns)
            .where(and(
              eq(growthJobRuns.jobName, "generate_daily_plan"),
              eq(growthJobRuns.status, "FAILED"),
            ))
            .orderBy(desc(growthJobRuns.startedAt))
            .limit(1);

          if (failedPlan) {
            stageStatus = "RED";
            message = `No items to post — upstream plan generation FAILED: ${failedPlan.error?.slice(0, 100) || "unknown"}`;
          } else {
            stageStatus = "YELLOW";
            message = "No items to post — no daily plan exists yet";
          }
        } else {
          message = "No ready items (plan exists, content may not be generated yet)";
          stageStatus = "YELLOW";
        }
      } else {
        message = `Succeeded${details?.posted != null ? ` (posted: ${details.posted})` : ""}`;
      }
    }

    stages.push({
      stage: job.label,
      status: stageStatus,
      message,
      lastRun: {
        status: lastRun.status,
        at: (lastRun.startedAt as Date).toISOString(),
        error: lastRun.error || undefined,
      },
    });
  }

  const hasRed = openaiStatus === "RED" || cbHealth === "RED" || stages.some(s => s.status === "RED");
  const hasYellow = openaiStatus === "YELLOW" || cbHealth === "YELLOW" || stages.some(s => s.status === "YELLOW");
  const overall: HealthLevel = hasRed ? "RED" : hasYellow ? "YELLOW" : "GREEN";

  const problems: string[] = [];
  if (openaiStatus !== "GREEN") problems.push("OpenAI connectivity issue");
  if (cbHealth !== "GREEN") problems.push("Circuit breaker is open");
  stages.filter(s => s.status === "RED").forEach(s => problems.push(`${s.stage}: ${s.message.slice(0, 80)}`));

  const summary = problems.length > 0
    ? `Pipeline issues detected: ${problems.join("; ")}`
    : "All pipeline stages healthy";

  return {
    overall,
    openai: { status: openaiStatus, source: openaiHealth.source, lastCheck: openaiHealth.lastCheck },
    circuitBreaker: { status: cbHealth, isOpen: cbIsOpen },
    stages,
    summary,
  };
}
