import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks } from "date-fns";
import { es } from "date-fns/locale";
import api from "@/lib/api";
import { AuthGuard } from "@/components/admin/AuthGuard";
import AdminLayout from "@/components/admin/AdminLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Users, Calendar, Clock } from "lucide-react";

interface WaitlistEntry {
  bookingId: string;
  userId: string;
  displayName: string;
  email: string;
  phone: string | null;
  planName: string | null;
  classesRemaining: number | null;
}

const Waitlist = () => {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);

  const { data: classesData, isLoading: classesLoading } = useQuery({
    queryKey: ["waitlist-classes", format(weekStart, "yyyy-MM-dd")],
    queryFn: async () =>
      (await api.get(`/classes?start=${format(weekStart, "yyyy-MM-dd")}&end=${format(weekEnd, "yyyy-MM-dd")}`)).data,
  });
  const classes: any[] = Array.isArray(classesData?.data) ? classesData.data : [];

  const { data: rosterData, isLoading: rosterLoading, refetch } = useQuery({
    queryKey: ["waitlist-roster", selectedClassId],
    queryFn: async () => (await api.get(`/classes/${selectedClassId}/roster`)).data,
    enabled: !!selectedClassId,
    refetchInterval: 15000,
  });
  const roster: WaitlistEntry[] = (rosterData?.data?.roster ?? []).filter(
    (r: any) => r.status === "waitlist"
  );
  const classInfo = rosterData?.data?.class ?? null;

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <AuthGuard>
      <AdminLayout>
        <div className="admin-page max-w-3xl">
          <div className="mb-7">
            <h1 className="text-3xl font-bold text-[#1A1A1A] mb-1">Lista de Espera</h1>
            <p className="text-sm text-[#1A1A1A]/35">
              {selectedClassId
                ? "Alumnas en lista de espera para esta clase"
                : "Selecciona una clase para ver su lista de espera"}
            </p>
          </div>

          {selectedClassId ? (
            <div className="space-y-5">
              <button
                onClick={() => setSelectedClassId(null)}
                className="flex items-center gap-2 text-sm text-[#1A1A1A]/40 hover:text-[#1A1A1A]/70 transition-colors"
              >
                <ChevronLeft size={14} /> Volver al calendario
              </button>

              {rosterLoading ? (
                <Skeleton className="h-20 rounded-2xl" />
              ) : classInfo && (
                <div className="rounded-2xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: classInfo.color || "#8C6B6F" }} />
                        <h2 className="text-xl font-bold text-[#1A1A1A]">{classInfo.classTypeName}</h2>
                      </div>
                      <p className="text-sm text-[#1A1A1A]/50">
                        {classInfo.startsAt
                          ? format(new Date(classInfo.startsAt), "EEEE d 'de' MMMM · HH:mm", { locale: es })
                          : classInfo.date ?? "—"}
                      </p>
                    </div>
                    <button
                      onClick={() => refetch()}
                      className="text-xs text-[#D9B5BA]/60 hover:text-[#D9B5BA] transition-colors flex items-center gap-1"
                    >
                      <Clock size={11} /> Actualizar
                    </button>
                  </div>
                  <div className="mt-3">
                    <Badge variant="outline" className="text-[#D9B5BA] border-[#D9B5BA]/30 bg-[#D9B5BA]/5">
                      {roster.length} en lista de espera
                    </Badge>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {rosterLoading
                  ? Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)
                  : roster.length === 0
                    ? (
                      <div className="text-center py-12 text-[#1A1A1A]/25 text-sm">
                        <Users size={28} className="mx-auto mb-2 opacity-30" />
                        No hay alumnas en lista de espera
                      </div>
                    )
                    : roster.map((entry, idx) => (
                      <div
                        key={entry.bookingId}
                        className="flex items-center gap-4 p-4 rounded-xl border border-[#D9B5BA]/15 bg-[#D9B5BA]/5 transition-all"
                      >
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#D9B5BA]/20 to-[#8C6B6F]/10 border border-[#D9B5BA]/20 flex items-center justify-center text-sm font-bold text-[#D9B5BA]">
                          #{idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-[#1A1A1A]/90 truncate">{entry.displayName}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-[#1A1A1A]/35 truncate">{entry.email}</span>
                            {entry.phone && <span className="text-xs text-[#1A1A1A]/25">{entry.phone}</span>}
                          </div>
                          {entry.planName && (
                            <p className="text-[10px] text-[#D9B5BA]/60 mt-0.5">
                              {entry.planName}
                              {entry.classesRemaining !== null
                                ? ` · ${entry.classesRemaining} clases`
                                : " · Ilimitado"}
                            </p>
                          )}
                        </div>
                        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full border text-[#D9B5BA] border-[#D9B5BA]/30 bg-[#D9B5BA]/5 shrink-0">
                          Posición {idx + 1}
                        </span>
                      </div>
                    ))
                }
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setWeekStart((w) => subWeeks(w, 1))}
                  className="w-8 h-8 rounded-lg border border-[#8C6B6F]/15 text-[#1A1A1A]/40 hover:text-[#1A1A1A]/70 hover:border-[#8C6B6F]/25 flex items-center justify-center transition-all"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-sm font-semibold text-[#1A1A1A]/70 min-w-[200px] text-center">
                  {format(weekStart, "d MMM", { locale: es })} – {format(weekEnd, "d MMM yyyy", { locale: es })}
                </span>
                <button
                  onClick={() => setWeekStart((w) => addWeeks(w, 1))}
                  className="w-8 h-8 rounded-lg border border-[#8C6B6F]/15 text-[#1A1A1A]/40 hover:text-[#1A1A1A]/70 hover:border-[#8C6B6F]/25 flex items-center justify-center transition-all"
                >
                  <ChevronRight size={14} />
                </button>
                <button
                  onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
                  className="ml-2 text-xs text-[#8C6B6F]/60 hover:text-[#8C6B6F] transition-colors"
                >
                  Hoy
                </button>
              </div>

              <div className="space-y-4">
                {days.map((day) => {
                  const dayStr = format(day, "yyyy-MM-dd");
                  const dayClasses = classes
                    .filter((c: any) => (c.date ?? c.start_time?.split("T")[0]) === dayStr)
                    .sort((a: any, b: any) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));

                  if (!dayClasses.length && !classesLoading) return null;
                  const isToday = dayStr === todayStr;

                  return (
                    <div key={dayStr}>
                      <div className="flex items-center gap-2 mb-2">
                        <p className={cn(
                          "text-xs font-semibold uppercase tracking-wider",
                          isToday ? "text-[#8C6B6F]" : "text-[#1A1A1A]/30"
                        )}>
                          {format(day, "EEEE d", { locale: es })}
                        </p>
                        {isToday && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#8C6B6F]/15 text-[#8C6B6F] border border-[#8C6B6F]/25 font-semibold">
                            Hoy
                          </span>
                        )}
                      </div>
                      {classesLoading ? (
                        <Skeleton className="h-14 rounded-xl" />
                      ) : (
                        <div className="space-y-2">
                          {dayClasses.map((cls: any) => {
                            const time = cls.start_time
                              ? format(new Date(cls.start_time), "HH:mm")
                              : cls.startTime ?? "—";
                            return (
                              <button
                                key={cls.id}
                                onClick={() => setSelectedClassId(cls.id)}
                                className="w-full flex items-center gap-4 p-4 rounded-xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.04] hover:border-[#D9B5BA]/30 hover:bg-[#D9B5BA]/5 transition-all group text-left"
                              >
                                <span
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: cls.class_type_color ?? cls.color ?? "#D9B5BA" }}
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-[#1A1A1A]/85 truncate">
                                    {cls.class_type_name ?? cls.className ?? "Clase"}
                                  </p>
                                  <p className="text-xs text-[#1A1A1A]/35">{time} · {cls.instructor_name ?? "—"}</p>
                                </div>
                                <ChevronRight size={14} className="text-[#1A1A1A]/20 group-hover:text-[#D9B5BA]/60 transition-colors" />
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}

                {!classesLoading && classes.length === 0 && (
                  <div className="text-center py-16 text-[#1A1A1A]/25 text-sm">
                    <Calendar size={28} className="mx-auto mb-2 opacity-30" />
                    No hay clases programadas esta semana
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </AdminLayout>
    </AuthGuard>
  );
};

export default Waitlist;
