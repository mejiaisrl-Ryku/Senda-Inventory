import React, { useState } from "react";
import { useLanguage } from "../../context/LanguageContext";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return toISO(new Date());
}

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISO(d);
}

function formatDisplay(start: string, end: string): string {
  const fmt = (s: string) => {
    const d = new Date(s + "T00:00:00Z");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DateRangePickerProps {
  startDate: string;
  endDate:   string;
  onChange:  (start: string, end: string) => void;
}

type Preset = "last7" | "last30" | "last90" | "thisMonth" | "lastMonth" | "custom";

function detectPreset(start: string, end: string): Preset {
  const today = todayISO();
  if (end !== today) return "custom";
  if (start === daysAgoISO(7))  return "last7";
  if (start === daysAgoISO(30)) return "last30";
  if (start === daysAgoISO(90)) return "last90";

  const now = new Date();
  const firstOfMonth = toISO(new Date(now.getFullYear(), now.getMonth(), 1));
  if (start === firstOfMonth) return "thisMonth";

  const firstOfLastMonth  = toISO(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const lastOfLastMonth   = toISO(new Date(now.getFullYear(), now.getMonth(), 0));
  if (start === firstOfLastMonth && end === lastOfLastMonth) return "lastMonth";

  return "custom";
}

function presetDates(preset: Preset): { start: string; end: string } | null {
  const today = todayISO();
  const now   = new Date();
  switch (preset) {
    case "last7":     return { start: daysAgoISO(7),  end: today };
    case "last30":    return { start: daysAgoISO(30), end: today };
    case "last90":    return { start: daysAgoISO(90), end: today };
    case "thisMonth": return { start: toISO(new Date(now.getFullYear(), now.getMonth(), 1)), end: today };
    case "lastMonth": return {
      start: toISO(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      end:   toISO(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
    default: return null;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DateRangePicker({ startDate, endDate, onChange }: DateRangePickerProps) {
  const { t } = useLanguage();
  const dr = t.dateRange;

  const [activePreset,  setActivePreset]  = useState<Preset>(() => detectPreset(startDate, endDate));
  const [customStart,   setCustomStart]   = useState(startDate);
  const [customEnd,     setCustomEnd]     = useState(endDate);
  const [customError,   setCustomError]   = useState<string | null>(null);

  const today = todayISO();

  const PRESETS: { key: Preset; label: string }[] = [
    { key: "last7",     label: dr.last7 },
    { key: "last30",    label: dr.last30 },
    { key: "last90",    label: dr.last90 },
    { key: "thisMonth", label: dr.thisMonth },
    { key: "lastMonth", label: dr.lastMonth },
    { key: "custom",    label: dr.custom },
  ];

  function handlePreset(preset: Preset) {
    setActivePreset(preset);
    setCustomError(null);
    if (preset === "custom") return; // wait for Apply
    const dates = presetDates(preset);
    if (dates) {
      setCustomStart(dates.start);
      setCustomEnd(dates.end);
      onChange(dates.start, dates.end);
    }
  }

  function handleApply() {
    setCustomError(null);
    if (customEnd < customStart) { setCustomError(dr.invalidRange); return; }
    if (customEnd > today)       { setCustomError(dr.futureDate);   return; }
    onChange(customStart, customEnd);
  }

  const btnBase  = "text-[11px] px-3 py-1.5 rounded-[6px] transition-colors whitespace-nowrap";
  const btnActive = `${btnBase} bg-[#1a1a1a] text-white border border-[#3dbf8a]`;
  const btnIdle   = `${btnBase} border border-[#2a2a2a] text-[#555] hover:text-white hover:border-[#444]`;
  const inputCls  = "bg-[#0a0a0a] border border-[#2a2a2a] text-white text-sm rounded-[6px] px-3 py-1.5 focus:outline-none focus:border-[#3dbf8a] transition-colors";

  return (
    <div className="space-y-2">
      {/* Preset buttons */}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => handlePreset(key)}
            className={activePreset === key ? btnActive : btnIdle}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Custom date inputs */}
      {activePreset === "custom" && (
        <div className="flex flex-wrap items-end gap-3 pt-1">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-[#555] uppercase tracking-wider">{dr.from}</label>
            <input
              type="date"
              value={customStart}
              max={today}
              onChange={(e) => { setCustomStart(e.target.value); setCustomError(null); }}
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-[#555] uppercase tracking-wider">{dr.to}</label>
            <input
              type="date"
              value={customEnd}
              max={today}
              onChange={(e) => { setCustomEnd(e.target.value); setCustomError(null); }}
              className={inputCls}
            />
          </div>
          <button
            onClick={handleApply}
            className="px-4 py-1.5 rounded-[6px] bg-[#3dbf8a] text-white text-[12px] font-semibold hover:bg-[#4dcf9a] transition-colors"
          >
            {dr.apply}
          </button>
          {customError && <p className="text-[11px] text-red-400 w-full">{customError}</p>}
        </div>
      )}

      {/* Active range display */}
      <p className="text-[11px] text-[#555]">{formatDisplay(startDate, endDate)}</p>
    </div>
  );
}
