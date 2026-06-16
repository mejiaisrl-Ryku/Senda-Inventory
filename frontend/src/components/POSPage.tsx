import React from "react";
import { POSIntegrations } from "./POSIntegrations";
import { ToastTransactionSync } from "./ToastTransactionSync";

export function POSPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-white">POS Integrations</h1>
        <p className="text-[13px] text-[#555] mt-0.5">
          Connect your point-of-sale system to import sales and transactions automatically.
        </p>
      </div>

      <POSIntegrations />
      <ToastTransactionSync />
    </div>
  );
}
