/**
 * Standalone axios instance for the Super Admin portal.
 * Uses sa_token / sa_refresh_token in localStorage so it never
 * collides with the regular user session.
 */
import axios from "axios";

// Intentionally mirrors the hardcoded BASE in api/index.ts so both clients
// always resolve to the same origin — no env-var ambiguity.
const BASE = process.env.REACT_APP_API_URL ?? "https://senda-inventory-production.up.railway.app/api";

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

export interface SAPartnerInvite {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  expiresAt: string;
  messageId: string;
}

export interface SARestaurant {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  logo: string | null;
  createdAt: string;
  userCount: number;
  productCount: number;
  owner: { name: string | null; email: string } | null;
  /** ownerAccountName is returned when the backend includes it — may be absent on older responses */
  ownerAccountName?: string | null;
}

export interface SAOwnerAccount {
  id:              string;
  name:            string;
  email:           string;
  active:          boolean;
  restaurantCount: number;
  createdAt:       string;
  updatedAt:       string;
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
  logo: string | null;
  suspended: boolean;
  suspendedAt: string | null;
  createdAt: string;
  userCount: number;
  productCount: number;
  locationCount: number;
  /** Non-null when this restaurant is a branch; the value is the primary restaurant's id. */
  groupId: string | null;
  users: { id: string; name: string | null; email: string; role: string }[];
  productSummary: {
    byDept: Record<string, number>;
    byCategory: Record<string, number>;
  };
}

export interface SALocationDetail {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  groupId: string | null;
  userCount: number;
  productCount: number;
  isPrimary: boolean;
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

  updateLogo: (id: string, logo: string | null) =>
    saApi.put<{ id: string; logo: string | null }>(
      `/super-admin/restaurants/${id}/logo`,
      { logo }
    ).then((r) => r.data),

  // -- Users --
  listUsers: () =>
    saApi.get<SAUser[]>("/super-admin/users").then((r) => r.data),

  sendResetEmail: (userId: string) =>
    saApi.post(`/super-admin/users/${userId}/send-reset-email`),

  // -- Invite --
  inviteAdmin: (data: { firstName: string; lastName: string; email: string; restaurantId: string }) =>
    saApi.post("/super-admin/invite", data),

  // -- Partner invites (new-partner onboarding flow) --
  createPartnerInvite: (data: { firstName: string; lastName: string; email: string; locationCount: number }) =>
    saApi.post<SAPartnerInvite>("/super-admin/partner-invites", data).then((r) => r.data),

  // -- Merge standalone restaurants --
  listStandaloneRestaurants: () =>
    saApi.get<{ id: string; name: string; locationCount: number }[]>(
      "/super-admin/standalone-restaurants"
    ).then((r) => r.data),

  mergeRestaurants: (data: { parentId: string; childIds: string[] }) =>
    saApi.post<{ ok: boolean; parentId: string; childIds: string[]; totalLocations: number; message: string }>(
      "/super-admin/merge-restaurants",
      data
    ).then((r) => r.data),

  // -- Partner location management --
  listPartnerLocations: (partnerId: string) =>
    saApi.get<{ locations: SALocationDetail[]; totalLocations: number; maxLocations: number }>(
      `/super-admin/partners/${partnerId}/locations`
    ).then((r) => r.data),

  addPartnerLocation: (partnerId: string, data: { name: string; address?: string; phone?: string }) =>
    saApi.post<SALocationDetail>(`/super-admin/partners/${partnerId}/locations`, data).then((r) => r.data),

  deletePartnerLocation: (partnerId: string, locationId: string) =>
    saApi.delete<{ ok: boolean }>(`/super-admin/partners/${partnerId}/locations/${locationId}`).then((r) => r.data),

  // -- Owner Accounts (KYRU_MANAGER) --
  createOwnerAccount: (data: { ownerName: string; ownerEmail: string; restaurantIds?: string[] }) =>
    saApi.post<{
      ownerAccountId: string; ownerName: string; ownerEmail: string;
      inviteToken: string; sentEmail: string; restaurantCount: number;
    }>("/super-admin/owner-accounts", data).then((r) => r.data),

  listOwnerAccounts: () =>
    saApi.get<SAOwnerAccount[]>("/super-admin/owner-accounts").then((r) => r.data),

  archiveOwnerAccount: (id: string) =>
    saApi.patch<{ id: string; active: boolean; name: string }>(
      `/super-admin/owner-accounts/${id}/archive`
    ).then((r) => r.data),

  hardDeleteOwnerAccount: (id: string) =>
    saApi.delete<{ deleted: boolean; id: string }>(
      `/super-admin/owner-accounts/${id}/hard-delete`,
      { headers: { "X-Confirm-Delete": "permanent" } }
    ).then((r) => r.data),
};
