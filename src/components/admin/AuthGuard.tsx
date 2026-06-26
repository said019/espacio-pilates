import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";

const ADMIN_ROLES = ["admin", "super_admin", "reception", "instructor"];

interface AuthGuardProps {
  children: React.ReactNode;
  requiredRoles?: string[];
}

export const AuthGuard = ({ children, requiredRoles = ADMIN_ROLES }: AuthGuardProps) => {
  const navigate = useNavigate();
  const { user, isAuthenticated, checkAuth } = useAuthStore();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      if (!isAuthenticated) {
        await checkAuth();
      }
      setChecked(true);
    })();
  }, []);

  useEffect(() => {
    if (!checked) return;
    if (!isAuthenticated || !user) {
      navigate("/auth/login");
      return;
    }
    if (!requiredRoles.includes(user.role)) {
      navigate("/app");
    }
  }, [checked, isAuthenticated, user]);

  if (!checked)
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-foreground">
        Cargando...
      </div>
    );

  return <>{children}</>;
};
