import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { locationsApi, LocationSummary, MetricTrend } from "../api";
import { useLanguage } from "../context/LanguageContext";
import { formatCurrency } from "../utils/stock";
import { PageSpinner } from "./shared/Spinner";

// ── Persistence ───────────────────────────────────────────────────────────────

const LS_KEY = "kyru-selected-location";

function readStoredLocation(): string {
  try { return localStorage.getItem(LS_KEY) ?? "all"; } catch { return "all"; }
}

function writeStoredLocation(id: string) {
  try { localStorage.setItem(LS_KEY, id); } catch { /* ignore */ }
}

// ── Location switcher dropdown ────────────────────────────────────────────────

function LocationSwitcher({
  locations,
  selected,
  onSelect,
}: {
  locations:  LocationSummary[];
  selected:   string; // restaurantId or "all"
  onSelect:   (id: string) => void;
}) {
  const { t } = useLanguage();
  const ml = t.multiLocation;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selectedLoc = locations.find((l) => l.restaurantId === selected);
  const label       = selectedLoc ? selectedLoc.name : ml.allLocations;

  function handleSelect(id: string) {
    onSelect(id);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative shrink-0">
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-lg border text-[13px] font-medium transition-colors ${
          open
            ? "border-[#3dbf8a] bg-[#0f0f0f] text-white"
            : "border-[#2a2a2a] bg-[#0a0a0a] text-[#aaa] hover:text-white hover:border-[#3a3a3a]"
        }`}
      >
        {/* Location avatar or globe icon */}
        {selectedLoc ? (
          selectedLoc.logo ? (
            <img src={selectedLoc.logo} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" />
          ) : (
            <span className="w-4 h-4 rounded-full bg-[#3dbf8a]/20 flex items-center justify-center text-[#3dbf8a] text-[9px] font-bold shrink-0">
              {selectedLoc.name[0]?.toUpperCase()}
            </span>
          )
        ) : (
          <svg className="w-4 h-4 text-[#3dbf8a] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}

        <span className={selectedLoc ? "font-semibold text-white" : ""}>{label}</span>

        <svg
          className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${open ? "rotate-180 text-[#3dbf8a]" : "text-[#555]"}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          role="listbox"
          className="absolute right-0 mt-1.5 w-56 rounded-xl border border-[#1a1a1a] bg-[#0a0a0a] shadow-xl shadow-black/60 z-50 overflow-hidden"
        >
          {/* "All Locations" option */}
          <button
            role="option"
            aria-selected={selected === "all"}
            onClick={() => handleSelect("all")}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-[#111] ${
              selected === "all"
                ? "text-[#3dbf8a] font-semibold bg-[#3dbf8a]/5"
                : "text-[#888]"
            }`}
          >
            <svg className={`w-4 h-4 shrink-0 ${selected === "all" ? "text-[#3dbf8a]" : "text-[#444]"}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="flex-1 truncate">{ml.allLocations}</span>
            {selected === "all" && (
              <svg className="w-3.5 h-3.5 text-[#3dbf8a] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>

          {locations.length > 0 && <div className="border-t border-[#111]" />}

          {/* Individual locations */}
          {locations.map((loc) => {
            const isActive = selected === loc.restaurantId;
            return (
              <button
                key={loc.restaurantId}
                role="option"
                aria-selected={isActive}
                onClick={() => handleSelect(loc.restaurantId)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-[#111] ${
                  isActive
                    ? "text-[#3dbf8a] font-semibold bg-[#3dbf8a]/5"
                    : "text-[#888]"
                }`}
              >
                {/* Avatar */}
                {loc.logo ? (
                  <img src={loc.logo} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" />
                ) : (
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    isActive ? "bg-[#3dbf8a]/20 text-[#3dbf8a]" : "bg-[#1a1a1a] text-[#555]"
                  }`}>
                    {loc.name[0]?.toUpperCase()}
                  </span>
                )}
                <span className="flex-1 truncate">{loc.name}</span>
                {isActive && (
                  <svg className="w-3.5 h-3.5 text-[#3dbf8a] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
  const { t }    = useLanguage();
  const navigate = useNavigate();
  const ml       = t.multiLocation;

  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [showAll,   setShowAll]   = useState(false);

  // Persist selected location across reloads.
  // "all" = stay on this page; a restaurantId = navigate to that location's dashboard.
  const [selected, setSelected] = useState<string>(readStoredLocation);

  useEffect(() => {
    locationsApi.overview()
      .then(setLocations)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // When a specific location is selected, navigate to the dashboard.
  // "all" keeps the user on this page.
  function handleSelect(id: string) {
    writeStoredLocation(id);
    setSelected(id);
    if (id !== "all") {
      // Dashboard doesn't yet support location-specific context — navigate to
      // the root dashboard. Location filtering will be wired in a future prompt.
      navigate("/");
    }
  }

  if (loading) return <PageSpinner />;

  const visible  = showAll ? locations : locations.slice(0, MAX_VISIBLE);
  const overflow = locations.length - MAX_VISIBLE;
  const isSingle = locations.length === 1;

  return (
    <div className="p-6 sm:p-8 space-y-6">

      {/* Header row: title + location switcher */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold text-white">{ml.title}</h1>
          <p className="text-[13px] text-[#555] mt-0.5">{ml.subtitle}</p>
        </div>

        {/* Switcher — only render once locations are loaded */}
        {locations.length > 0 && (
          <LocationSwitcher
            locations={locations}
            selected={selected}
            onSelect={handleSelect}
          />
        )}
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
