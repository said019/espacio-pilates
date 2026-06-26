import { useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import api from "@/lib/api";
import { optimizeImage } from "@/lib/imageOptimization";

interface Props {
  userId: string;
  currentPhotoUrl?: string | null;
  displayName?: string;
  onUpdated?: (photoUrl: string) => void;
}

export function ProfilePhotoUpload({ userId, currentPhotoUrl, displayName, onUpdated }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (file: File) => {
      const optimized = await optimizeImage(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.9 });
      const formData = new FormData();
      formData.append("photo", optimized, "profile.jpg");
      const { data } = await api.post(`/users/${userId}/photo`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return (data?.photoUrl ?? data?.photo_url) as string;
    },
    onSuccess: (photoUrl) => {
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ["profile", userId] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      onUpdated?.(photoUrl);
      toast({ title: "Foto actualizada" });
    },
    onError: (err: any) => {
      setPreview(null);
      toast({
        variant: "destructive",
        title: "No se pudo subir la foto",
        description: err?.response?.data?.message ?? err?.message,
      });
    },
  });

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ variant: "destructive", title: "Selecciona una imagen" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ variant: "destructive", title: "Imagen muy grande (máx 10MB)" });
      return;
    }
    setPreview(URL.createObjectURL(file));
    mutation.mutate(file);
  };

  const photoSrc = preview || currentPhotoUrl || undefined;
  const initials = (displayName || "?")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#8C6B6F] to-[#D9B5BA] text-2xl font-bold text-white shadow-xl shadow-[#8C6B6F]/25">
          {photoSrc ? (
            <img src={photoSrc} alt="Foto de perfil" className="h-full w-full object-cover" />
          ) : (
            initials
          )}
        </div>
        {mutation.isPending && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/40">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleChange}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={mutation.isPending}
        onClick={() => fileInputRef.current?.click()}
      >
        <Camera className="mr-2 h-4 w-4" />
        {mutation.isPending ? "Subiendo..." : "Cambiar foto"}
      </Button>
    </div>
  );
}
