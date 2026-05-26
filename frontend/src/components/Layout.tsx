import React, { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage, LangToggle } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import { feedbackApi, teamApi } from "../api";

// ── Profile slide-up modal ────────────────────────────────────────────────────

/** One row in the navigation menu inside the modal */
function NavItem({
  icon,
  label,
  shortcut,
  danger,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-[8px] text-[13px] font-medium transition-colors text-left group
        ${danger
          ? "text-[#555] hover:text-red-400 hover:bg-red-950/30"
          : "text-[#888] hover:text-white hover:bg-[#1a1a1a]"
        }`}
    >
      <span className={`w-4 h-4 flex-shrink-0 ${danger ? "group-hover:text-red-400" : "group-hover:text-[#3dbf8a]"}`}>
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      {shortcut && (
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1a1a1a] text-[#444] border border-[#2a2a2a]">
          {shortcut}
        </span>
      )}
    </button>
  );
}

// ── Add Team Members modal ────────────────────────────────────────────────────

function AddTeamMembersModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [firstName, setFirstName] = useState("");
  const [lastName,  setLastName]  = useState("");
  const [email,     setEmail]     = useState("");
  const [role,      setRole]      = useState<"ADMIN" | "STAFF">("STAFF");
  const [busy,      setBusy]      = useState(false);

  function reset() {
    setFirstName(""); setLastName(""); setEmail(""); setRole("STAFF");
  }

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
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? "Couldn't send invite — please try again.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full px-3 py-2.5 rounded-[8px] border border-[#1e1e1e] bg-[#0a0a0a] text-white text-[13px] placeholder-[#333] focus:outline-none focus:border-[#3dbf8a]/50 transition-colors";

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center transition-opacity duration-200 ${
        open ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
      onClick={handleClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" />

      {/* Card */}
      <div
        className={`relative w-full max-w-sm mx-4 bg-[#0d0d0d] border border-[#1e1e1e] rounded-[16px] shadow-2xl transform transition-all duration-200 ${
          open ? "scale-100 translate-y-0" : "scale-95 translate-y-4"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[#1a1a1a]">
          <div>
            <p className="text-[15px] font-semibold text-white">Add Team Member</p>
            <p className="text-[11px] text-[#555] mt-0.5">An invite link will be sent to their email.</p>
          </div>
          <button
            onClick={handleClose}
            aria-label="Close"
            className="w-7 h-7 rounded-full bg-[#1a1a1a] hover:bg-[#252525] flex items-center justify-center text-[#555] hover:text-white transition-colors ml-3 flex-shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          {/* First + Last name row */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-[#666]">First name</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Jane"
                required
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-[#666]">Last name</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Smith"
                className={inputClass}
              />
            </div>
          </div>

          {/* Email */}
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-[#666]">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@restaurant.com"
              required
              className={inputClass}
            />
          </div>

          {/* Role */}
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-[#666]">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "ADMIN" | "STAFF")}
              className={`${inputClass} appearance-none cursor-pointer`}
            >
              <option value="STAFF">User — can view &amp; enter data</option>
              <option value="ADMIN">Admin — full management access</option>
            </select>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 py-2.5 rounded-[8px] border border-[#1e1e1e] text-[#666] hover:text-white hover:border-[#2a2a2a] text-[13px] font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!firstName.trim() || !email.trim() || busy}
              className="flex-1 py-2.5 rounded-[8px] bg-[#3dbf8a] hover:bg-[#35a87a] disabled:opacity-40 text-[13px] font-semibold text-white transition-colors"
            >
              {busy ? "Sending…" : "Send Invite"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Profile slide-up modal ────────────────────────────────────────────────────

function ProfileModal({
  open,
  onClose,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  onLogout: () => void;
}) {
  const { user, isAdmin } = useAuth();
  const navigate    = useNavigate();
  const toast       = useToast();

  const [suggestion,    setSuggestion]    = useState("");
  const [suggSent,      setSuggSent]      = useState(false);
  const [suggBusy,      setSuggBusy]      = useState(false);
  const [addTeamOpen,   setAddTeamOpen]   = useState(false);

  // Role tier
  const isOwner   = isAdmin && (user?.locationCount ?? 1) > 1;
  const isGM      = isAdmin && !isOwner;
  const roleLabel = isOwner ? "Owner" : isGM ? "General Manager" : "Staff";

  // ── Nav actions ────────────────────────────────────────────────────────────
  function go(path: string) { onClose(); navigate(path); }

  function handleToggleTheme() {
    onClose();
    toast.success("Light theme coming soon — dark mode is the default for now");
  }

  // ── Suggestions ────────────────────────────────────────────────────────────
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

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end transition-opacity duration-300 ${
        open ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Add Team Members modal — z-[60] sits above this modal's z-50 */}
      <AddTeamMembersModal open={addTeamOpen} onClose={() => setAddTeamOpen(false)} />

      {/* Sheet — 65 vh */}
      <div
        className={`relative w-full bg-[#0d0d0d] border-t border-[#1e1e1e] rounded-t-[20px] flex flex-col transform transition-transform duration-300 ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ height: "65vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Handle + close ─────────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex items-center px-5 pt-4 pb-2">
          <div className="flex-1" />
          <div className="w-10 h-1 rounded-full bg-[#2a2a2a]" />
          <div className="flex-1 flex justify-end">
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-7 h-7 rounded-full bg-[#1a1a1a] hover:bg-[#252525] flex items-center justify-center text-[#555] hover:text-white transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto pb-8">

          {/* ── Profile header ──────────────────────────────────────────── */}
          <div className="px-5 pt-2 pb-4 border-b border-[#1a1a1a]">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-[#3dbf8a] flex items-center justify-center text-white text-[17px] font-bold flex-shrink-0">
                {initial}
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-white leading-snug truncate">
                  {user?.name ?? user?.email}
                </p>
                <p className="text-[12px] text-[#555] truncate">{user?.email}</p>
              </div>
            </div>

            {/* Role + restaurant pills */}
            <div className="flex flex-wrap gap-1.5 mt-3">
              <span className="px-2 py-0.5 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] text-[11px] text-[#888]">
                {roleLabel}
              </span>
              {user?.restaurantName && (
                <span className="px-2 py-0.5 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] text-[11px] text-[#888] truncate max-w-[160px]">
                  {user.restaurantName}
                </span>
              )}
            </div>
          </div>

          {/* ── Admin action buttons ──────────────────────────────────────── */}
          {isAdmin && (
            <div className="px-5 pt-3 pb-3 border-b border-[#1a1a1a] flex gap-2">
              <button
                className="flex-1 py-2 rounded-[8px] border border-[#2a2a2a] text-[12px] font-medium text-[#888] hover:text-white hover:border-[#3a3a3a] transition-colors"
                onClick={() => toast.success("Settings coming soon")}
              >
                Settings
              </button>
              <button
                className="flex-1 py-2 rounded-[8px] bg-[#3dbf8a] hover:bg-[#35a87a] text-[12px] font-semibold text-white transition-colors"
                onClick={() => setAddTeamOpen(true)}
              >
                Add Team Members
              </button>
            </div>
          )}

          {/* ── Navigation menu ──────────────────────────────────────────── */}
          <div className="px-3 py-3 border-b border-[#1a1a1a] space-y-0.5">
            {/* My profile */}
            <NavItem
              label="My profile"
              icon={
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              }
              onClick={() => { onClose(); toast.success("Profile page coming soon"); }}
            />

            {/* Toggle theme */}
            <NavItem
              label="Toggle theme"
              shortcut="M"
              icon={
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              }
              onClick={handleToggleTheme}
            />

            {/* Homepage */}
            <NavItem
              label="Homepage"
              icon={
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
              }
              onClick={() => go("/")}
            />

            {/* Onboarding */}
            <NavItem
              label="Onboarding"
              icon={
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              }
              onClick={() => go("/")}
            />

            {/* Log out */}
            <NavItem
              label="Log out"
              danger
              icon={
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              }
              onClick={onLogout}
            />
          </div>

          {/* ── Suggestions box ───────────────────────────────────────────── */}
          <div className="px-5 pt-5 pb-2">
            <p className="text-[13px] font-semibold text-white mb-0.5">
              Have a suggestion? Let us know!
            </p>
            <p className="text-[11px] text-[#555] mb-3">
              Your feedback goes directly to Israel.
            </p>

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
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Nav structure ─────────────────────────────────────────────────────────────

interface NavItem {
  to: string;
  labelKey: string;
  adminOnly?: boolean;
  icon: React.ReactNode;
}

interface NavGroup {
  headerKey?: string;    // translation key for the section header
  adminOnly?: boolean;
  items: NavItem[];
}

// Icons are 16px (w-4 h-4) per spec
const navGroups: NavGroup[] = [
  {
    items: [
      {
        to: "/",
        labelKey: "dashboard",
        icon: (
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        ),
      },
      {
        to: "/multi-location",
        labelKey: "multiLocation",
        icon: (
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
      {
        to: "/products",
        labelKey: "invoices",
        icon: (
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
          </svg>
        ),
      },
      {
        to: "/stock",
        labelKey: "stock",
        icon: (
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        ),
      },
      {
        to: "/orders",
        labelKey: "orders",
        icon: (
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        ),
      },
      {
        to: "/inventory",
        labelKey: "inventory",
        icon: (
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
        ),
      },
      {
        to: "/recipes",
        labelKey: "recipes",
        icon: (
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        ),
      },
    ],
  },
  {
    headerKey: "adminSection",
    items: [
      {
        to: "/sales",
        labelKey: "sales",
        adminOnly: true,
        icon: (
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
      },
      {
        to: "/labor",
        labelKey: "labor",
        adminOnly: true,
        icon: (
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        ),
      },
      {
        to: "/reports",
        labelKey: "reports",
        icon: (
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        ),
      },
      {
        to: "/team",
        labelKey: "team",
        adminOnly: true,
        icon: (
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
    ],
  },
];

// ── Nav item class builders ────────────────────────────────────────────────────

function navItemClass(isActive: boolean) {
  const base =
    "flex items-center gap-2.5 w-full pl-[10px] pr-3 py-2 rounded-[6px] text-[13px] font-medium transition-colors min-h-[44px] lg:min-h-0 outline-none border-l-2";
  return isActive
    ? `${base} bg-[#1a1a1a] text-white border-[#3dbf8a]`
    : `${base} text-[#888] hover:text-white hover:bg-[#111] border-transparent`;
}

function collapsedNavItemClass(isActive: boolean) {
  const base =
    "flex items-center justify-center w-full py-2.5 rounded-[6px] transition-colors outline-none border-l-2";
  return isActive
    ? `${base} bg-[#1a1a1a] text-white border-[#3dbf8a]`
    : `${base} text-[#888] hover:text-white hover:bg-[#111] border-transparent`;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

interface SidebarContentProps {
  onNavClick?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

function SidebarContent({ onNavClick, collapsed = false, onToggleCollapse }: SidebarContentProps) {
  const { user, logout, isAdmin } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);

  function handleLogout() {
    setProfileOpen(false);
    logout();
    navigate("/login");
  }

  function filterItems(items: NavItem[]) {
    return items.filter(({ adminOnly }) => !adminOnly || isAdmin);
  }

  const navT = t.nav as Record<string, string>;

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className={`${collapsed ? 'px-2 flex justify-center' : 'px-5 flex justify-center'} pt-8 pb-6 border-b border-[#1a1a1a]`}>
        {collapsed ? (
          <img
            src={process.env.PUBLIC_URL + '/kyru-logo-icon.svg'}
            alt="Kyru"
            className="object-contain"
            style={{ width: '32px', height: 'auto' }}
          />
        ) : (
          <img
            src={process.env.PUBLIC_URL + '/kyru-logo-horizontal.svg'}
            alt="Kyru"
            className="object-contain"
            style={{ width: '140px', height: 'auto' }}
          />
        )}
      </div>

      {/* Nav */}
      <nav className={`flex-1 ${collapsed ? 'px-1.5' : 'px-3'} py-3 space-y-4 overflow-y-auto`}>
        {navGroups.map((group, gi) => {
          const visible = filterItems(group.items);
          if (visible.length === 0) return null;
          return (
            <div key={gi}>
              {!collapsed && group.headerKey && (
                <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#444]">
                  {navT[group.headerKey] ?? group.headerKey}
                </p>
              )}
              <div className="space-y-0.5">
                {visible.map(({ to, labelKey, icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === "/"}
                    onClick={onNavClick}
                    className={({ isActive }) =>
                      collapsed ? collapsedNavItemClass(isActive) : navItemClass(isActive)
                    }
                  >
                    {icon}
                    {!collapsed && (navT[labelKey] ?? labelKey)}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Bottom: collapse toggle + user + lang toggle */}
      <div className={`${collapsed ? 'px-1.5' : 'px-3'} py-3 border-t border-[#1a1a1a] space-y-0.5`}>
        {/* Collapse toggle — desktop only */}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2.5 pl-[10px] pr-3'} w-full py-2 rounded-[6px] text-[#555] hover:text-white hover:bg-[#111] transition-colors`}
          >
            <svg
              className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
            {!collapsed && (
              <span className="text-[13px] font-medium">Collapse</span>
            )}
          </button>
        )}

        {/* User row — avatar + first name, clickable → profile modal */}
        <button
          onClick={() => setProfileOpen(true)}
          className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2.5 pl-[10px] pr-3'} w-full py-2 rounded-[6px] text-[#888] hover:text-white hover:bg-[#111] transition-colors`}
        >
          <div className="w-5 h-5 rounded-full bg-[#3dbf8a] flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
            {(user?.name ?? user?.email ?? "?")[0].toUpperCase()}
          </div>
          {!collapsed && (
            <span className="text-[13px] font-medium text-white truncate">
              {user?.name ? user.name.split(" ")[0] : user?.email}
            </span>
          )}
        </button>

        {/* Language toggle — below the user name */}
        {!collapsed && (
          <div className="pl-[10px] pt-1 pb-0.5">
            <LangToggle />
          </div>
        )}
      </div>

      {/* Profile modal */}
      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onLogout={handleLogout}
      />
    </div>
  );
}

// ── Layout shell ──────────────────────────────────────────────────────────────

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuth();
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-black flex">
      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex lg:flex-shrink-0 ${collapsed ? 'w-[60px]' : 'w-[220px]'} border-r border-[#1a1a1a] bg-[#0a0a0a] flex-col transition-[width] duration-200`}
      >
        <SidebarContent
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
        />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative w-[220px] max-w-[85vw] h-full bg-[#0a0a0a] border-r border-[#1a1a1a] flex flex-col shadow-2xl">
            <SidebarContent onNavClick={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar — always visible (desktop + mobile) */}
        <header className="flex items-center gap-3 px-4 h-12 bg-[#0a0a0a] border-b border-[#1a1a1a] flex-shrink-0">
          {/* Mobile: hamburger */}
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation menu"
            className="lg:hidden flex items-center justify-center w-8 h-8 text-[#888] hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Mobile: restaurant name */}
          <span className="lg:hidden text-[14px] font-semibold text-white truncate">
            {user?.restaurantName ?? "Inventory"}
          </span>

          {/* Role pill — mobile only */}
          {user && (
            <span className="lg:hidden ml-auto mr-2 text-[11px] px-2 py-0.5 rounded-full bg-[#1a1a1a] text-[#888]">
              {user.role === "ADMIN" ? t.ui.adminRole : t.ui.userRole}
            </span>
          )}

          {/* Spacer for desktop */}
          <div className="hidden lg:block flex-1" />

          {/* Language toggle — top-right (always visible) */}
          <LangToggle className="ml-auto lg:ml-0" />
        </header>

        <main className="flex-1 overflow-auto bg-black">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
