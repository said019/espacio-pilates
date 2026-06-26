/**
 * MembershipCard – Tarjeta visual de membresía
 * Paleta oficial Valiance Pilates · Fuentes Gulfs + Alilato
 */

import { useMemo } from "react";
import { format, differenceInCalendarDays } from "date-fns";
import { es } from "date-fns/locale";
import { Infinity as InfinityIcon, CalendarDays } from "lucide-react";
import { safeParse } from "@/lib/utils";
import type { ClientMembership } from "@/types/membership";
import imgPilates    from "@/assets/pilates_2320695.png";

// ─────────────────────────────────────────────
// Categoría
// ─────────────────────────────────────────────
type PlanCategory = "pilates" | "bienestar" | "other";

function detectCategory(planName: string): PlanCategory {
  const lower = planName.toLowerCase();
  if (lower.includes("body") || lower.includes("strong") || lower.includes("flex")) return "bienestar";
  if (lower.includes("pilates") || lower.includes("mat") || lower.includes("flow") || lower.includes("terapéutico") || lower.includes("clásico")) return "pilates";
  return "other";
}

// ─────────────────────────────────────────────
// Paleta Valiance Pilates
// ─────────────────────────────────────────────
const PALETTE = {
  pilates: {
    gradient:     "linear-gradient(145deg, #f2f4ec 0%, #e8ecdd 55%, #f2f4ec 100%)",
    noise:        "rgba(181,191,156,0.06)",
    glow1:        "#D9B5BA",
    glow2:        "#8C6B6F",
    accent:       "#8C6B6F",
    accentLight:  "#6B4F53",
    badge:        "rgba(181,191,156,0.25)",
    badgeText:    "#6B4F53",
    badgeBorder:  "rgba(107,122,82,0.35)",
    label:        "Pilates",
    border:       "rgba(181,191,156,0.45)",
    stampBg:      "rgba(181,191,156,0.18)",
    stampBorder:  "rgba(107,122,82,0.35)",
    iconHighlight:"#8C6B6F",
    iconMuted:    "rgba(45,45,45,0.18)",
    progressFrom: "#D9B5BA",
    progressTo:   "#8C6B6F",
    divider:      "rgba(181,191,156,0.25)",
  },
  bienestar: {
    gradient:     "linear-gradient(145deg, #FDF7F8 0%, #e8e2dc 55%, #FDF7F8 100%)",
    noise:        "rgba(148,134,122,0.06)",
    glow1:        "#8C6B6F",
    glow2:        "#D9B5BA",
    accent:       "#6B4F53",
    accentLight:  "#3D3A3A",
    badge:        "rgba(148,134,122,0.25)",
    badgeText:    "#3D3A3A",
    badgeBorder:  "rgba(122,109,98,0.35)",
    label:        "Bienestar",
    border:       "rgba(148,134,122,0.40)",
    stampBg:      "rgba(148,134,122,0.15)",
    stampBorder:  "rgba(122,109,98,0.35)",
    iconHighlight:"#6B4F53",
    iconMuted:    "rgba(45,45,45,0.18)",
    progressFrom: "#8C6B6F",
    progressTo:   "#6B4F53",
    divider:      "rgba(148,134,122,0.20)",
  },
  other: {
    gradient:     "linear-gradient(145deg, #FDF7F8 0%, #eae7e2 55%, #FDF7F8 100%)",
    noise:        "rgba(148,134,122,0.04)",
    glow1:        "#8C6B6F",
    glow2:        "#D9B5BA",
    accent:       "#6B4F53",
    accentLight:  "#3D3A3A",
    badge:        "rgba(148,134,122,0.20)",
    badgeText:    "#3D3A3A",
    badgeBorder:  "rgba(148,134,122,0.35)",
    label:        "Membresía",
    border:       "rgba(148,134,122,0.35)",
    stampBg:      "rgba(148,134,122,0.12)",
    stampBorder:  "rgba(148,134,122,0.30)",
    iconHighlight:"#6B4F53",
    iconMuted:    "rgba(45,45,45,0.18)",
    progressFrom: "#8C6B6F",
    progressTo:   "#D9B5BA",
    divider:      "rgba(148,134,122,0.18)",
  },
} satisfies Record<PlanCategory, {
  gradient: string; noise: string; glow1: string; glow2: string;
  accent: string; accentLight: string; badge: string; badgeText: string;
  badgeBorder: string; label: string; border: string; stampBg: string;
  stampBorder: string; iconHighlight: string; iconMuted: string;
  progressFrom: string; progressTo: string; divider: string;
}>;

// ─────────────────────────────────────────────
// Sello individual
// ─────────────────────────────────────────────
function Stamp({
  active,
  src,
  accent,
  stampBg,
  stampBorder,
  iconHighlight,
  iconMuted,
  size,
}: {
  active: boolean;
  src: string;
  accent: string;
  stampBg: string;
  stampBorder: string;
  iconHighlight: string;
  iconMuted: string;
  size: number;
}) {
  const pad = Math.round(size * 0.18);
  return (
    <div
      style={{
        width:  size,
        height: size,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "opacity 0.35s, filter 0.35s, box-shadow 0.35s",
        background:  active ? stampBg  : "rgba(45,45,45,0.04)",
        border:      `1.5px solid ${active ? stampBorder : "rgba(45,45,45,0.08)"}`,
        boxShadow:   active ? `0 0 12px ${iconHighlight}44, inset 0 0 7px ${accent}18` : "none",
        opacity:     active ? 1 : 0.30,
        filter:      active ? "none" : "saturate(0.3)",
        padding:     pad,
      }}
    >
      <span
        aria-hidden
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          background: active ? iconHighlight : iconMuted,
          filter: active ? `drop-shadow(0 0 4px ${iconHighlight}aa)` : "none",
          WebkitMaskImage: `url(${src})`,
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          WebkitMaskSize: "contain",
          maskImage: `url(${src})`,
          maskRepeat: "no-repeat",
          maskPosition: "center",
          maskSize: "contain",
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// Grilla de sellos
// ─────────────────────────────────────────────
function StampGrid({
  classLimit,
  classesRemaining,
  category,
  pal,
}: {
  classLimit: number;
  classesRemaining: number;
  category: PlanCategory;
  pal: typeof PALETTE[PlanCategory];
}) {
  const used   = classLimit - classesRemaining;
  const stamps = useMemo(
    () => Array.from({ length: classLimit }, (_, i) => i),
    [classLimit],
  );

  // tamaño y columnas según cantidad
  const size = classLimit <= 4 ? 52 : classLimit <= 8 ? 44 : classLimit <= 12 ? 38 : classLimit <= 16 ? 32 : 26;
  const cols = classLimit <= 4 ? classLimit : classLimit <= 8 ? 4 : classLimit <= 12 ? 6 : classLimit <= 16 ? 4 : 5;

  const getImg = (_i: number) => {
    return imgPilates;
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: classLimit <= 8 ? "10px" : "7px",
        justifyItems: "center",
      }}
    >
      {stamps.map((i) => (
        <Stamp
          key={i}
          active={i >= used}
          src={getImg(i)}
          accent={pal.accent}
          stampBg={pal.stampBg}
          stampBorder={pal.stampBorder}
          iconHighlight={pal.iconHighlight}
          iconMuted={pal.iconMuted}
          size={size}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────
interface MembershipCardProps {
  membership: ClientMembership & { classCategory?: string };
  expanded?: boolean;
}

export function MembershipCard({ membership }: MembershipCardProps) {
  const planName        = membership.plan_name  ?? membership.planName  ?? "Plan personalizado";
  const classLimit      = membership.class_limit ?? membership.classLimit ?? null;
  const classesRemaining = membership.classes_remaining ?? membership.classesRemaining ?? null;
  const endDate         = membership.end_date ?? membership.endDate ?? null;
  const isUnlimited     = classLimit === null;

  const category = detectCategory(planName);
  const pal      = PALETTE[category];

  const used          = classLimit !== null && classesRemaining !== null ? classLimit - classesRemaining : 0;
  const hasStampIcons = !isUnlimited && classLimit !== null && classLimit <= 20;
  const daysRemaining = endDate
    ? Math.max(differenceInCalendarDays(safeParse(endDate), new Date()), 0)
    : null;

  return (
    <div
      className="relative overflow-hidden rounded-3xl select-none"
      style={{
        background: pal.gradient,
        border:     `1.5px solid ${pal.border}`,
        boxShadow:  `0 8px 40px ${pal.glow1}15, 0 2px 12px rgba(0,0,0,0.06)`,
      }}
    >
      {/* ── Blobs decorativos ── */}
      <div className="pointer-events-none absolute -top-14 -right-14 h-48 w-48 rounded-full blur-[70px]"
           style={{ background: `${pal.glow1}20` }} />
      <div className="pointer-events-none absolute -bottom-10 -left-10 h-36 w-36 rounded-full blur-[55px]"
           style={{ background: `${pal.glow2}16` }} />
      {/* Línea sutil horizontal tipo tarjeta */}
      <div className="pointer-events-none absolute top-0 left-0 right-0 h-px"
           style={{ background: `linear-gradient(90deg, transparent, ${pal.accent}40, transparent)` }} />

      {/* ── Cuerpo ── */}
      <div className="relative p-5 space-y-4">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3">
          {/* Nombre + badge */}
          <div className="flex flex-col gap-2">
            <span
              className="inline-flex items-center gap-1.5 self-start px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.14em]"
              style={{
                background:   pal.badge,
                color:        pal.badgeText,
                border:       `1px solid ${pal.badgeBorder}`,
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: pal.badgeText }} />
              {pal.label}
            </span>

            <h3
              className="font-gulfs text-2xl leading-tight text-[#1A1A1A]"
              style={{ textShadow: `0 0 24px ${pal.accent}55` }}
            >
              {planName}
            </h3>
          </div>

          {/* Contador de clases */}
          {!isUnlimited && classesRemaining !== null && classLimit !== null && !hasStampIcons ? (
            <div
              className="shrink-0 flex flex-col items-center justify-center rounded-2xl px-3 py-2"
              style={{
                background: `${pal.accent}12`,
                border:     `1px solid ${pal.accent}28`,
                minWidth:   56,
              }}
            >
              <span
                className="font-gulfs text-3xl font-black leading-none"
                style={{ color: pal.accent, textShadow: `0 0 16px ${pal.accent}88` }}
              >
                {classesRemaining}
              </span>
              <span className="font-alilato text-[9px] uppercase tracking-widest text-[#1A1A1A]/40 mt-0.5 leading-tight text-center">
                de {classLimit}<br />clases
              </span>
            </div>
          ) : isUnlimited ? (
            <div
              className="shrink-0 flex items-center justify-center rounded-2xl h-14 w-14"
              style={{ background: `${pal.accent}12`, border: `1px solid ${pal.accent}28`, color: pal.accent }}
            >
              <InfinityIcon size={22} />
            </div>
          ) : null}
        </div>

        {/* ── Divider ── */}
        <div className="h-px w-full" style={{ background: pal.divider }} />

        {/* ── Sellos o barra ── */}
        {!isUnlimited && classLimit !== null && classesRemaining !== null ? (
          <div className="space-y-3">
            {classLimit <= 20 ? (
              <>
                <span className="sr-only">
                  {used} de {classLimit} clases usadas. {classesRemaining} restantes.
                </span>
                <StampGrid
                  classLimit={classLimit}
                  classesRemaining={classesRemaining}
                  category={category}
                  pal={pal}
                />
              </>
            ) : (
              /* Planes grandes (> 20): barra de progreso */
              <div className="space-y-2">
                <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(45,45,45,0.08)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width:      `${(classesRemaining / classLimit) * 100}%`,
                      background: `linear-gradient(90deg, ${pal.progressFrom}, ${pal.progressTo})`,
                      boxShadow:  `0 0 8px ${pal.progressFrom}88`,
                    }}
                  />
                </div>
                <p className="font-alilato text-[10px] text-[#1A1A1A]/30">
                  {used} de {classLimit} clases usadas
                </p>
              </div>
            )}
          </div>
        ) : isUnlimited ? (
          <div
            className="flex items-center gap-3 rounded-2xl px-4 py-3"
            style={{ background: `${pal.accent}0d`, border: `1px solid ${pal.accent}1a` }}
          >
            <InfinityIcon size={20} style={{ color: pal.accent }} />
            <div>
              <p className="font-gulfs text-base text-[#1A1A1A]">Clases ilimitadas</p>
              <p className="font-alilato text-[11px] text-[#1A1A1A]/40">Sin límite de sesiones</p>
            </div>
          </div>
        ) : null}

        {/* ── Footer: vencimiento ── */}
        {endDate && (
          <>
            <div className="h-px w-full" style={{ background: pal.divider }} />
            <div className="flex items-center gap-2">
              <CalendarDays size={12} style={{ color: pal.accent, opacity: 0.8 }} />
              <span className="font-alilato text-[11px] text-[#1A1A1A]/40">
                Vence el{" "}
                <span className="text-[#1A1A1A]/65 font-medium">
                  {format(safeParse(endDate), "d 'de' MMMM yyyy", { locale: es })}
                </span>
                {daysRemaining !== null && (
                  <span
                    className="ml-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold"
                    style={{
                      background: daysRemaining <= 5 ? "rgba(248,113,113,0.15)" : `${pal.accent}15`,
                      color:      daysRemaining <= 5 ? "#f87171" : pal.accentLight,
                    }}
                  >
                    {daysRemaining === 0 ? "vence hoy" : `${daysRemaining}d restantes`}
                  </span>
                )}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default MembershipCard;
