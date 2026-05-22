import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  FormEvent,
} from "react";
import { Product, Unit, Department } from "../types";
import { api, productsApi } from "../api";
import { Spinner } from "./shared/Spinner";
import { useToast } from "../context/ToastContext";
import { getApiError, getFieldErrors } from "../utils/errorUtils";

// ── Constants ─────────────────────────────────────────────────────────────────

const UNITS: { value: Unit; label: string }[] = [
  { value: "KG", label: "KG – Kilograms" },
  { value: "LITERS", label: "L – Liters" },
  { value: "PIECES", label: "PCS – Pieces" },
  { value: "LB", label: "LB – Pounds" },
  { value: "OZ", label: "OZ – Ounces" },
  { value: "G", label: "G – Grams" },
  { value: "EA", label: "EA – Each" },
  { value: "DOZ", label: "DOZ – Dozen" },
];

const CATEGORIES = [
  "Perishable Food",
  "Dry Food",
  "Beverages",
  "Non-Food Supplies",
] as const;

const DEPARTMENTS: { value: Department; label: string }[] = [
  { value: "BOH", label: "BOH" },
  { value: "FOH", label: "FOH" },
  { value: "BAR", label: "BAR" },
  { value: "BOTH", label: "Both" },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (product: Product) => void;
}

type FieldErrors = Partial<
  Record<
    | "name"
    | "sku"
    | "category"
    | "purveyor"
    | "invoiceDate"
    | "costPerUnit"
    | "currentStock"
    | "minimumStock",
    string
  >
>;

// ── Component ─────────────────────────────────────────────────────────────────

export function ScanInvoiceModal({ open, onClose, onSaved }: Props) {
  const toast = useToast();

  // Camera state
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null); // data URL
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [purveyor, setPurveyor] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("");
  const [department, setDepartment] = useState<Department>("BOH");
  const [unit, setUnit] = useState<Unit>("PIECES");
  const [costPerUnit, setCostPerUnit] = useState("");
  const [currentStock, setCurrentStock] = useState("0");
  const [minimumStock, setMinimumStock] = useState("0");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  // ── Camera lifecycle ────────────────────────────────────────────────────────

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setCameraReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => setCameraReady(true);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof DOMException
          ? err.name === "NotAllowedError"
            ? "Camera permission denied. Please allow camera access and try again."
            : err.name === "NotFoundError"
            ? "No camera found on this device."
            : `Camera error: ${err.message}`
          : "Could not access camera.";
      setCameraError(msg);
    }
  }, []);

  // Start camera when modal opens (and no image captured yet)
  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }
    if (!capturedImage) {
      startCamera();
    }
    return () => {
      // cleanup on unmount
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleClose() {
    stopCamera();
    resetAll();
    onClose();
  }

  function resetAll() {
    setCapturedImage(null);
    setExtractError(null);
    setExtracting(false);
    setCameraError(null);
    setName("");
    setPurveyor("");
    setInvoiceDate("");
    setSku("");
    setCategory("");
    setDepartment("BOH");
    setUnit("PIECES");
    setCostPerUnit("");
    setCurrentStock("0");
    setMinimumStock("0");
    setFieldErrors({});
    setSaving(false);
  }

  // ── Capture ─────────────────────────────────────────────────────────────────

  function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !cameraReady) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    stopCamera();
    setCapturedImage(dataUrl);
    extractFromImage(dataUrl);
  }

  function retake() {
    setCapturedImage(null);
    setExtractError(null);
    startCamera();
  }

  // ── AI extraction ────────────────────────────────────────────────────────────

  async function extractFromImage(dataUrl: string) {
    setExtracting(true);
    setExtractError(null);

    try {
      const base64 = dataUrl.split(",")[1];
      const { data } = await api.post<{
        name: string | null;
        purveyor: string | null;
        invoiceDate: string | null;
        unit: string | null;
        costPerUnit: number | null;
        category: string | null;
      }>("/ai/extract-invoice", { imageBase64: base64, mimeType: "image/jpeg" });

      if (data.name) setName(data.name);
      if (data.purveyor) setPurveyor(data.purveyor);
      if (data.invoiceDate) setInvoiceDate(data.invoiceDate);
      if (data.unit && UNITS.some((u) => u.value === data.unit))
        setUnit(data.unit as Unit);
      if (data.costPerUnit !== null && data.costPerUnit !== undefined)
        setCostPerUnit(String(data.costPerUnit));
      if (data.category && CATEGORIES.includes(data.category as never))
        setCategory(data.category);
    } catch (err) {
      setExtractError(
        "Could not extract data from the image. Please fill in the fields manually."
      );
    } finally {
      setExtracting(false);
    }
  }

  // ── Form submit ─────────────────────────────────────────────────────────────

  function validateLocal(): FieldErrors {
    const errs: FieldErrors = {};
    if (!name.trim()) errs.name = "Name is required";
    else if (name.length > 255) errs.name = "Name must be 255 characters or less";
    const cost = parseFloat(costPerUnit);
    if (!costPerUnit || isNaN(cost) || cost <= 0)
      errs.costPerUnit = "Cost must be greater than 0";
    const stock = parseFloat(currentStock);
    if (isNaN(stock) || stock < 0) errs.currentStock = "Stock cannot be negative";
    const minStock = parseFloat(minimumStock);
    if (isNaN(minStock) || minStock < 0)
      errs.minimumStock = "Minimum stock cannot be negative";
    if (!isNaN(minStock) && !isNaN(stock) && minStock > stock)
      errs.minimumStock = "Minimum stock cannot exceed current stock";
    return errs;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const localErrs = validateLocal();
    if (Object.keys(localErrs).length > 0) {
      setFieldErrors(localErrs);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    try {
      const saved = await productsApi.create({
        name: name.trim(),
        purveyor: purveyor.trim() || undefined,
        invoiceDate: invoiceDate || undefined,
        sku: sku.trim() || undefined,
        category: category || undefined,
        department,
        unit,
        costPerUnit: parseFloat(costPerUnit),
        currentStock: parseFloat(currentStock),
        minimumStock: parseFloat(minimumStock),
      });
      toast.success("Invoice added successfully");
      onSaved(saved);
      handleClose();
    } catch (err) {
      const serverFields = getFieldErrors(err);
      if (Object.keys(serverFields).length > 0) {
        setFieldErrors(serverFields as FieldErrors);
      } else {
        toast.error(getApiError(err));
      }
    } finally {
      setSaving(false);
    }
  }

  // ── Styles ──────────────────────────────────────────────────────────────────

  const inputBase =
    "w-full px-3 py-2 rounded-lg border bg-[#111] text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#3dbf8a] focus:border-[#3dbf8a] transition-colors placeholder-[#444]";
  const fieldClass = (err?: string) =>
    `${inputBase} ${err ? "border-red-500" : "border-[#2a2a2a]"}`;

  function FieldError({ msg }: { msg?: string }) {
    if (!msg) return null;
    return <p className="mt-1 text-xs text-red-400">{msg}</p>;
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-5xl bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1a1a1a] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#3dbf8a]/10 flex items-center justify-center">
              <svg className="w-4 h-4 text-[#3dbf8a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-white">Scan Invoice</h2>
              <p className="text-[11px] text-[#555]">Capture an invoice to auto-populate fields</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#555] hover:text-white hover:bg-[#1a1a1a] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body — two columns */}
        <div className="flex flex-1 min-h-0 divide-x divide-[#1a1a1a]">

          {/* LEFT: Camera */}
          <div className="w-[42%] flex-shrink-0 flex flex-col p-5 gap-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#444]">
              Camera
            </p>

            {/* Viewfinder */}
            <div className="relative flex-1 min-h-0 rounded-xl overflow-hidden bg-[#111] border border-[#1a1a1a] flex items-center justify-center">
              {/* Live camera */}
              {!capturedImage && (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              )}

              {/* Captured still */}
              {capturedImage && (
                <img
                  src={capturedImage}
                  alt="Captured invoice"
                  className="w-full h-full object-contain"
                />
              )}

              {/* Error overlay */}
              {cameraError && !capturedImage && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                  <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                    <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-[12px] text-red-400">{cameraError}</p>
                  <button
                    onClick={startCamera}
                    className="text-[12px] px-3 py-1.5 rounded-lg bg-[#1a1a1a] text-[#888] hover:text-white transition-colors"
                  >
                    Try again
                  </button>
                </div>
              )}

              {/* Scanning overlay when no error and no capture */}
              {!cameraError && !capturedImage && cameraReady && (
                <div className="absolute inset-0 pointer-events-none">
                  {/* Corner brackets */}
                  <div className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-[#3dbf8a] rounded-tl" />
                  <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-[#3dbf8a] rounded-tr" />
                  <div className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-[#3dbf8a] rounded-bl" />
                  <div className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-[#3dbf8a] rounded-br" />
                </div>
              )}

              {/* Loading spinner while camera initialises */}
              {!cameraError && !capturedImage && !cameraReady && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Spinner size="md" />
                </div>
              )}

              {/* Extracting overlay on captured image */}
              {capturedImage && extracting && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
                  <Spinner size="md" />
                  <p className="text-[12px] text-[#3dbf8a] font-medium">Analysing invoice…</p>
                </div>
              )}
            </div>

            {/* Hidden canvas for capture */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Camera controls */}
            <div className="flex gap-2 flex-shrink-0">
              {!capturedImage ? (
                <button
                  type="button"
                  onClick={capture}
                  disabled={!cameraReady || !!cameraError}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-semibold transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="3" strokeWidth={2} />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  </svg>
                  Capture
                </button>
              ) : (
                <button
                  type="button"
                  onClick={retake}
                  disabled={extracting}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[#2a2a2a] text-[#888] hover:text-white hover:border-[#3a3a3a] disabled:opacity-40 disabled:cursor-not-allowed text-[13px] font-medium transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Retake
                </button>
              )}
            </div>

            {/* Extraction error */}
            {extractError && (
              <p className="text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
                {extractError}
              </p>
            )}

            {/* Success hint */}
            {capturedImage && !extracting && !extractError && (
              <p className="text-[11px] text-[#3dbf8a] bg-[#3dbf8a]/10 border border-[#3dbf8a]/20 rounded-lg px-3 py-2">
                Fields populated — review and save on the right.
              </p>
            )}
          </div>

          {/* RIGHT: Form */}
          <div className="flex-1 flex flex-col min-h-0">
            <form
              onSubmit={handleSubmit}
              className="flex-1 overflow-y-auto p-5 space-y-4"
              noValidate
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#444]">
                Invoice Details
              </p>

              <div className="grid grid-cols-2 gap-3">
                {/* Name */}
                <div className="col-span-2">
                  <label className="block text-[11px] font-medium text-[#666] mb-1">
                    Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    className={fieldClass(fieldErrors.name)}
                    value={name}
                    onChange={(e) => { setName(e.target.value); setFieldErrors((f) => ({ ...f, name: undefined })); }}
                    placeholder="Product name"
                    maxLength={255}
                  />
                  <FieldError msg={fieldErrors.name} />
                </div>

                {/* Purveyor */}
                <div className="col-span-2">
                  <label className="block text-[11px] font-medium text-[#666] mb-1">Purveyor</label>
                  <input
                    className={fieldClass()}
                    value={purveyor}
                    onChange={(e) => setPurveyor(e.target.value)}
                    placeholder="Supplier name"
                    maxLength={255}
                  />
                </div>

                {/* Invoice Date */}
                <div>
                  <label className="block text-[11px] font-medium text-[#666] mb-1">Invoice Date</label>
                  <input
                    type="date"
                    className={fieldClass()}
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                  />
                </div>

                {/* SKU */}
                <div>
                  <label className="block text-[11px] font-medium text-[#666] mb-1">SKU</label>
                  <input
                    className={fieldClass(fieldErrors.sku)}
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    placeholder="PROD-001"
                  />
                </div>

                {/* Category */}
                <div>
                  <label className="block text-[11px] font-medium text-[#666] mb-1">Category</label>
                  <select
                    className={fieldClass()}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="">— Select —</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                {/* Unit */}
                <div>
                  <label className="block text-[11px] font-medium text-[#666] mb-1">
                    Unit <span className="text-red-500">*</span>
                  </label>
                  <select
                    className={fieldClass()}
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as Unit)}
                  >
                    {UNITS.map(({ value: v, label }) => (
                      <option key={v} value={v}>{label}</option>
                    ))}
                  </select>
                </div>

                {/* Department */}
                <div className="col-span-2">
                  <label className="block text-[11px] font-medium text-[#666] mb-1.5">
                    Department <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-1.5">
                    {DEPARTMENTS.map(({ value: v, label }) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setDepartment(v)}
                        className={`flex-1 py-1.5 rounded-lg text-[12px] font-medium transition-colors border ${
                          department === v
                            ? "bg-[#3dbf8a] border-[#3dbf8a] text-white"
                            : "bg-transparent border-[#2a2a2a] text-[#555] hover:border-[#3dbf8a] hover:text-[#3dbf8a]"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cost / unit */}
                <div>
                  <label className="block text-[11px] font-medium text-[#666] mb-1">
                    Cost / unit <span className="text-red-500">*</span>
                  </label>
                  <input
                    className={`${fieldClass(fieldErrors.costPerUnit)} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                    type="text"
                    inputMode="decimal"
                    value={costPerUnit}
                    onChange={(e) => { setCostPerUnit(e.target.value); setFieldErrors((f) => ({ ...f, costPerUnit: undefined })); }}
                    placeholder="0.00"
                  />
                  <FieldError msg={fieldErrors.costPerUnit} />
                </div>

                {/* Current stock */}
                <div>
                  <label className="block text-[11px] font-medium text-[#666] mb-1">Current stock</label>
                  <input
                    className={fieldClass(fieldErrors.currentStock)}
                    type="text"
                    inputMode="decimal"
                    value={currentStock}
                    onChange={(e) => { setCurrentStock(e.target.value); setFieldErrors((f) => ({ ...f, currentStock: undefined, minimumStock: undefined })); }}
                  />
                  <FieldError msg={fieldErrors.currentStock} />
                </div>

                {/* Minimum stock */}
                <div className="col-span-2">
                  <label className="block text-[11px] font-medium text-[#666] mb-1">Minimum stock</label>
                  <input
                    className={fieldClass(fieldErrors.minimumStock)}
                    type="text"
                    inputMode="decimal"
                    value={minimumStock}
                    onChange={(e) => { setMinimumStock(e.target.value); setFieldErrors((f) => ({ ...f, minimumStock: undefined })); }}
                  />
                  <FieldError msg={fieldErrors.minimumStock} />
                </div>
              </div>
            </form>

            {/* Footer actions — outside the scroll area */}
            <div className="flex gap-2 px-5 py-4 border-t border-[#1a1a1a] flex-shrink-0">
              <button
                type="button"
                onClick={handleClose}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl border border-[#2a2a2a] text-[13px] text-[#666] hover:text-white hover:border-[#3a3a3a] disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={(e) => handleSubmit(e as unknown as FormEvent)}
                disabled={saving || extracting}
                className="flex-1 py-2.5 rounded-xl bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-50 text-white text-[13px] font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {saving && <Spinner size="sm" />}
                Save Invoice
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
