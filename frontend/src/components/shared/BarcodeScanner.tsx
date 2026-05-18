import React, { useEffect, useRef, useState, FormEvent } from "react";

// BarcodeDetector is available in Chrome/Android 83+. We type it manually
// since it's not yet in the standard TypeScript lib.
interface BarcodeDet {
  detect(source: HTMLVideoElement | ImageBitmap): Promise<Array<{ rawValue: string }>>;
}
declare const BarcodeDetector: {
  new(opts?: { formats?: string[] }): BarcodeDet;
  getSupportedFormats?(): Promise<string[]>;
} | undefined;

const FORMATS = ["ean_13", "ean_8", "code_128", "qr_code", "code_39", "upc_a", "upc_e", "data_matrix"];

interface BarcodeScannerProps {
  onScan: (code: string) => void;
  onClose: () => void;
}

export function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const lastDetectRef = useRef<number>(0);

  const [status, setStatus] = useState<"starting" | "scanning" | "error" | "unsupported">("starting");
  const [errorMsg, setErrorMsg] = useState("");
  const [manualSku, setManualSku] = useState("");

  const isSupported = typeof BarcodeDetector !== "undefined";

  function stopCamera() {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    if (!isSupported) {
      setStatus("unsupported");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStatus("scanning");
        startDetectionLoop();
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = (err as Error)?.message ?? "";
          setErrorMsg(
            msg.includes("Permission") || msg.includes("NotAllowed")
              ? "Camera permission denied. Enter the SKU manually."
              : "Camera unavailable. Enter the SKU manually."
          );
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startDetectionLoop() {
    const detector = new BarcodeDetector!({ formats: FORMATS });

    function detect(timestamp: number) {
      // Cap at ~10 fps to avoid hammering the detector.
      if (timestamp - lastDetectRef.current < 100) {
        rafRef.current = requestAnimationFrame(detect);
        return;
      }
      lastDetectRef.current = timestamp;

      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(detect);
        return;
      }

      detector
        .detect(video)
        .then((results) => {
          if (results.length > 0) {
            stopCamera();
            onScan(results[0].rawValue);
          } else {
            rafRef.current = requestAnimationFrame(detect);
          }
        })
        .catch(() => {
          rafRef.current = requestAnimationFrame(detect);
        });
    }

    rafRef.current = requestAnimationFrame(detect);
  }

  // File input fallback: user takes a photo, we run BarcodeDetector on the image.
  async function handleFileCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isSupported) return;

    try {
      const bitmap = await createImageBitmap(file);
      const detector = new BarcodeDetector!({ formats: FORMATS });
      const results = await detector.detect(bitmap);
      bitmap.close();
      if (results.length > 0) {
        onScan(results[0].rawValue);
      } else {
        setErrorMsg("No barcode found in photo. Try again or enter SKU manually.");
      }
    } catch {
      setErrorMsg("Could not read barcode from photo.");
    }
  }

  function handleManualSubmit(e: FormEvent) {
    e.preventDefault();
    if (manualSku.trim()) onScan(manualSku.trim());
  }

  return (
    <div className="space-y-4">
      {/* Camera view */}
      {isSupported && status !== "error" && (
        <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            autoPlay
            playsInline
            muted
          />
          {status === "starting" && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-sm">
              Starting camera…
            </div>
          )}
          {status === "scanning" && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              {/* Scan frame overlay */}
              <div className="w-56 h-32 border-2 border-white/70 rounded-lg relative">
                <span className="absolute -top-px left-3 w-6 h-0.5 bg-brand-400" />
                <span className="absolute -top-px right-3 w-6 h-0.5 bg-brand-400" />
                <span className="absolute -bottom-px left-3 w-6 h-0.5 bg-brand-400" />
                <span className="absolute -bottom-px right-3 w-6 h-0.5 bg-brand-400" />
                <span className="absolute top-3 -left-px h-6 w-0.5 bg-brand-400" />
                <span className="absolute bottom-3 -left-px h-6 w-0.5 bg-brand-400" />
                <span className="absolute top-3 -right-px h-6 w-0.5 bg-brand-400" />
                <span className="absolute bottom-3 -right-px h-6 w-0.5 bg-brand-400" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error or unsupported */}
      {(status === "error" || status === "unsupported") && (
        <div className="rounded-xl bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-4 text-sm text-yellow-700 dark:text-yellow-400">
          {status === "unsupported"
            ? "Live scanning is not supported in this browser. Take a photo or enter the SKU below."
            : errorMsg}
        </div>
      )}

      {/* File capture fallback — works on iOS via camera roll */}
      {(status === "error" || status === "unsupported") && isSupported && (
        <label className="flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 text-sm text-gray-500 dark:text-gray-400 cursor-pointer hover:border-brand-400 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Take a photo to scan
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={handleFileCapture} />
        </label>
      )}

      {/* Manual SKU input — always shown */}
      <form onSubmit={handleManualSubmit} className="flex gap-2">
        <input
          value={manualSku}
          onChange={(e) => setManualSku(e.target.value)}
          placeholder="Enter SKU manually…"
          className="flex-1 min-h-[44px] px-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-base focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          type="submit"
          disabled={!manualSku.trim()}
          className="min-h-[44px] px-4 rounded-xl bg-brand-500 text-white text-sm font-medium disabled:opacity-50 hover:bg-brand-600 transition-colors"
        >
          Use
        </button>
      </form>

      <button
        onClick={() => { stopCamera(); onClose(); }}
        className="w-full min-h-[44px] rounded-xl border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}
