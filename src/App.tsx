import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";

// Rutas con code-splitting (React.lazy): el panel de admin NO se descarga para
// las clientas, y cada sección se carga bajo demanda → primera carga más ligera.
const Index = lazy(() => import("./pages/Index"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Auth pages
const Login = lazy(() => import("./pages/auth/Login"));
const Register = lazy(() => import("./pages/auth/Register"));
const ForgotPassword = lazy(() => import("./pages/auth/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/auth/ResetPassword"));

const Dashboard = lazy(() => import("./pages/client/Dashboard"));
const BookClasses = lazy(() => import("./pages/client/BookClasses"));
const BookClassConfirm = lazy(() => import("./pages/client/BookClassConfirm"));
const MyBookings = lazy(() => import("./pages/client/MyBookings"));
const Checkout = lazy(() => import("./pages/client/Checkout"));
const Profile = lazy(() => import("./pages/client/Profile"));
const ProfileEdit = lazy(() => import("./pages/client/ProfileEdit"));
const ProfilePreferences = lazy(() => import("./pages/client/ProfilePreferences"));
const Notifications = lazy(() => import("./pages/client/Notifications"));
const MyOrders = lazy(() => import("./pages/client/MyOrders"));
const CardPayment = lazy(() => import("./pages/client/CardPayment"));

const AdminDashboard = lazy(() => import("./pages/admin/Dashboard"));
const PlansList = lazy(() => import("./pages/admin/plans/PlansList"));
const DiscountCodesList = lazy(() => import("./pages/admin/discounts/DiscountCodesList"));
const MembershipsList = lazy(() => import("./pages/admin/memberships/MembershipsList"));
const ClientsList = lazy(() => import("./pages/admin/clients/ClientsList"));
const ClientDetail = lazy(() => import("./pages/admin/clients/ClientDetail"));
const ClassesCalendar = lazy(() => import("./pages/admin/classes/ClassesCalendar"));
const ClassTypesList = lazy(() => import("./pages/admin/classes/ClassTypesList"));
const GenerateClasses = lazy(() => import("./pages/admin/classes/GenerateClasses"));
const BookingsList = lazy(() => import("./pages/admin/bookings/BookingsList"));
const Waitlist = lazy(() => import("./pages/admin/bookings/Waitlist"));
const InstructorsList = lazy(() => import("./pages/admin/staff/InstructorsList"));
const PaymentsPage = lazy(() => import("./pages/admin/payments/PaymentsPage"));
const SettingsPage = lazy(() => import("./pages/admin/settings/SettingsPage"));
const ReportsPage = lazy(() => import("./pages/admin/reports/ReportsPage"));
// Legal pages
const Privacidad = lazy(() => import("./pages/legal/Privacidad"));
const Terminos = lazy(() => import("./pages/legal/Terminos"));
const Cancelacion = lazy(() => import("./pages/legal/Cancelacion"));

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
        <Suspense fallback={<div className="min-h-[100dvh] flex items-center justify-center bg-valiance-nude"><Loader2 className="animate-spin text-valiance-mauve" size={24} /></div>}>
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
          <Route path="/app/pay/:orderId" element={<CardPayment />} />
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
          <Route path="/admin/discounts" element={<DiscountCodesList />} />
          <Route path="/admin/orders" element={<Navigate to="/admin/payments" replace />} />
          <Route path="/admin/reports" element={<ReportsPage />} />
          <Route path="/admin/settings" element={<SettingsPage />} />

          {/* 404 */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
