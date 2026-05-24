import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { superAdminApi, SARestaurantDetail } from "../../api/superAdmin";
import { Spinner } from "../shared/Spinner";
import { useToast } from "../../context/ToastContext";

// ── Shared styles (mirrors SuperAdminDashboard) ───────────────────────────────

const inputCls =
  "w-full px-3 py-2.5 rounded-[8px] border border-[#2a2a2a] bg-[#0a0a0a] text-white text-sm placeholder-[#444] focus:outline-none focus:border-[#3dbf8a] transition-colors";

const labelCls =
  "block text-[11px] font-medium text-[#555] uppercase tracking-[0.08em] mb-1.5";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[#0a0a0a] border border-[#1a1a1a] rounded-[8px] ${className}`}>
      {children}
    </div>
  );
}

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
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${styles[role] ?? styles.STAFF}`}
    >
      {labels[role] ?? role}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Confirm dialog ────────────────────────────────────────────────────────────

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  loading,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-[12px] p-6 w-full max-w-sm shadow-2xl">
        <h3 className="text-[16px] font-semibold text-white mb-2">{title}</h3>
        <div className="text-[13px] text-[#888] mb-5">{body}</div>
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
            className={`flex-1 py-2 rounded-[8px] disabled:opacity-60 text-white text-[13px] font-medium transition-colors flex items-center justify-center gap-2 ${
              danger ? "bg-red-600 hover:bg-red-700" : "bg-[#3dbf8a] hover:bg-[#35a87a]"
            }`}
          >
            {loading && <Spinner size="sm" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Users table ───────────────────────────────────────────────────────────────

function UsersSection({
  users,
  restaurantId,
  restaurantName,
}: {
  users: SARestaurantDetail["users"];
  restaurantId: string;
  restaurantName: string;
}) {
  const toast = useToast();
  const [sendingReset, setSendingReset] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");

  async function handleSendReset(u: { id: string; email: string }) {
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

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError("");
    setInviteLoading(true);
    try {
      await superAdminApi.inviteAdmin({ name: inviteName, email: inviteEmail, restaurantId });
      toast.success(`Invite sent to ${inviteEmail}`);
      setInviteName("");
      setInviteEmail("");
      setShowInvite(false);
    } catch (err: any) {
      setInviteError(err?.response?.data?.error ?? "Failed to send invite.");
    } finally {
      setInviteLoading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[16px] font-semibold text-white">Users</h2>
          <p className="text-[13px] text-[#555] mt-0.5">{users.length} member{users.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => setShowInvite((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border border-[#2a2a2a] text-[12px] text-[#888] hover:text-white hover:border-[#3dbf8a] hover:text-[#3dbf8a] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Admin
        </button>
      </div>

      {showInvite && (
        <Card className="p-4 mb-4">
          <p className="text-[12px] text-[#555] mb-3 uppercase tracking-[0.08em] font-medium">
            Invite Admin to {restaurantName}
          </p>
          {inviteError && (
            <div className="mb-3 px-3 py-2 rounded-[8px] bg-red-900/20 border border-red-800/40 text-red-400 text-[13px]">
              {inviteError}
            </div>
          )}
          <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-3">
            <input
              required
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder="Name"
              className={inputCls}
            />
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="Email"
              className={inputCls}
            />
            <button
              type="submit"
              disabled={inviteLoading}
              className="px-4 py-2.5 rounded-[8px] bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-60 text-white text-[13px] font-semibold whitespace-nowrap flex items-center gap-2 transition-colors"
            >
              {inviteLoading && <Spinner size="sm" />}
              Send Invite
            </button>
          </form>
        </Card>
      )}

      <Card>
        {users.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-[#444]">No users yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a1a1a]">
                  {["User", "Email", "Role", ""].map((h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 text-[11px] font-medium text-[#444] uppercase tracking-[0.08em] whitespace-nowrap"
                    >
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
                    <td className="px-4 py-3">
                      <RolePill role={u.role} />
                    </td>
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
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                            />
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
        )}
      </Card>
    </div>
  );
}

// ── Product summary ───────────────────────────────────────────────────────────

function ProductSummary({
  productCount,
  summary,
}: {
  productCount: number;
  summary: SARestaurantDetail["productSummary"];
}) {
  const deptEntries = Object.entries(summary.byDept).sort((a, b) => b[1] - a[1]);
  const catEntries = Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]);

  const deptColors: Record<string, string> = {
    BOH: "bg-blue-900/30 text-blue-400",
    FOH: "bg-purple-900/30 text-purple-400",
    BAR: "bg-yellow-900/30 text-yellow-400",
    BOTH: "bg-[#3dbf8a]/10 text-[#3dbf8a]",
  };

  const deptLabels: Record<string, string> = {
    BOH: "Kitchen",
    FOH: "FOH",
    BAR: "Bar",
    BOTH: "Both",
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-[16px] font-semibold text-white">Products</h2>
        <p className="text-[13px] text-[#555] mt-0.5">{productCount} total products</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* By department */}
        <Card className="p-4">
          <p className="text-[11px] font-medium text-[#444] uppercase tracking-[0.08em] mb-3">
            By Department
          </p>
          {deptEntries.length === 0 ? (
            <p className="text-[13px] text-[#444]">No products yet.</p>
          ) : (
            <div className="space-y-2">
              {deptEntries.map(([dept, count]) => (
                <div key={dept} className="flex items-center justify-between">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                      deptColors[dept] ?? "bg-[#1a1a1a] text-[#888]"
                    }`}
                  >
                    {deptLabels[dept] ?? dept}
                  </span>
                  <span className="text-[13px] text-[#888]">{count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* By category */}
        <Card className="p-4">
          <p className="text-[11px] font-medium text-[#444] uppercase tracking-[0.08em] mb-3">
            By Category
          </p>
          {catEntries.length === 0 ? (
            <p className="text-[13px] text-[#444]">No products yet.</p>
          ) : (
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {catEntries.map(([cat, count]) => (
                <div key={cat} className="flex items-center justify-between">
                  <span className="text-[13px] text-[#888] truncate max-w-[70%]">{cat}</span>
                  <span className="text-[13px] text-[#555]">{count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── Main detail page ──────────────────────────────────────────────────────────

// ── Logo upload area ──────────────────────────────────────────────────────────

function LogoUpload({
  currentLogo,
  restaurantName,
  onSave,
}: {
  currentLogo: string | null;
  restaurantName: string;
  onSave: (logo: string | null) => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Please select a PNG or JPG image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      alert("Image must be under 2 MB.");
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await onSave(dataUrl);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      await onSave(null);
    } finally {
      setRemoving(false);
    }
  }

  const initials = restaurantName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative group flex-shrink-0">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleFile}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading || removing}
        title="Upload logo"
        className="w-14 h-14 rounded-full overflow-hidden flex items-center justify-center bg-[#111] disabled:opacity-50 relative"
      >
        {currentLogo ? (
          <img src={currentLogo} alt={restaurantName} className="w-full h-full object-cover" />
        ) : (
          <span className="text-[#555] text-[18px] font-bold">{initials}</span>
        )}
        {/* Hover overlay */}
        <span className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-full">
          {uploading || removing ? (
            <Spinner size="sm" />
          ) : (
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          )}
        </span>
      </button>
      {/* Remove button — only when logo exists */}
      {currentLogo && !uploading && !removing && (
        <button
          type="button"
          onClick={handleRemove}
          title="Remove logo"
          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#0a0a0a] border border-[#2a2a2a] flex items-center justify-center text-[#555] hover:text-red-400 hover:border-red-800/40 transition-colors opacity-0 group-hover:opacity-100"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ── Main detail page ──────────────────────────────────────────────────────────

export function SuperAdminPartnerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [detail, setDetail] = useState<SARestaurantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [suspending, setSuspending] = useState(false);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    superAdminApi
      .getRestaurant(id)
      .then(setDetail)
      .catch(() => setError("Failed to load partner details."))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleToggleSuspend() {
    if (!detail) return;
    setSuspending(true);
    try {
      const updated = await superAdminApi.toggleSuspend(detail.id);
      setDetail((prev) =>
        prev
          ? { ...prev, suspended: updated.suspended, suspendedAt: updated.suspendedAt }
          : prev
      );
      toast.success(updated.suspended ? `${detail.name} suspended.` : `${detail.name} reactivated.`);
    } catch {
      toast.error("Failed to update suspension status.");
    } finally {
      setSuspending(false);
      setConfirmSuspend(false);
    }
  }

  async function handleDelete() {
    if (!detail) return;
    setDeleting(true);
    try {
      await superAdminApi.deleteRestaurant(detail.id);
      toast.success(`${detail.name} deleted.`);
      navigate("/super-admin");
    } catch {
      toast.error("Failed to delete partner.");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function handleLogoSave(logo: string | null) {
    if (!detail) return;
    try {
      const updated = await superAdminApi.updateLogo(detail.id, logo);
      setDetail((prev) => prev ? { ...prev, logo: updated.logo } : prev);
      toast.success(logo ? "Logo updated." : "Logo removed.");
    } catch {
      toast.error("Failed to update logo.");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="p-8 text-center text-[#555] text-[14px]">
        {error || "Partner not found."}
        <button
          onClick={() => navigate("/super-admin")}
          className="block mx-auto mt-4 text-[#3dbf8a] text-[13px] hover:underline"
        >
          ← Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8 max-w-4xl">
      {/* ── Back + actions header ────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate("/super-admin")}
            className="flex-shrink-0 w-8 h-8 rounded-[8px] border border-[#2a2a2a] flex items-center justify-center text-[#555] hover:text-white hover:border-[#444] transition-colors"
            title="Back to dashboard"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <LogoUpload
            currentLogo={detail.logo}
            restaurantName={detail.name}
            onSave={handleLogoSave}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-[22px] font-semibold text-white truncate">{detail.name}</h1>
              {detail.suspended && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-900/20 text-red-400 border border-red-800/30 flex-shrink-0">
                  Suspended
                </span>
              )}
            </div>
            <p className="text-[13px] text-[#555] mt-0.5">
              {detail.userCount} user{detail.userCount !== 1 ? "s" : ""} ·{" "}
              {detail.productCount} product{detail.productCount !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setConfirmSuspend(true)}
            disabled={suspending}
            className={`px-3 py-1.5 rounded-[8px] border text-[12px] font-medium transition-colors flex items-center gap-1.5 ${
              detail.suspended
                ? "border-[#3dbf8a]/30 text-[#3dbf8a] hover:bg-[#3dbf8a]/10"
                : "border-yellow-800/40 text-yellow-500 hover:bg-yellow-900/10"
            } disabled:opacity-50`}
          >
            {suspending ? (
              <Spinner size="sm" />
            ) : detail.suspended ? (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            )}
            {detail.suspended ? "Reactivate" : "Suspend"}
          </button>

          <button
            onClick={() => setConfirmDelete(true)}
            className="px-3 py-1.5 rounded-[8px] border border-red-800/40 text-red-500 hover:bg-red-900/10 text-[12px] font-medium transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        </div>
      </div>

      {/* ── Partner info card ────────────────────────────────────────────── */}
      <Card className="p-5">
        <p className="text-[11px] font-medium text-[#444] uppercase tracking-[0.08em] mb-3">
          Partner Info
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className={labelCls}>Created</p>
            <p className="text-[13px] text-[#888]">{formatDate(detail.createdAt)}</p>
          </div>
          <div>
            <p className={labelCls}>Owner email</p>
            <p className="text-[13px] text-[#888] truncate">
              {detail.users.find((u) => u.role === "ADMIN")?.email ?? "—"}
            </p>
          </div>
          <div>
            <p className={labelCls}>Users</p>
            <p className="text-[13px] text-white font-medium">{detail.userCount}</p>
          </div>
          <div>
            <p className={labelCls}>Products</p>
            <p className="text-[13px] text-white font-medium">{detail.productCount}</p>
          </div>
          {detail.suspended && detail.suspendedAt && (
            <div className="col-span-2">
              <p className={labelCls}>Suspended on</p>
              <p className="text-[13px] text-red-400">{formatDate(detail.suspendedAt)}</p>
            </div>
          )}
        </div>
      </Card>

      {/* ── Users section ────────────────────────────────────────────────── */}
      <UsersSection
        users={detail.users}
        restaurantId={detail.id}
        restaurantName={detail.name}
      />

      {/* ── Product summary ──────────────────────────────────────────────── */}
      <ProductSummary productCount={detail.productCount} summary={detail.productSummary} />

      {/* ── Confirm dialogs ──────────────────────────────────────────────── */}
      {confirmSuspend && (
        <ConfirmDialog
          title={detail.suspended ? "Reactivate partner?" : "Suspend partner?"}
          body={
            detail.suspended ? (
              <>
                <span className="text-white font-medium">"{detail.name}"</span> will be reactivated
                and their users will regain access.
              </>
            ) : (
              <>
                <span className="text-white font-medium">"{detail.name}"</span> will be suspended.
                Their users will still exist but will be blocked from accessing the platform.
              </>
            )
          }
          confirmLabel={detail.suspended ? "Reactivate" : "Suspend"}
          danger={!detail.suspended}
          loading={suspending}
          onConfirm={handleToggleSuspend}
          onCancel={() => setConfirmSuspend(false)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete partner?"
          body={
            <>
              <span className="text-white font-medium">"{detail.name}"</span> and all its data —
              users, products, stock logs, orders — will be permanently deleted. This cannot be
              undone.
            </>
          }
          confirmLabel="Delete"
          danger
          loading={deleting}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
