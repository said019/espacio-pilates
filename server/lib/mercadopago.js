// Cliente de MercadoPago (Checkout Pro). Sin SDK — fetch contra la API REST.
import crypto from "crypto";

const MP_API = "https://api.mercadopago.com";

function stripTrailingSlash(u) {
  return String(u || "").replace(/\/+$/, "");
}

// ── Body de la preferencia (puro, testeable sin red) ──
export function buildPreferenceBody({ orderId, orderNumber, planName, amount, userEmail }, { backendUrl, frontendUrl }) {
  return {
    items: [{
      id: orderId,
      title: planName,
      description: `Tu Espacio Pilates — ${planName}`,
      quantity: 1,
      currency_id: "MXN",
      unit_price: Number(amount),
    }],
    payer: { email: userEmail || undefined },
    external_reference: orderId,
    back_urls: {
      success: `${frontendUrl}/app/orders?checkout=success&order=${orderId}`,
      failure: `${frontendUrl}/app/orders?checkout=failure&order=${orderId}`,
      pending: `${frontendUrl}/app/orders?checkout=pending&order=${orderId}`,
    },
    auto_return: "approved",
    notification_url: `${backendUrl}/webhooks/mercadopago`,
    statement_descriptor: "ESPACIO PILATES",
    metadata: { order_id: orderId, order_number: orderNumber },
    payment_methods: { installments: 1 },
  };
}

// ── Crear preferencia de Checkout Pro ──
export async function createPreference(params) {
  const accessToken = process.env.MP_ACCESS_TOKEN || "";
  if (!accessToken) throw new Error("MP_ACCESS_TOKEN no configurado");
  const backendUrl = stripTrailingSlash(process.env.BACKEND_URL);
  const frontendUrl = stripTrailingSlash(process.env.FRONTEND_URL || process.env.SITE_URL || "https://www.tuespaciopilates.com.mx");
  const body = buildPreferenceBody(params, { backendUrl, frontendUrl });

  const res = await fetch(`${MP_API}/checkout/preferences`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": `order-${params.orderId}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MercadoPago preference error: ${res.status} — ${err}`);
  }
  const data = await res.json();
  return {
    preference_id: data.id,
    checkout_url: data.init_point,
    sandbox_checkout_url: data.sandbox_init_point,
  };
}

// ── Body del pago con tarjeta (Checkout API / Brick) — puro, testeable ──
// El monto SIEMPRE viene del servidor; installments se fuerza a 1 (contado).
export function buildCardPaymentBody({ orderId, orderNumber, planName, amount, token, paymentMethodId, issuerId, payer }, { backendUrl }) {
  return {
    transaction_amount: Number(amount),
    token,
    description: `Tu Espacio Pilates — ${planName}`,
    installments: 1,
    payment_method_id: paymentMethodId,
    issuer_id: issuerId || undefined,
    external_reference: orderId,
    notification_url: `${backendUrl}/webhooks/mercadopago`,
    statement_descriptor: "ESPACIO PILATES",
    metadata: { order_id: orderId, order_number: orderNumber },
    payer: {
      email: payer?.email || undefined,
      identification: payer?.identification || undefined,
    },
  };
}

// ── Crear pago con tarjeta tokenizada (respuesta síncrona de MP) ──
export async function createCardPayment(params) {
  const accessToken = process.env.MP_ACCESS_TOKEN || "";
  if (!accessToken) throw new Error("MP_ACCESS_TOKEN no configurado");
  const backendUrl = stripTrailingSlash(process.env.BACKEND_URL);
  const body = buildCardPaymentBody(params, { backendUrl });

  const res = await fetch(`${MP_API}/v1/payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      // Evita doble cargo del MISMO token; un reintento usa token nuevo.
      "X-Idempotency-Key": `paytoken-${String(params.token).slice(0, 24)}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MercadoPago payment error: ${res.status} — ${err}`);
  }
  const data = await res.json();
  return {
    id: data.id,
    status: data.status,
    status_detail: data.status_detail,
    external_reference: data.external_reference,
  };
}

// ── Consultar estado real de un pago ──
export async function syncPayment(mpPaymentId) {
  const accessToken = process.env.MP_ACCESS_TOKEN || "";
  if (!accessToken) throw new Error("MP_ACCESS_TOKEN no configurado");
  const res = await fetch(`${MP_API}/v1/payments/${mpPaymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MercadoPago sync error: ${res.status} — ${err}`);
  }
  const data = await res.json();
  return {
    status: data.status,
    status_detail: data.status_detail,
    external_reference: data.external_reference,
    transaction_amount: data.transaction_amount,
    payer_email: data.payer?.email || "",
  };
}

// ── Verificación de firma del webhook ──
export function parseSignatureHeader(header) {
  const parts = {};
  String(header || "").split(",").forEach((p) => {
    const idx = p.indexOf("=");
    if (idx === -1) return;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (k && v) parts[k] = v;
  });
  return parts;
}

export function buildSignatureManifest({ dataId, requestId, ts }) {
  return `id:${dataId};request-id:${requestId};ts:${ts};`;
}

export function verifyWebhookSignature({ signatureHeader, requestId, dataId, secret }) {
  if (!secret) return true; // legacy: sin secret se omite
  if (!signatureHeader) return false;
  const { ts, v1 } = parseSignatureHeader(signatureHeader);
  if (!ts || !v1) return false;
  const manifest = buildSignatureManifest({ dataId, requestId, ts });
  const computed = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  const a = Buffer.from(computed);
  const b = Buffer.from(v1);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
