import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import Schedule from "@/components/Schedule";
import {
  Waves, Flame, Activity, Sparkles, Clock, MapPin, Phone, Instagram,
  ArrowUpRight, Menu, X, Heart, Users, Star,
} from "lucide-react";

const heroReformer = "/hero-reformer.jpg"; // served from public/ — no Vite processing
import muroFrontal from "@/assets/valiance-pilates-images/1000452092.jpg";        // muro mármol
import muroLateral from "@/assets/valiance-pilates-images/1000452109.jpg";        // muro lateral
import salaArcos1 from "@/assets/valiance-pilates-images/1000452084.jpg";         // sala arcos
import salaArcos2 from "@/assets/valiance-pilates-images/1000452086.jpg";
import salaArcos3 from "@/assets/valiance-pilates-images/1000452106.jpg";
import salaMatBarre from "@/assets/valiance-pilates-images/1000452105.jpg";       // sala mat / tower
import detalleVela from "@/assets/valiance-pilates-images/1000452104.jpg";        // ambiente
import detalleBalones from "@/assets/valiance-pilates-images/1000431479.jpg";     // balones
import claseAcostadas from "@/assets/valiance-pilates-images/1000439853.jpg";
import claseBrazos from "@/assets/valiance-pilates-images/1000452524.jpg";
import claseEspalda from "@/assets/valiance-pilates-images/1000453952.jpg";
import valianceLogo from "@/assets/valiance-pilates-logo.png";

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
    description: "Una sola práctica, cuatro aparatos. Trabajamos sobre reformer, tower, mat y silla en grupos de 8 — bajo impacto, alta exigencia y atención personalizada en cada clase. La diferencia está en el conocimiento de nuestras coach y en nuestros aparatos.",
    category: "pilates", intensity: "media", color: "#C9ADA3",
    emoji: "waves", level: "Todos los niveles · madres y embarazadas", duration_min: 55, capacity: 8,
    is_active: true, sort_order: 1,
  },
  {
    id: "c2", name: "Reformer", subtitle: "El aparato estrella",
    description: "Resistencia controlada con poleas y resortes. Construye fuerza, postura y control de core sin castigar las articulaciones. Cada movimiento se adapta a ti.",
    category: "reformer", intensity: "media", color: "#C9ADA3",
    emoji: "sparkles", level: "Todos los niveles", duration_min: 55, capacity: 8,
    is_active: true, sort_order: 2,
  },
  {
    id: "c3", name: "Tower & Silla", subtitle: "Fuerza y estabilidad",
    description: "El tower y la silla suman planos de movimiento distintos: más rango, más reto de equilibrio y un trabajo profundo de tren superior y core.",
    category: "tower", intensity: "media", color: "#C0AAD6",
    emoji: "flame", level: "Todos los niveles", duration_min: 55, capacity: 8,
    is_active: true, sort_order: 3,
  },
  {
    id: "c4", name: "Mat", subtitle: "Pilates clásico en colchoneta",
    description: "Conexión profunda con el core, respiración consciente y control postural. Sin máquina, todo eres tú y tu cuerpo.",
    category: "mat", intensity: "media", color: "#8B7785",
    emoji: "activity", level: "Todos los niveles", duration_min: 55, capacity: 8,
    is_active: true, sort_order: 4,
  },
];

/* Temas musculares por día — cupo 8 por clase */
const TEMAS_SEMANA = [
  { dia: "Lunes", tema: "Pierna & glúteo" },
  { dia: "Martes", tema: "Full body" },
  { dia: "Miércoles", tema: "Tren superior" },
  { dia: "Jueves", tema: "Pierna & glúteo" },
  { dia: "Viernes", tema: "Full body" },
  { dia: "Sábado", tema: "Core" },
] as const;

/* Horarios por bloque — cupo 8 */
const HORARIOS = [
  { dias: "Lun · Mié · Vie", horas: ["7:00", "8:00", "9:00 am", "5:30", "6:30", "7:30", "8:30 pm"] },
  { dias: "Mar · Jue", horas: ["5:30", "6:30", "7:30 pm"] },
  { dias: "Sábado", horas: ["9:00 am"] },
] as const;

/* Paquetes mensuales — no acumulables, vencen al fin del mes de compra */
const PAQUETES = [
  { id: "p1", name: "7 clases", classes: 7, price: 880, hint: "1–2 por semana" },
  { id: "p2", name: "9 clases", classes: 9, price: 1050, hint: "2 por semana", popular: true },
  { id: "p3", name: "14 clases", classes: 14, price: 1400, hint: "3+ por semana", best: true },
] as const;

/* Cargos puntuales */
const CARGOS = [
  { id: "x1", name: "Inscripción", price: 500, hint: "Pago único" },
  { id: "x2", name: "Clase extra", price: 130, hint: "Para ya inscritas" },
  { id: "x3", name: "Clase suelta / visita", price: 250, hint: "Sin inscripción" },
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
  const [instructors, setInstructors] = useState<{
    id: string; displayName: string; specialties?: string | string[];
    photoUrl?: string; photoFocusX?: number; photoFocusY?: number;
  }[]>([]);

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
    api.get("/public/instructors").then(({ data }) => {
      const rows = Array.isArray(data?.data) ? data.data : [];
      if (rows.length > 0) setInstructors(rows);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("opacity-100", "translate-y-0");
          e.target.classList.remove("opacity-0", "translate-y-6");
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
    { label: "Coach", id: "equipo" },
    { label: "Eventos", id: "eventos" },
    { label: "Visítanos", id: "contacto" },
  ];

  const displayedInstructors = instructors.length > 0
    ? instructors.map((i) => ({
        id: i.id,
        name: i.displayName,
        specialty: Array.isArray(i.specialties) ? i.specialties.join(" · ")
          : (typeof i.specialties === "string" ? i.specialties : "Coach certificada"),
        photoUrl: i.photoUrl,
        focusX: typeof i.photoFocusX === "number" ? i.photoFocusX : 50,
        focusY: typeof i.photoFocusY === "number" ? i.photoFocusY : 30,
      }))
    : [];

  return (
    <div className="min-h-screen bg-valiance-nude text-valiance-charcoal selection:bg-valiance-blush selection:text-valiance-charcoal">
      {/* ────────── NAV ────────── */}
      <nav
        className={`fixed top-0 inset-x-0 z-[100] transition-all duration-500 ${
          navScrolled || mobileMenuOpen
            ? "bg-valiance-nude/85 backdrop-blur-xl shadow-[0_1px_0_rgba(140,107,111,0.12)]"
            : "bg-transparent"
        }`}
      >
        <div className="max-w-[1440px] mx-auto flex items-center justify-between px-6 sm:px-10 py-3">
          <a
            href="#"
            className="flex items-baseline gap-2 group"
            aria-label="Tu Espacio Pilates — Inicio"
            onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          >
            <img
              src={valianceLogo}
              alt=""
              className={`h-20 sm:h-40 lg:h-48 w-auto object-contain transition-all duration-500 ${
                navScrolled ? "" : "brightness-[10] contrast-[1.2]"
              }`}
            />
          </a>

          <ul className="hidden lg:flex items-center gap-1 list-none">
            {NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => scrollTo(item.id)}
                  className="px-3.5 py-2 text-[0.78rem] tracking-[0.04em] text-valiance-charcoal/70 hover:text-valiance-charcoal transition-colors bg-transparent border-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-valiance-gold/50 rounded-full"
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
                  className="hidden sm:block text-[0.78rem] tracking-wide text-valiance-charcoal/70 hover:text-valiance-charcoal transition-colors bg-transparent border-none cursor-pointer px-3 py-2"
                >
                  Iniciar sesión
                </button>
                <button
                  onClick={() => navigate("/auth/register")}
                  className="px-5 py-2.5 rounded-full text-[0.78rem] font-medium tracking-wide bg-valiance-charcoal text-valiance-nude hover:bg-valiance-plum transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-valiance-gold/50"
                >
                  Reservar
                </button>
              </>
            )}

            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden w-10 h-10 flex items-center justify-center rounded-full hover:bg-valiance-blush/75 transition-colors"
              aria-label="Abrir menú"
            >
              <Menu size={20} className="text-valiance-charcoal" />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile drawer — RENDERED OUTSIDE <nav> so backdrop-filter on nav doesn't trap position:fixed */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[200] lg:hidden">
          <button
            className="absolute inset-0 bg-valiance-charcoal/70 backdrop-blur-md animate-in fade-in duration-150"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Cerrar menú"
          />
          <div
            className="absolute right-0 top-0 bottom-0 w-[88%] max-w-[360px] shadow-2xl flex flex-col animate-in slide-in-from-right duration-200 bg-valiance-nude"
            style={{ backgroundColor: "#FBF6F4", backdropFilter: "none" }}
          >
            <div className="flex items-center justify-between px-6 py-5 border-b border-valiance-blush">
              <img src={valianceLogo} alt="" className="h-16 w-auto object-contain" />
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-valiance-blush/75 transition-colors"
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
                  className="w-full text-left px-6 py-3.5 text-[0.95rem] font-display text-valiance-charcoal hover:bg-valiance-blush/30 transition-colors bg-transparent border-none cursor-pointer"
                >
                  {item.label}
                </button>
              ))}
            </nav>
            {!isAuthenticated && (
              <div className="px-6 py-5 border-t border-valiance-blush space-y-2.5">
                <button
                  onClick={() => { setMobileMenuOpen(false); navigate("/auth/login"); }}
                  className="w-full py-3 rounded-full border border-valiance-mauve/30 text-valiance-charcoal text-[0.82rem] font-medium hover:bg-valiance-blush/75 transition-colors"
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
            src={heroReformer}
            alt="Clase de Pilates en reformer en Tu Espacio Pilates Villa Magna"
            className="w-full h-full object-cover"
            style={{ objectPosition: "center 40%" }}
            loading="eager"
            fetchPriority="high"
            decoding="sync"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-valiance-charcoal/80 via-valiance-charcoal/30 to-valiance-charcoal/10" />
          <div className="absolute inset-0 bg-gradient-to-r from-valiance-charcoal/30 to-transparent" />
        </div>

        <div className="relative z-10 w-full max-w-[1440px] mx-auto px-6 sm:px-10 pb-20 sm:pb-28 pt-32">
          <div className="max-w-[640px]">
            <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-valiance-nude/15 backdrop-blur-md border border-valiance-nude/20 text-valiance-nude/95 text-[0.7rem] tracking-[0.18em] uppercase font-medium mb-8 reveal opacity-0 translate-y-6 transition-all duration-700">
              <span className="w-1.5 h-1.5 rounded-full bg-valiance-gold animate-pulse-dot" />
              Estudio de Pilates · Villa Magna, SLP
            </div>

            <h1
              className="font-display text-[clamp(3rem,8.5vw,6.5rem)] leading-[0.96] tracking-[-0.02em] text-valiance-nude mb-6 reveal opacity-0 translate-y-6 transition-all duration-700 delay-100"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Explora el<br />
              método pilates,<br />
              <em className="not-italic text-valiance-blush">con resultados.</em>
            </h1>

            <p className="font-body text-[clamp(1rem,1.3vw,1.15rem)] text-valiance-nude/85 leading-[1.7] max-w-[480px] mb-10 reveal opacity-0 translate-y-6 transition-all duration-700 delay-200">
              Tu Espacio Pilates en Villa Magna. Una disciplina, cuatro aparatos —reformer, tower, mat y silla—. Bajo impacto, alta exigencia, en grupos de 8 con atención personalizada. Un espacio hecho para ti.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 reveal opacity-0 translate-y-6 transition-all duration-700 delay-300">
              <button
                onClick={() => navigate("/auth/register")}
                className="group bg-valiance-nude text-valiance-charcoal px-8 py-4 rounded-full text-[0.82rem] font-medium tracking-[0.06em] uppercase inline-flex items-center justify-center gap-2.5 hover:bg-valiance-blush transition-all duration-300 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-valiance-gold"
              >
                Reservar primera clase
                <ArrowUpRight size={16} strokeWidth={2} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </button>
              <button
                onClick={() => scrollTo("filosofia")}
                className="px-8 py-4 rounded-full text-[0.82rem] font-medium tracking-[0.06em] uppercase text-valiance-nude border border-valiance-nude/30 hover:bg-valiance-nude/10 backdrop-blur-sm transition-all duration-300 active:scale-[0.98]"
              >
                Conocer la filosofía
              </button>
            </div>
          </div>
        </div>

        {/* fade hacia el fondo nude */}
        <div className="absolute bottom-0 inset-x-0 h-32 bg-gradient-to-t from-valiance-nude to-transparent z-[5]" />
      </section>

      {/* ────────── DISCIPLINAS — strip flotante ────────── */}
      <section className="relative z-10 -mt-16 mb-12">
        <div className="max-w-[1200px] mx-auto px-6 sm:px-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-valiance-blush rounded-3xl overflow-hidden shadow-[0_30px_60px_-20px_rgba(140,107,111,0.25)]">
            {[
              { name: "Reformer", icon: Waves, hint: "Resistencia controlada" },
              { name: "Tower", icon: Sparkles, hint: "Rango y estabilidad" },
              { name: "Mat", icon: Activity, hint: "Pilates clásico" },
              { name: "Silla", icon: Flame, hint: "Fuerza y equilibrio" },
            ].map((d) => (
              <button
                key={d.name}
                onClick={() => scrollTo("clases")}
                className="bg-valiance-nude p-6 sm:p-7 text-left flex flex-col gap-2 hover:bg-valiance-blush/75 transition-colors group focus-visible:outline-none focus-visible:bg-valiance-blush/60"
              >
                <d.icon size={20} className="text-valiance-mauve group-hover:text-valiance-plum transition-colors" strokeWidth={1.6} />
                <div className="font-display text-[1.4rem] leading-tight text-valiance-charcoal mt-1">{d.name}</div>
                <div className="font-body text-[0.78rem] text-valiance-mauve">{d.hint}</div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ────────── FILOSOFÍA / MANIFIESTO ────────── */}
      <section id="filosofia" className="py-24 lg:py-36 px-6 sm:px-10">
        <div className="max-w-[1200px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-20 items-center">
          <div className="lg:col-span-5 reveal opacity-0 translate-y-6 transition-all duration-700">
            <div className="text-[0.7rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium mb-5">
              Tu espacio
            </div>
            <h2
              className="font-display text-[clamp(2.4rem,4.5vw,3.8rem)] leading-[1.04] tracking-[-0.015em] text-valiance-charcoal mb-6"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Una <em className="not-italic text-valiance-mauve">disciplina</em>.
              Una <em className="not-italic text-valiance-gold">comunidad</em> que te acompaña.
            </h2>
            <p className="font-body text-[1.02rem] text-valiance-charcoal/75 leading-[1.85] max-w-[480px]">
              Aquí el pilates es para ti: madres, embarazadas y mujeres que quieren moverse con propósito. Lo que nos distingue es el conocimiento de nuestras coach y nuestros aparatos. Llegas, te conocen por tu nombre y sales más fuerte cada clase.
            </p>
          </div>

          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 reveal opacity-0 translate-y-6 transition-all duration-700 delay-100">
            {VALORES.map((v) => (
              <div
                key={v.label}
                className="group rounded-3xl bg-valiance-blush/35 hover:bg-valiance-blush/55 p-7 transition-colors duration-300"
              >
                <v.icon size={22} className="text-valiance-mauve mb-4" strokeWidth={1.5} />
                <div className="font-display text-[1.4rem] text-valiance-charcoal mb-2">{v.label}</div>
                <p className="font-body text-[0.92rem] text-valiance-charcoal/70 leading-[1.65]">{v.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ────────── CLASES ────────── */}
      <section id="clases" className="py-20 lg:py-28 px-6 sm:px-10">
        <div className="max-w-[1200px] mx-auto">
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 mb-14 max-w-[720px]">
            <div className="text-[0.7rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium mb-4">
              La disciplina
            </div>
            <h2
              className="font-display text-[clamp(2.4rem,5vw,4rem)] leading-[1.02] tracking-[-0.015em] text-valiance-charcoal mb-5"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Pilates, en cuatro aparatos.
              <span className="text-valiance-mauve"> Una sola intención.</span>
            </h2>
            <p className="font-body text-[1rem] text-valiance-charcoal/70 leading-[1.75]">
              Reformer, tower, mat y silla. Grupos de 8, atención personalizada y sesiones que te retan sin dejar la técnica de lado.
            </p>
          </div>

          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
            {classTypes.slice(0, 4).map((c, idx) => {
              const isHero = idx === 0; // Pilates destacado
              const accent = c.color || "#C9ADA3";
              return (
                <article
                  key={c.id}
                  className={`group relative rounded-3xl p-8 sm:p-10 transition-all duration-500 ${
                    isHero
                      ? "bg-valiance-charcoal text-valiance-nude md:row-span-2 flex flex-col"
                      : "bg-valiance-blush/30 hover:bg-valiance-blush/50 text-valiance-charcoal"
                  }`}
                >
                  <div className="flex items-start justify-between mb-6">
                    <span
                      className={`text-[0.66rem] tracking-[0.18em] uppercase font-medium ${isHero ? "text-valiance-blush/80" : "text-valiance-mauve"}`}
                    >
                      {c.subtitle}
                    </span>
                    <span
                      className={`text-[0.66rem] tracking-[0.15em] uppercase ${isHero ? "text-valiance-nude/60" : "text-valiance-charcoal/50"}`}
                    >
                      {c.duration_min}′ · grupo de {c.capacity}
                    </span>
                  </div>

                  <h3
                    className={`font-display ${isHero ? "text-[clamp(2.4rem,5vw,3.5rem)]" : "text-[clamp(1.6rem,2.4vw,2.2rem)]"} leading-[1.02] tracking-[-0.015em] mb-4`}
                  >
                    {c.name}
                  </h3>

                  <p
                    className={`font-body text-[0.96rem] leading-[1.75] ${isHero ? "text-valiance-nude/80 max-w-[420px]" : "text-valiance-charcoal/75"} ${isHero ? "mb-8 flex-1" : "mb-6"}`}
                  >
                    {c.description}
                  </p>

                  <div
                    className={`flex items-center gap-3 text-[0.74rem] ${isHero ? "text-valiance-nude/60" : "text-valiance-charcoal/60"}`}
                  >
                    <span
                      className="inline-flex items-center justify-center w-8 h-8 rounded-full"
                      style={{
                        background: isHero ? "rgba(201,173,163,0.18)" : `${accent}30`,
                        color: isHero ? "#E8D3CE" : "#5A4A57",
                      }}
                    >
                      <Clock size={14} strokeWidth={1.6} />
                    </span>
                    {c.level}
                  </div>

                  {isHero && (
                    <button
                      onClick={() => navigate("/auth/register")}
                      className="mt-8 self-start px-6 py-3 rounded-full bg-valiance-nude text-valiance-charcoal text-[0.78rem] font-medium tracking-[0.06em] uppercase hover:bg-valiance-blush transition-all active:scale-[0.98] inline-flex items-center gap-2"
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

      {/* ────────── TEMA MUSCULAR POR DÍA + HORARIOS ────────── */}
      <section className="py-20 lg:py-28 px-6 sm:px-10">
        <div className="max-w-[1200px] mx-auto">
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 max-w-[720px] mb-12">
            <div className="text-[0.7rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium mb-4">
              Tu semana
            </div>
            <h2
              className="font-display text-[clamp(2.4rem,5vw,4rem)] leading-[1.02] tracking-[-0.015em] text-valiance-charcoal mb-5"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Cada día, un enfoque distinto.
            </h2>
            <p className="font-body text-[1rem] text-valiance-charcoal/70 leading-[1.75]">
              Trabajamos el cuerpo completo a lo largo de la semana. Tú eliges cuándo, nosotras marcamos el tema. Cupo de 8 por clase.
            </p>
          </div>

          {/* Strip semanal de temas */}
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-valiance-blush rounded-3xl overflow-hidden mb-14">
            {TEMAS_SEMANA.map((d) => (
              <div key={d.dia} className="bg-valiance-nude p-6 flex flex-col gap-2">
                <div className="text-[0.62rem] tracking-[0.18em] uppercase text-valiance-mauve font-medium">{d.dia}</div>
                <div className="font-display text-[1.35rem] leading-[1.1] text-valiance-charcoal">{d.tema}</div>
              </div>
            ))}
          </div>

          {/* Bloques de horarios */}
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {HORARIOS.map((b) => (
              <div key={b.dias} className="rounded-3xl bg-valiance-blush/35 p-7 flex flex-col gap-4">
                <div className="flex items-center gap-2.5">
                  <span className="w-9 h-9 rounded-full bg-valiance-nude flex items-center justify-center text-valiance-mauve flex-shrink-0">
                    <Clock size={16} strokeWidth={1.6} />
                  </span>
                  <span className="font-display text-[1.3rem] text-valiance-charcoal leading-tight">{b.dias}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {b.horas.map((h) => (
                    <span key={h} className="px-3 py-1.5 rounded-full bg-valiance-nude text-[0.8rem] text-valiance-charcoal/80 font-body">
                      {h}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[0.78rem] text-valiance-charcoal/55 mt-6 font-body">
            Cupo de 8 personas por clase. Reserva tu lugar con anticipación.
          </p>
        </div>
      </section>

      {/* ────────── HORARIO / RESERVA EN VIVO ────────── */}
      <Schedule />

      {/* ────────── PRECIOS ────────── */}
      <section id="precios" className="py-20 lg:py-28 px-6 sm:px-10 bg-valiance-blush/55">
        <div className="max-w-[1200px] mx-auto">
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 max-w-[720px] mb-14">
            <div className="text-[0.7rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium mb-4">
              Inversión
            </div>
            <h2
              className="font-display text-[clamp(2.4rem,5vw,4rem)] leading-[1.02] tracking-[-0.015em] text-valiance-charcoal mb-5"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Encuentra el ritmo que va con el tuyo.
            </h2>
            <p className="font-body text-[1rem] text-valiance-charcoal/70 leading-[1.75]">
              Paquetes mensuales, no acumulables: vencen al fin del mes de compra. Elige el que mejor acompañe tu semana.
            </p>
          </div>

          {/* PAQUETES MENSUALES */}
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 mb-14">
            <div className="flex items-baseline justify-between mb-6 flex-wrap gap-3">
              <h3 className="font-display text-[1.8rem] text-valiance-charcoal">Paquetes mensuales</h3>
              <span className="text-[0.78rem] text-valiance-mauve font-body">grupos de 8 · 55 minutos</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              {PAQUETES.map((p) => {
                const featured = p.popular || p.best;
                return (
                  <div
                    key={p.id}
                    className={`relative rounded-3xl p-7 flex flex-col gap-2 transition-all duration-300 hover:-translate-y-1 ${
                      p.best
                        ? "bg-valiance-charcoal text-valiance-nude shadow-[0_30px_60px_-25px_rgba(26,26,26,0.45)]"
                        : p.popular
                          ? "bg-valiance-nude border-2 border-valiance-gold shadow-[0_15px_40px_-20px_rgba(184,145,90,0.45)]"
                          : "bg-valiance-nude hover:shadow-[0_15px_40px_-25px_rgba(192,170,214,0.3)]"
                    }`}
                  >
                    {featured && (
                      <span
                        className={`absolute -top-3 left-6 text-[0.6rem] tracking-[0.18em] uppercase px-3 py-1 rounded-full font-medium ${
                          p.best ? "bg-valiance-gold text-valiance-charcoal" : "bg-valiance-charcoal text-valiance-nude"
                        }`}
                      >
                        {p.popular ? "Más popular" : "Mejor valor"}
                      </span>
                    )}
                    <div className={`text-[0.66rem] tracking-[0.18em] uppercase font-medium ${p.best ? "text-valiance-blush/70" : "text-valiance-mauve"}`}>
                      {p.name} / mes
                    </div>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className={`font-display text-[2.6rem] leading-none ${p.best ? "text-valiance-nude" : "text-valiance-charcoal"}`}>
                        ${p.price.toLocaleString()}
                      </span>
                      <span className={`text-[0.72rem] ${p.best ? "text-valiance-nude/50" : "text-valiance-charcoal/50"}`}>MXN</span>
                    </div>
                    <div className={`text-[0.78rem] ${p.best ? "text-valiance-nude/60" : "text-valiance-charcoal/60"} font-body`}>
                      {p.classes} clases · {p.hint}
                    </div>
                    <div className={`text-[0.74rem] ${p.best ? "text-valiance-blush/50" : "text-valiance-mauve"} font-body`}>
                      ${(p.price / p.classes).toFixed(0)} por clase
                    </div>
                    <button
                      onClick={() => navigate(ctaPath)}
                      className={`mt-4 w-full py-3 rounded-full text-[0.76rem] font-medium tracking-[0.06em] uppercase transition-all active:scale-[0.98] ${
                        p.best
                          ? "bg-valiance-nude text-valiance-charcoal hover:bg-valiance-blush"
                          : p.popular
                            ? "bg-valiance-charcoal text-valiance-nude hover:bg-valiance-plum"
                            : "border border-valiance-charcoal/20 text-valiance-charcoal hover:bg-valiance-charcoal hover:text-valiance-nude"
                      }`}
                    >
                      Elegir
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* CARGOS PUNTUALES */}
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700">
            <div className="flex items-baseline justify-between mb-6 flex-wrap gap-3">
              <h3 className="font-display text-[1.8rem] text-valiance-charcoal">Inscripción y clases individuales</h3>
              <span className="text-[0.78rem] text-valiance-mauve font-body">pagos únicos</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              {CARGOS.map((c) => (
                <div key={c.id} className="rounded-2xl p-6 bg-valiance-nude flex items-center justify-between gap-4 hover:bg-valiance-blush/40 transition-colors">
                  <div>
                    <div className="font-display text-[1.2rem] text-valiance-charcoal leading-tight">{c.name}</div>
                    <div className="text-[0.72rem] text-valiance-mauve font-body mt-1">{c.hint}</div>
                  </div>
                  <div className="font-display text-[1.8rem] text-valiance-charcoal leading-none flex items-baseline gap-1">
                    ${c.price.toLocaleString()}
                    <span className="text-[0.66rem] text-valiance-charcoal/50">MXN</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[0.74rem] text-valiance-charcoal/50 mt-10 text-center font-body max-w-[640px] mx-auto">
            Paquetes mensuales no acumulables: vencen al fin del mes de compra. La inscripción es un pago único. La adquisición implica aceptación del reglamento interno.
          </p>
        </div>
      </section>

      {/* ────────── ESTUDIO — galería editorial ────────── */}
      <section id="estudio" className="py-20 lg:py-28 px-6 sm:px-10">
        <div className="max-w-[1280px] mx-auto">
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 grid grid-cols-1 lg:grid-cols-12 gap-6 mb-12">
            <div className="lg:col-span-7">
              <div className="text-[0.7rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium mb-4">
                El espacio
              </div>
              <h2
                className="font-display text-[clamp(2.4rem,5vw,4rem)] leading-[1.02] tracking-[-0.015em] text-valiance-charcoal"
                style={{ textWrap: "balance" } as React.CSSProperties}
              >
                Un estudio que te abraza desde que entras.
              </h2>
            </div>
            <div className="lg:col-span-5 lg:pt-3">
              <p className="font-body text-[1rem] text-valiance-charcoal/70 leading-[1.8] max-w-[420px]">
                Mármol con vetas doradas, madera cálida, luz tenue y cero distracciones. Diseñado para que solo tengas que pensar en respirar.
              </p>
            </div>
          </div>

          {/* Asymmetric mosaic */}
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 grid grid-cols-12 gap-3 sm:gap-4">
            {/* Hero — muro mármol */}
            <figure className="col-span-12 lg:col-span-8 relative rounded-3xl overflow-hidden aspect-[16/10] group">
              <img src={muroFrontal} alt="Muro de mármol del estudio Tu Espacio Pilates" loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-[1200ms]" />
              <div className="absolute inset-0 bg-gradient-to-t from-valiance-charcoal/65 via-transparent to-transparent" />
              <figcaption className="absolute bottom-6 left-6 right-6">
                <span className="inline-block text-[0.6rem] tracking-[0.22em] uppercase text-valiance-gold mb-2 font-medium">Lobby principal</span>
                <h3 className="font-display text-valiance-nude text-[1.8rem] sm:text-[2.4rem] leading-[1.05]">Mármol, oro y silencio.</h3>
              </figcaption>
            </figure>

            {/* Sala arcos */}
            <figure className="col-span-6 lg:col-span-4 relative rounded-3xl overflow-hidden aspect-[3/4] group">
              <img src={salaArcos1} alt="Sala con arcos iluminados y reformers" loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-[1200ms]" />
              <div className="absolute inset-0 bg-gradient-to-t from-valiance-charcoal/45 to-transparent" />
              <figcaption className="absolute bottom-5 left-5">
                <span className="text-valiance-nude/95 text-[0.66rem] tracking-[0.18em] uppercase font-medium">Sala Reformer</span>
              </figcaption>
            </figure>

            {/* Detalle vela */}
            <figure className="col-span-6 lg:col-span-3 relative rounded-3xl overflow-hidden aspect-[3/4] group">
              <img src={detalleVela} alt="Detalle ambient — vela y accesorios" loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-[1200ms]" />
            </figure>

            {/* Sala mat */}
            <figure className="col-span-6 lg:col-span-5 relative rounded-3xl overflow-hidden aspect-[16/10] group">
              <img src={salaMatBarre} alt="Sala de Mat y tower" loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-[1200ms]" />
              <div className="absolute inset-0 bg-gradient-to-t from-valiance-charcoal/50 to-transparent" />
              <figcaption className="absolute bottom-5 left-5">
                <span className="text-valiance-nude/95 text-[0.66rem] tracking-[0.18em] uppercase font-medium">Sala Mat & Tower</span>
              </figcaption>
            </figure>

            {/* Sala arcos 2 */}
            <figure className="col-span-12 lg:col-span-4 relative rounded-3xl overflow-hidden aspect-[16/10] lg:aspect-[3/4] group">
              <img src={salaArcos2} alt="Vista lateral sala reformer" loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-[1200ms]" />
            </figure>

            {/* Detalles */}
            <figure className="col-span-6 lg:col-span-3 relative rounded-3xl overflow-hidden aspect-square group">
              <img src={detalleBalones} alt="Balones ucan en estante" loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-[1200ms]" />
            </figure>

            <figure className="col-span-6 lg:col-span-3 relative rounded-3xl overflow-hidden aspect-square group">
              <img src={salaArcos3} alt="Detalle reformer" loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-[1200ms]" />
            </figure>

            <figure className="col-span-12 lg:col-span-6 relative rounded-3xl overflow-hidden aspect-[21/9] group">
              <img src={muroLateral} alt="Muro mármol vista lateral" loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-[1200ms]" />
              <div className="absolute inset-0 bg-gradient-to-t from-valiance-charcoal/40 to-transparent" />
              <figcaption className="absolute bottom-5 right-6 text-right">
                <span className="text-valiance-nude/95 text-[0.66rem] tracking-[0.18em] uppercase font-medium">Detalles que importan</span>
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* ────────── EQUIPO ────────── */}
      <section id="equipo" className="py-20 lg:py-28 px-6 sm:px-10 bg-valiance-blush/55">
        <div className="max-w-[1200px] mx-auto">
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 max-w-[720px] mb-14">
            <div className="text-[0.7rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium mb-4">
              Nuestras coach
            </div>
            <h2
              className="font-display text-[clamp(2.4rem,5vw,4rem)] leading-[1.02] tracking-[-0.015em] text-valiance-charcoal mb-5"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Lo que nos distingue: el conocimiento de nuestras coach.
            </h2>
            <p className="font-body text-[1rem] text-valiance-charcoal/70 leading-[1.75]">
              Coach certificadas que conocen el método a profundidad y cada uno de nuestros aparatos. En grupos de 8 saben cómo trabajaste la semana pasada y qué necesitas hoy: cada movimiento se adapta a tu cuerpo, tu nivel y tu momento —incluido el embarazo o el posparto—.
            </p>
          </div>

          {displayedInstructors.length > 0 ? (
            <div className="reveal opacity-0 translate-y-6 transition-all duration-700 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 sm:gap-5">
              {displayedInstructors.slice(0, 6).map((inst) => (
                <article key={inst.id} className="group">
                  <div className="relative rounded-2xl overflow-hidden aspect-[3/4] mb-3 bg-valiance-mauve/10">
                    {inst.photoUrl ? (
                      <img
                        src={inst.photoUrl}
                        alt={inst.name}
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover grayscale-[20%] group-hover:grayscale-0 group-hover:scale-[1.04] transition-all duration-[900ms]"
                        style={{ objectPosition: `${inst.focusX}% ${inst.focusY}%` }}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-valiance-blush/75">
                        <span className="font-display text-[3rem] text-valiance-mauve/60">{inst.name[0]}</span>
                      </div>
                    )}
                  </div>
                  <h3 className="font-display text-[1.3rem] text-valiance-charcoal leading-tight">{inst.name}</h3>
                  <p className="font-body text-[0.78rem] text-valiance-mauve mt-0.5 leading-snug">{inst.specialty}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="reveal opacity-0 translate-y-6 transition-all duration-700 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5">
              {[
                { icon: Star, title: "Certificadas en el método", text: "Formación en pilates y en cada aparato: reformer, tower, mat y silla." },
                { icon: Heart, title: "Atención personalizada", text: "Grupos de 8 para corregir, acompañar y ajustar cada clase a ti." },
                { icon: Users, title: "Cerca de ti", text: "Acompañamos a madres, embarazadas y mujeres de 25+ en cada etapa." },
              ].map((card) => (
                <div key={card.title} className="rounded-3xl bg-valiance-nude p-8 flex flex-col gap-3">
                  <span className="w-11 h-11 rounded-full bg-valiance-blush/40 flex items-center justify-center text-valiance-mauve">
                    <card.icon size={20} strokeWidth={1.5} />
                  </span>
                  <h3 className="font-display text-[1.4rem] text-valiance-charcoal leading-tight">{card.title}</h3>
                  <p className="font-body text-[0.9rem] text-valiance-charcoal/70 leading-[1.7]">{card.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ────────── REGLAMENTO ────────── */}
      <section id="reglamento" className="py-20 lg:py-28 px-6 sm:px-10">
        <div className="max-w-[1200px] mx-auto">
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 max-w-[720px] mb-14">
            <div className="text-[0.7rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium mb-4">
              La casa
            </div>
            <h2
              className="font-display text-[clamp(2.4rem,5vw,4rem)] leading-[1.02] tracking-[-0.015em] text-valiance-charcoal mb-5"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Reglas para que todas estemos cómodas.
            </h2>
            <p className="font-body text-[1rem] text-valiance-charcoal/70 leading-[1.75]">
              Lo justo, lo claro, lo necesario.
            </p>
          </div>

          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-valiance-blush rounded-3xl overflow-hidden">
            {POLITICAS.map((p) => (
              <div key={p.num} className="bg-valiance-nude p-6 sm:p-7 hover:bg-valiance-blush/30 transition-colors">
                <div className="font-display text-[2.4rem] text-valiance-mauve/50 leading-none mb-3">{p.num}</div>
                <h4 className="font-display text-[1.2rem] text-valiance-charcoal mb-2 leading-tight">{p.title}</h4>
                <p className="font-body text-[0.86rem] text-valiance-charcoal/70 leading-[1.7]">{p.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ────────── EVENTOS — informativo, no reservable ────────── */}
      <section id="eventos" className="py-20 lg:py-28 px-6 sm:px-10 bg-valiance-blush/35">
        <div className="max-w-[1200px] mx-auto">
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 max-w-[760px] mb-14">
            <div className="text-[0.7rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium mb-4">
              Eventos
            </div>
            <h2
              className="font-display text-[clamp(2.4rem,5vw,4rem)] leading-[1.02] tracking-[-0.015em] text-valiance-charcoal mb-5"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Celebra tu cumple en Tu Espacio Pilates.
            </h2>
            <p className="font-body text-[1rem] text-valiance-charcoal/70 leading-[1.75]">
              Una clase de 55 minutos full body + 30 minutos para fotos + kit. Una forma distinta y bonita de festejar con tus personas favoritas.
            </p>
          </div>

          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
            {/* Cumple */}
            <div className="rounded-3xl bg-valiance-nude p-8 sm:p-10 flex flex-col gap-5">
              <div>
                <span className="inline-block text-[0.62rem] tracking-[0.2em] uppercase text-valiance-mauve font-medium mb-2">El clásico</span>
                <h3 className="font-display text-[1.9rem] text-valiance-charcoal leading-tight">Cumple</h3>
                <p className="font-body text-[0.86rem] text-valiance-charcoal/65 mt-1">Clase full body + 30 min de fotos + kit.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {EVENTO_BASE.map((e) => (
                  <div key={e.personas} className="rounded-2xl bg-valiance-blush/30 px-5 py-4 flex items-baseline justify-between gap-2">
                    <span className="font-body text-[0.86rem] text-valiance-charcoal/75">{e.personas}</span>
                    <span className="font-display text-[1.5rem] text-valiance-charcoal leading-none">${e.price.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Cumple & Brunch */}
            <div className="rounded-3xl bg-valiance-charcoal text-valiance-nude p-8 sm:p-10 flex flex-col gap-5">
              <div>
                <span className="inline-block text-[0.62rem] tracking-[0.2em] uppercase text-valiance-gold font-medium mb-2">Más completo</span>
                <h3 className="font-display text-[1.9rem] leading-tight">Cumple &amp; Brunch</h3>
                <p className="font-body text-[0.86rem] text-valiance-nude/65 mt-1">Todo lo del clásico + box lunch + bolsa de snack.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {EVENTO_BRUNCH.map((e) => (
                  <div key={e.personas} className="rounded-2xl bg-valiance-nude/10 px-5 py-4 flex items-baseline justify-between gap-2">
                    <span className="font-body text-[0.86rem] text-valiance-nude/75">{e.personas}</span>
                    <span className="font-display text-[1.5rem] text-valiance-nude leading-none">${e.price.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 flex flex-col sm:flex-row sm:items-center gap-5 rounded-3xl bg-valiance-nude p-7 sm:p-8">
            <div className="flex-1">
              <p className="font-body text-[0.92rem] text-valiance-charcoal/80 leading-[1.7]">
                Decoración con globos <strong className="text-valiance-charcoal">+$700</strong>. Horarios de eventos: {HORARIOS_EVENTOS}.
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
      <section id="contacto" className="py-20 lg:py-28 px-6 sm:px-10 bg-valiance-blush/75">
        <div className="max-w-[1200px] mx-auto">
          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 text-center mb-16 max-w-[720px] mx-auto">
            <div className="text-[0.7rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium mb-5">
              Tu primer paso
            </div>
            <h2
              className="font-display text-[clamp(2.6rem,6vw,5rem)] leading-[1] tracking-[-0.02em] text-valiance-charcoal mb-6"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Reserva tu primera clase.<br />
              <em className="not-italic text-valiance-mauve">El resto se construye sola.</em>
            </h2>
            <p className="font-body text-[1.05rem] text-valiance-charcoal/75 max-w-[480px] mx-auto mb-9 leading-[1.8]">
              Te respondemos por WhatsApp en menos de una hora. Te explicamos todo, sin compromiso.
            </p>
            <div className="flex gap-3 justify-center items-center flex-wrap">
              <button
                onClick={() => navigate(ctaPath)}
                className="bg-valiance-charcoal text-valiance-nude px-8 py-4 rounded-full text-[0.82rem] font-medium tracking-[0.06em] uppercase inline-flex items-center gap-2.5 hover:bg-valiance-plum transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-valiance-gold"
              >
                Reservar primera clase
                <ArrowUpRight size={16} strokeWidth={2} />
              </button>
              <a
                href="https://wa.me/524445480352?text=Hola%2C%20me%20interesa%20reservar%20mi%20primera%20clase%20en%20Tu%20Espacio%20Pilates"
                target="_blank"
                rel="noopener noreferrer"
                className="border border-valiance-charcoal/20 text-valiance-charcoal text-[0.82rem] font-medium tracking-[0.06em] uppercase flex items-center gap-2.5 px-8 py-4 rounded-full hover:border-valiance-charcoal hover:bg-valiance-charcoal hover:text-valiance-nude transition-all no-underline"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" /><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 0 1-4.243-1.214l-.257-.154-2.88.856.856-2.88-.154-.257A8 8 0 1 1 12 20z" /></svg>
                WhatsApp
              </a>
            </div>
          </div>

          <div className="reveal opacity-0 translate-y-6 transition-all duration-700 grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-5 rounded-3xl bg-valiance-nude p-8 sm:p-10 flex flex-col gap-7">
              <div>
                <div className="text-[0.66rem] tracking-[0.22em] uppercase text-valiance-mauve font-medium mb-3">Encuéntranos</div>
                <h3 className="font-display text-[2rem] sm:text-[2.4rem] leading-[1.05] text-valiance-charcoal">
                  Nos vemos<br />en el estudio.
                </h3>
              </div>

              <div className="flex flex-col gap-5">
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
                  { icon: <Clock size={18} />, label: "Horarios", value: "Lun · Mié · Vie 7–9 am y 5:30–8:30 pm · Mar · Jue 5:30–7:30 pm · Sáb 9 am" },
                ].map((item) => (
                  <div key={item.label} className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-valiance-blush/50 text-valiance-mauve">
                      {item.icon}
                    </div>
                    <div>
                      <div className="text-[0.62rem] tracking-[0.22em] uppercase mb-1 text-valiance-mauve">{item.label}</div>
                      <div className="text-[0.95rem] text-valiance-charcoal font-body leading-snug">{item.value}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-2.5 pt-2">
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

            <div className="lg:col-span-7 rounded-3xl overflow-hidden bg-valiance-nude min-h-[440px]">
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
        <div className="max-w-[1200px] mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 pb-12 border-b border-valiance-nude/10">
            <div className="lg:col-span-2 max-w-[360px]">
              <img src={valianceLogo} alt="Tu Espacio Pilates" className="h-24 w-auto object-contain mb-5 brightness-[10] contrast-[1.2]" />
              <p className="font-body text-[0.92rem] text-valiance-nude/55 leading-[1.75]">
                Tu Espacio Pilates · Villa Magna, San Luis Potosí. Una disciplina, cuatro aparatos. Disciplina, respeto y comunidad — un espacio hecho para ti.
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
            <p className="font-body text-[0.72rem] text-valiance-nude/30">
              &copy; {new Date().getFullYear()} Tu Espacio Pilates · Villa Magna. Todos los derechos reservados.
            </p>
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
