import { useCallback, useRef, useState } from "react";
import { api } from "../api";

export type ScanJobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface ScanJobResponse<T = unknown> {
  id: string;
  type: "INVOICE" | "INVENTORY";
  status: ScanJobStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  extractedData: T | null;
  error: string | null;
  retryCount: number;
  webhookDelivered: string | null;
}

interface UseScanJobPollingOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/**
 * Polls GET /scan-jobs/:jobId until the job lands on COMPLETED or FAILED, or
 * the timeout elapses. Used by ScanInvoiceModal / ScanCountModal in place of
 * the old synchronous extract-invoice / inventory-scan calls (Sprint 1/2
 * made those endpoints enqueue-and-return-202 instead of blocking).
 */
export function useScanJobPolling<T = unknown>(options: UseScanJobPollingOptions = {}) {
  const { pollIntervalMs = 2000, timeoutMs = 60000 } = options;

  const [job, setJob] = useState<ScanJobResponse<T> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  const stop = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const cancelPolling = useCallback(() => {
    cancelledRef.current = true;
    stop();
    setLoading(false);
  }, [stop]);

  const reset = useCallback(() => {
    cancelPolling();
    setJob(null);
    setError(null);
  }, [cancelPolling]);

  const startPolling = useCallback(
    (jobId: string): Promise<ScanJobResponse<T> | null> => {
      cancelledRef.current = false;
      setLoading(true);
      setError(null);
      setJob(null);

      const startedAt = Date.now();

      return new Promise((resolve) => {
        const poll = async () => {
          if (cancelledRef.current) {
            resolve(null);
            return;
          }

          try {
            const { data } = await api.get<ScanJobResponse<T>>(`/scan-jobs/${jobId}`);
            if (cancelledRef.current) {
              resolve(null);
              return;
            }
            setJob(data);

            if (data.status === "COMPLETED" || data.status === "FAILED") {
              setLoading(false);
              resolve(data);
              return;
            }

            if (Date.now() - startedAt > timeoutMs) {
              setError(`Scan timed out after ${Math.round(timeoutMs / 1000)}s`);
              setLoading(false);
              resolve(null);
              return;
            }

            timeoutRef.current = setTimeout(poll, pollIntervalMs);
          } catch (err) {
            if (cancelledRef.current) {
              resolve(null);
              return;
            }
            const message = err instanceof Error ? err.message : "Failed to check scan status";
            setError(message);
            setLoading(false);
            resolve(null);
          }
        };

        poll();
      });
    },
    [pollIntervalMs, timeoutMs]
  );

  return { job, loading, error, startPolling, cancelPolling, reset };
}
