import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Eye, EyeOff, Check, ArrowRight } from "lucide-react";
import { COUNTRIES } from "@/components/ui/phone-input";
import heroPhoto from "@/assets/valiance-pilates-images/1000452523.jpg";
import valianceLogo from "@/assets/valiance-pilates-logo.png";

const schema = z.object({
  displayName: z.string().min(2, "Mínimo 2 caracteres"),
  email: z.string().email("Email inválido"),
  phone: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v.length >= 7 && v.length <= 15, "Teléfono inválido"),
  gender: z.enum(["female", "male", "other"]),
  password: z
    .string()
    .min(8, "Mínimo 8 caracteres")
    .regex(/[A-Z]/, "Debe incluir una mayúscula")
    .regex(/[0-9]/, "Debe incluir un número"),
  confirmPassword: z.string(),
  acceptsTerms: z.boolean().refine((v) => v, "Debes aceptar los términos"),
  acceptsCommunications: z.boolean().default(false),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Las contraseñas no coinciden",
  path: ["confirmPassword"],
});

type FormValues = {
  displayName: string;
  email: string;
  phone: string;
  gender: "female" | "male" | "other";
  password: string;
  confirmPassword: string;
  acceptsTerms: boolean;
  acceptsCommunications: boolean;
};

const PERKS = [
  "Reserva tus clases en segundos",
  "Compra paquetes desde la app",
  "Recibe recordatorios antes de tu clase",
  "Lleva tu progreso en un solo lugar",
];

const Register = () => {
  const { register: registerUser, isLoading, error, clearError } = useAuthStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { toast } = useToast();
  const refCode = params.get("ref");
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [dialCode, setDialCode] = useState("52");

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { acceptsTerms: false, acceptsCommunications: false },
  });

  const acceptsTerms = watch("acceptsTerms");
  const acceptsCommunications = watch("acceptsCommunications");

  const onSubmit = async (data: FormValues) => {
    clearError();
    const rawPhone = data.phone.replace(/\D/g, "");
    const phone = rawPhone.startsWith(dialCode) ? `+${rawPhone}` : `+${dialCode}${rawPhone}`;
    try {
      await registerUser({
        email: data.email,
        password: data.password,
        displayName: data.displayName,
        phone,
        gender: data.gender,
        acceptsTerms: data.acceptsTerms,
        acceptsCommunications: data.acceptsCommunications,
        ...(refCode ? { referralCode: refCode } : {}),
      } as any);
      navigate("/app");
    } catch {
      toast({ title: "No pudimos crear tu cuenta", description: error ?? "Inténtalo de nuevo", variant: "destructive" });
    }
  };

  const inputCls =
    "bg-valiance-blush/30 border border-transparent rounded-2xl px-4 py-3 font-body text-[0.92rem] text-valiance-charcoal placeholder:text-valiance-charcoal/35 focus:outline-none focus:bg-valiance-nude focus:border-valiance-mauve/40 transition-all";

  const labelCls =
    "text-[0.66rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium";

  return (
    <div className="min-h-[100dvh] bg-valiance-nude text-valiance-charcoal flex">
      {/* ── LEFT — visual ── */}
      <aside className="hidden lg:flex lg:w-[42%] relative overflow-hidden bg-valiance-charcoal">
        <img
          src={heroPhoto}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover scale-105"
          style={{ objectPosition: "center 35%" }}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-valiance-charcoal/85 via-valiance-charcoal/45 to-valiance-charcoal/75" />

        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <Link to="/" className="inline-block self-start" aria-label="Valiance Pilates — Inicio">
            <img src={valianceLogo} alt="Valiance Pilates" className="h-16 w-auto brightness-[10] contrast-[1.2]" />
          </Link>

          <div className="max-w-[400px]">
            <span className="inline-flex items-center gap-2 text-[0.66rem] tracking-[0.22em] uppercase text-valiance-blush/80 mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-valiance-gold animate-pulse-dot" />
              Tu primer paso
            </span>
            <h2
              className="font-display text-[clamp(2.4rem,3.6vw,3.6rem)] leading-[1.02] tracking-[-0.02em] text-valiance-nude mb-6"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Empieza una rutina <em className="not-italic text-valiance-blush">que se siente bien</em>.
            </h2>
            <p className="font-body text-[0.92rem] text-valiance-nude/70 leading-[1.75] mb-7 max-w-[340px]">
              Crear tu cuenta toma un minuto. Después solo es decidir a qué clase llegas mañana.
            </p>

            <ul className="flex flex-col gap-3 list-none">
              {PERKS.map((perk) => (
                <li key={perk} className="flex items-center gap-3">
                  <span className="w-5 h-5 rounded-full bg-valiance-gold/15 border border-valiance-gold/40 flex items-center justify-center flex-shrink-0">
                    <Check size={11} className="text-valiance-gold" strokeWidth={2.5} />
                  </span>
                  <span className="font-body text-[0.85rem] text-valiance-nude/75">{perk}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>

      {/* ── RIGHT — formulario ── */}
      <main className="flex-1 flex flex-col justify-center items-center px-6 py-10 sm:px-10 relative overflow-y-auto">
        <div className="w-full max-w-[440px] py-4">
          <Link to="/" className="flex justify-center mb-10">
            <img src={valianceLogo} alt="Valiance Pilates" className="h-16 w-auto" />
          </Link>

          <header className="mb-8">
            <span className="text-[0.66rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium mb-3 inline-block">
              Crear cuenta
            </span>
            <h1
              className="font-display text-[clamp(2.2rem,4vw,3rem)] leading-[1.02] tracking-[-0.02em] text-valiance-charcoal"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Bienvenida a Valiance.
            </h1>
            <p className="font-body text-[0.95rem] text-valiance-charcoal/65 mt-2">
              Cuéntanos quién eres.
            </p>
          </header>

          {refCode && (
            <div className="flex items-center gap-2 bg-valiance-gold/15 border border-valiance-gold/30 px-4 py-2.5 rounded-2xl mb-5 font-body text-[0.85rem] text-valiance-plum">
              <Check size={14} className="text-valiance-gold" />
              Código de referido: <strong className="text-valiance-charcoal">{refCode}</strong>
            </div>
          )}

          {error && (
            <div className="bg-destructive/10 border border-destructive/25 text-destructive font-body text-[0.85rem] px-4 py-3 rounded-2xl mb-5">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            {/* Nombre + Teléfono */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className={labelCls} htmlFor="displayName">Nombre</label>
                <input id="displayName" placeholder="¿Cómo te llamas?" {...register("displayName")} className={inputCls} />
                {errors.displayName && <span className="text-[0.78rem] text-destructive font-body">{errors.displayName.message}</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls} htmlFor="phone">Teléfono</label>
                <div className="flex gap-2">
                  <select
                    value={dialCode}
                    onChange={(e) => setDialCode(e.target.value)}
                    className={`${inputCls} w-[110px] py-3 cursor-pointer`}
                    aria-label="Código de país"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={`${c.code}-${c.dial}`} value={c.dial}>{c.flag} +{c.dial}</option>
                    ))}
                  </select>
                  <input
                    id="phone"
                    placeholder="4271234567"
                    inputMode="numeric"
                    {...register("phone")}
                    className={`${inputCls} flex-1`}
                  />
                </div>
                {errors.phone && <span className="text-[0.78rem] text-destructive font-body">{errors.phone.message}</span>}
              </div>
            </div>

            {/* Sexo */}
            <div className="flex flex-col gap-1.5">
              <label className={labelCls} htmlFor="gender">Sexo</label>
              <select id="gender" {...register("gender")} defaultValue="" className={`${inputCls} cursor-pointer`}>
                <option value="" disabled>Selecciona…</option>
                <option value="female">Femenino</option>
                <option value="male">Masculino</option>
                <option value="other">Otro</option>
              </select>
              {errors.gender && <span className="text-[0.78rem] text-destructive font-body">{errors.gender.message}</span>}
            </div>

            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <label className={labelCls} htmlFor="reg-email">Email</label>
              <input id="reg-email" type="email" autoComplete="email" placeholder="tu@email.com" {...register("email")} className={inputCls} />
              {errors.email && <span className="text-[0.78rem] text-destructive font-body">{errors.email.message}</span>}
            </div>

            {/* Contraseña + Confirmar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className={labelCls} htmlFor="reg-password">Contraseña</label>
                <div className="relative">
                  <input
                    id="reg-password"
                    type={showPass ? "text" : "password"}
                    placeholder="••••••••"
                    {...register("password")}
                    className={`${inputCls} w-full pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-valiance-mauve hover:text-valiance-charcoal transition-colors"
                    aria-label={showPass ? "Ocultar" : "Mostrar"}
                  >
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {errors.password && <span className="text-[0.78rem] text-destructive font-body">{errors.password.message}</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelCls} htmlFor="confirm">Confirmar</label>
                <div className="relative">
                  <input
                    id="confirm"
                    type={showConfirm ? "text" : "password"}
                    placeholder="••••••••"
                    {...register("confirmPassword")}
                    className={`${inputCls} w-full pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-valiance-mauve hover:text-valiance-charcoal transition-colors"
                    aria-label={showConfirm ? "Ocultar" : "Mostrar"}
                  >
                    {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {errors.confirmPassword && <span className="text-[0.78rem] text-destructive font-body">{errors.confirmPassword.message}</span>}
              </div>
            </div>

            {/* Checkboxes */}
            <div className="flex flex-col gap-3 pt-2">
              <label className="flex items-start gap-3 cursor-pointer group">
                <button
                  type="button"
                  onClick={() => setValue("acceptsTerms", !acceptsTerms)}
                  aria-pressed={acceptsTerms}
                  aria-label="Aceptar términos"
                  className={`mt-0.5 w-5 h-5 rounded-md border flex-shrink-0 flex items-center justify-center transition-all ${
                    acceptsTerms
                      ? "bg-valiance-charcoal border-valiance-charcoal"
                      : "border-valiance-mauve/30 group-hover:border-valiance-mauve"
                  }`}
                >
                  {acceptsTerms && <Check size={12} className="text-valiance-nude" strokeWidth={3} />}
                </button>
                <span className="font-body text-[0.85rem] text-valiance-charcoal/75 leading-snug">
                  Acepto los <Link to="/legal/terminos" className="text-valiance-charcoal underline hover:text-valiance-mauve">términos y condiciones</Link>
                </span>
              </label>
              {errors.acceptsTerms && <span className="text-[0.78rem] text-destructive font-body -mt-1">{errors.acceptsTerms.message}</span>}

              <label className="flex items-start gap-3 cursor-pointer group">
                <button
                  type="button"
                  onClick={() => setValue("acceptsCommunications", !acceptsCommunications)}
                  aria-pressed={acceptsCommunications}
                  aria-label="Recibir comunicaciones"
                  className={`mt-0.5 w-5 h-5 rounded-md border flex-shrink-0 flex items-center justify-center transition-all ${
                    acceptsCommunications
                      ? "bg-valiance-charcoal border-valiance-charcoal"
                      : "border-valiance-mauve/30 group-hover:border-valiance-mauve"
                  }`}
                >
                  {acceptsCommunications && <Check size={12} className="text-valiance-nude" strokeWidth={3} />}
                </button>
                <span className="font-body text-[0.85rem] text-valiance-charcoal/75 leading-snug">
                  Quiero recibir promos y novedades del estudio
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="mt-3 bg-valiance-charcoal text-valiance-nude py-4 rounded-full text-[0.82rem] font-medium tracking-[0.06em] uppercase flex items-center justify-center gap-2.5 hover:bg-valiance-plum transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-valiance-gold focus-visible:ring-offset-2 focus-visible:ring-offset-valiance-nude"
            >
              {isLoading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <>
                  Crear mi cuenta
                  <ArrowRight size={15} strokeWidth={2} />
                </>
              )}
            </button>
          </form>

          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-valiance-blush" />
            <span className="font-body text-[0.78rem] text-valiance-mauve">¿Ya tienes cuenta?</span>
            <div className="flex-1 h-px bg-valiance-blush" />
          </div>

          <Link
            to="/auth/login"
            className="flex items-center justify-center gap-2 w-full py-3.5 rounded-full border border-valiance-charcoal/15 text-valiance-charcoal text-[0.82rem] font-medium tracking-[0.06em] uppercase hover:bg-valiance-charcoal hover:text-valiance-nude hover:border-valiance-charcoal transition-all no-underline"
          >
            Iniciar sesión
          </Link>

          <p className="text-center font-body text-[0.7rem] text-valiance-charcoal/40 mt-8">
            © {new Date().getFullYear()} Valiance Pilates
          </p>
        </div>
      </main>
    </div>
  );
};

export default Register;
