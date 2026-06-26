/**
 * Valiance Pilates — Email Service (Resend)
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

const FROM_EMAIL = process.env.EMAIL_FROM || "Valiance Pilates <onboarding@resend.dev>";
const SITE_URL = String(process.env.SITE_URL || process.env.APP_URL || "https://valiancepilates.com.mx").replace(/\/+$/, "");
const LOGO_URL = `${SITE_URL}/valiance-logo.png`;

// ─── Brand palette Valiance (paleta del sitio) ───────────────────────────────
const B = {
  bg:      "#FBF7F4",   // page background — cream cálido
  card:    "#FFFFFF",   // card background
  border:  "#FAE5E7",   // subtle blush border
  brown:   "#1A1A1A",   // primary accent — charcoal (CTA bg)
  green:   "#FAE5E7",   // secondary accent — blush
  dark:    "#1A1A1A",   // main text
  body:    "#404040",   // body text
  muted:   "#8C6B6F",   // mauve — muted text
  cream:   "#FDF7F8",   // nude
  sage10:  "#FAE5E7",   // very light blush for backgrounds
  amber:   "#B45309",   // warning/alert
  gold:    "#C9A96E",   // gold accent (mármol premium)
};

// ─── Base layout ──────────────────────────────────────────────────────────────
function baseLayout({ preheader = "", content = "", ctaUrl = "", ctaText = "" } = {}) {
  const ctaBlock = ctaUrl
    ? `<tr><td align="center" style="padding:28px 0 12px;">
         <a href="${ctaUrl}"
            style="display:inline-block;background:${B.brown};
                   color:#ffffff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
                   font-size:14px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;
                   text-decoration:none;border-radius:50px;padding:14px 40px;">
           ${ctaText}
         </a>
       </td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Valiance Pilates</title>
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${B.bg};">
  <!-- preheader -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    ${preheader}&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
         style="background-color:${B.bg};">
    <tr><td align="center" style="padding:40px 16px 48px;">

      <!-- Card -->
      <table role="presentation" cellpadding="0" cellspacing="0" width="560"
             style="max-width:560px;width:100%;background-color:${B.card};
                    border:1px solid ${B.border};border-radius:16px;
                    box-shadow:0 4px 24px rgba(140,107,111,0.08);">

        <!-- Top accent bar -->
        <tr><td style="height:4px;background:linear-gradient(90deg,${B.green},${B.muted});
                        border-radius:16px 16px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Logo -->
        <tr><td align="center" style="padding:32px 40px 4px;">
          <a href="${SITE_URL}" style="text-decoration:none;">
            <img src="${LOGO_URL}" alt="Valiance Pilates" width="180" height="auto"
                 style="display:block;max-width:180px;" />
          </a>
        </td></tr>

        <!-- Tagline -->
        <tr><td align="center" style="padding:0 40px 20px;">
          <p style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:10px;
                    letter-spacing:2.5px;text-transform:uppercase;color:${B.muted};margin:0;">
            Pilates Reformer &middot; Barre &middot; Bienestar
          </p>
        </td></tr>

        <!-- Content -->
        <tr><td style="padding:0 40px;">
          ${content}
        </td></tr>

        <!-- CTA -->
        ${ctaBlock}

        <!-- Divider -->
        <tr><td style="padding:16px 40px 0;">
          <hr style="border:none;border-top:1px solid ${B.border};margin:0;" />
        </td></tr>

        <!-- Footer -->
        <tr><td align="center" style="padding:20px 40px 28px;">
          <p style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;
                    color:${B.muted};margin:0;line-height:1.7;">
            © ${new Date().getFullYear()} Valiance Pilates<br>
            <a href="${SITE_URL}" style="color:${B.dark};text-decoration:none;font-weight:600;">valiancepilates.com.mx</a>
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
  return `<h1 style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:24px;
                      font-weight:700;color:${B.dark};margin:16px 0 8px;line-height:1.3;">${text}</h1>`;
}
function h2(text) {
  return `<h2 style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;
                      font-weight:700;color:${B.brown};margin:20px 0 6px;text-transform:uppercase;
                      letter-spacing:0.5px;">${text}</h2>`;
}
function p(text) {
  return `<p style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;
                     color:${B.body};line-height:1.7;margin:0 0 12px;">${text}</p>`;
}
function small(text) {
  return `<p style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;
                     color:${B.muted};line-height:1.6;margin:0 0 10px;">${text}</p>`;
}
function infoRow(label, value) {
  return `<tr>
    <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;
               color:${B.muted};padding:10px 0;border-bottom:1px solid ${B.border};">${label}</td>
    <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;
               color:${B.dark};font-weight:600;padding:10px 0 10px 12px;
               border-bottom:1px solid ${B.border};text-align:right;">${value}</td>
  </tr>`;
}
function infoTable(rows) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
                  style="margin:16px 0 20px;">
    ${rows.join("")}
  </table>`;
}
function pill(text, color) {
  return `<span style="display:inline-block;background:${color}15;border:1px solid ${color}40;
                        color:${color};border-radius:50px;font-size:11px;font-weight:700;
                        padding:4px 14px;letter-spacing:0.5px;text-transform:uppercase;">${text}</span>`;
}
function alertBox(text, type = "info") {
  const colors = {
    info:    { bg: `${B.green}40`, border: B.muted, text: B.dark },
    success: { bg: `${B.green}55`, border: B.gold,  text: B.dark },
    warning: { bg: "#FEF3C7",      border: "#F59E0B", text: "#92400E" },
    error:   { bg: "#FEF2F2",      border: "#EF4444", text: "#991B1B" },
  };
  const c = colors[type] || colors.info;
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
                  style="background:${c.bg};border-left:4px solid ${c.border};
                         border-radius:0 8px 8px 0;margin:12px 0 20px;">
    <tr><td style="padding:14px 16px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
                    font-size:14px;color:${c.text};line-height:1.6;">${text}</td></tr>
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
    ${p("Tu membresía en Valiance Pilates ha sido activada. Es momento de moverte con propósito.")}
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
  await sendEmail({ to, subject: `Tu membresía está activa — Valiance Pilates`, html });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── 2. RESERVA CONFIRMADA ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
async function sendBookingConfirmed(opts) {
  const { to, name, className, date, startTime, instructor, classesLeft, isWaitlist } = opts;

  const statusPill = isWaitlist
    ? pill("Lista de espera", B.amber)
    : pill("Confirmada", B.green);

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
    ${alertBox("Puedes cancelar hasta <strong>2 horas antes</strong> de la clase para recuperar tu crédito. Cancelaciones tardías no son reembolsables.", "warning")}
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
    ? alertBox("Tu clase fue <strong>devuelta a tu paquete</strong>. Cancelaste con más de 2 horas de anticipación.", "success")
    : alertBox("La clase <strong>no se devolvió</strong> a tu paquete. La cancelación fue con menos de 2 horas de anticipación.", "error");

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
      ? small("Recuerda: para cancelar tu reserva se tiene como mínimo 2 horas de anticipación. De no hacerlo se pierde la clase y no hay reposición.")
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
    ${p("Nueva semana, nuevas oportunidades para moverte. Estos son los horarios disponibles en Valiance Pilates.")}
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
  await sendEmail({ to, subject: `Programa tu semana — Valiance Pilates`, html });
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
      : `Tu membresía vence pronto — Valiance Pilates`,
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
    ${p("Recibimos una solicitud para cambiar la contraseña de tu cuenta en Valiance Pilates.")}
    ${p("Si fuiste tú, haz clic en el botón de abajo para crear una contraseña nueva. Este enlace expira en <strong>2 horas</strong>.")}
    ${alertBox("Si no solicitaste este cambio, puedes ignorar este correo. Tu cuenta seguirá segura.", "info")}
    ${small(`Si el botón no funciona, copia y pega este enlace en tu navegador:<br><a href="${resolvedResetUrl}" style="color:${B.brown};word-break:break-all;">${resolvedResetUrl}</a>`)}
  `;
  const html = baseLayout({
    preheader: "Recupera el acceso a tu cuenta de Valiance Pilates",
    content,
    ctaUrl: resolvedResetUrl,
    ctaText: "Restablecer contraseña",
  });
  await sendEmail({ to, subject: "Restablecer contraseña — Valiance Pilates", html });
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
    preheader: "Tu comprobante de pago fue revisado — Valiance Pilates",
    content,
    ctaUrl: `${SITE_URL}/app/checkout`,
    ctaText: "Reintentar pago",
  });
  await sendEmail({ to, subject: "Comprobante no aprobado — Valiance Pilates", html });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── 8. BIENVENIDA + CREDENCIALES TEMPORALES (alta manual por admin) ──────────
// ═══════════════════════════════════════════════════════════════════════════════
async function sendClientWelcomeWithCredentials(opts) {
  const { to, name, email, tempPassword, planName } = opts;
  const firstName = String(name || "").trim().split(/\s+/)[0] || "Bienvenida";
  const credBox = `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="background:${B.green}40;border:1px solid ${B.border};border-radius:12px;margin:18px 0;">
      <tr><td style="padding:18px 20px;">
        <p style="margin:0 0 6px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;
                  color:${B.muted};letter-spacing:1.5px;text-transform:uppercase;font-weight:700;">Tus credenciales</p>
        <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;color:${B.muted};">Usuario</p>
        <p style="margin:0 0 10px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;color:${B.dark};font-weight:600;word-break:break-all;">${email}</p>
        <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;color:${B.muted};">Contraseña temporal</p>
        <p style="margin:0;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:16px;color:${B.dark};font-weight:700;letter-spacing:1px;">${tempPassword}</p>
      </td></tr>
    </table>
  `;
  const planLine = planName ? p(`Tu plan <strong>${planName}</strong> ya está activo.`) : "";
  const content = `
    ${h1(`Bienvenida a Valiance Pilates, ${firstName}`)}
    ${p("Creamos tu cuenta para que puedas reservar clases, ver tu membresía y consultar tus pagos desde la app.")}
    ${planLine}
    ${credBox}
    ${alertBox("Te recomendamos cambiar tu contraseña al iniciar sesión por primera vez.", "info")}
    ${small(`Si tienes dudas, escríbenos por WhatsApp o responde a este correo. Estamos para apoyarte.`)}
  `;
  const html = baseLayout({
    preheader: "Tus credenciales para acceder a Valiance Pilates",
    content,
    ctaUrl: `${SITE_URL}/auth/login`,
    ctaText: "Iniciar sesión",
  });
  await sendEmail({ to, subject: "Tu cuenta en Valiance Pilates está lista", html });
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
};
