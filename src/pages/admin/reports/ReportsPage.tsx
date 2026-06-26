import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { AuthGuard } from "@/components/admin/AuthGuard";
import AdminLayout from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { DatePicker } from "@/components/ui/date-picker";
import {
  AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart,
} from "recharts";
import {
  DollarSign, TrendingUp, Receipt, Users, BookOpen, UserPlus,
  CalendarDays, Activity, Star, Clock, Ticket, X,
} from "lucide-react";

const ACCENT = {
  blush:    "#D9B5BA",
  mauve:    "#8C6B6F",
  gold:     "#C4A882",
  indigo:   "#6366F1",
  emerald:  "#10B981",
  amber:    "#F59E0B",
  sky:      "#0EA5E9",
  rose:     "#F43F5E",
} as const;

const ReportsPage = () => {
  // Filtro de rango (opcional). Si ambos campos están definidos se aplica.
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const rangeActive = !!from && !!to && from <= to;

  const { data: overview, isLoading: loadingOverview } = useQuery({
    queryKey: ["reports-overview"],
    queryFn: async () => (await api.get("/reports/overview")).data,
  });

  const { data: revenue, isLoading: loadingRevenue } = useQuery({
    queryKey: ["reports-revenue", rangeActive ? `${from}_${to}` : "12m"],
    queryFn: async () => {
      const params = rangeActive ? { from, to } : undefined;
      return (await api.get("/reports/revenue", { params })).data;
    },
  });
  const granularity: "day" | "month" = revenue?.granularity === "day" ? "day" : "month";

  const { data: classesData, isLoading: loadingClasses } = useQuery({
    queryKey: ["reports-classes"],
    queryFn: async () => (await api.get("/reports/classes")).data,
  });

  const { data: instructorsData, isLoading: loadingInstructors } = useQuery({
    queryKey: ["reports-instructors"],
    queryFn: async () => (await api.get("/reports/instructors")).data,
  });

  const { data: retentionData } = useQuery({
    queryKey: ["reports-retention"],
    queryFn: async () => (await api.get("/reports/retention")).data,
  });

  const { data: totalpassData, isLoading: loadingTotalpass } = useQuery({
    queryKey: ["reports-totalpass"],
    queryFn: async () => (await api.get("/reports/totalpass")).data,
  });

  const o = overview?.data ?? overview ?? {};
  const retention = retentionData?.data ?? {};
  const tp = totalpassData?.data ?? {};
  const tpTop: { name: string; email?: string; phone?: string; bookings: number; lastVisit?: string }[] = Array.isArray(tp.top) ? tp.top : [];

  const safeArray = (v: any) => (Array.isArray(v) ? v : []);
  const fmtMonth = (raw: any) => {
    if (!raw) return "—";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return String(raw);
    return new Intl.DateTimeFormat("es-MX", { month: "short", year: "2-digit" }).format(d);
  };
  const fmtDay = (raw: any) => {
    if (!raw) return "—";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return String(raw);
    return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short" }).format(d);
  };
  const fmtBucket = granularity === "day" ? fmtDay : fmtMonth;

  const revenueRows = safeArray(revenue?.data ?? revenue);
  const revenueDataRaw = revenueRows.map((row: any) => ({
    month: fmtBucket(row.month),
    amount: Number(row.amount ?? row.total ?? 0),
    count: Number(row.count ?? 0),
  }));
  // Línea de tendencia: media móvil simple (3 períodos)
  const trendWindow = granularity === "day" ? 7 : 3;
  const withTrend = useMemo(() => {
    return revenueDataRaw.map((row, i) => {
      const start = Math.max(0, i - trendWindow + 1);
      const slice = revenueDataRaw.slice(start, i + 1);
      const avg = slice.reduce((s, r) => s + r.amount, 0) / slice.length;
      return { ...row, trend: Number(avg.toFixed(2)) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revenue, granularity]);
  const revenueData = withTrend.length
    ? withTrend
    : Array.from({ length: 6 }).map((_, idx) => {
        const d = new Date();
        d.setMonth(d.getMonth() - (5 - idx));
        return { month: fmtMonth(d), amount: 0, count: 0, trend: 0 };
      });

  const classes: { name: string; bookings: number; attended: number }[] = safeArray(classesData?.data ?? classesData);
  const instructors: { id: string; name: string; classCount: number; totalStudents: number }[] = safeArray(instructorsData?.data ?? instructorsData);

  // Derivados del chart
  const totalRevenue = revenueData.reduce((sum, r) => sum + r.amount, 0);
  const totalOrders = revenueData.reduce((sum, r) => sum + r.count, 0);
  const currentMonth = revenueData[revenueData.length - 1];
  const prevMonth = revenueData.length >= 2 ? revenueData[revenueData.length - 2] : null;
  const growth = prevMonth && prevMonth.amount > 0
    ? (((currentMonth.amount - prevMonth.amount) / prevMonth.amount) * 100).toFixed(1)
    : null;
  const avgRevenuePerMember = o.activeMembers > 0
    ? Number(o.monthlyRevenue ?? 0) / Number(o.activeMembers)
    : 0;
  const peakBucket = revenueData.reduce(
    (best, r) => (r.amount > best.amount ? r : best),
    revenueData[0] ?? { month: "—", amount: 0, count: 0, trend: 0 },
  );

  const clearRange = () => { setFrom(""); setTo(""); };
  const setQuickRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    setFrom(iso(start));
    setTo(iso(end));
  };

  const formatCurrency = (n: number) =>
    `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatCurrencyCompact = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
    return `$${n.toFixed(0)}`;
  };

  const metric = (
    label: string,
    value: string | number | undefined,
    icon: React.ReactNode,
    accent: string,
    subtitle?: string,
    isLoading?: boolean,
  ) => (
    <Card className="border-t-2" style={{ borderTopColor: accent }}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <span style={{ color: accent }}>{icon}</span>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <>
            <p className="text-2xl font-bold text-[#1A1A1A] tabular-nums">{value ?? "—"}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const point = payload.find((p: any) => p.dataKey === "amount") ?? payload[0];
    const trendPoint = payload.find((p: any) => p.dataKey === "trend");
    return (
      <div className="rounded-xl border border-[#8C6B6F]/20 bg-white px-4 py-3 shadow-lg">
        <p className="text-xs font-semibold text-[#1A1A1A]/60 uppercase tracking-wide mb-1">{label}</p>
        <p className="text-sm font-bold text-[#1A1A1A]">{formatCurrency(point.value)}</p>
        {point?.payload?.count > 0 && (
          <p className="text-xs text-[#1A1A1A]/50 mt-0.5">
            {point.payload.count} orden{point.payload.count !== 1 ? "es" : ""}
          </p>
        )}
        {trendPoint && (
          <p className="text-[11px] text-[#8C6B6F] mt-1">
            Tendencia: {formatCurrency(trendPoint.value)}
          </p>
        )}
      </div>
    );
  };

  const occupancy = Number(o.classOccupancyRate ?? 0);
  const totalReviews = Number(o.reviewsTotal ?? 0);
  const avgReviews = Number(o.reviewsAverage ?? 0);
  const pendingReviews = Number(o.reviewsPending ?? 0);
  const totalClients = Number(retention.total ?? 0);

  return (
    <AuthGuard>
      <AdminLayout>
        <div className="admin-page max-w-6xl">
          <h1 className="text-2xl font-bold mb-6">Reportes</h1>

          {/* ── Primary KPIs ── */}
          <div className="stagger-in grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {metric(
              "Ingresos del mes",
              formatCurrency(Number(o.monthlyRevenue ?? 0)),
              <DollarSign size={18} />,
              ACCENT.blush,
              growth ? `${Number(growth) >= 0 ? "+" : ""}${growth}% vs mes anterior` : "Sin datos del mes anterior",
              loadingOverview,
            )}
            {metric(
              "Miembros activos",
              o.activeMembers ?? 0,
              <Users size={18} />,
              ACCENT.indigo,
              totalClients ? `${totalClients} clientes registrados` : undefined,
              loadingOverview,
            )}
            {metric(
              "Reservas del mes",
              o.monthlyBookings ?? 0,
              <BookOpen size={18} />,
              ACCENT.emerald,
              `${occupancy}% asistencia (check-in)`,
              loadingOverview,
            )}
            {metric(
              "Clientes nuevos",
              o.newMembersThisMonth ?? 0,
              <UserPlus size={18} />,
              ACCENT.gold,
              "Registrados este mes",
              loadingOverview,
            )}
          </div>

          {/* ── Secondary KPIs ── */}
          <div className="stagger-in grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {metric(
              "Ingresos totales (12m)",
              formatCurrencyCompact(totalRevenue),
              <TrendingUp size={18} />,
              ACCENT.mauve,
              formatCurrency(totalRevenue),
              loadingRevenue,
            )}
            {metric(
              "Órdenes aprobadas",
              totalOrders,
              <Receipt size={18} />,
              ACCENT.amber,
              "Últimos 12 meses",
              loadingRevenue,
            )}
            {metric(
              "Clases programadas",
              o.upcomingClasses ?? 0,
              <CalendarDays size={18} />,
              ACCENT.sky,
              "Pendientes este mes",
              loadingOverview,
            )}
            {metric(
              "Ingreso por miembro",
              avgRevenuePerMember > 0 ? formatCurrencyCompact(avgRevenuePerMember) : "—",
              <Activity size={18} />,
              ACCENT.rose,
              "Promedio mensual",
              loadingOverview,
            )}
          </div>

          {/* ── Revenue Chart ── */}
          <Card className="mb-6">
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Ingresos {rangeActive ? "por rango" : "mensuales"}</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {rangeActive
                    ? `${fmtDay(from)} → ${fmtDay(to)} · ${granularity === "day" ? "diario" : "mensual"}`
                    : "Últimos 12 meses"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!rangeActive && growth && (
                  <Badge
                    variant="outline"
                    className={Number(growth) >= 0
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-rose-200 bg-rose-50 text-rose-700"}
                  >
                    {Number(growth) >= 0 ? "↑" : "↓"} {Math.abs(Number(growth))}% vs período ant.
                  </Badge>
                )}
                {/* Atajos rápidos */}
                <div className="flex items-center gap-1">
                  {[
                    { label: "7d", days: 7 },
                    { label: "30d", days: 30 },
                    { label: "90d", days: 90 },
                  ].map((q) => (
                    <button
                      key={q.label}
                      type="button"
                      onClick={() => setQuickRange(q.days)}
                      className="text-[11px] font-medium px-2 py-1 rounded-md border border-[#8C6B6F]/20 text-[#8C6B6F] hover:bg-[#8C6B6F]/10 transition-colors"
                    >
                      {q.label}
                    </button>
                  ))}
                  {rangeActive && (
                    <button
                      type="button"
                      onClick={clearRange}
                      className="text-[11px] font-medium px-2 py-1 rounded-md border border-[#8C6B6F]/20 text-[#8C6B6F] hover:bg-[#8C6B6F]/10 transition-colors flex items-center gap-1"
                      title="Quitar filtro"
                    >
                      <X size={11} /> Limpiar
                    </button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Date range picker */}
              <div className="flex flex-col sm:flex-row gap-3 mb-5">
                <div className="flex-1 min-w-0">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1 block">
                    Desde
                  </label>
                  <DatePicker
                    value={from}
                    onChange={setFrom}
                    placeholder="Fecha inicial"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1 block">
                    Hasta
                  </label>
                  <DatePicker
                    value={to}
                    onChange={setTo}
                    placeholder="Fecha final"
                    min={from || undefined}
                  />
                </div>
              </div>

              {rangeActive && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
                  <div className="rounded-lg border border-[#8C6B6F]/15 bg-[#FBF7F4]/40 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</p>
                    <p className="text-base font-bold tabular-nums">{formatCurrencyCompact(totalRevenue)}</p>
                  </div>
                  <div className="rounded-lg border border-[#8C6B6F]/15 bg-[#FBF7F4]/40 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Órdenes</p>
                    <p className="text-base font-bold tabular-nums">{totalOrders}</p>
                  </div>
                  <div className="rounded-lg border border-[#8C6B6F]/15 bg-[#FBF7F4]/40 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Ticket prom.</p>
                    <p className="text-base font-bold tabular-nums">
                      {totalOrders > 0 ? formatCurrencyCompact(totalRevenue / totalOrders) : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[#8C6B6F]/15 bg-[#FBF7F4]/40 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Mejor {granularity === "day" ? "día" : "mes"}
                    </p>
                    <p className="text-base font-bold tabular-nums">{peakBucket?.month ?? "—"}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatCurrencyCompact(peakBucket?.amount ?? 0)}
                    </p>
                  </div>
                </div>
              )}

              {loadingRevenue ? (
                <Skeleton className="h-[320px] w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={revenueData} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor={ACCENT.blush} stopOpacity={0.55} />
                        <stop offset="60%"  stopColor={ACCENT.blush} stopOpacity={0.18} />
                        <stop offset="100%" stopColor={ACCENT.blush} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#8C6B6F20" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: "#1A1A1A", fontSize: 11 }}
                      axisLine={{ stroke: "#8C6B6F30" }}
                      tickLine={false}
                      interval="preserveStartEnd"
                      minTickGap={24}
                    />
                    <YAxis
                      tick={{ fill: "#1A1A1A99", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => formatCurrencyCompact(Number(v))}
                      width={56}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ stroke: ACCENT.mauve, strokeWidth: 1, strokeDasharray: "4 4" }} />
                    <Area
                      type="monotone"
                      dataKey="amount"
                      stroke={ACCENT.blush}
                      strokeWidth={2.5}
                      fill="url(#revenueFill)"
                      name="Ingresos"
                      activeDot={{ r: 5, fill: ACCENT.mauve, stroke: "#fff", strokeWidth: 2 }}
                      isAnimationActive
                      animationDuration={700}
                    />
                    <Line
                      type="monotone"
                      dataKey="trend"
                      stroke={ACCENT.mauve}
                      strokeWidth={1.5}
                      strokeDasharray="5 5"
                      dot={false}
                      name={`Tendencia (${trendWindow}${granularity === "day" ? "d" : "m"})`}
                      isAnimationActive
                      animationDuration={900}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* ── Top classes + Instructors + Reviews ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Top class types */}
            <Card>
              <CardHeader>
                <CardTitle>Clases más populares</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Por reservas totales</p>
              </CardHeader>
              <CardContent>
                {loadingClasses ? (
                  <div className="space-y-3">
                    {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                ) : classes.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">Sin datos</p>
                ) : (
                  <div className="stagger-in space-y-3">
                    {classes.slice(0, 6).map((c) => {
                      const max = classes[0]?.bookings || 1;
                      const pct = (c.bookings / max) * 100;
                      const attendRate = c.bookings > 0 ? (c.attended / c.bookings) * 100 : 0;
                      return (
                        <div key={c.name} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium text-[#1A1A1A] truncate">{c.name}</span>
                            <span className="tabular-nums text-muted-foreground text-xs">
                              {c.bookings} reservas · {attendRate.toFixed(0)}% asistencia
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-[#8C6B6F]/10 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-[width] duration-700"
                              style={{
                                width: `${pct}%`,
                                background: `linear-gradient(90deg, ${ACCENT.blush}, ${ACCENT.mauve})`,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top instructors */}
            <Card>
              <CardHeader>
                <CardTitle>Instructoras más activas</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Por clases impartidas</p>
              </CardHeader>
              <CardContent>
                {loadingInstructors ? (
                  <div className="space-y-3">
                    {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                ) : instructors.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">Sin datos</p>
                ) : (
                  <div className="stagger-in space-y-2">
                    {instructors.slice(0, 6).map((ins, idx) => (
                      <div
                        key={ins.id}
                        className="flex items-center justify-between rounded-lg border border-[#8C6B6F]/10 bg-[#FBF7F4]/40 px-3 py-2"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold tabular-nums shrink-0"
                            style={{
                              background: idx === 0 ? ACCENT.gold : `${ACCENT.mauve}20`,
                              color: idx === 0 ? "#1A1A1A" : ACCENT.mauve,
                            }}
                          >
                            {idx + 1}
                          </div>
                          <span className="text-sm font-medium truncate">{ins.name}</span>
                        </div>
                        <div className="text-right text-xs text-muted-foreground shrink-0">
                          <p className="tabular-nums font-semibold text-[#1A1A1A]">{ins.classCount} clases</p>
                          <p className="tabular-nums">{ins.totalStudents} alumnas</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── TotalPass — convenio externo ── */}
          <Card className="mb-6 border-l-4" style={{ borderLeftColor: ACCENT.gold }}>
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Ticket size={18} style={{ color: ACCENT.gold }} />
                  TotalPass
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Convenio externo · walk-ins linkeados al plan TotalPass</p>
              </div>
              {tp.uniqueClientsMonth > 0 && (
                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                  {tp.uniqueClientsMonth} client{tp.uniqueClientsMonth === 1 ? "a" : "as"} este mes
                </Badge>
              )}
            </CardHeader>
            <CardContent>
              {loadingTotalpass ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                    <div className="rounded-lg border border-[#8C6B6F]/15 bg-[#FBF7F4]/40 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Clientas únicas</p>
                      <p className="text-lg font-bold tabular-nums">{tp.uniqueClients ?? 0}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{tp.uniqueClientsMonth ?? 0} este mes</p>
                    </div>
                    <div className="rounded-lg border border-[#8C6B6F]/15 bg-[#FBF7F4]/40 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Reservas</p>
                      <p className="text-lg font-bold tabular-nums">{tp.bookingsTotal ?? 0}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{tp.bookingsMonth ?? 0} este mes</p>
                    </div>
                    <div className="rounded-lg border border-[#8C6B6F]/15 bg-[#FBF7F4]/40 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Órdenes cobradas</p>
                      <p className="text-lg font-bold tabular-nums">{tp.ordersTotal ?? 0}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{tp.ordersMonth ?? 0} este mes</p>
                    </div>
                    <div className="rounded-lg border border-[#8C6B6F]/15 bg-[#FBF7F4]/40 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Ingresos TotalPass</p>
                      <p className="text-lg font-bold tabular-nums">{formatCurrencyCompact(Number(tp.revenueTotal ?? 0))}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{formatCurrencyCompact(Number(tp.revenueMonth ?? 0))} este mes</p>
                    </div>
                  </div>

                  {tpTop.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      Aún no hay walk-ins cobrados con TotalPass.
                    </p>
                  ) : (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        Top clientas TotalPass
                      </p>
                      <div className="space-y-1.5">
                        {tpTop.map((row, idx) => (
                          <div
                            key={`${row.name}-${idx}`}
                            className="flex items-center justify-between rounded-lg border border-[#8C6B6F]/10 bg-white px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{row.name}</p>
                              <p className="text-[11px] text-muted-foreground truncate">
                                {row.email || row.phone || "—"}
                                {row.lastVisit && (
                                  <> · última: {new Date(row.lastVisit).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit", timeZone: "America/Mexico_City" })}</>
                                )}
                              </p>
                            </div>
                            <Badge variant="outline" className="shrink-0 border-amber-200 bg-amber-50 text-amber-700 tabular-nums">
                              {row.bookings} clase{row.bookings !== 1 ? "s" : ""}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* ── Reviews + Operational stats ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card className="border-t-2" style={{ borderTopColor: ACCENT.amber }}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Star size={16} style={{ color: ACCENT.amber }} />
                  Reseñas del mes
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingOverview ? (
                  <Skeleton className="h-12 w-full" />
                ) : (
                  <>
                    <div className="flex items-baseline gap-2">
                      <p className="text-2xl font-bold tabular-nums">{avgReviews.toFixed(1)}</p>
                      <p className="text-xs text-muted-foreground">/ 5 promedio</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {totalReviews} reseña{totalReviews !== 1 ? "s" : ""}
                      {pendingReviews > 0 && (
                        <span className="ml-2 inline-flex items-center gap-1 text-amber-700">
                          <Clock size={11} /> {pendingReviews} por aprobar
                        </span>
                      )}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="border-t-2" style={{ borderTopColor: ACCENT.emerald }}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Activity size={16} style={{ color: ACCENT.emerald }} />
                  Tasa de asistencia
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingOverview ? (
                  <Skeleton className="h-12 w-full" />
                ) : (
                  <>
                    <p className="text-2xl font-bold tabular-nums">{occupancy}%</p>
                    <div className="mt-2 h-1.5 rounded-full bg-[#8C6B6F]/10 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-[width] duration-700"
                        style={{
                          width: `${Math.min(100, occupancy)}%`,
                          backgroundColor: occupancy >= 70 ? ACCENT.emerald : occupancy >= 40 ? ACCENT.amber : ACCENT.rose,
                        }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">Reservas con check-in / total</p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="border-t-2" style={{ borderTopColor: ACCENT.indigo }}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Users size={16} style={{ color: ACCENT.indigo }} />
                  Cartera total
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingOverview ? (
                  <Skeleton className="h-12 w-full" />
                ) : (
                  <>
                    <p className="text-2xl font-bold tabular-nums">{totalClients}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {Number(retention.newThisMonth ?? 0)} nuev{Number(retention.newThisMonth ?? 0) !== 1 ? "as" : "a"} este mes
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </AdminLayout>
    </AuthGuard>
  );
};

export default ReportsPage;
