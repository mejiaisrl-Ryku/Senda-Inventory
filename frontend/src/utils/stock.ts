import { Product, Unit } from "../types";

export type StockStatus = "adequate" | "low" | "critical";

export function getStockStatus(product: Product): StockStatus {
  const { currentStock, minimumStock } = product;
  if (minimumStock === 0) return currentStock > 0 ? "adequate" : "critical";
  if (currentStock < minimumStock * 0.5) return "critical";
  if (currentStock < minimumStock) return "low";
  return "adequate";
}

export const statusStyles = {
  adequate: {
    badge: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
    border: "border-green-200 dark:border-green-800",
    bar: "bg-green-500",
    dot: "bg-green-500",
    label: "Adequate",
  },
  low: {
    badge: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400",
    border: "border-yellow-300 dark:border-yellow-700",
    bar: "bg-yellow-400",
    dot: "bg-yellow-400",
    label: "Low",
  },
  critical: {
    badge: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
    border: "border-red-300 dark:border-red-700",
    bar: "bg-red-500",
    dot: "bg-red-500",
    label: "Critical",
  },
} as const;

export function stockBarPercent(product: Product): number {
  const { currentStock, minimumStock } = product;
  const cap = minimumStock > 0 ? minimumStock * 2 : 100;
  return Math.min(100, Math.round((currentStock / cap) * 100));
}

export const unitLabel: Record<Unit, string> = {
  KG: "kg",
  LITERS: "L",
  PIECES: "pcs",
};

export function formatCurrency(n: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

export function formatDate(iso: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}
