import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, Eye, EyeOff } from "lucide-react";
import valianceLogo from "@/assets/valiance-pilates-logo.png";

const schema = z.object({
  password: z
    .string()
    .min(8, "Mínimo 8 caracteres")
    .regex(/[A-Z]/, "Debe incluir una mayúscula")
    .regex(/[0-9]/, "Debe incluir un número"),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Las contraseñas no coinciden",
  path: ["confirmPassword"],
});

type FormValues = { password: string; confirmPassword: string };

const ResetPassword = () => {
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const token = params.get("token");

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormValues) => {
    if (!token) {
      toast({ title: "Enlace inválido", description: "Solicita uno nuevo desde recuperar contraseña", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, password: data.password });
      setDone(true);
      setTimeout(() => navigate("/auth/login"), 2000);
    } catch (err: any) {
      toast({
        title: "Enlace inválido o expirado",
        description: err.response?.data?.message ?? "Solicita un enlace nuevo",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    "w-full bg-valiance-blush/30 border border-transparent rounded-2xl px-4 py-3.5 pr-12 font-body text-[0.92rem] text-valiance-charcoal placeholder:text-valiance-charcoal/35 focus:outline-none focus:bg-valiance-nude focus:border-valiance-mauve/40 transition-all";
  const labelCls =
    "text-[0.66rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium";

  return (
    <div className="min-h-[100dvh] bg-valiance-nude text-valiance-charcoal flex items-center justify-center p-6">
      <div className="w-full max-w-[420px]">
        <Link to="/" className="flex justify-center mb-10">
          <img src={valianceLogo} alt="Valiance Pilates" className="h-12 w-auto" />
        </Link>

        {done ? (
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-valiance-gold/15 mb-5">
              <CheckCircle2 size={28} className="text-valiance-gold" strokeWidth={1.6} />
            </div>
            <h1
              className="font-display text-[clamp(1.8rem,3vw,2.4rem)] leading-tight tracking-[-0.015em] text-valiance-charcoal mb-3"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Lista. Vamos a entrar.
            </h1>
            <p className="font-body text-[0.95rem] text-valiance-charcoal/70 leading-relaxed">
              Tu contraseña se actualizó. Te llevamos al inicio de sesión.
            </p>
          </div>
        ) : (
          <>
            <header className="mb-9 text-center">
              <span className="text-[0.66rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium mb-3 inline-block">
                Nueva contraseña
              </span>
              <h1
                className="font-display text-[clamp(2.2rem,4vw,3rem)] leading-[1.02] tracking-[-0.02em] text-valiance-charcoal"
                style={{ textWrap: "balance" } as React.CSSProperties}
              >
                Elige una nueva.
              </h1>
              <p className="font-body text-[0.95rem] text-valiance-charcoal/65 mt-2">
                Mínimo 8 caracteres, una mayúscula y un número.
              </p>
            </header>

            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="new-pass" className={labelCls}>Nueva contraseña</label>
                <div className="relative">
                  <input
                    id="new-pass"
                    type={showPass ? "text" : "password"}
                    placeholder="••••••••"
                    {...register("password")}
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-valiance-mauve hover:text-valiance-charcoal transition-colors"
                    aria-label={showPass ? "Ocultar" : "Mostrar"}
                  >
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.password && <span className="text-[0.78rem] text-destructive font-body">{errors.password.message}</span>}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="new-confirm" className={labelCls}>Confirmar</label>
                <div className="relative">
                  <input
                    id="new-confirm"
                    type={showConfirm ? "text" : "password"}
                    placeholder="••••••••"
                    {...register("confirmPassword")}
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-valiance-mauve hover:text-valiance-charcoal transition-colors"
                    aria-label={showConfirm ? "Ocultar" : "Mostrar"}
                  >
                    {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.confirmPassword && <span className="text-[0.78rem] text-destructive font-body">{errors.confirmPassword.message}</span>}
              </div>

              <button
                type="submit"
                disabled={loading || !token}
                className="mt-2 bg-valiance-charcoal text-valiance-nude py-4 rounded-full text-[0.82rem] font-medium tracking-[0.06em] uppercase flex items-center justify-center gap-2.5 hover:bg-valiance-plum transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-valiance-gold focus-visible:ring-offset-2 focus-visible:ring-offset-valiance-nude"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : "Cambiar contraseña"}
              </button>
            </form>

            <div className="mt-8 text-center">
              <Link
                to="/auth/login"
                className="font-body text-[0.85rem] text-valiance-mauve hover:text-valiance-charcoal transition-colors no-underline"
              >
                Volver al inicio de sesión
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
