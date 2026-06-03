import React, { useId } from "react";
import { useCogsCategories } from "../hooks/useCogsCategories";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CogsCategorySelectProps {
  /** The currently-selected CogsCategory id, or null/undefined for "none". */
  value:     string | null | undefined;
  /** Called with the selected id, or null when the placeholder is chosen. */
  onChange:  (id: string | null) => void;
  disabled?: boolean;
  required?: boolean;
  /** Override the default label. Ignored when language is provided. */
  label?:    string;
  /** Drives built-in bilingual labels. Defaults to "en". */
  language?: "en" | "es";
  /** Extra Tailwind classes forwarded to the <select> element. */
  className?: string;
}

// ── Bilingual strings ─────────────────────────────────────────────────────────

const LABELS = {
  en: { field: "COGS Category",    placeholder: "— Select —",        loading: "Loading…",              noCategories: "No categories available" },
  es: { field: "Categoría COGS",   placeholder: "— Seleccionar —",   loading: "Cargando…",             noCategories: "Sin categorías disponibles" },
} as const;

// ── Component ─────────────────────────────────────────────────────────────────

export function CogsCategorySelect({
  value,
  onChange,
  disabled  = false,
  required  = false,
  label,
  language  = "en",
  className = "",
}: CogsCategorySelectProps) {
  const selectId = useId();
  const { categories, loading, error } = useCogsCategories();

  const strings   = LABELS[language];
  const fieldLabel = label ?? strings.field;

  // ── Shared select classes (matches existing form inputs in this codebase) ──
  const selectCls =
    "w-full px-3 py-2 rounded-lg border text-sm transition-colors " +
    "focus:outline-none focus:ring-2 focus:ring-brand-500 " +
    "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 " +
    "text-gray-900 dark:text-white " +
    "disabled:opacity-50 disabled:cursor-not-allowed " +
    className;

  const labelCls =
    "block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      <label htmlFor={selectId} className={labelCls}>
        {fieldLabel}
        {required && (
          <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>
        )}
        {loading && (
          <span className="ml-1.5 inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent opacity-50" />
        )}
      </label>

      <select
        id={selectId}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled || loading}
        required={required}
        aria-invalid={!!error}
        aria-describedby={error ? `${selectId}-error` : undefined}
        className={selectCls}
      >
        <option value="">
          {loading ? strings.loading : strings.placeholder}
        </option>

        {!loading && categories.length === 0 && (
          <option value="" disabled>
            {strings.noCategories}
          </option>
        )}

        {categories.map((cat) => (
          <option key={cat.id} value={cat.id}>
            {cat.name}
          </option>
        ))}
      </select>

      {error && (
        <p
          id={`${selectId}-error`}
          role="alert"
          className="mt-1 text-xs text-red-500 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </div>
  );
}
