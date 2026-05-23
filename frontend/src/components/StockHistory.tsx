import React, { useEffect, useState } from "react";
import { StockLog, StockReason } from "../types";
import { stockApi } from "../api";
import { formatDate } from "../utils/stock";
import { PageSpinner } from "./shared/Spinner";
import { EmptyState } from "./shared/EmptyState";
import { useLanguage } from "../context/LanguageContext";

const reasonStyles: Record<StockReason, string> = {
  RECEIVED: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
  USED: "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300",
  ADJUSTED: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400",
  WASTE: "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400",
};

interface StockHistoryProps {
  productId: string;
  productName?: string;
}

export function StockHistory({ productId, productName }: StockHistoryProps) {
  const { t } = useLanguage();
  const reasonLabels: Record<StockReason, string> = {
    RECEIVED: t.history.reasons.RECEIVED,
    USED:     t.history.reasons.USED,
    ADJUSTED: t.history.reasons.ADJUSTED,
    WASTE:    t.history.reasons.WASTE,
  };
  const [logs, setLogs] = useState<StockLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StockReason | "">("");

  useEffect(() => {
    setLoading(true);
    stockApi.logs(productId)
      .then(setLogs)
      .finally(() => setLoading(false));
  }, [productId]);

  const filtered = filter ? logs.filter((l) => l.reason === filter) : logs;

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-4">
      {productName && (
        <h2 className="text-base font-semibold text-gray-800 dark:text-white">{productName} — {t.history.title}</h2>
      )}

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilter("")}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            filter === ""
              ? "bg-gray-800 dark:bg-white text-white dark:text-gray-900"
              : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
          }`}
        >
          {t.common.all}
        </button>
        {(["RECEIVED", "USED", "ADJUSTED", "WASTE"] as StockReason[]).map((r) => (
          <button
            key={r}
            onClick={() => setFilter(r)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filter === r
                ? reasonStyles[r]
                : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            {reasonLabels[r]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState title={t.history.noHistory} description="" />
      ) : (
        <div className="space-y-2">
          {filtered.map((log) => {
            const isPositive = log.change > 0;
            return (
              <div
                key={log.id}
                className="flex items-start gap-3 p-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
              >
                {/* Change indicator */}
                <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
                  isPositive
                    ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                    : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                }`}>
                  {isPositive ? "+" : ""}
                  {log.change > 0 ? "+" : ""}{log.change}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${reasonStyles[log.reason]}`}>
                      {reasonLabels[log.reason]}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {log.previousQuantity} → {log.newQuantity}
                    </span>
                  </div>
                  {log.notes && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{log.notes}</p>
                  )}
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    {formatDate(log.timestamp)}
                    {log.user && ` · ${log.user.email}`}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
