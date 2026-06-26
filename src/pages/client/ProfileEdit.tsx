import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import api from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { ClientAuthGuard } from "@/components/layout/ClientAuthGuard";
import ClientLayout from "@/components/layout/ClientLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2 } from "lucide-react";
import { ProfilePhotoUpload } from "@/components/ProfilePhotoUpload";
import type { UpdateProfileData } from "@/types/auth";

const schema = z.object({
  displayName: z.string().min(2, "Mínimo 2 caracteres"),
  phone: z.string().regex(/^\+52[0-9]{10}$/, "Formato: +521234567890").or(z.literal("")),
  gender: z.enum(["female", "male", "other", ""]).optional(),
  dateOfBirth: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  healthNotes: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

const ProfileEdit = () => {
  const { user, updateUser } = useAuthStore();
  const navigate = useNavigate();
  const { toast } = useToast();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    if (user) {
      reset({
        displayName: user.displayName ?? user.display_name ?? "",
        phone: user.phone ?? "",
        gender: (user as any).gender ?? "",
        dateOfBirth: user.dateOfBirth ?? user.date_of_birth ?? "",
        emergencyContactName: user.emergencyContactName ?? user.emergency_contact_name ?? "",
        emergencyContactPhone: user.emergencyContactPhone ?? user.emergency_contact_phone ?? "",
        healthNotes: user.healthNotes ?? user.health_notes ?? "",
      });
    }
  }, [user]);

  const mutation = useMutation({
    mutationFn: (data: UpdateProfileData) => api.put(`/users/${user?.id}`, data),
    onSuccess: (res) => {
      const updated = res.data?.data ?? res.data;
      if (updated?.user) updateUser(updated.user);
      toast({ title: "Perfil actualizado" });
      navigate("/app/profile");
    },
    onError: () => toast({ title: "Error al guardar", variant: "destructive" }),
  });

  const onSubmit = (data: FormValues) => {
    mutation.mutate({
      displayName: data.displayName,
      phone: data.phone || undefined,
      gender: data.gender || undefined,
      dateOfBirth: data.dateOfBirth || undefined,
      emergencyContactName: data.emergencyContactName || undefined,
      emergencyContactPhone: data.emergencyContactPhone || undefined,
      healthNotes: data.healthNotes || undefined,
    } as any);
  };

  return (
    <ClientAuthGuard requiredRoles={["client"]}>
      <ClientLayout>
        <div className="max-w-md space-y-5">
          <Button variant="ghost" size="sm" onClick={() => navigate("/app/profile")} className="text-muted-foreground hover:text-[#D9B5BA]">
            <ArrowLeft size={16} className="mr-2" />Perfil
          </Button>
          <h1 className="text-xl font-bold">Editar perfil</h1>

          {user?.id && (
            <div className="rounded-2xl border border-[#8C6B6F]/15 bg-[#8C6B6F]/[0.03] p-5">
              <ProfilePhotoUpload
                userId={user.id}
                currentPhotoUrl={(user as any)?.photoUrl ?? (user as any)?.photo_url ?? null}
                displayName={user.displayName ?? user.display_name ?? user.email ?? ""}
                onUpdated={(photoUrl) => updateUser({ ...(user as any), photoUrl, photo_url: photoUrl })}
              />
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {[
              { name: "displayName" as const, label: "Nombre completo" },
              { name: "phone" as const, label: "Teléfono", placeholder: "+521234567890" },
              { name: "dateOfBirth" as const, label: "Fecha de nacimiento", type: "date" },
              { name: "emergencyContactName" as const, label: "Contacto de emergencia" },
              { name: "emergencyContactPhone" as const, label: "Teléfono de emergencia" },
            ].map(({ name, label, type, placeholder }) => (
              <div key={name} className="space-y-1.5">
                <Label className="text-xs uppercase tracking-widest text-muted-foreground font-medium">{label}</Label>
                <Input
                  type={type ?? "text"}
                  placeholder={placeholder}
                  {...register(name)}
                  className="bg-secondary border-border focus:border-[#D9B5BA] transition-colors"
                />
                {errors[name] && <p className="text-xs text-destructive">{errors[name]?.message}</p>}
              </div>
            ))}

            {/* Gender select */}
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground font-medium">Sexo</Label>
              <select
                {...register("gender")}
                className="w-full rounded-md bg-secondary border border-border px-3 py-2.5 text-sm text-foreground focus:border-[#D9B5BA] focus:outline-none transition-colors"
              >
                <option value="">Selecciona…</option>
                <option value="female">Femenino</option>
                <option value="male">Masculino</option>
                <option value="other">Otro</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground font-medium">Notas de salud</Label>
              <Textarea
                placeholder="Alergias, condiciones médicas relevantes..."
                {...register("healthNotes")}
                className="bg-secondary border-border focus:border-[#D9B5BA] transition-colors"
              />
            </div>
            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-[#8C6B6F] to-[#D9B5BA] hover:from-[#8C6B6F]/90 hover:to-[#D9B5BA]/90 text-white font-medium"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
              Guardar cambios
            </Button>
          </form>
        </div>
      </ClientLayout>
    </ClientAuthGuard>
  );
};

export default ProfileEdit;
