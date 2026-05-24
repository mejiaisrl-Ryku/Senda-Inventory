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
    badge: "bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400",
    border: "border-brand-100 dark:border-brand-900",
    bar: "bg-brand-500",
    dot: "bg-brand-500",
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
  LB: "lb",
  OZ: "oz",
  G: "g",
  EA: "ea",
  DOZ: "doz",
  CS: "cs",
};

export function formatCurrency(n: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

export function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}
