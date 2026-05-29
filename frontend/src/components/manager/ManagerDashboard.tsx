import React from "react";
import { useNavigate } from "react-router-dom";
import { useManager } from "../../context/ManagerContext";

export function ManagerDashboard() {
  const { mgrUser, logout } = useManager();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/manager/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6">
      {/* Logo */}
      <img
        src={process.env.PUBLIC_URL + '/kyru-logo-vertical.svg'}
        alt="Kyru"
        className="object-contain mb-10"
        style={{ width: '120px', height: 'auto' }}
      />

      <div className="text-center space-y-2">
        <h1 className="text-[28px] font-semibold text-white">Manager Dashboard</h1>
        <p className="text-[15px] text-[#555]">
          Welcome, <span className="text-[#3dbf8a]">{mgrUser?.name ?? mgrUser?.email ?? "Manager"}</span>
        </p>
      </div>

      <div className="mt-10 bg-[#0a0a0a] border border-[#1a1a1a] rounded-[12px] px-6 py-4 text-center">
        <p className="text-[13px] text-[#444]">Phase 5 will build the full dashboard here.</p>
      </div>

      <button
        onClick={handleLogout}
        className="mt-8 text-[12px] text-[#333] hover:text-[#555] transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}
