import { Response, NextFunction } from "express";
import { prismaAdmin as prisma } from "../lib/prisma";
import { AuthRequest } from "../types";
import logger from "../utils/logger";

// Approximate per-million-token pricing — used only for a rough cost estimate,
// not billing. Keyed by the claudeModel string stored on each ScanJob.
const COST_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-opus-4-5":   { input: 15, output: 75 },
};

function estimateCostUSD(model: string, inputTokens: number, outputTokens: number): number {
  const rates = COST_PER_MILLION_TOKENS[model];
  if (!rates) return 0;
  return (inputTokens * rates.input) / 1_000_000 + (outputTokens * rates.output) / 1_000_000;
}

/**
 * GET /api/metrics/scans
 * Cross-tenant scan metrics — KYRU_MANAGER only. Restaurant-level admins must
 * not see other tenants' token usage / cost, so this intentionally does not
 * use prismaT (which is restaurant-scoped) — it uses prismaAdmin and is gated
 * by requireKyruManager at the route level, not requireAdmin.
 */
export async function getScanMetrics(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const daysNum = Math.max(1, parseInt(String(req.query.days ?? "7"), 10) || 7);
    const since = new Date();
    since.setDate(since.getDate() - daysNum);

    const [totalScans, completedScans, failedScans, avgProcessingTime, byType, completedJobs] =
      await Promise.all([
        prisma.scanJob.count({ where: { createdAt: { gte: since } } }),
        prisma.scanJob.count({ where: { createdAt: { gte: since }, status: "COMPLETED" } }),
        prisma.scanJob.count({ where: { createdAt: { gte: since }, status: "FAILED" } }),
        prisma.scanJob.aggregate({
          where: { createdAt: { gte: since }, status: "COMPLETED", claudeProcessingMs: { gt: 0 } },
          _avg: { claudeProcessingMs: true },
        }),
        prisma.scanJob.groupBy({
          by: ["type"],
          where: { createdAt: { gte: since } },
          _count: true,
        }),
        // Need per-row model + token counts to price sonnet/opus correctly —
        // a flat groupBy sum would misprice any job that retried onto opus.
        prisma.scanJob.findMany({
          where: { createdAt: { gte: since }, status: "COMPLETED" },
          select: { claudeModel: true, inputTokens: true, outputTokens: true },
        }),
      ]);

    const totalInput = completedJobs.reduce((sum, j) => sum + (j.inputTokens ?? 0), 0);
    const totalOutput = completedJobs.reduce((sum, j) => sum + (j.outputTokens ?? 0), 0);
    const estimatedCostUSD = completedJobs.reduce(
      (sum, j) => sum + estimateCostUSD(j.claudeModel, j.inputTokens ?? 0, j.outputTokens ?? 0),
      0
    );

    const successRate = totalScans > 0 ? (completedScans / totalScans) * 100 : 0;

    res.json({
      period: { days: daysNum, since: since.toISOString(), until: new Date().toISOString() },
      summary: {
        totalScans,
        completedScans,
        failedScans,
        successRate: `${successRate.toFixed(2)}%`,
        avgProcessingTimeMs: Math.round(avgProcessingTime._avg.claudeProcessingMs ?? 0),
      },
      tokens: {
        totalInput,
        totalOutput,
        estimatedCostUSD: estimatedCostUSD.toFixed(2),
      },
      byType,
    });
  } catch (err) {
    logger.error("getScanMetrics: error", { message: (err as Error).message });
    next(err);
  }
}

/**
 * GET /api/metrics/worker-health
 * Heuristic only — there's no real heartbeat from the worker process itself,
 * just inference from job queue state. A worker that's up but stuck (e.g.
 * hung on a single Claude call) won't be caught by this; it only catches the
 * "queue is growing and nothing has finished in a while" case.
 */
export async function getWorkerHealth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const [pendingJobs, processingJobs, lastCompleted] = await Promise.all([
      prisma.scanJob.count({ where: { status: "PENDING" } }),
      prisma.scanJob.count({ where: { status: "PROCESSING" } }),
      prisma.scanJob.findFirst({ where: { status: "COMPLETED" }, orderBy: { completedAt: "desc" } }),
    ]);

    const lastCompletedAt = lastCompleted?.completedAt ?? null;
    const secondsSinceLastJob = lastCompletedAt
      ? Math.round((Date.now() - lastCompletedAt.getTime()) / 1000)
      : null;

    const workerDown = pendingJobs > 5 && (secondsSinceLastJob === null || secondsSinceLastJob > 300);

    res.json({
      status: workerDown ? "down" : "healthy",
      pendingJobs,
      processingJobs,
      lastCompletedAt,
      secondsSinceLastJob,
    });
  } catch (err) {
    logger.error("getWorkerHealth: error", { message: (err as Error).message });
    next(err);
  }
}
