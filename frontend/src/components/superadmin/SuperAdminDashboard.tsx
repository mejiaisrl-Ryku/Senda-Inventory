import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { superAdminApi, SARestaurant, SAUser } from "../../api/superAdmin";
import { Spinner } from "../shared/Spinner";
import { useToast } from "../../context/ToastContext";

// ── Shared styles ─────────────────────────────────────────────────────────────

const inputCls =
  "w-full px-3 py-2.5 rounded-[8px] border border-[#2a2a2a] bg-[#0a0a0a] text-white text-sm placeholder-[#444] focus:outline-none focus:border-[#3dbf8a] transition-colors";

const labelCls =
  "block text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] mb-1.5";

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-[16px] font-semibold text-white">{title}</h2>
      {sub && <p className="text-[13px] text-[#555] mt-0.5">{sub}</p>}
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[#0a0a0a] border border-[#1a1a1a] rounded-[8px] ${className}`}>
      {children}
    </div>
  );
}

// ── Role pill ─────────────────────────────────────────────────────────────────

function RolePill({ role }: { role: string }) {
  const styles: Record<string, string> = {
    SUPER_ADMIN: "bg-[#3dbf8a]/10 text-[#3dbf8a] border-[#3dbf8a]/20",
    ADMIN: "bg-blue-900/20 text-blue-400 border-blue-800/30",
    STAFF: "bg-[#1a1a1a] text-[#888] border-[#2a2a2a]",
  };
  const labels: Record<string, string> = {
    SUPER_ADMIN: "Super admin",
    ADMIN: "Admin",
    STAFF: "User",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${styles[role] ?? styles.STAFF}`}>
      {labels[role] ?? role}
    </span>
  );
}

// ── Confirm delete dialog ─────────────────────────────────────────────────────

function ConfirmDelete({
  name,
  onConfirm,
  onCancel,
  loading,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-[12px] p-6 w-full max-w-sm shadow-2xl">
        <h3 className="text-[16px] font-semibold text-white mb-2">Delete partner</h3>
        <p className="text-[13px] text-[#888] mb-5">
          <span className="text-white font-medium">"{name}"</span> and all its data —
          users, products, stock logs, orders — will be permanently deleted. This cannot be undone.
        </p>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2 rounded-[8px] border border-[#2a2a2a] text-[13px] text-[#888] hover:text-white hover:border-[#444] disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2 rounded-[8px] bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-[13px] font-medium transition-colors flex items-center justify-center gap-2"
          >
            {loading && <Spinner size="sm" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Restaurants table ─────────────────────────────────────────────────────────

function RestaurantsTable({
  restaurants,
  onDeleted,
}: {
  restaurants: SARestaurant[];
  onDeleted: (id: string) => void;
}) {
  const navigate = useNavigate();
  const [deleteTarget, setDeleteTarget] = useState<SARestaurant | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError("");
    try {
      await superAdminApi.deleteRestaurant(deleteTarget.id);
      onDeleted(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Delete failed.");
    } finally {
      setDeleting(false);
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  if (restaurants.length === 0) {
    return (
      <div className="py-10 text-center text-[13px] text-[#444]">No partners yet.</div>
    );
  }

  return (
    <>
      {error && (
        <div className="mb-3 px-3 py-2 rounded-[8px] bg-red-900/20 border border-red-800/40 text-red-400 text-[13px]">
          {error}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1a1a1a]">
              {["Partner", "Owner", "Users", "Products", "Created", ""].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-[11px] font-medium text-[#444] uppercase tracking-[0.08em] whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#111]">
            {restaurants.map((r) => (
              <tr
                key={r.id}
                onClick={() => navigate(`/super-admin/partners/${r.id}`)}
                className="hover:bg-[#0f0f0f] transition-colors cursor-pointer"
              >
                <td className="px-4 py-3">
                  <p className="text-white font-medium text-[13px]">{r.name}</p>
                  {r.address && <p className="text-[#444] text-[11px] mt-0.5">{r.address}</p>}
                </td>
                <td className="px-4 py-3">
                  {r.owner ? (
                    <>
                      <p className="text-[#888] text-[13px]">{r.owner.name ?? "—"}</p>
                      <p className="text-[#444] text-[11px] mt-0.5">{r.owner.email}</p>
                    </>
                  ) : (
                    <span className="text-[#444] text-[13px]">No admin</span>
                  )}
                </td>
                <td className="px-4 py-3 text-[#888] text-[13px]">{r.userCount}</td>
                <td className="px-4 py-3 text-[#888] text-[13px]">{r.productCount}</td>
                <td className="px-4 py-3 text-[#888] text-[13px] whitespace-nowrap">{formatDate(r.createdAt)}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }}
                    className="text-[#555] hover:text-red-400 transition-colors p-1.5 rounded-[6px] hover:bg-red-900/10"
                    title="Delete partner"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {deleteTarget && (
        <ConfirmDelete
          name={deleteTarget.name}
          loading={deleting}
          onConfirm={handleDelete}
          onCancel={() => { setDeleteTarget(null); setError(""); }}
        />
      )}
    </>
  );
}

// ── Add Restaurant form ───────────────────────────────────────────────────────

function AddRestaurantForm({ onCreated }: { onCreated: (r: SARestaurant) => void }) {
  const [name, setName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const { restaurant } = await superAdminApi.createRestaurant({ name, adminName, adminEmail, adminPassword });
      setSuccess(`"${restaurant.name}" created with admin account for ${adminEmail}.`);
      setName(""); setAdminName(""); setAdminEmail(""); setAdminPassword("");
      onCreated(restaurant);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Failed to create partner.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <div className="px-3 py-2.5 rounded-[8px] bg-red-900/20 border border-red-800/40 text-red-400 text-[13px]">{error}</div>
      )}
      {success && (
        <div className="px-3 py-2.5 rounded-[8px] bg-[#3dbf8a]/10 border border-[#3dbf8a]/20 text-[#3dbf8a] text-[13px]">{success}</div>
      )}
      <div>
        <label className={labelCls}>Partner name</label>
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="La Milagrosa" className={inputCls} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Admin name</label>
          <input required value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Carlos López" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Admin email</label>
          <input type="email" required value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="carlos@restaurant.com" className={inputCls} />
        </div>
      </div>
      <div>
        <label className={labelCls}>Admin password</label>
        <div className="relative">
          <input
            type={showPw ? "text" : "password"}
            required
            minLength={8}
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            placeholder="Min. 8 characters"
            className={inputCls + " pr-10"}
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-[#444] hover:text-[#888] transition-colors"
            aria-label={showPw ? "Hide" : "Show"}
          >
            {showPw ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
          </button>
        </div>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 rounded-[8px] bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-60 text-white text-[13px] font-semibold transition-colors flex items-center justify-center gap-2"
      >
        {loading && <Spinner size="sm" />}
        Create Partner
      </button>
    </form>
  );
}

// ── Invite Admin form ─────────────────────────────────────────────────────────

function InviteAdminForm({ restaurants }: { restaurants: SARestaurant[] }) {
  const [restaurantId, setRestaurantId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      await superAdminApi.inviteAdmin({ name, email, restaurantId });
      setSuccess(`Invite sent to ${email}.`);
      setName(""); setEmail(""); setRestaurantId("");
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Failed to send invite.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <div className="px-3 py-2.5 rounded-[8px] bg-red-900/20 border border-red-800/40 text-red-400 text-[13px]">{error}</div>
      )}
      {success && (
        <div className="px-3 py-2.5 rounded-[8px] bg-[#3dbf8a]/10 border border-[#3dbf8a]/20 text-[#3dbf8a] text-[13px]">{success}</div>
      )}
      <div>
        <label className={labelCls}>Partner</label>
        <select
          required
          value={restaurantId}
          onChange={(e) => setRestaurantId(e.target.value)}
          className={inputCls}
        >
          <option value="">— Select partner —</option>
          {restaurants.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Admin name</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="María García" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Admin email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="maria@restaurant.com" className={inputCls} />
        </div>
      </div>
      <button
        type="submit"
        disabled={loading || restaurants.length === 0}
        className="w-full py-2.5 rounded-[8px] bg-[#1a1a1a] hover:bg-[#222] disabled:opacity-60 text-white text-[13px] font-semibold border border-[#2a2a2a] hover:border-[#3dbf8a] transition-colors flex items-center justify-center gap-2"
      >
        {loading && <Spinner size="sm" />}
        Send Invite Email
      </button>
    </form>
  );
}

// ── Users table ───────────────────────────────────────────────────────────────

function UsersTable({ users }: { users: SAUser[] }) {
  const toast = useToast();
  const [sendingReset, setSendingReset] = React.useState<string | null>(null);

  async function handleSendReset(u: SAUser) {
    setSendingReset(u.id);
    try {
      await superAdminApi.sendResetEmail(u.id);
      toast.success(`Password reset email sent to ${u.email}`);
    } catch {
      toast.error("Failed to send reset email.");
    } finally {
      setSendingReset(null);
    }
  }

  if (users.length === 0) {
    return <div className="py-10 text-center text-[13px] text-[#444]">No users yet.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#1a1a1a]">
            {["User", "Email", "Role", "Partner", ""].map((h) => (
              <th key={h} className="text-left px-4 py-3 text-[11px] font-medium text-[#444] uppercase tracking-[0.08em] whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#111]">
          {users.map((u) => (
            <tr key={u.id} className="hover:bg-[#0f0f0f] transition-colors">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-[#888] text-[10px] font-bold flex-shrink-0">
                    {(u.name ?? u.email)[0].toUpperCase()}
                  </div>
                  <span className="text-white text-[13px] font-medium">{u.name ?? "—"}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-[#888] text-[13px]">{u.email}</td>
              <td className="px-4 py-3"><RolePill role={u.role} /></td>
              <td className="px-4 py-3 text-[#888] text-[13px]">{u.restaurantName ?? <span className="text-[#444]">—</span>}</td>
              <td className="px-4 py-3 text-right">
                <button
                  onClick={() => handleSendReset(u)}
                  disabled={sendingReset === u.id}
                  title="Send password reset email"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] text-[11px] text-[#555] hover:text-[#3dbf8a] hover:bg-[#3dbf8a]/10 disabled:opacity-40 border border-transparent hover:border-[#3dbf8a]/20 transition-colors"
                >
                  {sendingReset === u.id ? (
                    <Spinner size="sm" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                  )}
                  Reset password
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export function SuperAdminDashboard() {
  const [restaurants, setRestaurants] = useState<SARestaurant[]>([]);
  const [users, setUsers] = useState<SAUser[]>([]);
  const [loadingR, setLoadingR] = useState(true);
  const [loadingU, setLoadingU] = useState(true);

  const loadRestaurants = useCallback(() => {
    setLoadingR(true);
    superAdminApi.listRestaurants()
      .then(setRestaurants)
      .finally(() => setLoadingR(false));
  }, []);

  const loadUsers = useCallback(() => {
    setLoadingU(true);
    superAdminApi.listUsers()
      .then(setUsers)
      .finally(() => setLoadingU(false));
  }, []);

  useEffect(() => { loadRestaurants(); }, [loadRestaurants]);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  function onRestaurantCreated(r: SARestaurant) {
    setRestaurants((prev) => [r, ...prev]);
    loadUsers(); // refresh users to show the new admin
  }

  function onRestaurantDeleted(id: string) {
    setRestaurants((prev) => prev.filter((r) => r.id !== id));
    setUsers((prev) => prev.filter((u) => u.restaurantId !== id));
  }

  return (
    <div className="p-8 space-y-8">
      {/* Page title */}
      <div>
        <h1 className="text-[22px] font-semibold text-white">Platform Overview</h1>
        <p className="text-[13px] text-[#555] mt-1">
          {restaurants.length} partner{restaurants.length !== 1 ? "s" : ""} ·{" "}
          {users.length} user{users.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* ── Restaurants ────────────────────────────────────────────────────── */}
      <div>
        <SectionHeader
          title="Partners"
          sub="All accounts on the platform"
        />
        <Card>
          {loadingR ? (
            <div className="flex items-center justify-center py-12"><Spinner size="lg" /></div>
          ) : (
            <RestaurantsTable restaurants={restaurants} onDeleted={onRestaurantDeleted} />
          )}
        </Card>
      </div>

      {/* ── Add restaurant + Invite admin ──────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <SectionHeader
            title="Create Partner"
            sub="Set up a new account with an admin"
          />
          <Card className="p-5">
            <AddRestaurantForm onCreated={onRestaurantCreated} />
          </Card>
        </div>

        <div>
          <SectionHeader
            title="Invite Admin"
            sub="Send a registration link to an existing partner"
          />
          <Card className="p-5">
            <InviteAdminForm restaurants={restaurants} />
          </Card>
        </div>
      </div>

      {/* ── All users ──────────────────────────────────────────────────────── */}
      <div>
        <SectionHeader
          title="All Users"
          sub="Every account across all partners"
        />
        <Card>
          {loadingU ? (
            <div className="flex items-center justify-center py-12"><Spinner size="lg" /></div>
          ) : (
            <UsersTable users={users} />
          )}
        </Card>
      </div>
    </div>
  );
}
