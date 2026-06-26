import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types/auth";

interface ClientAuthGuardProps {
  children: React.ReactNode;
  requiredRoles?: User["role"][];
}

export const ClientAuthGuard = ({ children, requiredRoles }: ClientAuthGuardProps) => {
  const { isAuthenticated, user, isLoading, checkAuth } = useAuthStore();
  const location = useLocation();

  useEffect(() => {
    if (!isAuthenticated) checkAuth();
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={`/auth/login?returnUrl=${encodeURIComponent(location.pathname)}`} replace />;
  }

  if (requiredRoles && user && !requiredRoles.includes(user.role)) {
    if (user.role === "admin" || user.role === "super_admin") return <Navigate to="/admin/dashboard" replace />;
    return <Navigate to="/auth/login" replace />;
  }

  return <>{children}</>;
};
