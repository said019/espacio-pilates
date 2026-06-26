import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { ClientAuthGuard } from "@/components/layout/ClientAuthGuard";
import ClientLayout from "@/components/layout/ClientLayout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";

const ProfilePreferences = () => {
  const navigate = useNavigate();
  const { user, updateUser } = useAuthStore();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [prefs, setPrefs] = useState({
    receiveReminders: user?.receiveReminders ?? user?.receive_reminders ?? true,
    receivePromotions: user?.receivePromotions ?? user?.receive_promotions ?? false,
    receiveWeeklySummary: user?.receiveWeeklySummary ?? user?.receive_weekly_summary ?? false,
  });

  const mutation = useMutation({
    mutationFn: () => api.put(`/users/${user?.id}`, prefs),
    onSuccess: (res) => {
      const updated = res.data?.data ?? res.data;
      if (updated?.user) updateUser(updated.user);
      qc.invalidateQueries({ queryKey: ["me"] });
      toast({ title: "Preferencias guardadas" });
    },
    onError: () => toast({ title: "Error al guardar", variant: "destructive" }),
  });

  const items = [
    { key: "receiveReminders" as const, label: "Recordatorios de clase", desc: "Recibe un recordatorio antes de cada clase" },
    { key: "receivePromotions" as const, label: "Promociones y ofertas", desc: "Entérate de descuentos y eventos especiales" },
    { key: "receiveWeeklySummary" as const, label: "Resumen semanal", desc: "Un resumen de tu actividad cada semana" },
  ];

  return (
    <ClientAuthGuard requiredRoles={["client"]}>
      <ClientLayout>
        <div className="max-w-md space-y-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/app/profile")} className="text-muted-foreground hover:text-[#D9B5BA]">
            <ArrowLeft size={16} className="mr-2" />Perfil
          </Button>
          <h1 className="text-xl font-bold">Preferencias de notificación</h1>
          <div className="space-y-4">
            {items.map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between rounded-xl border border-[#8C6B6F]/15 p-4 hover:border-[#D9B5BA]/30 transition-colors">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">{label}</Label>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
                <Switch
                  checked={prefs[key]}
                  onCheckedChange={(v) => setPrefs((p) => ({ ...p, [key]: v }))}
                />
              </div>
            ))}
          </div>
          <Button
            className="w-full bg-gradient-to-r from-[#8C6B6F] to-[#D9B5BA] hover:from-[#8C6B6F]/90 hover:to-[#D9B5BA]/90 text-white font-medium"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Guardando..." : "Guardar preferencias"}
          </Button>
        </div>
      </ClientLayout>
    </ClientAuthGuard>
  );
};

export default ProfilePreferences;
