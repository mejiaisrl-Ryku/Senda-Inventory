import React, { useState, useEffect } from "react";
import { Spinner } from "./shared/Spinner";

interface Props {
  open: boolean;
  title: string;
  quantityLabel: string;
  unitHint?: string;
  confirmLabel: string;
  cancelLabel: string;
  loading?: boolean;
  onConfirm: (quantity: number) => void;
  onCancel: () => void;
}

/** Quantity-entry dialog used by both Recipes and Preparations to record a
 *  production run (consumes ingredients/linked-prep stock on the backend). */
export function ProduceDialog({
  open,
  title,
  quantityLabel,
  unitHint,
  confirmLabel,
  cancelLabel,
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  const [quantity, setQuantity] = useState("1");

  useEffect(() => {
    if (open) setQuantity("1");
  }, [open]);

  if (!open) return null;

  const parsed = parseFloat(quantity);
  const valid = !isNaN(parsed) && parsed > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl shadow-2xl p-5 space-y-4">
        <h3 className="text-[15px] font-semibold text-white">{title}</h3>

        <div>
          <label className="text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] block mb-2">
            {quantityLabel}
          </label>
          <input
            type="number"
            step="0.01"
            autoFocus
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-full px-3 py-2 rounded-[8px] border border-[#2a2a2a] bg-[#111] text-white text-sm focus:outline-none focus:border-[#3dbf8a] transition-colors"
          />
          {unitHint && <p className="text-[11px] text-[#555] mt-1.5">{unitHint}</p>}
        </div>

        <div className="flex gap-2 justify-end pt-2 border-t border-[#1a1a1a]">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-[8px] border border-[#2a2a2a] text-[13px] text-[#666] hover:text-white hover:border-[#3a3a3a] disabled:opacity-50 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => valid && onConfirm(parsed)}
            disabled={loading || !valid}
            className="flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-50 text-white text-[13px] font-semibold transition-colors"
          >
            {loading && <Spinner size="sm" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
