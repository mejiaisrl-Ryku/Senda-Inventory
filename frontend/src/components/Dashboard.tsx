import React, { useEffect, useState, useCallback } from "react";
import { stockApi } from "../api";
import { StockReport } from "../types";
import { formatCurrency } from "../utils/stock";
import { LowStockAlerts } from "./LowStockAlerts";
import { PageSpinner } from "./shared/Spinner";
import { useStockSocket } from "../hooks/useStockSocket";

function StatCard({
  label,
  value,
  sub,
  color = "default",
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: "default" | "green" | "yellow" | "red";
}) {
  const accent = {
    default: "text-brand-500",
    green: "text-green-500",
    yellow: "text-yellow-500",
    red: "text-red-500",
  }[color];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-200 dark:border-gray-700">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${accent}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{sub}</p>}
    </div>
  );
}

export function Dashboard() {
  const [report, setReport] = useState<StockReport | null>(null);
  const [loading, setLoading] = useState(true);

  const loadReport = useCallback(() => {
    stockApi.report().then(setReport).catch(() => {});
  }, []);

  useEffect(() => {
    stockApi.report()
      .then(setReport)
      .finally(() => setLoading(false));
  }, []);

  // When any stock event fires (already debounced to 2s in the hook),
  // refresh the aggregate report so metrics stay current.
  useStockSocket(() => {
    loadReport();
  });

  if (loading) return <PageSpinner />;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Stock overview</p>
      </div>

      {report && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Products" value={report.totalProducts} />
            <StatCard
              label="Inventory Value"
              value={formatCurrency(report.totalValue)}
              color="green"
            />
            <StatCard
              label="Below Minimum"
              value={report.belowMinimumCount}
              color={report.belowMinimumCount > 0 ? "yellow" : "green"}
            />
            <StatCard
              label="Categories"
              value={Object.keys(report.byCategory).length}
            />
          </div>

          {/* Category breakdown */}
          {Object.keys(report.byCategory).length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Value by Category</h2>
              <div className="space-y-3">
                {Object.entries(report.byCategory)
                  .sort(([, a], [, b]) => b.value - a.value)
                  .map(([cat, { count, value }]) => {
                    const pct = report.totalValue > 0
                      ? Math.round((value / report.totalValue) * 100)
                      : 0;
                    return (
                      <div key={cat}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-gray-700 dark:text-gray-300 font-medium">{cat}</span>
                          <span className="text-gray-500 dark:text-gray-400">
                            {count} items · {formatCurrency(value)}
                          </span>
                        </div>
                        <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-brand-500 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </>
      )}

      <LowStockAlerts compact />
    </div>
  );
}
