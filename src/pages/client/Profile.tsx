import { Link } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { ClientAuthGuard } from "@/components/layout/ClientAuthGuard";
import ClientLayout from "@/components/layout/ClientLayout";
import { ChevronRight, User, CreditCard, Bell, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

const ProfileLink = ({
  to, icon: Icon, label, description, danger, accent,
}: {
  to: string; icon: any; label: string; description?: string; danger?: boolean; accent?: string;
}) => (
  <Link
    to={to}
    className={cn(
      "flex items-center justify-between rounded-2xl border p-4 transition-all duration-200",
      danger
        ? "border-red-500/20 hover:bg-red-500/10 hover:border-red-500/40"
        : "border-[#8C6B6F]/15 hover:border-[#8C6B6F]/30 hover:bg-[#8C6B6F]/[0.05]"
    )}
  >
    <div className="flex items-center gap-3.5">
      <div
        className="flex h-9 w-9 items-center justify-center rounded-xl"
        style={
          danger
            ? { background: "rgba(239,68,68,0.1)", color: "#f87171" }
            : { background: `${accent ?? "#8C6B6F"}15`, color: accent ?? "#8C6B6F" }
        }
      >
        <Icon size={17} />
      </div>
      <div>
        <p className={cn("text-[0.88rem] font-semibold leading-tight", danger ? "text-red-400" : "text-foreground")}>
          {label}
        </p>
        {description && (
          <p className="text-[0.74rem] text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
    </div>
    <ChevronRight size={15} className="text-muted-foreground/40" />
  </Link>
);

const Profile = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const name = user?.displayName ?? user?.display_name ?? user?.email?.split("@")[0] ?? "Usuario";
  const initials = name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const handleLogout = () => {
    logout();
    navigate("/auth/login");
  };

  return (
    <ClientAuthGuard requiredRoles={["client"]}>
      <ClientLayout>
        <div className="max-w-lg mx-auto space-y-6">

          {/* ── Header card ── */}
          <div className="relative overflow-hidden rounded-3xl border border-[#8C6B6F]/15 bg-gradient-to-br from-[#F0D0D5] via-[#e8eadf] to-[#FDF7F8] p-6">
            {/* Ambient glow */}
            <div className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-[#8C6B6F]/15 blur-[40px]" />
            <div className="pointer-events-none absolute -bottom-6 -left-6 h-24 w-24 rounded-full bg-[#D9B5BA]/10 blur-[30px]" />

            <div className="relative flex items-center gap-4">
              {/* Avatar */}
              <div className="relative flex-shrink-0">
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-[#8C6B6F] to-[#D9B5BA] text-2xl font-bold text-white shadow-xl shadow-[#8C6B6F]/25">
                  {(user?.photoUrl ?? user?.photo_url)
                    ? <img src={(user?.photoUrl ?? user?.photo_url)!} className="h-20 w-20 rounded-2xl object-cover" alt={name} />
                    : initials}
                </div>
                <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-emerald-400 border-2 border-[#FDF7F8]" />
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="text-xl font-bold text-foreground truncate leading-tight">{name}</p>
                <p className="text-sm text-muted-foreground truncate mt-0.5">{user?.email}</p>
                {user?.phone && (
                  <p className="text-sm text-muted-foreground mt-0.5">{user.phone}</p>
                )}
                {/* Role badge */}
                <div className="inline-flex items-center gap-1.5 mt-2.5 px-2.5 py-1 rounded-full bg-[#8C6B6F]/15 border border-[#8C6B6F]/20">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#8C6B6F]" />
                  <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-[#8C6B6F]">
                    {user?.role === "client"
                      ? (user?.gender === "male" ? "Alumno" : user?.gender === "other" ? "Alumno/a" : "Alumna")
                      : user?.role ?? "Cliente"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Mi cuenta ── */}
          <div className="space-y-2">
            <p className="px-1 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50">
              Mi cuenta
            </p>
            <ProfileLink
              to="/app/profile/edit"
              icon={User}
              label="Editar perfil"
              description="Nombre, teléfono, foto y más"
              accent="#D9B5BA"
            />
            <ProfileLink
              to="/app/profile/membership"
              icon={CreditCard}
              label="Mi membresía"
              description="Clases disponibles y vigencia"
              accent="#8C6B6F"
            />
            <ProfileLink
              to="/app/profile/preferences"
              icon={Bell}
              label="Preferencias"
              description="Notificaciones y comunicaciones"
              accent="#FDF7F8"
            />
          </div>

          {/* ── Sesión ── */}
          <div className="space-y-2">
            <p className="px-1 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50">
              Sesión
            </p>
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-between rounded-2xl border border-red-500/20 p-4 transition-all duration-200 hover:bg-red-500/10 hover:border-red-500/40"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
                  <LogOut size={17} />
                </div>
                <div className="text-left">
                  <p className="text-[0.88rem] font-semibold text-red-400 leading-tight">Cerrar sesión</p>
                  <p className="text-[0.74rem] text-muted-foreground mt-0.5">Salir de tu cuenta</p>
                </div>
              </div>
              <ChevronRight size={15} className="text-muted-foreground/40" />
            </button>
          </div>

        </div>
      </ClientLayout>
    </ClientAuthGuard>
  );
};

export default Profile;

