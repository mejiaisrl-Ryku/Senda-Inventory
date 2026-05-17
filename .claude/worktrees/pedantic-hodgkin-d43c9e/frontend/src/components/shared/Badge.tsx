import React from "react";
import { StockStatus, statusStyles } from "../../utils/stock";

interface BadgeProps {
  status: StockStatus;
  className?: string;
}

export function StockBadge({ status, className = "" }: BadgeProps) {
  const s = statusStyles[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${s.badge} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

interface PillProps {
  children: React.ReactNode;
  color?: "gray" | "blue" | "green" | "yellow" | "red";
  className?: string;
}

const pillColors = {
  gray: "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300",
  blue: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
  green: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
  yellow: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400",
  red: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
};

export function Pill({ children, color = "gray", className = "" }: PillProps) {
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${pillColors[color]} ${className}`}>
      {children}
    </span>
  );
}
