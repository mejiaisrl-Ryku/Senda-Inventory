import React, { useEffect, useState } from "react";
import { TeamMember } from "../types";
import { teamApi } from "../api";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { getApiError } from "../utils/errorUtils";
import { ConfirmDialog } from "./shared/ConfirmDialog";
import { Spinner } from "./shared/Spinner";

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputCls =
  "w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition";

const labelCls = "block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1";

function RolePill({ role }: { role: "ADMIN" | "STAFF" }) {
  return role === "ADMIN" ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400">
      Admin
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
      Staff
    </span>
  );
}

// ── Invite form ───────────────────────────────────────────────────────────────

function InviteForm({ onSuccess }: { onSuccess: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await teamApi.invite({ name, email });
      toast.success(`Invite sent to ${email}`);
      setName("");
      setEmail("");
      onSuccess();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Invite by email</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">They'll receive a link to create their account</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className={labelCls}>Full name</label>
          <input
            type="text"
            required
            placeholder="María García"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Email address</label>
          <input
            type="email"
            required
            placeholder="maria@restaurant.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full inline-flex items-center justify-center gap-2 min-h-[40px] px-4 bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {loading ? <><Spinner size="sm" /> Sending…</> : "Send invite"}
        </button>
      </form>
    </div>
  );
}

// ── Create form ───────────────────────────────────────────────────────────────

function CreateForm({ onSuccess }: { onSuccess: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await teamApi.create({ name, email, password });
      toast.success(`${name} added to your team`);
      setName("");
      setEmail("");
      setPassword("");
      onSuccess();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Create directly</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">Set a password and hand off credentials</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className={labelCls}>Full name</label>
          <input
            type="text"
            required
            placeholder="Carlos López"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Email address</label>
          <input
            type="email"
            required
            placeholder="carlos@restaurant.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Password</label>
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              required
              minLength={8}
              placeholder="Min. 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls + " pr-10"}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              aria-label={showPw ? "Hide password" : "Show password"}
            >
              {showPw ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full inline-flex items-center justify-center gap-2 min-h-[40px] px-4 bg-gray-800 dark:bg-gray-200 hover:bg-gray-700 dark:hover:bg-white disabled:opacity-60 text-white dark:text-gray-900 text-sm font-semibold rounded-xl transition-colors"
        >
          {loading ? <><Spinner size="sm" /> Creating…</> : "Create account"}
        </button>
      </form>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function TeamPage() {
  const { user } = useAuth();
  const toast = useToast();

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null);
  const [removing, setRemoving] = useState(false);

  // Plain function — called on mount and after mutations. Not a dep of any effect.
  function loadMembers() {
    setLoadingMembers(true);
    teamApi
      .list()
      .then(setMembers)
      .catch(() => toast.error("Failed to load team members"))
      .finally(() => setLoadingMembers(false));
  }

  // Empty dep array — fires exactly once when the component mounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadMembers(); }, []);

  async function handleRemove() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await teamApi.remove(removeTarget.id);
      setMembers((prev) => prev.filter((m) => m.id !== removeTarget.id));
      toast.success(`${removeTarget.name ?? removeTarget.email} removed from team`);
      setRemoveTarget(null);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Team</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Manage who has access to {user?.restaurantName ?? "your restaurant"}
        </p>
      </div>

      {/* Two-column forms */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <InviteForm onSuccess={loadMembers} />
        <CreateForm onSuccess={loadMembers} />
      </div>

      {/* Team members table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            Current team
          </h2>
          {!loadingMembers && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {members.length} {members.length === 1 ? "member" : "members"}
            </span>
          )}
        </div>

        {loadingMembers ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : members.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">No team members yet. Invite or create one above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  {["Name", "Email", "Role", ""].map((h) => (
                    <th
                      key={h}
                      className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-5 py-3"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {members.map((m) => {
                  const isSelf = m.id === user?.id;
                  return (
                    <tr
                      key={m.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                            {(m.name ?? m.email)[0].toUpperCase()}
                          </div>
                          <span className="font-medium text-gray-900 dark:text-white">
                            {m.name ?? "—"}
                            {isSelf && (
                              <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">(you)</span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-gray-500 dark:text-gray-400">{m.email}</td>
                      <td className="px-5 py-3.5">
                        <RolePill role={m.role} />
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {!isSelf && (
                          <button
                            onClick={() => setRemoveTarget(m)}
                            title="Remove from team"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6" />
                            </svg>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!removeTarget}
        title="Remove team member"
        message={`${removeTarget?.name ?? removeTarget?.email} will lose access to ${user?.restaurantName ?? "this restaurant"} immediately.`}
        confirmLabel="Remove"
        variant="danger"
        loading={removing}
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
