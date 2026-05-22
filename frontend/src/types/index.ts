export interface User {
  id: string;
  name?: string;
  email: string;
  role: "ADMIN" | "STAFF";
  restaurantId: string;
  restaurantName?: string;
}

export type Unit = "KG" | "LITERS" | "PIECES" | "LB" | "OZ" | "G" | "EA" | "DOZ";
export type Department = "BOH" | "FOH" | "BAR" | "BOTH";
export type StockReason = "RECEIVED" | "USED" | "ADJUSTED" | "WASTE";
export type OrderStatus = "PENDING" | "RECEIVED" | "CANCELLED";
export type SalesCategory = "BEER" | "LIQUOR" | "WINE" | "FOOD" | "NON_ALCOHOLIC" | "EVENTS" | "DELIVERY" | "BUYOUTS";

export interface SalesEntry {
  id: string;
  restaurantId: string;
  /** ISO string from @db.Date — always midnight UTC, e.g. "2025-05-19T00:00:00.000Z" */
  date: string;
  category: SalesCategory;
  amount: number;
  notes?: string | null;
  createdAt: string;
}

export interface LaborEntry {
  id: string;
  restaurantId: string;
  /** ISO string from @db.Date */
  date: string;
  fohLabor: number;
  bohLabor: number;
  management: number;
  total: number;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  sku?: string;
  category?: string;
  purveyor?: string;
  invoiceDate?: string;
  department: Department;
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

// ── COGS Report ───────────────────────────────────────────────────────────────

export interface CogsBucket {
  sales: number;
  cogs: number;
  cogsRatio: number | null; // null when sales = 0
}

export interface CogsPeriodTotals {
  sales: number;
  cogs: number;
  cogsRatio: number | null;
}

export interface CogsDay {
  date: string; // YYYY-MM-DD
  byCategory: Record<SalesCategory, CogsBucket>;
  totals: CogsPeriodTotals;
}

export interface CogsWeek {
  weekStart: string; // YYYY-MM-DD (Monday)
  byCategory: Record<SalesCategory, CogsBucket>;
  totals: CogsPeriodTotals;
}

/** Shape of the top-level `period` summary (different keys from per-day/week totals). */
export interface CogsPeriodSummary {
  totalSales: number;
  totalCOGS: number;
  cogsRatio: number | null;
}

export interface CogsReport {
  startDate: string;
  endDate: string;
  days: CogsDay[];
  weeks: CogsWeek[];
  byCategory: Record<SalesCategory, CogsPeriodSummary>;
  period: CogsPeriodSummary;
}

// ── Inventory Count ───────────────────────────────────────────────────────────

export type CountDepartment = "KITCHEN" | "BAR" | "FOH" | "ALL";
export type CountStatus     = "OPEN"    | "CLOSED";

export interface CountSession {
  id:                 string;
  restaurantId:       string;
  date:               string;
  department:         CountDepartment;
  status:             CountStatus;
  createdBy:          string;
  createdAt:          string;
  updatedAt:          string;
  /** Populated by list endpoint */
  entriesCount?:      number;
  /** Populated by list endpoint (sum of varianceValue) */
  totalVarianceValue?: number;
  /** Populated by get/:id endpoint */
  entries?:           CountEntry[];
}

export interface CountEntry {
  id:               string;
  sessionId:        string;
  productId:        string;
  product?: {
    id:         string;
    name:       string;
    sku?:       string | null;
    category?:  string | null;
    purveyor?:  string | null;
    department: string;
    unit:       string;
    costPerUnit: number;
  };
  expectedQuantity: number;
  actualQuantity:   number;
  variance:         number;
  unitCost:         number;
  varianceValue:    number;
  notes?:           string | null;
  createdAt:        string;
}

export interface CountReport {
  session: Pick<CountSession, "id" | "date" | "department" | "status" | "createdAt">;
  summary: {
    totalEntries:       number;
    totalExpectedQty:   number;
    totalActualQty:     number;
    totalExpectedValue: number;
    totalActualValue:   number;
    totalVariance:      number;
    totalVarianceValue: number;
    variancePct:        number;
    overCount:          number;
    underCount:         number;
    exactCount:         number;
  };
  byCategory: {
    category:      string;
    entryCount:    number;
    expectedValue: number;
    actualValue:   number;
    variance:      number;
    varianceValue: number;
    variancePct:   number;
  }[];
  byDepartment: { department: string; entryCount: number; variance: number; varianceValue: number }[];
  entries: (Omit<CountEntry, "product"> & {
    productName?: string;
    sku?:         string | null;
    category?:    string | null;
    purveyor?:    string | null;
    department?:  string;
    unit?:        string;
  })[];
}

export interface TeamMember {
  id: string;
  name: string | null;
  email: string;
  role: "ADMIN" | "STAFF";
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
