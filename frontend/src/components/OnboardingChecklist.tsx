import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onboardingApi, OnboardingProgress } from "../api";

// ── Types ─────────────────────────────────────────────────────────────────────

type CompletedKey = keyof OnboardingProgress["completed"];

interface ChecklistItem {
  key:    CompletedKey;
  label:  string;
  route:  string;
}

// ── Config ────────────────────────────────────────────────────────────────────

const ITEMS: ChecklistItem[] = [
  { key: "invoice",  label: "Add your first invoice",              route: "/orders"   },
  { key: "product",  label: "Create your first product",           route: "/products" },
  { key: "recipe",   label: "Build your first recipe",             route: "/recipes"  },
  { key: "parLevel", label: "Set your par levels (minimum stock)", route: "/products" },
  { key: "team",     label: "Add a team member",                   route: "/team"     },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 text-brand-500 shrink-0"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M2.5 7l3.5 3.5 5.5-6" />
    </svg>
  );
}

function CircleIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 text-[#333] shrink-0"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
    >
      <circle cx="7" cy="7" r="5.5" strokeWidth={1.5} />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function OnboardingChecklist() {
  const navigate = useNavigate();

  const [progress,    setProgress]    = useState<OnboardingProgress | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [hidden,      setHidden]      = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch progress whenever the component mounts (i.e. every dashboard visit).
  useEffect(() => {
    onboardingApi.progress().then(setProgress).catch(() => {});
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  // Watch for "all done" — start the 3-second celebration then persist dismiss.
  useEffect(() => {
    if (!progress || progress.dismissed || celebrating) return;
    const allDone = ITEMS.every(({ key }) => progress.completed[key]);
    if (!allDone) return;

    setCelebrating(true);
    timerRef.current = setTimeout(async () => {
      try { await onboardingApi.dismiss(); } catch { /* best-effort */ }
      setHidden(true);
    }, 3000);
  }, [progress, celebrating]);

  // Hide while loading, already dismissed, or just dismissed this session.
  if (!progress || progress.dismissed || hidden) return null;

  const completedCount = ITEMS.filter(({ key }) => progress.completed[key]).length;
  const total          = ITEMS.length;
  const pct            = Math.round((completedCount / total) * 100);

  // ── Celebration overlay ────────────────────────────────────────────────────
  if (celebrating) {
    return (
      <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-[8px] px-5 py-4 flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-500/10 shrink-0">
          <svg className="w-4 h-4 text-brand-500" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm3.707 6.293a1 1 0 00-1.414-1.414L9 10.172 7.707 8.879a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
          </svg>
        </div>
        <div>
          <p className="text-[13px] font-semibold text-white">You're all set! 🎉</p>
          <p className="text-[12px] text-[#555] mt-0.5">Setup complete — this checklist won't appear again.</p>
        </div>
      </div>
    );
  }

  // ── Normal checklist card ──────────────────────────────────────────────────
  return (
    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-[8px] px-5 py-4 space-y-3">

      {/* Header + progress counter */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-semibold text-white uppercase tracking-[0.07em]">
          Get started
        </p>
        <span className="text-[11px] text-[#555] shrink-0">
          {completedCount} of {total} completed
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
        <div
          className="h-full bg-brand-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Checklist items */}
      <ul className="space-y-0.5">
        {ITEMS.map(({ key, label, route }) => {
          const done = progress.completed[key];
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => navigate(route)}
                className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left transition-colors group
                  ${done
                    ? "opacity-50 cursor-default"
                    : "hover:bg-[#111] cursor-pointer"
                  }`}
                disabled={done}
              >
                <span className="shrink-0 flex items-center justify-center w-4 h-4">
                  {done ? <CheckIcon /> : <CircleIcon />}
                </span>
                <span
                  className={`text-[13px] leading-snug ${
                    done
                      ? "line-through text-[#444]"
                      : "text-[#aaa] group-hover:text-white transition-colors"
                  }`}
                >
                  {label}
                </span>
                {!done && (
                  <svg
                    className="w-3 h-3 text-[#333] ml-auto shrink-0 group-hover:text-[#555] transition-colors"
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
