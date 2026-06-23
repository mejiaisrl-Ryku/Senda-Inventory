import React, { useEffect, useRef, useState } from "react";
import type { Allergen } from "../types";

export interface AllergenMultiSelectProps {
  allergens:    Allergen[];
  selectedIds:  number[];
  onToggle:     (id: number) => void;
  lang:         "en" | "es";
  label:        string;
  placeholder:  string;
  /** Optional per-allergen tag shown next to a selected chip (e.g. "from prep" / "manual"). */
  getTag?:      (id: number) => string | null;
}

/**
 * Dropdown multi-select for allergens — replaces the old checkbox grid.
 * Selected allergens render as removable chips below the trigger button;
 * the panel itself stays open across multiple picks so the user can keep
 * selecting without re-opening it each time.
 */
export function AllergenMultiSelect({
  allergens,
  selectedIds,
  onToggle,
  lang,
  label,
  placeholder,
  getTag,
}: AllergenMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const labelOf = (a: Allergen) => (lang === "es" ? a.labelES : a.labelEN);
  const selected = allergens.filter((a) => selectedIds.includes(a.id));

  return (
    <div ref={ref}>
      <label className="text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] block mb-2">
        {label}
      </label>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-3 py-2 rounded-[8px] border border-[#2a2a2a] bg-[#111] text-left text-sm text-[#888] hover:border-[#3a3a3a] focus:outline-none focus:border-[#3dbf8a] transition-colors flex items-center justify-between"
      >
        <span>{selected.length > 0 ? `${selected.length} selected` : placeholder}</span>
        <span className="text-[#555]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="relative">
          <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-[#161616] border border-[#2a2a2a] rounded-[8px] shadow-lg py-1">
            {allergens.length === 0 ? (
              <p className="px-3 py-2 text-[12px] text-[#555]">—</p>
            ) : (
              allergens.map((a) => {
                const checked = selectedIds.includes(a.id);
                return (
                  <label
                    key={a.id}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-[#888] hover:bg-[#1f1f1f] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(a.id)}
                      className="rounded border-[#2a2a2a] bg-[#111] text-[#3dbf8a] focus:ring-[#3dbf8a]"
                    />
                    <span className={checked ? "text-white" : ""}>{labelOf(a)}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {selected.map((a) => {
            const tag = getTag?.(a.id) ?? null;
            return (
              <span
                key={a.id}
                className="inline-flex items-center gap-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-full px-2.5 py-1 text-[12px] text-white"
              >
                {labelOf(a)}
                {tag && <span className="text-[10px] text-[#555]">({tag})</span>}
                <button
                  type="button"
                  onClick={() => onToggle(a.id)}
                  className="text-[#555] hover:text-red-400 leading-none"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
