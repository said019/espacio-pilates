import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import Schedule from "@/components/Schedule";
import {
  Sparkles, Clock, MapPin, Phone, Instagram,
  ArrowUpRight, Menu, X, Heart, Users, Star,
} from "lucide-react";

import heroCoachMirror from "@/assets/tu-espacio-studio/hero-coach-mirror.webp";
import coachGuidance from "@/assets/tu-espacio-studio/coach-guidance.webp";
import studioMirrorLine from "@/assets/tu-espacio-studio/studio-mirror-line.webp";
import reformerPlank from "@/assets/tu-espacio-studio/reformer-plank.webp";
import towerInversion from "@/assets/tu-espacio-studio/tower-inversion.webp";
import towerControl from "@/assets/tu-espacio-studio/tower-control.webp";
import heartMirrorDetail from "@/assets/tu-espacio-studio/heart-mirror-detail.webp";
import reformerSideStretch from "@/assets/tu-espacio-studio/reformer-side-stretch.webp";
import mirrorStrapDetail from "@/assets/tu-espacio-studio/mirror-strap-detail.webp";
import markCream from "@/assets/tep-mark-cream.png"; // sello CREMA → fondos OSCUROS
import markInk from "@/assets/tep-mark-ink.png";     // sello TINTA → fondos CLAROS

/* ───── Types ───── */
type ClassTypeRow = {
  id: string; name: string; subtitle: string | null; description: string | null;
  category: string; intensity: string; color: string; emoji: string;
  level: string; duration_min: number; capacity: number;
  is_active: boolean; sort_order: number;
};
type PackageRow = {
  id: string; name: string; num_classes: string; price: number;
  discount_price?: number; category: string; validity_days: number;
  is_active: boolean; sort_order: number;
};

/* ───── Datos reales Tu Espacio Pilates VM ───── */
const FALLBACK_CLASS_TYPES: ClassTypeRow[] = [
  {
    id: "c1", name: "Pilates", subtitle: "Disciplina única",
    description: "Una sola práctica, cuatro aparatos. Trabajamos sobre reformer, tower, mat y silla en grupos de 8. Bajo impacto, alta exigencia y atención personalizada en cada clase. La diferencia está en el método y en nuestros aparatos.",
    category: "pilates", intensity: "media", color: "#D1B9B4",
    emoji: "waves", level: "Todos los niveles · madres y embarazadas", duration_min: 55, capacity: 8,
    is_active: true, sort_order: 1,
  },
  {
    id: "c2", name: "Reformer", subtitle: "El aparato estrella",
    description: "Resistencia controlada con poleas y resortes. Construye fuerza, postura y control de core sin castigar las articulaciones. Cada movimiento se adapta a ti.",
    category: "reformer", intensity: "media", color: "#D1B9B4",
    emoji: "sparkles", level: "Todos los niveles", duration_min: 55, capacity: 8,
    is_active: true, sort_order: 2,
  },
  {
    id: "c3", name: "Tower & Silla", subtitle: "Fuerza y estabilidad",
    description: "El tower y la silla suman planos de movimiento distintos: más rango, más reto de equilibrio y un trabajo profundo de tren superior y core.",
    category: "tower", intensity: "media", color: "#9B997B",
    emoji: "flame", level: "Todos los niveles", duration_min: 55, capacity: 8,
    is_active: true, sort_order: 3,
  },
  {
    id: "c4", name: "Mat", subtitle: "Pilates clásico en colchoneta",
    description: "Conexión profunda con el core, respiración consciente y control postural. Sin máquina, todo eres tú y tu cuerpo.",
    category: "mat", intensity: "media", color: "#716D64",
    emoji: "activity", level: "Todos los niveles", duration_min: 55, capacity: 8,
    is_active: true, sort_order: 4,
  },
];

/* Paquetes mensuales — no acumulables, vencen 30 días después de la compra */
const PAQUETES = [
  { id: "p1", name: "7 clases", plan: "Paquete 7 Clases", classes: 7, price: 880, hint: "1 a 2 por semana" },
  { id: "p2", name: "9 clases", plan: "Paquete 9 Clases", classes: 9, price: 1050, hint: "2 por semana", popular: true },
  { id: "p3", name: "14 clases", plan: "Paquete 14 Clases", classes: 14, price: 1400, hint: "3+ por semana", best: true },
] as const;

/* Cargos puntuales */
const CARGOS = [
  { id: "x1", name: "Inscripción", plan: "Inscripción", price: 500, hint: "Pago único" },
  { id: "x2", name: "Clase extra", plan: "Clase Extra", price: 130, hint: "Para ya inscritas" },
  { id: "x3", name: "Clase suelta / visita", plan: "Clase Suelta / Visita", price: 250, hint: "Sin inscripción" },
] as const;

/* Eventos — sección informativa, no reservable */
const EVENTO_BASE = [
  { personas: "3 personas", price: 900 },
  { personas: "4 personas", price: 1200 },
  { personas: "5 personas", price: 1490 },
  { personas: "8 personas", price: 2000 },
] as const;

const EVENTO_BRUNCH = [
  { personas: "3 personas", price: 1350 },
  { personas: "4 personas", price: 1800 },
  { personas: "5 personas", price: 2250 },
  { personas: "8 personas", price: 2600 },
] as const;

const HORARIOS_EVENTOS = "Sábado 11 am · 4, 5, 6, 7 pm · Domingo 10, 11, 12 pm";

const VALORES = [
  { icon: Star, label: "Disciplina", text: "Bajo impacto, alta exigencia. Constancia que se siente clase con clase." },
  { icon: Heart, label: "Respeto", text: "Cuidamos el espacio, el silencio y el ritmo de cada compañera." },
  { icon: Users, label: "Comunidad", text: "Grupos de 8 para que nadie pase desapercibida. Aquí te conocen por tu nombre." },
  { icon: Sparkles, label: "Higiene", text: "Equipo limpio antes y después de cada uso. Un espacio impecable para todas." },
];

const POLITICAS = [
  { num: "01", title: "Calcetín antiderrapante", text: "Siempre, en todos los aparatos. Es por seguridad y por higiene del equipo." },
  { num: "02", title: "Ingresa en silencio", text: "Por respeto a las compañeras que ya están en su clase. Llega, respira y conéctate." },
  { num: "03", title: "Deja tus cosas en el rack", text: "Zapatos y objetos personales van en su lugar. Salón despejado, mente despejada." },
  { num: "04", title: "Limpia tu equipo", text: "Cama, straps, caja, pelota, tapete y barra: todo lo que uses queda limpio para la siguiente." },
  { num: "05", title: "No azotes las camas", text: "Acompaña el movimiento del carro. Cuidar el reformer es cuidar a todas." },
  { num: "06", title: "Celular en silencio", text: "Llamadas urgentes, fuera del salón. Esta hora es solo para ti." },
  { num: "07", title: "Entra y sal por la derecha", text: "Siempre por el lado derecho de la cama y espera a que tu compañera se retire primero." },
  { num: "08", title: "Puntualidad", text: "Tolerancia de 5 minutos. Llegar a tiempo cuida tu clase y la de todas." },
];

/* ─────────────────────────────────────────────────────────── */
const Index = () => {
  const [navScrolled, setNavScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [classTypes, setClassTypes] = useState<ClassTypeRow[]>(FALLBACK_CLASS_TYPES);
  const [livePlans, setLivePlans] = useState<{ name: string; price: number }[]>([]);
  const priceByName = useMemo(
    () => Object.fromEntries(livePlans.map((p) => [p.name, Number(p.price)])),
    [livePlans],
  );

  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuthStore();
  const isAdmin = ["admin", "super_admin", "instructor", "reception"].includes(user?.role ?? "");
  const ctaPath = isAuthenticated ? (isAdmin ? "/admin/dashboard" : "/app/checkout") : "/auth/register";

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 32);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    api.get<{ data: ClassTypeRow[] }>("/admin/class-types").then(({ data }) => {
      const rows = Array.isArray(data?.data) ? data.data.filter((c: any) => c.is_active) : [];
      if (rows.length > 0) setClassTypes(rows);
    }).catch(() => {});
    api.get("/plans").then(({ data }) => {
      setLivePlans(Array.isArray(data?.data) ? data.data : []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("opacity-100", "translate-y-0", "scale-x-100");
          e.target.classList.remove("opacity-0", "translate-y-6", "scale-x-0");
        }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileMenuOpen]);

  const scrollTo = (id: string) => {
    setMobileMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  const NAV_ITEMS = [
    { label: "Filosofía", id: "filosofia" },
    { label: "Clases", id: "clases" },
    { label: "Horario", id: "horario" },
    { label: "Precios", id: "precios" },
    { label: "Estudio", id: "estudio" },
    { label: "Eventos", id: "eventos" },
    { label: "Visítanos", id: "contacto" },
  ];

  return (
    <div className="min-h-screen bg-valiance-nude text-valiance-charcoal selection:bg-valiance-blush selection:text-valiance-charcoal">
      {/* ────────── NAV ────────── */}
      <nav
        className={`fixed top-0 inset-x-0 z-[100] transition-all duration-500 ${
          navScrolled || mobileMenuOpen
            ? "bg-valiance-nude/85 backdrop-blur-xl shadow-[0_1px_0_rgba(192,170,214,0.25)]"
            : "bg-transparent"
        }`}
      >
        <div className="max-w-[1200px] mx-auto flex items-center justify-between px-6 sm:px-10 py-3.5">
          <a
            href="#"
            className="relative flex items-center group"
            aria-label="Tu Espacio Pilates — Inicio"
            onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          >
            {/* Crossfade de sello según scroll: crema sobre hero, tinta sobre nude */}
            <span className="relative block h-10 sm:h-12 w-auto">
              <img
                src={markCream}
                alt=""
                aria-hidden
                className={`h-10 sm:h-12 w-auto object-contain transition-opacity duration-500 ${
                  navScrolled || mobileMenuOpen ? "opacity-0" : "opacity-100"
                }`}
              />
              <img
                src={markInk}
                alt="Tu Espacio Pilates"
                className={`absolute inset-0 h-10 sm:h-12 w-auto object-contain transition-opacity duration-500 ${
                  navScrolled || mobileMenuOpen ? "opacity-100" : "opacity-0"
                }`}
              />
            </span>
          </a>

          <ul className="hidden lg:flex items-center gap-1 list-none">
            {NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => scrollTo(item.id)}
                  className={`px-3.5 py-2 text-[0.78rem] tracking-[0.04em] transition-colors bg-transparent border-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-valiance-gold/50 rounded-full ${
                    navScrolled || mobileMenuOpen
                      ? "text-valiance-charcoal/70 hover:text-valiance-charcoal"
                      : "text-valiance-nude/80 hover:text-valiance-nude"
                  }`}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2.5">
            {isAuthenticated && user ? (
              <button
                onClick={() => navigate(isAdmin ? "/admin/dashboard" : "/app")}
                className="hidden sm:inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[0.78rem] font-medium tracking-wide bg-valiance-charcoal text-valiance-nude hover:bg-valiance-plum transition-colors active:scale-[0.98]"
              >
                <span className="w-6 h-6 rounded-full bg-valiance-blush/20 flex items-center justify-center text-[0.7rem] font-semibold uppercase">
                  {user.displayName?.[0] ?? user.email?.[0] ?? "U"}
                </span>
                {isAdmin ? "Admin" : (user.displayName?.split(" ")[0] ?? "Mi cuenta")}
              </button>
            ) : (
              <>
                <button
                  onClick={() => navigate("/auth/login")}
                  className={`hidden sm:block text-[0.78rem] tracking-wide transition-colors bg-transparent border-none cursor-pointer px-3 py-2 ${
                    navScrolled || mobileMenuOpen
                      ? "text-valiance-charcoal/70 hover:text-valiance-charcoal"
                      : "text-valiance-nude/80 hover:text-valiance-nude"
                  }`}
                >
                  Iniciar sesión
                </button>
                <button
                  onClick={() => navigate("/auth/register")}
                  className={`px-5 py-2.5 rounded-full text-[0.78rem] font-medium tracking-wide transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-valiance-gold/50 ${
                    navScrolled || mobileMenuOpen
                      ? "bg-valiance-charcoal text-valiance-nude hover:bg-valiance-plum"
                      : "bg-valiance-nude text-valiance-charcoal hover:bg-valiance-blush"
                  }`}
                >
                  Reservar
                </button>
              </>
            )}

            <button
              onClick={() => setMobileMenuOpen(true)}
              className={`lg:hidden w-10 h-10 flex items-center justify-center rounded-full transition-colors ${
                navScrolled || mobileMenuOpen ? "hover:bg-valiance-lavender/25" : "hover:bg-valiance-nude/15"
              }`}
              aria-label="Abrir menú"
            >
              <Menu size={20} className={navScrolled || mobileMenuOpen ? "text-valiance-charcoal" : "text-valiance-nude"} />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile drawer — RENDERED OUTSIDE <nav> so backdrop-filter on nav doesn't trap position:fixed */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[200] lg:hidden">
          <button
            className="absolute inset-0 bg-valiance-plum/70 backdrop-blur-md animate-in fade-in duration-150"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Cerrar menú"
          />
          <div
            className="absolute right-0 top-0 bottom-0 w-[88%] max-w-[360px] shadow-[0_30px_60px_-20px_rgba(140,107,111,0.45)] flex flex-col animate-in slide-in-from-right duration-200 bg-valiance-nude"
            style={{ backgroundColor: "#FAF8F6", backdropFilter: "none" }}
          >
            <div className="flex items-center justify-between px-6 py-5 border-b border-valiance-lavender/25">
              <img src={markInk} alt="Tu Espacio Pilates" className="h-10 w-auto object-contain" />
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-valiance-lavender/25 transition-colors"
                aria-label="Cerrar menú"
              >
                <X size={18} className="text-valiance-charcoal" />
              </button>
            </div>
            <nav className="flex-1 py-3 overflow-y-auto" aria-label="Navegación principal">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => scrollTo(item.id)}
                  className="w-full text-left px-6 py-3.5 text-[1.15rem] font-display text-valiance-charcoal hover:bg-valiance-lavender/20 transition-colors bg-transparent border-none cursor-pointer"
                >
                  {item.label}
                </button>
              ))}
            </nav>
            {!isAuthenticated && (
              <div className="px-6 py-5 border-t border-valiance-lavender/25 space-y-2.5">
                <button
                  onClick={() => { setMobileMenuOpen(false); navigate("/auth/login"); }}
                  className="w-full py-3 rounded-full border border-valiance-mauve/30 text-valiance-charcoal text-[0.82rem] font-medium hover:bg-valiance-lavender/20 transition-colors"
                >
                  Iniciar sesión
                </button>
                <button
                  onClick={() => { setMobileMenuOpen(false); navigate("/auth/register"); }}
                  className="w-full py-3 rounded-full bg-valiance-charcoal text-valiance-nude text-[0.82rem] font-medium hover:bg-valiance-plum transition-colors"
                >
                  Reservar primera clase
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ────────── HERO ────────── */}
      <section className="relative min-h-[100dvh] flex items-end overflow-hidden">
        <div className="absolute inset-0">
          <img
            src={heroCoachMirror}
            alt="Clase de reformer en Tu Espacio Pilates Villa Magna"
            className="w-full h-full object-cover"
            style={{ objectPosition: "center 42%", filter: "saturate(0.82) contrast(1.02)" }}
            loading="eager"
            fetchPriority="high"
            decoding="sync"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-valiance-charcoal/95 via-valiance-charcoal/56 to-valiance-charcoal/18 sm:from-valiance-charcoal/88 sm:via-valiance-charcoal/34 sm:to-valiance-charcoal/8" />
          <div className="absolute inset-0 bg-gradient-to-r from-valiance-charcoal/72 via-valiance-charcoal/28 to-transparent sm:from-valiance-charcoal/58 sm:via-valiance-olive/20" />
          <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_180px_60px_rgba(68,68,68,0.42)] sm:shadow-[inset_0_0_180px_60px_rgba(68,68,68,0.30)]" />
        </div>

        <div className="relative z-10 w-full max-w-[1200px] mx-auto px-6 sm:px-10 pb-28 sm:pb-28 pt-32">
          <div className="max-w-[640px]">
            {/* Sello crema — firma del hero, directo sobre la foto */}
            <img
              src={markCream}
              alt="Tu Espacio Pilates"
              className="h-16 sm:h-20 w-auto object-contain opacity-95 mb-7 reveal opacity-0 translate-y-6 transition-all duration-700"
            />

            <p className="flex items-center text-[0.7rem] tracking-[0.28em] uppercase text-valiance-nude/80 font-body mb-7 reveal opacity-0 translate-y-6 transition-all duration-700 delay-100">
              <span className="inline-block w-7 h-px bg-valiance-gold mr-3" />
              Pilates boutique · Villa Magna, SLP
            </p>

            <h1
              className="font-display font-normal text-[clamp(3rem,8vw,6.5rem)] leading-[0.96] tracking-[-0.02em] text-valiance-nude mb-6 reveal opacity-0 translate-y-6 transition-all duration-700 delay-100"
              style={{ textWrap: "balance", textShadow: "0 18px 42px rgba(0,0,0,0.42)" } as React.CSSProperties}
            >
              Reserva rápido.<br />
              Muévete con<br />
              <em className="italic text-[#DFD1C9] sm:text-valiance-gold leading-[1.1] pb-1">intención.</em>
            </h1>

            <p className="font-body text-[1.05rem] text-valiance-nude/90 leading-[1.7] max-w-[460px] mb-10 reveal opacity-0 translate-y-6 transition-all duration-700 delay-200 [text-shadow:0_10px_32px_rgba(0,0,0,0.38)]">
              Un estudio sencillo, lindo y cercano para explorar el método pilates con resultados. Atención que conoce tu cuerpo, aparatos cuidados y grupos pequeños para avanzar con disciplina.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 reveal opacity-0 translate-y-6 transition-all duration-700 delay-300">
              <button
                onClick={() => navigate("/auth/register")}
                className="group inline-flex items-center gap-3 rounded-full bg-valiance-nude text-valiance-charcoal pl-8 pr-3 py-2.5 font-body text-[0.8rem] font-medium tracking-[0.06em] uppercase hover:bg-valiance-blush transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-valiance-gold"
              >
                Reservar primera clase
                <span className="w-8 h-8 rounded-full bg-valiance-charcoal/8 flex items-center justify-center group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform">
                  <ArrowUpRight size={15} strokeWidth={2} />
                </span>
              </button>
              <button
                onClick={() => scrollTo("filosofia")}
                className="px-8 py-4 rounded-full font-body text-[0.8rem] font-medium tracking-[0.06em] uppercase text-valiance-nude border border-valiance-nude/35 hover:bg-valiance-nude/10 backdrop-blur-sm transition-all duration-300 active:scale-[0.98]"
              >
                Conocer la filosofía
              </button>
            </div>
          </div>
        </div>

        {/* fade hacia el fondo nude */}
        <div className="absolute bottom-0 inset-x-0 h-40 bg-gradient-to-t from-valiance-nude to-transparent z-[5]" />
      </section>

      {/* ────────── DISCIPLINAS — índice editorial flotante ────────── */}
      <section className="relative z-10 -mt-20 mb-16">
        <div className="max-w-[1200px] mx-auto px-6 sm:px-10">
          <div className="relative bg-valiance-nude rounded-[1.75rem] ring-1 ring-valiance-charcoal/8 shadow-[0_40px_80px_-30px_rgba(140,107,111,0.30)] overflow-hidden">
            {/* hilo de oro superior */}
            <span className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-valiance-gold/70 to-transparent" />
            <div className="flex items-end justify-between gap-6 px-7 sm:px-10 pt-8 pb-6">
              <p className="flex items-center text-[0.66rem] tracking-[0.3em] uppercase text-valiance-mauve font-body">
                <span className="inline-block w-7 h-px bg-valiance-gold mr-3" />
                El método · cuatro aparatos
              </p>
              <span className="hidden sm:block font-display italic text-[1.15rem] text-valiance-mauve/55">Una clase, cuatro formas</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-valiance-lavender/30 border-t border-valiance-lavender/30">
              {[
                { n: "01", name: "Reformer", hint: "Resistencia controlada" },
                { n: "02", name: "Tower", hint: "Rango y estabilidad" },
                { n: "03", name: "Mat", hint: "Pilates clásico" },
                { n: "04", name: "Silla", hint: "Fuerza y equilibrio" },
              ].map((d) => (
                <button
                  key={d.name}
                  onClick={() => scrollTo("clases")}
                  className="group relative text-left px-7 sm:px-9 py-9 sm:py-11 transition-colors hover:bg-valiance-blush/12 focus-visible:outline-none focus-visible:bg-valiance-blush/15"
                >
                  <span className="font-display leading-none text-[2.6rem] text-valiance-gold/40 group-hover:text-valiance-gold transition-colors duration-300">{d.n}</span>
                  <div className="mt-4 flex items-center gap-2">
                    <span className="font-display text-[1.7rem] leading-tight text-valiance-charcoal">{d.name}</span>
                    <ArrowUpRight size={16} strokeWidth={1.8} className="text-valiance-mauve opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
                  </div>
                  <span className="block h-px w-0 bg-valiance-gold/70 mt-3 group-hover:w-10 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]" />
                  <div className="mt-3 font-body text-[0.7rem] tracking-[0.14em] uppercase text-valiance-mauve">{d.hint}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ────────── FILOSOFÍA / EL MÉTODO ────────── */}
      <section id="filosofia" className="py-32 lg:py-44 px-6 sm:px-10 border-t border-valiance-charcoal/8">
        <div className="max-w-[1200px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-20 items-start">
          <div className="lg:col-span-6 reveal opacity-0 translate-y-6 transition-all duration-700">
            <p className="flex items-center text-[0.7rem] tracking-[0.28em] uppercase text-valiance-mauve font-body mb-6">
              <span className="inline-block w-7 h-px bg-valiance-gold mr-3" />
              El método
            </p>
            <h2
              className="font-display font-normal text-[clamp(2.4rem,5vw,3.9rem)] leading-[1.02] tracking-[-0.015em] text-valiance-charcoal"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Una <em className="italic text-valiance-mauve leading-[1.1]">disciplina</em>.
              Una <em className="italic text-valiance-gold leading-[1.1]">comunidad</em> que te acompaña.
            </h2>
            <span className="block h-px w-16 bg-valiance-gold/50 origin-left mt-7 mb-7 reveal scale-x-0 transition-transform duration-700" />
            <div className="space-y-5 font-body text-[1.02rem] text-valiance-charcoal/75 leading-[1.8] max-w-[60ch]">
              <p>
                En Espacio Pilates trabajamos con los cuatro principales equipos del método — <strong className="font-medium text-valiance-charcoal">Mat, Reformer, Tower y Wunda Chair</strong> — para que cada clase sea dinámica, completa y retadora.
              </p>
              <p>
                Las clases no están asignadas a un aparato específico por día: la planeación semanal se realiza según los objetivos de entrenamiento y el grupo muscular que se trabajará en cada sesión. Así aprovechamos las ventajas de cada equipo para ofrecer una experiencia integral y un progreso constante.
              </p>
              <p>
                Cada clase está diseñada para desarrollar fuerza, movilidad, estabilidad y control corporal, manteniendo la esencia del método Pilates y brindando variedad en cada entrenamiento.
              </p>
            </div>
          </div>

          <div className="lg:col-span-6 reveal opacity-0 translate-y-6 transition-all duration-700 delay-100">
            <div className="rounded-[1.5rem] border border-valiance-blush/35 bg-valiance-surface2 p-7 sm:p-9 shadow-valiance-soft">
              <p className="flex items-center text-[0.66rem] tracking-[0.28em] uppercase text-valiance-mauve font-body mb-1.5">
                <span className="inline-block w-7 h-px bg-valiance-gold mr-3" />
                Programación semanal
              </p>
              <p className="font-display text-[1.7rem] leading-tight text-valiance-charcoal mb-6">Enfoque por grupo muscular</p>
              <ul className="divide-y divide-valiance-blush/45 border-t border-valiance-blush/45">
                {[
                  { day: "Lunes",     focus: "Pierna y glúteo" },
                  { day: "Martes",    focus: "Full Body" },
                  { day: "Miércoles", focus: "Tren superior" },
                  { day: "Jueves",    focus: "Pierna y glúteo" },
                  { day: "Viernes",   focus: "Full Body" },
                  { day: "Sábado",    focus: "Core" },
                ].map((d) => (
                  <li key={d.day} className="flex items-baseline justify-between gap-4 py-3.5">
                    <span className="flex items-center gap-3 font-display text-[1.25rem] text-valiance-charcoal">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-valiance-gold/80" />
                      {d.day}
                    </span>
                    <span className="font-body text-[0.8rem] tracking-[0.1em] uppercase text-valiance-mauve text-right">{d.focus}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ────────── CLASES ────────── */}
      <section id="clases" className="py-28 lg:py-40 px-6 sm:px-10 border-t border-valiance-charcoal/8">
        <div className="max-w-[1200px] mx-auto">
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 mb-14 max-w-[720px]">
            <h2
              className="font-display font-normal text-[clamp(2.4rem,5vw,3.9rem)] leading-[1.02] tracking-[-0.015em] text-valiance-charcoal"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Pilates, en cuatro aparatos.
              <span className="text-valiance-gold italic"> Una sola intención.</span>
            </h2>
            <span className="block h-px w-16 bg-valiance-gold/50 origin-left mt-6 mb-6 reveal scale-x-0 transition-transform duration-700" />
            <p className="font-body text-[1.02rem] text-valiance-charcoal/70 leading-[1.8] max-w-[60ch]">
              Reformer, tower, mat y silla. Grupos de 8, atención personalizada y sesiones que te retan sin dejar la técnica de lado.
            </p>
          </div>

          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
            {classTypes.slice(0, 4).map((c, idx) => {
              const isHero = idx === 0; // Pilates destacado
              const accent = c.color || "#D1B9B4";
              return (
                <article
                  key={c.id}
                  className={`group relative overflow-hidden rounded-[1.75rem] p-9 lg:p-10 transition-all duration-500 ${
                    isHero
                      ? "bg-valiance-plum text-valiance-nude md:row-span-2 flex flex-col"
                      : "bg-valiance-nude text-valiance-charcoal ring-1 ring-valiance-charcoal/8 hover:shadow-[0_30px_60px_-25px_rgba(140,107,111,0.22)]"
                  }`}
                >
                  {isHero && (
                    <img
                      src={markCream}
                      alt=""
                      aria-hidden
                      className="pointer-events-none absolute -bottom-6 -right-6 w-44 h-44 object-contain opacity-[0.07]"
                    />
                  )}
                  <div className="relative flex items-start justify-between mb-6">
                    <span
                      className={`text-[0.66rem] tracking-[0.18em] uppercase font-medium ${isHero ? "text-valiance-blush/80" : "text-valiance-mauve"}`}
                    >
                      {c.subtitle}
                    </span>
                    <span
                      className={`text-[0.66rem] tracking-[0.15em] uppercase tabular-nums ${isHero ? "text-valiance-nude/60" : "text-valiance-charcoal/50"}`}
                    >
                      {c.duration_min}′ · grupo de {c.capacity}
                    </span>
                  </div>

                  <h3
                    className={`relative font-display ${isHero ? "text-[clamp(2.4rem,5vw,3.5rem)]" : "text-[clamp(1.6rem,2.4vw,2.2rem)]"} leading-[1.05] tracking-[-0.015em] mb-4`}
                  >
                    {c.name}
                  </h3>

                  <p
                    className={`relative font-body text-[0.96rem] leading-[1.8] ${isHero ? "text-valiance-nude/80 max-w-[420px]" : "text-valiance-charcoal/75"} ${isHero ? "mb-8 flex-1" : "mb-6"}`}
                  >
                    {c.description}
                  </p>

                  <div
                    className={`relative flex items-center gap-3 text-[0.74rem] ${isHero ? "text-valiance-nude/60" : "text-valiance-charcoal/60"}`}
                  >
                    <span
                      className="inline-flex items-center justify-center w-8 h-8 rounded-full"
                      style={{
                        background: isHero ? "rgba(201,173,163,0.18)" : `${accent}30`,
                        color: isHero ? "#DFD1C9" : "#716D64",
                      }}
                    >
                      <Clock size={14} strokeWidth={1.6} />
                    </span>
                    {c.level}
                  </div>

                  {isHero && (
                    <button
                      onClick={() => navigate("/auth/register")}
                      className="relative mt-8 self-start px-6 py-3 rounded-full bg-valiance-nude text-valiance-charcoal text-[0.78rem] font-medium tracking-[0.06em] uppercase hover:bg-valiance-blush transition-all active:scale-[0.98] inline-flex items-center gap-2"
                    >
                      Reservar mi clase
                      <ArrowUpRight size={14} strokeWidth={2} />
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* ────────── HORARIO / RESERVA EN VIVO ────────── */}
      <Schedule />

      {/* ────────── PRECIOS ────────── */}
      <section id="precios" className="py-28 lg:py-40 px-6 sm:px-10 bg-valiance-lavender/12 border-t border-valiance-charcoal/8">
        <div className="max-w-[1200px] mx-auto">
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 max-w-[720px] mb-14">
            <p className="flex items-center text-[0.7rem] tracking-[0.28em] uppercase text-valiance-mauve font-body mb-6">
              <span className="inline-block w-7 h-px bg-valiance-gold mr-3" />
              Inversión
            </p>
            <h2
              className="font-display font-normal text-[clamp(2.4rem,5vw,3.9rem)] leading-[1.02] tracking-[-0.015em] text-valiance-charcoal"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Encuentra el ritmo que va con el tuyo.
            </h2>
            <span className="block h-px w-16 bg-valiance-gold/50 origin-left mt-6 mb-6 reveal scale-x-0 transition-transform duration-700" />
            <p className="font-body text-[1.02rem] text-valiance-charcoal/70 leading-[1.8] max-w-[60ch]">
              Paquetes mensuales, no acumulables: vencen 30 días después de la compra. Elige el que mejor acompañe tu semana.
            </p>
          </div>

          {/* PAQUETES MENSUALES */}
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 mb-14">
            <div className="flex items-baseline justify-between mb-6 flex-wrap gap-3">
              <h3 className="font-display text-[1.9rem] text-valiance-charcoal">Paquetes mensuales</h3>
              <span className="text-[0.8rem] text-valiance-mauve font-body">grupos de 8 · 55 minutos</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5 items-stretch">
              {PAQUETES.map((p) => {
                const featured = p.popular || p.best;
                const price = priceByName[p.plan] ?? p.price;
                return (
                  <div
                    key={p.id}
                    className={`relative overflow-hidden rounded-[1.75rem] p-9 flex flex-col transition-all duration-300 hover:-translate-y-1 ${
                      p.best
                        ? "bg-valiance-plum text-valiance-nude shadow-[0_30px_60px_-25px_rgba(90,74,87,0.55)]"
                        : p.popular
                          ? "bg-valiance-nude ring-1 ring-valiance-gold/60 shadow-[0_15px_40px_-25px_rgba(184,145,90,0.4)]"
                          : "bg-valiance-nude ring-1 ring-valiance-charcoal/8 hover:shadow-[0_30px_60px_-25px_rgba(140,107,111,0.22)]"
                    }`}
                  >
                    {p.best && (
                      <img
                        src={markCream}
                        alt=""
                        aria-hidden
                        className="pointer-events-none absolute -bottom-5 -right-5 w-36 h-36 object-contain opacity-[0.07]"
                      />
                    )}
                    {featured && (
                      <span
                        className={`absolute top-6 right-6 text-[0.6rem] tracking-[0.18em] uppercase px-3 py-1 rounded-full font-medium ${
                          p.best ? "bg-valiance-gold text-valiance-charcoal" : "bg-valiance-gold/15 text-valiance-gold"
                        }`}
                      >
                        {p.popular ? "Más popular" : "Mejor valor"}
                      </span>
                    )}
                    <div className={`relative text-[0.66rem] tracking-[0.18em] uppercase font-medium ${p.best ? "text-valiance-blush/70" : "text-valiance-mauve"}`}>
                      {p.name} / mes
                    </div>
                    <div className="relative flex items-baseline gap-1 mt-3">
                      <span className={`font-display text-[2.7rem] leading-none tabular-nums ${p.best ? "text-valiance-nude" : "text-valiance-charcoal"}`}>
                        ${price.toLocaleString()}
                      </span>
                      <span className={`text-[0.72rem] ${p.best ? "text-valiance-nude/50" : "text-valiance-charcoal/50"}`}>MXN</span>
                    </div>
                    <div className={`relative text-[0.78rem] mt-2 ${p.best ? "text-valiance-nude/60" : "text-valiance-charcoal/60"} font-body`}>
                      {p.classes} clases · {p.hint}
                    </div>
                    <div className={`relative text-[0.74rem] mt-1 tabular-nums ${p.best ? "text-valiance-blush/60" : "text-valiance-mauve"} font-body`}>
                      ${(price / p.classes).toFixed(0)} por clase
                    </div>
                    <button
                      onClick={() => navigate(ctaPath)}
                      className={`relative mt-auto pt-6 w-full block text-[0.76rem] font-medium tracking-[0.06em] uppercase active:scale-[0.98] transition-transform`}
                    >
                      <span
                        className={`block w-full py-3 rounded-full transition-colors ${
                          p.best
                            ? "bg-valiance-nude text-valiance-charcoal hover:bg-valiance-blush"
                            : p.popular
                              ? "bg-valiance-charcoal text-valiance-nude hover:bg-valiance-plum"
                              : "border border-valiance-charcoal/20 text-valiance-charcoal hover:bg-valiance-charcoal hover:text-valiance-nude"
                        }`}
                      >
                        Elegir
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* CARGOS PUNTUALES — lista editorial con hairlines lila */}
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700">
            <div className="flex items-baseline justify-between mb-6 flex-wrap gap-3">
              <h3 className="font-display text-[1.9rem] text-valiance-charcoal">Inscripción y clases individuales</h3>
              <span className="text-[0.8rem] text-valiance-mauve font-body">pagos únicos</span>
            </div>

            <div className="rounded-[1.75rem] bg-valiance-nude ring-1 ring-valiance-charcoal/8 px-8 sm:px-10 divide-y divide-valiance-lavender/25">
              {CARGOS.map((c) => {
                const price = priceByName[c.plan] ?? c.price;
                return (
                <div key={c.id} className="py-6 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-display text-[1.3rem] text-valiance-charcoal leading-tight">{c.name}</div>
                    <div className="text-[0.74rem] text-valiance-mauve font-body mt-1">{c.hint}</div>
                  </div>
                  <div className="font-display text-[1.9rem] text-valiance-charcoal leading-none flex items-baseline gap-1 tabular-nums">
                    ${price.toLocaleString()}
                    <span className="text-[0.66rem] text-valiance-charcoal/50">MXN</span>
                  </div>
                </div>
                );
              })}
            </div>
          </div>

          <p className="text-[0.78rem] text-valiance-charcoal/55 mt-10 text-center font-body max-w-[640px] mx-auto leading-[1.7]">
            Paquetes mensuales no acumulables: vencen 30 días después de la compra. La inscripción es un pago único. La adquisición implica aceptación del reglamento interno.
          </p>
        </div>
      </section>

      {/* ────────── ESTUDIO — galería editorial ────────── */}
      <section id="estudio" className="py-28 lg:py-40 px-6 sm:px-10 border-t border-valiance-charcoal/8">
        <div className="max-w-[1280px] mx-auto">
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 mb-14 max-w-[760px]">
            <h2
              className="font-display font-normal text-[clamp(2.4rem,5vw,3.9rem)] leading-[1.02] tracking-[-0.015em] text-valiance-charcoal"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Un estudio claro, limpio y lleno de intención.
            </h2>
            <span className="block h-px w-16 bg-valiance-gold/50 origin-left mt-6 mb-6 reveal scale-x-0 transition-transform duration-700" />
            <p className="font-body text-[1.02rem] text-valiance-charcoal/70 leading-[1.8] max-w-[60ch]">
              Espejos amplios, luz suave, aparatos cuidados y atención cercana. Un espacio sencillo y lindo para entrenar con disciplina, higiene y calma.
            </p>
          </div>

          {/* Asymmetric mosaic */}
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 grid grid-cols-12 gap-3 sm:gap-4">
            <figure className="col-span-12 lg:col-span-8 relative rounded-[1.75rem] overflow-hidden aspect-[16/10] group">
              <img src={coachGuidance} alt="Clase de reformer en Tu Espacio Pilates" loading="lazy" style={{ filter: "saturate(0.86)" }} className="absolute inset-0 w-full h-full object-cover object-[center_42%] group-hover:scale-[1.03] transition-transform duration-[1200ms]" />
              <div className="absolute inset-0 bg-gradient-to-t from-valiance-charcoal/72 via-transparent to-transparent" />
              <figcaption className="absolute bottom-6 left-6 right-6">
                <span className="inline-flex items-center text-[0.6rem] tracking-[0.22em] uppercase text-valiance-gold mb-2 font-medium">
                  <span className="inline-block w-6 h-px bg-valiance-gold mr-2" />
                  Acompañamiento
                </span>
                <h3 className="font-display text-valiance-nude text-[1.8rem] sm:text-[2.4rem] leading-[1.05]">Corrección cercana, clase con intención.</h3>
              </figcaption>
            </figure>

            <figure className="col-span-6 lg:col-span-4 relative rounded-[1.75rem] overflow-hidden aspect-[3/4] group">
              <img src={studioMirrorLine} alt="Espejo del estudio reflejando reformers" loading="lazy" style={{ filter: "saturate(0.86)" }} className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-[1200ms]" />
              <div className="absolute inset-0 bg-gradient-to-t from-valiance-charcoal/45 to-transparent" />
              <figcaption className="absolute bottom-5 left-5">
                <span className="text-valiance-nude/95 text-[0.66rem] tracking-[0.18em] uppercase font-medium">Sala Reformer</span>
              </figcaption>
            </figure>

            <figure className="col-span-6 lg:col-span-3 relative rounded-[1.75rem] overflow-hidden aspect-[3/4] group">
              <img src={heartMirrorDetail} alt="Detalle del estudio con espejo y movimiento en reformer" loading="lazy" style={{ filter: "saturate(0.84)" }} className="absolute inset-0 w-full h-full object-cover object-[center_38%] group-hover:scale-[1.03] transition-transform duration-[1200ms]" />
            </figure>

            <figure className="col-span-6 lg:col-span-5 relative rounded-[1.75rem] overflow-hidden aspect-[16/10] group">
              <img src={reformerPlank} alt="Alumna en plancha sobre reformer" loading="lazy" style={{ filter: "saturate(0.86)" }} className="absolute inset-0 w-full h-full object-cover object-[center_46%] group-hover:scale-[1.03] transition-transform duration-[1200ms]" />
              <div className="absolute inset-0 bg-gradient-to-t from-valiance-charcoal/58 to-transparent" />
              <figcaption className="absolute bottom-5 left-5">
                <span className="text-valiance-nude/95 text-[0.66rem] tracking-[0.18em] uppercase font-medium">Fuerza y control</span>
              </figcaption>
            </figure>

            <figure className="col-span-12 lg:col-span-4 relative rounded-[1.75rem] overflow-hidden aspect-[16/10] lg:aspect-[3/4] group">
              <img src={towerInversion} alt="Trabajo de control en torre de pilates" loading="lazy" style={{ filter: "saturate(0.86)" }} className="absolute inset-0 w-full h-full object-cover object-[center_44%] group-hover:scale-[1.03] transition-transform duration-[1200ms]" />
            </figure>

            <figure className="col-span-6 lg:col-span-3 relative rounded-[1.75rem] overflow-hidden aspect-square group">
              <img src={mirrorStrapDetail} alt="Detalle de straps y espejo en reformer" loading="lazy" style={{ filter: "saturate(0.84)" }} className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-[1200ms]" />
            </figure>

            <figure className="col-span-6 lg:col-span-3 relative rounded-[1.75rem] overflow-hidden aspect-square group">
              <img src={reformerSideStretch} alt="Estiramiento lateral sobre reformer" loading="lazy" style={{ filter: "saturate(0.86)" }} className="absolute inset-0 w-full h-full object-cover object-[center_44%] group-hover:scale-[1.03] transition-transform duration-[1200ms]" />
            </figure>

            <figure className="col-span-12 lg:col-span-6 relative rounded-[1.75rem] overflow-hidden aspect-[21/9] group">
              <img src={towerControl} alt="Alumna trabajando con tower y reformer" loading="lazy" style={{ filter: "saturate(0.86)" }} className="absolute inset-0 w-full h-full object-cover object-[center_42%] group-hover:scale-[1.03] transition-transform duration-[1200ms]" />
              <div className="absolute inset-0 bg-gradient-to-t from-valiance-charcoal/55 to-transparent" />
              <figcaption className="absolute bottom-5 right-6 text-right">
                <span className="text-valiance-nude/95 text-[0.66rem] tracking-[0.18em] uppercase font-medium">Aparatos cuidados</span>
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* ────────── REGLAMENTO ────────── */}
      <section id="reglamento" className="py-28 lg:py-40 px-6 sm:px-10 border-t border-valiance-charcoal/8">
        <div className="max-w-[1200px] mx-auto">
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 max-w-[720px] mb-14">
            <h2
              className="font-display font-normal text-[clamp(2.4rem,5vw,3.9rem)] leading-[1.02] tracking-[-0.015em] text-valiance-charcoal"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Reglas para que todas estemos cómodas.
            </h2>
            <span className="block h-px w-16 bg-valiance-gold/50 origin-left mt-6 mb-6 reveal scale-x-0 transition-transform duration-700" />
            <p className="font-body text-[1.02rem] text-valiance-charcoal/70 leading-[1.8] max-w-[60ch]">
              Lo justo, lo claro, lo necesario.
            </p>
          </div>

          {/* Lista numerada editorial en 2 columnas, separadas por hairlines lila */}
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 grid grid-cols-1 lg:grid-cols-2 lg:gap-x-16">
            {POLITICAS.map((p, i) => (
              <div
                key={p.num}
                className={`flex gap-5 py-7 border-b border-valiance-lavender/25 ${i >= POLITICAS.length - 2 ? "lg:border-b-0" : ""} ${i === POLITICAS.length - 1 ? "border-b-0" : ""}`}
              >
                <div className="font-display text-[2.4rem] text-valiance-gold/40 leading-none tabular-nums flex-shrink-0 w-14">{p.num}</div>
                <div>
                  <h4 className="font-display text-[1.3rem] text-valiance-charcoal mb-1.5 leading-tight">{p.title}</h4>
                  <p className="font-body text-[0.9rem] text-valiance-charcoal/70 leading-[1.75]">{p.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ────────── EVENTOS — informativo, no reservable ────────── */}
      <section id="eventos" className="py-28 lg:py-40 px-6 sm:px-10 bg-valiance-blush/25 border-t border-valiance-charcoal/8">
        <div className="max-w-[1200px] mx-auto">
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 max-w-[760px] mb-14">
            <h2
              className="font-display font-normal text-[clamp(2.4rem,5vw,3.9rem)] leading-[1.02] tracking-[-0.015em] text-valiance-charcoal"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Celebra tu cumple en Tu Espacio Pilates.
            </h2>
            <span className="block h-px w-16 bg-valiance-gold/50 origin-left mt-6 mb-6 reveal scale-x-0 transition-transform duration-700" />
            <p className="font-body text-[1.02rem] text-valiance-charcoal/70 leading-[1.8] max-w-[60ch]">
              Una clase de 55 minutos full body + 30 minutos para fotos + kit. Una forma distinta y bonita de festejar con tus personas favoritas.
            </p>
          </div>

          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
            {/* Cumple */}
            <div className="rounded-[1.75rem] bg-valiance-nude ring-1 ring-valiance-charcoal/8 p-9 sm:p-10 flex flex-col gap-5">
              <div>
                <span className="inline-block text-[0.62rem] tracking-[0.2em] uppercase text-valiance-mauve font-medium mb-2">El clásico</span>
                <h3 className="font-display text-[2rem] text-valiance-charcoal leading-tight">Cumple</h3>
                <p className="font-body text-[0.86rem] text-valiance-charcoal/65 mt-1">Clase full body + 30 min de fotos + kit.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {EVENTO_BASE.map((e) => (
                  <div key={e.personas} className="rounded-[1.25rem] bg-valiance-lavender/15 px-5 py-4 flex items-baseline justify-between gap-2">
                    <span className="font-body text-[0.86rem] text-valiance-charcoal/75">{e.personas}</span>
                    <span className="font-display text-[1.5rem] text-valiance-charcoal leading-none tabular-nums">${e.price.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Cumple & Brunch */}
            <div className="relative overflow-hidden rounded-[1.75rem] bg-valiance-plum text-valiance-nude p-9 sm:p-10 flex flex-col gap-5">
              <img
                src={markCream}
                alt=""
                aria-hidden
                className="pointer-events-none absolute -bottom-6 -right-6 w-44 h-44 object-contain opacity-[0.07]"
              />
              <div className="relative">
                <span className="inline-block text-[0.62rem] tracking-[0.2em] uppercase text-valiance-gold font-medium mb-2">Más completo</span>
                <h3 className="font-display text-[2rem] leading-tight">Cumple &amp; Brunch</h3>
                <p className="font-body text-[0.86rem] text-valiance-nude/65 mt-1">Todo lo del clásico + box lunch + bolsa de snack.</p>
              </div>
              <div className="relative grid grid-cols-2 gap-3">
                {EVENTO_BRUNCH.map((e) => (
                  <div key={e.personas} className="rounded-[1.25rem] bg-valiance-nude/10 px-5 py-4 flex items-baseline justify-between gap-2">
                    <span className="font-body text-[0.86rem] text-valiance-nude/75">{e.personas}</span>
                    <span className="font-display text-[1.5rem] text-valiance-nude leading-none tabular-nums">${e.price.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 flex flex-col sm:flex-row sm:items-center gap-5 rounded-[1.75rem] bg-valiance-nude ring-1 ring-valiance-charcoal/8 p-8 sm:p-9">
            <div className="flex-1">
              <p className="font-body text-[0.92rem] text-valiance-charcoal/80 leading-[1.75]">
                Decoración con globos <strong className="text-valiance-gold">+$700</strong>. Horarios de eventos: {HORARIOS_EVENTOS}.
              </p>
              <p className="font-body text-[0.82rem] text-valiance-mauve mt-1">Consulta disponibilidad por WhatsApp.</p>
            </div>
            <a
              href="https://wa.me/524445480352?text=Hola%2C%20me%20interesa%20celebrar%20un%20cumple%20en%20Tu%20Espacio%20Pilates"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-full bg-valiance-charcoal text-valiance-nude text-[0.78rem] font-medium tracking-[0.06em] uppercase hover:bg-valiance-plum transition-colors no-underline whitespace-nowrap"
            >
              Consultar por WhatsApp
              <ArrowUpRight size={15} strokeWidth={2} />
            </a>
          </div>
        </div>
      </section>

      {/* ────────── CTA + CONTACTO ────────── */}
      <section id="contacto" className="py-32 lg:py-44 px-6 sm:px-10 border-t border-valiance-charcoal/8">
        <div className="max-w-[1200px] mx-auto">
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 text-center mb-16 max-w-[760px] mx-auto">
            <p className="inline-flex items-center text-[0.7rem] tracking-[0.28em] uppercase text-valiance-mauve font-body mb-6">
              <span className="inline-block w-7 h-px bg-valiance-gold mr-3" />
              Tu primer paso
              <span className="inline-block w-7 h-px bg-valiance-gold ml-3" />
            </p>
            <h2
              className="font-display font-normal text-[clamp(2.6rem,6vw,4.4rem)] leading-[1.02] tracking-[-0.02em] text-valiance-charcoal mb-6"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Reserva tu primera clase.<br />
              <em className="italic text-valiance-mauve leading-[1.1]">El resto se construye sola.</em>
            </h2>
            <p className="font-body text-[1.05rem] text-valiance-charcoal/75 max-w-[480px] mx-auto mb-9 leading-[1.8]">
              Te respondemos por WhatsApp en menos de una hora. Te explicamos todo, sin compromiso.
            </p>
            <div className="flex gap-3 justify-center items-center flex-wrap">
              <button
                onClick={() => navigate(ctaPath)}
                className="group inline-flex items-center gap-3 rounded-full bg-valiance-charcoal text-valiance-nude pl-8 pr-3 py-2.5 font-body text-[0.8rem] font-medium tracking-[0.06em] uppercase hover:bg-valiance-plum transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-valiance-gold"
              >
                Reservar primera clase
                <span className="w-8 h-8 rounded-full bg-valiance-nude/12 flex items-center justify-center group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform">
                  <ArrowUpRight size={15} strokeWidth={2} />
                </span>
              </button>
              <a
                href="https://wa.me/524445480352?text=Hola%2C%20me%20interesa%20reservar%20mi%20primera%20clase%20en%20Tu%20Espacio%20Pilates"
                target="_blank"
                rel="noopener noreferrer"
                className="border border-valiance-charcoal/20 text-valiance-charcoal text-[0.8rem] font-medium tracking-[0.06em] uppercase flex items-center gap-2.5 px-8 py-4 rounded-full hover:border-valiance-charcoal hover:bg-valiance-charcoal hover:text-valiance-nude transition-all no-underline"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" /><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 0 1-4.243-1.214l-.257-.154-2.88.856.856-2.88-.154-.257A8 8 0 1 1 12 20z" /></svg>
                WhatsApp
              </a>
            </div>
          </div>

          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="relative overflow-hidden lg:col-span-5 rounded-[1.75rem] bg-valiance-nude ring-1 ring-valiance-charcoal/8 p-9 sm:p-10 flex flex-col gap-7">
              <img
                src={markInk}
                alt=""
                aria-hidden
                className="pointer-events-none absolute -bottom-6 -right-6 w-40 h-40 object-contain opacity-[0.05]"
              />
              <div className="relative">
                <div className="text-[0.66rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium mb-3">Encuéntranos</div>
                <h3 className="font-display text-[2rem] sm:text-[2.4rem] leading-[1.05] text-valiance-charcoal">
                  Nos vemos<br />en el estudio.
                </h3>
              </div>

              <div className="relative flex flex-col divide-y divide-valiance-lavender/25">
                {[
                  {
                    icon: <MapPin size={18} />, label: "Ubicación",
                    value: (
                      <a
                        href="https://g.co/kgs/AyHBK5d"
                        target="_blank" rel="noopener noreferrer"
                        className="text-valiance-charcoal hover:text-valiance-mauve transition-colors no-underline"
                      >
                        Av. Villa Magna Nte. 600 A<br />
                        Villa Magna, 78183<br />
                        San Luis Potosí, S.L.P.<br />
                        <span className="text-valiance-charcoal/60">(justo arriba de las pizzas)</span>
                      </a>
                    ),
                  },
                  {
                    icon: <Phone size={18} />, label: "WhatsApp / Tel",
                    value: (
                      <a
                        href="https://wa.me/524445480352"
                        target="_blank" rel="noopener noreferrer"
                        className="text-valiance-charcoal hover:text-valiance-mauve transition-colors no-underline"
                      >
                        444 548 0352
                      </a>
                    ),
                  },
                  {
                    icon: <Instagram size={18} />, label: "Instagram",
                    value: (
                      <a
                        href="https://www.instagram.com/_espaciopilatesvm/"
                        target="_blank" rel="noopener noreferrer"
                        className="text-valiance-charcoal hover:text-valiance-mauve transition-colors no-underline"
                      >
                        @_espaciopilatesvm
                      </a>
                    ),
                  },
                  { icon: <Clock size={18} />, label: "Horarios", value: "Lun · Mié · Vie 7 a 9 am y 5:30 a 8:30 pm · Mar · Jue 5:30 a 7:30 pm · Sáb 9 am" },
                ].map((item, i) => (
                  <div key={item.label} className={`flex items-start gap-4 py-5 ${i === 0 ? "pt-0" : ""}`}>
                    <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-valiance-blush/40 text-valiance-mauve">
                      {item.icon}
                    </div>
                    <div>
                      <div className="text-[0.62rem] tracking-[0.22em] uppercase mb-1 text-valiance-mauve">{item.label}</div>
                      <div className="text-[0.95rem] text-valiance-charcoal font-body leading-snug">{item.value}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="relative flex gap-2.5 pt-1">
                <a
                  href="https://www.instagram.com/_espaciopilatesvm/"
                  target="_blank" rel="noopener noreferrer" aria-label="Instagram Tu Espacio Pilates"
                  className="w-10 h-10 rounded-full border border-valiance-charcoal/15 flex items-center justify-center text-valiance-charcoal/60 hover:bg-valiance-charcoal hover:text-valiance-nude hover:border-valiance-charcoal transition-all no-underline"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect width="20" height="20" x="2" y="2" rx="5" ry="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" x2="17.51" y1="6.5" y2="6.5" /></svg>
                </a>
                <a
                  href="https://g.co/kgs/AyHBK5d"
                  target="_blank" rel="noopener noreferrer" aria-label="Cómo llegar"
                  className="ml-auto inline-flex items-center gap-2 px-4 h-10 rounded-full bg-valiance-charcoal text-valiance-nude text-[0.74rem] font-medium tracking-[0.06em] uppercase hover:bg-valiance-plum transition-colors no-underline"
                >
                  <MapPin size={13} />
                  Cómo llegar
                </a>
              </div>
            </div>

            <div className="lg:col-span-7 rounded-[1.75rem] overflow-hidden ring-1 ring-valiance-charcoal/8 bg-valiance-nude min-h-[440px]">
              <iframe
                src="https://www.google.com/maps?q=Av.%20Villa%20Magna%20Nte.%20600%20A%2C%20Villa%20Magna%2C%2078183%20San%20Luis%20Potos%C3%AD%2C%20S.L.P.&output=embed"
                width="100%"
                height="100%"
                style={{ border: 0, display: "block", minHeight: "440px" }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="Ubicación de Tu Espacio Pilates en Google Maps"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ────────── FOOTER ────────── */}
      <footer className="bg-valiance-charcoal text-valiance-nude px-6 sm:px-10 pt-20 pb-10">
        <div className="max-w-[1280px] mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 pb-12 border-b border-valiance-lavender/15">
            <div className="lg:col-span-2 max-w-[360px]">
              <img src={markCream} alt="Tu Espacio Pilates" className="h-16 w-auto object-contain mb-5" />
              <p className="font-body text-[0.92rem] text-valiance-nude/55 leading-[1.8]">
                Tu Espacio Pilates · Villa Magna, San Luis Potosí. Una disciplina, cuatro aparatos. Disciplina, respeto y comunidad. Un espacio hecho para ti.
              </p>
            </div>

            <div>
              <div className="text-[0.66rem] tracking-[0.22em] uppercase text-valiance-nude/40 font-medium mb-5">Estudio</div>
              <ul className="flex flex-col gap-2.5 list-none">
                {NAV_ITEMS.map(({ label, id }) => (
                  <li key={id}>
                    <button
                      onClick={() => scrollTo(id)}
                      className="font-body text-[0.85rem] text-valiance-nude/55 hover:text-valiance-blush transition-colors bg-transparent border-none cursor-pointer p-0"
                    >
                      {label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="text-[0.66rem] tracking-[0.22em] uppercase text-valiance-nude/40 font-medium mb-5">Legal</div>
              <ul className="flex flex-col gap-2.5 list-none">
                {[
                  { label: "Aviso de privacidad", path: "/legal/privacidad" },
                  { label: "Términos y condiciones", path: "/legal/terminos" },
                  { label: "Política de cancelación", path: "/legal/cancelacion" },
                ].map((l) => (
                  <li key={l.path}>
                    <button
                      onClick={() => navigate(l.path)}
                      className="font-body text-[0.85rem] text-valiance-nude/55 hover:text-valiance-blush transition-colors bg-transparent border-none cursor-pointer p-0"
                    >
                      {l.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="pt-7 flex flex-col sm:flex-row justify-between items-center gap-3">
            <div className="flex items-center gap-3">
              <span className="inline-block w-8 h-px bg-valiance-gold/60" />
              <p className="font-body text-[0.72rem] text-valiance-nude/30 tabular-nums">
                &copy; {new Date().getFullYear()} Tu Espacio Pilates · Villa Magna. Todos los derechos reservados.
              </p>
            </div>
            <p className="font-body text-[0.72rem] text-valiance-nude/30 italic">
              Explora el método pilates, con resultados · Hecho con cariño
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
