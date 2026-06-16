import React, { useEffect, useState, useCallback } from "react";
import { api } from "../api";
import { Spinner } from "./shared/Spinner";

interface TxItem {
  toastItemId: string;
  name:        string;
  qty:         number;
  unitPrice:   number;
}

interface ToastTx {
  id:                 string;
  toastTransactionId: string;
  transactionDate:    string;
  amount:             number;
  category:           string;
  itemDetails:        TxItem[];
  status:             string;
  syncedAt:           string;
}

interface SyncResult {
  synced: number;
  failed: number;
  errors: string[];
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));
}

function formatMXN(n: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins   = Math.floor(diffMs / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ToastTransactionSync() {
  const [rows, setRows]         = useState<ToastTx[]>([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [syncing, setSyncing]   = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [result, setResult]     = useState<SyncResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const today    = new Date().toISOString().split("T")[0];
      const weekAgo  = new Date(Date.now() - 7 * 864e5).toISOString().split("T")[0];
      const { data } = await api.get<{ transactions: ToastTx[]; total: number }>(
        `/api/toast/transactions?startDate=${weekAgo}&endDate=${today}`
      );
      setRows(data.transactions);
      setTotal(data.total);
      if (data.transactions.length > 0) {
        setLastSync(data.transactions[0].syncedAt);
      }
    } catch {
      setError("Could not load Toast transactions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSync() {
    setSyncing(true);
    setResult(null);
    setError(null);
    try {
      const { data } = await api.post<SyncResult>("/api/toast/sync");
      setResult(data);
      if (data.synced > 0) await load();
    } catch {
      setError("Sync failed. Check your Toast connection.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#1a1a1a] flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h2 className="text-[13px] font-semibold text-[#888] uppercase tracking-[0.08em]">
            Toast Transactions
          </h2>
          {!loading && (
            <p className="text-[12px] text-[#444] mt-0.5">
              {total} transactions{lastSync && <> · last synced <span className="text-[#555]">{timeAgo(lastSync)}</span></>}
            </p>
          )}
        </div>

        <button
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {syncing ? <Spinner size="sm" /> : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          {syncing ? "Syncing…" : "Sync Now"}
        </button>
      </div>

      {/* Sync result banner */}
      {result && (
        <div className={`px-5 py-3 border-b border-[#1a1a1a] text-[12px] ${result.failed > 0 ? "text-yellow-400" : "text-[#3dbf8a]"}`}>
          {result.synced > 0
            ? `✓ Synced ${result.synced} transaction${result.synced !== 1 ? "s" : ""}`
            : "No new transactions to sync"}
          {result.failed > 0 && ` · ${result.failed} failed`}
          {result.errors.length > 0 && (
            <span className="text-[#555] ml-2">({result.errors[0]})</span>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-5 py-3 border-b border-[#1a1a1a] text-[12px] text-red-400">
          ⚠ {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="py-12 flex justify-center">
          <Spinner size="md" />
        </div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-[13px] text-[#444]">
          No transactions synced yet — click <strong className="text-[#666]">Sync Now</strong> to pull from Toast.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1a1a1a]">
                {["Date", "Category", "Items", "Amount", "Status"].map((h) => (
                  <th key={h}
                    className={`text-[11px] font-medium text-[#555] uppercase tracking-wider px-5 py-3 ${h === "Amount" ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#111]">
              {rows.map((tx) => (
                <tr key={tx.id} className="hover:bg-[#111] transition-colors">
                  <td className="px-5 py-3.5 text-[#888] whitespace-nowrap">
                    {formatDate(tx.transactionDate)}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#1a1a1a] text-[#888] border border-[#252525]">
                      {tx.category}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-[#555] text-[12px]">
                    {tx.itemDetails.length > 0
                      ? tx.itemDetails.slice(0, 2).map((i) => i.name).join(", ") +
                        (tx.itemDetails.length > 2 ? ` +${tx.itemDetails.length - 2}` : "")
                      : "—"}
                  </td>
                  <td className="px-5 py-3.5 text-right font-semibold text-white tabular-nums">
                    {formatMXN(tx.amount)}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${tx.status === "synced" ? "text-[#3dbf8a]" : "text-yellow-400"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${tx.status === "synced" ? "bg-[#3dbf8a]" : "bg-yellow-400"}`} />
                      {tx.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
