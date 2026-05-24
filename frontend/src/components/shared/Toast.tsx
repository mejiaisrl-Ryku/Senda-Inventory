import React, { useEffect, useState } from "react";
import { Toast as ToastType, ToastType as TType, useToasts, useToast } from "../../context/ToastContext";

const styles: Record<TType, { container: string; icon: JSX.Element }> = {
  success: {
    container:
      "bg-white dark:bg-gray-800 border-l-4 border-brand-500 shadow-lg",
    icon: (
      <svg className="w-5 h-5 text-brand-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  error: {
    container:
      "bg-white dark:bg-gray-800 border-l-4 border-red-500 shadow-lg",
    icon: (
      <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  warning: {
    container:
      "bg-white dark:bg-gray-800 border-l-4 border-yellow-400 shadow-lg",
    icon: (
      <svg className="w-5 h-5 text-yellow-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
    ),
  },
  info: {
    container:
      "bg-white dark:bg-gray-800 border-l-4 border-brand-500 shadow-lg",
    icon: (
      <svg className="w-5 h-5 text-brand-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
};

function ToastItem({ toast }: { toast: ToastType }) {
  const { dismiss } = useToast();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Mount animation
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const s = styles[toast.type];

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-xl min-w-[280px] max-w-sm w-full pointer-events-auto transition-all duration-300 ${s.container} ${
        visible ? "translate-x-0 opacity-100" : "translate-x-8 opacity-0"
      }`}
    >
      {s.icon}
      <p className="flex-1 text-sm text-gray-800 dark:text-gray-200 leading-snug">
        {toast.message}
      </p>
      <button
        onClick={() => dismiss(toast.id)}
        className="flex-shrink-0 text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-300 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToasts();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
