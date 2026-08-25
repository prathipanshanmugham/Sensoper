import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { Toaster } from "./components/ui/sonner";
import PwaInstaller from "./components/PwaInstaller";

// Pages
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import ProjectList from "./pages/ProjectList";
import ProjectDetails from "./pages/ProjectDetails";
import SiteVisitForm from "./pages/SiteVisitForm";
import UserManagement from "./pages/UserManagement";
import TermsConditions from "./pages/TermsConditions";
import InventoryManagement from "./pages/InventoryManagement";
import MaterialKitsPage from "./pages/MaterialKitsPage";
import ExpansionPage from "./pages/ExpansionPage";
import PricingConfig from "./pages/PricingConfig";
import DirectSalesPage from "./pages/DirectSalesPage";
import AuditLogs from "./pages/AuditLogs";
import CompanyProfile from "./pages/CompanyProfile";
import ApprovalsPage from "./pages/ApprovalsPage";
import PermissionsPage from "./pages/PermissionsPage";
import ReadingsPage from "./pages/ReadingsPage";
import FormTabsManager from "./pages/FormTabsManager";
import CeoDashboard from "./pages/CeoDashboard";
import ReportsPage from "./pages/ReportsPage";
import DashboardLayout from "./components/DashboardLayout";
import DailyUpdatesPage from "./pages/DailyUpdatesPage";
import AlertsDashboard from "./pages/AlertsDashboard";
import CustomerCreditsPage from "./pages/CustomerCreditsPage";
import PurchaseInboundPage from "./pages/PurchaseInboundPage";
import DeliveryOutboundPage from "./pages/DeliveryOutboundPage";
import BrandReturnsPage from "./pages/BrandReturnsPage";
import WeeklyAuditPage from "./pages/WeeklyAuditPage";
import AssetsPage from "./pages/AssetsPage";
import AMCDashboard from "./pages/AMCDashboard";
import LocationsPage from "./pages/LocationsPage";

// Protected Route Component
function ProtectedRoute({ children, allowedRoles = null }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

// Public Route - redirect if already logged in
function PublicRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600"></div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public Routes */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <Login />
          </PublicRoute>
        }
      />
      <Route
        path="/register"
        element={
          <PublicRoute>
            <Register />
          </PublicRoute>
        }
      />

      {/* Protected Routes - wrapped in DashboardLayout */}
      <Route path="/dashboard" element={<ProtectedRoute><DashboardLayout><Dashboard /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/projects" element={<ProtectedRoute><DashboardLayout><ProjectList /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/projects/new" element={<ProtectedRoute><DashboardLayout><SiteVisitForm /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/projects/:editId/edit" element={<ProtectedRoute><DashboardLayout><SiteVisitForm /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/projects/:id" element={<ProtectedRoute><DashboardLayout><ProjectDetails /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/users" element={<ProtectedRoute allowedRoles={["admin"]}><DashboardLayout><UserManagement /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/audit-logs" element={<ProtectedRoute allowedRoles={["admin"]}><DashboardLayout><AuditLogs /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/company-profile" element={<ProtectedRoute allowedRoles={["admin"]}><DashboardLayout><CompanyProfile /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/permissions" element={<ProtectedRoute allowedRoles={["admin"]}><DashboardLayout><PermissionsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/form-tabs" element={<ProtectedRoute allowedRoles={["admin"]}><DashboardLayout><FormTabsManager /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/ceo" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><DashboardLayout><CeoDashboard /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/reports" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><DashboardLayout><ReportsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/daily-updates" element={<ProtectedRoute><DashboardLayout><DailyUpdatesPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/alerts" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><DashboardLayout><AlertsDashboard /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/credits" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><DashboardLayout><CustomerCreditsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/purchase-inbound" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><DashboardLayout><PurchaseInboundPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/delivery-outbound" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><DashboardLayout><DeliveryOutboundPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/returns" element={<ProtectedRoute><DashboardLayout><BrandReturnsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/audits" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><DashboardLayout><WeeklyAuditPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/approvals" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><DashboardLayout><ApprovalsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/terms" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><DashboardLayout><TermsConditions /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/inventory" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><DashboardLayout><InventoryManagement /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/inventory/kits" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><DashboardLayout><MaterialKitsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/expansion" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><DashboardLayout><ExpansionPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/pricing-config" element={<ProtectedRoute allowedRoles={["admin"]}><DashboardLayout><PricingConfig /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/sales" element={<ProtectedRoute><DashboardLayout><DirectSalesPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/readings" element={<ProtectedRoute><DashboardLayout><ReadingsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/assets" element={<ProtectedRoute><DashboardLayout><AssetsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/amc" element={<ProtectedRoute allowedRoles={["admin", "manager"]}><DashboardLayout><AMCDashboard /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/locations" element={<ProtectedRoute allowedRoles={["admin"]}><DashboardLayout><LocationsPage /></DashboardLayout></ProtectedRoute>} />
      {/* Default Redirect */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
          <PwaInstaller />
          <Toaster />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
