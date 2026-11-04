import { runGrowthMandateCycle } from "./mandate";

let timer: NodeJS.Timeout | null = null;
let running = false;

function intervalMs(): number {
  const minutes = Math.max(
    60,
    parseInt(process.env.GROWTH_AGENT_INTERVAL_MINUTES || "60", 10),
  );
  return minutes * 60 * 1000;
}

export async function runGrowthMandateTick(): Promise<void> {
  if (running) {
    console.warn("[GrowthMandate] Previous cycle still running; skipping overlapping tick.");
    return;
  }

  running = true;
  try {
    const result = await runGrowthMandateCycle(new Date());
    if (result.status === "FAILED") {
      console.error("[GrowthMandate] Cycle failed:", result.error);
    } else {
      console.log("[GrowthMandate] Cycle complete", {
        signalsObserved: result.signalsObserved,
        winnersLearnedFrom: result.winnersLearnedFrom,
        itemsCreated: result.itemsCreated,
        dailyCapacityRemaining: result.dailyCapacityRemaining,
      });
    }
  } finally {
    running = false;
  }
}

export function startGrowthMandateLoop(): void {
  if (process.env.GROWTH_AGENT_MANDATE_ENABLED !== "true") {
    console.log("[GrowthMandate] Disabled. Set GROWTH_AGENT_MANDATE_ENABLED=true to enable.");
    return;
  }
  if (timer) return;

  const every = intervalMs();
  console.log(`[GrowthMandate] Starting continuous loop every ${Math.round(every / 60000)} minutes.`);

  // Do not block server startup on AI or analytics work.
  setTimeout(() => {
    void runGrowthMandateTick();
  }, 15_000);

  timer = setInterval(() => {
    void runGrowthMandateTick();
  }, every);

  timer.unref?.();
}

export function stopGrowthMandateLoop(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
