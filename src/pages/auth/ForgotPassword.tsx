import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, ArrowLeft } from "lucide-react";
import valianceLogo from "@/assets/tep-mark-ink.png";

const schema = z.object({ identifier: z.string().min(1, "Requerido") });
type FormValues = { identifier: string };

const ForgotPassword = () => {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormValues) => {
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { identifier: data.identifier });
      setSent(true);
    } catch (err: any) {
      toast({
        title: "No pudimos enviar el enlace",
        description: err.response?.data?.message ?? "Inténtalo de nuevo en un momento",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-valiance-nude text-valiance-charcoal flex items-center justify-center p-6">
      <div className="w-full max-w-[420px]">
        <Link to="/" className="flex justify-center mb-10">
          <img src={valianceLogo} alt="Tu Espacio Pilates" className="h-12 w-auto" />
        </Link>

        {sent ? (
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-valiance-gold/15 mb-5">
              <CheckCircle2 size={28} className="text-valiance-gold" strokeWidth={1.6} />
            </div>
            <h1
              className="font-display text-[clamp(1.8rem,3vw,2.4rem)] leading-tight tracking-[-0.015em] text-valiance-charcoal mb-3"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Revisa tu correo.
            </h1>
            <p className="font-body text-[0.95rem] text-valiance-charcoal/70 leading-relaxed mb-8 max-w-[340px] mx-auto">
              Si la cuenta existe y tiene correo, te enviamos un enlace para recuperar tu contraseña. Si te registraste solo con teléfono, escríbenos por WhatsApp y te ayudamos a entrar.
            </p>
            <Link
              to="/auth/login"
              className="inline-flex items-center gap-2 text-[0.82rem] font-medium tracking-[0.06em] uppercase text-valiance-mauve hover:text-valiance-charcoal transition-colors no-underline"
            >
              <ArrowLeft size={14} />
              Volver al inicio de sesión
            </Link>
          </div>
        ) : (
          <>
            <header className="mb-9 text-center">
              <span className="text-[0.66rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium mb-3 inline-block">
                Recuperar contraseña
              </span>
              <h1
                className="font-display text-[clamp(2.2rem,4vw,3rem)] leading-[1.02] tracking-[-0.02em] text-valiance-charcoal"
                style={{ textWrap: "balance" } as React.CSSProperties}
              >
                Te ayudamos a entrar.
              </h1>
              <p className="font-body text-[0.95rem] text-valiance-charcoal/65 mt-2">
                Si tienes correo registrado te mandamos un enlace; si no, escríbenos por WhatsApp y te ayudamos.
              </p>
            </header>

            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="forgot-id" className="text-[0.66rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium">
                  Teléfono o correo
                </label>
                <input
                  id="forgot-id"
                  type="text"
                  autoComplete="username"
                  placeholder="Tu teléfono"
                  {...register("identifier")}
                  className="bg-valiance-blush/30 border border-transparent rounded-2xl px-4 py-3.5 font-body text-[0.92rem] text-valiance-charcoal placeholder:text-valiance-charcoal/35 focus:outline-none focus:bg-valiance-nude focus:border-valiance-mauve/40 transition-all"
                />
                {errors.identifier && <span className="text-[0.78rem] text-destructive font-body">{errors.identifier.message}</span>}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 bg-valiance-charcoal text-valiance-nude py-4 rounded-full text-[0.82rem] font-medium tracking-[0.06em] uppercase flex items-center justify-center gap-2.5 hover:bg-valiance-plum transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-valiance-gold focus-visible:ring-offset-2 focus-visible:ring-offset-valiance-nude"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : "Enviar enlace"}
              </button>
            </form>

            <div className="mt-8 text-center">
              <Link
                to="/auth/login"
                className="inline-flex items-center gap-2 font-body text-[0.85rem] text-valiance-mauve hover:text-valiance-charcoal transition-colors no-underline"
              >
                <ArrowLeft size={13} />
                Volver al inicio de sesión
              </Link>
            </div>

            <p className="text-center font-body text-[0.7rem] text-valiance-charcoal/40 mt-10">
              © {new Date().getFullYear()} Tu Espacio Pilates
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;
