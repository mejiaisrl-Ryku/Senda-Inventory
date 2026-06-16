import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Spinner } from "./shared/Spinner";

// ── Types ──────────────────────────────────────────────────────────────────────

interface MenuItemWithCost {
  toastItemId:   string;
  toastItemName: string;
  kyruRecipeId:  string | null;
  recipeName:    string | null;
  recipeCost:    number | null;
  lastSyncedAt:  string;
}

interface Recipe {
  id:   string;
  name: string;
}

interface COGSLineItem {
  toastItemId: string;
  itemName:    string;
  qtySold:     number;
  revenue:     number;
  recipeCost:  number;
  costPct:     number;
}

interface COGSReport {
  startDate:  string;
  endDate:    string;
  items:      COGSLineItem[];
  totalCost:  number;
  totalRev:   number;
  blendedPct: number;
}

interface VarianceFlag {
  toastItemId: string;
  itemName:    string;
  costPct:     number;
  benchmark:   number;
  gap:         number;
  qtySold:     number;
  revenue:     number;
  recipeCost:  number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

function pctColor(pct: number) {
  if (pct < 25) return "text-[#3dbf8a]";
  if (pct <= 35) return "text-amber-400";
  return "text-red-400";
}

function defaultRange() {
  const end   = new Date().toISOString().split("T")[0];
  const start = new Date(Date.now() - 30 * 864e5).toISOString().split("T")[0];
  return { start, end };
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="px-5 py-4 border-b border-[#1a1a1a]">
      <h2 className="text-[13px] font-semibold text-[#888] uppercase tracking-[0.08em]">{title}</h2>
      {sub && <p className="text-[12px] text-[#444] mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Menu Item Mapping tab ─────────────────────────────────────────────────────

function MenuItemMappingTab() {
  const [items,   setItems]   = useState<MenuItemWithCost[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState<string | null>(null);
  const [autoLinking, setAutoLinking] = useState(false);
  const [autoResult, setAutoResult]   = useState<{ linked: number; skipped: number } | null>(null);
  const [error, setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [menuRes, recipesRes] = await Promise.all([
        api.get<{ menuItems: MenuItemWithCost[] }>("/api/toast/menu-items"),
        api.get<{ recipes: Recipe[] }>("/api/recipes"),
      ]);
      setItems(menuRes.data.menuItems);
      // recipes endpoint may return array directly or wrapped
      const raw = recipesRes.data as any;
      setRecipes(Array.isArray(raw) ? raw : raw.recipes ?? []);
    } catch {
      setError("Could not load menu items. Make sure Toast is connected.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleLink(toastItemId: string, recipeId: string | null) {
    setLinking(toastItemId);
    try {
      await api.post(`/api/toast/menu-items/${toastItemId}/link`, { recipeId });
      await load();
    } catch {
      setError("Failed to update link.");
    } finally {
      setLinking(null);
    }
  }

  async function handleAutoLink() {
    setAutoLinking(true);
    setAutoResult(null);
    try {
      const { data } = await api.post<{ linked: number; skipped: number }>("/api/toast/auto-link");
      setAutoResult(data);
      if (data.linked > 0) await load();
    } catch {
      setError("Auto-link failed.");
    } finally {
      setAutoLinking(false);
    }
  }

  if (loading) return <div className="py-12 flex justify-center"><Spinner size="md" /></div>;

  return (
    <div>
      <div className="px-5 py-3 border-b border-[#1a1a1a] flex items-center gap-3">
        <button
          onClick={handleAutoLink}
          disabled={autoLinking}
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#1a1a1a] hover:bg-[#222] disabled:opacity-60 text-[#888] text-[12px] font-medium rounded-lg border border-[#252525] transition-colors"
        >
          {autoLinking ? <Spinner size="sm" /> : null}
          {autoLinking ? "Auto-linking…" : "Auto-link by Name"}
        </button>
        {autoResult && (
          <span className="text-[12px] text-[#3dbf8a]">
            ✓ Linked {autoResult.linked} · skipped {autoResult.skipped}
          </span>
        )}
        {error && <span className="text-[12px] text-red-400">⚠ {error}</span>}
      </div>

      {items.length === 0 ? (
        <div className="py-12 text-center text-[13px] text-[#444]">
          No menu items found — sync from Toast first.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1a1a1a]">
                {["Toast Item", "Linked Recipe", "Est. Cost / Unit", ""].map((h) => (
                  <th key={h} className="text-[11px] font-medium text-[#555] uppercase tracking-wider px-5 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#111]">
              {items.map((item) => (
                <tr key={item.toastItemId} className="hover:bg-[#111] transition-colors">
                  <td className="px-5 py-3.5 text-white text-[13px]">{item.toastItemName}</td>
                  <td className="px-5 py-3.5">
                    <select
                      value={item.kyruRecipeId ?? ""}
                      disabled={linking === item.toastItemId}
                      onChange={(e) => handleLink(item.toastItemId, e.target.value || null)}
                      className="bg-[#111] border border-[#252525] text-[#888] text-[12px] rounded-lg px-2 py-1 focus:outline-none focus:border-[#3dbf8a]"
                    >
                      <option value="">— unlinked —</option>
                      {recipes.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-5 py-3.5 text-[#555] text-[12px]">
                    {item.recipeCost != null ? fmt(item.recipeCost) : "—"}
                  </td>
                  <td className="px-5 py-3.5">
                    {linking === item.toastItemId && <Spinner size="sm" />}
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

// ── COGS Report tab ───────────────────────────────────────────────────────────

function COGSReportTab() {
  const { start, end } = defaultRange();
  const [startDate, setStartDate] = useState(start);
  const [endDate,   setEndDate]   = useState(end);
  const [report,    setReport]    = useState<COGSReport | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<COGSReport>(`/api/toast/cogs-report?startDate=${startDate}&endDate=${endDate}`);
      setReport(data);
    } catch {
      setError("Could not load COGS report.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {/* Date range controls */}
      <div className="px-5 py-3 border-b border-[#1a1a1a] flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="bg-[#111] border border-[#252525] text-[#888] text-[12px] rounded-lg px-2 py-1 focus:outline-none focus:border-[#3dbf8a]"
        />
        <span className="text-[#444] text-[12px]">to</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="bg-[#111] border border-[#252525] text-[#888] text-[12px] rounded-lg px-2 py-1 focus:outline-none focus:border-[#3dbf8a]"
        />
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-60 text-white text-[12px] font-semibold rounded-lg transition-colors"
        >
          {loading ? "Loading…" : "Run Report"}
        </button>
        {error && <span className="text-[12px] text-red-400">⚠ {error}</span>}
      </div>

      {loading && <div className="py-12 flex justify-center"><Spinner size="md" /></div>}

      {report && !loading && (
        <>
          {/* Summary bar */}
          <div className="px-5 py-4 border-b border-[#1a1a1a] flex flex-wrap gap-6">
            <div>
              <p className="text-[11px] text-[#444] uppercase tracking-wider">Total Revenue</p>
              <p className="text-lg font-semibold text-white mt-0.5">{fmt(report.totalRev)}</p>
            </div>
            <div>
              <p className="text-[11px] text-[#444] uppercase tracking-wider">Total COGS</p>
              <p className="text-lg font-semibold text-white mt-0.5">{fmt(report.totalCost)}</p>
            </div>
            <div>
              <p className="text-[11px] text-[#444] uppercase tracking-wider">Blended Cost %</p>
              <p className={`text-lg font-semibold mt-0.5 ${pctColor(report.blendedPct)}`}>
                {report.blendedPct.toFixed(1)}%
              </p>
            </div>
          </div>

          {report.items.length === 0 ? (
            <div className="py-12 text-center text-[13px] text-[#444]">
              No items with linked recipes found for this period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1a1a1a]">
                    {["Item", "Qty Sold", "Revenue", "Recipe Cost", "Cost %"].map((h, i) => (
                      <th key={h} className={`text-[11px] font-medium text-[#555] uppercase tracking-wider px-5 py-3 ${i > 1 ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#111]">
                  {report.items.map((item) => (
                    <tr key={item.toastItemId} className="hover:bg-[#111] transition-colors">
                      <td className="px-5 py-3.5 text-white text-[13px]">{item.itemName}</td>
                      <td className="px-5 py-3.5 text-[#888] text-[12px]">{item.qtySold}</td>
                      <td className="px-5 py-3.5 text-right text-white tabular-nums">{fmt(item.revenue)}</td>
                      <td className="px-5 py-3.5 text-right text-[#888] tabular-nums">{fmt(item.recipeCost)}</td>
                      <td className="px-5 py-3.5 text-right">
                        <span className={`font-semibold tabular-nums ${pctColor(item.costPct)}`}>
                          {item.costPct.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Variance Flags tab ────────────────────────────────────────────────────────

function VarianceFlagsTab() {
  const { start, end } = defaultRange();
  const [startDate, setStartDate] = useState(start);
  const [endDate,   setEndDate]   = useState(end);
  const [benchmark, setBenchmark] = useState(30);
  const [flags,     setFlags]     = useState<VarianceFlag[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<{ flags: VarianceFlag[] }>(
        `/api/toast/variance-flags?startDate=${startDate}&endDate=${endDate}&benchmark=${benchmark}`
      );
      setFlags(data.flags);
    } catch {
      setError("Could not load variance flags.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="px-5 py-3 border-b border-[#1a1a1a] flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="bg-[#111] border border-[#252525] text-[#888] text-[12px] rounded-lg px-2 py-1 focus:outline-none focus:border-[#3dbf8a]"
        />
        <span className="text-[#444] text-[12px]">to</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="bg-[#111] border border-[#252525] text-[#888] text-[12px] rounded-lg px-2 py-1 focus:outline-none focus:border-[#3dbf8a]"
        />
        <label className="flex items-center gap-1.5 text-[12px] text-[#555]">
          Benchmark
          <input
            type="number"
            min={1}
            max={100}
            value={benchmark}
            onChange={(e) => setBenchmark(Number(e.target.value))}
            className="w-14 bg-[#111] border border-[#252525] text-[#888] rounded-lg px-2 py-1 focus:outline-none focus:border-[#3dbf8a]"
          />
          %
        </label>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-60 text-white text-[12px] font-semibold rounded-lg transition-colors"
        >
          {loading ? "Loading…" : "Run"}
        </button>
        {error && <span className="text-[12px] text-red-400">⚠ {error}</span>}
      </div>

      {loading && <div className="py-12 flex justify-center"><Spinner size="md" /></div>}

      {!loading && flags.length === 0 && (
        <div className="py-12 text-center text-[13px] text-[#444]">
          No items exceed the {benchmark}% benchmark for this period.
        </div>
      )}

      {!loading && flags.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1a1a1a]">
                {["Item", "Cost %", "Benchmark", "Gap", "COGS", "Revenue"].map((h, i) => (
                  <th key={h} className={`text-[11px] font-medium text-[#555] uppercase tracking-wider px-5 py-3 ${i > 0 ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#111]">
              {flags.map((f) => (
                <tr key={f.toastItemId} className="hover:bg-[#111] transition-colors">
                  <td className="px-5 py-3.5 text-white text-[13px]">{f.itemName}</td>
                  <td className="px-5 py-3.5 text-right">
                    <span className="text-red-400 font-semibold tabular-nums">{f.costPct.toFixed(1)}%</span>
                  </td>
                  <td className="px-5 py-3.5 text-right text-[#555] tabular-nums">{f.benchmark}%</td>
                  <td className="px-5 py-3.5 text-right">
                    <span className="text-amber-400 font-medium tabular-nums">+{f.gap.toFixed(1)}%</span>
                  </td>
                  <td className="px-5 py-3.5 text-right text-[#888] tabular-nums">{fmt(f.recipeCost)}</td>
                  <td className="px-5 py-3.5 text-right text-white tabular-nums">{fmt(f.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

type Tab = "mapping" | "cogs" | "variance";

const TABS: { key: Tab; label: string }[] = [
  { key: "mapping",  label: "Menu Item Mapping" },
  { key: "cogs",     label: "COGS Report" },
  { key: "variance", label: "Variance Flags" },
];

export function CostAnalysis() {
  const [tab, setTab] = useState<Tab>("mapping");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-white">Cost Analysis</h1>
        <p className="text-[13px] text-[#555] mt-0.5">
          Link Toast menu items to Kyru recipes and track food cost %.
        </p>
      </div>

      <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-[#1a1a1a]">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-5 py-3.5 text-[12px] font-medium transition-colors ${
                tab === key
                  ? "text-[#3dbf8a] border-b-2 border-[#3dbf8a] -mb-px"
                  : "text-[#555] hover:text-[#888]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "mapping"  && (
          <>
            <SectionHeader
              title="Menu Item Mapping"
              sub="Link each Toast menu item to its Kyru recipe to enable COGS calculation."
            />
            <MenuItemMappingTab />
          </>
        )}
        {tab === "cogs" && (
          <>
            <SectionHeader
              title="COGS Report"
              sub="Recipe cost vs. revenue for linked items in the selected period."
            />
            <COGSReportTab />
          </>
        )}
        {tab === "variance" && (
          <>
            <SectionHeader
              title="Variance Flags"
              sub="Items where food cost % exceeds your benchmark — investigate these first."
            />
            <VarianceFlagsTab />
          </>
        )}
      </div>
    </div>
  );
}
