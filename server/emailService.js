/**
 * Tu Espacio Pilates — Email Service (Resend)
 * Branded HTML templates matching the studio's visual identity.
 */

let resend = null;
if (process.env.RESEND_API_KEY) {
  try {
    const { Resend } = await import("resend");
    resend = new Resend(process.env.RESEND_API_KEY);
  } catch (err) {
    console.warn("[Email] Not setting up Resend. Package missing or invalid key.");
  }
}

const FROM_EMAIL = process.env.EMAIL_FROM || "Tu Espacio Pilates <onboarding@resend.dev>";
const SITE_URL = String(process.env.SITE_URL || process.env.APP_URL || "https://www.tuespaciopilates.com.mx").replace(/\/+$/, "");
const LOGO_URL = `${SITE_URL}/tep-mark-ink.png`;

import { buildReceiptModel } from "./lib/receipt.js";

// ─── Brand palette Tu Espacio Pilates VM (paleta del sitio) ──────────────────
const B = {
  bg:      "#FBF6F4",   // page background — nude cálido
  card:    "#FFFFFF",   // card background
  border:  "#E8D3CE",   // subtle blush border
  brown:   "#1A1A1A",   // primary accent — tinta (CTA bg)
  green:   "#E8D3CE",   // secondary accent — soft blush
  dark:    "#1A1A1A",   // main text
  body:    "#404040",   // body text
  muted:   "#8C6B6F",   // mauve — muted text
  cream:   "#FBF6F4",   // nude
  sage10:  "#F3E7E3",   // light blush for backgrounds
  amber:   "#B45309",   // warning/alert
  gold:    "#B8915A",   // gold accent (cálido premium) — signature hairline
  blush:   "#C9ADA3",   // blush accent
  mauve:   "#8C6B6F",   // mauve
};

// ─── Editorial type stacks ─────────────────────────────────────────────────────
const SERIF = "Georgia,'Cormorant Garamond','Times New Roman',serif";
const SANS  = "'Helvetica Neue',Helvetica,Arial,sans-serif";

// ─── Base layout ──────────────────────────────────────────────────────────────
function baseLayout({ preheader = "", content = "", ctaUrl = "", ctaText = "" } = {}) {
  const ctaBlock = ctaUrl
    ? `<tr><td align="center" style="padding:36px 0 8px;">
         <a href="${ctaUrl}"
            style="display:inline-block;background:${B.brown};
                   color:${B.cream};font-family:${SANS};
                   font-size:13px;font-weight:500;letter-spacing:1.5px;text-transform:uppercase;
                   text-decoration:none;border-radius:40px;padding:16px 44px;">
           ${ctaText}
         </a>
       </td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Tu Espacio Pilates</title>
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${B.bg};">
  <!-- preheader -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    ${preheader}&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
         style="background-color:${B.bg};">
    <tr><td align="center" style="padding:48px 16px 56px;">

      <!-- Card -->
      <table role="presentation" cellpadding="0" cellspacing="0" width="560"
             style="max-width:560px;width:100%;background-color:${B.card};
                    border:1px solid ${B.border};border-radius:6px;
                    box-shadow:0 6px 30px rgba(140,107,111,0.07);">

        <!-- Logo (ink seal on transparent) -->
        <tr><td align="center" style="padding:48px 48px 0;">
          <a href="${SITE_URL}" style="text-decoration:none;">
            <img src="${LOGO_URL}" alt="Tu Espacio Pilates" width="132" height="auto"
                 style="display:block;width:132px;max-width:132px;height:auto;" />
          </a>
        </td></tr>

        <!-- Tagline -->
        <tr><td align="center" style="padding:18px 48px 6px;">
          <p style="font-family:${SANS};font-size:10px;
                    letter-spacing:3px;text-transform:uppercase;color:${B.muted};margin:0;">
            Pilates &middot; Villa Magna
          </p>
        </td></tr>

        <!-- Gold hairline (signature accent) -->
        <tr><td align="center" style="padding:18px 48px 6px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:48px;height:1px;background:${B.gold};font-size:0;line-height:0;">&nbsp;</td>
          </tr></table>
        </td></tr>

        <!-- Content -->
        <tr><td style="padding:8px 48px 0;">
          ${content}
        </td></tr>

        <!-- CTA -->
        ${ctaBlock}

        <!-- Divider -->
        <tr><td style="padding:28px 48px 0;">
          <hr style="border:none;border-top:1px solid ${B.border};margin:0;" />
        </td></tr>

        <!-- Footer -->
        <tr><td align="center" style="padding:24px 48px 40px;">
          <p style="font-family:${SANS};font-size:11px;
                    color:${B.muted};margin:0 0 8px;line-height:1.8;letter-spacing:0.3px;">
            Tu Espacio Pilates &middot; Villa Magna
          </p>
          <p style="font-family:${SANS};font-size:11px;
                    color:${B.muted};margin:0;line-height:1.8;letter-spacing:0.3px;">
            <a href="https://www.instagram.com/_espaciopilatesvm/" style="color:${B.dark};text-decoration:none;">@_espaciopilatesvm</a>
            &nbsp;&middot;&nbsp; &copy; ${new Date().getFullYear()}
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function h1(text) {
  return `<h1 style="font-family:${SERIF};font-size:28px;
                      font-weight:400;color:${B.dark};margin:20px 0 12px;line-height:1.25;
                      letter-spacing:-0.2px;">${text}</h1>`;
}
function h2(text) {
  return `<h2 style="font-family:${SANS};font-size:11px;
                      font-weight:600;color:${B.gold};margin:26px 0 8px;text-transform:uppercase;
                      letter-spacing:2px;">${text}</h2>`;
}
function p(text) {
  return `<p style="font-family:${SANS};font-size:15px;
                     color:${B.body};line-height:1.75;margin:0 0 14px;">${text}</p>`;
}
function small(text) {
  return `<p style="font-family:${SANS};font-size:13px;
                     color:${B.muted};line-height:1.65;margin:0 0 10px;">${text}</p>`;
}
function infoRow(label, value) {
  return `<tr>
    <td style="font-family:${SANS};font-size:11px;
               color:${B.muted};padding:13px 0;border-bottom:1px solid ${B.border};
               letter-spacing:1.2px;text-transform:uppercase;">${label}</td>
    <td style="font-family:${SERIF};font-size:16px;
               color:${B.dark};font-weight:400;padding:13px 0 13px 12px;
               border-bottom:1px solid ${B.border};text-align:right;">${value}</td>
  </tr>`;
}
function infoTable(rows) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
                  style="margin:22px 0 24px;border-top:1px solid ${B.border};">
    ${rows.join("")}
  </table>`;
}
function pill(text, color) {
  return `<span style="display:inline-block;background:${color}1A;border:1px solid ${color}55;
                        color:${color};border-radius:40px;font-size:10px;font-weight:600;
                        padding:6px 16px;letter-spacing:1.5px;text-transform:uppercase;">${text}</span>`;
}
function alertBox(text, type = "info") {
  const colors = {
    info:    { bg: B.sage10,  border: B.blush, text: B.dark },
    success: { bg: B.sage10,  border: B.gold,  text: B.dark },
    warning: { bg: "#FBF1E6", border: B.gold,  text: "#6B4E2E" },
    error:   { bg: "#FBEDED", border: "#C0726F", text: "#7A3B39" },
  };
  const c = colors[type] || colors.info;
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
                  style="background:${c.bg};border-left:2px solid ${c.border};
                         border-radius:0 4px 4px 0;margin:18px 0 20px;">
    <tr><td style="padding:16px 20px;font-family:${SANS};
                    font-size:14px;color:${c.text};line-height:1.65;">${text}</td></tr>
  </table>`;
}

// ─── Format helpers ───────────────────────────────────────────────────────────
function fmtDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("es-MX", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
function fmtTime(timeStr) {
  if (!timeStr) return "—";
  const t = String(timeStr).slice(0, 5);
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${suffix}`;
}

// ─── Core send function ───────────────────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  if (!resend) {
    console.log(`[Email] RESEND_API_KEY not set — skipping email to ${to} (${subject})`);
    return;
  }
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    });
    if (error) console.error("[Email] Resend error:", error);
    else console.log(`[Email] Sent "${subject}" → ${to} (id: ${data?.id})`);
  } catch (err) {
    console.error("[Email] Exception sending email:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── 1. MEMBRESÍA ACTIVADA ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
async function sendMembershipActivated(opts) {
  const { to, name, planName, startDate, endDate, classLimit } = opts;
  const classesText = classLimit ? `${classLimit} clases` : "Ilimitadas";
  const content = `
    ${h1(`¡Bienvenida, ${name.split(" ")[0]}!`)}
    ${p("Tu membresía en Tu Espacio Pilates ha sido activada. Es momento de moverte con propósito.")}
    ${infoTable([
      infoRow("Plan", planName),
      infoRow("Clases incluidas", classesText),
      infoRow("Inicio", fmtDate(startDate)),
      infoRow("Vencimiento", fmtDate(endDate)),
    ])}
    ${alertBox("Reserva tus clases desde tu perfil y empieza a disfrutar del estudio.", "success")}
  `;
  const html = baseLayout({
    preheader: `Tu membresía ${planName} está activa. ¡Reserva tus clases!`,
    content,
    ctaUrl: `${SITE_URL}/app/classes`,
    ctaText: "Reservar clases",
  });
  await sendEmail({ to, subject: `Tu membresía está activa — Tu Espacio Pilates`, html });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── 2. RESERVA CONFIRMADA ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
async function sendBookingConfirmed(opts) {
  const { to, name, className, date, startTime, instructor, classesLeft, isWaitlist } = opts;

  const statusPill = isWaitlist
    ? pill("Lista de espera", B.amber)
    : pill("Confirmada", B.gold);

  const classesLeftText = classesLeft === null
    ? "Ilimitadas"
    : classesLeft !== undefined
      ? `${classesLeft} clases restantes`
      : null;

  const waitlistNote = isWaitlist
    ? alertBox("Estás en la <strong>lista de espera</strong>. Te notificaremos si se libera un lugar.", "warning")
    : "";

  const content = `
    ${h1(isWaitlist ? `En lista de espera, ${name.split(" ")[0]}` : `Reserva confirmada, ${name.split(" ")[0]}`)}
    ${p(isWaitlist
      ? "Te hemos añadido a la lista de espera para la siguiente clase:"
      : "Tu clase ha sido reservada con éxito. ¡Te esperamos en el estudio!"
    )}
    <div style="text-align:center;margin:8px 0 16px;">${statusPill}</div>
    ${infoTable([
      infoRow("Clase", className),
      infoRow("Fecha", fmtDate(date)),
      infoRow("Hora", fmtTime(startTime)),
      ...(instructor ? [infoRow("Instructora", instructor)] : []),
      ...(classesLeftText ? [infoRow("Tu paquete", classesLeftText)] : []),
    ])}
    ${waitlistNote}
    ${alertBox("Puedes cancelar con <strong>12 horas</strong> de anticipación para recuperar tu crédito. Entre 12 y 3 horas antes puedes reagendar (el crédito ya no se reembolsa). Con menos de 3 horas se pierde la clase.", "warning")}
  `;
  const html = baseLayout({
    preheader: isWaitlist ? `En lista de espera para ${className}` : `Reserva confirmada: ${className} — ${fmtDate(date)}`,
    content,
    ctaUrl: `${SITE_URL}/app/bookings`,
    ctaText: "Ver mis reservas",
  });
  await sendEmail({ to, subject: isWaitlist ? `En lista de espera — ${className}` : `Reserva confirmada — ${className}`, html });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── 3. RESERVA CANCELADA ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
async function sendBookingCancelled(opts) {
  const { to, name, className, date, startTime, creditRestored, isLate, classesLeft } = opts;

  const classesLeftText = classesLeft === null ? "Ilimitadas" : classesLeft !== undefined ? `${classesLeft} clases` : null;

  const creditBlock = creditRestored
    ? alertBox("Tu clase fue <strong>devuelta a tu paquete</strong>. Cancelaste con más de 12 horas de anticipación.", "success")
    : alertBox("La clase <strong>no se devolvió</strong> a tu paquete. La cancelación fue con menos de 12 horas de anticipación.", "error");

  const content = `
    ${h1(`Reserva cancelada, ${name.split(" ")[0]}`)}
    ${p("Tu reserva para la siguiente clase ha sido cancelada:")}
    ${infoTable([
      infoRow("Clase", className),
      infoRow("Fecha", fmtDate(date)),
      infoRow("Hora", fmtTime(startTime)),
      ...(classesLeftText ? [infoRow("Clases restantes", classesLeftText)] : []),
    ])}
    ${creditBlock}
    ${isLate
      ? small("Recuerda: para recuperar el crédito debes cancelar con al menos 12 horas. Después puedes reagendar hasta 3 horas antes; con menos tiempo se pierde la clase.")
      : p("¿Quieres reservar otra clase? Hay muchos horarios disponibles.")
    }
  `;
  const html = baseLayout({
    preheader: creditRestored ? "Clase devuelta a tu paquete." : "Cancelación tardía — clase no devuelta.",
    content,
    ctaUrl: `${SITE_URL}/app/classes`,
    ctaText: "Ver horario",
  });
  await sendEmail({ to, subject: `Reserva cancelada — ${className}`, html });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── 4. RECORDATORIO SEMANAL ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
async function sendWeeklyReminder(opts) {
  const { to, name, classesLeft, endDate } = opts;

  const classesText = classesLeft === null
    ? "Tienes clases <strong>ilimitadas</strong> esta semana."
    : `Tienes <strong>${classesLeft} clase${classesLeft !== 1 ? "s" : ""}</strong> disponible${classesLeft !== 1 ? "s" : ""} en tu paquete.`;

  const expiryNote = endDate
    ? alertBox(`Tu membresía vence el <strong>${fmtDate(endDate)}</strong>. ¡Aprovecha tus clases!`, "warning")
    : "";

  const content = `
    ${h1(`¡Hola ${name.split(" ")[0]}! ¿Ya programaste tu semana?`)}
    ${p("Nueva semana, nuevas oportunidades para moverte. Estos son los horarios disponibles en Tu Espacio Pilates.")}
    ${p(classesText)}
    ${expiryNote}
    ${h2("Tu cuerpo te lo agradece")}
    ${p("Pilates <strong>fortalece tu core</strong>, mejora tu postura y eleva tu bienestar. ¡Cada clase cuenta!")}
  `;
  const html = baseLayout({
    preheader: `Nueva semana — ${classesLeft === null ? "clases ilimitadas" : `${classesLeft} clases disponibles`}.`,
    content,
    ctaUrl: `${SITE_URL}/app/classes`,
    ctaText: "Programar mi semana",
  });
  await sendEmail({ to, subject: `Programa tu semana — Tu Espacio Pilates`, html });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── 5. RECORDATORIO DE RENOVACIÓN ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
async function sendRenewalReminder(opts) {
  const { to, name, planName, classesLeft, endDate, reason } = opts;

  const isLastClass = reason === "last_class";

  const urgencyBlock = isLastClass
    ? alertBox(`Te queda <strong>1 sola clase</strong> en tu paquete ${planName}. ¡Renueva antes de quedarte sin acceso!`, "warning")
    : alertBox(`Tu membresía <strong>${planName}</strong> vence el <strong>${fmtDate(endDate)}</strong>. ¡Renueva para seguir entrenando!`, "warning");

  const content = `
    ${h1(`${name.split(" ")[0]}, es momento de renovar`)}
    ${urgencyBlock}
    ${p("Mantener tu constancia es la clave del progreso. No dejes que tu entrenamiento se detenga.")}
    ${infoTable([
      infoRow("Plan actual", planName),
      ...(classesLeft !== null ? [infoRow("Clases restantes", `${classesLeft}`)] : []),
      ...(endDate ? [infoRow("Vencimiento", fmtDate(endDate))] : []),
    ])}
    ${p(isLastClass
      ? "Reserva esa última clase hoy y renueva tu paquete para seguir sin interrupciones."
      : "Renueva antes del vencimiento para mantener tu ritmo en el estudio."
    )}
  `;
  const html = baseLayout({
    preheader: isLastClass ? "¡Solo te queda 1 clase! Renueva tu paquete." : "Tu membresía vence pronto — renueva ahora.",
    content,
    ctaUrl: `${SITE_URL}/app/checkout`,
    ctaText: "Renovar membresía",
  });
  await sendEmail({
    to,
    subject: isLastClass
      ? `Te queda 1 clase — Renueva tu membresía`
      : `Tu membresía vence pronto — Tu Espacio Pilates`,
    html,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── 6. RECUPERACIÓN DE CONTRASEÑA ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
async function sendPasswordResetEmail(opts) {
  const { to, name, token, resetUrl } = opts;
  const firstName = String(name || "").trim().split(/\s+/)[0] || "Alumna";
  const resolvedResetUrl = String(
    resetUrl || `${SITE_URL}/auth/reset-password?token=${encodeURIComponent(token)}`,
  );
  const content = `
    ${h1(`Recupera tu contraseña, ${firstName}`)}
    ${p("Recibimos una solicitud para cambiar la contraseña de tu cuenta en Tu Espacio Pilates.")}
    ${p("Si fuiste tú, haz clic en el botón de abajo para crear una contraseña nueva. Este enlace expira en <strong>2 horas</strong>.")}
    ${alertBox("Si no solicitaste este cambio, puedes ignorar este correo. Tu cuenta seguirá segura.", "info")}
    ${small(`Si el botón no funciona, copia y pega este enlace en tu navegador:<br><a href="${resolvedResetUrl}" style="color:${B.brown};word-break:break-all;">${resolvedResetUrl}</a>`)}
  `;
  const html = baseLayout({
    preheader: "Recupera el acceso a tu cuenta de Tu Espacio Pilates",
    content,
    ctaUrl: resolvedResetUrl,
    ctaText: "Restablecer contraseña",
  });
  await sendEmail({ to, subject: "Restablecer contraseña — Tu Espacio Pilates", html });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── 7. RECHAZO DE COMPROBANTE ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
async function sendOrderRejected(opts) {
  const { to, name, reason } = opts;
  const content = `
    ${h1(`Comprobante no aprobado`)}
    ${p(`Hola ${name.split(" ")[0]}, revisamos tu comprobante de pago y lamentablemente <strong>no pudo ser aprobado</strong>.`)}
    ${alertBox(`<strong>Motivo:</strong> ${reason}`, "error")}
    ${p("Si crees que hubo un error, contáctanos por WhatsApp o acércate al estudio. ¡Estamos para ayudarte!")}
  `;
  const html = baseLayout({
    preheader: "Tu comprobante de pago fue revisado — Tu Espacio Pilates",
    content,
    ctaUrl: `${SITE_URL}/app/checkout`,
    ctaText: "Reintentar pago",
  });
  await sendEmail({ to, subject: "Comprobante no aprobado — Tu Espacio Pilates", html });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── 8. BIENVENIDA + CREDENCIALES TEMPORALES (alta manual por admin) ──────────
// ═══════════════════════════════════════════════════════════════════════════════
async function sendClientWelcomeWithCredentials(opts) {
  const { to, name, email, tempPassword, planName } = opts;
  const firstName = String(name || "").trim().split(/\s+/)[0] || "Bienvenida";
  const credBox = `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="background:${B.sage10};border:1px solid ${B.border};border-radius:6px;margin:22px 0;">
      <tr><td style="padding:24px 24px;">
        <p style="margin:0 0 14px;font-family:${SANS};font-size:10px;
                  color:${B.gold};letter-spacing:2px;text-transform:uppercase;font-weight:600;">Tus credenciales</p>
        <p style="margin:0 0 3px;font-family:${SANS};font-size:11px;color:${B.muted};letter-spacing:1px;text-transform:uppercase;">Usuario</p>
        <p style="margin:0 0 16px;font-family:${SERIF};font-size:17px;color:${B.dark};font-weight:400;word-break:break-all;">${email}</p>
        <p style="margin:0 0 3px;font-family:${SANS};font-size:11px;color:${B.muted};letter-spacing:1px;text-transform:uppercase;">Contraseña temporal</p>
        <p style="margin:0;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:17px;color:${B.dark};font-weight:700;letter-spacing:1px;">${tempPassword}</p>
      </td></tr>
    </table>
  `;
  const planLine = planName ? p(`Tu plan <strong>${planName}</strong> ya está activo.`) : "";
  const content = `
    ${h1(`Bienvenida a Tu Espacio Pilates, ${firstName}`)}
    ${p("Creamos tu cuenta para que puedas reservar clases, ver tu membresía y consultar tus pagos desde la app.")}
    ${planLine}
    ${credBox}
    ${alertBox("Te recomendamos cambiar tu contraseña al iniciar sesión por primera vez.", "info")}
    ${small(`Si tienes dudas, escríbenos por WhatsApp o responde a este correo. Estamos para apoyarte.`)}
  `;
  const html = baseLayout({
    preheader: "Tus credenciales para acceder a Tu Espacio Pilates",
    content,
    ctaUrl: `${SITE_URL}/auth/login`,
    ctaText: "Iniciar sesión",
  });
  await sendEmail({ to, subject: "Tu cuenta en Tu Espacio Pilates está lista", html });
}

// ─── Preview helper (dev only — renders HTML with the real layout/helpers) ─────
function __renderPreview(kind) {
  if (kind === "booking") {
    const opts = {
      name: "María Fernanda López",
      className: "Reformer Flow",
      date: "2026-07-02",
      startTime: "09:30",
      instructor: "Ana Sofía",
      classesLeft: 6,
      isWaitlist: false,
    };
    const statusPill = pill("Confirmada", B.gold);
    const content = `
      ${h1(`Reserva confirmada, ${opts.name.split(" ")[0]}`)}
      ${p("Tu clase ha sido reservada con éxito. ¡Te esperamos en el estudio!")}
      <div style="text-align:center;margin:8px 0 16px;">${statusPill}</div>
      ${infoTable([
        infoRow("Clase", opts.className),
        infoRow("Fecha", fmtDate(opts.date)),
        infoRow("Hora", fmtTime(opts.startTime)),
        infoRow("Instructora", opts.instructor),
        infoRow("Tu paquete", `${opts.classesLeft} clases restantes`),
      ])}
      ${alertBox("Puedes cancelar con <strong>12 horas</strong> de anticipación para recuperar tu crédito. Entre 12 y 3 horas antes puedes reagendar (el crédito ya no se reembolsa). Con menos de 3 horas se pierde la clase.", "warning")}
    `;
    return baseLayout({
      preheader: `Reserva confirmada: ${opts.className} — ${fmtDate(opts.date)}`,
      content,
      ctaUrl: `${SITE_URL}/app/bookings`,
      ctaText: "Ver mis reservas",
    });
  }
  if (kind === "membership") {
    const opts = {
      name: "María Fernanda López",
      planName: "Mensual Ilimitado",
      startDate: "2026-06-27",
      endDate: "2026-07-27",
      classLimit: null,
    };
    const classesText = opts.classLimit ? `${opts.classLimit} clases` : "Ilimitadas";
    const content = `
      ${h1(`¡Bienvenida, ${opts.name.split(" ")[0]}!`)}
      ${p("Tu membresía en Tu Espacio Pilates ha sido activada. Es momento de moverte con propósito.")}
      ${infoTable([
        infoRow("Plan", opts.planName),
        infoRow("Clases incluidas", classesText),
        infoRow("Inicio", fmtDate(opts.startDate)),
        infoRow("Vencimiento", fmtDate(opts.endDate)),
      ])}
      ${alertBox("Reserva tus clases desde tu perfil y empieza a disfrutar del estudio.", "success")}
    `;
    return baseLayout({
      preheader: `Tu membresía ${opts.planName} está activa. ¡Reserva tus clases!`,
      content,
      ctaUrl: `${SITE_URL}/app/classes`,
      ctaText: "Reservar clases",
    });
  }
  return "";
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── COMPROBANTE DE PAGO (constancia informal, NO CFDI) ───────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function sendPaymentReceipt(opts) {
  const { to, name } = opts;
  const m = buildReceiptModel(opts);
  const fmtMoney = (n) => `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;
  const lineRows = m.lines.map((l) =>
    infoRow(`${l.planName}${l.quantity > 1 ? ` × ${l.quantity}` : ""}`, fmtMoney(l.amount))
  );
  const breakdownRows = m.breakdown.map((b) =>
    infoRow(b.label, `${b.negative ? "−" : ""}${fmtMoney(b.amount)}`)
  );
  const content = `
    ${h1("Comprobante de pago")}
    ${p(`Hola ${String(name || "Alumna").split(" ")[0]}, gracias por tu pago. Aquí tienes tu comprobante.`)}
    ${infoTable([
      infoRow("Folio", m.orderNumber || "—"),
      infoRow("Fecha de pago", fmtDate(m.paidAt)),
      infoRow("Método de pago", m.methodLabel),
    ])}
    ${infoTable([...lineRows, ...breakdownRows, infoRow("Total pagado", fmtMoney(m.total))])}
    ${small(m.note)}
  `;
  const html = baseLayout({
    preheader: `Comprobante de pago ${m.orderNumber || ""} — Tu Espacio Pilates`.trim(),
    content,
    ctaUrl: `${SITE_URL}/app/orders`,
    ctaText: "Ver mis órdenes",
  });
  await sendEmail({ to, subject: `Comprobante de pago ${m.orderNumber || ""} — Tu Espacio Pilates`.replace("  ", " "), html });
}

// ─── Exports ──────────────────────────────────────────────────────────────────
export {
  sendMembershipActivated,
  sendBookingConfirmed,
  sendBookingCancelled,
  sendWeeklyReminder,
  sendRenewalReminder,
  sendPasswordResetEmail,
  sendOrderRejected,
  sendClientWelcomeWithCredentials,
  sendPaymentReceipt,
  __renderPreview,
};
