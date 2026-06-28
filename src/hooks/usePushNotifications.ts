import { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";

type PushStatus =
  | "loading"
  | "unsupported"
  | "needs-install-ios"
  | "denied"
  | "inactive"
  | "active";

function isIOS(): boolean {
  const ua = navigator.userAgent || "";
  const iOSDevice = /iphone|ipad|ipod/i.test(ua);
  const iPadOS = navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1;
  return iOSDevice || iPadOS;
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function usePushNotifications() {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  const refresh = useCallback(async () => {
    if (!supported) {
      setStatus(isIOS() && !isStandalone() ? "needs-install-ios" : "unsupported");
      return;
    }
    try {
      const cfg = (await api.get("/push/config")).data;
      if (!cfg?.enabled || !cfg?.publicKey) {
        setStatus("unsupported");
        return;
      }
      setPublicKey(cfg.publicKey);
      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setStatus(sub ? "active" : "inactive");
    } catch {
      setStatus("unsupported");
    }
  }, [supported]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    if (!supported || !publicKey) return;
    setIsBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "inactive");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await api.post("/push/subscribe", sub.toJSON());
      setStatus("active");
    } catch {
      setStatus("inactive");
    } finally {
      setIsBusy(false);
    }
  }, [supported, publicKey]);

  const disable = useCallback(async () => {
    setIsBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.post("/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => { });
        await sub.unsubscribe().catch(() => { });
      }
      setStatus("inactive");
    } finally {
      setIsBusy(false);
    }
  }, []);

  return { status, isBusy, enable, disable };
}
