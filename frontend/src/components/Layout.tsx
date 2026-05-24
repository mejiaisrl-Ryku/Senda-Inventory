import React, { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage, LangToggle } from "../context/LanguageContext";

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

// ── Shared nav item class builder ─────────────────────────────────────────────

function navItemClass(isActive: boolean) {
  const base =
    "flex items-center gap-2.5 w-full pl-[10px] pr-3 py-2 rounded-[6px] text-[13px] font-medium transition-colors min-h-[44px] lg:min-h-0 outline-none border-l-2";
  return isActive
    ? `${base} bg-[#1a1a1a] text-white border-[#3dbf8a]`
    : `${base} text-[#888] hover:text-white hover:bg-[#111] border-transparent`;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function SidebarContent({ onNavClick }: { onNavClick?: () => void }) {
  const { user, logout, isAdmin } = useAuth();
  const { t } = useLanguage();
  const restaurantLogo = user?.restaurantLogo ?? null;
  const navigate = useNavigate();

  function handleLogout() {
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
      <div className="px-5 pt-8 pb-6 border-b border-[#1a1a1a]">
        <div className="flex flex-col gap-3">
          <img
            src="/kyru-logo-horizontal.svg"
            alt="Kyru"
            className="h-8 w-auto object-contain"
          />
          {restaurantLogo && (
            <img
              src={restaurantLogo}
              alt={user?.restaurantName ?? "Restaurant logo"}
              className="h-10 w-auto object-contain flex-shrink-0"
            />
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-4 overflow-y-auto">
        {navGroups.map((group, gi) => {
          const visible = filterItems(group.items);
          if (visible.length === 0) return null;
          return (
            <div key={gi}>
              {group.headerKey && (
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
                    className={({ isActive }) => navItemClass(isActive)}
                  >
                    {icon}
                    {navT[labelKey] ?? labelKey}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Bottom: logout + user + lang toggle */}
      <div className="px-3 py-3 border-t border-[#1a1a1a] space-y-0.5">
        {/* Log out */}
        <button onClick={handleLogout} className={navItemClass(false)}>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          {t.nav.logOut}
        </button>

        {/* User row + language toggle */}
        <div className="flex items-center gap-2.5 px-3 py-2 mt-1">
          <div className="w-6 h-6 rounded-full bg-[#3dbf8a] flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
            {(user?.name ?? user?.email ?? "?")[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium text-white truncate">
              {user?.name ? user.name.split(" ")[0] : user?.email}
            </p>
          </div>
          {/* Language toggle — bottom-left near user */}
          <LangToggle />
        </div>
      </div>
    </div>
  );
}

// ── Layout shell ──────────────────────────────────────────────────────────────

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-black flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-shrink-0 w-[220px] border-r border-[#1a1a1a] bg-[#0a0a0a] flex-col">
        <SidebarContent />
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
