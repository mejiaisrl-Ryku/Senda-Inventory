import React, { useEffect, useState } from "react";
import { Product } from "../types";
import { productsApi } from "../api";
import { LowStockAlerts } from "./LowStockAlerts";
import { StockHistory } from "./StockHistory";
import { StockAdjustForm } from "./StockAdjustForm";
import { Modal } from "./shared/Modal";

type Tab = "alerts" | "adjust" | "history";

export function StockPage() {
  const [tab, setTab] = useState<Tab>("alerts");
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [adjustModal, setAdjustModal] = useState(false);

  useEffect(() => {
    productsApi.list().then(setProducts);
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: "alerts", label: "Alerts" },
    { id: "adjust", label: "Quick Adjust" },
    { id: "history", label: "History" },
  ];

  const inputClass = "w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Stock</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Manage inventory movements</p>
        </div>
        <button
          onClick={() => { setSelectedProduct(null); setAdjustModal(true); }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-xl transition-colors"
        >
          Adjust Stock
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? "border-brand-500 text-brand-600 dark:text-brand-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "alerts" && <LowStockAlerts />}

      {tab === "adjust" && (
        <div className="max-w-md space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Select product</label>
            <select
              className={inputClass}
              value={selectedProduct?.id ?? ""}
              onChange={(e) => {
                const p = products.find((x) => x.id === e.target.value) ?? null;
                setSelectedProduct(p);
              }}
            >
              <option value="">— choose a product —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          {selectedProduct && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
              <StockAdjustForm
                product={selectedProduct}
                onDone={() => setSelectedProduct(null)}
                onCancel={() => setSelectedProduct(null)}
              />
            </div>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Select product</label>
            <select
              className={inputClass + " max-w-md"}
              value={selectedProduct?.id ?? ""}
              onChange={(e) => {
                const p = products.find((x) => x.id === e.target.value) ?? null;
                setSelectedProduct(p);
              }}
            >
              <option value="">— choose a product —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          {selectedProduct && (
            <StockHistory productId={selectedProduct.id} productName={selectedProduct.name} />
          )}
        </div>
      )}

      <Modal open={adjustModal} onClose={() => setAdjustModal(false)} title="Adjust Stock">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Select product</label>
            <select
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              value={selectedProduct?.id ?? ""}
              onChange={(e) => {
                const p = products.find((x) => x.id === e.target.value) ?? null;
                setSelectedProduct(p);
              }}
            >
              <option value="">— choose a product —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          {selectedProduct && (
            <StockAdjustForm
              product={selectedProduct}
              onDone={() => { setAdjustModal(false); setSelectedProduct(null); }}
              onCancel={() => { setAdjustModal(false); setSelectedProduct(null); }}
            />
          )}
        </div>
      </Modal>
    </div>
  );
}
