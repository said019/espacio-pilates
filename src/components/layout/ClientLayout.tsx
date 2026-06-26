import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import {
  LayoutDashboard, Calendar, ClipboardList, CreditCard,
  User, Bell, LogOut, Menu, X, Settings, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import valianceLogo from "@/assets/valiance-pilates-logo.png";

/* ── Navigation groups ── */
const NAV_GROUPS = [
  {
    label: "Tu estudio",
    items: [
      { to: "/app",          label: "Inicio",        icon: LayoutDashboard },
      { to: "/app/classes",  label: "Reservar clase", icon: Calendar },
      { to: "/app/bookings", label: "Mis reservas",  icon: ClipboardList },
      { to: "/app/orders",   label: "Mis órdenes",   icon: CreditCard },
    ],
  },
];

const BOTTOM_NAV = [
  { to: "/app",          icon: LayoutDashboard, label: "Inicio" },
  { to: "/app/classes",  icon: Calendar,        label: "Clases" },
  { to: "/app/bookings", icon: ClipboardList,   label: "Reservas" },
  { to: "/app/profile",  icon: User,            label: "Perfil" },
];

/* ── Single nav item ── */
const NavItem = ({
  to, label, icon: Icon, onClick,
}: {
  to: string; label: string; icon: any; onClick?: () => void;
}) => {
  const { pathname } = useLocation();
  const active = pathname === to || (to !== "/app" && pathname.startsWith(to));

  return (
    <Link
      to={to}
      onClick={onClick}
      className={cn(
        "group relative flex items-center gap-3 rounded-2xl px-3.5 py-2.5 font-body text-[0.86rem] transition-all duration-200 no-underline",
        active
          ? "bg-valiance-charcoal text-valiance-nude"
          : "text-valiance-charcoal/65 hover:bg-valiance-blush/40 hover:text-valiance-charcoal"
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon size={17} strokeWidth={1.6} className="flex-shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {active && <ChevronRight size={13} className="opacity-60" />}
    </Link>
  );
};

const ClientLayout = ({ children }: { children: React.ReactNode }) => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate("/auth/login");
  };

  const initials = (user?.displayName ?? user?.display_name)
    ? (user?.displayName ?? user?.display_name ?? "").split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
    : user?.email ? user.email[0].toUpperCase() : "V";

  const firstName = (user?.displayName ?? user?.display_name)?.split(" ")[0]
    ?? user?.email?.split("@")[0]
    ?? "Tú";

  return (
    <div className="flex min-h-[100dvh] bg-valiance-nude text-valiance-charcoal">
      {/* Mobile overlay */}
      {open && (
        <button
          aria-label="Cerrar menú"
          className="fixed inset-0 z-40 bg-valiance-charcoal/40 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* ── SIDEBAR ── */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col transition-transform duration-300 lg:static lg:translate-x-0",
          "bg-valiance-nude border-r border-valiance-blush",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Brand */}
        <div className="flex h-32 items-center justify-between px-6 border-b border-valiance-blush">
          <Link to="/" className="flex items-center no-underline" aria-label="Valiance Pilates — Inicio">
            <img src={valianceLogo} alt="" aria-hidden className="h-28 w-auto object-contain" />
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="lg:hidden rounded-xl p-2 text-valiance-mauve hover:text-valiance-charcoal hover:bg-valiance-blush/40 transition-colors"
            aria-label="Cerrar menú"
          >
            <X size={18} />
          </button>
        </div>

        {/* User card */}
        <Link
          to="/app/profile"
          onClick={() => setOpen(false)}
          className={cn(
            "mx-4 mt-5 mb-3 flex items-center gap-3 rounded-2xl p-3.5 no-underline transition-all duration-200",
            "bg-valiance-blush/40 hover:bg-valiance-blush/60",
            pathname.startsWith("/app/profile") && "bg-valiance-charcoal text-valiance-nude hover:bg-valiance-plum"
          )}
        >
          <div className="relative flex-shrink-0">
            <div className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full text-[0.85rem] font-display",
              pathname.startsWith("/app/profile")
                ? "bg-valiance-blush text-valiance-charcoal"
                : "bg-valiance-charcoal text-valiance-nude"
            )}>
              {(user?.photoUrl ?? user?.photo_url)
                ? <img src={(user?.photoUrl ?? user?.photo_url)!} alt="" className="h-11 w-11 rounded-full object-cover" />
                : initials}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 border-2 border-valiance-nude" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[1.05rem] leading-tight">{firstName}</p>
            <p className={cn(
              "truncate font-body text-[0.72rem] leading-tight mt-0.5",
              pathname.startsWith("/app/profile") ? "text-valiance-blush/70" : "text-valiance-charcoal/55"
            )}>
              {user?.email}
            </p>
          </div>

          <ChevronRight size={14} className={cn(
            "flex-shrink-0",
            pathname.startsWith("/app/profile") ? "text-valiance-blush/70" : "text-valiance-mauve/50"
          )} />
        </Link>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 pb-2 space-y-5 mt-3" aria-label="Navegación principal">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="px-4 mb-2 font-body text-[0.62rem] tracking-[0.22em] uppercase text-valiance-mauve">
                {group.label}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <NavItem key={item.to} {...item} onClick={() => setOpen(false)} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom actions */}
        <div className="border-t border-valiance-blush p-3 space-y-1">
          <Link
            to="/app/notifications"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 rounded-2xl px-3.5 py-2.5 font-body text-[0.86rem] text-valiance-charcoal/65 hover:bg-valiance-blush/40 hover:text-valiance-charcoal transition-all no-underline"
          >
            <Bell size={17} strokeWidth={1.6} />
            Notificaciones
          </Link>
          <Link
            to="/app/profile/preferences"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 rounded-2xl px-3.5 py-2.5 font-body text-[0.86rem] text-valiance-charcoal/65 hover:bg-valiance-blush/40 hover:text-valiance-charcoal transition-all no-underline"
          >
            <Settings size={17} strokeWidth={1.6} />
            Preferencias
          </Link>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 rounded-2xl px-3.5 py-2.5 font-body text-[0.86rem] text-valiance-charcoal/65 hover:bg-red-50 hover:text-red-600 transition-all"
          >
            <LogOut size={17} strokeWidth={1.6} />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Mobile topbar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-valiance-blush bg-valiance-nude/90 backdrop-blur-md px-5 lg:hidden">
          <button
            onClick={() => setOpen(true)}
            className="rounded-xl p-2 text-valiance-mauve hover:text-valiance-charcoal hover:bg-valiance-blush/40 transition-colors"
            aria-label="Abrir menú"
          >
            <Menu size={20} />
          </button>

          <Link to="/" aria-label="Valiance Pilates — Inicio">
            <img src={valianceLogo} alt="" aria-hidden className="h-20 w-auto object-contain" />
          </Link>

          <Link
            to="/app/notifications"
            className="rounded-xl p-2 text-valiance-mauve hover:text-valiance-charcoal hover:bg-valiance-blush/40 transition-colors"
            aria-label="Notificaciones"
          >
            <Bell size={20} />
          </Link>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-5 pb-28 lg:p-8 lg:pb-8">
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav
          className="fixed bottom-3 inset-x-3 z-30 flex lg:hidden rounded-2xl border border-valiance-blush bg-valiance-nude/95 backdrop-blur-xl shadow-valiance-soft pb-safe"
          aria-label="Navegación inferior"
        >
          {BOTTOM_NAV.map(({ to, icon: Icon, label }) => {
            const active = pathname === to || (to !== "/app" && pathname.startsWith(to));
            return (
              <Link
                key={to}
                to={to}
                aria-current={active ? "page" : undefined}
                className="flex flex-1 flex-col items-center justify-center gap-1 py-3 transition-all"
              >
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-2xl transition-all",
                    active
                      ? "bg-valiance-charcoal text-valiance-nude"
                      : "text-valiance-charcoal/40"
                  )}
                >
                  <Icon size={18} strokeWidth={1.6} />
                </span>
                <span className={cn(
                  "font-body text-[0.66rem] leading-none tracking-wide",
                  active ? "text-valiance-charcoal font-medium" : "text-valiance-charcoal/45"
                )}>
                  {label}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
};

export default ClientLayout;
