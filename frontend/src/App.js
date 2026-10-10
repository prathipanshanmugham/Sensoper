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
import PriceListHub from "./pages/PriceListHub";
import VendorsPage from "./pages/VendorsPage";
import DirectSalesPage from "./pages/DirectSalesPage";
import AuditLogs from "./pages/AuditLogs";
import CompanyProfile from "./pages/CompanyProfile";
import ApprovalsPage from "./pages/ApprovalsPage";
import PermissionsPage from "./pages/PermissionsPage";
import ReadingsPage from "./pages/ReadingsPage";
import FormTabsManager from "./pages/FormTabsManager";
import ReportsPage from "./pages/ReportsPage";
import DashboardLayout from "./components/DashboardLayout";
import DailyReportPage from "./pages/DailyReportPage";
import SiteDiaryPage from "./pages/SiteDiaryPage";
import AlertsDashboard from "./pages/AlertsDashboard";
import CustomerCreditsPage from "./pages/CustomerCreditsPage";
import PurchaseInboundPage from "./pages/PurchaseInboundPage";
import DeliveryOutboundPage from "./pages/DeliveryOutboundPage";
import BrandReturnsPage from "./pages/BrandReturnsPage";
import WeeklyAuditPage from "./pages/WeeklyAuditPage";
import AssetsPage from "./pages/AssetsPage";
import AMCDashboard from "./pages/AMCDashboard";
import LocationsPage from "./pages/LocationsPage";
import PartnersPage from "./pages/PartnersPage";
import TeamsPage from "./pages/TeamsPage";
import CredentialsPage from "./pages/CredentialsPage";
import VaultPage from "./pages/VaultPage";
import PartnerDetail from "./pages/PartnerDetail";
import EcommercePage from "./pages/EcommercePage";
import GoogleCallback from "./pages/GoogleCallback";
import CustomerPortal from "./pages/CustomerPortal";
import AttendancePage from "./pages/AttendancePage";
import OrgStructurePage from "./pages/OrgStructurePage";
import CustomerOffersPage from "./pages/CustomerOffersPage";
import InvestorsPage from "./pages/InvestorsPage";
import InvestorPortal from "./pages/InvestorPortal";

// Protected Route Component
function ProtectedRoute({ children, allowedRoles = null, module = null, action = 'view' }) {
  const { user, loading, perms, can } = useAuth();

  if (loading || (user && module && user.role !== 'admin' && perms === null)) {
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

  // Settings → Permissions decides who may open each page
  if (module && !can(module, action)) {
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
      <Route path="/dashboard" element={<ProtectedRoute module="module_dashboard"><DashboardLayout><Dashboard /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/projects" element={<ProtectedRoute module="module_projects"><DashboardLayout><ProjectList /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/projects/new" element={<ProtectedRoute module="module_projects" action="create"><DashboardLayout><SiteVisitForm /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/projects/:editId/edit" element={<ProtectedRoute module="module_projects"><DashboardLayout><SiteVisitForm /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/projects/:id" element={<ProtectedRoute module="module_projects"><DashboardLayout><ProjectDetails /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/users" element={<ProtectedRoute allowedRoles={["admin"]} module="module_users"><DashboardLayout><UserManagement /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/audit-logs" element={<ProtectedRoute module="module_audit_logs"><DashboardLayout><AuditLogs /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/company-profile" element={<ProtectedRoute module="module_company"><DashboardLayout><CompanyProfile /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/permissions" element={<ProtectedRoute allowedRoles={["admin"]} module="module_permissions"><DashboardLayout><PermissionsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/form-tabs" element={<ProtectedRoute module="module_form_builder"><DashboardLayout><FormTabsManager /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/ceo" element={<Navigate to="/dashboard?tab=health" replace />} />
      <Route path="/dashboard/reports" element={<ProtectedRoute module="module_reports"><DashboardLayout><ReportsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/daily-report" element={<ProtectedRoute module="module_daily_updates"><DashboardLayout><DailyReportPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/site-diary" element={<ProtectedRoute module="module_site_diary"><DashboardLayout><SiteDiaryPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/daily-updates" element={<Navigate to="/dashboard/daily-report" replace />} />
      <Route path="/dashboard/alerts" element={<ProtectedRoute module="module_alerts"><DashboardLayout><AlertsDashboard /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/credits" element={<ProtectedRoute module="module_credits"><DashboardLayout><CustomerCreditsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/purchase-inbound" element={<ProtectedRoute module="module_purchase_inbound"><DashboardLayout><PurchaseInboundPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/delivery-outbound" element={<ProtectedRoute module="module_delivery_outbound"><DashboardLayout><DeliveryOutboundPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/returns" element={<ProtectedRoute module="module_returns"><DashboardLayout><BrandReturnsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/audits" element={<ProtectedRoute module="module_audits"><DashboardLayout><WeeklyAuditPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/approvals" element={<ProtectedRoute module="module_approvals"><DashboardLayout><ApprovalsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/terms" element={<ProtectedRoute module="module_terms"><DashboardLayout><TermsConditions /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/inventory" element={<ProtectedRoute module="module_inventory"><DashboardLayout><InventoryManagement /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/inventory/kits" element={<ProtectedRoute module="module_kits"><DashboardLayout><MaterialKitsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/expansion" element={<ProtectedRoute module="module_expansion"><DashboardLayout><ExpansionPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/pricing-config" element={<ProtectedRoute module="module_settings"><DashboardLayout><PricingConfig /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/pricelist" element={<ProtectedRoute module="module_pricelist"><DashboardLayout><PriceListHub /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/vendors" element={<ProtectedRoute module="module_vendors"><DashboardLayout><VendorsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/sales" element={<ProtectedRoute module="module_direct_sales"><DashboardLayout><DirectSalesPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/readings" element={<ProtectedRoute module="module_readings"><DashboardLayout><ReadingsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/assets" element={<ProtectedRoute module="module_assets"><DashboardLayout><AssetsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/amc" element={<ProtectedRoute module="module_amc"><DashboardLayout><AMCDashboard /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/locations" element={<ProtectedRoute module="module_locations"><DashboardLayout><LocationsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/partners" element={<ProtectedRoute module="module_partners"><DashboardLayout><PartnersPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/partners/:id" element={<ProtectedRoute module="module_partners"><DashboardLayout><PartnerDetail /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/teams" element={<ProtectedRoute module="module_teams"><DashboardLayout><TeamsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/security" element={<ProtectedRoute module="module_security"><DashboardLayout><CredentialsPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/vault" element={<ProtectedRoute allowedRoles={["admin"]} module="module_vault"><DashboardLayout><VaultPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/ecommerce" element={<ProtectedRoute module="module_ecommerce"><DashboardLayout><EcommercePage /></DashboardLayout></ProtectedRoute>} />
      {/* Google sign-in comes back here (Settings → Google Drive → Connect). Public: the one-time state authorises it. */}
      <Route path="/auth/google/callback" element={<GoogleCallback />} />
      {/* Customer's own solar dashboard — public link, mobile-number check inside */}
      <Route path="/my/:token" element={<CustomerPortal />} />
      <Route path="/dashboard/attendance" element={<ProtectedRoute module="module_attendance"><DashboardLayout><AttendancePage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/org-structure" element={<ProtectedRoute module="module_org"><DashboardLayout><OrgStructurePage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/customer-offers" element={<ProtectedRoute module="module_customer_offers"><DashboardLayout><CustomerOffersPage /></DashboardLayout></ProtectedRoute>} />
      <Route path="/dashboard/investors" element={<ProtectedRoute allowedRoles={["admin"]} module="module_investors"><DashboardLayout><InvestorsPage /></DashboardLayout></ProtectedRoute>} />
      {/* Investors' own dashboard — separate investor session (they sign in on /login) */}
      <Route path="/investor" element={<InvestorPortal />} />
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
