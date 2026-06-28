import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { AuthGuard } from "@/components/admin/AuthGuard";
import AdminLayout from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays, Users, DollarSign, AlertCircle, ArrowRight } from "lucide-react";
import studioMirrorLine from "@/assets/tu-espacio-studio/studio-mirror-line.webp";

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Esperando pago",
  pending_verification: "Por verificar",
  approved: "Aprobada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
  active: "Activa",
  expired: "Expirada",
  frozen: "Congelada",
};

interface Stats {
  classesToday: number;
  activeMembers: number;
  monthlyRevenue: number;
  pendingAlerts: number;
  recentMemberships: { id: string; userName: string; planName: string; status: string; createdAt: string }[];
  pendingOrders: { id: string; userName: string; totalAmount?: number; total_amount?: number; amount?: number; status: string }[];
}

const Dashboard = () => {
  const navigate = useNavigate();
  const { data: stats, isLoading } = useQuery<Stats>({
    queryKey: ["admin-stats"],
    queryFn: async () => (await api.get("/admin/stats")).data,
  });

  const { data: memberships } = useQuery<{ data: Stats["recentMemberships"] }>({
    queryKey: ["memberships-recent"],
    queryFn: async () => (await api.get("/memberships?limit=5")).data,
  });

  const { data: pendingOrders } = useQuery<{ data: Stats["pendingOrders"] }>({
    queryKey: ["orders-pending"],
    queryFn: async () => (await api.get("/admin/orders?status=pending_verification")).data,
  });

  const metric = (label: string, value: number | undefined, icon: React.ReactNode, prefix = "", accent = "#D1B9B4") => (
    <Card className="overflow-hidden border-valiance-oat bg-valiance-surface2 shadow-valiance-soft">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="font-body text-xs font-semibold uppercase tracking-[0.16em] text-valiance-mauve/75">{label}</CardTitle>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-valiance-oat bg-valiance-oat/35" style={{ color: accent }}>
          {icon}
        </span>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <p className="font-display text-4xl leading-none text-valiance-charcoal tabular-nums">
            {prefix}{value ?? 0}
          </p>
        )}
      </CardContent>
    </Card>
  );

  return (
    <AuthGuard requiredRoles={["admin", "instructor"]}>
      <AdminLayout>
        <div className="admin-page max-w-6xl space-y-6">
          <section className="relative overflow-hidden rounded-[1.5rem] bg-[#5E4651] p-6 text-valiance-nude shadow-valiance-deep sm:p-8">
            <img
              src={studioMirrorLine}
              alt=""
              aria-hidden
              className="absolute inset-y-0 right-0 hidden h-full w-[42%] object-cover opacity-45 lg:block"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#5E4651] via-[#5E4651]/90 to-[#5E4651]/35" />
            <div className="relative max-w-2xl">
              <p className="mb-3 flex items-center text-[0.66rem] font-medium uppercase tracking-[0.22em] text-valiance-blush/80">
                <span className="mr-3 inline-block h-px w-7 bg-valiance-gold" />
                Operación del studio
              </p>
              <h1 className="font-display text-[clamp(2.3rem,5vw,4rem)] leading-[0.98]">Dashboard</h1>
              <p className="mt-4 max-w-[34rem] text-sm leading-6 text-valiance-nude/70">
                Revisa clases, membresías, ingresos y pendientes del día sin perder el ritmo de recepción.
              </p>
            </div>
          </section>

          <div className="stagger-in grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {metric("Clases de hoy", stats?.classesToday, <CalendarDays size={18} />, "", "#8C6B6F")}
            {metric("Membresías activas", stats?.activeMembers, <Users size={18} />, "", "#B6968F")}
            {metric("Ingresos del mes", stats?.monthlyRevenue, <DollarSign size={18} />, "$", "#C08791")}
            {metric("Alertas pendientes", stats?.pendingAlerts, <AlertCircle size={18} />, "", "#A9787E")}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-valiance-oat bg-valiance-surface2 shadow-valiance-soft">
              <CardHeader>
                <CardTitle className="font-body text-base font-semibold text-valiance-charcoal">Últimas membresías</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoading
                  ? Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
                  : (Array.isArray(memberships?.data) ? memberships.data : []).map((m) => (
                      <div key={m.id} className="flex items-center justify-between rounded-2xl border border-valiance-oat bg-valiance-oat/20 px-4 py-3 text-sm">
                        <div>
                          <p className="font-medium text-valiance-charcoal">{m.userName}</p>
                          <p className="text-muted-foreground text-xs">{m.planName}</p>
                        </div>
                        <Badge
                          variant={m.status === "active" ? "default" : "secondary"}
                          className="rounded-full text-xs"
                        >
                          {STATUS_LABEL[m.status] ?? m.status}
                        </Badge>
                      </div>
                    ))}
                {(!memberships?.data || memberships.data.length === 0) && !isLoading && (
                  <p className="text-sm text-muted-foreground">Sin membresías recientes.</p>
                )}
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer border-valiance-oat bg-valiance-surface2 shadow-valiance-soft transition-all hover:-translate-y-0.5 hover:border-valiance-mauve/50"
              onClick={() => navigate("/admin/payments?tab=pending")}
            >
              <CardHeader>
                <CardTitle className="flex items-center justify-between font-body text-base font-semibold text-valiance-charcoal">
                  Órdenes pendientes
                  <span className="inline-flex items-center gap-1 text-xs font-normal text-valiance-mauve">
                    Ver pagos <ArrowRight size={13} />
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoading
                  ? Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
                  : (Array.isArray(pendingOrders?.data) ? pendingOrders.data : []).map((o) => (
                      <div key={o.id} className="flex items-center justify-between rounded-2xl border border-valiance-oat bg-valiance-oat/20 px-4 py-3 text-sm">
                        <div>
                          <p className="font-medium text-valiance-charcoal">{o.userName}</p>
                          <p className="text-muted-foreground text-xs">${Number(o.totalAmount ?? o.total_amount ?? o.amount ?? 0).toFixed(2)} MXN</p>
                        </div>
                        <Badge variant="outline" className="rounded-full text-xs">
                          {STATUS_LABEL[o.status] ?? o.status}
                        </Badge>
                      </div>
                    ))}
                {(!pendingOrders?.data || pendingOrders.data.length === 0) && !isLoading && (
                  <p className="text-sm text-muted-foreground">Sin órdenes pendientes.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </AdminLayout>
    </AuthGuard>
  );
};

export default Dashboard;
