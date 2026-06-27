import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildPreferenceBody,
  createPreference,
  syncPayment,
  parseSignatureHeader,
  buildSignatureManifest,
  verifyWebhookSignature,
} from "../mercadopago.js";
import crypto from "crypto";

describe("buildPreferenceBody", () => {
  const params = { orderId: "ord-1", orderNumber: "ORD-001000", planName: "9 clases", amount: 1050, userEmail: "a@b.com" };
  const urls = { backendUrl: "https://api.test", frontendUrl: "https://app.test" };

  it("arma item con precio, MXN y external_reference", () => {
    const body = buildPreferenceBody(params, urls);
    expect(body.items[0].unit_price).toBe(1050);
    expect(body.items[0].currency_id).toBe("MXN");
    expect(body.external_reference).toBe("ord-1");
  });

  it("cobra de contado (installments 1)", () => {
    expect(buildPreferenceBody(params, urls).payment_methods.installments).toBe(1);
  });

  it("back_urls apuntan al frontend con order id; notification_url al backend", () => {
    const body = buildPreferenceBody(params, urls);
    expect(body.back_urls.success).toBe("https://app.test/app/orders?checkout=success&order=ord-1");
    expect(body.notification_url).toBe("https://api.test/webhooks/mercadopago");
    expect(body.auto_return).toBe("approved");
  });
});

describe("createPreference", () => {
  beforeEach(() => {
    process.env.MP_ACCESS_TOKEN = "APP_USR-test";
    process.env.BACKEND_URL = "https://api.test/";
    process.env.FRONTEND_URL = "https://app.test/";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("mapea init_point/sandbox_init_point/id de la respuesta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: "pref-9", init_point: "https://mp/checkout", sandbox_init_point: "https://mp/sandbox" }),
    })));
    const r = await createPreference({ orderId: "ord-1", orderNumber: "ORD-1", planName: "P", amount: 100, userEmail: "a@b.com" });
    expect(r).toEqual({ preference_id: "pref-9", checkout_url: "https://mp/checkout", sandbox_checkout_url: "https://mp/sandbox" });
  });

  it("lanza error si la respuesta no es ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, text: async () => "bad" })));
    await expect(createPreference({ orderId: "x", orderNumber: "x", planName: "P", amount: 1, userEmail: "" }))
      .rejects.toThrow(/MercadoPago preference error: 400/);
  });

  it("lanza si falta MP_ACCESS_TOKEN", async () => {
    process.env.MP_ACCESS_TOKEN = "";
    await expect(createPreference({ orderId: "x", orderNumber: "x", planName: "P", amount: 1, userEmail: "" }))
      .rejects.toThrow(/MP_ACCESS_TOKEN/);
  });
});

describe("syncPayment", () => {
  beforeEach(() => { process.env.MP_ACCESS_TOKEN = "APP_USR-test"; });
  afterEach(() => vi.unstubAllGlobals());

  it("extrae status, external_reference y payer_email", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: "approved", status_detail: "accredited", external_reference: "ord-1", transaction_amount: 1050, payer: { email: "a@b.com" } }),
    })));
    const r = await syncPayment("pay-1");
    expect(r.status).toBe("approved");
    expect(r.external_reference).toBe("ord-1");
    expect(r.payer_email).toBe("a@b.com");
  });
});

describe("verifyWebhookSignature", () => {
  const secret = "s3cr3t";
  const dataId = "pay-1";
  const requestId = "req-1";
  const ts = "1700000000";
  const goodV1 = crypto.createHmac("sha256", secret)
    .update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest("hex");

  it("manifest tiene el formato exacto de MP", () => {
    expect(buildSignatureManifest({ dataId, requestId, ts })).toBe("id:pay-1;request-id:req-1;ts:1700000000;");
  });

  it("parsea ts y v1 del header", () => {
    expect(parseSignatureHeader(`ts=${ts}, v1=${goodV1}`)).toEqual({ ts, v1: goodV1 });
  });

  it("acepta firma válida", () => {
    expect(verifyWebhookSignature({ signatureHeader: `ts=${ts},v1=${goodV1}`, requestId, dataId, secret })).toBe(true);
  });

  it("rechaza firma inválida", () => {
    expect(verifyWebhookSignature({ signatureHeader: `ts=${ts},v1=deadbeef`, requestId, dataId, secret })).toBe(false);
  });

  it("sin secret configurado, omite verificación (legacy → true)", () => {
    expect(verifyWebhookSignature({ signatureHeader: "", requestId, dataId, secret: "" })).toBe(true);
  });

  it("con secret pero sin header, rechaza", () => {
    expect(verifyWebhookSignature({ signatureHeader: "", requestId, dataId, secret })).toBe(false);
  });
});
