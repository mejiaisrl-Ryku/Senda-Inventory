import React from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useSuperAdmin } from "../../context/SuperAdminContext";

function navCls(isActive: boolean) {
  const base =
    "flex items-center gap-2.5 w-full pl-[10px] pr-3 py-2 rounded-[6px] text-[13px] font-medium transition-colors outline-none border-l-2";
  return isActive
    ? `${base} bg-[#1a1a1a] text-white border-[#3dbf8a]`
    : `${base} text-[#888] hover:text-white hover:bg-[#111] border-transparent`;
}

function SidebarContent() {
  const { saUser, logout } = useSuperAdmin();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/super-admin/login", { replace: true });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 pt-8 pb-6 border-b border-[#1a1a1a]">
        <img
          src={process.env.PUBLIC_URL + '/kyru-logo-horizontal.svg'}
          alt="Kyru"
          className="object-contain"
          style={{ width: '140px', height: 'auto' }}
        />
        {/* Super admin badge */}
        <div className="mt-3">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-[0.08em] uppercase bg-[#3dbf8a]/10 text-[#3dbf8a] border border-[#3dbf8a]/20">
            Super Admin
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        <NavLink to="/super-admin" end className={({ isActive }) => navCls(isActive)}>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          Dashboard
        </NavLink>
      </nav>

      {/* Bottom: logout + user */}
      <div className="px-3 py-3 border-t border-[#1a1a1a] space-y-0.5">
        <button onClick={handleLogout} className={navCls(false)}>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Log Out
        </button>
        <div className="flex items-center gap-2.5 px-3 py-2 mt-1">
          <div className="w-6 h-6 rounded-full bg-[#3dbf8a] flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
            {(saUser?.name ?? saUser?.email ?? "S")[0].toUpperCase()}
          </div>
          <p className="text-[12px] font-medium text-white truncate">
            {saUser?.name?.split(" ")[0] ?? saUser?.email}
          </p>
        </div>
      </div>
    </div>
  );
}

export function SuperAdminLayout() {
  return (
    <div className="min-h-screen bg-black flex">
      {/* Sidebar */}
      <aside className="hidden lg:flex lg:flex-shrink-0 w-[220px] border-r border-[#1a1a1a] bg-[#0a0a0a] flex-col">
        <SidebarContent />
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center px-4 h-14 bg-[#0a0a0a] border-b border-[#1a1a1a] flex-shrink-0">
          <img src={process.env.PUBLIC_URL + '/kyru-logo-horizontal.svg'} alt="Kyru" className="h-7 w-auto object-contain" />
        </header>
        <main className="flex-1 overflow-auto bg-black">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
