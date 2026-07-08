// Web Push (notificaciones de navegador) — capa pura y testeable.
// El envío real a una suscripción vive aquí; el acceso a BD, el fan-out por
// usuario y la poda viven en server/index.js.
import webpush from "web-push";

export function isPushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

// Configura VAPID (idempotente, sin estado). Devuelve false si faltan llaves.
export function ensureVapidConfigured() {
  if (!isPushConfigured()) return false;
  const subject = process.env.VAPID_SUBJECT || "mailto:espaciopilatesvm@gmail.com";
  webpush.setVapidDetails(subject, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  return true;
}

export function buildPushPayload({ title, body, url = "/", tag } = {}) {
  return JSON.stringify({
    title: String(title || "Tu Espacio Pilates"),
    body: String(body || ""),
    url: String(url || "/"),
    ...(tag ? { tag: String(tag) } : {}),
  });
}

// 404 = endpoint inexistente, 410 = suscripción expirada/cancelada → podar.
export function shouldPruneSubscription(error) {
  const code = error?.statusCode;
  return code === 404 || code === 410;
}

// Envía a UNA suscripción. Lanza el error de web-push (con statusCode) si falla,
// para que el caller decida podar o reintentar.
export async function sendWebPush(subscription, payload) {
  if (!isPushConfigured()) return { sent: false, reason: "not_configured" };
  ensureVapidConfigured();
  await webpush.sendNotification(subscription, payload);
  return { sent: true };
}

// Mensajes fijos para push del lado admin — no pasan por notification_templates
// (ese sistema es editable desde Configuración y es solo para clientas).
// server/index.js decide desde dónde y cuándo llamarlos.
export function buildAdminSaleMessage({ clientName, planName }) {
  return {
    title: "🎉 Nueva venta",
    body: `${clientName} compró ${planName}`,
  };
}

export function buildAdminPendingMessage({ clientName, reason }) {
  const body = reason === "cash"
    ? `${clientName} eligió pagar en efectivo — pendiente de confirmar`
    : `${clientName} subió su comprobante — pendiente de revisar`;
  return { title: "📋 Pendiente por revisar", body };
}
