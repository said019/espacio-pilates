import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import api from "@/lib/api";
import { safeParse } from "@/lib/utils";
import { ClientAuthGuard } from "@/components/layout/ClientAuthGuard";
import ClientLayout from "@/components/layout/ClientLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Calendar, Clock, Users, User, ArrowLeft } from "lucide-react";

const BookClassConfirm = () => {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: classData, isLoading } = useQuery({
    queryKey: ["class-detail", classId],
    queryFn: async () => (await api.get(`/classes/${classId}`)).data,
  });

  const cls = classData?.data ?? classData ?? null;

  const bookMutation = useMutation({
    mutationFn: () => api.post("/bookings", { classId }),
    onSuccess: (res) => {
      const data = res.data;
      qc.invalidateQueries({ queryKey: ["my-bookings"] });
      qc.invalidateQueries({ queryKey: ["my-membership"] });
      qc.invalidateQueries({ queryKey: ["public-classes"] });
      if (data?.booking?.status === "waitlist") {
        toast({ title: "En lista de espera", description: "Te avisaremos si se libera un lugar" });
      } else {
        toast({ title: "¡Reserva confirmada!" });
      }
      navigate("/app/bookings");
    },
    onError: (err: any) => {
      toast({
        title: "No se pudo reservar",
        description: err.response?.data?.message ?? "Inténtalo de nuevo",
        variant: "destructive",
      });
    },
  });

  return (
    <ClientAuthGuard requiredRoles={["client"]}>
      <ClientLayout>
        <div className="max-w-lg space-y-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/app/classes")}>
            <ArrowLeft size={16} className="mr-2" />Volver al calendario
          </Button>
          <h1 className="text-xl font-bold">Confirmar reserva</h1>
          {isLoading ? (
            <Skeleton className="h-48 w-full rounded-xl" />
          ) : cls ? (
            <Card>
              <CardHeader>
                <CardTitle>{cls.class_type_name}</CardTitle>
                <Badge variant="outline" className="w-fit">{cls.level ?? "Todos los niveles"}</Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Calendar size={14} className="text-muted-foreground" />
                  {cls.start_time ? format(safeParse(cls.start_time), "EEEE d 'de' MMMM yyyy", { locale: es }) : "—"}
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock size={14} className="text-muted-foreground" />
                  {cls.start_time ? format(safeParse(cls.start_time), "HH:mm") : "—"} – {cls.end_time ? format(safeParse(cls.end_time), "HH:mm") : "—"}
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <User size={14} className="text-muted-foreground" />
                  {cls.instructor_name}
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Users size={14} className="text-muted-foreground" />
                  {cls.current_bookings ?? 0} / {cls.max_capacity} lugares
                </div>
                <Button
                  className="w-full mt-4"
                  onClick={() => bookMutation.mutate()}
                  disabled={bookMutation.isPending}
                >
                  {bookMutation.isPending ? "Reservando..." : "Confirmar reserva"}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-muted-foreground">Clase no encontrada</p>
          )}
        </div>
      </ClientLayout>
    </ClientAuthGuard>
  );
};

export default BookClassConfirm;
