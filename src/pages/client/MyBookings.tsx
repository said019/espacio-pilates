import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import api from "@/lib/api";
import { safeParse } from "@/lib/utils";
import { ClientAuthGuard } from "@/components/layout/ClientAuthGuard";
import ClientLayout from "@/components/layout/ClientLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Star, CalendarClock } from "lucide-react";
import type { BookingClient } from "@/types/booking";

function useCancellationConfig() {
  const { data } = useQuery({
    queryKey: ["public-settings", "cancellation_settings"],
    queryFn: async () => (await api.get("/public/settings/cancellation_settings")).data,
    staleTime: 5 * 60 * 1000,
  });
  const raw = data?.data ?? data?.value ?? {};
  return {
    enabled: raw.enabled !== false,
    min_hours: Number(raw.min_hours ?? 2),
    refund_credit_on_cancel: raw.refund_credit_on_cancel !== false,
    cancellations_limit: Number(raw.cancellations_limit ?? 2),
    late_cancel_message: String(raw.late_cancel_message ?? ""),
    reschedule_hours: Number(raw.reschedule_hours ?? 3),
  };
}

// Narrowed shape of an axios error from the reschedule endpoint.
interface ApiError {
  response?: { data?: { code?: string; message?: string } };
}

// Shape of a class row returned by GET /api/classes — only the fields we use.
interface ClassOption {
  id: string;
  start_time: string;
  class_type_name?: string;
  instructor_name?: string;
  current_bookings?: number;
  max_capacity?: number;
  capacity?: number;
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmada",
  waitlist: "Lista de espera",
  checked_in: "Asistida",
  no_show: "No asistió",
  cancelled: "Cancelada",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  confirmed: "default",
  waitlist: "secondary",
  checked_in: "default",
  no_show: "destructive",
  cancelled: "destructive",
};

const BookingCard = ({
  booking,
  onCancel,
  onReview,
  onReschedule,
  cancellationsEnabled,
  rescheduleHours,
}: {
  booking: BookingClient;
  onCancel: (id: string) => void;
  onReview: (booking: BookingClient) => void;
  onReschedule: (booking: BookingClient) => void;
  cancellationsEnabled: boolean;
  rescheduleHours: number;
}) => {
  const isPast = new Date(booking.start_time) < new Date();
  const hasReview = Boolean(booking.has_review);
  const hoursUntil = (new Date(booking.start_time).getTime() - Date.now()) / 3600000;
  const canReschedule =
    booking.status === "confirmed" && !isPast && hoursUntil >= rescheduleHours;
  return (
    <div className="flex items-center justify-between rounded-xl border p-4">
      <div className="space-y-1">
        <p className="font-medium">{booking.class_type_name}</p>
        <p className="text-sm text-muted-foreground">
          {booking.start_time ? format(safeParse(booking.start_time), "EEEE d MMM · HH:mm", { locale: es }) : "—"}
        </p>
        <p className="text-xs text-muted-foreground">{booking.instructor_name}</p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <Badge variant={STATUS_VARIANTS[booking.status] ?? "secondary"}>
          {STATUS_LABELS[booking.status] ?? booking.status}
        </Badge>
        {canReschedule && (
          <Button variant="outline" size="sm" onClick={() => onReschedule(booking)}>
            <CalendarClock size={14} className="mr-1" />Reagendar
          </Button>
        )}
        {booking.status === "confirmed" && !isPast && cancellationsEnabled && hoursUntil >= rescheduleHours && (
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => onCancel(booking.id)}>
            Cancelar
          </Button>
        )}
        {isPast && booking.status === "checked_in" && (
          hasReview ? (
            <Badge
              variant="outline"
              className="border-[#CFD4B6] bg-[#ECEEDF] text-[#6E7F4F]"
            >
              Reseña enviada
            </Badge>
          ) : (
            <Button variant="outline" size="sm" onClick={() => onReview(booking)}>
              <Star size={14} className="mr-1" />Reseña
            </Button>
          )
        )}
      </div>
    </div>
  );
};

const MyBookings = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const cancelConfig = useCancellationConfig();
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reviewBooking, setReviewBooking] = useState<BookingClient | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [rescheduleBooking, setRescheduleBooking] = useState<BookingClient | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);

  const closeReschedule = () => {
    setRescheduleBooking(null);
    setSelectedClassId(null);
  };

  const { data: bookingsData, isLoading } = useQuery({
    queryKey: ["my-bookings"],
    queryFn: async () => (await api.get("/bookings/my-bookings")).data,
  });

  // Fetch review tags for the review dialog
  const { data: tagsData } = useQuery({
    queryKey: ["public-review-tags"],
    queryFn: async () => (await api.get("/public/review-tags")).data,
    staleTime: 1000 * 60 * 10,
  });
  const reviewTags: { id: string; name: string; color: string }[] = Array.isArray(tagsData?.data) ? tagsData.data : [];

  // Available classes for the reschedule picker — today through +14 days.
  // Only fetched while the reschedule dialog is open.
  const rescheduleRange = (() => {
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 14);
    return {
      start: format(startDate, "yyyy-MM-dd"),
      end: format(endDate, "yyyy-MM-dd"),
    };
  })();

  const { data: availableClassesData, isLoading: loadingAvailable } = useQuery({
    queryKey: ["reschedule-classes", rescheduleRange.start, rescheduleRange.end],
    queryFn: async () =>
      (await api.get(`/classes?start=${rescheduleRange.start}&end=${rescheduleRange.end}`)).data,
    enabled: !!rescheduleBooking,
    staleTime: 60 * 1000,
  });

  const availableClasses: ClassOption[] = Array.isArray(availableClassesData?.data)
    ? availableClassesData.data
    : Array.isArray(availableClassesData)
      ? availableClassesData
      : [];

  // Candidates: future classes that are not the current booking's class and not full.
  const nowTs = Date.now();
  const rescheduleOptions = availableClasses
    .filter((c) => {
      if (!c.start_time) return false;
      if (rescheduleBooking && c.id === rescheduleBooking.class_id) return false;
      if (new Date(c.start_time).getTime() <= nowTs) return false;
      const cap = c.max_capacity ?? c.capacity;
      const booked = c.current_bookings;
      if (typeof cap === "number" && typeof booked === "number" && booked >= cap) return false;
      return true;
    })
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  const bookings: BookingClient[] = Array.isArray(bookingsData?.data) ? bookingsData.data : Array.isArray(bookingsData) ? bookingsData : [];
  const now = new Date();

  const upcoming = bookings.filter((b) =>
    (b.status === "confirmed" || b.status === "waitlist") && new Date(b.start_time) >= now
  );
  const past = bookings.filter((b) =>
    b.status === "checked_in" || b.status === "no_show" || new Date(b.start_time) < now
  );
  const cancelled = bookings.filter((b) => b.status === "cancelled");

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/bookings/${id}`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["my-bookings"] });
      qc.invalidateQueries({ queryKey: ["my-membership"] });
      qc.invalidateQueries({ queryKey: ["public-classes"] });
      const creditRestored = res?.data?.creditRestored;
      toast({
        title: "Reserva cancelada",
        description: creditRestored
          ? "La clase fue devuelta a tu paquete."
          : "La clase NO fue devuelta (cancelación tardía o límite alcanzado).",
      });
      setCancelId(null);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || "No se pudo cancelar la reserva.";
      toast({ title: "No se pudo cancelar", description: msg, variant: "destructive" });
      setCancelId(null);
    },
  });

  const reviewMutation = useMutation({
    mutationFn: () =>
      api.post("/reviews", { bookingId: reviewBooking?.id, rating, comment, tagIds: selectedTags }),
    onSuccess: () => {
      toast({ title: "¡Gracias por tu reseña!" });
      qc.invalidateQueries({ queryKey: ["my-bookings"] });
      setReviewBooking(null);
      setComment("");
      setSelectedTags([]);
      setRating(5);
    },
    onError: (err: any) => {
      if (err?.response?.status === 409) {
        qc.invalidateQueries({ queryKey: ["my-bookings"] });
        setReviewBooking(null);
      }
      const msg = err?.response?.data?.message || "No se pudo enviar la reseña.";
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const rescheduleMutation = useMutation({
    mutationFn: ({ id, newClassId }: { id: string; newClassId: string }) =>
      api.put(`/bookings/${id}/reschedule`, { new_class_id: newClassId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-bookings"] });
      qc.invalidateQueries({ queryKey: ["my-membership"] });
      qc.invalidateQueries({ queryKey: ["public-classes"] });
      toast({
        title: "Reserva reagendada",
        description: "Tu clase se movió. El crédito no cambia.",
      });
      closeReschedule();
    },
    onError: (err: ApiError) => {
      const data = err?.response?.data;
      const code = data?.code;
      let description: string;
      switch (code) {
        case "CLASS_FULL":
          description = "Esa clase ya está llena.";
          break;
        case "ALREADY_BOOKED":
          description = "Ya tienes una reserva en esa clase.";
          break;
        case "RESCHEDULE_WINDOW_EXCEEDED":
          description = data?.message || "Ya pasó el tiempo límite para reagendar esta clase.";
          break;
        default:
          description = data?.message || "No se pudo reagendar.";
      }
      toast({ title: "No se pudo reagendar", description, variant: "destructive" });
    },
  });

  return (
    <ClientAuthGuard requiredRoles={["client"]}>
      <ClientLayout>
        <div className="space-y-4">
          <h1 className="text-xl font-bold">Mis reservas</h1>
          {isLoading ? (
            <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
          ) : (
            <Tabs defaultValue="upcoming">
              <TabsList>
                <TabsTrigger value="upcoming">Próximas ({upcoming.length})</TabsTrigger>
                <TabsTrigger value="past">Pasadas ({past.length})</TabsTrigger>
                <TabsTrigger value="cancelled">Canceladas ({cancelled.length})</TabsTrigger>
              </TabsList>
              {[
                { key: "upcoming", list: upcoming },
                { key: "past", list: past },
                { key: "cancelled", list: cancelled },
              ].map(({ key, list }) => (
                <TabsContent key={key} value={key} className="space-y-3 mt-4">
                  {list.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No hay reservas aquí</p>
                  ) : (
                    list.map((b) => (
                      <BookingCard
                        key={b.id}
                        booking={b}
                        onCancel={setCancelId}
                        onReview={setReviewBooking}
                        onReschedule={setRescheduleBooking}
                        cancellationsEnabled={cancelConfig.enabled}
                        rescheduleHours={cancelConfig.reschedule_hours}
                      />
                    ))
                  )}
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>

        {/* Cancel confirm */}
        <AlertDialog open={!!cancelId} onOpenChange={() => setCancelId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Cancelar reserva?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-3">
                <span className="block">Esta acción no se puede deshacer.</span>
                {cancelConfig.min_hours > 0 && (
                  <span className="block rounded-lg bg-[#F4EAD6] border border-[#E5CF9F] px-4 py-3 text-[#B5832F] text-xs leading-relaxed">
                    <strong>Importante:</strong>{" "}
                    {cancelConfig.late_cancel_message
                      ? cancelConfig.late_cancel_message.replace("{hours}", String(cancelConfig.min_hours))
                      : `Las cancelaciones con menos de ${cancelConfig.min_hours}h de anticipación no devolverán el crédito.`}
                  </span>
                )}
                {!cancelConfig.refund_credit_on_cancel && (
                  <span className="block rounded-lg bg-[#F4EAD6] border border-[#E5CF9F] px-4 py-3 text-[#B5832F] text-xs leading-relaxed">
                    <strong>Nota:</strong> La clase no será devuelta a tu paquete al cancelar.
                  </span>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Volver</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground"
                onClick={() => cancelId && cancelMutation.mutate(cancelId)}
              >
                Sí, cancelar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Review dialog */}
        <Dialog open={!!reviewBooking} onOpenChange={() => { setReviewBooking(null); setSelectedTags([]); setComment(""); setRating(5); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Dejar reseña — {reviewBooking?.class_type_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label>Calificación</Label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <button key={s} onClick={() => setRating(s)}>
                      <Star
                        size={24}
                        className={s <= rating ? "text-[#B5832F] fill-yellow-400" : "text-muted-foreground"}
                      />
                    </button>
                  ))}
                </div>
              </div>
              {reviewTags.length > 0 && (
                <div className="space-y-1">
                  <Label>¿Qué te gustó? (opcional)</Label>
                  <div className="flex flex-wrap gap-2">
                    {reviewTags.map((tag) => {
                      const isSelected = selectedTags.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() =>
                            setSelectedTags((prev) =>
                              isSelected ? prev.filter((t) => t !== tag.id) : [...prev, tag.id]
                            )
                          }
                          className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                            isSelected
                              ? "border-primary bg-primary/20 text-primary font-semibold"
                              : "border-border bg-secondary text-muted-foreground hover:border-primary/50"
                          }`}
                          style={isSelected && tag.color ? { borderColor: tag.color, color: tag.color, backgroundColor: `${tag.color}20` } : undefined}
                        >
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="space-y-1">
                <Label>Comentario (opcional)</Label>
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="¿Cómo fue tu clase?"
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => reviewMutation.mutate()} disabled={reviewMutation.isPending}>
                {reviewMutation.isPending ? "Enviando..." : "Enviar reseña"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Reschedule dialog */}
        <Dialog open={!!rescheduleBooking} onOpenChange={(open) => { if (!open) closeReschedule(); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Reagendar — {rescheduleBooking?.class_type_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <p className="text-xs text-muted-foreground">
                Elige una nueva clase para mover tu reserva. Tu crédito no cambia.
              </p>
              {loadingAvailable ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
                </div>
              ) : rescheduleOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No hay clases disponibles en los próximos 14 días.
                </p>
              ) : (
                <div className="max-h-[55vh] overflow-y-auto space-y-2 pr-1">
                  {rescheduleOptions.map((c) => {
                    const isSelected = selectedClassId === c.id;
                    const cap = c.max_capacity ?? c.capacity;
                    const booked = c.current_bookings;
                    const spotsLeft =
                      typeof cap === "number" && typeof booked === "number"
                        ? Math.max(0, cap - booked)
                        : null;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedClassId(c.id)}
                        className={`w-full text-left rounded-lg border px-3 py-2.5 transition-all ${
                          isSelected
                            ? "border-primary bg-primary/10 ring-1 ring-primary"
                            : "border-border hover:border-primary/50 hover:bg-secondary/50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{c.class_type_name ?? "Clase"}</p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {format(safeParse(c.start_time), "EEEE d MMM · HH:mm", { locale: es })}
                            </p>
                            {c.instructor_name && (
                              <p className="text-[11px] text-muted-foreground">{c.instructor_name}</p>
                            )}
                          </div>
                          {spotsLeft !== null && (
                            <span className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">
                              {spotsLeft} {spotsLeft === 1 ? "lugar" : "lugares"}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={closeReschedule}>Cancelar</Button>
              <Button
                disabled={!selectedClassId || rescheduleMutation.isPending}
                onClick={() => {
                  if (rescheduleBooking && selectedClassId) {
                    rescheduleMutation.mutate({ id: rescheduleBooking.id, newClassId: selectedClassId });
                  }
                }}
              >
                {rescheduleMutation.isPending ? "Reagendando..." : "Confirmar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </ClientLayout>
    </ClientAuthGuard>
  );
};

export default MyBookings;
