import axios, { AxiosRequestConfig } from "axios";
import { Order, Product, StockLog, StockReport, StockReason, OrderStatus, DailyReport, WeeklyReport, SalesEntry, SalesCategory, CogsReport, TeamMember } from "../types";
import { cacheGet, cacheSet, cachePurge } from "../utils/offlineCache";

// TODO: remove hardcode — set REACT_APP_API_URL env var in Vercel and revert this line
const BASE = "https://senda-inventory-production.up.railway.app/api";

export const api = axios.create({
  baseURL: BASE,
  headers: { "Content-Type": "application/json" },
});

// ── Request interceptor: attach access token ──────────────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
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
    const original: AxiosRequestConfig & { _retry?: boolean } = err.config ?? {};

    // Skip retry for auth endpoints themselves to prevent loops.
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
      clearSession();
      window.location.href = "/login";
      return Promise.reject(err);
    }

    if (isRefreshing) {
      // Queue this request until the in-flight refresh resolves.
      return new Promise((resolve, reject) => {
        pendingQueue.push({ resolve, reject });
      }).then((newToken) => {
        original.headers = { ...original.headers, Authorization: `Bearer ${newToken}` };
        return api(original);
      });
    }

    isRefreshing = true;
    try {
      const { data } = await axios.post(`${BASE}/auth/refresh`, { refreshToken: storedRefresh });
      localStorage.setItem("token", data.token);
      localStorage.setItem("refreshToken", data.refreshToken);
      if (data.user) localStorage.setItem("user", JSON.stringify(data.user));
      drainQueue(null, data.token);
      original.headers = { ...original.headers, Authorization: `Bearer ${data.token}` };
      return api(original);
    } catch (refreshErr) {
      drainQueue(refreshErr);
      clearSession();
      window.location.href = "/login";
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

// ── Orders ────────────────────────────────────────────────────────────────────
export const ordersApi = {
  create: (items: { productId: string; quantity: number; unitCost: number }[]) =>
    api.post<Order>("/orders", { items }).then((r) => r.data),

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

  weekly: (endDate?: string) =>
    api
      .get<WeeklyReport>("/reports/weekly", { params: endDate ? { endDate } : {} })
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

  cogsToSales: (startDate: string, endDate: string) =>
    api
      .get<CogsReport>("/reports/cogs-to-sales", { params: { startDate, endDate } })
      .then((r) => r.data),
};

// ── Team ──────────────────────────────────────────────────────────────────────
export const teamApi = {
  list: () => api.get<TeamMember[]>("/team").then((r) => r.data),

  invite: (data: { name: string; email: string }) =>
    api.post("/team/invite", data).then((r) => r.data),

  create: (data: { name: string; email: string; password: string }) =>
    api.post<TeamMember>("/team/create", data).then((r) => r.data),

  remove: (userId: string) => api.delete(`/team/${userId}`),

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
