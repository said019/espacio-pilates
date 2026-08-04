import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";

const ADMIN_ROLES = ["admin", "super_admin", "reception"];

function fallbackRouteForRole(role: string) {
  if (role === "instructor") return "/coach";
  if (["admin", "super_admin", "reception"].includes(role)) return "/admin/dashboard";
  return "/app";
}

interface AuthGuardProps {
  children: React.ReactNode;
  requiredRoles?: string[];
}

export const AuthGuard = ({ children, requiredRoles = ADMIN_ROLES }: AuthGuardProps) => {
  const navigate = useNavigate();
  const { user, isAuthenticated, checkAuth } = useAuthStore();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      await checkAuth();
      if (active) setChecked(true);
    })();
    return () => { active = false; };
  }, [checkAuth]);

  useEffect(() => {
    if (!checked) return;
    if (!isAuthenticated || !user) {
      navigate("/auth/login");
      return;
    }
    if (!requiredRoles.includes(user.role)) {
      navigate(fallbackRouteForRole(user.role), { replace: true });
    }
  }, [checked, isAuthenticated, navigate, requiredRoles, user]);

  if (!checked)
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-foreground">
        Cargando...
      </div>
    );

  return <>{children}</>;
};
