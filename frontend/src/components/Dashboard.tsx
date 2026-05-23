import React, { useEffect, useState, useCallback } from "react";
import { stockApi } from "../api";
import { StockReport } from "../types";
import { formatCurrency } from "../utils/stock";
import { LowStockAlerts } from "./LowStockAlerts";
import { PageSpinner } from "./shared/Spinner";
import { useStockSocket } from "../hooks/useStockSocket";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  const str = String(value);
  const valCls =
    str.length > 9
      ? "text-[16px] sm:text-[22px] lg:text-[28px]"
      : str.length > 6
      ? "text-[20px] sm:text-[26px] lg:text-[28px]"
      : "text-[28px]";

  return (
    <div className="bg-[#0a0a0a] rounded-[8px] px-4 sm:px-6 py-5 border border-[#1a1a1a] min-w-0">
      <p className="text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] truncate">{label}</p>
      <p className={`mt-2 font-semibold text-white tracking-tight leading-none truncate ${valCls}`}>{value}</p>
      {sub && <p className="mt-2 text-xs text-[#555] truncate">{sub}</p>}
    </div>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const pageTitle = user?.restaurantName ? `${user.restaurantName} ${t.dashboard.title}` : t.dashboard.title;
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

  useStockSocket(() => {
    loadReport();
  });

  // Normalize category names from the backend (remap legacy ones)
  const catMap = t.categories;
  function normalizeCat(raw: string): string {
    return catMap[raw] ?? raw;
  }

  if (loading) return <PageSpinner />;

  // Merge categories that map to the same display name
  const mergedByCategory = (() => {
    if (!report) return {};
    const merged: Record<string, { count: number; value: number }> = {};
    for (const [raw, data] of Object.entries(report.byCategory)) {
      const display = normalizeCat(raw);
      if (!merged[display]) merged[display] = { count: 0, value: 0 };
      merged[display].count += data.count;
      merged[display].value += data.value;
    }
    return merged;
  })();

  return (
    <div className="p-8 space-y-4">
      <div>
        <h1 className="text-[22px] font-semibold text-white">{pageTitle}</h1>
        <p className="text-[13px] text-[#555] mt-1">{t.dashboard.subtitle}</p>
      </div>

      {report && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label={t.dashboard.totalProducts}  value={report.totalProducts} />
            <StatCard label={t.dashboard.inventoryValue} value={formatCurrency(report.totalValue)} color="green" />
            <StatCard label={t.dashboard.belowMinimum}   value={report.belowMinimumCount} color={report.belowMinimumCount > 0 ? "yellow" : "green"} />
            <StatCard label={t.dashboard.categories}     value={Object.keys(mergedByCategory).length} />
          </div>

          {/* Category breakdown */}
          {Object.keys(mergedByCategory).length > 0 && (
            <div className="bg-[#0a0a0a] rounded-[8px] border border-[#1a1a1a] p-5">
              <h2 className="text-[13px] font-semibold text-white mb-4">{t.dashboard.valueByCategory}</h2>
              <div className="space-y-3">
                {Object.entries(mergedByCategory)
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
                            {count} {t.common.items} · {formatCurrency(value)}
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
