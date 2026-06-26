import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import valianceLogo from "@/assets/valiance-pilates-logo.png";
import {
  LayoutDashboard, Package, CreditCard, Users, CalendarDays,
  BookOpen, DollarSign, BarChart3,
  Settings, ChevronLeft, ChevronRight, ChevronDown, LogOut, Globe, Menu, X, UserSquare2,
} from "lucide-react";

const NAV_GROUPS = [
  {
    label: "Operación",
    collapsible: false,
    items: [
      { path: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { path: "/admin/clients",   label: "Clientes",  icon: Users },
      { path: "/admin/bookings",  label: "Reservas",  icon: BookOpen },
      { path: "/admin/payments",  label: "Pagos",     icon: DollarSign },
    ],
  },
  {
    label: "Catálogo",
    collapsible: true,
    items: [
      { path: "/admin/plans",         label: "Planes",       icon: Package },
      { path: "/admin/memberships",   label: "Membresías",   icon: CreditCard },
      { path: "/admin/classes",       label: "Clases",       icon: CalendarDays },
      { path: "/admin/staff",         label: "Equipo",       icon: UserSquare2 },
      { path: "/admin/reports",       label: "Reportes",     icon: BarChart3 },
    ],
  },
  {
    label: "Sistema",
    collapsible: false,
    items: [
      { path: "/admin/settings", label: "Configuración", icon: Settings },
    ],
  },
];

const MOBILE_QUICK_NAV = [
  { path: "/admin/dashboard", label: "Inicio",   icon: LayoutDashboard },
  { path: "/admin/classes",   label: "Clases",   icon: CalendarDays },
  { path: "/admin/bookings",  label: "Reservas", icon: BookOpen },
  { path: "/admin/clients",   label: "Clientes", icon: Users },
  { path: "/admin/payments",  label: "Pagos",    icon: DollarSign },
];

interface AdminLayoutProps {
  children: React.ReactNode;
}

const AdminLayout = ({ children }: AdminLayoutProps) => {
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    "Catálogo": true,
  });

  const location = useLocation();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user as any);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    logout();
    navigate("/auth/login");
  };

  const toggleGroup = (label: string) => {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const allItems = NAV_GROUPS.flatMap((g) => g.items);
  const currentItem = allItems.find(
    (i) => location.pathname === i.path || location.pathname.startsWith(i.path + "/"),
  );
  const activeGroup = NAV_GROUPS.find((g) =>
    g.items.some((i) => location.pathname === i.path || location.pathname.startsWith(i.path + "/")),
  );

  const isCompact = collapsed && !mobileOpen;

  const initials = user?.displayName?.[0]?.toUpperCase()
    ?? user?.display_name?.[0]?.toUpperCase()
    ?? user?.email?.[0]?.toUpperCase()
    ?? "A";

  const userName = user?.displayName ?? user?.display_name ?? user?.email ?? "Admin";

  return (
    <div className="flex min-h-[100dvh] bg-valiance-nude text-valiance-charcoal">
      {mobileOpen && (
        <button
          aria-label="Cerrar menú"
          className="fixed inset-0 z-40 bg-valiance-charcoal/40 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── SIDEBAR ── */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col transition-all duration-300 shrink-0",
          "bg-valiance-nude border-r border-valiance-blush",
          "w-[88vw] max-w-[300px] -translate-x-full lg:translate-x-0 lg:static",
          mobileOpen && "translate-x-0",
          collapsed ? "lg:w-[76px]" : "lg:w-[256px]",
        )}
      >
        {/* Brand */}
        <div
          className={cn(
            "flex items-center border-b border-valiance-blush shrink-0 h-32",
            isCompact ? "justify-center px-3" : "justify-between px-5",
          )}
        >
          {!isCompact && (
            <Link to="/" aria-label="Inicio" className="inline-flex items-center">
              <img src={valianceLogo} alt="Valiance Pilates" className="h-28 w-auto object-contain" />
            </Link>
          )}

          <button
            onClick={() => setMobileOpen(false)}
            className="flex lg:hidden items-center justify-center w-9 h-9 rounded-xl text-valiance-mauve hover:text-valiance-charcoal hover:bg-valiance-blush/40 transition-colors"
            aria-label="Cerrar menú"
          >
            <X size={16} />
          </button>

          <button
            onClick={() => setCollapsed((v) => !v)}
            className="hidden lg:flex items-center justify-center w-8 h-8 rounded-xl text-valiance-mauve hover:text-valiance-charcoal hover:bg-valiance-blush/40 transition-colors"
            aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
          >
            {collapsed ? <Menu size={15} /> : <ChevronLeft size={15} />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4" aria-label="Navegación admin">
          {NAV_GROUPS.map((group) => {
            const isGroupActive = activeGroup?.label === group.label;
            const isOpen = group.collapsible ? (openGroups[group.label] ?? isGroupActive) : true;

            return (
              <div key={group.label} className="mb-2">
                {!isCompact && (
                  group.collapsible ? (
                    <button
                      onClick={() => toggleGroup(group.label)}
                      className="w-full flex items-center justify-between px-5 py-1.5 group"
                    >
                      <span className="font-body text-[0.62rem] tracking-[0.22em] uppercase text-valiance-mauve">
                        {group.label}
                      </span>
                      <ChevronDown
                        size={11}
                        className={cn("transition-transform duration-200 text-valiance-mauve", isOpen ? "rotate-0" : "-rotate-90")}
                      />
                    </button>
                  ) : (
                    <p className="px-5 py-1.5 font-body text-[0.62rem] tracking-[0.22em] uppercase text-valiance-mauve">
                      {group.label}
                    </p>
                  )
                )}

                {(isCompact || isOpen) && group.items.map(({ path, label, icon: Icon }) => {
                  const active = location.pathname === path || location.pathname.startsWith(path + "/");
                  return (
                    <Link
                      key={path}
                      to={path}
                      title={isCompact ? label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 mx-3 my-0.5 rounded-2xl transition-all duration-200 no-underline",
                        isCompact ? "justify-center py-2.5" : "px-3.5 py-2.5",
                        active
                          ? "bg-valiance-charcoal text-valiance-nude"
                          : "text-valiance-charcoal/65 hover:bg-valiance-blush/40 hover:text-valiance-charcoal",
                      )}
                    >
                      <Icon size={16} strokeWidth={1.6} className="shrink-0" />
                      {!isCompact && (
                        <span className="font-body text-[0.84rem] leading-none truncate flex-1">{label}</span>
                      )}
                      {active && !isCompact && (
                        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-valiance-blush" />
                      )}
                    </Link>
                  );
                })}

                {isCompact && <div className="mx-4 my-2 h-px bg-valiance-blush" />}
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-valiance-blush p-3 shrink-0 space-y-1">
          <Link
            to="/"
            title={isCompact ? "Ver sitio" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-2xl px-3.5 py-2.5 no-underline transition-all",
              "text-valiance-charcoal/55 hover:text-valiance-charcoal hover:bg-valiance-blush/40",
              isCompact && "justify-center px-2",
            )}
          >
            <Globe size={15} strokeWidth={1.6} className="shrink-0" />
            {!isCompact && <span className="font-body text-[0.82rem]">Ver sitio</span>}
          </Link>
          <button
            onClick={handleLogout}
            title={isCompact ? "Cerrar sesión" : undefined}
            className={cn(
              "w-full flex items-center gap-3 rounded-2xl px-3.5 py-2.5 transition-all",
              "text-valiance-charcoal/55 hover:text-red-600 hover:bg-red-50",
              isCompact && "justify-center px-2",
            )}
          >
            <LogOut size={15} strokeWidth={1.6} className="shrink-0" />
            {!isCompact && <span className="font-body text-[0.82rem]">Cerrar sesión</span>}
          </button>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="shrink-0 h-16 flex items-center justify-between px-4 sm:px-6 lg:px-8 border-b border-valiance-blush bg-valiance-nude/90 backdrop-blur-md sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              className="lg:hidden inline-flex h-9 w-9 items-center justify-center rounded-xl text-valiance-mauve hover:text-valiance-charcoal hover:bg-valiance-blush/40 transition-colors"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menú"
            >
              <Menu size={17} />
            </button>
            <span className="font-body text-[0.62rem] tracking-[0.22em] uppercase text-valiance-mauve hidden sm:inline">
              Admin
            </span>
            {currentItem && (
              <>
                <ChevronRight size={12} className="text-valiance-mauve/40 shrink-0 hidden sm:block" />
                <span className="font-display text-[1.05rem] text-valiance-charcoal truncate">
                  {currentItem.label}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden sm:flex items-center gap-2 font-body text-[0.74rem] text-valiance-charcoal/60">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot" />
              En línea
            </span>
            <div className="hidden sm:block w-px h-4 bg-valiance-blush" />
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-full bg-valiance-charcoal flex items-center justify-center font-display text-[0.92rem] text-valiance-nude">
                {initials}
              </div>
              <span className="hidden md:block font-body text-[0.82rem] text-valiance-charcoal/70 truncate max-w-[180px]">
                {userName}
              </span>
            </div>
          </div>
        </header>

        <main className="admin-mobile-main flex-1 overflow-auto pb-[88px] lg:pb-0">{children}</main>

        {isMobile && (
          <nav
            className="fixed inset-x-3 bottom-3 z-40 rounded-2xl border border-valiance-blush bg-valiance-nude/95 p-1.5 pb-safe backdrop-blur-xl shadow-valiance-soft lg:hidden"
            aria-label="Navegación inferior admin"
          >
            <ul className="grid grid-cols-5 gap-1 list-none">
              {MOBILE_QUICK_NAV.map((item) => {
                const active = location.pathname === item.path || location.pathname.startsWith(item.path + "/");
                return (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-12 flex-col items-center justify-center rounded-xl font-body text-[0.66rem] transition-all",
                        active
                          ? "bg-valiance-charcoal text-valiance-nude"
                          : "text-valiance-charcoal/55 hover:bg-valiance-blush/40 hover:text-valiance-charcoal",
                      )}
                    >
                      <item.icon size={15} strokeWidth={1.6} />
                      <span className="mt-0.5 leading-none">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </div>
    </div>
  );
};

export default AdminLayout;
