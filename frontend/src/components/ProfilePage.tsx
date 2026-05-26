import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { teamApi, feedbackApi } from "../api";
import { TeamMember } from "../types";
import { Spinner } from "./shared/Spinner";
import { ConfirmDialog } from "./shared/ConfirmDialog";

// ── Shared styles ─────────────────────────────────────────────────────────────

const inputCls =
  "w-full px-3 py-2.5 rounded-[8px] border border-[#1e1e1e] bg-[#0a0a0a] text-white text-[13px] placeholder-[#333] focus:outline-none focus:border-[#3dbf8a]/50 transition-colors";

const labelCls = "block text-[11px] font-medium text-[#666] mb-1";

function Card({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-[#0d0d0d] border border-[#1e1e1e] rounded-[12px] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a1a1a]">
        <h2 className="text-[14px] font-semibold text-white">{title}</h2>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

// ── Invite by Email modal ─────────────────────────────────────────────────────

function InviteModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [firstName, setFirstName] = useState("");
  const [lastName,  setLastName]  = useState("");
  const [email,     setEmail]     = useState("");
  const [role,      setRole]      = useState<"ADMIN" | "STAFF">("STAFF");
  const [busy,      setBusy]      = useState(false);

  function reset() { setFirstName(""); setLastName(""); setEmail(""); setRole("STAFF"); }
  function handleClose() { reset(); onClose(); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !email.trim() || busy) return;
    setBusy(true);
    try {
      await teamApi.invite({
        name: `${firstName.trim()} ${lastName.trim()}`.trim(),
        email: email.trim(),
        role,
      });
      toast.success(`Invite sent to ${email.trim()}`);
      reset();
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? "Couldn't send invite — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-200 ${
        open ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
      onClick={handleClose}
    >
      <div className="absolute inset-0 bg-black/70" />
      <div
        className={`relative w-full max-w-sm mx-4 bg-[#0d0d0d] border border-[#1e1e1e] rounded-[16px] shadow-2xl transform transition-all duration-200 ${
          open ? "scale-100 translate-y-0" : "scale-95 translate-y-4"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[#1a1a1a]">
          <div>
            <p className="text-[15px] font-semibold text-white">Invite by Email</p>
            <p className="text-[11px] text-[#555] mt-0.5">An invite link will be sent to their email.</p>
          </div>
          <button
            onClick={handleClose}
            className="w-7 h-7 rounded-full bg-[#1a1a1a] hover:bg-[#252525] flex items-center justify-center text-[#555] hover:text-white transition-colors ml-3"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>First name</label>
              <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)}
                placeholder="Jane" required className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Last name</label>
              <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)}
                placeholder="Smith" className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@restaurant.com" required className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "STAFF")}
              className={`${inputCls} appearance-none cursor-pointer`}>
              <option value="STAFF">User — can view &amp; enter data</option>
              <option value="ADMIN">Admin — full management access</option>
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={handleClose}
              className="flex-1 py-2.5 rounded-[8px] border border-[#1e1e1e] text-[#666] hover:text-white hover:border-[#2a2a2a] text-[13px] font-medium transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={!firstName.trim() || !email.trim() || busy}
              className="flex-1 py-2.5 rounded-[8px] bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-40 text-[13px] font-semibold text-white transition-colors">
              {busy ? "Sending…" : "Send Invite"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Create Directly modal ─────────────────────────────────────────────────────

function CreateModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [busy,     setBusy]     = useState(false);

  function reset() { setName(""); setEmail(""); setPassword(""); }
  function handleClose() { reset(); onClose(); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password || busy) return;
    setBusy(true);
    try {
      await teamApi.create({ name: name.trim(), email: email.trim(), password });
      toast.success(`${name.trim()} added to your team`);
      reset();
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? "Couldn't create account — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-200 ${
        open ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
      onClick={handleClose}
    >
      <div className="absolute inset-0 bg-black/70" />
      <div
        className={`relative w-full max-w-sm mx-4 bg-[#0d0d0d] border border-[#1e1e1e] rounded-[16px] shadow-2xl transform transition-all duration-200 ${
          open ? "scale-100 translate-y-0" : "scale-95 translate-y-4"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[#1a1a1a]">
          <div>
            <p className="text-[15px] font-semibold text-white">Create Account Directly</p>
            <p className="text-[11px] text-[#555] mt-0.5">Set a password and hand off credentials.</p>
          </div>
          <button onClick={handleClose}
            className="w-7 h-7 rounded-full bg-[#1a1a1a] hover:bg-[#252525] flex items-center justify-center text-[#555] hover:text-white transition-colors ml-3">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <div>
            <label className={labelCls}>Full name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Carlos López" required className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="carlos@restaurant.com" required className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Password</label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                minLength={8}
                required
                className={`${inputCls} pr-10`}
              />
              <button type="button" onClick={() => setShowPw((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-[#444] hover:text-[#888] transition-colors">
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
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={handleClose}
              className="flex-1 py-2.5 rounded-[8px] border border-[#1e1e1e] text-[#666] hover:text-white hover:border-[#2a2a2a] text-[13px] font-medium transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={!name.trim() || !email.trim() || password.length < 8 || busy}
              className="flex-1 py-2.5 rounded-[8px] bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-40 text-[13px] font-semibold text-white transition-colors">
              {busy ? "Creating…" : "Create Account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ProfilePage() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const toast    = useToast();

  // Role derivation
  const isOwner   = isAdmin && (user?.locationCount ?? 1) > 1;
  const isGM      = isAdmin && !isOwner;
  const roleLabel = isOwner ? "Owner" : isGM ? "General Manager" : "Staff";
  const roleTag   = isOwner ? "Partner" : isAdmin ? "Admin" : "User";

  // Team state
  const [members,       setMembers]       = useState<TeamMember[]>([]);
  const [loadingTeam,   setLoadingTeam]   = useState(isAdmin);
  const [inviteOpen,    setInviteOpen]    = useState(false);
  const [createOpen,    setCreateOpen]    = useState(false);
  const [removeTarget,  setRemoveTarget]  = useState<TeamMember | null>(null);
  const [removing,      setRemoving]      = useState(false);

  // Suggestion state
  const [suggestion, setSuggestion] = useState("");
  const [suggBusy,   setSuggBusy]   = useState(false);
  const [suggSent,   setSuggSent]   = useState(false);

  function loadTeam() {
    if (!isAdmin) return;
    setLoadingTeam(true);
    teamApi.list()
      .then(setMembers)
      .catch(() => toast.error("Failed to load team members"))
      .finally(() => setLoadingTeam(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadTeam(); }, []);

  async function handleRemove() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await teamApi.remove(removeTarget.id);
      setMembers((prev) => prev.filter((m) => m.id !== removeTarget.id));
      toast.success(`${removeTarget.name ?? removeTarget.email} removed from team`);
      setRemoveTarget(null);
    } catch {
      toast.error("Failed to remove team member");
    } finally {
      setRemoving(false);
    }
  }

  async function handleSendSuggestion() {
    if (!suggestion.trim() || suggBusy) return;
    setSuggBusy(true);
    try {
      await feedbackApi.submit(suggestion.trim());
      setSuggSent(true);
      setSuggestion("");
      toast.success("Thank you! Your suggestion was sent.");
      setTimeout(() => setSuggSent(false), 5000);
    } catch {
      toast.error("Couldn't send suggestion — please try again.");
    } finally {
      setSuggBusy(false);
    }
  }

  const initial = (user?.name ?? user?.email ?? "?")[0].toUpperCase();

  const rowCls = "flex items-start gap-3 py-2.5 border-b border-[#1a1a1a] last:border-0";
  const keyC   = "text-[12px] text-[#555] w-24 flex-shrink-0 pt-0.5";
  const valC   = "text-[13px] text-white font-medium";

  return (
    <div className="p-6 lg:p-8 space-y-4 max-w-3xl mx-auto">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 pb-2">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-[#555] hover:text-white text-[13px] font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <span className="text-[#2a2a2a]">/</span>
        <h1 className="text-[18px] font-semibold text-white">Profile</h1>
      </div>

      {/* ── BOX 1: Profile info ──────────────────────────────────────────── */}
      <Card title="Profile">
        {/* Avatar + name row */}
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-[#1a1a1a]">
          <div className="w-12 h-12 rounded-full bg-[#3dbf8a] flex items-center justify-center text-white text-[18px] font-bold flex-shrink-0">
            {initial}
          </div>
          <div>
            <p className="text-[15px] font-semibold text-white leading-snug">
              {user?.name ?? "—"}
            </p>
            <p className="text-[12px] text-[#555]">{user?.email}</p>
          </div>
        </div>

        {/* Detail rows */}
        <div className="divide-y divide-[#1a1a1a]">
          <div className={rowCls}>
            <span className={keyC}>Name</span>
            <span className={valC}>{user?.name ?? "—"}</span>
          </div>
          <div className={rowCls}>
            <span className={keyC}>Email</span>
            <span className={valC}>{user?.email}</span>
          </div>
          <div className={rowCls}>
            <span className={keyC}>Role</span>
            <span className={`${valC} inline-flex items-center`}>
              <span className="px-2 py-0.5 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] text-[11px] text-[#3dbf8a]">
                {roleTag}
              </span>
            </span>
          </div>
          <div className={rowCls}>
            <span className={keyC}>Position</span>
            <span className={valC}>{roleLabel}</span>
          </div>
          {user?.restaurantName && (
            <div className={rowCls}>
              <span className={keyC}>Restaurant</span>
              <span className={valC}>{user.restaurantName}</span>
            </div>
          )}
        </div>
      </Card>

      {/* ── BOX 2: Pending Invites (admin only) ─────────────────────────── */}
      {isAdmin && (
        <Card title="Pending Invites">
          <div className="flex flex-col items-center py-4 text-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#1a1a1a] flex items-center justify-center mb-1">
              <svg className="w-4 h-4 text-[#333]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-[13px] text-[#555]">No pending invites</p>
            <p className="text-[11px] text-[#333]">
              Sent invites will appear here once invite tracking is enabled.
            </p>
          </div>
        </Card>
      )}

      {/* ── BOX 3: Team Management (admin only) ─────────────────────────── */}
      {isAdmin && (
        <Card
          title="Team"
          action={
            <span className="text-[11px] text-[#444]">
              {!loadingTeam && `${members.length} member${members.length !== 1 ? "s" : ""}`}
            </span>
          }
        >
          {/* Action buttons */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setInviteOpen(true)}
              className="flex-1 py-2 rounded-[8px] border border-[#2a2a2a] text-[12px] font-medium text-[#888] hover:text-white hover:border-[#3a3a3a] transition-colors flex items-center justify-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Invite by Email
            </button>
            <button
              onClick={() => setCreateOpen(true)}
              className="flex-1 py-2 rounded-[8px] border border-[#2a2a2a] text-[12px] font-medium text-[#888] hover:text-white hover:border-[#3a3a3a] transition-colors flex items-center justify-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              Create Directly
            </button>
          </div>

          {/* Member list */}
          {loadingTeam ? (
            <div className="flex items-center justify-center py-8">
              <Spinner size="lg" />
            </div>
          ) : members.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-[13px] text-[#555]">No team members yet.</p>
            </div>
          ) : (
            <div className="space-y-0 -mx-5 border-t border-[#1a1a1a]">
              {members.map((m) => {
                const isSelf = m.id === user?.id;
                return (
                  <div
                    key={m.id}
                    className="flex items-center gap-3 px-5 py-3 border-b border-[#1a1a1a] last:border-0 hover:bg-[#0a0a0a] transition-colors"
                  >
                    {/* Avatar */}
                    <div className="w-7 h-7 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0">
                      {(m.name ?? m.email)[0].toUpperCase()}
                    </div>

                    {/* Info — takes remaining space */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-white truncate">
                        {m.name ?? "—"}
                        {isSelf && (
                          <span className="ml-1.5 text-[11px] text-[#444]">(you)</span>
                        )}
                      </p>
                      <p className="text-[11px] text-[#555] truncate">{m.email}</p>
                    </div>

                    {/* Role pill — fixed width so badges align vertically */}
                    <div className="w-14 flex justify-end flex-shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          m.role === "ADMIN"
                            ? "bg-[#3dbf8a]/10 text-[#3dbf8a] border border-[#3dbf8a]/20"
                            : "bg-[#1a1a1a] text-[#555] border border-[#2a2a2a]"
                        }`}
                      >
                        {m.role === "ADMIN" ? "Admin" : "User"}
                      </span>
                    </div>

                    {/* Remove — fixed width so icon aligns vertically */}
                    <div className="w-7 flex justify-end flex-shrink-0">
                      {!isSelf && (
                        <button
                          onClick={() => setRemoveTarget(m)}
                          title="Remove from team"
                          className="w-7 h-7 rounded-[6px] text-[#333] hover:text-red-400 hover:bg-red-950/30 flex items-center justify-center transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* ── BOX 4: Suggestions ──────────────────────────────────────────── */}
      <Card title="Have a suggestion? Let us know!">
        <p className="text-[12px] text-[#555] mb-3">Your feedback goes directly to Israel.</p>

        {suggSent ? (
          <div className="flex items-center gap-2 px-3.5 py-3 rounded-[8px] bg-[#3dbf8a]/10 border border-[#3dbf8a]/20 text-[#3dbf8a] text-[13px]">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Thank you! Your suggestion was sent.
          </div>
        ) : (
          <div className="space-y-2">
            <textarea
              value={suggestion}
              onChange={(e) => setSuggestion(e.target.value)}
              placeholder="Share an idea or report an issue…"
              rows={3}
              className="w-full px-3 py-2.5 rounded-[8px] border border-[#1e1e1e] bg-[#0a0a0a] text-white text-[13px] placeholder-[#333] focus:outline-none focus:border-[#3dbf8a]/50 transition-colors resize-none"
            />
            <button
              onClick={handleSendSuggestion}
              disabled={!suggestion.trim() || suggBusy}
              className="w-full py-2.5 rounded-[8px] bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-40 text-[13px] font-semibold text-white transition-colors"
            >
              {suggBusy ? "Sending…" : "Send to Israel"}
            </button>
          </div>
        )}
      </Card>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSuccess={loadTeam}
      />
      <CreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={loadTeam}
      />
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
