import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  FormEvent,
} from "react";
import { Product, Unit, Department } from "../types";
import { api, productsApi, ordersApi } from "../api";
import { Spinner } from "./shared/Spinner";
import { useToast } from "../context/ToastContext";
import { getApiError, getFieldErrors } from "../utils/errorUtils";
import { CogsCategorySelect } from "./CogsCategorySelect";
import { useScanJobPolling } from "../hooks/useScanJobPolling";

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
  "Paper Goods",
  "Chemicals",
  "Office Supplies",
  "Miscellaneous",
] as const;

const DEPARTMENTS: { value: Department; label: string }[] = [
  { value: "BOH", label: "Kitchen" },
  { value: "FOH", label: "FOH" },
  { value: "BAR", label: "BAR" },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface AIExtractResponse {
  name:         string | null;
  purveyor:     string | null;
  invoiceDate:  string | null;
  unit:         string | null;
  quantity:     number | null;
  costPerUnit:  number | null;
  sku:          string | null;
  category:     string | null;
  department:   "BAR" | "BOH" | "FOH" | null;
  cogsCategory: { id: string; name: string } | null;
}

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
  const videoRef = useRef<HTMLVideoElement>(null);       // desktop panel video
  const mobileVideoRef = useRef<HTMLVideoElement>(null); // mobile fullscreen video
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null); // data URL
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const invoiceScan = useScanJobPolling<AIExtractResponse>({ timeoutMs: 60000 });

  // Form state
  const [name, setName] = useState("");
  const [purveyor, setPurveyor] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("");
  const [department, setDepartment] = useState<Department>("BOH");
  const [cogsCategoryId, setCogsCategoryId] = useState("");
  const [suggestedCogsCategoryName, setSuggestedCogsCategoryName] = useState<string | null>(null);
  const [unit, setUnit] = useState<Unit>("PIECES");
  const [costPerUnit, setCostPerUnit] = useState("");
  const [currentStock, setCurrentStock] = useState("0");
  const [minimumStock, setMinimumStock] = useState("0");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  // Post-save order prompt state (manual form path — kept for "Edit manually" fallback)
  const [showOrderPrompt, setShowOrderPrompt] = useState(false);
  const [savedProductData, setSavedProductData] = useState<{
    id: string;
    name: string;
    sku?: string;
    unit: string;
    costPerUnit: number;
    purveyor: string;
    invoiceDate: string;
    department: Department;
    cogsCategoryId: string;
  } | null>(null);
  const [creatingOrder, setCreatingOrder] = useState(false);

  // ── Smart confirmation state (scan path) ────────────────────────────────────
  type MatchType = "exact" | "multiple" | "none";

  interface SmartConfirmState {
    matchType:       MatchType;
    matches:         Product[];
    selectedProduct: Product | null;
    // Snapshot of extracted values — editable in the confirmation screen
    extractedName:          string;
    extractedPurveyor:      string;
    extractedInvoiceDate:   string;
    extractedSku:           string;
    extractedUnit:          Unit;
    extractedQty:           string;  // kept as string for input binding
    extractedCostPerUnit:   string;  // kept as string for input binding
    extractedDepartment:    Department;
    extractedCogsCategoryId: string;
  }

  const [searching,   setSearching]   = useState(false);
  const [smartConfirm, setSmartConfirm] = useState<SmartConfirmState | null>(null);

  // ── Batch state ─────────────────────────────────────────────────────────────
  interface BatchItem {
    _batchId:    string;
    productName: string;
    purveyor:    string;
    invoiceDate: string;
    qty:         number;
    unitCost:    number;
    unit:        Unit;
    department:  Department;
    cogsCategoryId: string;
    // Resolved product — null means "create new on submit"
    productId:   string | null;
    // Only set when productId is null
    newProductData?: {
      name:          string;
      sku?:          string;
      purveyor?:     string;
      invoiceDate?:  string;
      department:    Department;
      unit:          Unit;
      costPerUnit:   number;
      currentStock:  number;
      minimumStock:  number;
      cogsCategoryId?: string;
    };
  }

  const [batch,          setBatch]          = useState<BatchItem[]>([]);
  const [showBatch,      setShowBatch]      = useState(false);
  const [submittingBatch, setSubmittingBatch] = useState(false);
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
  const [editQty,        setEditQty]        = useState("");
  const [editCost,       setEditCost]       = useState("");

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
      // Prefer back camera on mobile; fall back to any camera if exact constraint fails
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      }
      streamRef.current = stream;
      // Assign stream to whichever video elements are mounted
      const assignStream = (el: HTMLVideoElement | null) => {
        if (!el) return;
        el.srcObject = stream;
        el.onloadedmetadata = () => setCameraReady(true);
      };
      assignStream(videoRef.current);
      assignStream(mobileVideoRef.current);
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
    if (batch.length > 0) {
      if (!window.confirm(`You have ${batch.length} item${batch.length !== 1 ? "s" : ""} in your batch. Discard them?`)) return;
    }
    stopCamera();
    resetAll();
    onClose();
  }

  /** Reset only the per-scan fields — keeps batch intact and restarts camera. */
  function resetScanState() {
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
    setCogsCategoryId("");
    setSuggestedCogsCategoryName(null);
    setUnit("PIECES");
    setCostPerUnit("");
    setCurrentStock("0");
    setMinimumStock("0");
    setFieldErrors({});
    setSaving(false);
    setShowOrderPrompt(false);
    setSavedProductData(null);
    setCreatingOrder(false);
    setSearching(false);
    setSmartConfirm(null);
    startCamera(); // ready for next scan
  }

  /** Full reset including batch — called when modal closes. */
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
    setCogsCategoryId("");
    setSuggestedCogsCategoryName(null);
    setUnit("PIECES");
    setCostPerUnit("");
    setCurrentStock("0");
    setMinimumStock("0");
    setFieldErrors({});
    setSaving(false);
    setShowOrderPrompt(false);
    setSavedProductData(null);
    setCreatingOrder(false);
    setSearching(false);
    setSmartConfirm(null);
    setBatch([]);
    setShowBatch(false);
    setSubmittingBatch(false);
    setEditingBatchId(null);
  }

  // ── Capture ─────────────────────────────────────────────────────────────────

  function capture() {
    // Prefer mobile fullscreen video if it has dimensions (mobile), else desktop video
    const mobileVid = mobileVideoRef.current;
    const desktopVid = videoRef.current;
    const video = (mobileVid && mobileVid.videoWidth > 0) ? mobileVid : desktopVid;
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

  // ── AI extraction + smart product match ────────────────────────────────────

  async function extractFromImage(dataUrl: string) {
    setExtracting(true);
    setExtractError(null);
    setSmartConfirm(null);

    let aiData: AIExtractResponse | null = null;

    try {
      const base64 = dataUrl.split(",")[1];
      const { data: enqueued } = await api.post<{ jobId: string }>("/ai/extract-invoice", {
        imageBase64: base64,
        mimeType: "image/jpeg",
      });

      const job = await invoiceScan.startPolling(enqueued.jobId);

      if (!job || job.status === "FAILED") {
        setExtractError(job?.error || invoiceScan.error || "Could not extract data. Please fill in the fields manually.");
        setExtracting(false);
        return;
      }
      if (!job.extractedData) {
        setExtractError("Scan completed with no data. Please fill in the fields manually.");
        setExtracting(false);
        return;
      }

      const data = job.extractedData;
      aiData = data;

      // Populate manual-form fallback fields
      if (data.name)        setName(data.name);
      if (data.purveyor)    setPurveyor(data.purveyor);
      if (data.invoiceDate) setInvoiceDate(data.invoiceDate);
      if (data.sku)         setSku(data.sku);
      if (data.unit && UNITS.some((u) => u.value === data.unit))
        setUnit(data.unit as Unit);
      if (data.costPerUnit != null) setCostPerUnit(String(data.costPerUnit));
      if (data.quantity     != null) setCurrentStock(String(data.quantity));
      if (data.category && CATEGORIES.includes(data.category as never))
        setCategory(data.category);
      if (data.department) setDepartment(data.department);
      if (data.cogsCategory?.id) {
        setCogsCategoryId(data.cogsCategory.id);
        setSuggestedCogsCategoryName(data.cogsCategory.name);
      }
    } catch (err) {
      setExtractError("Could not extract data. Please fill in the fields manually.");
      setExtracting(false);
      return;
    }

    setExtracting(false);

    // ── Product match search ─────────────────────────────────────────────────
    if (!aiData?.name) return; // nothing to search on

    setSearching(true);
    try {
      const result = await productsApi.search(aiData.name);

      const matchType: MatchType =
        result.hasNoMatch         ? "none"     :
        result.hasMultipleMatches ? "multiple" : "exact";

      const resolvedUnit: Unit =
        (aiData.unit && UNITS.some((u) => u.value === aiData!.unit))
          ? (aiData.unit as Unit)
          : unit; // fall back to current form state

      setSmartConfirm({
        matchType,
        matches:         result.matches,
        selectedProduct: result.exactMatch ?? null,
        extractedName:          aiData.name          ?? "",
        extractedPurveyor:      aiData.purveyor       ?? "",
        extractedInvoiceDate:   aiData.invoiceDate    ?? "",
        extractedSku:           aiData.sku            ?? "",
        extractedUnit:          resolvedUnit,
        extractedQty:           aiData.quantity != null ? String(aiData.quantity) : "1",
        extractedCostPerUnit:   aiData.costPerUnit != null ? String(aiData.costPerUnit) : "",
        extractedDepartment:    aiData.department ?? "BOH",
        extractedCogsCategoryId: aiData.cogsCategory?.id ?? "",
      });
    } catch {
      // Search failure is non-fatal — fall back to manual form
      setExtractError("Could not check product catalogue. Please review and save manually.");
    } finally {
      setSearching(false);
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
        cogsCategoryId: cogsCategoryId || undefined,
      });
      toast.success("Product added to catalogue");
      onSaved(saved);
      setSavedProductData({
        id: saved.id,
        name: saved.name,
        sku: saved.sku ?? undefined,
        unit,
        costPerUnit: parseFloat(costPerUnit),
        purveyor: purveyor.trim(),
        invoiceDate,
        department,
        cogsCategoryId,
      });
      setShowOrderPrompt(true);
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

  // ── Order prompt handlers ───────────────────────────────────────────────────

  async function handleCreateOrder() {
    if (!savedProductData) return;
    setCreatingOrder(true);
    try {
      await ordersApi.create({
        purveyor:    savedProductData.purveyor    || undefined,
        invoiceDate: savedProductData.invoiceDate || undefined,
        department:  savedProductData.department  || undefined,
        items: [{
          productId:      savedProductData.id,
          productName:    savedProductData.name,
          sku:            savedProductData.sku,
          unit:           savedProductData.unit,
          quantity:       1,
          unitCost:       savedProductData.costPerUnit,
          cogsCategoryId: savedProductData.cogsCategoryId || undefined,
        }],
      });
      toast.success("Purchase order created");
      handleClose();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setCreatingOrder(false);
    }
  }

  function handleSkipOrder() {
    handleClose();
  }

  // ── Smart confirmation handlers ─────────────────────────────────────────────

  async function handleSmartSave() {
    if (!smartConfirm) return;

    const {
      selectedProduct, matchType,
      extractedName, extractedPurveyor, extractedInvoiceDate, extractedSku,
      extractedUnit, extractedQty, extractedCostPerUnit,
      extractedDepartment, extractedCogsCategoryId,
    } = smartConfirm;

    const qty  = parseFloat(extractedQty)       || 0;
    const cost = parseFloat(extractedCostPerUnit) || 0;

    if (qty  <= 0) { toast.error("Quantity must be greater than 0");  return; }
    if (cost <= 0) { toast.error("Cost per unit must be greater than 0"); return; }

    const isNew = matchType === "none" || selectedProduct === null;

    setSaving(true);
    try {
      let productId:   string;
      let productName: string;
      let productSku:  string | undefined;

      if (isNew) {
        // Create product with currentStock=0; receiveOrder will set it via StockLog
        const newProduct = await productsApi.create({
          name:          extractedName,
          sku:           extractedSku  || undefined,
          purveyor:      extractedPurveyor || undefined,
          invoiceDate:   extractedInvoiceDate || undefined,
          department:    extractedDepartment,
          unit:          extractedUnit,
          costPerUnit:   cost,
          currentStock:  0,
          minimumStock:  0,
          cogsCategoryId: extractedCogsCategoryId || undefined,
        });
        productId   = newProduct.id;
        productName = newProduct.name;
        productSku  = newProduct.sku ?? undefined;
        onSaved(newProduct); // refresh ProductList
      } else {
        productId   = selectedProduct.id;
        productName = selectedProduct.name;
        productSku  = selectedProduct.sku ?? undefined;
      }

      // Create order (PENDING), then receive → stock update via weighted-avg StockLog
      const order = await ordersApi.create({
        purveyor:    extractedPurveyor    || undefined,
        invoiceDate: extractedInvoiceDate || undefined,
        department:  extractedDepartment  || undefined,
        items: [{
          productId,
          productName,
          sku:            productSku,
          unit:           extractedUnit,
          quantity:       qty,
          unitCost:       cost,
          cogsCategoryId: extractedCogsCategoryId || undefined,
        }],
      });
      await ordersApi.receive(order.id);

      const supplier = extractedPurveyor ? ` (${extractedPurveyor})` : "";
      toast.success(
        isNew
          ? `"${productName}" added + order received${supplier}`
          : `Order received for "${productName}"${supplier}`
      );
      handleClose();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  }

  // ── Batch handlers ─────────────────────────────────────────────────────────

  function addToBatch() {
    if (!smartConfirm) return;

    const {
      selectedProduct, matchType,
      extractedName, extractedPurveyor, extractedInvoiceDate, extractedSku,
      extractedUnit, extractedQty, extractedCostPerUnit,
      extractedDepartment, extractedCogsCategoryId,
    } = smartConfirm;

    const qty  = parseFloat(extractedQty)        || 0;
    const cost = parseFloat(extractedCostPerUnit) || 0;
    if (qty  <= 0) { toast.error("Quantity must be greater than 0");  return; }
    if (cost <= 0) { toast.error("Cost per unit must be greater than 0"); return; }

    const isNew = matchType === "none" || selectedProduct === null;
    const item: BatchItem = {
      _batchId:    `b-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      productName: isNew ? extractedName : selectedProduct!.name,
      purveyor:    extractedPurveyor,
      invoiceDate: extractedInvoiceDate,
      qty,
      unitCost:    cost,
      unit:        extractedUnit,
      department:  extractedDepartment,
      cogsCategoryId: extractedCogsCategoryId,
      productId:   isNew ? null : selectedProduct!.id,
      ...(isNew ? {
        newProductData: {
          name:          extractedName,
          sku:           extractedSku  || undefined,
          purveyor:      extractedPurveyor  || undefined,
          invoiceDate:   extractedInvoiceDate || undefined,
          department:    extractedDepartment,
          unit:          extractedUnit,
          costPerUnit:   cost,
          currentStock:  0,
          minimumStock:  0,
          cogsCategoryId: extractedCogsCategoryId || undefined,
        },
      } : {}),
    };

    setBatch(prev => {
      const next = [...prev, item];
      toast.success(`Added to batch (${next.length} total)`);
      return next;
    });
    resetScanState(); // keep modal open, restart camera
  }

  async function submitBatch() {
    if (batch.length === 0) return;
    setSubmittingBatch(true);
    try {
      for (const item of batch) {
        let productId = item.productId;

        // Create new product if needed
        if (productId === null && item.newProductData) {
          const newProd = await productsApi.create(item.newProductData);
          productId = newProd.id;
          onSaved(newProd);
        }

        await ordersApi.create({
          purveyor:    item.purveyor    || undefined,
          invoiceDate: item.invoiceDate || undefined,
          department:  item.department  || undefined,
          items: [{
            productId:      productId!,
            productName:    item.productName,
            unit:           item.unit,
            quantity:       item.qty,
            unitCost:       item.unitCost,
            cogsCategoryId: item.cogsCategoryId || undefined,
          }],
        });
        // No ordersApi.receive() — stays PENDING for manual review in Invoices
      }

      const totalQty  = batch.reduce((s, i) => s + i.qty, 0);
      const totalCost = batch.reduce((s, i) => s + i.qty * i.unitCost, 0);
      toast.success(
        `Batch submitted: ${batch.length} order${batch.length !== 1 ? "s" : ""}, ` +
        `${totalQty} items, $${totalCost.toFixed(2)} total. Review in Invoices.`
      );
      stopCamera();
      resetAll();
      onClose();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSubmittingBatch(false);
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
    <>
    {/* ── Mobile fullscreen camera overlay (hidden on md+) ───────────────────── */}
    {!capturedImage && (
      <div className="fixed inset-0 z-[60] md:hidden bg-black flex flex-col">
        {/* Video — fills the whole screen */}
        <div className="relative flex-1 overflow-hidden">
          <video
            ref={mobileVideoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />
          {/* Hidden canvas for capture */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Corner brackets */}
          {!cameraError && cameraReady && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-20 left-6 w-10 h-10 border-t-2 border-l-2 border-[#3dbf8a] rounded-tl" />
              <div className="absolute top-20 right-6 w-10 h-10 border-t-2 border-r-2 border-[#3dbf8a] rounded-tr" />
              <div className="absolute bottom-36 left-6 w-10 h-10 border-b-2 border-l-2 border-[#3dbf8a] rounded-bl" />
              <div className="absolute bottom-36 right-6 w-10 h-10 border-b-2 border-r-2 border-[#3dbf8a] rounded-br" />
            </div>
          )}

          {/* Loading */}
          {!cameraError && !cameraReady && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner size="md" />
            </div>
          )}

          {/* Error */}
          {cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-[13px] text-red-400">{cameraError}</p>
              <button onClick={startCamera}
                className="text-[13px] px-4 py-2 rounded-lg bg-[#1a1a1a] text-[#888] hover:text-white transition-colors">
                Try again
              </button>
            </div>
          )}
        </div>

        {/* Top bar: close + title */}
        <div className="absolute top-0 inset-x-0 flex items-center justify-between px-4 pt-12 pb-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
          <div className="flex items-center gap-2 pointer-events-none">
            <div className="w-6 h-6 rounded-lg bg-[#3dbf8a]/20 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-[#3dbf8a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <span className="text-white text-[14px] font-semibold">Scan Invoice</span>
          </div>
          <button
            onClick={handleClose}
            className="pointer-events-auto w-9 h-9 flex items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Bottom bar: Capture + Upload */}
        <div className="absolute bottom-0 inset-x-0 flex flex-col items-center gap-3 pb-12 pt-16 bg-gradient-to-t from-black/90 to-transparent">
          <button
            type="button"
            onClick={capture}
            disabled={!cameraReady || !!cameraError}
            className="flex items-center gap-2 px-8 py-3.5 rounded-2xl bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[15px] font-bold transition-colors shadow-lg"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3" strokeWidth={2} />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            </svg>
            Capture
          </button>
          <label className="flex items-center gap-1.5 text-[13px] text-[#888] hover:text-white cursor-pointer transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Upload from gallery
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                stopCamera();
                const reader = new FileReader();
                reader.onload = (ev) => {
                  const dataUrl = ev.target?.result as string;
                  setCapturedImage(dataUrl);
                  extractFromImage(dataUrl);
                };
                reader.readAsDataURL(file);
              }}
            />
          </label>
        </div>
      </div>
    )}

    {/* ── Main modal panel (desktop always; mobile only after capture) ──────── */}
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${!capturedImage ? 'hidden md:flex' : 'flex'}`}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-5xl bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl shadow-2xl flex flex-col max-h-[94vh] overflow-hidden">
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
          <div className="flex items-center gap-2">
            {/* Batch chip — visible when items are queued */}
            {batch.length > 0 && (
              <button
                type="button"
                onClick={() => setShowBatch(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3dbf8a]/10 border border-[#3dbf8a]/30 text-[#3dbf8a] text-[12px] font-medium hover:bg-[#3dbf8a]/20 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                {batch.length} pending
              </button>
            )}
            <button
              onClick={handleClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-[#555] hover:text-white hover:bg-[#1a1a1a] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body — stacked on mobile, two columns on md+ */}
        <div className="flex flex-col md:flex-row flex-1 min-h-0 divide-y divide-[#1a1a1a] md:divide-y-0 md:divide-x overflow-y-auto md:overflow-hidden">

          {/* TOP / LEFT: Camera */}
          <div className="md:w-[42%] flex-shrink-0 flex flex-col p-4 md:p-5 gap-3 md:gap-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#444]">
              Camera
            </p>

            {/* Viewfinder — fixed height on mobile, flexible on desktop */}
            <div className="relative h-[220px] md:h-auto md:flex-1 md:min-h-0 rounded-xl overflow-hidden bg-[#111] border border-[#1a1a1a] flex items-center justify-center">
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
              {capturedImage && (extracting || searching) && (
                <div
                  role="status"
                  aria-live="polite"
                  className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-3"
                >
                  <Spinner size="md" />
                  <p className="text-[12px] text-[#3dbf8a] font-medium">
                    {extracting ? "Analysing invoice…" : "Matching product…"}
                  </p>
                  {extracting && (
                    <button
                      type="button"
                      onClick={() => {
                        invoiceScan.cancelPolling();
                        setExtracting(false);
                        setExtractError("Scan cancelled.");
                      }}
                      aria-label="Cancel scan"
                      className="mt-1 px-3 py-1.5 text-[11px] font-medium text-[#aaa] border border-[#3a3a3a] rounded-lg hover:text-white hover:border-[#555] transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Hidden canvas for capture */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Camera controls */}
            <div className="flex gap-2 flex-shrink-0 flex-wrap">
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

            {/* File-capture fallback — always available as alternative to live camera */}
            {!capturedImage && (
              <label className="flex items-center justify-center gap-1.5 min-h-[36px] px-3 rounded-xl border border-dashed border-[#2a2a2a] text-[12px] text-[#555] hover:text-[#888] hover:border-[#3a3a3a] cursor-pointer transition-colors flex-shrink-0">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Upload photo
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    stopCamera();
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const dataUrl = ev.target?.result as string;
                      setCapturedImage(dataUrl);
                      extractFromImage(dataUrl);
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
            )}

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

          {/* BOTTOM / RIGHT: Form */}
          <div className="flex-1 flex flex-col md:min-h-0">
            <form
              onSubmit={handleSubmit}
              className="flex-1 md:overflow-y-auto p-4 md:p-5 space-y-4"
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

                {/* COGS Category — suggestion badge sits beside the label rendered by CogsCategorySelect */}
                <div className="col-span-2 relative">
                  {suggestedCogsCategoryName && (
                    <span className="absolute right-0 top-0 text-[10px] text-[#3dbf8a] font-medium">
                      Suggested: {suggestedCogsCategoryName}
                    </span>
                  )}
                  <CogsCategorySelect
                    value={cogsCategoryId}
                    onChange={id => setCogsCategoryId(id ?? "")}
                    label="COGS Category"
                    className="w-full px-3 py-2 rounded-lg border border-[#2a2a2a] bg-[#111] text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#3dbf8a] focus:border-[#3dbf8a] transition-colors"
                  />
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

        {/* ── Smart confirmation overlay — shown after AI extraction + search ── */}
        {smartConfirm && (
          <div className="absolute inset-0 z-10 bg-[#0a0a0a]/95 backdrop-blur-sm flex items-center justify-center p-4 rounded-2xl overflow-y-auto">
            <div className="w-full max-w-sm space-y-4 py-2">

              {/* Match status badge */}
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  smartConfirm.matchType === "none" ? "bg-amber-400/10" : "bg-[#3dbf8a]/10"
                }`}>
                  {smartConfirm.matchType === "none" ? (
                    <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 4v16m8-8H4" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-[#3dbf8a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-white">
                    {smartConfirm.matchType === "exact"    && "Product Found"}
                    {smartConfirm.matchType === "multiple" && `${smartConfirm.matches.length} Matches — Select One`}
                    {smartConfirm.matchType === "none"     && "New Product"}
                  </h3>
                  <p className="text-[11px] text-[#555]">
                    {smartConfirm.matchType === "exact"    && `"${smartConfirm.selectedProduct!.name}" — order will update stock`}
                    {smartConfirm.matchType === "multiple" && "Multiple products match the scanned name"}
                    {smartConfirm.matchType === "none"     && "Will be added to your catalogue"}
                  </p>
                </div>
              </div>

              {/* Multiple-match picker */}
              {smartConfirm.matchType === "multiple" && (
                <div className="space-y-1">
                  {smartConfirm.matches.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSmartConfirm((s) => s && ({ ...s, selectedProduct: p }))}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-[13px] border transition-colors ${
                        smartConfirm.selectedProduct?.id === p.id
                          ? "bg-[#3dbf8a]/10 border-[#3dbf8a] text-white"
                          : "bg-[#111] border-[#1a1a1a] text-[#888] hover:text-white hover:border-[#2a2a2a]"
                      }`}
                    >
                      {p.name}
                      {p.sku && <span className="ml-2 text-[10px] text-[#444]">SKU: {p.sku}</span>}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSmartConfirm((s) => s && ({ ...s, matchType: "none", selectedProduct: null }))}
                    className="w-full text-left px-3 py-2 rounded-lg text-[12px] border border-dashed border-[#2a2a2a] text-[#555] hover:text-[#3dbf8a] hover:border-[#3dbf8a] transition-colors"
                  >
                    + Add as new product instead
                  </button>
                </div>
              )}

              {/* Extracted data — editable qty + cost */}
              <div className="rounded-xl border border-[#1a1a1a] bg-[#111] divide-y divide-[#1a1a1a] text-[12px]">
                <div className="flex justify-between items-center px-4 py-2.5">
                  <span className="text-[#555]">Product</span>
                  <span className="text-white font-medium truncate max-w-[60%] text-right">
                    {smartConfirm.matchType !== "none" && smartConfirm.selectedProduct
                      ? smartConfirm.selectedProduct.name
                      : smartConfirm.extractedName || <span className="italic text-[#444]">unknown</span>}
                  </span>
                </div>
                {smartConfirm.extractedPurveyor && (
                  <div className="flex justify-between items-center px-4 py-2.5">
                    <span className="text-[#555]">Supplier</span>
                    <span className="text-white">{smartConfirm.extractedPurveyor}</span>
                  </div>
                )}
                <div className="flex justify-between items-center px-4 py-2">
                  <span className="text-[#555] flex-shrink-0 mr-3">Qty</span>
                  <input
                    type="text" inputMode="decimal"
                    value={smartConfirm.extractedQty}
                    onChange={(e) => setSmartConfirm((s) => s && ({ ...s, extractedQty: e.target.value }))}
                    className="w-24 text-right px-2 py-1 rounded-md border border-[#2a2a2a] bg-[#0a0a0a] text-white text-[12px] focus:outline-none focus:border-[#3dbf8a] transition-colors"
                  />
                </div>
                <div className="flex justify-between items-center px-4 py-2">
                  <span className="text-[#555] flex-shrink-0 mr-3">Cost / unit</span>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#555] text-[12px]">$</span>
                    <input
                      type="text" inputMode="decimal"
                      value={smartConfirm.extractedCostPerUnit}
                      onChange={(e) => setSmartConfirm((s) => s && ({ ...s, extractedCostPerUnit: e.target.value }))}
                      className="w-24 text-right pl-5 pr-2 py-1 rounded-md border border-[#2a2a2a] bg-[#0a0a0a] text-white text-[12px] focus:outline-none focus:border-[#3dbf8a] transition-colors"
                      placeholder="0.00"
                    />
                  </div>
                </div>
                {(() => {
                  const qty  = parseFloat(smartConfirm.extractedQty)       || 0;
                  const cost = parseFloat(smartConfirm.extractedCostPerUnit) || 0;
                  if (qty > 0 && cost > 0) return (
                    <div className="flex justify-between items-center px-4 py-2.5">
                      <span className="text-[#555]">Total</span>
                      <span className="text-[#3dbf8a] font-semibold">${(qty * cost).toFixed(2)}</span>
                    </div>
                  );
                  return null;
                })()}
              </div>

              {/* New-product note */}
              {smartConfirm.matchType === "none" && (
                <p className="text-[11px] text-amber-400/80 bg-amber-400/5 border border-amber-400/15 rounded-lg px-3 py-2 leading-relaxed">
                  New product will be created and order received immediately. Stock will be set to the quantity above.
                </p>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSmartConfirm(null)}
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-xl border border-[#2a2a2a] text-[13px] text-[#666] hover:text-white hover:border-[#3a3a3a] disabled:opacity-50 transition-colors"
                >
                  Edit manually
                </button>
                <button
                  type="button"
                  onClick={addToBatch}
                  disabled={
                    saving ||
                    (smartConfirm.matchType === "multiple" && !smartConfirm.selectedProduct)
                  }
                  className="flex-1 py-2.5 rounded-xl bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-50 text-white text-[13px] font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  {saving && <Spinner size="sm" />}
                  Add to Batch{batch.length > 0 ? ` (${batch.length + 1})` : ""}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Batch review overlay ─────────────────────────────────────────────── */}
        {showBatch && (
          <div className="absolute inset-0 z-20 bg-[#0a0a0a] flex flex-col rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#1a1a1a] flex-shrink-0">
              <div>
                <h3 className="text-[15px] font-semibold text-white">Pending Batch</h3>
                <p className="text-[11px] text-[#555]">
                  {batch.length} item{batch.length !== 1 ? "s" : ""} ·{" "}
                  ${batch.reduce((s, i) => s + i.qty * i.unitCost, 0).toFixed(2)} total
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setShowBatch(false); setEditingBatchId(null); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2a2a2a] text-[12px] text-[#666] hover:text-white hover:border-[#3a3a3a] transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Scan More
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {batch.length === 0 ? (
                <p className="text-[13px] text-[#444] text-center py-8">No items yet. Go back and scan an invoice.</p>
              ) : batch.map((item) => (
                <div
                  key={item._batchId}
                  className="rounded-xl border border-[#1a1a1a] bg-[#0d0d0d] overflow-hidden"
                >
                  {editingBatchId === item._batchId ? (
                    /* ── Inline edit mode ── */
                    <div className="px-4 py-3 space-y-3">
                      <p className="text-[13px] font-medium text-white">{item.productName}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] text-[#555] mb-1">Qty</label>
                          <input
                            type="text" inputMode="decimal"
                            value={editQty}
                            onChange={(e) => setEditQty(e.target.value)}
                            className="w-full px-2 py-1.5 rounded-lg border border-[#2a2a2a] bg-[#111] text-white text-[13px] focus:outline-none focus:border-[#3dbf8a] transition-colors"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-[#555] mb-1">Cost / unit</label>
                          <input
                            type="text" inputMode="decimal"
                            value={editCost}
                            onChange={(e) => setEditCost(e.target.value)}
                            className="w-full px-2 py-1.5 rounded-lg border border-[#2a2a2a] bg-[#111] text-white text-[13px] focus:outline-none focus:border-[#3dbf8a] transition-colors"
                          />
                        </div>
                      </div>
                      {(() => {
                        const q = parseFloat(editQty) || 0;
                        const c = parseFloat(editCost) || 0;
                        return q > 0 && c > 0
                          ? <p className="text-[11px] text-[#3dbf8a]">Subtotal: ${(q * c).toFixed(2)}</p>
                          : null;
                      })()}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingBatchId(null)}
                          className="flex-1 py-1.5 rounded-lg border border-[#2a2a2a] text-[12px] text-[#666] hover:text-white transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const q = parseFloat(editQty) || 0;
                            const c = parseFloat(editCost) || 0;
                            if (q <= 0 || c <= 0) { toast.error("Qty and cost must be > 0"); return; }
                            setBatch(prev => prev.map(x =>
                              x._batchId === item._batchId ? { ...x, qty: q, unitCost: c } : x
                            ));
                            setEditingBatchId(null);
                          }}
                          className="flex-1 py-1.5 rounded-lg bg-[#3dbf8a] text-white text-[12px] font-semibold transition-colors"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── Display mode ── */
                    <div className="flex items-center gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-white truncate">{item.productName}</p>
                        <p className="text-[11px] text-[#555]">
                          {item.purveyor || "—"} · {item.qty} × ${item.unitCost.toFixed(2)}
                        </p>
                      </div>
                      <span className="text-[13px] font-semibold text-[#3dbf8a] flex-shrink-0">
                        ${(item.qty * item.unitCost).toFixed(2)}
                      </span>
                      <div className="flex gap-1 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingBatchId(item._batchId);
                            setEditQty(String(item.qty));
                            setEditCost(String(item.unitCost));
                          }}
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-[#555] hover:text-white hover:bg-[#1a1a1a] transition-colors"
                          aria-label="Edit"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setBatch(prev => prev.filter(x => x._batchId !== item._batchId));
                            toast.success("Removed from batch");
                          }}
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-[#555] hover:text-red-400 hover:bg-red-400/10 transition-colors"
                          aria-label="Remove"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="border-t border-[#1a1a1a] px-5 py-4 space-y-3 flex-shrink-0">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-[#555]">
                  {batch.length} order{batch.length !== 1 ? "s" : ""} ·{" "}
                  {batch.reduce((s, i) => s + i.qty, 0)} items
                </span>
                <span className="text-white font-semibold">
                  ${batch.reduce((s, i) => s + i.qty * i.unitCost, 0).toFixed(2)}
                </span>
              </div>
              <p className="text-[10px] text-[#444] leading-relaxed">
                Orders will be created as <span className="text-[#666]">Pending</span>. Go to Invoices to mark each received and update stock.
              </p>
              <button
                type="button"
                onClick={submitBatch}
                disabled={submittingBatch || batch.length === 0}
                className="w-full py-2.5 rounded-xl bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-50 text-white text-[13px] font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {submittingBatch && <Spinner size="sm" />}
                {submittingBatch ? "Submitting…" : `Submit Batch (${batch.length})`}
              </button>
            </div>
          </div>
        )}

        {/* ── Order prompt overlay — shown after product is saved (manual path) ── */}
        {showOrderPrompt && savedProductData && (
          <div className="absolute inset-0 z-10 bg-[#0a0a0a]/95 backdrop-blur-sm flex items-center justify-center p-6 rounded-2xl">
            <div className="w-full max-w-sm space-y-5">
              {/* Icon + title */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#3dbf8a]/10 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-[#3dbf8a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-white">Create Purchase Order?</h3>
                  <p className="text-[11px] text-[#555]">Record this as a financial transaction</p>
                </div>
              </div>

              {/* Summary */}
              <div className="rounded-xl border border-[#1a1a1a] bg-[#111] divide-y divide-[#1a1a1a] text-[12px]">
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-[#555]">Product</span>
                  <span className="text-white font-medium truncate max-w-[55%] text-right">{savedProductData.name}</span>
                </div>
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-[#555]">Supplier</span>
                  <span className="text-white">{savedProductData.purveyor || <span className="text-[#444] italic">not set</span>}</span>
                </div>
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-[#555]">Unit cost</span>
                  <span className="text-white">${savedProductData.costPerUnit.toFixed(2)}</span>
                </div>
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-[#555]">Date</span>
                  <span className="text-white">{savedProductData.invoiceDate || <span className="text-[#444] italic">not set</span>}</span>
                </div>
              </div>

              <p className="text-[11px] text-[#444] leading-relaxed">
                The order will be saved as <span className="text-[#888]">Pending</span>. Go to Invoices to mark it received once delivered.
              </p>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSkipOrder}
                  disabled={creatingOrder}
                  className="flex-1 py-2.5 rounded-xl border border-[#2a2a2a] text-[13px] text-[#666] hover:text-white hover:border-[#3a3a3a] disabled:opacity-50 transition-colors"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={handleCreateOrder}
                  disabled={creatingOrder}
                  className="flex-1 py-2.5 rounded-xl bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-50 text-white text-[13px] font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  {creatingOrder && <Spinner size="sm" />}
                  Create Order
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  </>
  );
}
