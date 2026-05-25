import React, { useEffect, useState } from "react";
import { locationsApi, LocationSummary, MetricTrend } from "../api";
import { useLanguage } from "../context/LanguageContext";
import { formatCurrency } from "../utils/stock";
import { PageSpinner } from "./shared/Spinner";

// ── Trend arrow ───────────────────────────────────────────────────────────────

function TrendArrow({ trend }: { trend: MetricTrend }) {
  if (!trend || trend === "flat") {
    return <span className="text-[#555] text-[13px]">→</span>;
  }
  if (trend === "up") {
    return <span className="text-[#aaa] text-[13px]">↑</span>;
  }
  return <span className="text-[#aaa] text-[13px]">↓</span>;
}

// ── Single metric row ─────────────────────────────────────────────────────────

function MetricRow({
  label,
  value,
  trend,
  isCurrency = false,
  noData,
  noDataHint,
}: {
  label:       string;
  value:       number | null;
  trend:       MetricTrend;
  isCurrency?: boolean;
  noData:      string;
  noDataHint:  string;
}) {
  const hasValue = value !== null && value !== undefined;

  return (
    <div className="flex items-start justify-between gap-3 py-3 border-b border-[#111] last:border-0">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-[#555] uppercase tracking-wider truncate">
          {label}
        </p>
        {hasValue ? (
          <p className="mt-0.5 text-[18px] font-bold text-white leading-none">
            {isCurrency ? formatCurrency(value!) : `${value!.toFixed(1)}%`}
          </p>
        ) : (
          <>
            <p className="mt-0.5 text-[18px] font-bold text-[#333] leading-none">{noData}</p>
            <p className="mt-1 text-[10px] text-[#444] italic">{noDataHint}</p>
          </>
        )}
      </div>
      {hasValue && (
        <div className="shrink-0 mt-1">
          <TrendArrow trend={trend} />
        </div>
      )}
    </div>
  );
}

// ── Location card ─────────────────────────────────────────────────────────────

function LocationCard({ loc }: { loc: LocationSummary }) {
  const { t } = useLanguage();
  const ml = t.multiLocation;

  return (
    <div className="flex-1 min-w-0 bg-[#0a0a0a] border border-[#1a1a1a] rounded-[10px] p-5 space-y-1">
      {/* Card header */}
      <div className="flex items-center gap-3 pb-3 border-b border-[#1a1a1a]">
        {loc.logo ? (
          <img
            src={loc.logo}
            alt={loc.name}
            className="w-8 h-8 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-[#3dbf8a]/20 flex items-center justify-center flex-shrink-0">
            <span className="text-[#3dbf8a] text-[13px] font-bold">
              {loc.name[0]?.toUpperCase() ?? "?"}
            </span>
          </div>
        )}
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-white truncate">{loc.name}</p>
        </div>
      </div>

      {/* Metrics */}
      <div>
        <MetricRow
          label={ml.foodCostPct}
          value={loc.metrics.foodCostPct}
          trend={loc.trends.foodCostPct}
          noData={ml.noData}
          noDataHint={ml.noDataHint}
        />
        <MetricRow
          label={ml.laborCostPct}
          value={loc.metrics.laborCostPct}
          trend={loc.trends.laborCostPct}
          noData={ml.noData}
          noDataHint={ml.noDataHint}
        />
        <MetricRow
          label={ml.primeCostPct}
          value={loc.metrics.primeCostPct}
          trend={loc.trends.primeCostPct}
          noData={ml.noData}
          noDataHint={ml.noDataHint}
        />
        <MetricRow
          label={ml.invAccuracyPct}
          value={loc.metrics.inventoryAccuracyPct}
          trend={loc.trends.inventoryAccuracyPct}
          noData={ml.noData}
          noDataHint={ml.noDataHint}
        />
        <MetricRow
          label={ml.revenue30d}
          value={loc.metrics.revenue30d > 0 ? loc.metrics.revenue30d : null}
          trend={loc.trends.revenue30d}
          isCurrency
          noData={ml.noData}
          noDataHint={ml.noDataHint}
        />
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const MAX_VISIBLE = 3;

export function MultiLocationOverview() {
  const { t } = useLanguage();
  const ml = t.multiLocation;

  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [showAll,   setShowAll]   = useState(false);

  useEffect(() => {
    locationsApi.overview()
      .then(setLocations)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageSpinner />;

  const visible  = showAll ? locations : locations.slice(0, MAX_VISIBLE);
  const overflow = locations.length - MAX_VISIBLE;
  const isSingle = locations.length === 1;

  return (
    <div className="p-6 sm:p-8 space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-[22px] font-semibold text-white">{ml.title}</h1>
        <p className="text-[13px] text-[#555] mt-0.5">{ml.subtitle}</p>
      </div>

      {/* Single-location notice */}
      {isSingle && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-[8px] bg-[#1a1a1a] border border-[#2a2a2a]">
          <svg
            className="w-4 h-4 text-[#3dbf8a] mt-0.5 shrink-0"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-[13px] text-[#888]">{ml.singleLocation}</p>
        </div>
      )}

      {/* Location cards — side-by-side */}
      <div className="flex flex-col sm:flex-row gap-4 items-stretch">
        {visible.map((loc) => (
          <LocationCard key={loc.restaurantId} loc={loc} />
        ))}
      </div>

      {/* "+X more" button */}
      {!showAll && overflow > 0 && (
        <div className="flex justify-center pt-2">
          <button
            onClick={() => setShowAll(true)}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg border border-[#2a2a2a] bg-[#0a0a0a] text-[13px] text-[#888] hover:text-white hover:border-[#3dbf8a] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 4v16m8-8H4" />
            </svg>
            +{overflow} {ml.moreLocations}
          </button>
        </div>
      )}
    </div>
  );
}
