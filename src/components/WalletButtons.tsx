import { useQuery, useMutation } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import api from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

// Detección simple de plataforma para priorizar el botón correcto.
const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
const isIOS = /iPad|iPhone|iPod/.test(ua);
const isAndroid = /Android/.test(ua);

export const WalletButtons = () => {
  const { toast } = useToast();
  const { data: availability } = useQuery({
    queryKey: ["wallet-availability"],
    queryFn: async () => (await api.get("/wallet/availability")).data as { apple: boolean; google: boolean },
  });

  const appleMutation = useMutation({
    mutationFn: async () => {
      const res = await api.get("/wallet/apple/pkpass", { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "tu-espacio-pilates-pass.pkpass";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    },
    onError: () => toast({ title: "No se pudo generar el pase de Apple Wallet", variant: "destructive" }),
  });

  const googleMutation = useMutation({
    mutationFn: async () => {
      const res = await api.get("/wallet/google/save-url");
      const saveUrl = (res.data as any)?.data?.saveUrl;
      if (!saveUrl) throw new Error("sin saveUrl");
      window.location.href = saveUrl;
    },
    onError: () => toast({ title: "No se pudo generar el pase de Google Wallet", variant: "destructive" }),
  });

  // Si el backend no tiene ninguna wallet operativa, no renderizar nada.
  if (!availability?.apple && !availability?.google) return null;

  // Orden por plataforma: iOS → Apple primero; Android → Google primero.
  const showApple = availability?.apple;
  const showGoogle = availability?.google;
  const appleFirst = isIOS || !isAndroid;

  const AppleBtn = showApple ? (
    <button
      key="apple"
      type="button"
      onClick={() => appleMutation.mutate()}
      disabled={appleMutation.isPending}
      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-black px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      <Wallet size={16} />
      {appleMutation.isPending ? "Generando…" : "Agregar a Apple Wallet"}
    </button>
  ) : null;

  const GoogleBtn = showGoogle ? (
    <button
      key="google"
      type="button"
      onClick={() => googleMutation.mutate()}
      disabled={googleMutation.isPending}
      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[#8C6B6F]/25 bg-white px-4 py-3 text-sm font-semibold text-[#3D3A3A] transition-colors hover:bg-[#8C6B6F]/[0.05] disabled:opacity-60"
    >
      <Wallet size={16} />
      {googleMutation.isPending ? "Abriendo…" : "Guardar en Google Wallet"}
    </button>
  ) : null;

  const buttons = appleFirst ? [AppleBtn, GoogleBtn] : [GoogleBtn, AppleBtn];

  return (
    <div className="space-y-2">
      <p className="px-1 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50">
        Mi pase
      </p>
      {buttons}
    </div>
  );
};
