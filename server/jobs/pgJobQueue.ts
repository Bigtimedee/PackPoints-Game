/**
 * PostgreSQL-backed persistent job queue.
 * Zero external dependencies — uses the existing db pool.
 * Replaces volatile setInterval with retry-safe, crash-resistant job processing.
 */
import { pool } from '../db';

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

const handlers = new Map<string, JobHandler>();
const activeWorkers = new Map<string, ReturnType<typeof setInterval>>();

/**
 * Register a job type with its handler function.
 */
export function registerJob(jobType: string, handler: JobHandler): void {
  handlers.set(jobType, handler);
}

/**
 * Enqueue a job for immediate or scheduled execution.
 */
export async function enqueueJob(
  jobType: string,
  payload: Record<string, unknown> = {},
  scheduledAt: Date = new Date()
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO job_queue (job_type, payload, scheduled_at)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [jobType, JSON.stringify(payload), scheduledAt]
  );
  return result.rows[0].id;
}

/**
 * Claim and run the next pending job of a given type.
 * Uses SELECT ... FOR UPDATE SKIP LOCKED for safe concurrent workers.
 */
async function processNextJob(jobType: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const claimResult = await client.query(
      `SELECT id, payload, attempts, max_attempts
       FROM job_queue
       WHERE job_type = $1
         AND status = 'pending'
         AND scheduled_at <= NOW()
       ORDER BY scheduled_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [jobType]
    );

    if (claimResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    const job = claimResult.rows[0];

    await client.query(
      `UPDATE job_queue
       SET status = 'running', started_at = NOW(), attempts = attempts + 1, updated_at = NOW()
       WHERE id = $1`,
      [job.id]
    );

    await client.query('COMMIT');

    const handler = handlers.get(jobType);
    if (!handler) {
      await pool.query(
        `UPDATE job_queue SET status = 'failed', last_error = $1, updated_at = NOW() WHERE id = $2`,
        [`No handler registered for job type: ${jobType}`, job.id]
      );
      return true;
    }

    try {
      await handler(job.payload || {});
      await pool.query(
        `UPDATE job_queue SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [job.id]
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const nextAttempts = job.attempts + 1;
      const newStatus = nextAttempts >= job.max_attempts ? 'failed' : 'pending';
      // Exponential backoff: retry after 2^attempts minutes
      const retryDelay = newStatus === 'pending' ? Math.pow(2, nextAttempts) * 60 * 1000 : 0;
      const scheduledAt = new Date(Date.now() + retryDelay);

      await pool.query(
        `UPDATE job_queue
         SET status = $1, last_error = $2, scheduled_at = $3, updated_at = NOW()
         WHERE id = $4`,
        [newStatus, errorMessage, scheduledAt, job.id]
      );
      console.error(`[JobQueue] Job ${job.id} (${jobType}) ${newStatus}: ${errorMessage}`);
    }

    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Start a recurring job that runs at a fixed interval.
 * On each tick: enqueue a job, then immediately process pending jobs of this type.
 */
export function scheduleRecurringJob(
  jobType: string,
  handler: JobHandler,
  intervalMs: number,
  runImmediately = false
): void {
  registerJob(jobType, handler);

  const tick = async () => {
    try {
      await enqueueJob(jobType);
      await processNextJob(jobType);
    } catch (err) {
      console.error(`[JobQueue] Error in recurring job ${jobType}:`, err);
    }
  };

  if (runImmediately) {
    setTimeout(tick, 1000); // 1s delay to let server start
  }

  const intervalId = setInterval(tick, intervalMs);
  activeWorkers.set(jobType, intervalId);
  console.log(`[JobQueue] Scheduled recurring job: ${jobType} every ${Math.round(intervalMs / 60000)}m`);
}

/**
 * Stop all recurring jobs (for graceful shutdown).
 */
export function stopAllJobs(): void {
  for (const [jobType, intervalId] of activeWorkers) {
    clearInterval(intervalId);
    console.log(`[JobQueue] Stopped job: ${jobType}`);
  }
  activeWorkers.clear();
}

/**
 * Clean up old completed/failed jobs older than retentionDays.
 */
export async function cleanupOldJobs(retentionDays = 7): Promise<number> {
  const result = await pool.query(
    `DELETE FROM job_queue
     WHERE status IN ('completed', 'failed')
       AND updated_at < NOW() - (INTERVAL '1 day' * $1)`,
    [retentionDays]
  );
  return result.rowCount ?? 0;
}
