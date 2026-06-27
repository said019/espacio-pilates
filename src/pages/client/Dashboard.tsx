import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { es } from "date-fns/locale";
import { format } from "date-fns";
import api from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { ClientAuthGuard } from "@/components/layout/ClientAuthGuard";
import ClientLayout from "@/components/layout/ClientLayout";
import { safeParse } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MembershipCard } from "@/components/MembershipCard";
import { Calendar, ClipboardList, Clock, ShoppingBag, ArrowRight, Sparkles, Upload, CreditCard } from "lucide-react";
import coachGuidance from "@/assets/tu-espacio-studio/coach-guidance.webp";
import type { ClientMembership } from "@/types/membership";
import type { BookingClient } from "@/types/booking";

const Dashboard = () => {
  const { user } = useAuthStore();

  const { data: membershipData, isLoading: loadingMembership } = useQuery({
    queryKey: ["my-membership"],
    queryFn: async () => (await api.get("/memberships/my")).data,
  });

  const { data: bookingsData, isLoading: loadingBookings } = useQuery({
    queryKey: ["my-bookings"],
    queryFn: async () => (await api.get("/bookings/my-bookings")).data,
  });

  const { data: ordersData } = useQuery({
    queryKey: ["my-orders"],
    queryFn: async () => (await api.get("/orders")).data,
  });

  const pendingOrders: any[] = (Array.isArray(ordersData?.data) ? ordersData.data : [])
    .filter((o: any) => o.status === "pending_payment" || o.status === "pending_verification");

  // API returns { data: <membership|null> } — extract the inner payload.
  // Guard against the wrapper object being truthy when the actual value is null.
  const rawMembership = membershipData?.data !== undefined ? membershipData.data : membershipData;
  const membership: ClientMembership | null =
    rawMembership && typeof rawMembership === "object" && "id" in rawMembership ? rawMembership : null;

  const bookings: BookingClient[] = Array.isArray(bookingsData?.data) ? bookingsData.data : Array.isArray(bookingsData) ? bookingsData : [];

  const upcomingBookings = bookings
    .filter((b) => b.status === "confirmed" || b.status === "waitlist")
    .slice(0, 2);

  const classesRemaining = membership?.classesRemaining ?? membership?.classes_remaining ?? null;
  const isLowCredits = membership && classesRemaining !== null && classesRemaining <= 2;
  const noMembership = !loadingMembership && !membership;
  const firstName = (user?.displayName ?? user?.display_name ?? user?.email?.split("@")[0] ?? "Hola").split(" ")[0];

  return (
    <ClientAuthGuard requiredRoles={["client"]}>
      <ClientLayout>
        <div className="mx-auto max-w-6xl space-y-6">
          <section className="relative overflow-hidden rounded-[1.5rem] bg-valiance-charcoal text-valiance-nude shadow-valiance-deep">
            <img
              src={coachGuidance}
              alt=""
              aria-hidden
              className="absolute inset-y-0 right-0 hidden h-full w-[48%] object-cover object-[center_42%] opacity-70 lg:block"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-valiance-charcoal via-valiance-charcoal/92 to-valiance-charcoal/30" />
            <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_0.7fr] lg:p-10">
              <div className="max-w-xl">
                <p className="mb-3 flex items-center text-[0.66rem] font-medium uppercase tracking-[0.22em] text-valiance-blush/85">
                  <span className="mr-3 inline-block h-px w-7 bg-valiance-gold" />
                  Tu reserva de hoy
                </p>
                <h1 className="font-display text-[clamp(2.4rem,5vw,4.4rem)] leading-[0.98] text-valiance-nude">
                  Hola, {firstName}.
                </h1>
                <p className="mt-4 max-w-[34rem] text-[0.98rem] leading-7 text-valiance-nude/72">
                  Elige tu clase, revisa tus créditos y llega lista. Todo lo importante está aquí para que reservar sea rápido.
                </p>
                <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                  <Button asChild className="h-12 rounded-full bg-valiance-nude px-6 text-valiance-charcoal hover:bg-valiance-blush">
                    <Link to="/app/classes">
                      <Calendar size={16} className="mr-2" />
                      Reservar clase
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="h-12 rounded-full border-valiance-nude/30 bg-valiance-nude/8 px-6 text-valiance-nude hover:bg-valiance-nude/14 hover:text-valiance-nude">
                    <Link to="/app/bookings">
                      <ClipboardList size={16} className="mr-2" />
                      Mis reservas
                    </Link>
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-3 content-end gap-2 sm:gap-3 lg:grid-cols-1">
                <div className="rounded-2xl border border-valiance-nude/12 bg-valiance-nude/10 p-3 backdrop-blur-sm sm:p-4">
                  <p className="text-[0.55rem] uppercase tracking-[0.14em] text-valiance-blush/75 sm:text-[0.64rem] sm:tracking-[0.18em]">Clases</p>
                  <p className="mt-2 font-display text-2xl leading-none text-valiance-nude tabular-nums sm:text-3xl">
                    {classesRemaining == null ? "—" : classesRemaining}
                  </p>
                  <p className="mt-1 text-xs text-valiance-nude/58">disponibles</p>
                </div>
                <div className="rounded-2xl border border-valiance-nude/12 bg-valiance-nude/10 p-3 backdrop-blur-sm sm:p-4">
                  <p className="text-[0.55rem] uppercase tracking-[0.14em] text-valiance-blush/75 sm:text-[0.64rem] sm:tracking-[0.18em]">Próximas</p>
                  <p className="mt-2 font-display text-2xl leading-none text-valiance-nude tabular-nums sm:text-3xl">{upcomingBookings.length}</p>
                  <p className="mt-1 text-xs text-valiance-nude/58">reservas</p>
                </div>
                <div className="rounded-2xl border border-valiance-nude/12 bg-valiance-nude/10 p-3 backdrop-blur-sm sm:p-4">
                  <p className="text-[0.55rem] uppercase tracking-[0.14em] text-valiance-blush/75 sm:text-[0.64rem] sm:tracking-[0.18em]">Pendientes</p>
                  <p className="mt-2 font-display text-2xl leading-none text-valiance-nude tabular-nums sm:text-3xl">{pendingOrders.length}</p>
                  <p className="mt-1 text-xs text-valiance-nude/58"><span className="sm:hidden">pagos</span><span className="hidden sm:inline">pagos/órdenes</span></p>
                </div>
              </div>
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-3">
            <Button asChild variant="outline" className="h-12 justify-start rounded-2xl border-valiance-oat bg-valiance-ivory text-valiance-charcoal hover:bg-valiance-oat/45">
              <Link to="/app/classes"><Calendar size={16} className="mr-2 text-valiance-mauve" />Reservar clase</Link>
            </Button>
            <Button asChild variant="outline" className="h-12 justify-start rounded-2xl border-valiance-oat bg-valiance-ivory text-valiance-charcoal hover:bg-valiance-oat/45">
              <Link to="/app/bookings"><ClipboardList size={16} className="mr-2 text-valiance-mauve" />Mis reservas</Link>
            </Button>
            <Button asChild variant="outline" className="h-12 justify-start rounded-2xl border-valiance-oat bg-valiance-ivory text-valiance-charcoal hover:bg-valiance-oat/45">
              <Link to="/app/checkout"><ShoppingBag size={16} className="mr-2 text-valiance-mauve" />Adquirir plan</Link>
            </Button>
          </div>

          {(noMembership || isLowCredits) && (
            <Link to="/app/checkout" className="block no-underline">
              <div className="relative overflow-hidden rounded-2xl border border-valiance-fern/25 bg-valiance-fern/10 p-5 transition-all hover:-translate-y-0.5 hover:shadow-valiance-card">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-valiance-ivory text-valiance-mauve ring-1 ring-valiance-fern/25">
                      <Sparkles size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-valiance-charcoal">
                        {noMembership ? "Adquiere tu membresía" : "Renueva tu plan"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {noMembership
                          ? "Elige el plan ideal para ti y comienza a reservar clases"
                          : `Te quedan ${classesRemaining} clase${classesRemaining === 1 ? "" : "s"} — renueva para seguir entrenando`}
                      </p>
                    </div>
                  </div>
                  <ArrowRight size={18} className="shrink-0 text-valiance-mauve" />
                </div>
              </div>
            </Link>
          )}

          <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <Card className="border-valiance-oat bg-valiance-ivory shadow-valiance-soft">
              <CardHeader className="pb-2">
                <CardTitle className="font-body text-sm font-semibold text-valiance-mauve">Mi membresía</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingMembership ? (
                  <Skeleton className="h-40 w-full rounded-2xl" />
                ) : membership ? (
                  <MembershipCard membership={membership} />
                ) : (
                  <div className="rounded-2xl border border-dashed border-valiance-oat bg-valiance-oat/20 p-5">
                    <p className="text-sm font-medium text-valiance-charcoal">No tienes membresía activa</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">Elige un paquete y reserva tu primera clase desde aquí.</p>
                    <Button asChild size="sm" className="mt-4 rounded-full">
                      <Link to="/app/checkout">Adquirir membresía</Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-valiance-oat bg-valiance-ivory shadow-valiance-soft">
              <CardHeader className="pb-2">
                <CardTitle className="font-body text-sm font-semibold text-valiance-mauve">Próximas clases</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingBookings ? (
                  <Skeleton className="h-24 w-full rounded-2xl" />
                ) : upcomingBookings.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-valiance-oat bg-valiance-oat/20 p-5">
                    <p className="text-sm font-medium text-valiance-charcoal">No tienes clases próximas</p>
                    <Button asChild size="sm" className="mt-4 rounded-full">
                      <Link to="/app/classes">Reservar ahora</Link>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {upcomingBookings.map((b) => (
                      <div key={b.id} className="rounded-2xl border border-valiance-oat bg-valiance-oat/20 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-valiance-charcoal">{b.class_type_name}</p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              {b.start_time ? format(safeParse(b.start_time), "EEEE d MMM · HH:mm", { locale: es }) : "—"} · {b.instructor_name ?? b.class_type_name}
                            </p>
                          </div>
                          <Badge variant={b.status === "waitlist" ? "secondary" : "default"} className="rounded-full">
                            {b.status === "waitlist" ? "Espera" : "Confirmada"}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {pendingOrders.length > 0 && (
            <Card className="border-valiance-fern/25 bg-valiance-fern/10">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 font-body text-sm font-semibold text-valiance-mauve">
                  <CreditCard size={16} />
                  {pendingOrders.length === 1 ? "Orden pendiente" : "Órdenes pendientes"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {pendingOrders.map((o: any) => (
                    <div key={o.id} className="rounded-2xl border border-valiance-oat bg-valiance-ivory p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-valiance-charcoal">{o.plan_name}</p>
                          <p className="text-xs text-muted-foreground">
                            ${Number(o.total_amount).toLocaleString("es-MX")} MXN · {o.payment_method === "cash" ? "Efectivo" : "Transferencia"}
                          </p>
                          {o.order_number && (
                            <p className="font-mono text-[10px] text-valiance-mauve">Orden: {o.order_number}</p>
                          )}
                        </div>
                        <Badge
                          variant="outline"
                          className={o.status === "pending_payment"
                            ? "rounded-full border-amber-500/40 bg-amber-50 text-amber-700"
                            : "rounded-full border-valiance-fern/50 bg-valiance-fern/10 text-valiance-mauve"
                          }
                        >
                          {o.status === "pending_payment" ? (
                            <><Upload size={11} className="mr-1" /> Subir comprobante</>
                          ) : (
                            <><Clock size={11} className="mr-1" /> En revisión</>
                          )}
                        </Badge>
                      </div>
                      {o.status === "pending_payment" && (
                        <Button asChild size="sm" className="mt-3 w-full rounded-full sm:w-auto">
                          <Link to={`/app/checkout?orderId=${o.id}`}>
                            <Upload size={14} className="mr-2" />Subir comprobante de pago
                          </Link>
                        </Button>
                      )}
                      {o.status === "pending_verification" && o.payment_method === "cash" && (
                        <p className="mt-3 rounded-xl bg-valiance-oat/35 px-3 py-2 text-xs text-valiance-mauve">
                          Acércate a recepción para completar tu pago. Tu membresía se activará al confirmar.
                        </p>
                      )}
                      {o.status === "pending_verification" && o.payment_method !== "cash" && (
                        <p className="mt-3 rounded-xl bg-valiance-oat/35 px-3 py-2 text-xs text-valiance-mauve">
                          Tu comprobante está siendo revisado. Recibirás una notificación cuando se apruebe.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </ClientLayout>
    </ClientAuthGuard>
  );
};

export default Dashboard;
