import React, { Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { SocketProvider } from "./context/SocketContext";
import { SuperAdminProvider, useSuperAdmin } from "./context/SuperAdminContext";
import { Layout } from "./components/Layout";
import { Login } from "./components/Login";
import { Register } from "./components/Register";
import { Dashboard } from "./components/Dashboard";
import { ProductList } from "./components/ProductList";
import { StockPage } from "./components/StockPage";
import { OrderList } from "./components/OrderList";
import { SalesPage } from "./components/SalesPage";
import { LaborPage } from "./components/LaborPage";
import { TeamPage } from "./components/TeamPage";
import { CountsPage } from "./components/CountsPage";
import { CountSessionDetail } from "./components/CountSessionDetail";
import { CountReportView } from "./components/CountReportView";
import { RecipesPage } from "./components/RecipesPage";
import { MultiLocationOverview } from "./components/MultiLocationOverview";
import { ResetPassword } from "./components/ResetPassword";
import { PartnerSetup } from "./components/PartnerSetup";
import { SuperAdminLogin } from "./components/superadmin/SuperAdminLogin";
import { SuperAdminLayout } from "./components/superadmin/SuperAdminLayout";
import { SuperAdminDashboard } from "./components/superadmin/SuperAdminDashboard";
import { SuperAdminPartnerDetail } from "./components/superadmin/SuperAdminPartnerDetail";
import { Spinner } from "./components/shared/Spinner";
import { ToastProvider } from "./context/ToastContext";
import { ToastContainer } from "./components/shared/Toast";
import { LanguageProvider } from "./context/LanguageContext";

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
  if (!isAuthenticated) {
    const setupToken = localStorage.getItem("partnerSetupToken");
    if (setupToken) return <Navigate to={`/partner-setup?token=${encodeURIComponent(setupToken)}`} replace />;
    return <Navigate to="/login" replace />;
  }
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

// ── Super Admin guards ────────────────────────────────────────────────────────

function SAProtectedRoute() {
  const { isAuthenticated, bootstrapping } = useSuperAdmin();
  if (bootstrapping) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
  if (!isAuthenticated) return <Navigate to="/super-admin/login" replace />;
  return <Outlet />;
}

function SAPublicRoute() {
  const { isAuthenticated, bootstrapping } = useSuperAdmin();
  if (bootstrapping) return null;
  if (isAuthenticated) return <Navigate to="/super-admin" replace />;
  return <Outlet />;
}

function AppRoutes() {
  return (
    <BootstrapGate>
      <Routes>
        {/* Fully public — accessible whether logged in or not */}
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/partner-setup"  element={<PartnerSetup />} />

        <Route element={<PublicRoute />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
        </Route>
        <Route element={<ProtectedRoutes />}>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="multi-location" element={<MultiLocationOverview />} />
            <Route path="products" element={<ProductList />} />
            <Route path="stock" element={<StockPage />} />
            <Route path="orders" element={<OrderList />} />
            <Route
              path="reports"
              element={
                <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Spinner size="lg" /></div>}>
                  <Reports />
                </Suspense>
              }
            />
            {/* Inventory + Recipes — available to all authenticated users (ADMIN + STAFF) */}
            <Route path="inventory"             element={<CountsPage />} />
            <Route path="inventory/:id"         element={<CountSessionDetail />} />
            <Route path="inventory/:id/report"  element={<CountReportView />} />
            <Route path="recipes"               element={<RecipesPage />} />

            <Route element={<AdminRoute />}>
              <Route path="sales" element={<SalesPage />} />
              <Route path="labor" element={<LaborPage />} />
              <Route path="team" element={<TeamPage />} />
            </Route>
          </Route>
        </Route>

        {/* ── Super Admin portal — completely separate from regular auth ── */}
        <Route path="super-admin">
          <Route element={<SAPublicRoute />}>
            <Route path="login" element={<SuperAdminLogin />} />
          </Route>
          <Route element={<SAProtectedRoute />}>
            <Route element={<SuperAdminLayout />}>
              <Route index element={<SuperAdminDashboard />} />
              <Route path="partners/:id" element={<SuperAdminPartnerDetail />} />
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
    <LanguageProvider>
      <ThemeProvider>
        <AuthProvider>
          <SuperAdminProvider>
            <SocketProvider>
              <ToastProvider>
                <BrowserRouter>
                  <AppRoutes />
                </BrowserRouter>
                <ToastContainer />
              </ToastProvider>
            </SocketProvider>
          </SuperAdminProvider>
        </AuthProvider>
      </ThemeProvider>
    </LanguageProvider>
  );
}
// Force redeploy
// Fixed git config
