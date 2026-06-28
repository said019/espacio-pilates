import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Eye, EyeOff, ArrowRight, Share, Plus, X, Download, Smartphone } from "lucide-react";
import heroPhoto from "@/assets/tu-espacio-studio/studio-mirror-line.webp";
import valianceLogo from "@/assets/tep-mark-ink.png";
import markCream from "@/assets/tep-mark-cream.png"; // sello crema → fondos oscuros

const schema = z.object({
  identifier: z.string().min(1, "Requerido"),
  password: z.string().min(1, "Requerido"),
});
type FormValues = { identifier: string; password: string };

const Login = () => {
  const { login, isLoading, error, clearError, isAuthenticated, user } = useAuthStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { toast } = useToast();
  const [showPass, setShowPass] = useState(false);
  const [installState, setInstallState] = useState<"hidden" | "android" | "ios" | "dismissed">("hidden");
  const deferredPrompt = useRef<any>(null);

  useEffect(() => {
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches
      || ("standalone" in navigator && (navigator as any).standalone);
    if (isStandalone) return;
    if (localStorage.getItem("pwa-installed")) return;

    const ua = navigator.userAgent.toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(ua);

    if (isIOS) {
      setInstallState("ios");
      return;
    }

    // Android / Chrome: wait for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e;
      setInstallState("android");
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleAndroidInstall = async () => {
    if (!deferredPrompt.current) return;
    deferredPrompt.current.prompt();
    const { outcome } = await deferredPrompt.current.userChoice;
    if (outcome === "accepted") {
      localStorage.setItem("pwa-installed", "1");
      setInstallState("dismissed");
    }
    deferredPrompt.current = null;
  };

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    if (isAuthenticated && user) {
      const returnUrl = params.get("returnUrl");
      if (returnUrl) { navigate(returnUrl); return; }
      if (["admin", "super_admin", "instructor", "reception"].includes(user.role)) navigate("/admin/dashboard");
      else navigate("/app");
    }
  }, [isAuthenticated, user]);

  const onSubmit = async (data: FormValues) => {
    clearError();
    try {
      await login(data);
      const { user: authedUser } = useAuthStore.getState();
      const returnUrl = params.get("returnUrl");
      if (returnUrl) { navigate(returnUrl, { replace: true }); return; }
      if (["admin", "super_admin", "instructor", "reception"].includes(authedUser?.role ?? "")) {
        navigate("/admin/dashboard", { replace: true });
      } else {
        navigate("/app", { replace: true });
      }
    } catch {
      toast({ title: "Algo no cuadra", description: error ?? "Verifica tus credenciales", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-[100dvh] bg-valiance-nude text-valiance-charcoal flex">
      {/* ── LEFT — visual editorial ── */}
      <aside className="hidden lg:flex lg:w-[52%] relative overflow-hidden bg-valiance-charcoal">
        <img
          src={heroPhoto}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-valiance-charcoal/90 via-valiance-charcoal/40 to-valiance-charcoal/70" />
        <div className="absolute inset-0 bg-gradient-to-t from-valiance-charcoal via-transparent to-transparent" />

        <div className="relative z-10 flex flex-col justify-between p-14 w-full">
          <Link to="/" className="inline-block self-start" aria-label="Tu Espacio Pilates — Inicio">
            <img src={markCream} alt="Tu Espacio Pilates" className="h-16 w-auto" />
          </Link>

          <div className="max-w-[460px]">
            <span className="inline-flex items-center gap-2 text-[0.66rem] tracking-[0.22em] uppercase text-valiance-blush/80 mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-valiance-gold animate-pulse-dot" />
              Bienvenida de vuelta
            </span>
            <h2
              className="font-display text-[clamp(2.6rem,4vw,4rem)] leading-[1.02] tracking-[-0.02em] text-valiance-nude mb-5"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Tu hora.<br />
              Tu fuerza.<br />
              <em className="not-italic text-valiance-blush">Tu espacio.</em>
            </h2>
            <p className="font-body text-[0.95rem] text-valiance-nude/70 leading-[1.75] max-w-[380px]">
              Entra a tu cuenta para reservar clases, ver tu paquete y revisar tu próxima sesión.
            </p>
          </div>
        </div>
      </aside>

      {/* ── RIGHT — formulario ── */}
      <main className="flex-1 flex flex-col justify-center items-center px-6 py-6 sm:px-10 relative overflow-hidden">
        <div className="w-full max-w-[400px]">
          <Link to="/" className="flex justify-center mb-5">
            <img src={valianceLogo} alt="Tu Espacio Pilates" className="h-11 w-auto" />
          </Link>

          <header className="mb-5">
            <span className="text-[0.66rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium mb-2 inline-block">
              Iniciar sesión
            </span>
            <h1
              className="font-display text-[clamp(1.9rem,3.5vw,2.6rem)] leading-[1.05] tracking-[-0.02em] text-valiance-charcoal"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Hola otra vez.
            </h1>
            <p className="font-body text-[0.88rem] text-valiance-charcoal/65 mt-1.5">
              Te estábamos esperando.
            </p>
          </header>

          {error && (
            <div className="bg-destructive/10 border border-destructive/25 text-destructive font-body text-[0.82rem] px-4 py-2.5 rounded-2xl mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="identifier" className="text-[0.66rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium">
                Teléfono o correo
              </label>
              <input
                id="identifier"
                type="text"
                autoComplete="username"
                placeholder="Tu teléfono"
                {...register("identifier")}
                className="bg-valiance-blush/30 border border-transparent rounded-2xl px-4 py-2.5 font-body text-[0.92rem] text-valiance-charcoal placeholder:text-valiance-charcoal/35 focus:outline-none focus:bg-valiance-nude focus:border-valiance-mauve/40 transition-all"
              />
              {errors.identifier && <span className="text-[0.78rem] text-destructive font-body">{errors.identifier.message}</span>}
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-[0.66rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium">
                  Contraseña
                </label>
                <Link to="/auth/forgot-password" className="font-body text-[0.78rem] text-valiance-mauve hover:text-valiance-charcoal transition-colors no-underline">
                  ¿La olvidaste?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPass ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  {...register("password")}
                  className="w-full bg-valiance-blush/30 border border-transparent rounded-2xl px-4 py-2.5 pr-12 font-body text-[0.92rem] text-valiance-charcoal placeholder:text-valiance-charcoal/35 focus:outline-none focus:bg-valiance-nude focus:border-valiance-mauve/40 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-valiance-mauve hover:text-valiance-charcoal transition-colors"
                  aria-label={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && <span className="text-[0.78rem] text-destructive font-body">{errors.password.message}</span>}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="mt-1.5 bg-valiance-charcoal text-valiance-nude py-3 rounded-full text-[0.82rem] font-medium tracking-[0.06em] uppercase flex items-center justify-center gap-2.5 hover:bg-valiance-plum transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-valiance-gold focus-visible:ring-offset-2 focus-visible:ring-offset-valiance-nude"
            >
              {isLoading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <>
                  Entrar
                  <ArrowRight size={15} strokeWidth={2} />
                </>
              )}
            </button>
          </form>

          <div className="flex items-center gap-4 my-4">
            <div className="flex-1 h-px bg-valiance-blush" />
            <span className="font-body text-[0.75rem] text-valiance-mauve">¿Primera vez?</span>
            <div className="flex-1 h-px bg-valiance-blush" />
          </div>

          <Link
            to="/auth/register"
            className="flex items-center justify-center gap-2 w-full py-3 rounded-full border border-valiance-charcoal/15 text-valiance-charcoal text-[0.82rem] font-medium tracking-[0.06em] uppercase hover:bg-valiance-charcoal hover:text-valiance-nude hover:border-valiance-charcoal transition-all no-underline"
          >
            Crear cuenta
          </Link>

          {/* ── PWA Install ── */}
          {installState === "android" && (
            <div className="mt-3 relative rounded-2xl overflow-hidden border border-valiance-blush bg-gradient-to-br from-valiance-blush/40 to-valiance-nude">
              <button
                onClick={() => { setInstallState("dismissed"); localStorage.setItem("pwa-installed", "1"); }}
                className="absolute top-3 right-3 text-valiance-mauve/60 hover:text-valiance-charcoal transition-colors"
                aria-label="Cerrar"
              >
                <X size={13} />
              </button>
              <div className="p-3 flex items-center gap-3">
                <div className="shrink-0 w-11 h-11 rounded-xl bg-valiance-nude shadow-sm flex items-center justify-center border border-valiance-blush">
                  <img src={valianceLogo} alt="Tu Espacio Pilates" className="w-8 h-8 object-contain" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-display text-[0.88rem] text-valiance-charcoal leading-tight mb-0.5">Instala Tu Espacio Pilates</p>
                  <p className="font-body text-[0.7rem] text-valiance-charcoal/55 leading-snug">Accede más rápido desde tu pantalla de inicio</p>
                </div>
              </div>
              <div className="px-3 pb-3">
                <button
                  onClick={handleAndroidInstall}
                  className="w-full flex items-center justify-center gap-2 bg-valiance-charcoal text-valiance-nude text-[0.78rem] font-medium tracking-[0.05em] uppercase rounded-full py-2.5 hover:bg-valiance-plum transition-colors"
                >
                  <Download size={13} />
                  Instalar app
                </button>
              </div>
            </div>
          )}

          {installState === "ios" && (
            <div className="mt-3 relative rounded-2xl overflow-hidden border border-valiance-blush bg-gradient-to-br from-valiance-blush/40 to-valiance-nude">
              <button
                onClick={() => setInstallState("dismissed")}
                className="absolute top-3 right-3 text-valiance-mauve/60 hover:text-valiance-charcoal transition-colors"
                aria-label="Cerrar"
              >
                <X size={13} />
              </button>
              <div className="p-3 flex items-center gap-3">
                <div className="shrink-0 w-11 h-11 rounded-xl bg-valiance-nude shadow-sm flex items-center justify-center border border-valiance-blush">
                  <img src={valianceLogo} alt="Tu Espacio Pilates" className="w-8 h-8 object-contain" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-display text-[0.88rem] text-valiance-charcoal leading-tight mb-0.5">Instala Tu Espacio Pilates en tu iPhone</p>
                  <p className="font-body text-[0.7rem] text-valiance-charcoal/55">Agrégala a tu pantalla de inicio</p>
                </div>
              </div>
              <div className="px-3 pb-3 flex flex-col gap-1.5">
                {[
                  { icon: <Share size={12} className="text-[#007AFF] shrink-0" />, text: <>Toca <strong>Compartir</strong> en Safari</> },
                  { icon: <Plus size={12} className="text-valiance-charcoal shrink-0" />, text: <>Selecciona <strong>"Agregar a pantalla de inicio"</strong></> },
                  { icon: <Smartphone size={12} className="text-valiance-mauve shrink-0" />, text: <>Toca <strong>"Agregar"</strong> y listo</> },
                ].map((step, i) => (
                  <div key={i} className="flex items-center gap-2.5 bg-valiance-nude/70 rounded-xl px-3 py-2">
                    <span className="w-4 h-4 rounded-full bg-valiance-blush flex items-center justify-center text-[0.58rem] font-bold text-valiance-charcoal shrink-0">{i + 1}</span>
                    {step.icon}
                    <span className="font-body text-[0.72rem] text-valiance-charcoal/80">{step.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-center font-body text-[0.68rem] text-valiance-charcoal/35 mt-4">
            © {new Date().getFullYear()} Tu Espacio Pilates
          </p>
        </div>
      </main>
    </div>
  );
};

export default Login;
