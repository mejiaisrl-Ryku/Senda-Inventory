import { syncAllRestaurantsWithToast } from "../services/toast-sync";
import logger from "../utils/logger";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

/**
 * Start the Toast background sync job.
 * Runs immediately on startup (so Railway redeploys get fresh data quickly),
 * then repeats every 4 hours. Override interval with TOAST_SYNC_INTERVAL_MS.
 */
export function startToastSyncJob(): void {
  if (process.env.TOAST_SYNC_ENABLED !== "true") {
    logger.info({ event: "toast_sync_job_disabled" });
    return;
  }

  const interval = parseInt(process.env.TOAST_SYNC_INTERVAL_MS ?? String(FOUR_HOURS_MS), 10);

  async function run() {
    logger.info({ event: "toast_sync_job_start" });
    try {
      const result = await syncAllRestaurantsWithToast();
      logger.info({ event: "toast_sync_job_done", ...result });
    } catch (err) {
      logger.error({ event: "toast_sync_job_error", error: (err as Error).message });
    }
  }

  // First run after 30 s so the server finishes starting up.
  setTimeout(() => {
    run();
    setInterval(run, interval);
  }, 30_000);

  logger.info({ event: "toast_sync_job_scheduled", intervalMs: interval });
}
