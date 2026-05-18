export interface User {
  id: string;
  email: string;
  role: "ADMIN" | "STAFF";
  restaurantId: string;
}

export type Unit = "KG" | "LITERS" | "PIECES";
export type StockReason = "RECEIVED" | "USED" | "ADJUSTED" | "WASTE";
export type OrderStatus = "PENDING" | "RECEIVED" | "CANCELLED";

export interface Product {
  id: string;
  name: string;
  sku?: string;
  category?: string;
  unit: Unit;
  costPerUnit: number;
  currentStock: number;
  minimumStock: number;
  restaurantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface StockLog {
  id: string;
  productId: string;
  product?: Product;
  previousQuantity: number;
  newQuantity: number;
  change: number;
  reason: StockReason;
  timestamp: string;
  userId: string;
  user?: { id: string; email: string; role: string };
  notes?: string;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  product?: Product;
  quantity: number;
  unitCost: number;
}

export interface Order {
  id: string;
  restaurantId: string;
  status: OrderStatus;
  totalCost: number;
  createdAt: string;
  deliveredAt?: string;
  orderItems: OrderItem[];
}

export interface StockReport {
  totalProducts: number;
  totalValue: number;
  belowMinimumCount: number;
  belowMinimum: Product[];
  byCategory: Record<string, { count: number; value: number }>;
}

export interface DailyReport {
  date: string;
  received: number;
  used: number;
  waste: number;
  adjusted: number;
  inventoryValue: number;
  lowItemsCount: number;
  lowItems: Product[];
  logs: StockLog[];
}

export interface WeeklyTrendDay {
  date: string;
  received: number;
  used: number;
  waste: number;
}

export interface MostUsedEntry {
  productId: string;
  productName: string;
  totalUsed: number;
  unit: string;
}

export interface WeeklyReport {
  startDate: string;
  endDate: string;
  days: WeeklyTrendDay[];
  mostUsed: MostUsedEntry[];
  inventoryValue: number;
  lowItemsCount: number;
  totalReceived: number;
  totalUsed: number;
  totalWaste: number;
}
