import React, { Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { SocketProvider } from "./context/SocketContext";
import { Layout } from "./components/Layout";
import { Login } from "./components/Login";
import { Register } from "./components/Register";
import { Dashboard } from "./components/Dashboard";
import { ProductList } from "./components/ProductList";
import { StockPage } from "./components/StockPage";
import { OrderList } from "./components/OrderList";
import { SalesPage } from "./components/SalesPage";
import { TeamPage } from "./components/TeamPage";
import { Spinner } from "./components/shared/Spinner";
import { ToastProvider } from "./context/ToastContext";
import { ToastContainer } from "./components/shared/Toast";

const Reports = React.lazy(() =>
  import("./components/Reports").then((m) => ({ default: m.Reports }))
);

function BootstrapGate({ children }: { children: React.ReactNode }) {
  const { bootstrapping } = useAuth();
  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }
  return <>{children}</>;
}

function ProtectedRoutes() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function AdminRoute() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}

function PublicRoute() {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <Outlet />;
}

function AppRoutes() {
  return (
    <BootstrapGate>
      <Routes>
        <Route element={<PublicRoute />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
        </Route>
        <Route element={<ProtectedRoutes />}>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="products" element={<ProductList />} />
            <Route path="stock" element={<StockPage />} />
            <Route path="orders" element={<OrderList />} />
            <Route path="sales" element={<SalesPage />} />
            <Route element={<AdminRoute />}>
              <Route
                path="reports"
                element={
                  <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Spinner size="lg" /></div>}>
                    <Reports />
                  </Suspense>
                }
              />
              <Route path="team" element={<TeamPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BootstrapGate>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SocketProvider>
          <ToastProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
            <ToastContainer />
          </ToastProvider>
        </SocketProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
// Force redeploy
// Fixed git config
