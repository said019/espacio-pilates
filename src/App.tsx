import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

// Auth pages
import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";

import Dashboard from "./pages/client/Dashboard";
import BookClasses from "./pages/client/BookClasses";
import BookClassConfirm from "./pages/client/BookClassConfirm";
import MyBookings from "./pages/client/MyBookings";
import Checkout from "./pages/client/Checkout";
import Profile from "./pages/client/Profile";
import ProfileEdit from "./pages/client/ProfileEdit";
import ProfilePreferences from "./pages/client/ProfilePreferences";
import Notifications from "./pages/client/Notifications";
import MyOrders from "./pages/client/MyOrders";

import AdminDashboard from "./pages/admin/Dashboard";
import PlansList from "./pages/admin/plans/PlansList";
import MembershipsList from "./pages/admin/memberships/MembershipsList";
import ClientsList from "./pages/admin/clients/ClientsList";
import ClientDetail from "./pages/admin/clients/ClientDetail";
import ClassesCalendar from "./pages/admin/classes/ClassesCalendar";
import ClassTypesList from "./pages/admin/classes/ClassTypesList";
import GenerateClasses from "./pages/admin/classes/GenerateClasses";
import BookingsList from "./pages/admin/bookings/BookingsList";
import Waitlist from "./pages/admin/bookings/Waitlist";
import InstructorsList from "./pages/admin/staff/InstructorsList";
import PaymentsPage from "./pages/admin/payments/PaymentsPage";
import SettingsPage from "./pages/admin/settings/SettingsPage";
import ReportsPage from "./pages/admin/reports/ReportsPage";
// Legal pages
import Privacidad from "./pages/legal/Privacidad";
import Terminos from "./pages/legal/Terminos";
import Cancelacion from "./pages/legal/Cancelacion";

const queryClient = new QueryClient();

// checkAuth on mount
const AppInit = () => {
  const checkAuth = useAuthStore((s) => s.checkAuth);
  useEffect(() => { checkAuth(); }, []);
  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppInit />
        <Routes>
          {/* Public landing */}
          <Route path="/" element={<Index />} />

          {/* Legal pages */}
          <Route path="/legal/privacidad" element={<Privacidad />} />
          <Route path="/legal/terminos" element={<Terminos />} />
          <Route path="/legal/cancelacion" element={<Cancelacion />} />

          {/* Auth */}
          <Route path="/auth/login" element={<Login />} />
          <Route path="/auth/register" element={<Register />} />
          <Route path="/auth/forgot-password" element={<ForgotPassword />} />
          <Route path="/auth/reset-password" element={<ResetPassword />} />
          {/* Legacy /auth → new login */}
          <Route path="/auth" element={<Navigate to="/auth/login" replace />} />

          {/* Client portal */}
          <Route path="/app" element={<Dashboard />} />
          <Route path="/app/classes" element={<BookClasses />} />
          <Route path="/app/classes/:classId" element={<BookClassConfirm />} />
          <Route path="/app/bookings" element={<MyBookings />} />
          <Route path="/app/checkout" element={<Checkout />} />
          <Route path="/app/profile" element={<Profile />} />
          <Route path="/app/profile/edit" element={<ProfileEdit />} />
          <Route path="/app/profile/preferences" element={<ProfilePreferences />} />
          <Route path="/app/orders" element={<MyOrders />} />
          <Route path="/app/notifications" element={<Notifications />} />

          {/* Admin panel */}
          <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="/admin/plans" element={<PlansList />} />
          <Route path="/admin/memberships" element={<MembershipsList />} />
          <Route path="/admin/clients" element={<ClientsList />} />
          <Route path="/admin/clients/:id" element={<ClientDetail />} />
          <Route path="/admin/classes" element={<ClassesCalendar />} />
          <Route path="/admin/classes/types" element={<ClassTypesList />} />
          <Route path="/admin/classes/generate" element={<GenerateClasses />} />
          <Route path="/admin/bookings" element={<BookingsList />} />
          <Route path="/admin/bookings/waitlist" element={<Waitlist />} />
          <Route path="/admin/staff" element={<InstructorsList />} />
          <Route path="/admin/payments" element={<PaymentsPage />} />
          <Route path="/admin/orders" element={<Navigate to="/admin/payments" replace />} />
          <Route path="/admin/reports" element={<ReportsPage />} />
          <Route path="/admin/settings" element={<SettingsPage />} />

          {/* 404 */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
