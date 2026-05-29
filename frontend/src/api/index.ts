import axios, { AxiosRequestConfig } from "axios";
import { Order, Product, StockLog, StockReport, StockReason, OrderStatus, DailyReport, WeeklyReport, SalesEntry, SalesCategory, LaborEntry, CogsReport, TeamMember, CountSession, CountEntry, CountDepartment, CountReport, Recipe, RecipeDepartment } from "../types";
import { cacheGet, cacheSet, cachePurge } from "../utils/offlineCache";

// Use the env var when set (Vercel / local .env.production); fall back to the
// Railway production URL so the app keeps working even if the var is missing.
const BASE =
  process.env.REACT_APP_API_URL ?? "https://senda-inventory-production.up.railway.app/api";

export const api = axios.create({
  baseURL: BASE,
  headers: { "Content-Type": "application/json" },
});

// ── Request interceptor: attach access token ──────────────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    // Use .set() — the correct axios v1.x AxiosHeaders API.
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  return config;
});

// ── Response interceptor: auto-refresh on 401 ────────────────────────────────
let isRefreshing = false;
let pendingQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = [];

function drainQueue(err: unknown, token?: string) {
  pendingQueue.forEach((p) => (err ? p.reject(err) : p.resolve(token!)));
  pendingQueue = [];
}

function clearSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("user");
  cachePurge();
}

function redirectToLogin() {
  clearSession();
  // Only redirect if we're not already on the login page to avoid redirect loops.
  if (!window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
  }
}

function cacheKey(config: AxiosRequestConfig): string {
  return `${config.url}?${JSON.stringify(config.params ?? {})}`;
}

api.interceptors.response.use(
  (r) => {
    if (r.config.method === "get" && r.config.responseType !== "blob") {
      cacheSet(cacheKey(r.config), r.data);
    }
    return r;
  },
  async (err) => {
    // err.config is undefined for requests that never left the client (e.g. cancelled).
    if (!err.config) return Promise.reject(err);

    const original: AxiosRequestConfig & { _retry?: boolean } = err.config;

    // Skip retry for auth endpoints themselves to prevent infinite loops.
    const isAuthEndpoint =
      original.url?.includes("/auth/login") ||
      original.url?.includes("/auth/register") ||
      original.url?.includes("/auth/refresh");

    // On network failure for GET requests, serve stale data from the offline cache.
    if (!err.response && original.method === "get" && !isAuthEndpoint) {
      const cached = cacheGet(cacheKey(original));
      if (cached !== null) {
        return { data: cached, status: 200, statusText: "OK (cached)", headers: {}, config: original };
      }
    }

    if (err.response?.status !== 401 || original._retry || isAuthEndpoint) {
      return Promise.reject(err);
    }

    original._retry = true;
    const storedRefresh = localStorage.getItem("refreshToken");

    if (!storedRefresh) {
      redirectToLogin();
      return Promise.reject(err);
    }

    if (isRefreshing) {
      // Queue this request until the in-flight refresh resolves.
      return new Promise<string>((resolve, reject) => {
        pendingQueue.push({ resolve, reject });
      }).then((newToken) => {
        // The request interceptor will attach the new token from localStorage;
        // also set it directly here so the retry doesn't need a round-trip.
        original.headers = {
          ...original.headers,
          Authorization: `Bearer ${newToken}`,
        };
        return api(original);
      }).catch((queueErr) => Promise.reject(queueErr));
    }

    isRefreshing = true;
    try {
      const { data } = await axios.post(`${BASE}/auth/refresh`, { refreshToken: storedRefresh });
      const { token: newToken, refreshToken: newRefresh, user } = data;
      localStorage.setItem("token", newToken);
      localStorage.setItem("refreshToken", newRefresh);
      if (user) localStorage.setItem("user", JSON.stringify(user));
      drainQueue(null, newToken);
      // Retry the original request — request interceptor will attach the new token.
      return api(original);
    } catch (refreshErr) {
      drainQueue(refreshErr);
      redirectToLogin();
      return Promise.reject(refreshErr);
    } finally {
      isRefreshing = false;
    }
  }
);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  register: (data: { name: string; email: string; password: string; restaurantName: string }) =>
    api
      .post<{ user: import("../types").User; token: string; refreshToken: string }>(
        "/auth/register",
        data
      )
      .then((r) => r.data),

  login: (email: string, password: string) =>
    api
      .post<{ user: import("../types").User; token: string; refreshToken: string }>(
        "/auth/login",
        { email, password }
      )
      .then((r) => r.data),

  refresh: (refreshToken: string) =>
    axios
      .post<{ user: import("../types").User; token: string; refreshToken: string }>(
        `${BASE}/auth/refresh`,
        { refreshToken }
      )
      .then((r) => r.data),

  logout: () => api.post("/auth/logout").then((r) => r.data),

  me: () => api.get<import("../types").User>("/auth/me").then((r) => r.data),

  forgotPassword: (email: string) =>
    api.post("/auth/forgot-password", { email }),

  resetPassword: (token: string, password: string) =>
    api.post("/auth/reset-password", { token, password }),
};

// ── Products ──────────────────────────────────────────────────────────────────
export const productsApi = {
  list: (category?: string) =>
    api.get<Product[]>("/products", { params: category ? { category } : {} }).then((r) => r.data),

  get: (id: string) => api.get<Product>(`/products/${id}`).then((r) => r.data),

  create: (data: Partial<Product>) => api.post<Product>("/products", data).then((r) => r.data),

  update: (id: string, data: Partial<Product>) =>
    api.put<Product>(`/products/${id}`, data).then((r) => r.data),

  delete: (id: string) => api.delete(`/products/${id}`),
};

// ── Stock ─────────────────────────────────────────────────────────────────────
export const stockApi = {
  adjust: (data: { productId: string; change: number; reason: StockReason; notes?: string }) =>
    api.post<StockLog>("/stock/adjust", data).then((r) => r.data),

  logs: (productId: string) =>
    api.get<StockLog[]>(`/stock/logs/${productId}`).then((r) => r.data),

  lowItems: () => api.get<Product[]>("/stock/low-items").then((r) => r.data),

  report: () => api.get<StockReport>("/stock/report").then((r) => r.data),
};

// ── Orders / Invoices ─────────────────────────────────────────────────────────
export const ordersApi = {
  create: (payload: {
    purveyor?:      string;
    invoiceDate?:   string;
    invoiceNumber?: string;
    department?:    string;
    items: {
      productName: string;
      sku?:        string;
      category?:   string;
      unit?:       string;
      quantity:    number;
      unitCost:    number;
      productId?:  string;
    }[];
  }) =>
    api.post<Order>("/orders", payload).then((r) => r.data),

  list: (status?: OrderStatus) =>
    api.get<Order[]>("/orders", { params: status ? { status } : {} }).then((r) => r.data),

  update: (id: string, data: { status?: OrderStatus }) =>
    api.put<Order>(`/orders/${id}`, data).then((r) => r.data),

  receive: (id: string) => api.post<Order>(`/orders/${id}/receive`).then((r) => r.data),
};

// ── Reports ───────────────────────────────────────────────────────────────────
export const reportsApi = {
  daily: (date?: string) =>
    api.get<DailyReport>("/reports/daily", { params: date ? { date } : {} }).then((r) => r.data),

  weekly: (startDate: string, endDate: string) =>
    api
      .get<WeeklyReport>("/reports/weekly", { params: { startDate, endDate } })
      .then((r) => r.data),

  exportCsv: (start: string, end: string) =>
    api
      .get("/reports/export", { params: { format: "csv", start, end }, responseType: "blob" })
      .then((r) => {
        const url = URL.createObjectURL(r.data as Blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `stock-report-${start}-to-${end}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }),

  exportXlsx: (start: string, end: string) =>
    api
      .get("/reports/export-xlsx", { params: { start, end }, responseType: "blob" })
      .then((r) => {
        const url = URL.createObjectURL(r.data as Blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `kyru-report-${start}-to-${end}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      }),

  cogsToSales: (startDate: string, endDate: string) =>
    api
      .get<CogsReport>("/reports/cogs-to-sales", { params: { startDate, endDate } })
      .then((r) => r.data),
};

// ── Team ──────────────────────────────────────────────────────────────────────
export const teamApi = {
  list: () => api.get<TeamMember[]>("/team").then((r) => r.data),

  invite: (data: { name: string; email: string; role?: "ADMIN" | "STAFF"; restaurantId?: string }) =>
    api.post("/team/invite", data).then((r) => r.data),

  create: (data: { name: string; email: string; password: string }) =>
    api.post<TeamMember>("/team/create", data).then((r) => r.data),

  remove: (userId: string) => api.delete(`/team/${userId}`),

  sendResetEmail: (userId: string) =>
    api.post(`/team/${userId}/send-reset-email`),

  registerViaInvite: (data: { token: string; name: string; email: string; password: string }) =>
    api
      .post<{ user: import("../types").User; token: string; refreshToken: string }>(
        "/team/register-via-invite",
        data
      )
      .then((r) => r.data),
};

// ── Sales ─────────────────────────────────────────────────────────────────────
export const salesApi = {
  create: (data: { date: string; category: SalesCategory; amount: number; notes?: string }) =>
    api.post<SalesEntry>("/sales", data).then((r) => r.data),

  list: (params?: { startDate?: string; endDate?: string; category?: SalesCategory }) =>
    api.get<SalesEntry[]>("/sales", { params }).then((r) => r.data),

  delete: (id: string) => api.delete(`/sales/${id}`),
};

// ── Counts ────────────────────────────────────────────────────────────────────
export const countsApi = {
  list: (params?: { status?: string; department?: CountDepartment }) =>
    api.get<CountSession[]>("/counts", { params }).then((r) => r.data),

  create: (data: { date: string; department: CountDepartment }) =>
    api.post<CountSession>("/counts", data).then((r) => r.data),

  get: (id: string) =>
    api.get<CountSession>(`/counts/${id}`).then((r) => r.data),

  updateEntries: (
    id: string,
    entries: { productId: string; actualQuantity: number; notes?: string }[]
  ) =>
    api.put<{ updated: number; entries: CountEntry[] }>(`/counts/${id}/entries`, { entries }).then((r) => r.data),

  close: (id: string) =>
    api.put<CountSession>(`/counts/${id}/close`).then((r) => r.data),

  report: (id: string) =>
    api.get<CountReport>(`/counts/${id}/report`).then((r) => r.data),

  exportXlsx: (id: string) =>
    api
      .get(`/counts/${id}/export-xlsx`, { responseType: "blob" })
      .then((r) => {
        const url = URL.createObjectURL(r.data as Blob);
        const a   = document.createElement("a");
        a.href     = url;
        a.download = `count-variance-report.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      }),
};

// ── Recipes ───────────────────────────────────────────────────────────────────
export const recipesApi = {
  list: (department?: RecipeDepartment) =>
    api.get<Recipe[]>("/recipes", { params: department ? { department } : {} }).then((r) => r.data),

  get: (id: string) => api.get<Recipe>(`/recipes/${id}`).then((r) => r.data),

  create: (data: {
    name: string;
    department: RecipeDepartment;
    sellingPrice: number;
    ingredients: { productId: string; quantity: number; unit: string }[];
  }) => api.post<Recipe>("/recipes", data).then((r) => r.data),

  update: (
    id: string,
    data: {
      name: string;
      department: RecipeDepartment;
      sellingPrice: number;
      ingredients: { productId: string; quantity: number; unit: string }[];
    }
  ) => api.put<Recipe>(`/recipes/${id}`, data).then((r) => r.data),

  delete: (id: string) => api.delete(`/recipes/${id}`),

  copyRecipe: (sourceRecipeId: string, sourceRestaurantId: string, targetRestaurantId: string) =>
    api.post<{ success: boolean; message: string; recipe: Recipe }>(
      "/recipes/copy",
      { sourceRecipeId, sourceRestaurantId, targetRestaurantId }
    ).then((r) => r.data),
};

// ── Labor ─────────────────────────────────────────────────────────────────────
export const laborApi = {
  create: (data: { date: string; fohLabor: number; bohLabor: number; management: number }) =>
    api.post<LaborEntry>("/labor", data).then((r) => r.data),

  list: (params?: { startDate?: string; endDate?: string }) =>
    api.get<LaborEntry[]>("/labor", { params }).then((r) => r.data),

  delete: (id: string) => api.delete(`/labor/${id}`),
};

// ── Onboarding checklist ──────────────────────────────────────────────────────

export interface OnboardingProgress {
  dismissed: boolean;
  completed: {
    invoice:  boolean;
    product:  boolean;
    recipe:   boolean;
    parLevel: boolean;
    team:     boolean;
  };
}

export const onboardingApi = {
  progress: () =>
    api.get<OnboardingProgress>("/onboarding/progress").then((r) => r.data),

  dismiss: () =>
    api.post<{ ok: boolean }>("/onboarding/dismiss").then((r) => r.data),
};

// ── Locations (Multi-Location Overview) ──────────────────────────────────────

export interface VarianceData {
  value: number | null;
  vsBest: number | null;
  vsAvg:  number | null;
}

/** Shape returned by the backend — flat metrics + keyed variance object. */
export interface RawVarianceLocation {
  id:        string;
  name:      string;
  isPrimary: boolean;
  hasData:   boolean;
  metrics: {
    primeCostPct:         number | null;
    foodCostPct:          number | null;
    laborCostPct:         number | null;
    inventoryAccuracyPct: number | null;
    revenue30d:           number;
  };
  variance: {
    prime: VarianceData;
    food:  VarianceData;
    labor: VarianceData;
  };
}

export interface RawBenchmark {
  best: number | null; worst: number | null; avg: number | null; variance: number | null;
}

export interface RawVarianceResponse {
  benchmark: { prime: RawBenchmark; food: RawBenchmark; labor: RawBenchmark };
  locations: RawVarianceLocation[];
}

/** Component-ready shape after transformation. */
export interface LocationVariance {
  restaurantId: string;
  name:         string;
  isTest:       boolean;
  isPrimary:    boolean;
  hasData:      boolean;
  foodCostPct:  VarianceData;
  laborCostPct: VarianceData;
  primeCostPct: VarianceData;
}

export interface VarianceAnalysisResponse {
  benchmark: {
    primeCostPct:  number | null;
    foodCostPct:   number | null;
    laborCostPct:  number | null;
  };
  locations: LocationVariance[];
}

export type MetricTrend = "up" | "down" | "flat" | null;

export interface LocationSummary {
  restaurantId: string;
  name:         string;
  logo:         string | null;
  isTest:       boolean;
  isPrimary:    boolean;
  hasData:      boolean;
  metrics: {
    foodCostPct:          number | null;
    laborCostPct:         number | null;
    primeCostPct:         number | null;
    inventoryAccuracyPct: number | null;
    revenue30d:           number;
  };
  trends: {
    foodCostPct:          MetricTrend;
    laborCostPct:         MetricTrend;
    primeCostPct:         MetricTrend;
    inventoryAccuracyPct: MetricTrend;
    revenue30d:           MetricTrend;
  };
}

export interface LocationCapacity {
  limit:  number;
  used:   number;
  canAdd: boolean;
}

export interface BranchLocation {
  id:       string;
  name:     string;
  address:  string | null;
  phone:    string | null;
  groupId:  string | null;
}

export const locationsApi = {
  overview: () =>
    api.get<LocationSummary[]>("/locations/overview").then((r) => r.data),
  recipes: () =>
    api.get<RecipeComparison[]>("/locations/recipes").then((r) => r.data),
  vendorPricing: () =>
    api.get<ProductVendorComparison[]>("/locations/vendor-pricing").then((r) => r.data),
  capacity: () =>
    api.get<LocationCapacity>("/locations/capacity").then((r) => r.data),
  addBranch: (body: { name: string; phone?: string; gmName: string; gmEmail: string }) =>
    api.post<BranchLocation>("/locations/branch", body).then((r) => r.data),
  deleteBranch: (locationId: string) =>
    api.delete<{ ok: boolean }>(`/locations/branch/${locationId}`).then((r) => r.data),
  getVarianceAnalysis: () =>
    api.get<RawVarianceResponse>("/locations/variance-analysis").then((r) => r.data),
};

// ── Recipe comparison types ───────────────────────────────────────────────────

export interface LocationRecipeIngredient {
  name:          string;
  quantity:      number;
  unit:          string;
  costPerUnit:   number;
  lineTotal:     number;
  fromInvoice:   boolean;
  purveyor:      string | null;
  invoiceDate:   string | null;
  pricingSource: "invoice" | "catalog";
}

export interface LocationRecipeEntry {
  restaurantId:    string;
  locationName:    string;
  isTest:          boolean;
  hasRecipe:       boolean;
  recipeId?:       string;   // present only when hasRecipe = true
  sellingPrice?:   number;
  recipeCost?:     number;
  costPct?:        number;
  hasInvoiceData?: boolean;
  ingredients?:    LocationRecipeIngredient[];
}

export interface RecipeComparison {
  recipeName: string;
  department: string;
  locations:  LocationRecipeEntry[];
}

// ── Vendor pricing types ──────────────────────────────────────────────────────

export interface PurveyorEntry {
  purveyor:       string;
  originalUnit:   string;
  originalCost:   number;
  normalizedCost: number;  // cost in canonicalUnit
  invoiceDate:    string | null;
  qty30d:         number;  // quantity in canonicalUnit
  isConverted:    boolean;
}

export interface LocationVendorPrice {
  restaurantId:       string;
  locationName:       string;
  isTest:             boolean;
  hasPurchases:       boolean;
  purveyors:          PurveyorEntry[];
  bestNormalizedCost: number | null;
  totalQty30d:        number;
}

export interface ProductVendorComparison {
  productName:             string;
  canonicalUnit:           string;
  hasUnitMismatch:         boolean;
  conversionNote:          string | null;
  totalQty30d:             number;
  totalSpend30d:           number;
  minCost:                 number;
  maxCost:                 number;
  priceDelta:              number;
  priceDeltaPct:           number;
  monthlySavings:          number;
  maxAnnualSavings:        number;
  purchasingLocationCount: number;
  locations:               LocationVendorPrice[];
}

export const seedApi = {
  seedTestLocations: () =>
    api.post<{ ok: boolean; seeded: string[] }>("/locations/seed-test").then((r) => r.data),

  clearTestLocations: () =>
    api.delete<{ ok: boolean; deleted: number }>("/locations/seed-test").then((r) => r.data),
};

// ── Partner setup (public — used on the /partner-setup onboarding page) ───────

export const partnerSetupApi = {
  /** Validate a partner invite token before showing the setup form. */
  validate: (token: string) =>
    api
      .get<{ email: string; firstName: string; lastName: string; expiresAt: string }>(
        `/super-admin/partner-invites/validate/${encodeURIComponent(token)}`
      )
      .then((r) => r.data),

  /** Complete partner onboarding — creates the restaurant + admin account. */
  complete: (data: {
    token: string;
    restaurantName: string;
    password: string;
    logo?: string | null;
  }) =>
    api
      .post<{ user: import("../types").User; token: string; refreshToken: string }>(
        "/super-admin/partner-setup",
        data
      )
      .then((r) => r.data),
};

// ── Feedback / suggestions ────────────────────────────────────────────────────

export const feedbackApi = {
  submit: (message: string) =>
    api.post<{ ok: boolean }>("/feedback", { message }).then((r) => r.data),
};
