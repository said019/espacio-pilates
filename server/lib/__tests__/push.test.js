import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock del paquete web-push (default export con los métodos que usamos).
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async () => ({ statusCode: 201 })),
  },
}));

import webpush from "web-push";
import {
  isPushConfigured,
  getVapidPublicKey,
  buildPushPayload,
  shouldPruneSubscription,
  sendWebPush,
} from "../push.js";

const SUB = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});
afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});

describe("isPushConfigured / getVapidPublicKey", () => {
  it("false cuando faltan llaves", () => {
    expect(isPushConfigured()).toBe(false);
    expect(getVapidPublicKey()).toBe(null);
  });
  it("true cuando ambas llaves están presentes", () => {
    process.env.VAPID_PUBLIC_KEY = "PUB";
    process.env.VAPID_PRIVATE_KEY = "PRIV";
    expect(isPushConfigured()).toBe(true);
    expect(getVapidPublicKey()).toBe("PUB");
  });
});

describe("buildPushPayload", () => {
  it("incluye title/body/url y usa defaults", () => {
    const obj = JSON.parse(buildPushPayload({ title: "Hola", body: "Cuerpo" }));
    expect(obj).toEqual({ title: "Hola", body: "Cuerpo", url: "/" });
  });
  it("incluye tag cuando se pasa", () => {
    const obj = JSON.parse(buildPushPayload({ title: "T", body: "B", url: "/app/bookings", tag: "class_reminder" }));
    expect(obj.url).toBe("/app/bookings");
    expect(obj.tag).toBe("class_reminder");
  });
});

describe("shouldPruneSubscription", () => {
  it("poda en 404 y 410", () => {
    expect(shouldPruneSubscription({ statusCode: 404 })).toBe(true);
    expect(shouldPruneSubscription({ statusCode: 410 })).toBe(true);
  });
  it("no poda en otros errores", () => {
    expect(shouldPruneSubscription({ statusCode: 500 })).toBe(false);
    expect(shouldPruneSubscription({})).toBe(false);
    expect(shouldPruneSubscription(null)).toBe(false);
  });
});

describe("sendWebPush", () => {
  it("no envía si no está configurado", async () => {
    const r = await sendWebPush(SUB, "{}");
    expect(r).toEqual({ sent: false, reason: "not_configured" });
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });
  it("configura VAPID y envía cuando hay llaves", async () => {
    process.env.VAPID_PUBLIC_KEY = "PUB";
    process.env.VAPID_PRIVATE_KEY = "PRIV";
    const r = await sendWebPush(SUB, "{\"title\":\"x\"}");
    expect(r).toEqual({ sent: true });
    expect(webpush.setVapidDetails).toHaveBeenCalledWith(
      "mailto:espaciopilatesvm@gmail.com", "PUB", "PRIV"
    );
    expect(webpush.sendNotification).toHaveBeenCalledWith(SUB, "{\"title\":\"x\"}");
  });
});
