import React, { useEffect, useRef, useState, useCallback } from "react";
import { CountDepartment, CountSession } from "../types";
import { countsApi, scanApi, ScanItem } from "../api";
import { useLanguage } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import { Spinner } from "./shared/Spinner";
import { getApiError } from "../utils/errorUtils";

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function confidenceColor(c: "high" | "medium" | "low"): string {
  if (c === "high")   return "bg-[#3dbf8a]/10 text-[#3dbf8a] border-[#3dbf8a]/20";
  if (c === "medium") return "bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/20";
  return                     "bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/20";
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ScanCountModalProps {
  open:      boolean;
  onClose:   () => void;
  onCreated: (session: CountSession) => void;
}

// ── Reviewed item state ───────────────────────────────────────────────────────

interface ReviewItem extends ScanItem {
  reviewQty: number;
  skipped:   boolean;
}

// ── Main component ────────────────────────────────────────────────────────────

export function ScanCountModal({ open, onClose, onCreated }: ScanCountModalProps) {
  const { t } = useLanguage();
  const toast  = useToast();
  const s      = t.inventoryScan;

  const [screen,     setScreen]     = useState<"camera" | "review">("camera");
  const [scanning,   setScanning]   = useState(false);
  const [creating,   setCreating]   = useState(false);
  const [camError,   setCamError]   = useState("");
  const [items,      setItems]      = useState<ReviewItem[]>([]);
  const [date,       setDate]       = useState(todayLocal());
  const [department, setDepartment] = useState<CountDepartment>("ALL");

  const videoRef  = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Start/stop camera stream
  const startCamera = useCallback(async () => {
    setCamError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    } catch {
      setCamError(s.cameraError);
    }
  }, [s.cameraError]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) { stopCamera(); return; }
    if (screen === "camera") startCamera();
    return () => { if (screen === "camera") stopCamera(); };
  }, [open, screen, startCamera, stopCamera]);

  // Reset when closed
  useEffect(() => {
    if (!open) {
      setScreen("camera");
      setScanning(false);
      setItems([]);
      setDate(todayLocal());
      setDepartment("ALL");
      setCamError("");
    }
  }, [open]);

  // ── Capture frame ──────────────────────────────────────────────────────────
  async function handleCapture() {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    canvas.width  = video.videoWidth  || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], "inventory-scan.jpg", { type: "image/jpeg" });

      stopCamera();
      setScanning(true);

      try {
        const result = await scanApi.scanInventory(file);
        const reviewed: ReviewItem[] = result.items.map((item) => ({
          ...item,
          reviewQty: item.quantity,
          skipped:   false,
        }));
        setItems(reviewed);
        setScreen("review");
      } catch (err) {
        toast.error(getApiError(err));
        // Go back to camera
        startCamera();
      } finally {
        setScanning(false);
      }
    }, "image/jpeg", 0.85);
  }

  // ── Create count ───────────────────────────────────────────────────────────
  async function handleCreate() {
    const toCreate = items.filter((i) => !i.skipped && i.matchedProductId != null);
    if (toCreate.length === 0) {
      toast.error("No matched items to add.");
      return;
    }

    setCreating(true);
    try {
      const session = await countsApi.create({ date, department });
      await countsApi.updateEntries(
        session.id,
        toCreate.map((i) => ({ productId: i.matchedProductId!, actualQuantity: i.reviewQty }))
      );
      toast.success("Count session created from scan.");
      onCreated(session);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setCreating(false);
    }
  }

  if (!open) return null;

  const DEPARTMENTS: { value: CountDepartment; label: string }[] = [
    { value: "ALL",     label: t.counts.allDepts },
    { value: "KITCHEN", label: t.counts.kitchen  },
    { value: "BAR",     label: t.counts.bar      },
    { value: "FOH",     label: t.counts.foh      },
  ];

  const inputCls =
    "w-full px-3 py-2 rounded-xl border border-[#2a2a2a] bg-[#111] text-white text-sm " +
    "focus:outline-none focus:ring-1 focus:ring-[#3dbf8a] focus:border-[#3dbf8a] transition";

  // ── SCREEN 1: Camera ───────────────────────────────────────────────────────
  if (screen === "camera") {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col">
        {/* Close button */}
        <button
          onClick={() => { stopCamera(); onClose(); }}
          className="absolute top-4 right-4 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Title */}
        <div className="absolute top-4 left-4 z-10">
          <p className="text-white font-semibold text-[15px]">{s.title}</p>
          <p className="text-[#aaa] text-[12px] mt-0.5">{s.subtitle}</p>
        </div>

        {/* Video or error */}
        <div className="flex-1 relative overflow-hidden">
          {camError ? (
            <div className="flex items-center justify-center h-full text-center px-8">
              <div className="space-y-3">
                <p className="text-[#ef4444] text-[14px]">{camError}</p>
                <button
                  onClick={startCamera}
                  className="px-4 py-2 rounded-xl border border-[#2a2a2a] text-[#888] hover:text-white text-[13px] transition-colors"
                >
                  Try again
                </button>
              </div>
            </div>
          ) : (
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
              autoPlay
            />
          )}

          {/* Scanning overlay */}
          {scanning && (
            <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-3">
              <Spinner size="lg" />
              <p className="text-white text-[14px]">{s.scanning}</p>
            </div>
          )}
        </div>

        {/* Capture button */}
        {!scanning && !camError && (
          <div className="flex justify-center pb-10 pt-6 bg-gradient-to-t from-black/80 to-transparent">
            <button
              onClick={handleCapture}
              className="w-20 h-20 rounded-full bg-[#3dbf8a] hover:bg-[#35a87a] flex items-center justify-center shadow-2xl transition-colors active:scale-95"
              aria-label={s.capture}
            >
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── SCREEN 2: Review ───────────────────────────────────────────────────────
  const activeItems = items.filter((i) => !i.skipped);
  const matchedCount = activeItems.filter((i) => i.matchedProductId != null).length;

  return (
    <div className="fixed inset-0 z-50 bg-[#060606] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-5 pt-5 pb-3 border-b border-[#1a1a1a]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-semibold text-white">{s.reviewTitle}</h2>
            <p className="text-[12px] text-[#555] mt-0.5">{s.reviewSubtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-[#1a1a1a] text-[#555] hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-[11px] text-[#555] mt-1.5">
          {matchedCount} of {activeItems.length} items matched
        </p>
      </div>

      {/* Items list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <p className="text-[14px] text-[#555]">{s.noItems}</p>
          </div>
        ) : (
          items.map((item, idx) => (
            <div
              key={idx}
              className={`rounded-[10px] border p-3 transition-all ${
                item.skipped
                  ? "border-[#111] bg-[#0a0a0a] opacity-40"
                  : "border-[#1a1a1a] bg-[#0a0a0a]"
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Text info */}
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-[#555] truncate">{item.extractedName}</p>
                  {item.matchedProductId ? (
                    <p className="text-[13px] font-semibold text-white truncate mt-0.5">
                      {item.matchedProductName}
                    </p>
                  ) : (
                    <p className="text-[12px] text-[#f59e0b] mt-0.5">{s.unmatched}</p>
                  )}
                  <span className={`inline-flex items-center mt-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${confidenceColor(item.confidence)}`}>
                    {item.confidence === "high" ? s.high : item.confidence === "medium" ? s.medium : s.low}
                  </span>
                </div>

                {/* Quantity input */}
                {!item.skipped && item.matchedProductId && (
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <label className="text-[10px] text-[#555] uppercase tracking-wider">{s.quantity}</label>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={item.reviewQty}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        setItems((prev) => prev.map((it, i) => i === idx ? { ...it, reviewQty: isNaN(v) ? 0 : v } : it));
                      }}
                      className="w-20 px-2 py-1.5 rounded-lg border border-[#2a2a2a] bg-[#111] text-white text-[13px] text-right focus:outline-none focus:border-[#3dbf8a] transition-colors"
                    />
                  </div>
                )}

                {/* Skip button */}
                <button
                  onClick={() => setItems((prev) => prev.map((it, i) => i === idx ? { ...it, skipped: !it.skipped } : it))}
                  className="shrink-0 text-[11px] text-[#444] hover:text-[#888] transition-colors pt-1"
                >
                  {item.skipped ? "↩" : s.skipItem}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 border-t border-[#1a1a1a] px-4 py-4 space-y-3 bg-[#060606]">
        {/* Date + Department */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-medium text-[#555] uppercase tracking-wider mb-1">{t.common.date}</label>
            <input
              type="date"
              value={date}
              max={todayLocal()}
              onChange={(e) => setDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-[#555] uppercase tracking-wider mb-1">{t.counts.department}</label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value as CountDepartment)}
              className={inputCls}
            >
              {DEPARTMENTS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-2">
          {/* Retake */}
          <button
            onClick={() => { setScreen("camera"); setItems([]); startCamera(); }}
            className="px-4 py-2.5 rounded-xl border border-[#2a2a2a] text-[#555] hover:text-[#888] text-[13px] transition-colors"
          >
            {s.retake}
          </button>

          {/* Create count */}
          <button
            onClick={handleCreate}
            disabled={creating || matchedCount === 0}
            className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-60 text-white text-[13px] font-semibold rounded-xl transition-colors"
          >
            {creating && <Spinner size="sm" />}
            {creating ? s.creating : s.createCount}
          </button>
        </div>
      </div>
    </div>
  );
}
