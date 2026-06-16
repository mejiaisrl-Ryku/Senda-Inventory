import React from "react";
import { ToastConnectButton } from "./ToastConnectButton";

export function POSIntegrations() {
  return (
    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl p-5">
      <h2 className="text-[13px] font-semibold text-[#888] mb-1 uppercase tracking-[0.08em]">
        POS Integrations
      </h2>
      <p className="text-[12px] text-[#444] mb-4">
        Connect your point-of-sale system to import sales automatically.
      </p>

      <div className="space-y-3">
        {/* Toast POS */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-[#0d0d0d] border border-[#1e1e1e]">
          <div>
            <p className="text-[13px] font-medium text-white">Toast POS</p>
            <p className="text-[11px] text-[#555] mt-0.5">Import transactions and menu items in real-time</p>
          </div>
          <ToastConnectButton />
        </div>

        {/* Square — placeholder */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-[#0d0d0d] border border-[#1a1a1a] opacity-40">
          <div>
            <p className="text-[13px] font-medium text-white">Square</p>
            <p className="text-[11px] text-[#555] mt-0.5">Coming soon</p>
          </div>
          <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-md bg-[#1a1a1a] text-[#444] border border-[#252525]">
            Coming Soon
          </span>
        </div>
      </div>
    </div>
  );
}
