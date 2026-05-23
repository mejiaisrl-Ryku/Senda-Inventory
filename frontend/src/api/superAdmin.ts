/**
 * Standalone axios instance for the Super Admin portal.
 * Uses sa_token / sa_refresh_token in localStorage so it never
 * collides with the regular user session.
 */
import axios from "axios";

// Intentionally mirrors the hardcoded BASE in api/index.ts so both clients
// always resolve to the same origin — no env-var ambiguity.
const BASE = "https://senda-inventory-production.up.railway.app/api";

export const saApi = axios.create({
  baseURL: BASE,
  headers: { "Content-Type": "application/json" },
});

saApi.interceptors.request.use((config) => {
  const token = localStorage.getItem("sa_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SARestaurant {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  createdAt: string;
  userCount: number;
  productCount: number;
  owner: { name: string | null; email: string } | null;
}

export interface SAUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  restaurantId: string | null;
  restaurantName: string | null;
}

export interface SARestaurantDetail {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  suspended: boolean;
  suspendedAt: string | null;
  createdAt: string;
  userCount: number;
  productCount: number;
  users: { id: string; name: string | null; email: string; role: string }[];
  productSummary: {
    byDept: Record<string, number>;
    byCategory: Record<string, number>;
  };
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const superAdminApi = {
  /** Dedicated super-admin login — backend rejects non-SUPER_ADMIN accounts. */
  login: (email: string, password: string) =>
    saApi.post<{ user: { id: string; name: string | null; email: string; role: string }; token: string; refreshToken: string }>(
      "/super-admin/login",
      { email, password }
    ).then((r) => r.data),

  // -- Restaurants --
  listRestaurants: () =>
    saApi.get<SARestaurant[]>("/super-admin/restaurants").then((r) => r.data),

  createRestaurant: (data: {
    name: string;
    adminName: string;
    adminEmail: string;
    adminPassword: string;
  }) => saApi.post<{ restaurant: SARestaurant; admin: SAUser }>("/super-admin/restaurants", data).then((r) => r.data),

  deleteRestaurant: (id: string) =>
    saApi.delete(`/super-admin/restaurants/${id}`),

  getRestaurant: (id: string) =>
    saApi.get<SARestaurantDetail>(`/super-admin/restaurants/${id}`).then((r) => r.data),

  toggleSuspend: (id: string) =>
    saApi.patch<{ id: string; suspended: boolean; suspendedAt: string | null }>(
      `/super-admin/restaurants/${id}/suspend`
    ).then((r) => r.data),

  // -- Users --
  listUsers: () =>
    saApi.get<SAUser[]>("/super-admin/users").then((r) => r.data),

  sendResetEmail: (userId: string) =>
    saApi.post(`/super-admin/users/${userId}/send-reset-email`),

  // -- Invite --
  inviteAdmin: (data: { name: string; email: string; restaurantId: string }) =>
    saApi.post("/super-admin/invite", data),
};
