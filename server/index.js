import "dotenv/config";
import express from "express";
import cors from "cors";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import multer from "multer";
import axios from "axios";
import crypto from "crypto";
import http2 from "http2";
import archiver from "archiver";
import { execSync } from "child_process";
import { canCancel, canReschedule, endOfPurchaseMonth } from "./lib/bookingPolicy.js";
import { createPreference, createCardPayment, syncPayment, verifyWebhookSignature } from "./lib/mercadopago.js";
import { computeCartTotals } from "./lib/cartPricing.js";
import {
  isPushConfigured,
  getVapidPublicKey,
  buildPushPayload,
  shouldPruneSubscription,
  sendWebPush,
} from "./lib/push.js";
import { isEmailIdentifier } from "./lib/authIdentity.js";
import {
  sendMembershipActivated,
  sendBookingConfirmed,
  sendBookingCancelled,
  sendWeeklyReminder,
  sendRenewalReminder,
  sendPasswordResetEmail,
  sendClientWelcomeWithCredentials,
} from "./emailService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || "puntoneutro_secret_2026";
const APP_PUBLIC_URL = String(process.env.APP_URL || process.env.SITE_URL || "https://www.tuespaciopilates.com.mx").replace(/\/+$/, "");

// ─── Evolution API (WhatsApp) config ────────────────────────────────────────
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || "https://evolution-api-production-c1cb.up.railway.app";
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || "xoL0b1t0s-2026";
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE_NAME || "tu-espacio-pilates-vm";
const evolutionApi = axios.create({
  baseURL: EVOLUTION_API_URL,
  headers: { apikey: EVOLUTION_API_KEY },
  timeout: 20000,
});

const DEFAULT_GENERAL_SETTINGS = {
  studio_name: "Tu Espacio Pilates VM",
  address: "Av. Villa Magna Nte. 600 A, Villa Magna, 78183 San Luis Potosí, S.L.P.",
  phone: "4445480352",
  instagram: "https://www.instagram.com/_espaciopilatesvm/",
  facebook: "",
  timezone: "America/Mexico_City",
  currency: "MXN",
  maintenance_mode: false,
  venue_media_url: "",
  venue_media_type: "",
  venue_media_drive_id: "",
  venue_media_name: "",
  venue_media_updated_at: "",
};

// Valores vacíos por default — el admin debe configurar en Settings → Datos bancarios.
// Si están vacíos, el checkout muestra "El estudio aún no ha configurado datos
// bancarios" en lugar de imprimir credenciales de otra cuenta.
const DEFAULT_BANK_INFO = Object.freeze({
  bank: "",
  account_holder: "",
  account_number: "",
  clabe: "",
  card_number: "",
});

// Map Spanish payment method labels to DB enum values
function normalizePaymentMethod(v) {
  const map = { efectivo: "cash", transferencia: "transfer", tarjeta: "card" };
  return map[String(v || "").toLowerCase()] || v || "cash";
}

// Complement type lookup
const COMPLEMENT_MAP = {
  "nutricion-hormonal": { name: "Nutrición — Salud Hormonal", specialist: "LN. Clara Pérez" },
  "nutricion-rendimiento": { name: "Nutrición — Rendimiento Físico", specialist: "LN. Majo Zamorano" },
  "descarga-muscular": { name: "Descarga Muscular", specialist: "LTF. Angelina Huante" },
};

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatClabe(value) {
  const digits = digitsOnly(value);
  if (digits.length !== 18) return String(value || "").trim();
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 17)} ${digits.slice(17)}`;
}

function formatAccountNumber(value) {
  const digits = digitsOnly(value);
  if (digits.length === 10) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  return String(value || "").trim();
}

function normalizeBankInfo(rawValue) {
  const raw = rawValue && typeof rawValue === "object" ? rawValue : {};
  const candidate = {
    bank: String(raw.bank || raw.bank_name || raw.banco || "").trim(),
    account_holder: String(raw.account_holder || raw.accountHolder || raw.titular || raw.holder || "").trim(),
    account_number: String(raw.account_number || raw.accountNumber || raw.cuenta || raw.account || "").trim(),
    clabe: String(raw.clabe || raw.clabe_interbancaria || "").trim(),
  };

  const holderLower = candidate.account_holder.toLowerCase();
  const clabeDigits = digitsOnly(candidate.clabe);
  // Solo descartar datos DEMO/placeholder heredados (de Balance). NO blanquear por
  // longitud ni por campos vacíos: si el admin guardó datos, deben mostrarse para
  // que el cliente los vea (y el admin pueda corregirlos). Antes, una CLABE que no
  // fuera de 18 dígitos borraba TODO porque el default de TEP está vacío.
  const isDemoPlaceholder =
    clabeDigits === "012180001234567890" ||
    clabeDigits === "012180012345678901" ||
    clabeDigits === "710180000068980" ||
    holderLower.includes("balance studio");

  const base = isDemoPlaceholder ? DEFAULT_BANK_INFO : candidate;
  const formattedAccount = formatAccountNumber(base.account_number || "");
  const formattedClabe = formatClabe(base.clabe || "");
  const holder = String(base.account_holder || "").trim();
  const bank = String(base.bank || "").trim();

  return {
    bank,
    bank_name: bank,
    account_holder: holder,
    accountHolder: holder,
    account_number: formattedAccount,
    accountNumber: formattedAccount,
    clabe: formattedClabe,
  };
}

async function getConfiguredBankInfo(dbClient = pool) {
  // Use pool (not transaction client) to avoid aborting active transactions on error
  const safeClient = pool;
  // Leer PRIMERO de `settings` (la tabla canónica que usa el admin para leer/guardar
  // en getSettingValueWithDefaults / PUT /api/settings). `system_settings` es legacy
  // y, si existe con un bank_info viejo/vacío, NO debe ensombrecer lo que el admin guardó.
  for (const table of ["settings", "system_settings"]) {
    try {
      const settingsRes = await safeClient.query(
        `SELECT value FROM ${table} WHERE key = 'bank_info' LIMIT 1`
      );
      if (settingsRes.rows.length > 0) {
        return normalizeBankInfo(settingsRes.rows[0].value);
      }
    } catch (_) {
      // Table may not exist, try the next one
    }
  }
  return normalizeBankInfo(DEFAULT_BANK_INFO);
}

const DEFAULT_POLICIES_SETTINGS = {
  cancellation_policy: "Para cancelar o reprogramar tu clase se requiere al menos 8 horas de anticipación. De no hacerlo, se tomará como clase impartida y no hay reposición. En caso de inasistencia no hay reembolso.",
  terms_of_service: "Al reservar o comprar en Tu Espacio Pilates aceptas el reglamento interno: puntualidad (5 minutos antes de la clase, tolerancia de 5 minutos), dress code (calcetas antiderrapantes obligatorias y ropa deportiva cómoda), cuidado del equipo y uso personal e intransferible de clases y membresías.",
  privacy_policy: "Tus datos se usan únicamente para gestionar reservas, pagos y comunicación operativa del estudio. No compartimos tu información personal con terceros sin autorización.",
};

const DEFAULT_NOTIFICATION_SETTINGS = {
  email_reminders: true,
  whatsapp_reminders: true,
  class_reminder_enabled: true,   // recordatorio de clase (noche anterior 9pm / mañana 8am) — activo por default
  reminder_hours_before: 2,
};

const DEFAULT_NOTIFICATION_TEMPLATES = {
  // Recordatorios de clase (12 h y 30 min antes). Texto fijo, sin variables.
  class_reminder_12h: {
    subject: "Recordatorio de clase",
    body: "Recordatorio de clase.\nHola 🌞🌙\n\nRecuerda que tienes una clase programada en las próximas 12 hrs, no te la pierdas 🩷",
  },
  class_reminder_30m: {
    subject: "Tu clase comienza pronto",
    body: "Tu clase comienza en 30 minutos, no te la pierdas 🩷",
  },
  booking_confirmed: {
    subject: "Reserva confirmada",
    body: "Hola {name}, tu reserva para {class} el {date} a las {time} está confirmada.",
  },
  booking_waitlist: {
    subject: "Estás en lista de espera",
    body: "Hola {name} 💜 Quedaste en *lista de espera* para {class} el {date} a las {time}.\n\nTu lugar todavía NO está confirmado. Si alguien cancela, entras automáticamente por orden de llegada y te avisamos por aquí. 🤍",
  },
  booking_waitlist_promoted: {
    subject: "¡Se liberó tu lugar!",
    body: "¡Buenas noticias, {name}! 💜 Se liberó un lugar y tu clase *{class}* del {date} a las {time} quedó *confirmada*.\n\n¡Te esperamos! 🤍",
  },
  booking_cancelled: {
    subject: "Reserva cancelada",
    body: "Hola {name}, tu reserva de {class} del {date} fue cancelada. Crédito devuelto: {creditRestored}.",
  },
  membership_activated: {
    subject: "Membresía activada",
    body: "Hola {name}, tu membresía {plan} ya está activa. Vigencia: {startDate} al {endDate}.",
  },
  transfer_rejected: {
    subject: "Transferencia rechazada",
    body: "Hola {name}, no pudimos aprobar tu comprobante. Motivo: {reason}.",
  },
  last_class_reminder: {
    subject: "Te queda 1 clase",
    body: "Hola {name} 💜 Te queda *1 clase* en tu plan {plan}. Renueva para seguir entrenando sin parar. 🤍",
  },
};

const DEFAULT_CANCELLATION_SETTINGS = {
  enabled: true,
  min_hours: 12,
  reschedule_hours: 3,
  waitlist_cutoff_hours: 3,   // dentro de estas horas ya no se auto-promueve de la lista de espera
  refund_credit_on_cancel: true,
  cancellations_limit: 2,
  late_cancel_message: "Las cancelaciones requieren al menos {hours}h de anticipación. La clase se tomará como impartida y no será devuelta a tu paquete.",
};

const DEFAULT_SETTINGS_BY_KEY = {
  general_settings: DEFAULT_GENERAL_SETTINGS,
  policies_settings: DEFAULT_POLICIES_SETTINGS,
  notification_settings: DEFAULT_NOTIFICATION_SETTINGS,
  notification_templates: DEFAULT_NOTIFICATION_TEMPLATES,
  cancellation_settings: DEFAULT_CANCELLATION_SETTINGS,
};

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(baseValue, overrideValue) {
  if (!isPlainObject(baseValue)) {
    return overrideValue === undefined ? baseValue : overrideValue;
  }
  if (!isPlainObject(overrideValue)) {
    return baseValue;
  }
  const output = { ...baseValue };
  for (const [key, val] of Object.entries(overrideValue)) {
    const baseEntry = output[key];
    output[key] = isPlainObject(baseEntry) && isPlainObject(val)
      ? deepMerge(baseEntry, val)
      : val;
  }
  return output;
}

function mergeSettingsWithDefaults(key, rawValue) {
  const defaults = DEFAULT_SETTINGS_BY_KEY[key];
  if (!defaults) return rawValue ?? null;
  if (!isPlainObject(rawValue)) return JSON.parse(JSON.stringify(defaults));
  const merged = deepMerge(defaults, rawValue);
  // Keys whose string fields should fall back to the default when stored as
  // empty string. Without this, a row inserted as `{}` or with cleared values
  // shows blank inputs and admins can't tell what the field is for.
  const FALLBACK_EMPTY_STRINGS = new Set(["policies_settings", "general_settings"]);
  if (FALLBACK_EMPTY_STRINGS.has(key)) {
    for (const [fieldKey, defaultValue] of Object.entries(defaults)) {
      const current = merged[fieldKey];
      if (typeof defaultValue === "string" && defaultValue && (!current || !String(current).trim())) {
        merged[fieldKey] = defaultValue;
      }
    }
  }
  return merged;
}

// ─── File upload (memory storage, max 10 MB) ────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Google Drive helper (used by instructor and user photo uploads) ────────
function isGoogleDriveConfigured() {
  return Boolean(
    process.env.GOOGLE_DRIVE_FOLDER_ID &&
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  );
}

async function uploadBufferToGoogleDrive(buffer, filename, mimeType) {
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const tokenData = await tokenResp.json();
  if (!tokenResp.ok || !tokenData.access_token) {
    throw new Error(`Google OAuth error: ${tokenData.error_description || tokenData.error || "unknown"}`);
  }
  const accessToken = tokenData.access_token;

  const boundary = "drive_upload_" + Date.now();
  const metadata = JSON.stringify({
    name: filename,
    parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
  });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const uploadResp = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const uploadJson = await uploadResp.json();
  if (!uploadJson.id) throw new Error(`Drive upload failed: ${JSON.stringify(uploadJson)}`);

  await fetch(`https://www.googleapis.com/drive/v3/files/${uploadJson.id}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });

  return { fileId: uploadJson.id };
}

// ─── File upload for videos (disk storage, max 500 MB) ─────────────────────
// Use disk storage so large videos don't fill Node.js RAM
const VIDEO_MAX_MB = 500;
const uploadVideo = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => cb(null, `pn_vid_${Date.now()}_${file.originalname}`),
  }),
  limits: { fileSize: VIDEO_MAX_MB * 1024 * 1024 },
});

// ─── Google Drive helpers ────────────────────────────────────────────────────
async function getGoogleDriveAccessToken() {
  const resp = await axios.post("https://oauth2.googleapis.com/token", new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN || "",
    grant_type: "refresh_token",
  }), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  return resp.data.access_token;
}

async function makeGoogleDriveFilePublic(fileId, accessToken) {
  await axios.post(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
    { role: "reader", type: "anyone" },
    { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
  ).catch(() => { }); // best-effort
}

/** Upload a Buffer to Google Drive using simple multipart (for small files like thumbnails) */
async function uploadBufferToDrive(buffer, fileName, mimeType, accessToken) {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || "";
  const metadata = { name: fileName, ...(folderId ? { parents: [folderId] } : {}) };
  // Build multipart body manually
  const boundary = "pn_boundary_" + Date.now();
  const metaPart = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
  );
  const filePart = Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const endPart = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([metaPart, filePart, buffer, endPart]);

  const resp = await axios.post(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    body,
    { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary="${boundary}"` }, maxBodyLength: Infinity, maxContentLength: Infinity }
  );
  return resp.data; // { id, webViewLink }
}

/**
 * Upload a file from disk to Google Drive using Resumable Upload (streams in 5 MB chunks).
 * Works for files of any size without loading them entirely into memory.
 * @param {string} filePath  - absolute path to the temp file on disk
 * @param {string} fileName  - desired file name in Drive
 * @param {string} mimeType  - e.g. "video/mp4"
 * @param {string} accessToken - Google OAuth2 access token
 * @returns {{ id: string, webViewLink?: string }}
 */
async function uploadFileToDriveResumable(filePath, fileName, mimeType, accessToken) {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || "";
  const metadata = { name: fileName, ...(folderId ? { parents: [folderId] } : {}) };
  const fileSize = fs.statSync(filePath).size;

  // Step 1: Initiate resumable upload session
  const initResp = await axios.post(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink",
    metadata,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(fileSize),
      },
    }
  );
  const uploadUri = initResp.headers.location; // resumable session URI

  // Step 2: Upload file in chunks of 5 MB (must be multiples of 256 KB)
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
  let offset = 0;
  const fd = fs.openSync(filePath, "r");

  try {
    while (offset < fileSize) {
      const bytesToRead = Math.min(CHUNK_SIZE, fileSize - offset);
      const chunk = Buffer.alloc(bytesToRead);
      fs.readSync(fd, chunk, 0, bytesToRead, offset);

      const endByte = offset + bytesToRead - 1;
      const contentRange = `bytes ${offset}-${endByte}/${fileSize}`;

      const resp = await axios.put(uploadUri, chunk, {
        headers: {
          "Content-Length": String(bytesToRead),
          "Content-Range": contentRange,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        // 308 Resume Incomplete is expected for intermediate chunks
        validateStatus: (status) => status === 200 || status === 201 || status === 308,
      });

      if (resp.status === 200 || resp.status === 201) {
        // Final chunk — upload complete
        return resp.data; // { id, webViewLink }
      }

      // 308: read next range from Range header
      const rangeHeader = resp.headers.range; // e.g. "bytes=0-5242879"
      if (rangeHeader) {
        offset = parseInt(rangeHeader.split("-")[1], 10) + 1;
      } else {
        offset += bytesToRead;
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  throw new Error("Resumable upload ended without a final 200/201 response");
}


// Pool tuning prevents the 503 we saw on /api/classes:
//   - Without `max`, pg defaults to 10 clients. A few slow queries can
//     starve the pool; new requests hang until Railway's edge proxy
//     gives up and returns 503 to the browser.
//   - Without `statement_timeout`, a single bad query holds a client
//     forever. A capped timeout aborts runaway SQL instead of leaking it.
//   - `connectionTimeoutMillis` makes pool starvation surface as a fast
//     error response instead of a hung request.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway") ? { rejectUnauthorized: false } : false,
  max: Math.max(5, Number(process.env.PG_POOL_MAX || 20)),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 15_000),
});

pool.on("error", (err) => {
  // Idle clients can disconnect (Railway/Neon close idle conns); log and
  // let the pool recreate them rather than crashing the process.
  console.error("[pg pool] idle client error:", err.message);
});

// ─── Canonical weekly schedule (Tu Espacio Pilates VM) ──────────────────────
// day_of_week: 1=Lun … 6=Sáb. Cada clase es apparatus='reformer' EXCEPTO
// Viernes (5) 8:30 pm que es 'tower'. 23 slots en total. Esta es la ÚNICA
// fuente de verdad del horario: el seed inicial, el RESYNC versionado y la
// generación de clases bookables leen de aquí.
const SCHEDULE_SLOTS = [
  // Lunes (1)
  { time_slot: "7:00 am", day_of_week: 1, apparatus: "reformer" },
  { time_slot: "8:00 am", day_of_week: 1, apparatus: "reformer" },
  { time_slot: "5:30 pm", day_of_week: 1, apparatus: "reformer" },
  { time_slot: "6:30 pm", day_of_week: 1, apparatus: "reformer" },
  { time_slot: "8:30 pm", day_of_week: 1, apparatus: "reformer" },
  // Martes (2)
  { time_slot: "7:30 pm", day_of_week: 2, apparatus: "reformer" },
  // Miércoles (3)
  { time_slot: "7:00 am", day_of_week: 3, apparatus: "reformer" },
  { time_slot: "8:00 am", day_of_week: 3, apparatus: "reformer" },
  { time_slot: "9:00 am", day_of_week: 3, apparatus: "reformer" },
  { time_slot: "5:30 pm", day_of_week: 3, apparatus: "reformer" },
  { time_slot: "6:30 pm", day_of_week: 3, apparatus: "reformer" },
  { time_slot: "7:30 pm", day_of_week: 3, apparatus: "reformer" },
  { time_slot: "8:30 pm", day_of_week: 3, apparatus: "reformer" },
  // Jueves (4)
  { time_slot: "5:30 pm", day_of_week: 4, apparatus: "reformer" },
  { time_slot: "7:30 pm", day_of_week: 4, apparatus: "reformer" },
  // Viernes (5) — 8:30 pm = TOWER
  { time_slot: "7:00 am", day_of_week: 5, apparatus: "reformer" },
  { time_slot: "8:00 am", day_of_week: 5, apparatus: "reformer" },
  { time_slot: "9:00 am", day_of_week: 5, apparatus: "reformer" },
  { time_slot: "5:30 pm", day_of_week: 5, apparatus: "reformer" },
  { time_slot: "6:30 pm", day_of_week: 5, apparatus: "reformer" },
  { time_slot: "7:30 pm", day_of_week: 5, apparatus: "reformer" },
  { time_slot: "8:30 pm", day_of_week: 5, apparatus: "tower" },
  // Sábado (6)
  { time_slot: "9:00 am", day_of_week: 6, apparatus: "reformer" },
];

// Insert the canonical 23 slots (class_type_name='Pilates') into schedule_slots.
// Idempotent via ON CONFLICT DO NOTHING on the (time_slot, day_of_week) partial
// unique index. Pass a pool or a client (within a txn) as `q`.
async function buildScheduleSlotsInsert(q) {
  const values = [];
  const params = [];
  SCHEDULE_SLOTS.forEach((s, i) => {
    const b = i * 4;
    values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`);
    params.push(s.time_slot, s.day_of_week, "Pilates", s.apparatus);
  });
  await q.query(
    `INSERT INTO schedule_slots (time_slot, day_of_week, class_type_name, apparatus)
     VALUES ${values.join(", ")}
     ON CONFLICT DO NOTHING`,
    params,
  );
}

// Parse a time_slot string like '7:00 am' / '5:30 pm' → 24h "HH:MM".
function parseScheduleSlot(raw) {
  const m = String(raw).trim().toLowerCase().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/);
  if (!m) return null;
  let hour = parseInt(m[1], 10) % 12;          // 12 → 0
  const min = parseInt(m[2], 10);
  if (m[3] === "pm") hour += 12;               // pm: hour%12 + 12 (12pm→12)
  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

// Duración canónica de una clase (minutos). Las clases son de 55 min con un
// colchón de 5 min entre slots (los slots están a 60 min de distancia).
const CLASS_DURATION_MIN = 55;

// Add `mins` minutes to a "HH:MM" string, returned as "HH:MM".
function addScheduleMinutes(hhmm, mins) {
  const [h, mn] = hhmm.split(":").map((n) => parseInt(n, 10));
  const total = h * 60 + mn + mins;
  const eh = Math.floor(total / 60) % 24;
  const em = total % 60;
  return `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
}

// Generate bookable classes from the ACTIVE schedule_slots for the next `weeks`
// weeks. Idempotent: a class for a given (date, start_time) is only inserted if
// one does not already exist (classes has no unique constraint on those cols,
// so we can't rely on ON CONFLICT — we SELECT-then-skip instead). Each class
// copies its slot's `apparatus`. Capacity is fixed at 8. Used by both the
// empty-DB seed and the versioned RESYNC.
async function generateClassesFromSchedule({ weeks = 4 } = {}) {
  const typeRes = await pool.query(
    "SELECT id FROM class_types WHERE is_active = true ORDER BY sort_order ASC LIMIT 1"
  );
  const instRes = await pool.query(
    "SELECT id FROM instructors WHERE is_active = true ORDER BY created_at ASC LIMIT 1"
  );
  const slotsRes = await pool.query(
    "SELECT time_slot, day_of_week, apparatus FROM schedule_slots WHERE is_active = true"
  );
  if (typeRes.rows.length === 0 || instRes.rows.length === 0 || slotsRes.rows.length === 0) {
    return 0;
  }
  const classTypeId = typeRes.rows[0].id;
  const instructorId = instRes.rows[0].id;

  // Monday of the current week (day_of_week: 1=Mon … 6=Sat, no Sunday).
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay();                  // 0=Sun … 6=Sat
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diffToMon);

  const planned = [];
  for (let week = 0; week < weeks; week++) {
    for (const slot of slotsRes.rows) {
      const start = parseScheduleSlot(slot.time_slot);
      if (!start) continue;
      const date = new Date(monday);
      date.setDate(monday.getDate() + week * 7 + (slot.day_of_week - 1));
      if (date < today) continue;              // skip past dates this week
      const dateStr = date.toISOString().slice(0, 10);
      planned.push({
        date: dateStr,
        start,
        end: addScheduleMinutes(start, CLASS_DURATION_MIN),
        apparatus: slot.apparatus || "reformer",
      });
    }
  }

  let inserted = 0;
  for (const c of planned) {
    // Skip if a class already exists for this (date, start_time) — keeps the
    // function idempotent and never duplicates an already-bookable slot.
    const exists = await pool.query(
      "SELECT 1 FROM classes WHERE date = $1 AND start_time = $2 LIMIT 1",
      [c.date, c.start]
    );
    if (exists.rows.length > 0) continue;
    await pool.query(
      `INSERT INTO classes (class_type_id, instructor_id, date, start_time, end_time, max_capacity, status, apparatus)
       VALUES ($1,$2,$3,$4,$5,8,'scheduled',$6)`,
      [classTypeId, instructorId, c.date, c.start, c.end, c.apparatus]
    );
    inserted++;
  }
  return inserted;
}

// Ensure users table has password_hash column (idempotent migration)
async function ensureSchema() {
  try {
    // ── Self-init: en una base de datos vacía (p.ej. Postgres nueva de Railway)
    // las tablas core (users, plans, bookings, …) viven en schema_complete.sql,
    // no en esta función. Si no existen, cargamos el schema base una sola vez para
    // que la app se inicialice sola sin un paso manual de psql. ──
    {
      const coreCheck = await pool.query("SELECT to_regclass('public.users') AS t");
      if (!coreCheck.rows[0].t) {
        const schemaSql = fs.readFileSync(
          path.join(__dirname, "../supabase/migrations/schema_complete.sql"),
          "utf8"
        );
        await pool.query(schemaSql);
        console.log("✅ Base de datos inicializada (schema_complete.sql)");
      }
    }
    // ── Ensure all users columns the app needs ────────────────────────────
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)`).catch(() => { });
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS accepts_terms BOOLEAN DEFAULT false`).catch(() => { });
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS accepts_communications BOOLEAN DEFAULT false`).catch(() => { });
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(255)`).catch(() => { });
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT`).catch(() => { });
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE`).catch(() => { });
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(255)`).catch(() => { });
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(20)`).catch(() => { });
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS health_notes TEXT`).catch(() => { });
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS receive_reminders BOOLEAN DEFAULT true`).catch(() => { });
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS receive_promotions BOOLEAN DEFAULT false`).catch(() => { });
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS receive_weekly_summary BOOLEAN DEFAULT false`).catch(() => { });
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS push_reminders BOOLEAN DEFAULT true`).catch(() => { });
    // ── Web Push: suscripciones por dispositivo ──────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint     TEXT NOT NULL UNIQUE,
        p256dh       TEXT NOT NULL,
        auth         TEXT NOT NULL,
        user_agent   TEXT,
        created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        last_used_at TIMESTAMP WITH TIME ZONE
      );
    `).catch((e) => console.error("[schema] push_subscriptions:", e.message));
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id)`).catch(() => { });
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`).catch(() => { });
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(10)`).catch(() => { });
    // ── Auth por teléfono: correo opcional, teléfono único entre clientes ──
    await pool.query(`ALTER TABLE users ALTER COLUMN email DROP NOT NULL`).catch(() => { });
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone_client ON users (phone) WHERE role = 'client'`
    ).catch(() => { });
    // ── Password reset tokens ───────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token       VARCHAR(255) NOT NULL UNIQUE,
        expires_at  TIMESTAMP WITH TIME ZONE NOT NULL,
        used        BOOLEAN NOT NULL DEFAULT false,
        created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `).catch(() => { });
    await pool.query(`ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS used BOOLEAN NOT NULL DEFAULT false`).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_reset_tokens_token ON password_reset_tokens(token)`).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON password_reset_tokens(user_id)`).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_reset_tokens_expires ON password_reset_tokens(expires_at)`).catch(() => { });
    // Cleanup best-effort to keep table compact.
    await pool.query(`
      DELETE FROM password_reset_tokens
      WHERE used = true OR expires_at < NOW() - INTERVAL '7 days'
    `).catch(() => { });
    // Ensure referrals table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral_codes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code VARCHAR(20) NOT NULL UNIQUE,
        uses_count INTEGER DEFAULT 0,
        reward_points INTEGER DEFAULT 200,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_referral_codes_user ON referral_codes(user_id)`).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code)`).catch(() => { });
    // Ensure discount_codes table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS discount_codes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        code VARCHAR(50) NOT NULL UNIQUE,
        discount_type VARCHAR(20) NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent','fixed')),
        discount_value DECIMAL(10,2) NOT NULL,
        max_uses INTEGER,
        uses_count INTEGER DEFAULT 0,
        class_category VARCHAR(20),
        channel VARCHAR(20) NOT NULL DEFAULT 'all',
        is_active BOOLEAN DEFAULT true,
        expires_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // ── class_types (tipos de clase editables desde admin) ──────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS class_types (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name         VARCHAR(100) NOT NULL,
        subtitle     VARCHAR(150),
        description  TEXT,
        category     VARCHAR(20)  NOT NULL DEFAULT 'pilates' CHECK (category IN ('pilates','bienestar','funcional','mixto','all')),
        intensity    VARCHAR(20)  DEFAULT 'media' CHECK (intensity IN ('ligera','media','pesada','todas')),
        level        VARCHAR(50)  DEFAULT 'Todos los niveles',
        duration_min INTEGER      DEFAULT 50,
        capacity     INTEGER      DEFAULT 10,
        color        VARCHAR(50)  DEFAULT '#c026d3',
        emoji        VARCHAR(10)  DEFAULT '🏃',
        is_active    BOOLEAN      DEFAULT true,
        sort_order   INTEGER      DEFAULT 0,
        created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`ALTER TABLE class_types ADD COLUMN IF NOT EXISTS subtitle VARCHAR(150)`).catch(() => { });
    await pool.query(`ALTER TABLE class_types ADD COLUMN IF NOT EXISTS category VARCHAR(20) DEFAULT 'pilates'`).catch(() => { });
    await pool.query(`ALTER TABLE class_types ADD COLUMN IF NOT EXISTS intensity VARCHAR(20) DEFAULT 'media'`).catch(() => { });
    await pool.query(`ALTER TABLE class_types ADD COLUMN IF NOT EXISTS level VARCHAR(50) DEFAULT 'Todos los niveles'`).catch(() => { });
    await pool.query(`ALTER TABLE class_types ADD COLUMN IF NOT EXISTS duration_min INTEGER DEFAULT 50`).catch(() => { });
    await pool.query(`ALTER TABLE class_types ADD COLUMN IF NOT EXISTS capacity INTEGER DEFAULT 10`).catch(() => { });
    await pool.query(`ALTER TABLE class_types ALTER COLUMN capacity SET DEFAULT 10`).catch(() => { });
    await pool.query(`ALTER TABLE class_types ADD COLUMN IF NOT EXISTS color VARCHAR(50) DEFAULT '#c026d3'`).catch(() => { });
    await pool.query(`ALTER TABLE class_types ADD COLUMN IF NOT EXISTS emoji VARCHAR(10) DEFAULT '🏃'`).catch(() => { });
    await pool.query(`ALTER TABLE class_types ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`).catch(() => { });
    await pool.query(`ALTER TABLE class_types ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`).catch(() => { });
    await pool.query(`ALTER TABLE class_types ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`).catch(() => { });
    // ── schedule_slots (horario semanal editable desde admin) ───────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedule_slots (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        time_slot       VARCHAR(20) NOT NULL,
        day_of_week     INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
        class_type_id   UUID REFERENCES class_types(id) ON DELETE SET NULL,
        class_type_name VARCHAR(100),
        instructor_name VARCHAR(100),
        is_active       BOOLEAN DEFAULT true,
        created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_schedule_slots_day ON schedule_slots(day_of_week)`).catch(() => { });
    await pool.query(`ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS class_type_id UUID`).catch(() => { });
    await pool.query(`ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS class_type_name VARCHAR(100)`).catch(() => { });
    await pool.query(`ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS instructor_name VARCHAR(100)`).catch(() => { });
    await pool.query(`ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`).catch(() => { });
    // apparatus: 'reformer' (default) | 'tower'. Per-slot; copied onto each
    // generated class so the front-end can label the equipment.
    await pool.query(`ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS apparatus VARCHAR(20) DEFAULT 'reformer'`).catch(() => { });
    await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS apparatus VARCHAR(20) DEFAULT 'reformer'`).catch(() => { });
    // Etiqueta de grupo muscular por clase (Lower/Upper/Full body/Core). NULL = el front cae al default por día.
    await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS focus VARCHAR(40)`).catch(() => { });
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_slots_slot ON schedule_slots(time_slot, day_of_week) WHERE is_active = true`).catch(() => { });
    // ── schedule_templates (plantilla simple con class_label) ───────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedule_templates (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        time_slot   VARCHAR(10)  NOT NULL,
        day_of_week SMALLINT     NOT NULL CHECK (day_of_week BETWEEN 1 AND 6),
        class_label VARCHAR(50)  NOT NULL,
        shift       VARCHAR(10)  NOT NULL DEFAULT 'morning' CHECK (shift IN ('morning','evening')),
        is_active   BOOLEAN      DEFAULT true,
        created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (time_slot, day_of_week)
      );
    `);
    // ── packages (paquetes de precios) ────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS packages (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name          VARCHAR(100) NOT NULL,
        num_classes   VARCHAR(20)  NOT NULL,
        price         DECIMAL(10,2) NOT NULL,
        category      VARCHAR(20)  NOT NULL DEFAULT 'all' CHECK (category IN ('pilates','bienestar','funcional','mixto','all')),
        validity_days INTEGER      DEFAULT 30,
        is_active     BOOLEAN      DEFAULT true,
        sort_order    INTEGER      DEFAULT 0,
        created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_packages_category ON packages(category)`).catch(() => { });
    // ── Seed packages si la tabla está vacía ──────────────────────────────
    const pkgCount = await pool.query("SELECT COUNT(*) FROM packages");
    if (parseInt(pkgCount.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO packages (name, num_classes, price, category, validity_days, is_active, sort_order) VALUES
          ('7 Clases',               '7', 860,  'pilates', 30, true, 1),
          ('14 Clases',              '14', 1400, 'pilates', 30, true, 2),
          ('20 Clases',              '20', 2200, 'pilates', 30, true, 3),
          ('Clase Extra',            '1', 130,  'pilates', 30, true, 4),
          ('Clase Suelta / Visita',  '1', 250,  'pilates', 7,  true, 5)
        ON CONFLICT DO NOTHING;
      `);
      console.log("✅ Seeded Tu Espacio Pilates VM packages");
    }
    // ── Seed class_types – idempotent: garantizar UN único tipo 'Pilates' ──────
    // Funciona en cualquier estado de DB (vacía o pre-sembrada por
    // schema_complete.sql). UPSERT por nombre + desactivar el resto, de modo
    // que el resultado final sea siempre exactamente un tipo activo 'Pilates'.
    {
      const vmTypeDesc = "Clase de Pilates de bajo impacto y alta exigencia en reformer, tower, mat y silla. Grupos de 8 con atención personalizada y enfoque muscular distinto cada día.";
      await pool.query(
        `UPDATE class_types
            SET subtitle = $1, description = $2, category = 'pilates', intensity = 'media',
                level = 'all', duration_min = 55, capacity = 8, color = '#C9ADA3',
                emoji = '🤍', sort_order = 1, is_active = true
          WHERE name = 'Pilates'`,
        ["Reformer · Tower · Mat · Silla", vmTypeDesc],
      ).catch(() => { });
      await pool.query(
        `INSERT INTO class_types (name, subtitle, description, category, intensity, level, duration_min, capacity, color, emoji, sort_order, is_active)
         SELECT 'Pilates', $1, $2, 'pilates', 'media', 'all', 55, 8, '#C9ADA3', '🤍', 1, true
         WHERE NOT EXISTS (SELECT 1 FROM class_types WHERE name = 'Pilates')`,
        ["Reformer · Tower · Mat · Silla", vmTypeDesc],
      ).catch(() => { });
      // Desactivar cualquier otro tipo pre-sembrado (Barre Studio, Pilates Mat,
      // Yoga Sculpt, etc.) — VM opera un único tipo de clase.
      await pool.query(`UPDATE class_types SET is_active = false WHERE name <> 'Pilates'`).catch(() => { });
      console.log("✅ Ensured single Tu Espacio Pilates VM class type 'Pilates'");
    }
    // ── Seed schedule_slots si la tabla está vacía ─────────────────────────
    // Horario semanal canónico (day_of_week: 1=Lun … 6=Sáb). Todas las clases
    // son apparatus='reformer' EXCEPTO Viernes (5) 8:30 pm que es 'tower'.
    // 23 slots en total. Esta misma lista alimenta el seed inicial y el RESYNC
    // versionado de más abajo, vía buildScheduleSlotsInsert().
    const insertSeedSlots = async () => buildScheduleSlotsInsert(pool);
    const ssCount = await pool.query("SELECT COUNT(*) FROM schedule_slots");
    if (parseInt(ssCount.rows[0].count) === 0) {
      await insertSeedSlots();
    }
    // ── Ensure plans columns exist ───────────────────────────────────────
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS description TEXT`).catch(() => { });
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'MXN'`).catch(() => { });
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS class_limit INTEGER`).catch(() => { });
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '[]'::jsonb`).catch(() => { });
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`).catch(() => { });
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`).catch(() => { });
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`).catch(() => { });
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS class_category VARCHAR(20) DEFAULT 'all'`).catch(() => { });
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_non_transferable BOOLEAN DEFAULT false`).catch(() => { });
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_non_repeatable BOOLEAN DEFAULT false`).catch(() => { });
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS repeat_key VARCHAR(80)`).catch(() => { });
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS discount_price NUMERIC(10,2)`).catch(() => { });
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS time_restriction JSONB`).catch(() => { });
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS bundle_components JSONB`).catch(() => { });
    await pool.query(`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS bundle_parent_id UUID`).catch(() => { });
    // Combos: sin dividir la membresía, guardamos un desglose por disciplina
    // (e.g. {"reformer": 8, "barre": 8}) para que el admin pueda ajustar cada
    // categoría desde el diálogo "Ajustar créditos" y la reserva descuente del
    // contador correcto. classes_remaining se mantiene como la SUMA del map.
    await pool.query(`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS discipline_credits JSONB`).catch(() => { });
    // Seed discount_price for existing plans that don't have one yet
    await pool.query(`
      UPDATE plans SET discount_price = CASE
        WHEN price = 120 THEN 110
        WHEN price = 400 THEN 380
        WHEN price = 680 THEN 640
        WHEN price = 900 THEN 840
        ELSE NULL
      END
      WHERE discount_price IS NULL AND price IN (120, 400, 680, 900)
    `).catch(() => { });
    // ── Migrate class_types: normalize categories for Valiance ──
    await pool.query(`
      UPDATE class_types SET category = 'pilates' WHERE category NOT IN ('pilates','bienestar','funcional');
    `).catch(() => { });
    // ── Migrate plans: 'mixto' class_category means both, keep as 'mixto' for logic ──
    // (mixto plans are still valid — the booking endpoint allows them on both categories)
    // ── Seed plans: deactivate old schema_complete.sql plans & ensure only correct ones ──
    // Soft-delete (deactivate) old plans que NO son parte del catálogo VM.
    // Lista canónica vive en seed-valiance-full.sql y aquí abajo en el bloque de fresh-DB.
    // Usamos UPDATE en vez de DELETE para evitar FK constraints de orders/memberships.
    await pool.query(`
      UPDATE plans SET is_active = false WHERE name IN (
        'Inscripción (Pago Anual)',
        'Sesión Muestra o Individual',
        'Sesión Extra (Socias o Inscritas)',
        'Una Sesión (4 al Mes)',
        'Dos Sesiones (8 al Mes)',
        'Tres Sesiones (12 al Mes)',
        'Cuatro Sesiones (16 al Mes)',
        'Cinco Sesiones (20 al Mes)',
        'Seis Sesiones (24 al Mes)',
        'Siete Sesiones (28 al Mes)',
        -- Legacy del seed genérico anterior (precios incorrectos)
        'Clase Suelta',
        '4 Clases',
        '8 Clases',
        '12 Clases',
        '16 Clases',
        -- Reemplazado por 'Reformer — Primera Vez' / 'Barre — Primera Vez'
        'Clase Muestra'
      );
    `).catch(() => { });
    // Deactivate old combo "Paquete +" plans — replaced by complement add-on selector
    await pool.query(`
      UPDATE plans SET is_active = false WHERE name ILIKE '%+%Nutri%' OR name ILIKE '%+%Descarga%' OR name ILIKE '%+%Hormonal%' OR name ILIKE 'Paquete +%' OR name ILIKE '%Clases +%';
    `).catch(() => { });
    // Deactivate leftover Valiance plans (Reformer/Barre/Combo/promos) on non-empty DBs
    await pool.query(`
      UPDATE plans SET is_active = false WHERE class_category IN ('reformer','barre','mixto') OR name ILIKE 'Reformer —%' OR name ILIKE 'Barre —%' OR name ILIKE 'Combo%' OR name IN ('Membresía Ilimitada','Morning Pass');
    `).catch(() => { });
    // Remove legacy plan "Sesión Extra (Socias o Inscritas)" and all related data.
    // This keeps admin clean and avoids accidental reuse of an obsolete plan.
    try {
      const legacyPlanName = "Sesión Extra (Socias o Inscritas)";
      const legacyRes = await pool.query(`SELECT id FROM plans WHERE name = $1`, [legacyPlanName]);
      if (legacyRes.rows.length) {
        const legacyIds = legacyRes.rows.map((row) => row.id);
        const cleanupClient = await pool.connect();
        try {
          await cleanupClient.query("BEGIN");
          await cleanupClient.query(
            `UPDATE memberships
                SET order_id = NULL
              WHERE order_id IN (SELECT id FROM orders WHERE plan_id = ANY($1::uuid[]))`,
            [legacyIds]
          ).catch(() => { });
          await cleanupClient.query(`DELETE FROM discount_codes WHERE plan_id = ANY($1::uuid[])`, [legacyIds]).catch(() => { });
          await cleanupClient.query(`DELETE FROM memberships WHERE plan_id = ANY($1::uuid[])`, [legacyIds]).catch(() => { });
          await cleanupClient.query(`DELETE FROM orders WHERE plan_id = ANY($1::uuid[])`, [legacyIds]).catch(() => { });
          await cleanupClient.query(`DELETE FROM plans WHERE id = ANY($1::uuid[])`, [legacyIds]);
          await cleanupClient.query("COMMIT");
        } catch (legacyErr) {
          await cleanupClient.query("ROLLBACK").catch(() => { });
          console.warn("[schema] Legacy session cleanup skipped:", legacyErr?.message || legacyErr);
        } finally {
          cleanupClient.release();
        }
      }
    } catch (legacyTopErr) {
      console.warn("[schema] Legacy session lookup failed:", legacyTopErr?.message || legacyTopErr);
    }
    // ── Seed canónico Tu Espacio Pilates VM: IDEMPOTENTE en cualquier estado ──
    // schema_complete.sql pre-siembra planes, así que un guard `if empty` nunca
    // dispararía. En su lugar: (1) desactivamos TODO, (2) upsert por nombre de
    // los 6 planes VM (re-activándolos). Resultado: solo los 6 planes VM quedan
    // activos (más TotalPass 154 admin-only, que se re-activa en su propio
    // bloque idempotente más abajo). No requiere UNIQUE(name).
    const VM_PLANS = [
      { name: "Paquete 7 Clases",      desc: "7 clases al mes. Vence al fin del mes de compra.",  price: 880,  dur: 30,   cl: 7,  so: 1, feat: ["7 clases", "Vigencia: hasta fin de mes", "Personal e intransferible", "Solo transferencia"] },
      { name: "Paquete 9 Clases",      desc: "9 clases al mes. Vence al fin del mes de compra.",  price: 1050, dur: 30,   cl: 9,  so: 2, feat: ["9 clases", "Vigencia: hasta fin de mes", "Personal e intransferible", "Solo transferencia"] },
      { name: "Paquete 14 Clases",     desc: "14 clases al mes. Vence al fin del mes de compra.", price: 1400, dur: 30,   cl: 14, so: 3, feat: ["14 clases", "Vigencia: hasta fin de mes", "Personal e intransferible", "Solo transferencia"] },
      { name: "Clase Extra",           desc: "Clase adicional para alumnas ya inscritas.",        price: 130,  dur: 30,   cl: 1,  so: 4, feat: ["1 clase extra", "Solo para inscritas"] },
      { name: "Clase Suelta / Visita", desc: "Clase individual sin inscripción.",                 price: 250,  dur: 7,    cl: 1,  so: 5, feat: ["1 clase", "Sin inscripción", "Si te inscribes se toma a cuenta"] },
      { name: "Inscripción",           desc: "Pago único de inscripción. Se re-paga tras ausencia mayor a 6 meses.", price: 500, dur: 3650, cl: 0, so: 6, feat: ["Pago único", "Requerida para paquetes"] },
    ];
    // (1) Desactivar todo antes de upsertar los planes VM. TotalPass 154 se
    //     re-activa en su propio bloque (que corre después de éste).
    await pool.query(`UPDATE plans SET is_active = false`).catch(() => { });
    // (2) Upsert por nombre: UPDATE (re-activa + corrige) luego INSERT-if-missing.
    for (const p of VM_PLANS) {
      const feat = JSON.stringify(p.feat);
      await pool.query(
        `UPDATE plans
            SET description = $2, price = $3, currency = 'MXN', duration_days = $4,
                class_limit = $5, class_category = 'all', features = $6::jsonb,
                is_active = true, sort_order = $7, updated_at = NOW()
          WHERE name = $1`,
        [p.name, p.desc, p.price, p.dur, p.cl, feat, p.so],
      ).catch(() => { });
      await pool.query(
        `INSERT INTO plans (name, description, price, currency, duration_days, class_limit, class_category, features, is_active, sort_order)
         SELECT $1::text, $2::text, $3::numeric, 'MXN', $4::int, $5::int, 'all', $6::jsonb, true, $7::int
         WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = $1::text)`,
        [p.name, p.desc, p.price, p.dur, p.cl, feat, p.so],
      ).catch(() => { });
    }
    console.log("[schema] Seeded/ensured Tu Espacio Pilates VM plans (idempotent)");
    // ── Backfill class_category on existing plans ──
    await pool.query(`UPDATE plans SET class_category = 'all' WHERE class_category IS NULL`).catch(() => { });
    // ── Allow reformer/barre categories. Drop legacy CHECK constraints on
    //    plans.class_category and class_types.category so we can use the new
    //    Valiance-specific values without enum churn.
    await pool.query(`
      DO $$
      DECLARE c TEXT;
      BEGIN
        FOR c IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'plans'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) ILIKE '%class_category%'
        LOOP
          EXECUTE format('ALTER TABLE plans DROP CONSTRAINT %I', c);
        END LOOP;
        FOR c IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'class_types'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) ILIKE '%category%'
        LOOP
          EXECUTE format('ALTER TABLE class_types DROP CONSTRAINT %I', c);
        END LOOP;
      EXCEPTION WHEN undefined_table THEN NULL;
      END $$;
    `).catch(() => { });
    // ── Backfill class_category on Valiance plans by name pattern. The seeded
    //    catalog ships everything as 'all', which makes a Reformer package
    //    let users book Barre. Fix it here, idempotently.
    await pool.query(`
      UPDATE plans SET class_category = 'reformer'
       WHERE LOWER(name) LIKE 'reformer%'
         AND class_category <> 'reformer';
    `).catch(() => { });
    await pool.query(`
      UPDATE plans SET class_category = 'barre'
       WHERE LOWER(name) LIKE 'barre%'
         AND class_category <> 'barre';
    `).catch(() => { });
    // Morning Pass: per Valiance schedule (Lun-Vie 7-8-9 AM), only Reformer
    // classes run in those slots.
    await pool.query(`
      UPDATE plans SET class_category = 'reformer'
       WHERE LOWER(name) LIKE 'morning pass%'
         AND class_category <> 'reformer';
    `).catch(() => { });
    // Backfill Morning Pass time_restriction so the booking endpoint enforces
    // "Lun-Vie 7-9 AM only". checkPlanTimeRestriction() reads this JSONB:
    //   days_of_week: 0=Sun..6=Sat (uses Date.getUTCDay)
    //   hour_range: inclusive HH:MM strings
    await pool.query(`
      UPDATE plans
         SET time_restriction = jsonb_build_object(
           'days_of_week', '[1,2,3,4,5]'::jsonb,
           'hour_range',   '["07:00","09:59"]'::jsonb,
           'message',      'Tu Morning Pass solo aplica de lunes a viernes en clases de 7, 8 y 9 AM.'
         )
       WHERE LOWER(name) LIKE 'morning pass%'
         AND (time_restriction IS NULL OR time_restriction = '{}'::jsonb);
    `).catch(() => { });
    // Combos and unlimited keep 'all' since they explicitly span both
    // disciplines. Combo per-discipline accounting uses bundle_components:
    // each Combo plan gets two component planIds (Reformer N + Barre N).
    // When admin assigns a Combo, POST /api/memberships routes to the bundle
    // endpoint so two child memberships are created (one per discipline) and
    // each gets its own classes_remaining counter.
    await pool.query(`
      UPDATE plans c
         SET bundle_components = jsonb_build_array(
               jsonb_build_object('planId', r.id::text, 'label', '4 Reformer'),
               jsonb_build_object('planId', b.id::text, 'label', '4 Barre')
             )
        FROM (SELECT id FROM plans WHERE LOWER(name) = LOWER('Reformer — 4 Clases') LIMIT 1) r,
             (SELECT id FROM plans WHERE LOWER(name) = LOWER('Barre — 4 Clases') LIMIT 1) b
       WHERE LOWER(c.name) LIKE 'combo 1%'
         AND (c.bundle_components IS NULL OR c.bundle_components = 'null'::jsonb OR c.bundle_components = '[]'::jsonb);
    `).catch((e) => console.warn("[backfill] combo1 components:", e.message));
    await pool.query(`
      UPDATE plans c
         SET bundle_components = jsonb_build_array(
               jsonb_build_object('planId', r.id::text, 'label', '8 Reformer'),
               jsonb_build_object('planId', b.id::text, 'label', '4 Barre')
             )
        FROM (SELECT id FROM plans WHERE LOWER(name) = LOWER('Reformer — 8 Clases') LIMIT 1) r,
             (SELECT id FROM plans WHERE LOWER(name) = LOWER('Barre — 4 Clases') LIMIT 1) b
       WHERE LOWER(c.name) LIKE 'combo 2%'
         AND (c.bundle_components IS NULL OR c.bundle_components = 'null'::jsonb OR c.bundle_components = '[]'::jsonb);
    `).catch((e) => console.warn("[backfill] combo2 components:", e.message));
    await pool.query(`
      UPDATE plans c
         SET bundle_components = jsonb_build_array(
               jsonb_build_object('planId', r.id::text, 'label', '8 Reformer'),
               jsonb_build_object('planId', b.id::text, 'label', '8 Barre')
             )
        FROM (SELECT id FROM plans WHERE LOWER(name) = LOWER('Reformer — 8 Clases') LIMIT 1) r,
             (SELECT id FROM plans WHERE LOWER(name) = LOWER('Barre — 8 Clases') LIMIT 1) b
       WHERE LOWER(c.name) LIKE 'combo 3%'
         AND (c.bundle_components IS NULL OR c.bundle_components = 'null'::jsonb OR c.bundle_components = '[]'::jsonb);
    `).catch((e) => console.warn("[backfill] combo3 components:", e.message));
    // Backfill discipline_credits para membresías de combos existentes que aún
    // no tienen el desglose. Intentamos parsear el nombre del plan ("Combo X
    // — N Reformer + M Barre") para obtener N y M; si la suma N+M coincide
    // con classes_remaining, asumimos que aún no se ha consumido nada y
    // sembramos el split en proporción al límite. Si no coincide, dejamos en
    // NULL para que el admin lo ajuste desde el diálogo.
    await pool.query(`
      UPDATE memberships m
         SET discipline_credits = jsonb_build_object(
               'reformer', GREATEST(0, COALESCE(m.classes_remaining, 0)
                 * (substring(p.name from '(\\d+)\\s*Reformer'))::int
                 / NULLIF(
                     (substring(p.name from '(\\d+)\\s*Reformer'))::int
                     + (substring(p.name from '(\\d+)\\s*Barre'))::int,
                     0
                 )),
               'barre',    GREATEST(0, COALESCE(m.classes_remaining, 0)
                 * (substring(p.name from '(\\d+)\\s*Barre'))::int
                 / NULLIF(
                     (substring(p.name from '(\\d+)\\s*Reformer'))::int
                     + (substring(p.name from '(\\d+)\\s*Barre'))::int,
                     0
                 ))
             )
        FROM plans p
       WHERE m.plan_id = p.id
         AND p.bundle_components IS NOT NULL
         AND jsonb_typeof(p.bundle_components) = 'array'
         AND jsonb_array_length(p.bundle_components) > 0
         AND m.discipline_credits IS NULL
         AND p.name ~* '\\d+\\s*Reformer'
         AND p.name ~* '\\d+\\s*Barre'
         AND m.classes_remaining IS NOT NULL;
    `).catch((e) => console.warn("[backfill] discipline_credits:", e.message));
    // ── Backfill class_types: Barre class types must be category 'barre'.
    //    The legacy CHECK forced 'pilates' which made Barre indistinguishable
    //    from Reformer for plan compatibility.
    await pool.query(`
      UPDATE class_types SET category = 'barre'
       WHERE (LOWER(name) LIKE '%barre%' OR LOWER(name) LIKE '%hiit barre%')
         AND category <> 'barre';
    `).catch(() => { });
    await pool.query(`
      UPDATE class_types SET category = 'reformer'
       WHERE (LOWER(name) LIKE '%reformer%' OR LOWER(name) LIKE '%pilates%')
         AND LOWER(name) NOT LIKE '%barre%'
         AND category <> 'reformer';
    `).catch(() => { });
    // "Mat" is a floor class that shares the Barre credit pool (per Valiance).
    // The line-696 normalization above forces unknown categories to 'pilates',
    // but there is no 'pilates' plan category — so a Mat class tagged 'pilates'
    // is bookable only by 'all' plans and everyone else sees "no active package".
    // Pin it to 'barre' so Barre-plan holders can book Mat and it consumes a
    // Barre credit. Name doesn't match the %barre%/%reformer% backfills above,
    // hence the explicit rule here.
    await pool.query(`
      UPDATE class_types SET category = 'barre'
       WHERE LOWER(name) = 'mat' AND category <> 'barre';
    `).catch(() => { });
    // ── Products table ─────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name       VARCHAR(150) NOT NULL,
        price      DECIMAL(10,2) DEFAULT 0,
        category   VARCHAR(50) DEFAULT 'accesorios',
        stock      INTEGER DEFAULT 0,
        sku        VARCHAR(100),
        is_active  BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // ── Order items table ───────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        order_id   UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id) ON DELETE SET NULL,
        quantity   INTEGER NOT NULL DEFAULT 1,
        unit_price DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    `);
    // ── Order PLAN items (carrito de planes/paquetes; distinto de order_items que es de productos) ──
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_plan_items (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        plan_id     UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
        quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
        unit_price  DECIMAL(10,2) NOT NULL,
        line_total  DECIMAL(10,2) NOT NULL,
        created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_order_plan_items_order ON order_plan_items(order_id);
    `);
    // ── Payment proofs table ────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_proofs (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        file_url    TEXT NOT NULL,
        file_name   VARCHAR(255),
        mime_type   VARCHAR(100),
        status      VARCHAR(30) NOT NULL DEFAULT 'pending',
        uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TIMESTAMP WITH TIME ZONE,
        CONSTRAINT uq_payment_proofs_order UNIQUE (order_id)
      );
      CREATE INDEX IF NOT EXISTS idx_payment_proofs_order ON payment_proofs(order_id);
    `);
    // ── Instructors table ──────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS instructors (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        display_name VARCHAR(150) NOT NULL,
        email        VARCHAR(255),
        phone        VARCHAR(30),
        bio          TEXT,
        specialties  TEXT,
        photo_url    TEXT,
        is_active    BOOLEAN DEFAULT true,
        created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`ALTER TABLE instructors ADD COLUMN IF NOT EXISTS photo_focus_x SMALLINT DEFAULT 50`).catch(() => { });
    await pool.query(`ALTER TABLE instructors ADD COLUMN IF NOT EXISTS photo_focus_y SMALLINT DEFAULT 50`).catch(() => { });
    await pool.query(`ALTER TABLE instructors ADD COLUMN IF NOT EXISTS sort_order SMALLINT DEFAULT 0`).catch(() => { });
    await pool.query(`ALTER TABLE instructors ADD COLUMN IF NOT EXISTS user_id UUID`).catch(() => { });
    // ── Reviews table ──────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
        rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment     TEXT,
        class_id    UUID,
        is_approved BOOLEAN DEFAULT false,
        created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);
    `);
    // Ensure all review columns exist even if table was created by an older schema
    await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS user_id UUID`).catch(() => { });
    await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS rating SMALLINT`).catch(() => { });
    await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS overall_rating SMALLINT`).catch(() => { });
    await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS comment TEXT`).catch(() => { });
    await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS class_id UUID`).catch(() => { });
    await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT false`).catch(() => { });
    await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`).catch(() => { });
    await pool.query(`UPDATE reviews SET rating = COALESCE(rating, overall_rating, 5) WHERE rating IS NULL`).catch(() => { });
    await pool.query(`UPDATE reviews SET overall_rating = COALESCE(overall_rating, rating, 5) WHERE overall_rating IS NULL`).catch(() => { });
    await pool.query(`ALTER TABLE reviews ALTER COLUMN rating SET DEFAULT 5`).catch(() => { });
    await pool.query(`ALTER TABLE reviews ALTER COLUMN overall_rating SET DEFAULT 5`).catch(() => { });
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'reviews_rating_check'
            AND conrelid = 'reviews'::regclass
        ) THEN
          ALTER TABLE reviews ADD CONSTRAINT reviews_rating_check CHECK (rating BETWEEN 1 AND 5);
        END IF;
      END $$;
    `).catch(() => { });
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema='public' AND table_name='reviews' AND column_name='overall_rating'
        ) AND NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'reviews_overall_rating_check'
            AND conrelid = 'reviews'::regclass
        ) THEN
          ALTER TABLE reviews ADD CONSTRAINT reviews_overall_rating_check CHECK (overall_rating BETWEEN 1 AND 5);
        END IF;
      END $$;
    `).catch(() => { });
    await pool.query(`ALTER TABLE reviews ALTER COLUMN rating SET NOT NULL`).catch(() => { });
    await pool.query(`ALTER TABLE reviews ALTER COLUMN overall_rating SET NOT NULL`).catch(() => { });
    await pool.query(`
      CREATE OR REPLACE FUNCTION reviews_sync_overall_rating()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        NEW.overall_rating := COALESCE(NEW.overall_rating, NEW.rating, 5);
        NEW.rating := COALESCE(NEW.rating, NEW.overall_rating, 5);
        RETURN NEW;
      END;
      $$;
    `).catch(() => { });
    await pool.query(`DROP TRIGGER IF EXISTS trg_reviews_sync_overall_rating ON reviews`).catch(() => { });
    await pool.query(`
      CREATE TRIGGER trg_reviews_sync_overall_rating
      BEFORE INSERT OR UPDATE ON reviews
      FOR EACH ROW
      EXECUTE FUNCTION reviews_sync_overall_rating();
    `).catch(() => { });
    // Add booking_id, instructor_id, tag_ids columns to reviews if missing
    await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS booking_id UUID`).catch(() => { });
    await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS instructor_id UUID`).catch(() => { });
    await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS tag_ids UUID[] DEFAULT '{}'`).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_reviews_booking ON reviews(booking_id)`).catch(() => { });
    await pool.query(`
      DELETE FROM reviews a
      USING reviews b
      WHERE a.booking_id IS NOT NULL
        AND a.booking_id = b.booking_id
        AND a.created_at < b.created_at
    `).catch(() => { });
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_booking_unique
      ON reviews(booking_id)
      WHERE booking_id IS NOT NULL
    `).catch((err) => {
      console.warn("[DB] Could not create unique review index on booking_id:", err?.message || err);
    });
    // ── Review-tag links (many-to-many) ────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS review_tag_links (
        review_id UUID REFERENCES reviews(id) ON DELETE CASCADE,
        tag_id    UUID REFERENCES review_tags(id) ON DELETE CASCADE,
        PRIMARY KEY (review_id, tag_id)
      );
    `).catch(() => { });
    // ── Loyalty transactions table ─────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS loyalty_transactions (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type        VARCHAR(10) NOT NULL CHECK (type IN ('earn','redeem','adjust')),
        points      INTEGER NOT NULL,
        description TEXT,
        created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_loyalty_tx_user ON loyalty_transactions(user_id)`).catch(() => { });
    // ── referrals table (tracks which users were referred) ─────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        referral_code_id UUID REFERENCES referral_codes(id) ON DELETE CASCADE,
        referred_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        rewarded         BOOLEAN DEFAULT false,
        created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code_id)`).catch(() => { });
    // ── orders: add missing columns if needed ─────────────────────────────
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) DEFAULT 0`).catch(() => { });
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_code_id UUID REFERENCES discount_codes(id) ON DELETE SET NULL`).catch(() => { });
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS platform_fee DECIMAL(10,2) DEFAULT 0`).catch(() => { });
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel VARCHAR(30) DEFAULT 'web'`).catch(() => { });
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS plan_id UUID`).catch(() => { });
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE`).catch(() => { });
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS verified_by UUID`).catch(() => { });
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE`).catch(() => { });
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS approved_by UUID`).catch(() => { });
    // Backfill approved_at for previously-approved orders so they show up
    // in the payments history (criterio: status='approved').
    await pool.query(`
      UPDATE orders
         SET approved_at = COALESCE(approved_at, verified_at, paid_at, updated_at, created_at, NOW())
       WHERE status = 'approved' AND approved_at IS NULL
    `).catch(() => { });
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS complement_type VARCHAR(100)`).catch(() => { });
    // ── plans: admin-only flag (planes ocultos al público; usables en walk-in) ──
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_admin_only BOOLEAN NOT NULL DEFAULT false`).catch(() => { });
    // Idempotent seed: plan "TotalPass 154" admin-only, walk-in.
    // INSERT-IF-MISSING + UPDATE-FLAGS in two queries (no ON CONFLICT since
    // plans.name has no UNIQUE constraint in the canonical schema).
    try {
      const ins = await pool.query(`
        INSERT INTO plans (name, description, price, currency, duration_days, class_limit, class_category, features, is_active, sort_order, is_admin_only)
        SELECT 'TotalPass 154', 'Convenio TotalPass · uso interno walk-in', 154, 'MXN', 1, 1, 'reformer', '["Walk-in TotalPass","Solo uso interno"]'::jsonb, true, 999, true
        WHERE NOT EXISTS (SELECT 1 FROM plans WHERE LOWER(name) = LOWER('TotalPass 154'))
        RETURNING id
      `);
      // Always force-set the flags so a previously-created row converge al estado
      // correcto. is_active = true: el convenio TotalPass SÍ se usa en TEP (walk-in
      // de admin). Sigue is_admin_only = true → no aparece en el catálogo público,
      // solo en el selector de walk-in del panel.
      const upd = await pool.query(`
        UPDATE plans
           SET is_admin_only = true,
               is_active = true,
               class_category = 'reformer',
               price = COALESCE(NULLIF(price, 0), 154),
               class_limit = COALESCE(class_limit, 1),
               duration_days = COALESCE(duration_days, 1),
               updated_at = NOW()
         WHERE LOWER(name) = LOWER('TotalPass 154')
         RETURNING id, is_admin_only, is_active
      `);
      console.log(`[seed] TotalPass 154 — inserted=${ins.rowCount}, ensured=${upd.rowCount}`);
    } catch (e) {
      console.warn("[seed] TotalPass 154 failed:", e.message);
    }
    // ── orders: one-time inscription (enrollment) fee charged with a package ──
    // Idempotent column. Defaults to 0 so existing/non-package orders are unaffected.
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS inscription_amount DECIMAL(10,2) DEFAULT 0`).catch(() => { });
    // ── plans: "Inscripción" IS buyable standalone by the client. Paying it on
    //    its own enrolls the student (so "Clase Extra" unlocks) WITHOUT granting
    //    any class credits. It is still auto-added as a fee to package orders for
    //    students who buy a package first. Visible (not admin-only) and active.
    await pool.query(`UPDATE plans SET is_admin_only = false, is_active = true, updated_at = NOW() WHERE name = 'Inscripción'`).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_discount_code_id ON orders(discount_code_id)`).catch(() => { });
    // Make plan_id nullable (POS orders don't always have a plan)
    await pool.query(`ALTER TABLE orders ALTER COLUMN plan_id DROP NOT NULL`).catch(() => { });
    // Make user_id nullable (walk-in POS sales may not have a user)
    await pool.query(`ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL`).catch(() => { });
    // ── memberships: add order_id column ─────────────────────────────────
    await pool.query(`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS order_id UUID`).catch(() => { });
    // idx_memberships_order: NO debe ser único. Una orden de carrito crea VARIAS
    // membresías con el mismo order_id (p.ej. "Paquete 9" + "Clase Extra ×3", o
    // cantidades > 1). El índice único rompía "Verificar y activar" en esas órdenes
    // (duplicate key → 500, la orden quedaba atascada en pending_verification). La
    // idempotencia de aprobación ya está garantizada en código: createMembershipsForOrder
    // reactiva si ya existen + el endpoint verify hace SELECT ... FOR UPDATE de la orden.
    await pool.query(`DROP INDEX IF EXISTS idx_memberships_order`).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_memberships_order ON memberships(order_id) WHERE order_id IS NOT NULL`).catch(() => { });
    // ── memberships: add fallback name/limit override columns ─────────────
    await pool.query(`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS plan_name_override VARCHAR(255)`).catch(() => { });
    await pool.query(`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS class_limit_override INTEGER`).catch(() => { });
    // Fix existing 9999 unlimited sentinel values → NULL
    await pool.query(`
      UPDATE memberships SET classes_remaining = NULL WHERE classes_remaining >= 9999;
    `).catch(() => { });
    await pool.query(`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS notes TEXT`).catch(() => { });
    // ── consultations table: track complement consultations ──────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        membership_id   UUID REFERENCES memberships(id) ON DELETE SET NULL,
        user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
        complement_type VARCHAR(100) NOT NULL,
        complement_name VARCHAR(255),
        specialist      VARCHAR(255),
        status          VARCHAR(30) DEFAULT 'pending',
        scheduled_date  TIMESTAMP WITH TIME ZONE,
        notes           TEXT,
        completed_at    TIMESTAMP WITH TIME ZONE,
        created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `).catch(() => { });
    // ── memberships: track how many times a user has cancelled ────────────
    await pool.query(`
      ALTER TABLE memberships ADD COLUMN IF NOT EXISTS cancellations_used INTEGER NOT NULL DEFAULT 0;
    `).catch(() => { });
    // ── bookings: track who cancelled (user | admin | system) ─────────────
    // This prevents startup reconciliation from counting admin-initiated
    // cancellations against the client's cancellation limit.
    await pool.query(`
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(10) DEFAULT NULL;
    `).catch(() => { });
    // ── Reconcile cancellations_used — count user- AND admin-initiated cancels ──
    // Admin cancellations now follow the same rules as client cancellations
    // (they count against the per-membership limit). System-initiated cancels
    // (cancelled_by = 'system', e.g. class cancelled wholesale) do NOT count.
    // Bookings with cancelled_by IS NULL predate the column — treat as 'user'.
    await pool.query(`
      UPDATE memberships m
      SET cancellations_used = sub.cnt
      FROM (
        SELECT b.membership_id, COUNT(*) AS cnt
        FROM bookings b
        WHERE b.status = 'cancelled'
          AND b.membership_id IS NOT NULL
          AND (b.cancelled_by IS NULL OR b.cancelled_by IN ('user', 'admin'))
        GROUP BY b.membership_id
      ) sub
      WHERE m.id = sub.membership_id AND m.cancellations_used != sub.cnt;
    `).catch(() => { });
    // Memberships whose only cancels were system-initiated (or none) should
    // reconcile back to 0 — the UPDATE above only touches rows present in the
    // subquery, so handle the empty case separately.
    await pool.query(`
      UPDATE memberships m
      SET cancellations_used = 0
      WHERE m.cancellations_used <> 0
        AND NOT EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.membership_id = m.id
            AND b.status = 'cancelled'
            AND (b.cancelled_by IS NULL OR b.cancelled_by IN ('user', 'admin'))
        );
    `).catch(() => { });
    // ── Drop legacy triggers que duplicaban la lógica de la app ───────────
    // Ver INCIDENTE-CLASES-DUPLICADAS.md: los triggers decrementaban
    // classes_remaining y current_bookings por un lado, mientras que el
    // backend también lo hacía en código — resultado: doble descuento por
    // check-in. Idempotente: si schema_complete.sql los reinstala, el
    // próximo arranque los vuelve a borrar.
    await pool.query(`DROP TRIGGER IF EXISTS trigger_decrement_classes ON bookings`).catch(() => { });
    await pool.query(`DROP FUNCTION IF EXISTS decrement_membership_classes() CASCADE`).catch(() => { });
    await pool.query(`DROP TRIGGER IF EXISTS trigger_update_booking_count ON bookings`).catch(() => { });
    await pool.query(`DROP FUNCTION IF EXISTS update_class_booking_count() CASCADE`).catch(() => { });
    // ── Reconcile current_bookings counter with actual confirmed bookings ──
    // LEFT JOIN ensures classes without any booking rows are also reset to 0.
    await pool.query(`
      UPDATE classes c
      SET current_bookings = sub.cnt
      FROM (
        SELECT c2.id AS class_id,
               COALESCE(COUNT(b.id) FILTER (WHERE b.status IN ('confirmed','checked_in')), 0)::int AS cnt
        FROM classes c2
        LEFT JOIN bookings b ON b.class_id = c2.id
        GROUP BY c2.id
      ) sub
      WHERE c.id = sub.class_id AND c.current_bookings IS DISTINCT FROM sub.cnt;
    `).catch(() => { });
    // ── homepage_video_cards: editable 3-card section on landing page ──────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS homepage_video_cards (
        id          SERIAL PRIMARY KEY,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        title       VARCHAR(120) NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        emoji       VARCHAR(10)  NOT NULL DEFAULT '🎬',
        video_url   TEXT,
        updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `).catch(() => { });
    // Add video_url column if table already existed
    await pool.query(`ALTER TABLE homepage_video_cards ADD COLUMN IF NOT EXISTS video_url TEXT`).catch(() => { });
    // Add thumbnail_url column for custom poster images
    await pool.query(`ALTER TABLE homepage_video_cards ADD COLUMN IF NOT EXISTS thumbnail_url TEXT`).catch(() => { });
    // seed default cards only when table is empty
    await pool.query(`
      INSERT INTO homepage_video_cards (sort_order, title, description, emoji)
      SELECT * FROM (VALUES
        (1, 'Pilates Matt Clásico', 'Fortalece tu core y mejora tu postura con movimientos controlados.', 'dumbbell'),
        (2, 'Flex & Flow',   'Secuencias fluidas para ganar flexibilidad y conciencia corporal.',     'waves'),
        (3, 'Body Strong',    'Entrenamiento funcional para fortalecer todo tu cuerpo.',        'activity')
      ) AS v(sort_order, title, description, emoji)
      WHERE NOT EXISTS (SELECT 1 FROM homepage_video_cards LIMIT 1);
    `).catch(() => { });
    // Migrate old emoji values to icon keys
    await pool.query(`
      UPDATE homepage_video_cards SET emoji = CASE emoji
        WHEN '🏋️' THEN 'dumbbell' WHEN '🏋' THEN 'dumbbell'
        WHEN '💃' THEN 'music' WHEN '🧘' THEN 'waves'
        WHEN '🔥' THEN 'flame' WHEN '⚡' THEN 'zap'
        WHEN '❤️' THEN 'heart' WHEN '💪' THEN 'activity'
        WHEN '✨' THEN 'sparkles' WHEN '🎬' THEN 'activity'
        ELSE emoji END
      WHERE emoji NOT IN ('dumbbell','music','waves','flame','zap','heart','activity','sparkles');
    `).catch(() => { });
    // ── discount_codes: normalise discount_type values ────────────────────
    await pool.query(`ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS min_order_amount DECIMAL(10,2) DEFAULT 0`).catch(() => { });
    await pool.query(`ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES plans(id) ON DELETE SET NULL`).catch(() => { });
    await pool.query(`ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS class_category VARCHAR(20)`).catch(() => { });
    await pool.query(`ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS channel VARCHAR(20) DEFAULT 'all'`).catch(() => { });
    await pool.query(`ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_discount_codes_plan ON discount_codes(plan_id)`).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_discount_codes_category ON discount_codes(class_category)`).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_discount_codes_channel ON discount_codes(channel)`).catch(() => { });
    await pool.query(`UPDATE discount_codes SET discount_type = 'percent' WHERE discount_type IN ('percentage', 'porcentaje', '%')`).catch(() => { });
    await pool.query(`UPDATE discount_codes SET channel = 'all' WHERE channel IS NULL OR channel = ''`).catch(() => { });
    await pool.query(`UPDATE discount_codes SET class_category = NULL WHERE class_category NOT IN ('all','pilates','bienestar','funcional','mixto','reformer','barre')`).catch(() => { });
    // ── bookings: add checked_in_at column ────────────────────────────────
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMP WITH TIME ZONE`).catch(() => { });
    // ── bookings: walk-in support (nullable user_id + guest_name/phone + order link) ─
    await pool.query(`ALTER TABLE bookings ALTER COLUMN user_id DROP NOT NULL`).catch(() => { });
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_name TEXT`).catch(() => { });
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_phone TEXT`).catch(() => { });
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE SET NULL`).catch(() => { });
    // ── orders: walk-in support (nullable user_id was set earlier; add guest fields) ─
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_name TEXT`).catch(() => { });
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_phone TEXT`).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_guest_phone ON orders(guest_phone) WHERE guest_phone IS NOT NULL`).catch(() => { });
    // Prevent duplicate active bookings (same user + same class)
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_user_class_active
      ON bookings (user_id, class_id)
      WHERE status NOT IN ('cancelled')
    `).catch(() => { });
    // Drop the legacy full UNIQUE constraint on (class_id, user_id) that was
    // created by schema_complete.sql. It includes cancelled rows, so re-booking
    // a user after cancellation fails the INSERT even though the active-booking
    // partial index (idx_bookings_user_class_active) correctly allows it.
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conrelid = 'bookings'::regclass
             AND conname   = 'unique_booking'
             AND contype   = 'u'
        ) THEN
          ALTER TABLE bookings DROP CONSTRAINT unique_booking;
        END IF;
      END $$;
    `).catch(() => { });
    // Speed up the per-class booking count used by /api/classes and
    // /api/admin/classes. Without this index, the COUNT subquery in those
    // endpoints does a sequential scan over `bookings` for every class row,
    // which is what caused the /classes 503 under load.
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_bookings_class_active
      ON bookings (class_id)
      WHERE status IN ('confirmed','checked_in')
    `).catch(() => { });
    // ── Settings table ─────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key        VARCHAR(100) PRIMARY KEY,
        value      JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      ["general_settings", JSON.stringify(DEFAULT_GENERAL_SETTINGS)],
    ).catch(() => { });
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      ["policies_settings", JSON.stringify(DEFAULT_POLICIES_SETTINGS)],
    ).catch(() => { });
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      ["notification_settings", JSON.stringify(DEFAULT_NOTIFICATION_SETTINGS)],
    ).catch(() => { });
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      ["notification_templates", JSON.stringify(DEFAULT_NOTIFICATION_TEMPLATES)],
    ).catch(() => { });
    // Lealtad fuera de alcance para Tu Espacio Pilates VM: persistimos el
    // config deshabilitado (INSERT-if-missing). Sin esta fila, los sitios de
    // acumulación leen cfg={} y `cfg.enabled !== false` deja acumular puntos
    // de forma invisible. Con enabled:false la acumulación queda apagada.
    // No sobrescribe un config que un admin haya guardado (DO NOTHING).
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      ["loyalty_config", JSON.stringify({ enabled: false, points_per_class: 10, points_per_peso: 1, welcome_bonus: 50, birthday_bonus: 100 })],
    ).catch(() => { });
    for (const [settingKey, defaults] of Object.entries(DEFAULT_SETTINGS_BY_KEY)) {
      await pool.query(
        `UPDATE settings
            SET value = $2::jsonb || COALESCE(value, '{}'::jsonb),
                updated_at = NOW()
          WHERE key = $1 AND jsonb_typeof(value) = 'object'`,
        [settingKey, JSON.stringify(defaults)],
      ).catch(() => { });
    }
    // ── Loyalty rewards table ──────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS loyalty_rewards (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name         VARCHAR(150) NOT NULL,
        description  TEXT,
        points_cost  INTEGER NOT NULL,
        reward_type  VARCHAR(30) NOT NULL DEFAULT 'custom',
        reward_value VARCHAR(150),
        stock        INTEGER,
        is_active    BOOLEAN DEFAULT true,
        created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // ── Loyalty rewards: add new columns if table already exists ───────────
    await pool.query(`ALTER TABLE loyalty_rewards ADD COLUMN IF NOT EXISTS reward_type  VARCHAR(30) NOT NULL DEFAULT 'custom'`).catch(() => { });
    await pool.query(`ALTER TABLE loyalty_rewards ADD COLUMN IF NOT EXISTS reward_value VARCHAR(150)`).catch(() => { });
    await pool.query(`ALTER TABLE loyalty_rewards ADD COLUMN IF NOT EXISTS stock        INTEGER`).catch(() => { });
    // ── Apple Wallet device registration table ────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS apple_wallet_devices (
        id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        device_id      VARCHAR(255) NOT NULL,
        push_token     VARCHAR(255) NOT NULL DEFAULT '',
        pass_type_id   VARCHAR(255) NOT NULL,
        serial_number  VARCHAR(255) NOT NULL,
        created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(device_id, pass_type_id, serial_number)
      );
    `).catch(() => { });
    // Backward compatibility: some DBs still have the old wallet schema
    // (device_id, pass_type_id, membership_id) without serial_number.
    await pool.query(`ALTER TABLE apple_wallet_devices ADD COLUMN IF NOT EXISTS serial_number VARCHAR(255)`).catch(() => { });
    await pool.query(`ALTER TABLE apple_wallet_devices ADD COLUMN IF NOT EXISTS pass_type_id VARCHAR(255)`).catch(() => { });
    await pool.query(`ALTER TABLE apple_wallet_devices ADD COLUMN IF NOT EXISTS push_token VARCHAR(255) NOT NULL DEFAULT ''`).catch(() => { });
    await pool.query(`
      UPDATE apple_wallet_devices
      SET serial_number = CONCAT(
        'legacy_',
        REPLACE(COALESCE(membership_id::text, id::text), '-', '')
      )
      WHERE serial_number IS NULL OR serial_number = ''
    `).catch(() => { });
    await pool.query(`ALTER TABLE apple_wallet_devices ALTER COLUMN serial_number SET NOT NULL`).catch(() => { });
    await pool.query(`ALTER TABLE apple_wallet_devices ALTER COLUMN membership_id DROP NOT NULL`).catch(() => { });
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_apple_wallet_devices_device_pass_serial
      ON apple_wallet_devices(device_id, pass_type_id, serial_number)
    `).catch(() => { });
    // ── Wallet push notifications log ─────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallet_notification_logs (
        id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
        reason         VARCHAR(160) NOT NULL DEFAULT 'wallet_update',
        apple_sent     INTEGER NOT NULL DEFAULT 0,
        apple_failed   INTEGER NOT NULL DEFAULT 0,
        google_synced  BOOLEAN NOT NULL DEFAULT false,
        google_mode    VARCHAR(40),
        status         VARCHAR(20) NOT NULL DEFAULT 'ok',
        detail         JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_wallet_notification_logs_user ON wallet_notification_logs(user_id)`).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_wallet_notification_logs_created_at ON wallet_notification_logs(created_at DESC)`).catch(() => { });
    // ── Review tags table ──────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS review_tags (
        id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name       VARCHAR(100) NOT NULL,
        color      VARCHAR(20) DEFAULT '#c026d3',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // ── Videos: add price column (may fail if videos table not yet created) ─
    await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS price DECIMAL(10,2)`).catch(() => { });
    await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false`).catch(() => { });
    await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS drive_file_id VARCHAR(500)`).catch(() => { });
    await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS cloudinary_id VARCHAR(500)`).catch(() => { });
    await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS thumbnail_drive_id VARCHAR(500)`).catch(() => { });
    await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS duration_seconds INTEGER DEFAULT 0`).catch(() => { });
    await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS subtitle VARCHAR(255)`).catch(() => { });
    await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS tagline VARCHAR(255)`).catch(() => { });
    await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS days VARCHAR(100)`).catch(() => { });
    await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS brand_color VARCHAR(7)`).catch(() => { });
    await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS sales_enabled BOOLEAN DEFAULT false`).catch(() => { });
    await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS sales_unlocks_video BOOLEAN DEFAULT false`).catch(() => { });
    await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS sales_price_mxn DECIMAL(10,2)`).catch(() => { });
    await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS sales_class_credits INTEGER`).catch(() => { });
    await pool.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS sales_cta_text VARCHAR(100)`).catch(() => { });
    // ── Video purchases: add admin_notes and verified_at ──────────────────
    await pool.query(`ALTER TABLE video_purchases ADD COLUMN IF NOT EXISTS admin_notes TEXT`).catch(() => { });
    await pool.query(`ALTER TABLE video_purchases ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE`).catch(() => { });

    // ── Módulo de Eventos ────────────────────────────────────────────────
    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE event_type AS ENUM (
          'masterclass','workshop','retreat','challenge','openhouse','special'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        type                event_type NOT NULL,
        title               VARCHAR(200) NOT NULL,
        description         TEXT NOT NULL,
        instructor_name     VARCHAR(100) NOT NULL,
        instructor_photo    TEXT,
        date                DATE NOT NULL,
        start_time          TIME NOT NULL,
        end_time            TIME NOT NULL,
        location            VARCHAR(200) NOT NULL,
        capacity            INTEGER NOT NULL DEFAULT 1,
        registered          INTEGER DEFAULT 0,
        price               NUMERIC(10,2) NOT NULL DEFAULT 0,
        currency            VARCHAR(3) DEFAULT 'MXN',
        early_bird_price    NUMERIC(10,2),
        early_bird_deadline DATE,
        member_discount     NUMERIC(5,2) DEFAULT 0,
        image               TEXT,
        requirements        VARCHAR(500) DEFAULT '',
        includes            JSONB DEFAULT '[]',
        tags                JSONB DEFAULT '[]',
        status              VARCHAR(20) DEFAULT 'draft',
        created_by          UUID,
        created_at          TIMESTAMPTZ DEFAULT NOW(),
        updated_at          TIMESTAMPTZ DEFAULT NOW()
      );
    `).catch(() => { });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS event_registrations (
        id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        event_id                UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        user_id                 UUID,
        name                    VARCHAR(100) NOT NULL,
        email                   VARCHAR(255) NOT NULL,
        phone                   VARCHAR(20) DEFAULT '',
        status                  VARCHAR(20) DEFAULT 'pending',
        amount                  NUMERIC(10,2) DEFAULT 0,
        payment_method          VARCHAR(20),
        payment_reference       VARCHAR(200),
        payment_proof_url       TEXT,
        payment_proof_file_name VARCHAR(255),
        transfer_date           DATE,
        paid_at                 TIMESTAMPTZ,
        checked_in              BOOLEAN DEFAULT false,
        checked_in_at           TIMESTAMPTZ,
        checked_in_by           UUID,
        waitlist_position       INTEGER,
        notes                   TEXT,
        created_at              TIMESTAMPTZ DEFAULT NOW(),
        updated_at              TIMESTAMPTZ DEFAULT NOW()
      );
    `).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_status    ON events(status)`).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_date       ON events(date)`).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_type       ON events(type)`).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_event_regs_event  ON event_registrations(event_id)`).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_event_regs_user   ON event_registrations(user_id)`).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_event_regs_status ON event_registrations(status)`).catch(() => { });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS event_passes (
        id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        event_id       UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        registration_id UUID REFERENCES event_registrations(id) ON DELETE SET NULL,
        user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pass_code      VARCHAR(60) NOT NULL UNIQUE,
        status         VARCHAR(20) NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','used','cancelled')),
        issued_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        used_at        TIMESTAMPTZ,
        cancelled_at   TIMESTAMPTZ,
        created_at     TIMESTAMPTZ DEFAULT NOW(),
        updated_at     TIMESTAMPTZ DEFAULT NOW()
      );
    `).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_event_passes_user ON event_passes(user_id)`).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_event_passes_event ON event_passes(event_id)`).catch(() => { });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_event_passes_status ON event_passes(status)`).catch(() => { });
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_event_passes_registration_unique ON event_passes(registration_id) WHERE registration_id IS NOT NULL`).catch(() => { });

    // ── MercadoPago: columnas de pago en orders + idempotencia de webhooks ──
    await pool.query(`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS payment_provider   VARCHAR(50),
        ADD COLUMN IF NOT EXISTS payment_intent_id  VARCHAR(255),
        ADD COLUMN IF NOT EXISTS mp_checkout_url    TEXT,
        ADD COLUMN IF NOT EXISTS mp_payment_id      VARCHAR(255),
        ADD COLUMN IF NOT EXISTS mp_payment_status  VARCHAR(50),
        ADD COLUMN IF NOT EXISTS mp_status_detail   VARCHAR(100),
        ADD COLUMN IF NOT EXISTS provider_synced_at TIMESTAMP WITH TIME ZONE;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_webhook_events (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        provider     VARCHAR(50) NOT NULL,
        event_key    VARCHAR(255) NOT NULL,
        event_type   VARCHAR(50),
        payload      JSONB DEFAULT '{}'::jsonb,
        processed_at TIMESTAMP WITH TIME ZONE,
        created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE (provider, event_key)
      );
    `);
    console.log("✅ MercadoPago: columnas orders + payment_webhook_events listas");

    // ── booking_reschedules: audit trail for PUT /api/bookings/:id/reschedule ──
    await pool.query(`
      CREATE TABLE IF NOT EXISTS booking_reschedules (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        booking_id  UUID,
        user_id     UUID,
        from_class_id UUID,
        to_class_id   UUID,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_booking_reschedules_user ON booking_reschedules(user_id)`).catch(() => { });

    console.log("✅ Schema ensured");
  } catch (err) {
    console.error("Schema migration warning:", err.message);
  }

  // ── Seed classes for the next 4 weeks FROM the VM schedule (schedule_slots) ──
  try {
    // 1) Ensure at least one active instructor exists, linked to a coach user.
    //    instructors.user_id is NOT NULL (FK → users), so we must create the
    //    user first, then the instructor row that references it.
    const instCount = await pool.query(
      "SELECT COUNT(*) FROM instructors WHERE is_active = true"
    );
    if (parseInt(instCount.rows[0].count) === 0) {
      const coachHash = await bcrypt.hash("Coach2026!", 12);
      const coachUserRes = await pool.query(
        `INSERT INTO users (display_name, email, phone, password_hash, role, is_active)
         VALUES ('Coach Tu Espacio', 'coach@tuespaciopilatesvm.mx', '0000000000', $1, 'instructor', true)
         ON CONFLICT (email) DO UPDATE SET role = 'instructor'
         RETURNING id`,
        [coachHash]
      );
      const coachUserId = coachUserRes.rows[0].id;
      await pool.query(
        `INSERT INTO instructors (user_id, display_name, email, bio, specialties, is_active)
         VALUES ($1, 'Coach Tu Espacio', 'coach@tuespaciopilatesvm.mx', 'Coach certificada de Pilates.', '["Pilates"]'::jsonb, true)
         ON CONFLICT DO NOTHING`,
        [coachUserId]
      );
      console.log("✅ Seeded Tu Espacio Pilates coach");
    }

    // 2) Generate bookable classes from schedule_slots (cap 8), next 4 weeks.
    //    Only on a fresh DB (classes empty); the versioned RESYNC below handles
    //    regeneration for already-seeded live DBs. generateClassesFromSchedule
    //    is idempotent and copies each slot's apparatus onto the class.
    const classCount = await pool.query("SELECT COUNT(*) FROM classes");
    if (parseInt(classCount.rows[0].count) === 0) {
      const inserted = await generateClassesFromSchedule({ weeks: 4 });
      console.log(`✅ Seeded ${inserted} classes (VM schedule, próximas 4 semanas)`);
    }
  } catch (err) {
    console.error("Demo classes seed warning:", err.message);
  }

  // ── One-time versioned RESYNC of schedule_slots + future classes ──────────
  // The live DB (tep_vm) already holds the OLD schedule + classes, so the
  // empty-table guards above never fire for it. This block runs ONCE per
  // deploy of SCHEDULE_VERSION (tracked via the `schedule_version` settings
  // key) to: (a) replace schedule_slots with the canonical 23 slots, (b) drop
  // ONLY future un-booked classes, and (c) regenerate from the new schedule.
  // It NEVER deletes a class that has a non-cancelled booking, and is wrapped
  // so a failure logs and continues rather than crashing boot.
  try {
    const SCHEDULE_VERSION = "vm-2026-06-28-55min";
    const markerRes = await pool.query(
      "SELECT value FROM settings WHERE key = 'schedule_version' LIMIT 1"
    );
    // value is JSONB (e.g. "vm-2026-06-27-tower"); pg already parses it to a JS string.
    const storedVersion = markerRes.rows[0]?.value ?? null;
    if (storedVersion !== SCHEDULE_VERSION) {
      console.log(
        `↻ Schedule RESYNC: stored=${JSON.stringify(storedVersion)} → ${SCHEDULE_VERSION}`
      );
      // a) Replace schedule_slots with the canonical 23 slots (with apparatus).
      await pool.query("DELETE FROM schedule_slots");
      await buildScheduleSlotsInsert(pool);
      // b) Delete ONLY future classes with no non-cancelled booking. A class
      //    referenced by any confirmed/checked-in/waitlisted booking is kept.
      const del = await pool.query(`
        DELETE FROM classes
        WHERE date >= CURRENT_DATE
          AND id NOT IN (
            SELECT DISTINCT class_id FROM bookings
            WHERE status <> 'cancelled' AND class_id IS NOT NULL
          )
        RETURNING id
      `);
      // c) Regenerate bookable classes from the new schedule (next 4 weeks).
      const regen = await generateClassesFromSchedule({ weeks: 4 });
      // c2) Normalizar duración: TODAS las clases futuras (incluidas las ya
      //     reservadas) a 55 min — corrige los end_time de 60 min que generaba
      //     la versión anterior (addScheduleHour sumaba 60).
      const durFix = await pool.query(
        `UPDATE classes
            SET end_time = start_time + (interval '1 minute' * $1)
          WHERE date >= CURRENT_DATE
            AND status <> 'cancelled'
            AND end_time <> start_time + (interval '1 minute' * $1)
         RETURNING id`,
        [CLASS_DURATION_MIN]
      );
      // c3) Reflejar 55 min también en el tipo de clase (lo muestra el admin).
      await pool.query(
        `UPDATE class_types SET duration_min = $1
          WHERE is_active = true AND COALESCE(duration_min, 0) <> $1`,
        [CLASS_DURATION_MIN]
      );
      // d) Persist the version marker so this block runs once per deploy.
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ('schedule_version', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [JSON.stringify(SCHEDULE_VERSION)]
      );
      console.log(
        `✅ Schedule RESYNC done: deleted ${del.rowCount} future un-booked classes, regenerated ${regen}, normalized ${durFix.rowCount} durations to ${CLASS_DURATION_MIN}min, marker=${SCHEDULE_VERSION}`
      );
    }
  } catch (err) {
    console.error("Schedule RESYNC warning (continuing):", err.message);
  }


  try {
    const adminEmail = process.env.ADMIN_EMAIL || "espaciopilatesvm@gmail.com";
    const adminPass = process.env.ADMIN_PASSWORD || "EspacioVM2026!";
    const adminHash = await bcrypt.hash(adminPass, 12);
    // El admin se crea con ADMIN_PASSWORD SOLO la primera vez. En arranques
    // posteriores únicamente se reafirma el rol 'admin' — NO se reescribe la
    // contraseña — para que la dueña pueda cambiarla/recuperarla ("olvidé
    // contraseña") y ningún deploy futuro la revierta.
    await pool.query(
      `INSERT INTO users (display_name, email, phone, password_hash, role, accepts_terms, accepts_communications)
       VALUES ('Admin Tu Espacio', $1, '0000000000', $2, 'admin', true, false)
       ON CONFLICT (email) DO UPDATE SET role = 'admin'`,
      [adminEmail, adminHash]
    );
    console.log(`✅ Admin user ready: ${adminEmail}`);
  } catch (err) {
    console.error("Admin seed warning:", err.message);
  }

  // ── Admin extra (bootstrap de UNA sola vez): pilatestuespacio@gmail.com ────
  // Se asegura como admin con una contraseña TEMPORAL (hash bcrypt precomputado;
  // la clave en texto NO vive en el código). Es one-time vía una flag en
  // settings: tras esta vez NO se vuelve a tocar password_hash, así que cuando
  // la cambie desde el panel, ningún deploy futuro la revierte.
  try {
    const EXTRA_ADMIN_FLAG = "extra_admin_pilatestuespacio_v1";
    const already = await pool.query("SELECT 1 FROM settings WHERE key = $1 LIMIT 1", [EXTRA_ADMIN_FLAG]);
    if (already.rows.length === 0) {
      const EXTRA_ADMIN_EMAIL = "pilatestuespacio@gmail.com";
      const EXTRA_ADMIN_TEMP_HASH = "$2a$12$CCnY0Ne/pz35CrMzHSTx.eWdHLH25HjMH4xk42eBe3SkwZ1Pye2qe";
      await pool.query(
        `INSERT INTO users (display_name, email, phone, password_hash, role, accepts_terms, accepts_communications)
         VALUES ('Tu Espacio Pilates', $1, '0000000000', $2, 'admin', true, false)
         ON CONFLICT (email) DO UPDATE SET role = 'admin', password_hash = $2`,
        [EXTRA_ADMIN_EMAIL, EXTRA_ADMIN_TEMP_HASH]
      );
      await pool.query(
        "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()",
        [EXTRA_ADMIN_FLAG, JSON.stringify("done")]
      );
      console.log("✅ Admin extra listo (one-time): pilatestuespacio@gmail.com");
    }
  } catch (err) {
    console.error("Extra admin seed warning:", err.message);
  }

  // ── Cuenta OCULTA (alumno): saidromero19@gmail.com ─────────────────────────
  // Alumno (role=client) que NO aparece en ninguna lista NI conteo del panel
  // (is_hidden=true) — los filtros COALESCE(is_hidden,false)=false la excluyen.
  // Bootstrap idempotente vía flag versionada en settings; el teléfono se fija a
  // un valor único para no chocar con el índice único parcial uq_users_phone_client.
  // La contraseña en texto NO vive en el código (solo el hash, usado solo si la
  // cuenta no existía) y NO se reescribe aquí, para no revertir un cambio del dueño.
  try {
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false");
    const HIDDEN_ACCT_FLAG = "hidden_account_saidromero_v2_client";
    const already = await pool.query("SELECT 1 FROM settings WHERE key = $1 LIMIT 1", [HIDDEN_ACCT_FLAG]);
    if (already.rows.length === 0) {
      const HIDDEN_EMAIL = "saidromero19@gmail.com";
      const HIDDEN_HASH = "$2a$12$i/Lp1QBwi8zkLOIfSEDmAuF8A38r5RQIATxwUtQ8vl1P55HXGZDLq"; // Said4321! (solo si no existía)
      await pool.query(
        `INSERT INTO users (display_name, email, phone, password_hash, role, accepts_terms, accepts_communications, is_hidden)
         VALUES ('Soporte', $1, '0000000019', $2, 'client', true, false, true)
         ON CONFLICT (email) DO UPDATE SET role = 'client', is_hidden = true, phone = '0000000019'`,
        [HIDDEN_EMAIL, HIDDEN_HASH]
      );
      await pool.query(
        "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()",
        [HIDDEN_ACCT_FLAG, JSON.stringify("done")]
      );
      console.log("✅ Cuenta oculta (alumno) lista (one-time)");
    }
  } catch (err) {
    console.error("Hidden account seed warning:", err.message);
  }
}

// ─── Middleware ──────────────────────────────────────────────────────────────
const CORS_ALLOWED_ORIGINS = String(
  process.env.CORS_ALLOWED_ORIGINS ||
  "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,https://www.tuespaciopilates.com.mx,https://tuespaciopilates.com.mx",
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const SECURITY_RATE_LIMIT_WINDOW_MS = Math.max(10_000, Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60_000));
const SECURITY_RATE_LIMIT_MAX = Math.max(30, Number(process.env.API_RATE_LIMIT_MAX || 180));
const SECURITY_AUTH_WINDOW_MS = Math.max(10_000, Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 60_000));
const SECURITY_AUTH_MAX = Math.max(5, Number(process.env.AUTH_RATE_LIMIT_MAX || 20));

app.disable("x-powered-by");
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (CORS_ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    if (origin.endsWith(".up.railway.app")) return callback(null, true);
    // Dominio de producción + cualquier subdominio (www, etc.), http o https.
    if (/^https?:\/\/([a-z0-9-]+\.)*tuespaciopilates\.com\.mx$/i.test(origin)) return callback(null, true);
    // Evita lanzar un error 500. Se retorna false para no enviar cabeceras CORS.
    return callback(null, false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  next();
});

const rateLimitBuckets = new Map();
function getRateLimitIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  if (forwarded) return forwarded;
  return String(req.ip || req.socket?.remoteAddress || "unknown");
}
function createSimpleRateLimiter({ windowMs, max, keyPrefix, shouldApply }) {
  return (req, res, next) => {
    if (!shouldApply(req)) return next();
    const ip = getRateLimitIp(req);
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const current = rateLimitBuckets.get(key);
    if (!current || current.resetAt <= now) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (current.count >= max) {
      const retryAfterSec = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({ message: "Demasiadas solicitudes. Intenta de nuevo en unos segundos." });
    }
    current.count += 1;
    return next();
  };
}
// Best-effort in-memory cleanup to avoid unbounded map growth.
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitBuckets.entries()) {
    if (!value || value.resetAt <= now) rateLimitBuckets.delete(key);
  }
}, 60_000).unref();

app.use(createSimpleRateLimiter({
  windowMs: SECURITY_RATE_LIMIT_WINDOW_MS,
  max: SECURITY_RATE_LIMIT_MAX,
  keyPrefix: "api",
  shouldApply: (req) =>
    req.path.startsWith("/api/") &&
    !req.path.startsWith("/api/wallet/v1/") &&
    req.path !== "/api/webhook/evolution",
}));
app.use(createSimpleRateLimiter({
  windowMs: SECURITY_AUTH_WINDOW_MS,
  max: SECURITY_AUTH_MAX,
  keyPrefix: "auth",
  shouldApply: (req) =>
    req.path === "/api/auth/login" ||
    req.path === "/api/auth/register" ||
    req.path === "/api/auth/forgot-password" ||
    req.path === "/api/auth/reset-password",
}));

// Skip JSON body parsing for binary upload-chunk endpoint
app.use((req, res, next) => {
  if (req.path.startsWith("/api/drive/upload-chunk/")) return next();
  express.json({ limit: "20mb" })(req, res, next);
});
app.use((req, res, next) => {
  if (req.path.startsWith("/api/drive/upload-chunk/")) return next();
  express.urlencoded({ extended: true, limit: "20mb" })(req, res, next);
});

// ─── Helper: snake_case → camelCase row mapper ──────────────────────────────
function camelRow(row) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camel] = v;
  }
  return out;
}
function camelRows(rows) { return rows.map(camelRow); }

function normalizeDiscountType(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "percent" || raw === "percentage" || raw === "%") return "percent";
  if (raw === "fixed" || raw === "amount" || raw === "monto") return "fixed";
  return null;
}

function calculateDiscountAmount(type, value, subtotal) {
  const safeSubtotal = Number(subtotal || 0);
  const safeValue = Number(value || 0);
  if (safeSubtotal <= 0 || safeValue <= 0) return 0;
  const normalized = normalizeDiscountType(type);
  const amount = normalized === "percent"
    ? safeSubtotal * (safeValue / 100)
    : safeValue;
  return Math.max(0, Math.min(amount, safeSubtotal));
}

// Valid categories. "reformer" and "barre" are Valiance-specific; "pilates"
// is kept as a legacy alias and treated like "reformer" in compatibility.
function normalizeClassCategory(value, fallback = "all") {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["reformer", "barre", "pilates", "bienestar", "funcional", "mixto", "all"].includes(raw)) {
    // Treat legacy "pilates" as "reformer" for Valiance: the studio's only
    // pilates discipline IS Reformer. This avoids breaking historical data.
    if (raw === "pilates") return "reformer";
    return raw;
  }
  return fallback;
}

function normalizeDiscountChannel(value, fallback = "all") {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["all", "membership", "pos", "event"].includes(raw)) return raw;
  return fallback;
}

function isUnlimitedClasses(value) {
  return value === null || value === undefined || Number(value) >= 9999;
}

// Map class category → discipline_credits key. Combos store keys in
// lowercase ("reformer" / "barre"); legacy "pilates" maps to "reformer".
function classCategoryToDisciplineKey(classCategory) {
  const c = String(classCategory || "").toLowerCase();
  if (c === "reformer" || c === "pilates") return "reformer";
  if (c === "barre") return "barre";
  return null;
}

// Decrements classes_remaining by 1 and, when discipline_credits is present
// and contains the matching key, decrements that key too. No-op for unlimited
// memberships (classes_remaining IS NULL or >= 9999).
async function consumeMembershipCredit(client, membershipId, classCategory) {
  const key = classCategoryToDisciplineKey(classCategory);
  await (client || pool).query(
    `UPDATE memberships
        SET classes_remaining = GREATEST(COALESCE(classes_remaining, 0) - 1, 0),
            discipline_credits = CASE
              WHEN discipline_credits IS NOT NULL
                AND $2::text IS NOT NULL
                AND discipline_credits ? $2::text
              THEN jsonb_set(
                discipline_credits,
                ARRAY[$2::text],
                to_jsonb(GREATEST(COALESCE((discipline_credits->>$2::text)::int, 0) - 1, 0))
              )
              ELSE discipline_credits
            END,
            updated_at = NOW()
      WHERE id = $1
        AND classes_remaining IS NOT NULL
        AND classes_remaining < 9999`,
    [membershipId, key]
  );
}

// Inverse: refund a credit on cancellation / waitlist demotion.
async function refundMembershipCredit(client, membershipId, classCategory) {
  const key = classCategoryToDisciplineKey(classCategory);
  await (client || pool).query(
    `UPDATE memberships
        SET classes_remaining = COALESCE(classes_remaining, 0) + 1,
            discipline_credits = CASE
              WHEN discipline_credits IS NOT NULL
                AND $2::text IS NOT NULL
                AND discipline_credits ? $2::text
              THEN jsonb_set(
                discipline_credits,
                ARRAY[$2::text],
                to_jsonb(COALESCE((discipline_credits->>$2::text)::int, 0) + 1)
              )
              ELSE discipline_credits
            END,
            updated_at = NOW()
      WHERE id = $1
        AND classes_remaining IS NOT NULL
        AND classes_remaining < 9999`,
    [membershipId, key]
  );
}

function isMembershipCategoryCompatible(membershipCategory, classCategory) {
  const memCat = normalizeClassCategory(membershipCategory, "all");
  const clsCat = normalizeClassCategory(classCategory, "all");
  // "all" / "mixto" memberships accept anything.
  if (memCat === "all" || memCat === "mixto") return true;
  // A class with no specific category falls back to compatible for any plan.
  if (clsCat === "all") return true;
  // Strict match otherwise. Reformer plan ↔ reformer class only.
  // Barre plan ↔ barre class only.
  return memCat === clsCat;
}

// ── Clase Muestra (trial) schedule restriction ──────────────────────────────
// Trial plans can only book on specific day+time slots:
//   Monday:   08:20, 19:20
//   Tuesday:  09:30
//   Thursday: 09:30
const TRIAL_ALLOWED_SCHEDULES = [
  { day: 1, time: "08:20" }, // Lunes 8:20 AM
  { day: 1, time: "19:20" }, // Lunes 7:20 PM
  { day: 2, time: "09:25" }, // Martes 9:25 AM
  { day: 4, time: "09:25" }, // Jueves 9:25 AM
];

function isTrialPlan(membership) {
  const rk = String(membership?.repeat_key ?? "").toLowerCase();
  const name = String(membership?.plan_name ?? "").toLowerCase();
  return rk.startsWith("trial_single_session") || name.includes("muestra");
}

function isClassAllowedForTrial(classDate, classStartTime) {
  // Fail-open if the caller forgot to load c.date / c.start_time. Without
  // this guard, `new Date(undefined).getUTCDay()` → NaN, `.some()` → false,
  // and the booking is rejected with the Clase Muestra message — the exact
  // failure mode that produced the Morning Pass admin-assign incident.
  // Returning true here means a missing field can't masquerade as a real
  // schedule violation; the warning surfaces the upstream bug in logs.
  const d = classDate ? new Date(classDate) : null;
  if (!d || Number.isNaN(d.getTime())) {
    console.warn(
      "[isClassAllowedForTrial] missing/invalid classDate — failing open.",
      { classDate, classStartTime }
    );
    return true;
  }
  const timeStr = String(classStartTime ?? "").slice(0, 5); // "HH:MM"
  if (!/^\d{2}:\d{2}$/.test(timeStr)) {
    console.warn(
      "[isClassAllowedForTrial] missing/invalid classStartTime — failing open.",
      { classDate, classStartTime }
    );
    return true;
  }
  const dayOfWeek = d.getUTCDay();
  return TRIAL_ALLOWED_SCHEDULES.some((s) => s.day === dayOfWeek && s.time === timeStr);
}

// ── Generic time-window restriction (e.g. Morning Pass) ──────────────────────
// Plan stores a JSONB shape like:
//   { "days_of_week": [1,2,3,4,5], "hour_range": ["07:00","09:59"] }
// days_of_week uses 0=Sun..6=Sat. hour_range is inclusive HH:MM strings.
// Returns { allowed: boolean, message?: string } so callers can return a
// useful 403. If the membership has no time_restriction, allowed=true.
function checkPlanTimeRestriction(membership, classDate, classStartTime) {
  const raw = membership?.time_restriction;
  if (!raw) return { allowed: true };
  let r = raw;
  if (typeof raw === "string") {
    try { r = JSON.parse(raw); } catch (_) { return { allowed: true }; }
  }
  if (!r || (!Array.isArray(r.days_of_week) && !Array.isArray(r.hour_range))) {
    return { allowed: true };
  }
  // Fail-open guard: if the caller forgot to load c.date / c.start_time the
  // checks below silently coerce (NaN day-of-week, "" time) and block every
  // booking with the plan's own message — which is exactly how the Morning
  // Pass admin-assign regression looked. Allow the booking and log loudly
  // so the missing field gets caught in code review instead of in support.
  const d = classDate ? new Date(classDate) : null;
  if (!d || Number.isNaN(d.getTime())) {
    console.warn(
      "[checkPlanTimeRestriction] missing/invalid classDate — failing open.",
      { membershipId: membership?.id, classDate, classStartTime }
    );
    return { allowed: true };
  }
  const timeStr = String(classStartTime ?? "").slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(timeStr)) {
    console.warn(
      "[checkPlanTimeRestriction] missing/invalid classStartTime — failing open.",
      { membershipId: membership?.id, classDate, classStartTime }
    );
    return { allowed: true };
  }
  const dayOfWeek = d.getUTCDay();
  if (Array.isArray(r.days_of_week) && r.days_of_week.length && !r.days_of_week.includes(dayOfWeek)) {
    return {
      allowed: false,
      message: r.message || "Tu paquete no aplica para este día de la semana.",
    };
  }
  if (Array.isArray(r.hour_range) && r.hour_range.length === 2) {
    const [from, to] = r.hour_range;
    if (timeStr < String(from) || timeStr > String(to)) {
      return {
        allowed: false,
        message: r.message || `Tu paquete solo aplica entre ${from} y ${to}.`,
      };
    }
  }
  return { allowed: true };
}

async function selectMembershipForClass({ userId, classCategory, classDate = null, classStartTime = null, client = null }) {
  if (!userId) return null;
  const q = client ?? pool;
  const clsCat = normalizeClassCategory(classCategory, "all");
  // Fetch ALL qualifying candidates (category + credits + active), then filter
  // by time_restriction in JS so a Morning Pass doesn't block a user who also
  // has a regular Reformer plan applicable to an evening class.
  const r = await q.query(
    `SELECT m.id,
            m.user_id,
            m.classes_remaining,
            m.end_date,
            m.created_at,
            COALESCE(p.class_category, 'all') AS class_category,
            p.repeat_key,
            p.name AS plan_name,
            p.time_restriction
       FROM memberships m
       LEFT JOIN plans p ON p.id = m.plan_id
      WHERE m.user_id = $1
        AND m.status = 'active'
        AND (m.end_date IS NULL OR m.end_date >= COALESCE($3::date, CURRENT_DATE))
        AND (
          COALESCE(p.class_category, 'all') IN ('all', 'mixto')
          OR COALESCE(p.class_category, 'all') = $2
        )
        AND (
          m.classes_remaining IS NULL
          OR m.classes_remaining >= 9999
          OR m.classes_remaining > 0
        )
      ORDER BY
        CASE
          WHEN COALESCE(p.class_category, 'all') = $2 THEN 0
          WHEN COALESCE(p.class_category, 'all') = 'mixto' THEN 1
          WHEN COALESCE(p.class_category, 'all') = 'all' THEN 2
          ELSE 3
        END ASC,
        CASE WHEN m.end_date IS NULL THEN 1 ELSE 0 END ASC,
        m.end_date ASC,
        CASE WHEN m.classes_remaining IS NULL OR m.classes_remaining >= 9999 THEN 1 ELSE 0 END ASC,
        m.created_at ASC`,
    [userId, clsCat, classDate]
  );
  const candidates = r.rows;
  if (!candidates.length) return null;
  // If we don't know the class slot, fall back to first match (legacy callers).
  if (!classDate || !classStartTime) return candidates[0];
  // Prefer a membership whose time_restriction allows this class. If none
  // do, fall back to first so the booking endpoint can return a meaningful
  // restriction-specific 403 instead of "no membership".
  const compatible = candidates.find((m) => checkPlanTimeRestriction(m, classDate, classStartTime).allowed);
  return compatible ?? candidates[0];
}

async function findApplicableDiscountCode({
  code,
  subtotal,
  planId = null,
  classCategory = "all",
  channel = "all",
  client = null,
}) {
  if (!code) return null;
  const q = client ?? pool;
  const normalizedCode = String(code).toUpperCase().trim();
  const normalizedChannel = normalizeDiscountChannel(channel, "all");
  const normalizedCategory = normalizeClassCategory(classCategory, "all");
  const r = await q.query(
    `SELECT *
       FROM discount_codes
      WHERE code = $1
        AND is_active = true
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (max_uses IS NULL OR uses_count < max_uses)
        AND (channel = 'all' OR channel = $2)
        AND (plan_id IS NULL OR plan_id = $3)
        AND (
          class_category IS NULL
          OR class_category = 'all'
          OR class_category = $4
          OR (class_category = 'mixto' AND $4 IN ('pilates','bienestar','funcional'))
        )
      ORDER BY
        CASE WHEN plan_id IS NULL THEN 1 ELSE 0 END ASC,
        CASE WHEN class_category IS NULL OR class_category = 'all' THEN 1 ELSE 0 END ASC
      LIMIT 1`,
    [normalizedCode, normalizedChannel, planId, normalizedCategory]
  );
  if (!r.rows.length) return null;
  const dc = r.rows[0];
  const safeSubtotal = Number(subtotal || 0);
  const minOrderAmount = Number(dc.min_order_amount || 0);
  if (safeSubtotal < minOrderAmount) {
    return {
      code: dc,
      discountAmount: 0,
      minOrderAmount,
      rejectedByMinOrder: true,
    };
  }
  const discountAmount = calculateDiscountAmount(dc.discount_type, dc.discount_value, safeSubtotal);
  return {
    code: dc,
    discountAmount,
    minOrderAmount,
    rejectedByMinOrder: false,
  };
}

async function incrementDiscountUsage(discountId, client = null) {
  if (!discountId) return null;
  const q = client ?? pool;
  const r = await q.query(
    `UPDATE discount_codes
        SET uses_count = uses_count + 1,
            updated_at = NOW()
      WHERE id = $1
        AND (max_uses IS NULL OR uses_count < max_uses)
    RETURNING id, uses_count, max_uses`,
    [discountId]
  );
  if (!r.rows.length) {
    const usageErr = new Error("El código de descuento alcanzó su límite de usos");
    usageErr.status = 409;
    throw usageErr;
  }
  return r.rows[0];
}

function buildEventPassCode(eventId, userId) {
  const eventPart = String(eventId || "").replace(/-/g, "").slice(0, 6).toUpperCase();
  const userPart = String(userId || "").replace(/-/g, "").slice(-4).toUpperCase();
  const randomPart = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `EV-${eventPart}-${userPart}-${randomPart}`;
}

async function ensureEventPassForRegistration({ eventId, registrationId, userId, client = null }) {
  if (!eventId || !registrationId || !userId) return null;
  const q = client ?? pool;

  const existing = await q.query(
    "SELECT * FROM event_passes WHERE registration_id = $1 LIMIT 1",
    [registrationId]
  );
  if (existing.rows.length) {
    const row = existing.rows[0];
    if (row.status === "issued") return row;
    const updated = await q.query(
      `UPDATE event_passes
          SET event_id = $1,
              user_id = $2,
              status = 'issued',
              issued_at = NOW(),
              used_at = NULL,
              cancelled_at = NULL,
              updated_at = NOW()
        WHERE id = $3
      RETURNING *`,
      [eventId, userId, row.id]
    );
    return updated.rows[0] ?? row;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const passCode = buildEventPassCode(eventId, userId);
    try {
      const inserted = await q.query(
        `INSERT INTO event_passes (event_id, registration_id, user_id, pass_code, status, issued_at)
         VALUES ($1, $2, $3, $4, 'issued', NOW())
         RETURNING *`,
        [eventId, registrationId, userId, passCode]
      );
      return inserted.rows[0] ?? null;
    } catch (err) {
      if (err?.code !== "23505") throw err;
    }
  }

  throw new Error("No se pudo generar un pase único para el evento");
}

async function cancelEventPassByRegistration({ registrationId, client = null }) {
  if (!registrationId) return null;
  const q = client ?? pool;
  const r = await q.query(
    `UPDATE event_passes
        SET status = 'cancelled',
            cancelled_at = NOW(),
            updated_at = NOW()
      WHERE registration_id = $1
        AND status <> 'cancelled'
    RETURNING *`,
    [registrationId]
  );
  return r.rows[0] ?? null;
}

async function markEventPassUsedByRegistration({ registrationId, client = null }) {
  if (!registrationId) return null;
  const q = client ?? pool;
  const r = await q.query(
    `UPDATE event_passes
        SET status = 'used',
            used_at = NOW(),
            updated_at = NOW()
      WHERE registration_id = $1
        AND status = 'issued'
    RETURNING *`,
    [registrationId]
  );
  return r.rows[0] ?? null;
}

function normalizePosItems(items) {
  const qtyByProduct = new Map();
  for (const raw of Array.isArray(items) ? items : []) {
    const productId = String(raw?.productId ?? "").trim();
    const qty = Number(raw?.qty ?? 0);
    if (!productId || !Number.isFinite(qty) || qty <= 0) continue;
    qtyByProduct.set(productId, (qtyByProduct.get(productId) || 0) + Math.floor(qty));
  }
  return Array.from(qtyByProduct.entries()).map(([productId, qty]) => ({ productId, qty }));
}

async function processPosSale({ userId, items, paymentMethod = "efectivo", discountCode = null }) {
  const normalizedItems = normalizePosItems(items);
  if (!normalizedItems.length) {
    return { error: { status: 400, message: "Se requieren artículos válidos" } };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const productIds = normalizedItems.map((item) => item.productId);
    const productsRes = await client.query(
      "SELECT * FROM products WHERE id = ANY($1::uuid[]) FOR UPDATE",
      [productIds]
    );
    const productsById = new Map(productsRes.rows.map((p) => [p.id, p]));
    if (productsById.size !== productIds.length) {
      const missing = productIds.find((id) => !productsById.has(id));
      await client.query("ROLLBACK");
      return { error: { status: 404, message: `Producto ${missing} no encontrado` } };
    }

    let subtotal = 0;
    for (const item of normalizedItems) {
      const product = productsById.get(item.productId);
      if (Number(product.stock) < item.qty) {
        await client.query("ROLLBACK");
        return { error: { status: 400, message: `Stock insuficiente para ${product.name}` } };
      }
      subtotal += Number(product.price) * item.qty;
    }

    let discountAmount = 0;
    let discountCodeRow = null;
    if (discountCode) {
      const discount = await findApplicableDiscountCode({
        code: discountCode,
        subtotal,
        channel: "pos",
        classCategory: "all",
        client,
      });
      if (!discount) {
        await client.query("ROLLBACK");
        return { error: { status: 400, message: "Código de descuento no válido para POS" } };
      }
      if (discount.rejectedByMinOrder) {
        await client.query("ROLLBACK");
        return {
          error: {
            status: 400,
            message: `Compra mínima requerida: $${Number(discount.minOrderAmount || 0).toFixed(2)} MXN`,
          },
        };
      }
      discountAmount = discount.discountAmount;
      discountCodeRow = discount.code;
    }

    const total = Math.max(0, subtotal - discountAmount);
    const orderRes = await client.query(
      `INSERT INTO orders (
         user_id, subtotal, tax_amount, total_amount, payment_method,
         status, discount_amount, discount_code_id, channel
       )
       VALUES ($1,$2,0,$3,$4::payment_method,'approved'::order_status,$5,$6,'pos')
       RETURNING *`,
      [userId || null, subtotal, total, paymentMethod, discountAmount, discountCodeRow?.id ?? null]
    );
    const order = orderRes.rows[0];

    for (const item of normalizedItems) {
      const product = productsById.get(item.productId);
      await client.query(
        "INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1,$2,$3,$4)",
        [order.id, item.productId, item.qty, product.price]
      );
      const stockUpdate = await client.query(
        "UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1",
        [item.qty, item.productId]
      );
      if (stockUpdate.rowCount === 0) {
        const stockErr = new Error(`Stock insuficiente para ${product.name}`);
        stockErr.status = 400;
        throw stockErr;
      }
    }

    if (discountCodeRow?.id) {
      await incrementDiscountUsage(discountCodeRow.id, client);
    }

    if (userId && total > 0) {
      const cfgRes = await client.query("SELECT value FROM settings WHERE key='loyalty_config' LIMIT 1");
      const cfg = cfgRes.rows.length ? cfgRes.rows[0].value : {};
      const pts = Math.floor(total * (cfg.points_per_peso ?? 1));
      if (cfg.enabled !== false && pts > 0) {
        await client.query(
          "INSERT INTO loyalty_transactions (user_id, type, points, description) VALUES ($1, 'earn', $2, $3)",
          [userId, pts, `Venta POS — $${total}`]
        );
      }
    }

    await client.query("COMMIT");
    if (userId) {
      triggerWalletPassSync(userId, "pos_sale_approved");
    }
    return { data: order };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { }
    throw err;
  } finally {
    client.release();
  }
}

async function awardBirthdayBonusIfEligible(userId, client = null) {
  if (!userId) return null;
  const q = client ?? pool;
  const userRes = await q.query(
    "SELECT date_of_birth FROM users WHERE id = $1 LIMIT 1",
    [userId]
  );
  const dob = userRes.rows[0]?.date_of_birth;
  if (!dob) return null;

  const today = new Date();
  const birth = new Date(dob);
  const isBirthdayToday =
    birth.getUTCDate() === today.getUTCDate() &&
    birth.getUTCMonth() === today.getUTCMonth();
  if (!isBirthdayToday) return null;

  const cfgRes = await q.query("SELECT value FROM settings WHERE key='loyalty_config' LIMIT 1");
  const cfg = cfgRes.rows.length ? cfgRes.rows[0].value : {};
  const points = Number(cfg.birthday_bonus ?? 0);
  if (cfg.enabled === false || points <= 0) return null;

  const year = today.getUTCFullYear();
  const desc = `Bono de cumpleaños ${year}`;
  const exists = await q.query(
    "SELECT id FROM loyalty_transactions WHERE user_id = $1 AND description = $2 LIMIT 1",
    [userId, desc]
  );
  if (exists.rows.length) return null;

  const inserted = await q.query(
    "INSERT INTO loyalty_transactions (user_id, type, points, description) VALUES ($1, 'earn', $2, $3) RETURNING *",
    [userId, points, desc]
  );
  return inserted.rows[0] ?? null;
}

const NON_REPEATABLE_ORDER_BLOCK_STATUSES = ["pending_payment", "pending_verification", "approved"];

function parseBooleanFlag(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return ["true", "1", "yes", "si", "sí", "t"].includes(v);
  }
  return false;
}

// Normalize plan.time_restriction from admin form. Returns null when empty/invalid
// so the booking endpoint treats the plan as unrestricted.
function sanitizeTimeRestriction(input) {
  if (!input || typeof input !== "object") return null;
  const days = Array.isArray(input.days_of_week)
    ? input.days_of_week.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : [];
  const range = Array.isArray(input.hour_range)
    ? input.hour_range.map((s) => String(s || "").slice(0, 5)).filter((s) => /^\d{2}:\d{2}$/.test(s))
    : [];
  const message = String(input.message || "").trim();
  if (!days.length && range.length !== 2) return null;
  return {
    days_of_week: [...new Set(days)].sort((a, b) => a - b),
    hour_range: range.length === 2 ? range : [],
    message,
  };
}

function getPlanRepeatKey(plan) {
  const raw = plan?.repeat_key ?? plan?.repeatKey;
  if (raw === null || raw === undefined) return null;
  const key = String(raw).trim();
  return key || null;
}

function getPlanFlags(plan) {
  return {
    isNonTransferable: parseBooleanFlag(plan?.is_non_transferable ?? plan?.isNonTransferable),
    isNonRepeatable: parseBooleanFlag(plan?.is_non_repeatable ?? plan?.isNonRepeatable),
    repeatKey: getPlanRepeatKey(plan),
  };
}

async function findNonRepeatablePlanConflict({
  userId,
  plan,
  excludeOrderId = null,
  client = null,
}) {
  if (!userId || !plan?.id) return null;
  const { isNonRepeatable, repeatKey } = getPlanFlags(plan);
  if (!isNonRepeatable) return null;

  const q = client ?? pool;
  const key = repeatKey || `plan:${plan.id}`;

  const memConflict = await q.query(
    `SELECT m.id, m.status, p.name AS plan_name
       FROM memberships m
       LEFT JOIN plans p ON p.id = m.plan_id
      WHERE m.user_id = $1
        AND (
          m.plan_id = $2
          OR (COALESCE(p.repeat_key, '') <> '' AND p.repeat_key = $3)
        )
      ORDER BY m.created_at DESC
      LIMIT 1`,
    [userId, plan.id, key]
  );
  if (memConflict.rows.length) {
    return {
      source: "membership",
      message: `La "${plan.name}" es de un solo uso, no transferible y no se puede repetir.`,
      detail: memConflict.rows[0],
    };
  }

  const params = [userId, plan.id, key, NON_REPEATABLE_ORDER_BLOCK_STATUSES];
  let orderSql = `
    SELECT o.id, o.status, p.name AS plan_name
      FROM orders o
      JOIN plans p ON p.id = o.plan_id
     WHERE o.user_id = $1
       AND (
         o.plan_id = $2
         OR (COALESCE(p.repeat_key, '') <> '' AND p.repeat_key = $3)
       )
       AND o.status = ANY($4::order_status[])
  `;
  if (excludeOrderId) {
    params.push(excludeOrderId);
    orderSql += ` AND o.id <> $${params.length}`;
  }
  orderSql += " ORDER BY o.created_at DESC LIMIT 1";

  const orderConflict = await q.query(orderSql, params);
  if (orderConflict.rows.length) {
    const status = orderConflict.rows[0].status;
    if (status === "pending_payment" || status === "pending_verification") {
      return {
        source: "order",
        message: "Ya tienes una sesión muestra en proceso. No puede repetirse.",
        detail: orderConflict.rows[0],
      };
    }
    return {
      source: "order",
      message: `La "${plan.name}" ya fue utilizada y no se puede repetir.`,
      detail: orderConflict.rows[0],
    };
  }

  return null;
}

// ─── Inscription (one-time enrollment fee) helpers ──────────────────────────
// The studio charges a one-time $500 inscription to enroll. It is charged again
// ONLY after 6 months of inactivity. A client NEEDS inscription when they have
// NO membership that is currently `active` OR whose `end_date` falls within the
// last 6 months (covers "never enrolled" and "inactive > 6 months"). Any recent
// or active membership → no inscription.
const INSCRIPTION_PLAN_NAME = "Inscripción";
const INSCRIPTION_FALLBACK_PRICE = 500;

async function clientNeedsInscription(userId) {
  if (!userId) return false;
  try {
    const r = await pool.query(
      `SELECT 1 FROM memberships
        WHERE user_id = $1
          AND (status = 'active' OR (end_date IS NOT NULL AND end_date >= (CURRENT_DATE - INTERVAL '6 months')))
        LIMIT 1`,
      [userId]
    );
    return r.rows.length === 0;
  } catch (err) {
    // Money-path safety: never block checkout on a query failure. Default to
    // NOT charging inscription (false) and log a warning for visibility.
    console.warn("[inscription] clientNeedsInscription query failed, defaulting to false:", err?.message || err);
    return false;
  }
}

// Reads the active "Inscripción" plan price; falls back to 500 if unavailable.
async function getInscriptionPrice(dbClient = pool) {
  try {
    const r = await dbClient.query(
      `SELECT price FROM plans WHERE name = $1 LIMIT 1`,
      [INSCRIPTION_PLAN_NAME]
    );
    const price = r.rows.length ? Number(r.rows[0].price) : NaN;
    return Number.isFinite(price) && price > 0 ? price : INSCRIPTION_FALLBACK_PRICE;
  } catch (err) {
    console.warn("[inscription] getInscriptionPrice query failed, using fallback:", err?.message || err);
    return INSCRIPTION_FALLBACK_PRICE;
  }
}

// ¿La alumna tiene un PAQUETE de clases (class_limit >= 2) en una orden aún
// pendiente (pagó pero el admin no la aprueba, o falta el comprobante)? En ese
// caso ya está "inscribiéndose": se le permite comprar "Clase Extra" sin esperar
// la aprobación. Cierra el hueco de la ventana pendiente. Money-path safe: ante
// fallo de la consulta, devuelve false (no desbloquea de más).
async function clientHasPendingPackage(userId, dbClient = pool) {
  if (!userId) return false;
  try {
    const r = await dbClient.query(
      `SELECT 1 FROM orders o
         JOIN plans p ON p.id = o.plan_id
        WHERE o.user_id = $1
          AND o.status IN ('pending_payment','pending_verification')
          AND COALESCE(p.class_limit, 0) >= 2
        LIMIT 1`,
      [userId]
    );
    return r.rows.length > 0;
  } catch (err) {
    console.warn("[inscription] clientHasPendingPackage query failed, defaulting to false:", err?.message || err);
    return false;
  }
}

function serializeSpecialtiesForDb(value) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) {
    const items = value.map((v) => String(v).trim()).filter(Boolean);
    return items.length ? JSON.stringify(items) : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Already JSON string? keep as-is if parseable.
    if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
      try {
        JSON.parse(trimmed);
        return trimmed;
      } catch (_) {
        // fall through and normalize as csv list
      }
    }
    const items = trimmed.split(",").map((v) => v.trim()).filter(Boolean);
    return JSON.stringify(items);
  }
  return JSON.stringify(value);
}

function normalizeQrDataUrl(raw) {
  if (!raw) return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:image/")) return trimmed;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `data:image/png;base64,${trimmed}`;
}

function pickEvolutionQrPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  // Evolution often returns both "code" and "base64".
  // "code" is not always an image payload, so prefer explicit base64/image fields.
  const candidates = [
    payload?.base64,
    payload?.qrcode?.base64,
    payload?.qrCode?.base64,
    payload?.qr?.base64,
    payload?.instance?.qrcode?.base64,
    payload?.instance?.qrCode?.base64,
    payload?.instance?.qr?.base64,
    payload?.code,
    payload?.qrcode?.code,
    payload?.qrCode?.code,
    payload?.qr?.code,
  ];

  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("data:image/")) return trimmed;
    // Raw base64 image strings should not include separators like comma + '@'
    // seen in non-image "code" values.
    const looksLikeRawBase64Image =
      !trimmed.includes(",") &&
      !trimmed.includes("@") &&
      /^[A-Za-z0-9+/=]+$/.test(trimmed) &&
      trimmed.length > 120;
    if (looksLikeRawBase64Image) return trimmed;
  }
  return null;
}

// ─── Auth helpers ────────────────────────────────────────────────────────────
function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "30d" });
}

function normalizeEmailAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function isStrongPassword(password) {
  const candidate = String(password || "");
  return candidate.length >= 8 && /[A-Z]/.test(candidate) && /[0-9]/.test(candidate);
}

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ message: "No autorizado" });
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ message: "Token inválido" });
  }
}

async function adminMiddleware(req, res, next) {
  authMiddleware(req, res, async () => {
    try {
      const r = await pool.query("SELECT role FROM users WHERE id = $1", [req.userId]);
      if (!r.rows.length || !["admin", "super_admin", "instructor", "reception"].includes(r.rows[0].role)) {
        return res.status(403).json({ message: "Acceso restringido" });
      }
      next();
    } catch { return res.status(500).json({ message: "Error interno" }); }
  });
}

function mapUser(u) {
  return {
    id: u.id,
    displayName: u.display_name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    gender: u.gender ?? null,
    photoUrl: u.photo_url ?? null,
    dateOfBirth: u.date_of_birth ?? null,
    emergencyContactName: u.emergency_contact_name ?? null,
    emergencyContactPhone: u.emergency_contact_phone ?? null,
    healthNotes: u.health_notes ?? null,
    receiveReminders: u.receive_reminders ?? true,
    receivePromotions: u.receive_promotions ?? false,
    receiveWeeklySummary: u.receive_weekly_summary ?? false,
    pushReminders: u.push_reminders ?? true,
    createdAt: u.created_at,
  };
}

// ─── Routes: /api/auth ───────────────────────────────────────────────────────

// POST /api/auth/register
app.post("/api/auth/register", async (req, res) => {
  const { email, password, displayName, phone, gender, acceptsTerms, acceptsCommunications } = req.body;
  if (!password || !displayName || !phone) {
    return res.status(400).json({ message: "Nombre, teléfono y contraseña son requeridos" });
  }
  const normalizedPhone = normalizePhoneForStorage(phone);
  if (!normalizedPhone) {
    return res.status(400).json({ message: "Teléfono inválido" });
  }
  const normalizedEmail = email ? email.toLowerCase().trim() : null;
  try {
    const phoneExists = await pool.query(
      "SELECT id FROM users WHERE phone = $1 AND role = 'client'",
      [normalizedPhone]
    );
    if (phoneExists.rows.length > 0) {
      return res.status(409).json({ message: "Este teléfono ya está registrado" });
    }
    if (normalizedEmail) {
      const emailExists = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
      if (emailExists.rows.length > 0) {
        return res.status(409).json({ message: "Este email ya está registrado" });
      }
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (display_name, email, phone, gender, password_hash, accepts_terms, accepts_communications, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'client')
       RETURNING *`,
      [displayName.trim(), normalizedEmail, normalizedPhone, gender || null, passwordHash, acceptsTerms ?? false, acceptsCommunications ?? false]
    );
    const user = result.rows[0];
    // Auto-create referral code
    const code = "OPH" + Math.random().toString(36).slice(2, 8).toUpperCase();
    await pool.query(
      "INSERT INTO referral_codes (user_id, code) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [user.id, code]
    );
    // Award welcome bonus loyalty points
    try {
      const cfgRes = await pool.query("SELECT value FROM settings WHERE key='loyalty_config' LIMIT 1");
      const cfg = cfgRes.rows.length ? cfgRes.rows[0].value : {};
      const pts = cfg.welcome_bonus ?? 50;
      if (cfg.enabled !== false && pts > 0) {
        await pool.query(
          "INSERT INTO loyalty_transactions (user_id, type, points, description) VALUES ($1, 'earn', $2, 'Bono de bienvenida')",
          [user.id, pts]
        );
      }
    } catch (e) { /* loyalty earn error shouldn't fail register */ }
    const token = signToken(user.id);
    return res.status(201).json({ user: mapUser(user), token });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ message: "Error interno del servidor" });
  }
});

// POST /api/auth/login
app.post("/api/auth/login", async (req, res) => {
  const identifier = (req.body?.identifier ?? req.body?.email ?? "").toString().trim();
  const { password } = req.body;
  if (!identifier || !password) return res.status(400).json({ message: "Teléfono o email y contraseña son requeridos" });
  try {
    let result;
    if (isEmailIdentifier(identifier)) {
      result = await pool.query("SELECT * FROM users WHERE email = $1", [identifier.toLowerCase()]);
    } else {
      const normalizedPhone = normalizePhoneForStorage(identifier);
      result = await pool.query("SELECT * FROM users WHERE phone = $1 AND role = 'client' LIMIT 1", [normalizedPhone]);
    }
    if (result.rows.length === 0) return res.status(401).json({ message: "Credenciales incorrectas" });
    const user = result.rows[0];
    if (!user.password_hash) return res.status(401).json({ message: "Credenciales incorrectas" });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ message: "Credenciales incorrectas" });
    try {
      await awardBirthdayBonusIfEligible(user.id);
    } catch (bonusErr) {
      console.error("[Loyalty] birthday bonus login:", bonusErr?.message || bonusErr);
    }
    const token = signToken(user.id);
    return res.json({ user: mapUser(user), token });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: "Error interno del servidor" });
  }
});

// GET /api/auth/me
app.get("/api/auth/me", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ message: "Usuario no encontrado" });
    return res.json({ user: mapUser(result.rows[0]) });
  } catch (err) {
    console.error("Me error:", err);
    return res.status(500).json({ message: "Error interno del servidor" });
  }
});

// POST /api/auth/forgot-password
app.post("/api/auth/forgot-password", async (req, res) => {
  const raw = (req.body?.email ?? req.body?.identifier ?? "").toString().trim();
  if (!raw) return res.status(400).json({ message: "Teléfono o email es requerido" });
  const genericOk = { message: "Si la cuenta existe y tiene correo, recibirás un enlace. Si no, contáctanos por WhatsApp." };

  try {
    let user;
    if (isEmailIdentifier(raw)) {
      user = await pool.query("SELECT id, display_name, email FROM users WHERE email = $1", [raw.toLowerCase()]);
    } else {
      const normalizedPhone = normalizePhoneForStorage(raw);
      user = await pool.query("SELECT id, display_name, email FROM users WHERE phone = $1 LIMIT 1", [normalizedPhone]);
    }
    // Sin usuario, o usuario sin correo: responder genérico (no se puede enviar link).
    if (user.rows.length === 0 || !user.rows[0].email) {
      return res.json(genericOk);
    }
    const target = user.rows[0];

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 2);

    await pool.query(
      `UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false`,
      [target.id],
    );
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [target.id, token, expiresAt]
    );

    await sendPasswordResetEmail({
      to: target.email,
      name: target.display_name || "Clienta",
      token,
      resetUrl: `${APP_PUBLIC_URL}/auth/reset-password?token=${encodeURIComponent(token)}`,
    });

    return res.json(genericOk);
  } catch (err) {
    console.error("Auth /forgot-password error:", err);
    return res.status(500).json({ message: "Error interno del servidor" });
  }
});

// POST /api/auth/reset-password
app.post("/api/auth/reset-password", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const password = String(req.body?.password || "");
  if (!token || !password) return res.status(400).json({ message: "Datos incompletos" });
  if (!isStrongPassword(password)) {
    return res.status(400).json({ message: "La contraseña debe tener al menos 8 caracteres, una mayúscula y un número." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Check token validity
    const t = await client.query(
      `SELECT user_id, expires_at, used FROM password_reset_tokens WHERE token = $1 FOR UPDATE`,
      [token]
    );
    if (t.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "El enlace es inválido o ha expirado." });
    }

    const dbToken = t.rows[0];
    if (dbToken.used) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Este enlace ya fue utilizado. Solicita uno nuevo." });
    }
    if (new Date() > new Date(dbToken.expires_at)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Este enlace ha expirado." });
    }

    // Hash new password and update
    const hash = await bcrypt.hash(password, 12);
    const userUpdate = await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, dbToken.user_id]);
    if (!userUpdate.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "El enlace es inválido o ha expirado." });
    }

    // Mark current and any still-active tokens as used for this user.
    await client.query(
      `UPDATE password_reset_tokens
       SET used = true
       WHERE user_id = $1 AND used = false`,
      [dbToken.user_id],
    );

    await client.query("COMMIT");

    return res.json({ message: "Contraseña restablecida con éxito." });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { }
    console.error("Auth /reset-password error:", err);
    return res.status(500).json({ message: "Error al actualizar la contraseña." });
  } finally {
    client.release();
  }
});

// ─── Routes: /api/plans ─────────────────────────────────────────────────────

// GET /api/plans
app.get("/api/plans", async (req, res) => {
  // Public endpoint: hides admin-only plans (e.g. TotalPass walk-in).
  // Resilient: if `is_admin_only` column doesn't exist yet, fall back to all
  // active plans so the frontend never breaks.
  try {
    const r = await pool.query(
      "SELECT * FROM plans WHERE is_active = true AND COALESCE(is_admin_only, false) = false ORDER BY sort_order ASC, price ASC"
    );
    return res.json({ data: camelRows(r.rows) });
  } catch (err) {
    if (err.code === "42703") {
      // column "is_admin_only" does not exist — fallback
      try {
        const r = await pool.query(
          "SELECT * FROM plans WHERE is_active = true ORDER BY sort_order ASC, price ASC"
        );
        return res.json({ data: camelRows(r.rows) });
      } catch (e2) {
        console.error("Plans fallback error:", e2);
        return res.status(500).json({ message: "Error interno" });
      }
    }
    console.error("Plans error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/admin/plans/walkin — admin-only: returns all active plans including
// admin-only ones (used by the walk-in dialog so internal convenios like
// TotalPass 154 are selectable but never leak to the public catalog).
app.get("/api/admin/plans/walkin", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM plans WHERE is_active = true ORDER BY sort_order ASC, price ASC"
    );
    return res.json({ data: camelRows(r.rows) });
  } catch (err) {
    console.error("Admin walk-in plans error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/admin/plans/seed-totalpass — manual seed for "TotalPass 154".
// Use when the boot-time seed didn't run for any reason. Idempotent:
// creates the row if missing, otherwise force-updates flags. Returns the
// resulting plan row so the admin UI can verify.
app.post("/api/admin/plans/seed-totalpass", adminMiddleware, async (req, res) => {
  try {
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_admin_only BOOLEAN NOT NULL DEFAULT false`).catch(() => { });
    const ins = await pool.query(`
      INSERT INTO plans (name, description, price, currency, duration_days, class_limit, class_category, features, is_active, sort_order, is_admin_only)
      SELECT 'TotalPass 154', 'Convenio TotalPass · uso interno walk-in', 154, 'MXN', 1, 1, 'reformer', '["Walk-in TotalPass","Solo uso interno"]'::jsonb, true, 999, true
      WHERE NOT EXISTS (SELECT 1 FROM plans WHERE LOWER(name) = LOWER('TotalPass 154'))
      RETURNING id
    `);
    const upd = await pool.query(`
      UPDATE plans
         SET is_admin_only = true,
             is_active = true,
             class_category = 'reformer',
             price = COALESCE(NULLIF(price, 0), 154),
             class_limit = COALESCE(class_limit, 1),
             duration_days = COALESCE(duration_days, 1),
             updated_at = NOW()
       WHERE LOWER(name) = LOWER('TotalPass 154')
       RETURNING *
    `);
    return res.json({
      data: {
        plan: upd.rows[0] ? camelRow(upd.rows[0]) : null,
        inserted: ins.rowCount,
        ensured: upd.rowCount,
      },
      message: ins.rowCount > 0 ? "TotalPass 154 creado" : "TotalPass 154 actualizado",
    });
  } catch (err) {
    console.error("[seed-totalpass]", err.message);
    return res.status(500).json({ message: "Error", detail: err.message });
  }
});

// ─── Routes: /api/complements & combo-pricing ──────────────────────────────

// GET /api/complements — public, returns active complements
app.get("/api/complements", async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM complements WHERE is_active = true ORDER BY sort_order ASC"
    );
    return res.json({ data: camelRows(r.rows) });
  } catch (err) {
    // Table may not exist yet — return empty array instead of 500
    if (err.code === "42P01") return res.json({ data: [] });
    console.error("Complements error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/combo-pricing — public, returns combo price tiers
app.get("/api/combo-pricing", async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM combo_pricing WHERE is_active = true ORDER BY class_count ASC"
    );
    return res.json({ data: camelRows(r.rows) });
  } catch (err) {
    // Table may not exist yet — return empty array instead of 500
    if (err.code === "42P01") return res.json({ data: [] });
    console.error("Combo pricing error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Routes: /api/memberships ───────────────────────────────────────────────

// GET /api/memberships/my
app.get("/api/memberships/my", authMiddleware, async (req, res) => {
  try {
    // Ensure optional columns exist (idempotent, safe to run on every request)
    await pool.query(`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS plan_name_override VARCHAR(255)`).catch(() => { });
    await pool.query(`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS class_limit_override INTEGER`).catch(() => { });
    await pool.query(`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS cancellations_used INTEGER NOT NULL DEFAULT 0`).catch(() => { });
    await pool.query(`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS order_id UUID`).catch(() => { });
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS class_category VARCHAR(20) DEFAULT 'all'`).catch(() => { });
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS class_limit INTEGER`).catch(() => { });
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS duration_days INTEGER NOT NULL DEFAULT 30`).catch(() => { });
    await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '[]'::jsonb`).catch(() => { });

    const r = await pool.query(
      `SELECT m.id, m.user_id, m.plan_id, m.status, m.start_date, m.end_date,
              m.classes_remaining, m.payment_method, m.created_at, m.updated_at,
              m.order_id, m.cancellations_used,
              COALESCE(m.plan_name_override, '') AS plan_name_override,
              m.class_limit_override,
              COALESCE(p.name, m.plan_name_override, 'Membresía') AS plan_name,
              COALESCE(p.class_limit, m.class_limit_override)      AS class_limit,
              COALESCE(p.duration_days, 30)                        AS duration_days,
              p.features,
              COALESCE(p.class_category, 'all')                    AS class_category,
              p.repeat_key
       FROM memberships m
       LEFT JOIN plans p ON m.plan_id = p.id
       WHERE m.user_id = $1
         AND m.status IN ('active', 'pending_activation', 'pending_payment')
       ORDER BY CASE m.status
         WHEN 'active'              THEN 1
         WHEN 'pending_activation'  THEN 2
         WHEN 'pending_payment'     THEN 3
         ELSE 4 END,
         CASE
           WHEN m.status = 'active' AND (m.classes_remaining IS NULL OR m.classes_remaining >= 9999) THEN 1
           ELSE 0
         END ASC,
         CASE
           WHEN m.status = 'active' AND m.end_date IS NULL THEN 1
           ELSE 0
         END ASC,
         m.end_date ASC NULLS LAST,
         m.created_at DESC
       LIMIT 1`,
      [req.userId]
    );
    if (!r.rows[0]) return res.json({ data: null });
    const row = camelRows([r.rows[0]])[0];
    // Treat 9999 or very large numbers as unlimited (null)
    if (row.classesRemaining >= 9999) row.classesRemaining = null;
    if (row.classLimit >= 9999) row.classLimit = null;
    // Cobertura combinada: un combo dividido deja VARIAS membresías activas
    // (una por disciplina) pero este endpoint devuelve una sola, y la app
    // bloquea las tarjetas de la disciplina que no ve. Reportar la cobertura
    // real de todas las membresías activas con crédito ('mixto' si abarcan
    // más de una categoría). La validación por disciplina al reservar sigue
    // intacta en POST /api/bookings.
    // No promover cobertura si la fila primaria es una Clase Muestra: la app
    // detecta el modo trial desde ESTA fila y ocultar su categoría escondería
    // el banner de horarios permitidos.
    if (row.status === "active" && !isTrialPlan({ repeat_key: row.repeatKey, plan_name: row.planName })) {
      try {
        const cats = await pool.query(
          `SELECT DISTINCT COALESCE(p.class_category, 'all') AS cat
             FROM memberships m
             LEFT JOIN plans p ON m.plan_id = p.id
            WHERE m.user_id = $1
              AND m.status = 'active'
              AND (m.end_date IS NULL OR m.end_date >= CURRENT_DATE)
              AND (m.classes_remaining IS NULL OR m.classes_remaining > 0)`,
          [req.userId]
        );
        // El filtro > 0 incluye a propósito el centinela 9999 (ilimitadas).
        const covered = new Set(cats.rows.map((c) => normalizeClassCategory(c.cat, "all")));
        if (covered.size > 1) {
          row.classCategory = "mixto";
        } else if (covered.size === 1) {
          const only = covered.values().next().value;
          if (only !== normalizeClassCategory(row.classCategory, "all")) row.classCategory = only;
        }
      } catch (e) {
        // Pista cosmética best-effort — nunca tirar el endpoint por esto.
        console.warn("Memberships/my combined-coverage lookup failed; using single-row category.", e?.message);
      }
    }
    return res.json({ data: row });
  } catch (err) {
    console.error("Memberships/my error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Routes: /api/classes ───────────────────────────────────────────────────

// GET /api/classes?start=YYYY-MM-DD&end=YYYY-MM-DD
app.get("/api/classes", async (req, res) => {
  try {
    const { start, end, limit } = req.query;
    // Aggregate bookings once via LEFT JOIN instead of running a
    // correlated COUNT(*) subquery per class row. Combined with
    // idx_bookings_class_active this turns an O(classes * bookings)
    // sequential scan into an indexed single-pass aggregate.
    let query = `
      SELECT c.*,
             c.max_capacity                                   AS capacity,
             COALESCE(b_agg.cnt, 0)::int                      AS current_bookings,
             (c.date || 'T' || c.start_time || '-06:00')      AS start_time_full,
             (c.date || 'T' || c.end_time   || '-06:00')      AS end_time_full,
             c.apparatus,
             ct.name  AS class_type_name,
             ct.color AS class_type_color,
             ct.icon  AS class_type_icon,
             ct.level AS class_type_level,
             i.display_name AS instructor_name,
             i.photo_url    AS instructor_photo,
             f.name         AS facility_name
      FROM classes c
      JOIN class_types ct    ON c.class_type_id = ct.id
      JOIN instructors i     ON c.instructor_id = i.id
      LEFT JOIN facilities f ON c.facility_id   = f.id
      LEFT JOIN (
        SELECT class_id, COUNT(*) AS cnt
        FROM bookings
        WHERE status IN ('confirmed','checked_in')
        GROUP BY class_id
      ) b_agg ON b_agg.class_id = c.id
      WHERE c.status != 'cancelled'
    `;
    const params = [];
    if (start) { params.push(start); query += ` AND c.date >= $${params.length}`; }
    if (end) { params.push(end); query += ` AND c.date <= $${params.length}`; }
    query += " ORDER BY c.date ASC, c.start_time ASC";
    if (limit) { params.push(parseInt(limit)); query += ` LIMIT $${params.length}`; }
    const r = await pool.query(query, params);
    // Normalise: expose start_time / end_time as full ISO strings for front-end consumers
    const rows = r.rows.map((row) => ({
      ...row,
      // Ensure date is always a plain YYYY-MM-DD string (pg returns Date objects for DATE columns)
      date: row.date instanceof Date
        ? row.date.toISOString().slice(0, 10)
        : (typeof row.date === "string" ? row.date.slice(0, 10) : row.date),
      start_time: row.start_time_full ?? row.start_time,
      end_time: row.end_time_full ?? row.end_time,
      apparatus: row.apparatus ?? "reformer",
    }));
    return res.json({ data: rows });
  } catch (err) {
    console.error("Classes error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/classes/:id
app.get("/api/classes/:id", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.*,
              (c.date || 'T' || c.start_time || '-06:00') AS start_time,
              (c.date || 'T' || c.end_time   || '-06:00') AS end_time,
              c.apparatus,
              ct.name  AS class_type_name,
              ct.color AS class_type_color,
              ct.icon  AS class_type_icon,
              ct.level AS class_type_level,
              i.display_name AS instructor_name,
              i.photo_url    AS instructor_photo,
              i.bio          AS instructor_bio,
              f.name         AS facility_name
       FROM classes c
       JOIN class_types ct   ON c.class_type_id  = ct.id
       JOIN instructors i    ON c.instructor_id   = i.id
       LEFT JOIN facilities f ON c.facility_id    = f.id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ message: "Clase no encontrada" });
    return res.json({ data: r.rows[0] });
  } catch (err) {
    console.error("Class/:id error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Routes: /api/bookings ──────────────────────────────────────────────────

// GET /api/bookings/my-bookings
app.get("/api/bookings/my-bookings", authMiddleware, async (req, res) => {
  try {
    // `has_review` previously used a correlated `EXISTS(SELECT 1 FROM reviews
    // WHERE booking_id = b.id)` subquery that ran once per booking row. The
    // unique partial index `idx_reviews_booking_unique ON reviews(booking_id)
    // WHERE booking_id IS NOT NULL` guarantees at most one review per booking,
    // so a plain LEFT JOIN can't multiply rows and lets the planner use a
    // single Index Scan instead of N lookups.
    const r = await pool.query(
      `SELECT b.*,
              c.date,
              (c.date || 'T' || c.start_time || '-06:00') AS start_time,
              (c.date || 'T' || c.end_time   || '-06:00') AS end_time,
              c.status AS class_status,
              c.apparatus,
              ct.name  AS class_type_name,
              ct.color AS class_color,
              i.display_name AS instructor_name,
              i.photo_url    AS instructor_photo,
              (rv.id IS NOT NULL) AS has_review,
              f.name         AS facility_name,
              CASE WHEN b.status = 'waitlist' THEN (
                SELECT COUNT(*)::int FROM bookings b2
                 WHERE b2.class_id = b.class_id AND b2.status = 'waitlist'
                   AND b2.created_at <= b.created_at
              ) END AS waitlist_position
       FROM bookings b
       JOIN classes c         ON b.class_id      = c.id
       JOIN class_types ct    ON c.class_type_id = ct.id
       JOIN instructors i     ON c.instructor_id = i.id
       LEFT JOIN facilities f ON c.facility_id   = f.id
       LEFT JOIN reviews rv   ON rv.booking_id   = b.id
       WHERE b.user_id = $1
       ORDER BY c.date DESC, c.start_time DESC`,
      [req.userId]
    );
    return res.json({ data: r.rows });
  } catch (err) {
    console.error("Bookings/my error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/bookings
app.post("/api/bookings", authMiddleware, async (req, res) => {
  const { classId } = req.body;
  if (!classId) return res.status(400).json({ message: "classId requerido" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock class row to avoid overbooking in concurrent requests
    const classRes = await client.query(
      `SELECT c.id, c.max_capacity, c.current_bookings, c.status, c.date, c.start_time,
              (c.date + c.start_time::time) AT TIME ZONE 'America/Mexico_City' AS class_start_utc,
              ct.category AS class_category
       FROM classes c
       JOIN class_types ct ON c.class_type_id = ct.id
       WHERE c.id = $1
       FOR UPDATE`,
      [classId]
    );
    if (classRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Clase no encontrada" });
    }
    const cls = classRes.rows[0];
    if (cls.status === "cancelled") {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Esta clase fue cancelada" });
    }

    const clsCategory = normalizeClassCategory(cls.class_category, "all");
    const membership = await selectMembershipForClass({
      userId: req.userId,
      classCategory: clsCategory,
      classDate: cls.date,
      classStartTime: cls.start_time,
      client,
    });
    if (!membership) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        message: `No tienes membresía activa con créditos para esta clase.`,
      });
    }

    // Lock selected membership row to prevent double consumption
    const lockedMembershipRes = await client.query(
      "SELECT id, classes_remaining FROM memberships WHERE id = $1 FOR UPDATE",
      [membership.id]
    );
    const lockedMembership = lockedMembershipRes.rows[0];
    if (!lockedMembership) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "No se encontró una membresía válida para esta reserva." });
    }

    if (!isMembershipCategoryCompatible(membership.class_category, clsCategory)) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        message: `Tu membresía no incluye este tipo de clase. Necesitas una membresía compatible.`,
      });
    }

    // ── Clase Muestra: restrict to allowed day+time slots ──
    if (isTrialPlan(membership) && !isClassAllowedForTrial(cls.date, cls.start_time)) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        message: "Tu Clase Muestra solo puede reservarse en los horarios disponibles: Lunes 8:20 AM / 7:20 PM, Martes 9:25 AM, Jueves 9:25 AM.",
      });
    }

    // ── Generic time-window restriction (e.g. Morning Pass) ──
    const timeCheck = checkPlanTimeRestriction(membership, cls.date, cls.start_time);
    if (!timeCheck.allowed) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: timeCheck.message });
    }

    if (!isUnlimitedClasses(lockedMembership.classes_remaining) && Number(lockedMembership.classes_remaining) <= 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        message: "Ya no tienes clases disponibles en tu paquete. Renueva o adquiere un nuevo plan.",
      });
    }

    const dupRes = await client.query(
      "SELECT id FROM bookings WHERE class_id = $1 AND user_id = $2 AND status != 'cancelled'",
      [classId, req.userId]
    );
    if (dupRes.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Ya tienes una reserva para esta clase" });
    }

    const isWaitlist = cls.current_bookings >= cls.max_capacity;

    // Lista de espera: si la clase está llena y ya pasó el cutoff (faltan menos
    // de waitlist_cutoff_hours), no se permite unirse — ya no habría auto-promoción.
    if (isWaitlist) {
      const cancelCfg = await getCancellationConfig();
      const cutoffRaw = Number(cancelCfg.waitlist_cutoff_hours);
      const cutoffH = Number.isFinite(cutoffRaw) ? cutoffRaw : 3;
      if (cutoffH > 0 && cls.class_start_utc) {
        const minsUntil = (new Date(cls.class_start_utc).getTime() - Date.now()) / 60_000;
        if (minsUntil < cutoffH * 60) {
          await client.query("ROLLBACK");
          return res.status(403).json({
            message: `La lista de espera de esta clase ya cerró (faltan menos de ${cutoffH} h para la clase).`,
          });
        }
      }
    }

    const status = isWaitlist ? "waitlist" : "confirmed";
    const result = await client.query(
      `INSERT INTO bookings (class_id, user_id, membership_id, status)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [classId, req.userId, membership.id, status]
    );

    if (!isWaitlist) {
      await client.query(
        "UPDATE classes SET current_bookings = current_bookings + 1 WHERE id = $1",
        [classId]
      );
      if (!isUnlimitedClasses(lockedMembership.classes_remaining)) {
        await consumeMembershipCredit(client, membership.id, clsCategory);
      }
    }

    // Posición en la lista de espera (la recién insertada es la última → su
    // posición = total de entradas en waitlist de esa clase).
    let waitlistPosition = null;
    if (isWaitlist) {
      const posRes = await client.query(
        "SELECT COUNT(*)::int AS pos FROM bookings WHERE class_id = $1 AND status = 'waitlist'",
        [classId]
      );
      waitlistPosition = posRes.rows[0]?.pos ?? null;
    }
    await client.query("COMMIT");

    // ── Email: booking confirmed / waitlist ────────────────────────────────
    try {
      const userRes = await pool.query("SELECT email, display_name, phone FROM users WHERE id = $1", [req.userId]);
      const classFullRes = await pool.query(
        `SELECT c.date, c.start_time, ct.name AS class_type_name,
                i.display_name AS instructor_name
         FROM classes c
         JOIN class_types ct ON c.class_type_id = ct.id
         LEFT JOIN instructors i ON c.instructor_id = i.id
         WHERE c.id = $1`,
        [classId]
      );
      const memAfter = await pool.query("SELECT classes_remaining FROM memberships WHERE id = $1", [membership.id]);
      const classesLeft = memAfter.rows[0]?.classes_remaining ?? null;

      if (userRes.rows[0] && classFullRes.rows[0]) {
        const u = userRes.rows[0];
        const cl = classFullRes.rows[0];
        if (await areEmailNotificationsEnabled()) {
          sendBookingConfirmed({
            to: u.email,
            name: u.display_name || "Alumna",
            className: cl.class_type_name,
            date: cl.date,
            startTime: cl.start_time,
            instructor: cl.instructor_name,
            classesLeft,
            isWaitlist,
          }).catch((e) => console.error("[Email] booking confirmed:", e.message));
        }
        const waName = u.display_name || "Alumna";
        const waClass = cl.class_type_name || "tu clase";
        const waDate = cl.date ? new Date(cl.date).toLocaleDateString("es-MX") : "";
        const waTime = cl.start_time ? String(cl.start_time).slice(0, 5) : "";
        sendConfiguredWhatsAppTemplate({
          templateKey: isWaitlist ? "booking_waitlist" : "booking_confirmed",
          phone: u.phone,
          vars: { name: waName, class: waClass, date: waDate, time: waTime },
          fallbackMessage: isWaitlist
            ? waitlistJoinFallback(waName, waClass, waDate, waTime)
            : `Hola ${waName}, tu reserva para ${waClass} (${waDate} ${waTime}) está confirmada.`,
        }).catch((e) => console.error("[WA] booking confirmed:", e.message));
        sendConfiguredPushTemplate({
          templateKey: isWaitlist ? "booking_waitlist" : "booking_confirmed",
          userId: req.userId,
          vars: { name: waName, class: waClass, date: waDate, time: waTime },
        }).catch((e) => console.error("[Push] booking confirmed:", e.message));
      }
    } catch (emailErr) {
      console.error("[Email] booking confirmed query error:", emailErr.message);
    }

    const msg = isWaitlist
      ? `Añadido a la lista de espera${waitlistPosition ? ` · posición ${waitlistPosition}` : ""}`
      : "Reserva confirmada";
    triggerWalletPassSync(req.userId, isWaitlist ? "booking_waitlist_created" : "booking_created");
    return res.status(201).json({ message: msg, booking: result.rows[0], waitlistPosition });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { }
    console.error("POST bookings error:", err);
    return res.status(500).json({ message: "Error interno" });
  } finally {
    client.release();
  }
});

// DELETE /api/bookings/:id
app.delete("/api/bookings/:id", authMiddleware, async (req, res) => {
  try {
    // Load booking
    const r = await pool.query(
      `SELECT b.*, c.date, c.start_time, ct.name AS class_type_name
       FROM bookings b
       JOIN classes c ON b.class_id = c.id
       JOIN class_types ct ON c.class_type_id = ct.id
       WHERE b.id = $1 AND b.user_id = $2`,
      [req.params.id, req.userId]
    );
    if (r.rows.length === 0) return res.status(404).json({ message: "Reserva no encontrada" });
    const booking = r.rows[0];

    if (booking.status === "cancelled") {
      return res.status(400).json({ message: "Esta reserva ya fue cancelada" });
    }

    // ── Salir de la lista de espera: camino aparte ────────────────────────────
    // No aplica ventana de cancelación (cutoff), ni crédito, ni cupo, ni
    // promoción, ni el correo de "reserva cancelada". Idempotente vía
    // WHERE status='waitlist' (un doble clic afecta 0 filas, sin daño).
    if (booking.status === "waitlist") {
      await pool.query(
        "UPDATE bookings SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = 'user' WHERE id = $1 AND status = 'waitlist'",
        [req.params.id]
      );
      triggerWalletPassSync(req.userId, "booking_waitlist_left");
      return res.json({ message: "Saliste de la lista de espera.", wasWaitlist: true, creditRestored: false });
    }

    // ── Check membership cancellation limit (max 2 per membership period) ──
    let membership = null;
    if (booking.membership_id) {
      const memRes = await pool.query(
        "SELECT id, classes_remaining, cancellations_used, plan_id FROM memberships WHERE id = $1",
        [booking.membership_id]
      );
      membership = memRes.rows[0] ?? null;
    }

    // ── Load cancellation config ────────────────────────────────────────────
    const cancelConfig = await getCancellationConfig();

    // Client cancellations can be globally disabled by admin
    if (!cancelConfig.enabled) {
      return res.status(403).json({
        code: "CANCELLATIONS_DISABLED",
        message: "Las cancelaciones no están habilitadas en este momento. Contacta con el estudio.",
      });
    }

    // Cancellations limit only applies to confirmed bookings; waitlist
    // cancellations don't count and shouldn't be blocked.
    const cancelLimit = Number(cancelConfig.cancellations_limit) || 0;
    if (booking.status === "confirmed" && membership && cancelLimit > 0 && (membership.cancellations_used ?? 0) >= cancelLimit) {
      return res.status(403).json({
        code: "CANCELLATIONS_LIMIT_REACHED",
        message: `Has alcanzado el límite de ${cancelLimit} cancelacion${cancelLimit === 1 ? "" : "es"} permitida${cancelLimit === 1 ? "" : "s"} en tu membresía actual. Contacta con el estudio si necesitas ayuda.`,
      });
    }

    // ── Check advance notice window ─────────────────────────────────────────
    // Classes are in Mexico City time; use the DB's start_time timestamp directly
    // booking.date comes from the classes table (type DATE) and start_time is TIMESTAMPTZ
    // We read the class start as Mexico City local time to compare correctly
    const classStartRes = await pool.query(
      `SELECT (c.date + c.start_time::time) AT TIME ZONE 'America/Mexico_City' AS class_start_utc
       FROM classes c WHERE c.id = $1`,
      [booking.class_id]
    );
    const classStartUTC = classStartRes.rows[0]?.class_start_utc
      ? new Date(classStartRes.rows[0].class_start_utc)
      : null;
    const now = new Date();
    const minutesUntilClass = classStartUTC
      ? (classStartUTC.getTime() - now.getTime()) / 60_000
      : 999; // if we can't determine, assume on-time

    if (minutesUntilClass < 0) {
      return res.status(400).json({
        code: "CLASS_ALREADY_STARTED",
        message: "Esta clase ya comenzó y no puede cancelarse.",
      });
    }

    // Refund threshold = min_hours (default 12); no-cancel cutoff = reschedule_hours (default 3).
    // - hoursLeft >= min_hours  → cancel allowed + credit refunded.
    // - reschedule_hours <= hoursLeft < min_hours → cancel allowed, credit NOT refunded (penalty).
    // - hoursLeft < reschedule_hours → cancel BLOCKED (student loses the spot).
    const cancelCheck = canCancel({
      nowMs: now.getTime(),
      classStartMs: classStartUTC ? classStartUTC.getTime() : now.getTime() + 999 * 60000,
      cancelHours: Number(cancelConfig.min_hours) || 12,
      minHours: Number(cancelConfig.reschedule_hours) || 3,
    });

    // Block cancellation only when inside the no-cancel window (< reschedule_hours).
    if (!cancelCheck.allowed) {
      return res.status(403).json({
        code: "CANCELLATION_TOO_LATE",
        message: "Ya no puedes cancelar con menos de " + (Number(cancelConfig.reschedule_hours) || 3) + " horas. Si no asistes perderás el lugar.",
      });
    }

    // Refund credit only when within the refund window (>= min_hours) AND the config flag allows it.
    const shouldRefund = cancelCheck.refundCredit && (cancelConfig.refund_credit_on_cancel !== false);

    // Cancelar de forma IDEMPOTENTE: el UPDATE con guard `status='confirmed'`
    // serializa por el lock de fila; solo la petición que realmente transiciona
    // confirmed→cancelled obtiene rowCount=1 y corre los efectos. Un doble clic /
    // reintento concurrente del mismo booking obtiene rowCount=0 y se descarta,
    // evitando doble liberación de cupo, doble reembolso y doble promoción.
    const cancelUpd = await pool.query(
      "UPDATE bookings SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = 'user' WHERE id = $1 AND status = 'confirmed' RETURNING id",
      [req.params.id]
    );
    if (cancelUpd.rowCount !== 1) {
      return res.status(400).json({ message: "Esta reserva ya fue cancelada" });
    }

    // Libera el lugar
    await pool.query(
      "UPDATE classes SET current_bookings = GREATEST(current_bookings - 1, 0) WHERE id = $1",
      [booking.class_id]
    );

    if (membership) {
      await pool.query(
        "UPDATE memberships SET cancellations_used = COALESCE(cancellations_used, 0) + 1 WHERE id = $1",
        [membership.id]
      );
      // Restore credit only when configured and membership has a counted limit
      if (shouldRefund && membership.classes_remaining !== null && membership.classes_remaining < 9999) {
        await pool.query(
          "UPDATE memberships SET classes_remaining = classes_remaining + 1 WHERE id = $1",
          [membership.id]
        );
      }
    }

    // Auto-promover la lista de espera al liberarse un lugar (FIFO, con cutoff
    // y saltando a quien no tenga crédito). promoteWaitlist es atómico: abre su
    // propia transacción, bloquea la clase y re-verifica el cupo.
    const promoted = await promoteWaitlist(booking.class_id);
    if (promoted) {
      triggerWalletPassSync(promoted.userId, "booking_promoted_from_waitlist");
      notifyWaitlistPromotion(promoted.userId, booking.class_id).catch(() => {});
    }

    // ── Email / WhatsApp: booking cancelled ───────────────────────────────
    try {
      const uRes = await pool.query("SELECT email, display_name, phone FROM users WHERE id = $1", [req.userId]);
      const memAfter = membership
        ? await pool.query("SELECT classes_remaining FROM memberships WHERE id = $1", [membership.id])
        : null;
      if (uRes.rows[0]) {
        const u = uRes.rows[0];
        if (await areEmailNotificationsEnabled()) {
          sendBookingCancelled({
            to: u.email,
            name: u.display_name || "Alumna",
            className: booking.class_type_name || "tu clase",
            date: booking.date,
            startTime: booking.start_time,
            creditRestored: shouldRefund,
            isLate: false,
            classesLeft: memAfter?.rows[0]?.classes_remaining ?? null,
          }).catch((e) => console.error("[Email] booking cancelled:", e.message));
        }
        sendConfiguredWhatsAppTemplate({
          templateKey: "booking_cancelled",
          phone: u.phone,
          vars: {
            name: u.display_name || "Alumna",
            class: booking.class_type_name || "tu clase",
            date: booking.date ? new Date(booking.date).toLocaleDateString("es-MX") : "",
            time: booking.start_time ? String(booking.start_time).slice(0, 5) : "",
            creditRestored: shouldRefund ? "Sí" : "No",
          },
          fallbackMessage: shouldRefund
            ? `Hola ${u.display_name || "Alumna"}, cancelaste tu reserva de ${booking.class_type_name || "tu clase"}. Tu crédito fue devuelto.`
            : `Hola ${u.display_name || "Alumna"}, cancelaste tu reserva de ${booking.class_type_name || "tu clase"}. La clase no fue devuelta.`,
        }).catch((e) => console.error("[WA] booking cancelled:", e.message));
        sendConfiguredPushTemplate({
          templateKey: "booking_cancelled",
          userId: req.userId,
          vars: {
            name: u.display_name || "Alumna",
            class: booking.class_type_name || "tu clase",
            date: booking.date ? new Date(booking.date).toLocaleDateString("es-MX") : "",
            time: booking.start_time ? String(booking.start_time).slice(0, 5) : "",
            creditRestored: shouldRefund ? "Sí" : "No",
          },
        }).catch((e) => console.error("[Push] booking cancelled:", e.message));
      }
    } catch (emailErr) {
      console.error("[Email] cancelled query:", emailErr.message);
    }

    triggerWalletPassSync(req.userId, "booking_cancelled");
    return res.json({
      message: shouldRefund
        ? "Reserva cancelada. Se devolvió el crédito a tu paquete."
        : "Reserva cancelada. La clase no fue devuelta al paquete.",
      creditRestored: shouldRefund,
    });
  } catch (err) {
    console.error("DELETE bookings error:", err.message, err.stack);
    return res.status(500).json({ message: "Error interno", detail: err.message });
  }
});

// PUT /api/bookings/:id/reschedule
// Moves a CONFIRMED booking to a different future class WITHOUT changing credit.
app.put("/api/bookings/:id/reschedule", authMiddleware, async (req, res) => {
  try {
    const bookingId = req.params.id;
    const newClassId = req.body?.new_class_id ?? req.body?.newClassId;

    // ── Load booking (must exist + belong to user) ────────────────────────────
    const r = await pool.query(
      `SELECT b.id, b.class_id, b.user_id, b.membership_id, b.status
         FROM bookings b
        WHERE b.id = $1 AND b.user_id = $2`,
      [bookingId, req.userId]
    );
    if (r.rows.length === 0) return res.status(404).json({ message: "Reserva no encontrada" });
    const booking = r.rows[0];

    if (booking.status !== "confirmed") {
      return res.status(400).json({ message: "Solo puedes reagendar reservas confirmadas." });
    }

    if (!newClassId || newClassId === booking.class_id) {
      return res.status(400).json({ message: "Selecciona una clase distinta" });
    }

    // ── Check advance notice window on the CURRENT class (Mexico City) ─────────
    const classStartRes = await pool.query(
      `SELECT (c.date + c.start_time::time) AT TIME ZONE 'America/Mexico_City' AS class_start_utc
         FROM classes c WHERE c.id = $1`,
      [booking.class_id]
    );
    const currentClassStart = classStartRes.rows[0]?.class_start_utc
      ? new Date(classStartRes.rows[0].class_start_utc)
      : null;
    const now = new Date();
    const minutesUntilClass = currentClassStart
      ? (currentClassStart.getTime() - now.getTime()) / 60_000
      : 999; // if we can't determine, assume on-time

    if (minutesUntilClass < 0) {
      return res.status(400).json({
        code: "CLASS_ALREADY_STARTED",
        message: "Esta clase ya comenzó y no puede reagendarse.",
      });
    }

    // ── Reschedule window check (config-driven, via tested policy module) ──────
    const cancelConfig = await getCancellationConfig();
    const rescheduleHours = Number(cancelConfig.reschedule_hours ?? 3);
    const rescheduleCheck = canReschedule({
      nowMs: now.getTime(),
      classStartMs: currentClassStart ? currentClassStart.getTime() : now.getTime() + 999 * 60000,
      rescheduleHours,
    });
    if (!rescheduleCheck.allowed) {
      return res.status(403).json({
        code: "RESCHEDULE_WINDOW_EXCEEDED",
        message: "Solo puedes reagendar con al menos " + rescheduleHours + " horas de anticipación.",
      });
    }

    // ── Transaction: move the spot (capacity-safe, FOR UPDATE on new class) ────
    let oldClassId = null; // authoritative old class id (re-read under lock); used for audit after COMMIT
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Re-load + lock the booking row to guard against a concurrent cancel/move
      // slipping in between the pre-transaction status read and the seat-move.
      const bRow = await client.query(
        "SELECT status, class_id FROM bookings WHERE id = $1 FOR UPDATE",
        [req.params.id]
      );
      if (!bRow.rows.length || bRow.rows[0].status !== "confirmed") {
        await client.query("ROLLBACK");
        return res.status(409).json({
          code: "BOOKING_NOT_CONFIRMED",
          message: "La reserva cambió de estado. Recarga e intenta de nuevo.",
        });
      }
      // Authoritative old class id (in case it changed under us).
      oldClassId = bRow.rows[0].class_id;

      // Lock the target class row to avoid overbooking in concurrent requests
      const newClassRes = await client.query(
        `SELECT id, max_capacity, current_bookings, status, date,
                (date + start_time::time) AT TIME ZONE 'America/Mexico_City' AS class_start_utc
           FROM classes
          WHERE id = $1
          FOR UPDATE`,
        [newClassId]
      );
      if (newClassRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Clase no encontrada" });
      }
      const newCls = newClassRes.rows[0];

      if (newCls.status === "cancelled") {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "La clase seleccionada fue cancelada." });
      }

      const newStart = newCls.class_start_utc ? new Date(newCls.class_start_utc) : null;
      if (newStart && newStart.getTime() < now.getTime()) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "No puedes reagendar a una clase que ya pasó." });
      }

      // ── Vigencia: la nueva clase debe caer dentro de la vigencia del paquete ──
      if (booking.membership_id) {
        const vig = await client.query(
          "SELECT 1 FROM memberships WHERE id = $1 AND (end_date IS NULL OR end_date >= $2::date)",
          [booking.membership_id, newCls.date]
        );
        if (vig.rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(403).json({
            code: "OUT_OF_VALIDITY",
            message: "Esa clase está fuera de la vigencia de tu paquete. Elige una dentro de tu periodo vigente.",
          });
        }
      }

      if (Number(newCls.current_bookings) >= Number(newCls.max_capacity)) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          code: "CLASS_FULL",
          message: "La clase seleccionada ya está llena.",
        });
      }

      // Guard against an existing (different) booking on the TARGET class for this
      // user — otherwise we'd over-count the target's seat / leave two confirmed
      // bookings on it (mirrors the POST /api/bookings duplicate guard).
      const dup = await client.query(
        "SELECT 1 FROM bookings WHERE class_id = $1 AND user_id = $2 AND status <> 'cancelled' AND id <> $3 LIMIT 1",
        [newClassId, req.userId, req.params.id]
      );
      if (dup.rows.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          code: "ALREADY_BOOKED",
          message: "Ya tienes una reserva para esa clase.",
        });
      }

      // Free old spot (use the locked booking's authoritative class id)
      await client.query(
        "UPDATE classes SET current_bookings = GREATEST(current_bookings - 1, 0) WHERE id = $1",
        [oldClassId]
      );
      // Take new spot
      await client.query(
        "UPDATE classes SET current_bookings = current_bookings + 1 WHERE id = $1",
        [newClassId]
      );
      // Move the booking (do NOT touch status, membership_id or credit)
      await client.query(
        "UPDATE bookings SET class_id = $1, updated_at = NOW() WHERE id = $2",
        [newClassId, bookingId]
      );

      await client.query("COMMIT");
    } catch (txErr) {
      try { await client.query("ROLLBACK"); } catch (_) { }
      throw txErr;
    } finally {
      client.release();
    }

    // ── Audit (best-effort; a logging failure must never break the reschedule) ─
    try {
      pool.query(
        "INSERT INTO booking_reschedules (booking_id, user_id, from_class_id, to_class_id) VALUES ($1,$2,$3,$4)",
        [req.params.id, req.userId, oldClassId, newClassId]
      ).catch(() => { });
    } catch (_) { }

    // ── Notify (best-effort; failures must not break the response) ────────────
    try {
      const userRes = await pool.query("SELECT email, display_name, phone FROM users WHERE id = $1", [req.userId]);
      const classFullRes = await pool.query(
        `SELECT c.date, c.start_time, ct.name AS class_type_name,
                i.display_name AS instructor_name
           FROM classes c
           JOIN class_types ct ON c.class_type_id = ct.id
           LEFT JOIN instructors i ON c.instructor_id = i.id
          WHERE c.id = $1`,
        [newClassId]
      );
      const classesLeft = booking.membership_id
        ? (await pool.query("SELECT classes_remaining FROM memberships WHERE id = $1", [booking.membership_id])).rows[0]?.classes_remaining ?? null
        : null;

      if (userRes.rows[0] && classFullRes.rows[0]) {
        const u = userRes.rows[0];
        const cl = classFullRes.rows[0];
        if (await areEmailNotificationsEnabled()) {
          sendBookingConfirmed({
            to: u.email,
            name: u.display_name || "Alumna",
            className: cl.class_type_name,
            date: cl.date,
            startTime: cl.start_time,
            instructor: cl.instructor_name,
            classesLeft,
            isWaitlist: false,
          }).catch((e) => console.error("[Email] booking rescheduled:", e.message));
        }
        const waName = u.display_name || "Alumna";
        const waClass = cl.class_type_name || "tu clase";
        const waDate = cl.date ? new Date(cl.date).toLocaleDateString("es-MX") : "";
        const waTime = cl.start_time ? String(cl.start_time).slice(0, 5) : "";
        sendConfiguredWhatsAppTemplate({
          templateKey: "booking_confirmed",
          phone: u.phone,
          vars: { name: waName, class: waClass, date: waDate, time: waTime },
          fallbackMessage: `Hola ${waName}, reagendaste tu reserva. Ahora tienes ${waClass} (${waDate} ${waTime}).`,
        }).catch((e) => console.error("[WA] booking rescheduled:", e.message));
      }
    } catch (notifyErr) {
      console.error("[Reschedule] notify query error:", notifyErr.message);
    }

    triggerWalletPassSync(req.userId, "booking_rescheduled");
    return res.json({ data: { id: bookingId, class_id: newClassId, status: "confirmed" } });
  } catch (err) {
    console.error("PUT bookings reschedule error:", err.message, err.stack);
    return res.status(500).json({ message: "Error interno", detail: err.message });
  }
});

// POST /api/reviews
app.post("/api/reviews", authMiddleware, async (req, res) => {
  const { bookingId, rating, comment, tagIds } = req.body;
  if (!bookingId || !rating) return res.status(400).json({ message: "bookingId y rating requeridos" });
  try {
    const safeRating = Math.max(1, Math.min(5, Number(rating)));
    if (!Number.isFinite(safeRating)) {
      return res.status(400).json({ message: "rating inválido" });
    }
    // Verify booking belongs to user and was attended
    const bRes = await pool.query(
      `SELECT b.id, b.status, c.id AS class_id, c.instructor_id
       FROM bookings b
       JOIN classes c ON b.class_id = c.id
       WHERE b.id = $1 AND b.user_id = $2`,
      [bookingId, req.userId]
    );
    if (bRes.rows.length === 0) return res.status(404).json({ message: "Reserva no encontrada" });
    const booking = bRes.rows[0];

    // Check if already reviewed
    const existing = await pool.query("SELECT id FROM reviews WHERE booking_id = $1", [bookingId]);
    if (existing.rows.length > 0) return res.status(409).json({ message: "Ya dejaste una reseña para esta clase" });

    // Compatible insert for both schemas:
    // - reviews.rating (legacy/current)
    // - reviews.overall_rating (production variants)
    const colRes = await pool.query(
      `SELECT a.attname AS column_name
       FROM pg_attribute a
       JOIN pg_class c ON a.attrelid = c.oid
       JOIN pg_namespace n ON c.relnamespace = n.oid
       WHERE n.nspname='public'
         AND c.relname='reviews'
         AND a.attnum > 0
         AND NOT a.attisdropped
         AND a.attname = ANY($1::text[])`,
      [["rating", "overall_rating", "tag_ids"]]
    );
    const hasRating = colRes.rows.some((r) => r.column_name === "rating");
    const hasOverallRating = colRes.rows.some((r) => r.column_name === "overall_rating");
    const hasTagIds = colRes.rows.some((r) => r.column_name === "tag_ids");

    const insertCols = ["user_id", "booking_id", "class_id", "instructor_id"];
    const insertVals = [req.userId, bookingId, booking.class_id, booking.instructor_id || null];

    if (hasRating) {
      insertCols.push("rating");
      insertVals.push(safeRating);
    }
    if (hasOverallRating) {
      insertCols.push("overall_rating");
      insertVals.push(safeRating);
    }

    insertCols.push("comment");
    insertVals.push(comment || null);

    if (hasTagIds) {
      insertCols.push("tag_ids");
      insertVals.push(tagIds || []);
    }

    const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(", ");

    let review;
    try {
      const rRes = await pool.query(
        `INSERT INTO reviews (${insertCols.join(", ")})
         VALUES (${placeholders}) RETURNING *`,
        insertVals
      );
      review = rRes.rows[0];
    } catch (insertErr) {
      // Safety retry for schemas where overall_rating exists but wasn't detected
      const shouldRetry =
        insertErr?.code === "23502" &&
        insertErr?.column === "overall_rating" &&
        !insertCols.includes("overall_rating");

      if (!shouldRetry) throw insertErr;

      const retryCols = [...insertCols];
      const retryVals = [...insertVals];
      const insertAt = hasRating ? retryCols.indexOf("rating") + 1 : 4;
      retryCols.splice(insertAt, 0, "overall_rating");
      retryVals.splice(insertAt, 0, safeRating);
      const retryPlaceholders = retryCols.map((_, i) => `$${i + 1}`).join(", ");

      const retryRes = await pool.query(
        `INSERT INTO reviews (${retryCols.join(", ")})
         VALUES (${retryPlaceholders}) RETURNING *`,
        retryVals
      );
      review = retryRes.rows[0];
    }

    // Insert tag links
    if (Array.isArray(tagIds) && tagIds.length > 0) {
      for (const tagId of tagIds) {
        await pool.query(
          "INSERT INTO review_tag_links (review_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [review.id, tagId]
        ).catch(() => { });
      }
    }

    return res.json({ message: "Reseña enviada — gracias por tu opinión", data: review });
  } catch (err) {
    if (
      err?.code === "23505" &&
      String(err?.detail || err?.message || "").toLowerCase().includes("booking_id")
    ) {
      return res.status(409).json({ message: "Ya dejaste una reseña para esta clase" });
    }
    console.error("POST reviews error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Routes: /api/orders ────────────────────────────────────────────────────

// GET /api/orders
app.get("/api/orders", authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT o.*, p.name AS plan_name, p.duration_days,
              COALESCE((
                SELECT json_agg(json_build_object(
                         'plan_id', i.plan_id, 'plan_name', ip.name,
                         'quantity', i.quantity, 'unit_price', i.unit_price, 'line_total', i.line_total
                       ) ORDER BY i.created_at)
                FROM order_plan_items i JOIN plans ip ON ip.id = i.plan_id
                WHERE i.order_id = o.id
              ), '[]'::json) AS items
       FROM orders o
       JOIN plans p ON o.plan_id = p.id
       WHERE o.user_id = $1
       ORDER BY o.created_at DESC`,
      [req.userId]
    );
    return res.json({ data: r.rows });
  } catch (err) {
    console.error("GET orders error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/notifications — real notifications from orders, bookings, memberships
app.get("/api/notifications", authMiddleware, async (req, res) => {
  try {
    const notifications = [];

    // 1) Orders — approved, rejected, pending
    const orders = await pool.query(
      `SELECT o.id, o.status, o.total, o.created_at, o.updated_at, o.order_number,
              p.name AS plan_name
       FROM orders o
       JOIN plans p ON o.plan_id = p.id
       WHERE o.user_id = $1
       ORDER BY o.updated_at DESC
       LIMIT 20`,
      [req.userId]
    );
    for (const o of orders.rows) {
      if (o.status === "paid") {
        notifications.push({
          id: `order-paid-${o.id}`,
          title: "Pago aprobado",
          body: `Tu pago de $${o.total} para ${o.plan_name} fue aprobado. ¡Tu membresía está activa!`,
          time: o.updated_at,
          unread: (Date.now() - new Date(o.updated_at).getTime()) < 7 * 86400000,
          type: "success",
        });
      } else if (o.status === "rejected") {
        notifications.push({
          id: `order-rej-${o.id}`,
          title: "Pago rechazado",
          body: `Tu pago para ${o.plan_name} (${o.order_number || ""}) fue rechazado. Contacta al estudio para más información.`,
          time: o.updated_at,
          unread: (Date.now() - new Date(o.updated_at).getTime()) < 7 * 86400000,
          type: "error",
        });
      } else if (o.status === "pending_verification") {
        notifications.push({
          id: `order-pend-${o.id}`,
          title: "Pago en revisión",
          body: `Tu orden ${o.order_number || ""} para ${o.plan_name} está siendo revisada.`,
          time: o.created_at,
          unread: true,
          type: "info",
        });
      }
    }

    // 2) Upcoming bookings (next 48h)
    const bookings = await pool.query(
      `SELECT b.id, b.status, c.date, c.start_time, ct.name AS class_name
       FROM bookings b
       JOIN classes c ON b.class_id = c.id
       JOIN class_types ct ON c.class_type_id = ct.id
       WHERE b.user_id = $1 AND b.status = 'confirmed'
         AND ((c.date + c.start_time::time) AT TIME ZONE 'America/Mexico_City') >= NOW()
         AND ((c.date + c.start_time::time) AT TIME ZONE 'America/Mexico_City') <= NOW() + INTERVAL '48 hours'
       ORDER BY c.date, c.start_time
       LIMIT 10`,
      [req.userId]
    );
    for (const b of bookings.rows) {
      notifications.push({
        id: `booking-${b.id}`,
        title: "Clase próxima",
        body: `Tu clase de ${b.class_name} es el ${b.date} a las ${b.start_time}.`,
        time: new Date().toISOString(),
        unread: true,
        type: "reminder",
      });
    }

    // 3) Active memberships
    const memberships = await pool.query(
      `SELECT m.id, m.status, m.classes_remaining, m.start_date, m.created_at,
              COALESCE(m.plan_name_override, p.name) AS plan_name
       FROM memberships m
       LEFT JOIN plans p ON m.plan_id = p.id
       WHERE m.user_id = $1 AND m.status = 'active'
       ORDER BY m.created_at DESC
       LIMIT 5`,
      [req.userId]
    );
    for (const m of memberships.rows) {
      if (m.classes_remaining !== null && m.classes_remaining <= 2 && m.classes_remaining > 0) {
        notifications.push({
          id: `mem-low-${m.id}`,
          title: "Créditos por agotarse",
          body: `Tu membresía ${m.plan_name} tiene solo ${m.classes_remaining} clase(s) restante(s).`,
          time: new Date().toISOString(),
          unread: true,
          type: "warning",
        });
      }
    }

    // Sort by time descending
    notifications.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    return res.json({ data: notifications });
  } catch (err) {
    console.error("GET notifications error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/orders/:id
app.get("/api/orders/:id", authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT o.*, p.name AS plan_name, p.duration_days, p.features,
              pp.file_url AS proof_url, pp.status AS proof_status, pp.uploaded_at AS proof_uploaded_at
       FROM orders o
       JOIN plans p ON o.plan_id = p.id
       LEFT JOIN payment_proofs pp ON pp.order_id = o.id
       WHERE o.id = $1 AND o.user_id = $2`,
      [req.params.id, req.userId]
    );
    if (r.rows.length === 0) return res.status(404).json({ message: "Orden no encontrada" });
    return res.json({ data: r.rows[0] });
  } catch (err) {
    console.error("GET orders/:id error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/inscription-status — does the authenticated client owe the one-time
// inscription (enrollment) fee on their next package purchase?
app.get("/api/inscription-status", authMiddleware, async (req, res) => {
  try {
    const [needsInscription, price, hasPendingPackage] = await Promise.all([
      clientNeedsInscription(req.userId),
      getInscriptionPrice(),
      clientHasPendingPackage(req.userId),
    ]);
    // Puede comprar "Clase Extra" si ya está inscrita (no necesita inscripción) o
    // si tiene un paquete pendiente que la está inscribiendo. Refleja el gate del
    // servidor para que el front bloquee/desbloquee exactamente igual.
    const canBuyClaseExtra = !needsInscription || hasPendingPackage;
    return res.json({ data: { needsInscription, price, hasPendingPackage, canBuyClaseExtra } });
  } catch (err) {
    console.error("GET inscription-status error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/orders
// ── CARRITO: crear una orden con varios renglones (plan + cantidad) ──────────
// Aislada del camino de 1 plan + complementos para no romper ese flujo.
async function createCartOrder(req, res, paymentMethod) {
  const { items: rawItems, discountCode } = req.body;
  const isCashOrTransfer = paymentMethod === "cash" || paymentMethod === "transfer";

  // Normalizar + fusionar duplicados por plan
  const qtyByPlan = new Map();
  for (const it of rawItems) {
    const pid = it?.planId ?? it?.plan_id;
    if (!pid) continue;
    const q = Math.min(20, Math.max(1, parseInt(it?.quantity, 10) || 1)); // tope 20 por renglón
    qtyByPlan.set(pid, (qtyByPlan.get(pid) || 0) + q);
  }
  const cart = [...qtyByPlan.entries()].map(([planId, quantity]) => ({ planId, quantity }));
  if (!cart.length) return res.status(400).json({ message: "Agrega al menos un plan al carrito" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Cargar planes
    const loaded = [];
    for (const it of cart) {
      const r = await client.query("SELECT * FROM plans WHERE id = $1 AND is_active = true", [it.planId]);
      if (!r.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Uno de los planes no existe o está inactivo" }); }
      loaded.push({ plan: r.rows[0], quantity: it.quantity });
    }

    // Bloquear si ya hay una orden pendiente para alguno de los planes del carrito
    // (evita acumular órdenes pendientes duplicadas; espejo del camino de 1 plan).
    const planIds = loaded.map((l) => l.plan.id);
    const dup = await client.query(
      `SELECT 1 FROM orders
        WHERE user_id = $1 AND plan_id = ANY($2::uuid[])
          AND status IN ('pending_payment','pending_verification') LIMIT 1`,
      [req.userId, planIds]
    );
    if (dup.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Ya tienes una orden pendiente con uno de estos planes. Complétala o cancélala antes de crear otra." });
    }

    const hasPackage = loaded.some((l) => Number(l.plan.class_limit) >= 2);
    const hasInscriptionItem = loaded.some((l) => String(l.plan.name).trim().toLowerCase() === INSCRIPTION_PLAN_NAME.toLowerCase());
    const needsInscription = await clientNeedsInscription(req.userId);
    // ¿Un paquete pendiente ya la está inscribiendo? Solo se consulta si hace falta.
    const hasPendingPackage = needsInscription ? await clientHasPendingPackage(req.userId, client) : false;

    // Validaciones por renglón
    for (const { plan, quantity } of loaded) {
      if (plan.is_non_repeatable) {
        if (quantity > 1) { await client.query("ROLLBACK"); return res.status(400).json({ message: `"${plan.name}" no se puede comprar más de una vez por orden.` }); }
        const conflict = await findNonRepeatablePlanConflict({ userId: req.userId, plan, client });
        if (conflict) { await client.query("ROLLBACK"); return res.status(409).json({ message: conflict.message }); }
      }
      // "Clase Extra" solo para inscritas. Se permite si: ya está inscrita, hay un
      // paquete en este mismo carrito, lleva la Inscripción en el carrito, o ya
      // tiene un paquete pendiente que la inscribe.
      if (String(plan.name).trim().toLowerCase() === "clase extra" && needsInscription && !hasPackage && !hasInscriptionItem && !hasPendingPackage) {
        await client.query("ROLLBACK");
        return res.status(403).json({ message: "La clase extra es solo para alumnas inscritas. Agrega un paquete o la Inscripción en la misma compra, o compra una Clase suelta / visita." });
      }
    }

    // Precios por renglón (transferencia/efectivo usan discount_price si existe; tarjeta usa precio base)
    let itemsSubtotal = 0;
    const lineRows = [];
    for (const { plan, quantity } of loaded) {
      let unit = parseFloat(plan.price);
      if (isCashOrTransfer && plan.discount_price != null && parseFloat(plan.discount_price) > 0) {
        unit = parseFloat(plan.discount_price);
      }
      const lineTotal = Math.round(unit * quantity * 100) / 100;
      itemsSubtotal += lineTotal;
      lineRows.push({ plan, quantity, unit, lineTotal });
    }
    itemsSubtotal = Math.round(itemsSubtotal * 100) / 100;

    // Plan principal: primer paquete, o el primer renglón
    const primary = (loaded.find((l) => Number(l.plan.class_limit) >= 2) || loaded[0]).plan;

    // Descuento (código) sobre el subtotal de ítems (antes de inscripción)
    let discount = 0, appliedDiscountCode = null;
    if (discountCode) {
      const dr = await findApplicableDiscountCode({
        code: discountCode, subtotal: itemsSubtotal, planId: primary.id,
        classCategory: normalizeClassCategory(primary.class_category, "all"),
        channel: "membership", client,
      });
      if (!dr) { await client.query("ROLLBACK"); return res.status(400).json({ message: "Código de descuento no válido" }); }
      if (dr.rejectedByMinOrder) { await client.query("ROLLBACK"); return res.status(400).json({ message: `Compra mínima requerida: $${Number(dr.minOrderAmount || 0).toFixed(2)} MXN` }); }
      discount = dr.discountAmount; appliedDiscountCode = dr.code;
    }

    // Inscripción una sola vez (si hay paquete y la clienta la necesita). Si ya
    // lleva la Inscripción como renglón explícito, NO se auto-agrega (evita doble cobro).
    let inscriptionAmount = 0;
    if (hasPackage && needsInscription && !hasInscriptionItem) {
      inscriptionAmount = await getInscriptionPrice(client);
    }

    // Totales (helper puro testeado): subtotal incluye inscripción; +4% tarjeta sobre el descontado
    const { subtotal, platformFee, total } = computeCartTotals({
      lineTotals: lineRows.map((l) => l.lineTotal),
      discount, inscription: inscriptionAmount, isCard: paymentMethod === "card",
    });

    const bankInfo = await getConfiguredBankInfo(client);
    const expires = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const initialStatus = paymentMethod === "cash" ? "pending_verification" : "pending_payment";

    const cols = ["user_id", "plan_id", "status", "payment_method", "subtotal", "tax_amount", "total_amount", "bank_info", "expires_at"];
    const vals = [req.userId, primary.id, initialStatus, paymentMethod, subtotal, 0, total, JSON.stringify(bankInfo), expires];
    if (platformFee > 0) { cols.push("platform_fee"); vals.push(platformFee); }
    if (discount > 0 || appliedDiscountCode) {
      cols.push("discount_amount"); vals.push(discount);
      if (appliedDiscountCode?.id) { cols.push("discount_code_id"); vals.push(appliedDiscountCode.id); }
    }
    if (inscriptionAmount > 0) { cols.push("inscription_amount"); vals.push(inscriptionAmount); }
    const placeholders = vals.map((_, i) => {
      const c = cols[i];
      if (c === "status") return `$${i + 1}::order_status`;
      if (c === "payment_method") return `$${i + 1}::payment_method`;
      return `$${i + 1}`;
    }).join(", ");
    const orderRes = await client.query(`INSERT INTO orders (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`, vals);
    const order = orderRes.rows[0];

    // Renglones del carrito (la aprobación crea 1 membresía por unidad de cada renglón)
    for (const { plan, quantity, unit, lineTotal } of lineRows) {
      await client.query(
        `INSERT INTO order_plan_items (order_id, plan_id, quantity, unit_price, line_total) VALUES ($1,$2,$3,$4,$5)`,
        [order.id, plan.id, quantity, unit, lineTotal]
      );
    }

    await client.query("COMMIT");

    // Tarjeta: preferencia de MP (por compatibilidad) — el Brick usa total_amount
    let mp_checkout_url = null;
    if (paymentMethod === "card") {
      try {
        const u = await pool.query("SELECT email FROM users WHERE id = $1", [req.userId]);
        const planName = lineRows.length > 1 ? `${primary.name} y ${lineRows.length - 1} más` : primary.name;
        const pref = await createPreference({ orderId: order.id, orderNumber: order.order_number, planName, amount: Number(order.total_amount), userEmail: u.rows[0]?.email || "" });
        mp_checkout_url = pref.checkout_url;
        await pool.query(`UPDATE orders SET payment_provider = 'mercadopago', payment_intent_id = $1, mp_checkout_url = $2, updated_at = NOW() WHERE id = $3`, [pref.preference_id, pref.checkout_url, order.id]);
      } catch (mpErr) { console.error("MercadoPago preference error (cart):", mpErr.message); }
    }

    const itemsOut = lineRows.map((l) => ({ plan_id: l.plan.id, plan_name: l.plan.name, quantity: l.quantity, unit_price: l.unit, line_total: l.lineTotal }));
    return res.status(201).json({
      data: { ...order, plan_name: primary.name, items: itemsOut, mp_checkout_url, inscriptionAmount, bank_details: { ...bankInfo, amount: total, currency: "MXN" } },
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { }
    console.error("POST orders (cart) error:", err);
    return res.status(500).json({ message: err?.message || "Error interno" });
  } finally {
    client.release();
  }
}

app.post("/api/orders", authMiddleware, async (req, res) => {
  const { planId, discountCode, paymentMethod: rawPM = "transfer", complementId, complementType } = req.body;
  const paymentMethod = normalizePaymentMethod(rawPM);
  // Carrito multi-ítem (nuevo) — camino aislado; el resto queda igual (1 plan + complementos).
  if (Array.isArray(req.body.items) && req.body.items.length > 0) {
    return createCartOrder(req, res, paymentMethod);
  }
  if (!planId) return res.status(400).json({ message: "planId requerido" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const planRes = await client.query("SELECT * FROM plans WHERE id = $1 AND is_active = true", [planId]);
    if (planRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Plan no encontrado" });
    }
    const plan = planRes.rows[0];
    const nonRepeatableConflict = await findNonRepeatablePlanConflict({ userId: req.userId, plan, client });
    if (nonRepeatableConflict) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: nonRepeatableConflict.message });
    }

    const planNameLc = String(plan.name).trim().toLowerCase();
    const isInscriptionPlan = planNameLc === INSCRIPTION_PLAN_NAME.toLowerCase();

    // ── Clase Extra: solo para alumnas inscritas ──────────────────────────
    // La "Clase Suelta / Visita" es el ÚNICO producto comprable SIN inscripción.
    // La "Clase Extra" ($130) es para quien ya está inscrita (membresía activa/
    // reciente) o se está inscribiendo (paquete pendiente). Si no, se bloquea.
    if (planNameLc === "clase extra" && (await clientNeedsInscription(req.userId)) && !(await clientHasPendingPackage(req.userId, client))) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "La clase extra es solo para alumnas inscritas. Si aún no te inscribes, paga tu Inscripción, o compra una Clase suelta / visita o un paquete." });
    }

    // ── Inscripción: no permitir pagarla si ya está inscrita o si tiene un
    //    paquete pendiente que ya se la está cobrando (evita doble cobro). ──
    if (isInscriptionPlan) {
      const alreadyEnrolled = !(await clientNeedsInscription(req.userId));
      const pendingPkg = alreadyEnrolled ? false : await clientHasPendingPackage(req.userId, client);
      if (alreadyEnrolled) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "Ya estás inscrita. No necesitas pagar la inscripción de nuevo." });
      }
      if (pendingPkg) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "Tu inscripción ya está incluida en el paquete que tienes pendiente de pago." });
      }
    }

    // ── Block duplicate pending orders for the same plan ──
    const pendingDup = await client.query(
      `SELECT id FROM orders
       WHERE user_id = $1 AND plan_id = $2
         AND status IN ('pending_payment', 'pending_verification')
       LIMIT 1`,
      [req.userId, planId]
    );
    if (pendingDup.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "Ya tienes una orden pendiente para este plan. Completa o cancela la orden existente antes de crear otra.",
      });
    }

    // ── Pricing with cash/transfer discounts ──
    const COMBO_PRICES = { 8: { price: 1030, discount: 990 }, 12: { price: 1250, discount: 1190 }, 16: { price: 1450, discount: 1340 } };
    const activeComplement = complementType || complementId || null;
    let subtotal = parseFloat(plan.price);
    const isCashOrTransfer = paymentMethod === "cash" || paymentMethod === "transfer";

    if (activeComplement) {
      const cl = plan.class_limit;
      const combo = COMBO_PRICES[cl];
      if (combo) {
        subtotal = isCashOrTransfer ? combo.discount : combo.price;
      }
    } else if (isCashOrTransfer && plan.discount_price != null && parseFloat(plan.discount_price) > 0) {
      subtotal = parseFloat(plan.discount_price);
    }

    let discount = 0;
    let appliedDiscountCode = null;

    if (discountCode) {
      const discountResult = await findApplicableDiscountCode({
        code: discountCode,
        subtotal,
        planId,
        classCategory: normalizeClassCategory(plan.class_category, "all"),
        channel: "membership",
        client,
      });
      if (!discountResult) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Código de descuento no válido para este plan" });
      }
      if (discountResult.rejectedByMinOrder) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: `Compra mínima requerida: $${Number(discountResult.minOrderAmount || 0).toFixed(2)} MXN`,
        });
      }
      discount = discountResult.discountAmount;
      appliedDiscountCode = discountResult.code;
    }

    // ── One-time inscription (enrollment) fee ──────────────────────────────
    // Auto-add the $500 inscription when the ordered plan is a CLASS PACKAGE
    // (class_limit >= 2 → the 7/14/20 packages; excludes Clase Extra/Suelta
    // which have limit 1, and Inscripción itself which has limit 0) AND the
    // client needs it (no active/recent membership). Applied here, BEFORE the
    // INSERT and BEFORE any MercadoPago preference, so EVERY payment method
    // (transfer, cash, card) charges it. It is a fee — no extra membership is
    // created; the package membership is still created on approval as today.
    // The discount code (computed above) intentionally applies only to the
    // base plan subtotal, never to the inscription fee.
    let inscriptionAmount = 0;
    const isClassPackage = Number(plan.class_limit) >= 2;
    if (isClassPackage && (await clientNeedsInscription(req.userId))) {
      inscriptionAmount = await getInscriptionPrice(client);
      subtotal += inscriptionAmount;
    }

    // Total después del descuento (incluye inscripción).
    let total = subtotal - discount;
    // ── Recargo "uso de plataforma" SOLO para tarjeta (4% sobre el total a cobrar) ──
    // El cliente paga la comisión del procesador. Transferencia/efectivo NO lo llevan.
    const PLATFORM_FEE_RATE = 0.04;
    let platformFee = 0;
    if (paymentMethod === "card") {
      platformFee = Math.round(total * PLATFORM_FEE_RATE * 100) / 100;
      total = total + platformFee;
    }
    const bankInfo = await getConfiguredBankInfo(client);
    const expires = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h
    // Cash orders skip proof upload → go straight to pending_verification so admin can approve
    const initialStatus = paymentMethod === "cash" ? "pending_verification" : "pending_payment";
    // Build INSERT dynamically — complement_id column may not exist yet
    const cols = ["user_id", "plan_id", "status", "payment_method", "subtotal", "tax_amount", "total_amount", "bank_info", "expires_at"];
    const vals = [req.userId, planId, initialStatus, paymentMethod, subtotal, 0, total, JSON.stringify(bankInfo), expires];
    if (platformFee > 0) {
      cols.push("platform_fee");
      vals.push(platformFee);
    }
    if (discount > 0 || appliedDiscountCode) {
      cols.push("discount_amount");
      vals.push(discount);
      if (appliedDiscountCode?.id) {
        cols.push("discount_code_id");
        vals.push(appliedDiscountCode.id);
      }
    }
    if (activeComplement) {
      cols.push("complement_type");
      vals.push(activeComplement);
      cols.push("notes");
      vals.push(`Complemento: ${activeComplement}`);
    }
    if (inscriptionAmount > 0) {
      cols.push("inscription_amount");
      vals.push(inscriptionAmount);
    }
    const placeholders = vals.map((_, i) => {
      const col = cols[i];
      if (col === "status") return `$${i + 1}::order_status`;
      if (col === "payment_method") return `$${i + 1}::payment_method`;
      return `$${i + 1}`;
    }).join(", ");
    let orderRes;
    try {
      orderRes = await client.query(
        `INSERT INTO orders (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
        vals
      );
    } catch (insertErr) {
      throw insertErr;
    }

    await client.query("COMMIT");

    const order = orderRes.rows[0];

    // ── Tarjeta: generar checkout de MercadoPago (fuera de la transacción) ──
    let mp_checkout_url = null;
    if (paymentMethod === "card") {
      try {
        const u = await pool.query("SELECT email FROM users WHERE id = $1", [req.userId]);
        const pref = await createPreference({
          orderId: order.id,
          orderNumber: order.order_number,
          planName: plan.name,
          amount: Number(order.total_amount),
          userEmail: u.rows[0]?.email || "",
        });
        mp_checkout_url = pref.checkout_url;
        await pool.query(
          `UPDATE orders SET payment_provider = 'mercadopago',
                             payment_intent_id = $1, mp_checkout_url = $2, updated_at = NOW()
             WHERE id = $3`,
          [pref.preference_id, pref.checkout_url, order.id]
        );
      } catch (mpErr) {
        console.error("MercadoPago preference error:", mpErr.message);
        // La orden ya existe (pending_payment); el cliente reintenta con pay-with-card.
      }
    }

    return res.status(201).json({
      data: {
        ...order,
        plan_name: plan.name,
        mp_checkout_url,
        inscriptionAmount,
        bank_details: { ...bankInfo, amount: total, currency: "MXN" },
      }
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { }
    console.error("POST orders error:", err);
    return res.status(500).json({ message: err?.message || "Error interno" });
  } finally {
    client.release();
  }
});

// POST /api/orders/:id/proof  (multipart)
app.post("/api/orders/:id/proof", authMiddleware, upload.any(), async (req, res) => {
  try {
    const orderRes = await pool.query(
      "SELECT * FROM orders WHERE id = $1 AND user_id = $2",
      [req.params.id, req.userId]
    );
    if (orderRes.rows.length === 0) return res.status(404).json({ message: "Orden no encontrada" });
    // No permitir subir comprobante a órdenes ya resueltas (cancelada/rechazada/
    // aprobada) — si no, se "reviviría" a pending_verification.
    if (!["pending_payment", "pending_verification"].includes(orderRes.rows[0].status)) {
      return res.status(409).json({ message: "Esta orden ya no admite comprobante." });
    }

    // Accept any uploaded field name ("proof", "file", etc.)
    const uploadedFile = req.files?.[0] ?? req.file ?? null;

    let fileUrl, fileName, mimeType;
    if (uploadedFile) {
      mimeType = uploadedFile.mimetype;
      fileName = uploadedFile.originalname;
      fileUrl = `data:${mimeType};base64,${uploadedFile.buffer.toString("base64")}`;
    } else if (req.body.fileUrl) {
      fileUrl = req.body.fileUrl;
      fileName = req.body.fileName || "comprobante";
      mimeType = req.body.mimeType || "application/octet-stream";
    } else {
      return res.status(400).json({ message: "No se recibió ningún archivo" });
    }

    const updateRes = await pool.query(
      `UPDATE payment_proofs 
       SET file_url = $2, file_name = $3, mime_type = $4, status = 'pending', uploaded_at = NOW()
       WHERE order_id = $1 RETURNING id`,
      [req.params.id, fileUrl, fileName, mimeType]
    );

    if (updateRes.rowCount === 0) {
      await pool.query(
        `INSERT INTO payment_proofs (order_id, file_url, file_name, mime_type, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [req.params.id, fileUrl, fileName, mimeType]
      );
    }
    await pool.query(
      "UPDATE orders SET status = 'pending_verification', paid_at = COALESCE(paid_at, NOW()) WHERE id = $1",
      [req.params.id]
    );
    return res.json({ message: "Comprobante recibido — estamos verificando tu pago" });
  } catch (err) {
    console.error("POST orders/proof error:", err.message, err.stack);
    return res.status(500).json({ message: "Error interno", detail: err.message });
  }
});

// POST /api/orders/:id/pay-with-card — generar/reutilizar checkout de MP para una orden pendiente
app.post("/api/orders/:id/pay-with-card", authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT o.*, p.name AS plan_name, u.email AS user_email
         FROM orders o
         JOIN plans p ON o.plan_id = p.id
         JOIN users u ON o.user_id = u.id
        WHERE o.id = $1 AND o.user_id = $2`,
      [req.params.id, req.userId]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Orden no encontrada" });
    const order = r.rows[0];
    if (order.status !== "pending_payment") {
      return res.status(400).json({ message: "Esta orden ya no acepta pagos" });
    }
    if (order.mp_checkout_url) {
      return res.json({ data: { mp_checkout_url: order.mp_checkout_url } });
    }
    const pref = await createPreference({
      orderId: order.id,
      orderNumber: order.order_number,
      planName: order.plan_name,
      amount: Number(order.total_amount),
      userEmail: order.user_email || "",
    });
    await pool.query(
      `UPDATE orders SET payment_method = 'card'::payment_method,
                         payment_provider = 'mercadopago',
                         payment_intent_id = $1, mp_checkout_url = $2, updated_at = NOW()
         WHERE id = $3`,
      [pref.preference_id, pref.checkout_url, order.id]
    );
    return res.json({ data: { mp_checkout_url: pref.checkout_url } });
  } catch (err) {
    console.error("pay-with-card error:", err.message);
    return res.status(500).json({ message: "No se pudo generar el checkout" });
  }
});

// Mapa de status_detail de MP → mensaje en español (rechazos comunes de tarjeta)
function mpRejectionMessage(detail) {
  const map = {
    cc_rejected_insufficient_amount:       "Fondos insuficientes.",
    cc_rejected_bad_filled_card_number:    "Número de tarjeta incorrecto.",
    cc_rejected_bad_filled_date:           "Fecha de vencimiento incorrecta.",
    cc_rejected_bad_filled_security_code:  "Código de seguridad (CVV) incorrecto.",
    cc_rejected_bad_filled_other:          "Revisa los datos de la tarjeta.",
    cc_rejected_call_for_authorize:        "Tu banco requiere autorizar este monto. Llámalos y reintenta.",
    cc_rejected_card_disabled:             "Tarjeta inactiva. Llama a tu banco para activarla.",
    cc_rejected_card_error:                "No se pudo procesar la tarjeta. Intenta de nuevo.",
    cc_rejected_duplicated_payment:        "Ya registramos un pago igual hace unos momentos.",
    cc_rejected_high_risk:                 "El pago fue rechazado por prevención de fraude.",
    cc_rejected_max_attempts:              "Superaste el número de intentos. Usa otra tarjeta.",
    cc_rejected_blacklist:                 "La tarjeta no fue autorizada.",
    cc_rejected_other_reason:              "Tu banco rechazó el pago.",
  };
  return map[detail] || "El pago fue rechazado. Intenta con otra tarjeta.";
}

// POST /api/orders/:id/pay-card-token — pago con tarjeta DENTRO de la app (Brick → /v1/payments)
// El cliente envía SOLO el token (MP tokenizó la tarjeta en el navegador); el monto sale del servidor.
app.post("/api/orders/:id/pay-card-token", authMiddleware, async (req, res) => {
  try {
    const { token, payment_method_id, issuer_id, payer } = req.body || {};
    if (!token || !payment_method_id) {
      return res.status(400).json({ message: "Faltan datos de la tarjeta" });
    }
    const r = await pool.query(
      `SELECT o.*, p.name AS plan_name, u.email AS user_email
         FROM orders o
         JOIN plans p ON o.plan_id = p.id
         JOIN users u ON o.user_id = u.id
        WHERE o.id = $1 AND o.user_id = $2`,
      [req.params.id, req.userId]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Orden no encontrada" });
    const order = r.rows[0];
    if (order.status !== "pending_payment") {
      return res.status(400).json({ message: "Esta orden ya no acepta pagos" });
    }

    let payment;
    try {
      payment = await createCardPayment({
        orderId: order.id,
        orderNumber: order.order_number,
        planName: order.plan_name,
        amount: Number(order.total_amount),          // monto del servidor, nunca del cliente
        token,
        paymentMethodId: payment_method_id,
        issuerId: issuer_id,
        payer: { email: payer?.email || order.user_email || "", identification: payer?.identification },
      });
    } catch (mpErr) {
      console.error("pay-card-token MP error:", mpErr.message);
      return res.status(502).json({ message: "No se pudo procesar el pago. Intenta de nuevo." });
    }

    await pool.query(
      `UPDATE orders SET payment_method = 'card'::payment_method,
                         payment_provider = 'mercadopago',
                         mp_payment_id = $1, mp_payment_status = $2, mp_status_detail = $3,
                         provider_synced_at = NOW(), updated_at = NOW()
         WHERE id = $4`,
      [payment.id, payment.status, payment.status_detail, order.id]
    );

    if (payment.status === "approved") {
      // MP YA cobró. Sacar la orden de 'pending_payment' ANTES de activar para que,
      // si la activación falla, NO se pueda volver a cobrar (el reintento exige
      // 'pending_payment'). Si approveOrderFromMP falla, queda 'pending_verification'
      // y se reconcilia con sync-mp del admin.
      await pool.query(
        `UPDATE orders SET status = 'pending_verification', paid_at = COALESCE(paid_at, NOW()), updated_at = NOW()
           WHERE id = $1 AND status = 'pending_payment'`,
        [order.id]
      );
      await approveOrderFromMP(order.id, payment.id);
      return res.json({ data: { status: "approved" } });
    }
    if (payment.status === "in_process" || payment.status === "pending") {
      return res.json({ data: { status: "pending" } });
    }
    // rejected u otro estado terminal
    const message = mpRejectionMessage(payment.status_detail);
    await pool.query(
      `UPDATE orders SET rejection_reason = $1, rejected_at = COALESCE(rejected_at, NOW()), updated_at = NOW()
         WHERE id = $2 AND status = 'pending_payment'`,
      [message, order.id]
    );
    return res.json({ data: { status: "rejected", detail: payment.status_detail, message } });
  } catch (err) {
    console.error("pay-card-token error:", err.message);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/orders/:id/cancel — el cliente cancela su propia orden pendiente de pago
app.post("/api/orders/:id/cancel", authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT status FROM orders WHERE id = $1 AND user_id = $2",
      [req.params.id, req.userId]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Orden no encontrada" });
    if (r.rows[0].status !== "pending_payment") {
      return res.status(400).json({ message: "Solo puedes cancelar órdenes pendientes de pago" });
    }
    const upd = await pool.query(
      `UPDATE orders SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND status = 'pending_payment' RETURNING *`,
      [req.params.id]
    );
    return res.json({ data: upd.rows[0] });
  } catch (err) {
    console.error("cancel order error:", err.message);
    return res.status(500).json({ message: "No se pudo cancelar la orden" });
  }
});

// GET /api/payments/config — el frontend decide si muestra "Tarjeta"
app.get("/api/payments/config", (req, res) => {
  return res.json({ data: { cardEnabled: Boolean(process.env.MP_ACCESS_TOKEN) } });
});

// POST /webhooks/mercadopago — fuente de verdad de los pagos con tarjeta (server-to-server)
// OJO: fuera de /api, debe coincidir con notification_url. El catch-all app.get("*") es GET, no lo intercepta.
app.post("/webhooks/mercadopago", express.json({ limit: "1mb" }), async (req, res) => {
  // 1) Responder 200 de inmediato (MP reintenta si tardamos)
  res.status(200).end();

  try {
    const body = req.body || {};
    const type = body.type || body.topic || null;
    const action = body.action || "";
    const mpPaymentId = (body.data?.id || req.query["data.id"] || req.query.id || "").toString();
    if (!mpPaymentId) return;

    // 2) Verificar firma
    const ok = verifyWebhookSignature({
      signatureHeader: req.headers["x-signature"] || "",
      requestId: req.headers["x-request-id"] || "",
      dataId: mpPaymentId,
      secret: process.env.MP_WEBHOOK_SECRET || "",
    });
    if (!ok) {
      console.warn(`[MP webhook] firma inválida para pago ${mpPaymentId}`);
      return;
    }

    const eventType = type || (action.includes("payment") ? "payment" : null);
    const eventKey = `${eventType || "payment"}:${mpPaymentId}`;

    // 3) Idempotencia: insertar el evento; si ya existe (23505), salir
    try {
      await pool.query(
        `INSERT INTO payment_webhook_events (provider, event_key, event_type, payload)
         VALUES ('mercadopago', $1, $2, $3)`,
        [eventKey, eventType || "payment", JSON.stringify(body)]
      );
    } catch (e) {
      if (e.code === "23505") return; // ya procesado
      console.error("[MP webhook] idempotency insert error:", e.message);
      return;
    }

    // 4) Procesar
    if (eventType === "payment") {
      await handlePaymentWebhook(mpPaymentId);
    }
    await pool.query(
      `UPDATE payment_webhook_events SET processed_at = NOW()
        WHERE provider = 'mercadopago' AND event_key = $1`,
      [eventKey]
    );
  } catch (err) {
    console.error("[MP webhook] processing error:", err.message);
    // El evento queda sin processed_at → se puede reprocesar manualmente (sync-mp).
  }
});

async function handlePaymentWebhook(mpPaymentId) {
  const payment = await syncPayment(mpPaymentId);
  const { status, status_detail, external_reference } = payment;
  if (!external_reference) {
    console.warn("[MP webhook] pago sin external_reference:", mpPaymentId);
    return;
  }
  // Guardar el estado del pago en la orden (sea cual sea)
  await pool.query(
    `UPDATE orders SET mp_payment_id = $1, mp_payment_status = $2, mp_status_detail = $3,
                       provider_synced_at = NOW(), updated_at = NOW()
       WHERE id = $4`,
    [mpPaymentId, status, status_detail, external_reference]
  );
  if (status === "approved") {
    await approveOrderFromMP(external_reference, mpPaymentId);
  } else if (status === "rejected" || status === "cancelled") {
    await pool.query(
      `UPDATE orders SET rejected_at = COALESCE(rejected_at, NOW()), updated_at = NOW()
         WHERE id = $1 AND status = 'pending_payment'`,
      [external_reference]
    );
  }
}

// Crea (de forma idempotente) las membresías de una orden, soportando CARRITO
// (varios order_plan_items). Si la orden no tiene renglones, usa order.plan_id (1 plan).
// Devuelve el id de la membresía principal (para registrar el pago / la consulta de complemento).
// NO crea el registro en `payments` ni la consulta — eso lo hace cada llamador.
async function createMembershipsForOrder(order, client, paymentMethod) {
  // Idempotencia: si ya hay membresías para esta orden, solo reactivar y devolver la primera.
  const existingMem = await client.query(
    "SELECT id FROM memberships WHERE order_id = $1 ORDER BY created_at ASC", [order.id]
  );
  if (existingMem.rows.length) {
    await client.query("UPDATE memberships SET status = 'active' WHERE order_id = $1", [order.id]);
    return existingMem.rows[0].id;
  }

  // Lista de (plan, cantidad): del carrito, o fallback al plan principal.
  const itemsRes = await client.query(
    "SELECT plan_id, quantity FROM order_plan_items WHERE order_id = $1 ORDER BY created_at ASC", [order.id]
  );
  const units = [];
  if (itemsRes.rows.length) {
    for (const it of itemsRes.rows) {
      const p = await client.query("SELECT * FROM plans WHERE id = $1", [it.plan_id]);
      if (p.rows.length) units.push({ plan: p.rows[0], qty: Math.max(1, Number(it.quantity) || 1) });
    }
  } else if (order.plan_id) {
    const p = await client.query("SELECT * FROM plans WHERE id = $1", [order.plan_id]);
    if (p.rows.length) units.push({ plan: p.rows[0], qty: 1 });
  }
  if (!units.length) return null;

  // Salvaguarda no-repetible (como hoy): cancela otras órdenes pendientes del mismo plan principal.
  if (order.plan_id) {
    await client.query(
      `UPDATE orders SET status = 'cancelled', notes = COALESCE(notes,'') || ' [auto-cancelada: otra orden del mismo plan fue aprobada]'
         WHERE user_id = $1 AND plan_id = $2 AND id != $3 AND status IN ('pending_payment','pending_verification')`,
      [order.user_id, order.plan_id, order.id]
    );
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  let primaryId = null;
  for (const { plan, qty } of units) {
    const endStr = calcMembershipEndDate(todayStr, plan);
    // "Inscripción" sola: marca a la alumna como inscrita pero NO otorga clases.
    // (Sin este caso, class_limit 0 se interpretaría como ilimitado → null.)
    const isInscriptionPlan = String(plan.name).trim().toLowerCase() === INSCRIPTION_PLAN_NAME.toLowerCase();
    const classes = isInscriptionPlan ? 0 : (plan.class_limit === 0 ? null : (plan.class_limit ?? null));
    for (let i = 0; i < qty; i++) {
      const memRes = await client.query(
        `INSERT INTO memberships (user_id, plan_id, status, payment_method, start_date, end_date, classes_remaining, order_id)
         VALUES ($1,$2,'active',$3,$4,$5,$6,$7) RETURNING id`,
        [order.user_id, plan.id, paymentMethod, todayStr, endStr, classes, order.id]
      );
      if (!primaryId) primaryId = memRes.rows[0].id;
    }
  }
  return primaryId;
}

// Activa la membresía cuando MP aprueba el pago. Mirror de PUT /api/admin/orders/:id/verify.
async function approveOrderFromMP(orderId, mpPaymentId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orderRes = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    if (!orderRes.rows.length) { await client.query("ROLLBACK"); console.warn("[MP] orden no encontrada", orderId); return; }
    let order = orderRes.rows[0];
    if (order.status === "approved") { await client.query("ROLLBACK"); return; } // idempotente

    let plan = null;
    if (order.plan_id) {
      const planRes = await client.query("SELECT * FROM plans WHERE id = $1", [order.plan_id]);
      if (planRes.rows.length) {
        plan = planRes.rows[0];
        const conflict = await findNonRepeatablePlanConflict({ userId: order.user_id, plan, excludeOrderId: order.id, client });
        if (conflict) { await client.query("ROLLBACK"); console.warn("[MP] conflicto plan no repetible:", conflict.message); return; }
      }
    }

    const approvedRes = await client.query(
      `UPDATE orders SET status = 'approved',
                         approved_at = COALESCE(approved_at, NOW()),
                         paid_at     = COALESCE(paid_at, NOW()),
                         mp_payment_id = $2, mp_payment_status = 'approved', updated_at = NOW()
         WHERE id = $1 RETURNING *`,
      [orderId, mpPaymentId]
    );
    order = approvedRes.rows[0];

    if (order.user_id) {
      // Crea las membresías (1 por unidad de cada renglón del carrito, o 1 si es plan suelto).
      const membershipId = await createMembershipsForOrder(order, client, "card");
      if (membershipId) {
        // Registro contable: UN pago por orden (referenciando la membresía principal).
        await client.query(
          `INSERT INTO payments (user_id, membership_id, amount, currency, payment_method, reference, notes, status)
           VALUES ($1,$2,$3,$4,'card',$5,$6,'completed')`,
          [order.user_id, membershipId, order.total_amount, order.currency || "MXN", mpPaymentId, `MercadoPago ${mpPaymentId}`]
        );

        // Consulta de complemento (igual que verify)
        const compType = order.complement_type || null;
        if (compType) {
          const compInfo = COMPLEMENT_MAP[compType] || null;
          if (compInfo) {
            try {
              await client.query(
                `INSERT INTO consultations (membership_id, user_id, complement_type, complement_name, specialist, status)
                 VALUES ($1,$2,$3,$4,$5,'pending')`,
                [membershipId, order.user_id, compType, compInfo.name, compInfo.specialist]
              );
            } catch (compErr) { console.error("[MP] consultations insert:", compErr.message); }
          }
        }
      }
    }

    if (order.discount_code_id) {
      try {
        await incrementDiscountUsage(order.discount_code_id, client);
      } catch (discErr) {
        // El pago ya se cobró en MercadoPago: no abortar la activación si el código
        // alcanzó su límite entre la compra y la aprobación del webhook.
        console.error("[MP] incrementDiscountUsage (no bloquea activación):", discErr.message);
      }
    }

    await client.query("COMMIT");

    // Post-commit: notificaciones fire-and-forget
    try {
      if (order.plan_id) {
        const planRes = await pool.query("SELECT * FROM plans WHERE id = $1", [order.plan_id]);
        const planRow = planRes.rows[0];
        const uRes = await pool.query("SELECT email, display_name, phone FROM users WHERE id = $1", [order.user_id]);
        const u = uRes.rows[0];
        if (planRow && u) {
          const emailEndStr = calcMembershipEndDate(new Date().toISOString().slice(0, 10), planRow);
          if (await areEmailNotificationsEnabled()) {
            sendMembershipActivated({
              to: u.email, name: u.display_name || "Alumna", planName: planRow.name,
              startDate: new Date().toISOString().slice(0, 10), endDate: emailEndStr,
              classLimit: planRow.class_limit ?? null,
            }).catch((e) => console.error("[Email] MP approve:", e.message));
          }
          sendConfiguredWhatsAppTemplate({
            templateKey: "membership_activated", phone: u.phone,
            vars: {
              name: u.display_name || "Alumna", plan: planRow.name || "tu plan",
              startDate: new Date().toLocaleDateString("es-MX"),
              endDate: new Date(emailEndStr).toLocaleDateString("es-MX"),
            },
            fallbackMessage: `Hola ${u.display_name || "Alumna"}, tu membresía ${planRow.name || ""} ya está activa.`,
          }).catch((e) => console.error("[WA] MP approve:", e.message));
          sendConfiguredPushTemplate({
            templateKey: "membership_activated",
            userId: order.user_id,
            vars: {
              name: u.display_name || "Alumna", plan: planRow.name || "tu plan",
              startDate: new Date().toLocaleDateString("es-MX"),
              endDate: new Date(emailEndStr).toLocaleDateString("es-MX"),
            },
          }).catch((e) => console.error("[Push] MP approve:", e.message));
        }
      }
      if (order.user_id) triggerWalletPassSync(order.user_id, "mp_payment_approved");
    } catch (notifyErr) {
      console.error("[MP] post-commit notify error:", notifyErr.message);
    }

    console.log(`[MP] pago ${mpPaymentId} aprobado → orden ${orderId}`);
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("[MP] approveOrderFromMP error:", err.message);
    throw err;
  } finally {
    client.release();
  }
}

// ─── Routes: /api/discount-codes ────────────────────────────────────────────

// POST /api/discount-codes/validate
app.post("/api/discount-codes/validate", authMiddleware, async (req, res) => {
  const { code, planId, classCategory, channel } = req.body;
  if (!code) return res.status(400).json({ message: "Código requerido" });
  try {
    const planRes = await pool.query("SELECT price, class_category FROM plans WHERE id = $1", [planId || null]);
    const originalPrice = planRes.rows.length > 0 ? parseFloat(planRes.rows[0].price) : 0;
    const effectiveCategory = normalizeClassCategory(
      classCategory ?? planRes.rows[0]?.class_category ?? "all",
      "all"
    );
    const discountResult = await findApplicableDiscountCode({
      code,
      subtotal: originalPrice,
      planId: planId || null,
      classCategory: effectiveCategory,
      channel: channel || "membership",
    });
    if (!discountResult) return res.status(404).json({ message: "Código no válido o expirado" });
    if (discountResult.rejectedByMinOrder) {
      return res.status(400).json({
        message: `Compra mínima requerida: $${Number(discountResult.minOrderAmount || 0).toFixed(2)} MXN`,
      });
    }
    const dc = discountResult.code;
    const discount = discountResult.discountAmount;
    return res.json({
      data: {
        code: dc.code,
        discount_type: dc.discount_type,
        discount_value: parseFloat(dc.discount_value),
        discount_amount: Math.min(discount, originalPrice),
        final_price: Math.max(originalPrice - discount, 0),
      }
    });
  } catch (err) {
    console.error("Discount validate error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Routes: /api/wallet ────────────────────────────────────────────────────

// GET /api/wallet/pass
app.get("/api/wallet/pass", authMiddleware, async (req, res) => {
  try {
    const pointsRes = await pool.query(
      "SELECT COALESCE(SUM(CASE WHEN type='earn' THEN points WHEN type='adjust' THEN points ELSE -points END), 0) AS total FROM loyalty_transactions WHERE user_id = $1",
      [req.userId]
    );
    const total = parseInt(pointsRes.rows[0].total);
    const passesRes = await pool.query(
      `SELECT ep.id,
              ep.pass_code,
              ep.status,
              ep.issued_at,
              ep.used_at,
              e.id AS event_id,
              e.title AS event_title,
              e.date AS event_date,
              e.start_time AS event_start_time
         FROM event_passes ep
         JOIN events e ON e.id = ep.event_id
        WHERE ep.user_id = $1
          AND ep.status <> 'cancelled'
        ORDER BY e.date DESC, e.start_time DESC
        LIMIT 20`,
      [req.userId]
    );
    let membership = null;
    try {
      const memRes = await pool.query(
        `SELECT m.id, m.status, m.classes_remaining, m.start_date, m.end_date,
                m.plan_name_override, m.class_limit_override,
                p.name AS plan_name, p.class_limit AS plan_class_limit,
                p.class_category, p.is_non_transferable, p.is_non_repeatable, p.repeat_key
           FROM memberships m
      LEFT JOIN plans p ON p.id = m.plan_id
          WHERE m.user_id = $1
            AND m.status = 'active'
            AND m.end_date >= CURRENT_DATE
       ORDER BY m.end_date DESC
          LIMIT 1`,
        [req.userId]
      );
      if (memRes.rows.length > 0) {
        const m = memRes.rows[0];
        membership = {
          id: m.id,
          status: m.status,
          plan_name: m.plan_name_override || m.plan_name || "Plan Activo",
          class_limit: m.class_limit_override ?? m.plan_class_limit,
          classes_remaining: m.classes_remaining,
          start_date: m.start_date,
          end_date: m.end_date,
          class_category: normalizeClassCategory(m.class_category, "all"),
          is_non_transferable: parseBooleanFlag(m.is_non_transferable),
          is_non_repeatable: parseBooleanFlag(m.is_non_repeatable),
          repeat_key: m.repeat_key || null,
        };
      }
    } catch (memErr) {
      console.error("Wallet/pass membership error:", memErr.message);
    }
    // QR data: user ID encoded
    const qrData = Buffer.from(req.userId).toString("base64");
    return res.json({
      data: {
        points: total,
        qr_code: qrData,
        membership,
        event_passes: passesRes.rows.map((row) => ({
          id: row.id,
          passCode: row.pass_code,
          status: row.status,
          issuedAt: row.issued_at,
          usedAt: row.used_at,
          eventId: row.event_id,
          eventTitle: row.event_title,
          eventDate: row.event_date ? String(row.event_date).slice(0, 10) : null,
          eventStartTime: row.event_start_time ? String(row.event_start_time).slice(0, 5) : null,
        })),
      },
    });
  } catch (err) {
    console.error("Wallet/pass error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Routes: /api/loyalty ───────────────────────────────────────────────────

// GET /api/loyalty/my-history
app.get("/api/loyalty/my-history", authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT lt.*,
              CASE WHEN lt.type = 'earn' OR lt.points > 0 THEN 'earned' ELSE 'redeemed' END AS movement_type
       FROM loyalty_transactions lt
       WHERE lt.user_id = $1
       ORDER BY lt.created_at DESC
       LIMIT 100`,
      [req.userId]
    );
    return res.json({ data: r.rows });
  } catch (err) {
    console.error("Loyalty/my-history error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/loyalty/rewards
app.get("/api/loyalty/rewards", authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM loyalty_rewards WHERE is_active = true ORDER BY points_cost ASC"
    );
    return res.json({ data: r.rows });
  } catch (err) {
    console.error("Loyalty/rewards error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/loyalty/redeem
app.post("/api/loyalty/redeem", authMiddleware, async (req, res) => {
  const { rewardId } = req.body;
  if (!rewardId) return res.status(400).json({ message: "rewardId requerido" });
  try {
    const rewardRes = await pool.query(
      "SELECT * FROM loyalty_rewards WHERE id = $1 AND is_active = true",
      [rewardId]
    );
    if (rewardRes.rows.length === 0) return res.status(404).json({ message: "Recompensa no encontrada" });
    const reward = rewardRes.rows[0];
    // Check user balance from loyalty_transactions
    const balanceRes = await pool.query(
      "SELECT COALESCE(SUM(CASE WHEN type='earn' THEN points WHEN type='adjust' THEN points ELSE -points END), 0) AS balance FROM loyalty_transactions WHERE user_id = $1",
      [req.userId]
    );
    const balance = parseInt(balanceRes.rows[0].balance);
    if (balance < reward.points_cost) {
      return res.status(400).json({ message: `Necesitas ${reward.points_cost} puntos. Tienes ${balance}.` });
    }
    // Deduct points via loyalty_transactions (type=redeem)
    await pool.query(
      "INSERT INTO loyalty_transactions (user_id, type, points, description) VALUES ($1, 'redeem', $2, $3)",
      [req.userId, reward.points_cost, `Canje: ${reward.name}`]
    );
    // Decrement stock if limited
    if (reward.stock !== null) {
      await pool.query("UPDATE loyalty_rewards SET stock = stock - 1 WHERE id = $1 AND stock > 0", [rewardId]);
    }
    triggerWalletPassSync(req.userId, "loyalty_redeem");
    return res.json({ message: `¡Recompensa canjeada! ${reward.name}` });
  } catch (err) {
    console.error("Loyalty/redeem error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Google Wallet helpers ──────────────────────────────────────────────────

const SITE_URL = process.env.SITE_URL || "https://www.tuespaciopilates.com.mx";
const GW_ISSUER_ID = process.env.GOOGLE_ISSUER_ID || "";
const GW_ISSUER_NAME = process.env.GOOGLE_ISSUER_NAME || "Tu Espacio Pilates";
const GW_PROGRAM_NAME = process.env.GOOGLE_PROGRAM_NAME || "Tu Espacio Pilates Club";
const GW_HEX_BG = process.env.GOOGLE_HEX_BACKGROUND_COLOR || "#1A1A1A";
const GW_HEX_BG_EVENT = process.env.GOOGLE_HEX_BACKGROUND_COLOR_EVENT || "#1F0047";

/**
 * Parse the Google Service Account private key from various env var formats.
 * Supports:
 *  - GOOGLE_SA_KEY_JSON_BASE64: the entire service-account JSON file base64-encoded (easiest)
 *  - GOOGLE_SA_PRIVATE_KEY: just the private key PEM (escaped \\n, raw, or base64-encoded)
 */
function parseGWServiceAccount() {
  let email = process.env.GOOGLE_SA_EMAIL || "";
  let key = "";

  // Option A: whole JSON file base64-encoded (e.g. cat sa.json | base64 -w0 | pbcopy)
  const jsonB64 = process.env.GOOGLE_SA_KEY_JSON_BASE64 || "";
  if (jsonB64) {
    try {
      const decoded = Buffer.from(jsonB64, "base64").toString("utf8");
      const sa = JSON.parse(decoded);
      if (sa.private_key) key = sa.private_key;
      if (sa.client_email && !email) email = sa.client_email;
      console.log("GW Key: parsed from GOOGLE_SA_KEY_JSON_BASE64 ✓");
    } catch (e) {
      console.error("Failed to parse GOOGLE_SA_KEY_JSON_BASE64:", e.message);
    }
  }

  // Option B: separate GOOGLE_SA_PRIVATE_KEY env var
  if (!key) {
    let raw = process.env.GOOGLE_SA_PRIVATE_KEY || "";
    if (raw) {
      // Step 1: URL-decode if needed (Railway sometimes encodes)
      if (raw.includes("%3D") || raw.includes("%2B") || raw.includes("%2F")) {
        try { raw = decodeURIComponent(raw); } catch (_) { }
      }
      // Step 2: If it's a JSON-escaped string (starts with "), unwrap it
      if (raw.startsWith('"') || raw.startsWith("'")) {
        try { raw = JSON.parse(raw); } catch (_) {
          raw = raw.slice(1, -1); // strip quotes manually
        }
      }
      // Step 3: If the whole thing looks like base64 (no PEM markers), decode
      if (!raw.includes("-----BEGIN") && !raw.includes("\\n") && raw.length > 100) {
        try {
          const decoded = Buffer.from(raw, "base64").toString("utf8");
          if (decoded.includes("-----BEGIN") || decoded.includes("PRIVATE KEY")) raw = decoded;
        } catch (_) { }
      }
      // Step 4: Replace escaped newlines (\\n → \n, plus double-escaped)
      raw = raw.replace(/\\\\n/g, "\n").replace(/\\n/g, "\n");
      // Step 5: Reconstruct PEM if markers exist but no real newlines between them
      if (raw.includes("-----BEGIN") && raw.includes("-----END")) {
        // Ensure proper line breaks around the markers
        raw = raw
          .replace(/(-----BEGIN [A-Z ]+-----)\s*/g, "$1\n")
          .replace(/\s*(-----END [A-Z ]+-----)/g, "\n$1");
        // If the body between markers has no newlines, it's the base64 blob — add line breaks every 64 chars
        const match = raw.match(/(-----BEGIN [A-Z ]+-----)\n?([\s\S]*?)\n?(-----END [A-Z ]+-----)/);
        if (match) {
          const body = match[2].replace(/\s+/g, ""); // strip all whitespace from body
          const wrapped = body.match(/.{1,64}/g)?.join("\n") || body;
          raw = `${match[1]}\n${wrapped}\n${match[3]}`;
        }
      }
      key = raw.trim();
      console.log("GW Key: parsed from GOOGLE_SA_PRIVATE_KEY, length=" + key.length + ", hasPEM=" + key.includes("-----BEGIN"));
    }
  }

  // Validate the key can be used for RS256
  if (key) {
    try {
      crypto.createPrivateKey(key);
      console.log("GW Key: ✅ Valid RSA private key");
    } catch (e) {
      console.error("GW Key: ⚠️ Key validation failed:", e.message);
      // Last resort: try wrapping in PKCS#8 markers if missing
      if (!key.includes("-----BEGIN")) {
        const body = key.replace(/\s+/g, "");
        const wrapped = body.match(/.{1,64}/g)?.join("\n") || body;
        key = `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----`;
        try {
          crypto.createPrivateKey(key);
          console.log("GW Key: ✅ Valid after adding PEM headers");
        } catch (e2) {
          console.error("GW Key: ❌ Still invalid after adding headers:", e2.message);
          key = ""; // unset — will disable Google Wallet gracefully
        }
      } else {
        key = ""; // unset — will disable Google Wallet gracefully
      }
    }
  }

  return { email, key };
}

const { email: _gwEmail, key: _gwKey } = parseGWServiceAccount();
const GW_SA_EMAIL = _gwEmail;
const GW_SA_PRIVATE_KEY = _gwKey;
const GW_CLASS_ID = GW_ISSUER_ID ? `${GW_ISSUER_ID}.puntoneutro_loyalty_v1` : "";

function isGoogleWalletConfigured() {
  return !!(GW_ISSUER_ID && GW_SA_EMAIL && GW_SA_PRIVATE_KEY);
}

/** Get OAuth2 access token for Google Wallet API using service account */
async function getGoogleWalletAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: GW_SA_EMAIL,
    scope: "https://www.googleapis.com/auth/wallet_object.issuer",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const saJwt = jwt.sign(claim, GW_SA_PRIVATE_KEY, { algorithm: "RS256" });
  const resp = await axios.post("https://oauth2.googleapis.com/token", new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: saJwt,
  }), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  return resp.data.access_token;
}

/** Create or update the Google Wallet Loyalty Class (run once at startup) */
async function ensureGoogleWalletClass() {
  if (!isGoogleWalletConfigured()) return;
  try {
    const token = await getGoogleWalletAccessToken();
    const classObj = {
      id: GW_CLASS_ID,
      issuerName: GW_ISSUER_NAME,
      programName: GW_PROGRAM_NAME,
      programLogo: {
        sourceUri: { uri: `${SITE_URL}/wallet-program-black.png` },
        contentDescription: { defaultValue: { language: "es", value: "Tu Espacio Pilates" } },
      },
      heroImage: {
        sourceUri: { uri: `${SITE_URL}/wallet-hero-black.png` },
        contentDescription: { defaultValue: { language: "es", value: "Tu Espacio Pilates" } },
      },
      hexBackgroundColor: GW_HEX_BG,
      reviewStatus: "UNDER_REVIEW",
      countryCode: "MX",
      multipleDevicesAndHoldersAllowedStatus: "MULTIPLE_HOLDERS",
      localizedIssuerName: { defaultValue: { language: "es", value: GW_ISSUER_NAME } },
      localizedProgramName: { defaultValue: { language: "es", value: GW_PROGRAM_NAME } },
    };
    // Try to GET the class first
    try {
      await axios.get(`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/${GW_CLASS_ID}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // If exists, update it
      await axios.put(`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/${GW_CLASS_ID}`, classObj, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      console.log("✅ Google Wallet loyalty class updated:", GW_CLASS_ID);
    } catch (getErr) {
      if (getErr.response?.status === 404) {
        // Create new class
        await axios.post("https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass", classObj, {
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        console.log("✅ Google Wallet loyalty class created:", GW_CLASS_ID);
      } else {
        throw getErr;
      }
    }
  } catch (err) {
    console.error("⚠️  Google Wallet class setup error:", err.response?.data || err.message);
  }
}

function formatWalletEventSchedule(eventPass) {
  if (!eventPass?.eventDate) return "";
  const eventDate = new Date(eventPass.eventDate);
  if (Number.isNaN(eventDate.getTime())) return "";
  const dateLabel = eventDate.toLocaleDateString("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const startTime = eventPass.eventStartTime ? String(eventPass.eventStartTime).slice(0, 5) : "";
  const endTime = eventPass.eventEndTime ? String(eventPass.eventEndTime).slice(0, 5) : "";
  const timeLabel = startTime && endTime ? `${startTime} - ${endTime}` : (startTime || "");
  return `${dateLabel}${timeLabel ? ` · ${timeLabel}` : ""}`.trim();
}

/** Build a Google Wallet Save URL (JWT) for a user
 *  @param {Object} opts
 *  @param {string} opts.userId
 *  @param {string} opts.userName
 *  @param {number} opts.points
 *  @param {string} opts.qrCode
 *  @param {Object|null} opts.membership  - { plan_name, class_limit, classes_remaining, end_date, start_date }
 *  @param {Object|null} opts.nextBooking - { class_name, instructor_name, date, start_time }
 *  @param {Object|null} opts.activeEventPass - { eventTitle, eventDate, eventStartTime, eventEndTime, eventLocation, passCode }
 */
function buildGoogleWalletSaveUrl({ userId, userName, points, qrCode, membership, nextBooking, activeEventPass, passKind = "membership" }) {
  const isEventPass = String(passKind || "membership") === "event";
  const objectId = isEventPass
    ? `${GW_ISSUER_ID}.pn_event_${String(activeEventPass?.eventId || "event").replace(/-/g, "")}_${userId.replace(/-/g, "")}`
    : `${GW_ISSUER_ID}.pn_${userId.replace(/-/g, "")}`;

  // ── Determine pass type and details based on membership ──────────────────
  const hasMembership = !isEventPass && !!membership;
  const hasEventPass = isEventPass && !!activeEventPass;
  const showFullGooglePassText = parseBooleanFlag(process.env.GOOGLE_WALLET_SHOW_FULL_TEXT || false);
  const compactEventMode = hasEventPass && !showFullGooglePassText;
  const eventSchedule = formatWalletEventSchedule(activeEventPass);
  const eventTitle = activeEventPass?.eventTitle || "Evento especial";
  const membershipCategory = hasMembership
    ? normalizeClassCategory(membership.class_category, "all")
    : "all";
  const membershipCategoryLabel =
    membershipCategory === "pilates" ? "Pilates" :
      membershipCategory === "bienestar" ? "Bienestar" :
        membershipCategory === "funcional" ? "Funcional" :
          membershipCategory === "mixto" ? "Mixto" : "General";
  const isUnlimited = hasMembership && (membership.class_limit === null || membership.class_limit >= 9999);
  const classLimit = Number(membership?.class_limit ?? 0);
  const hasIconStampMode = hasMembership && !isUnlimited && classLimit > 0;
  const isPackage = hasMembership && !isUnlimited && membership.class_limit > 1;
  const isSingleClass = hasMembership && !isUnlimited && membership.class_limit === 1;
  const isTrialSingleSession = hasMembership && String(membership.repeat_key || "").startsWith("trial_single_session");
  const nonTransferable = hasMembership && parseBooleanFlag(membership.is_non_transferable);
  const nonRepeatable = hasMembership && parseBooleanFlag(membership.is_non_repeatable);

  // Header label
  let passHeader = "TU ESPACIO PILATES";
  if (hasEventPass) {
    passHeader = "PASE DE EVENTO";
  } else if (hasMembership) {
    if (isUnlimited) passHeader = "MEMBRESÍA";
    else if (isPackage) passHeader = "PAQUETE";
    else if (isSingleClass) passHeader = "CLASE INDIVIDUAL";
  }

  // ── Build textModulesData rows ───────────────────────────────────────────
  const textModules = [];

  if (hasEventPass) {
    textModules.push({
      id: "event_title",
      header: "EVENTO ACTIVO",
      body: eventTitle,
    });
    if (eventSchedule) {
      textModules.push({
        id: "event_schedule",
        header: "FECHA Y HORA",
        body: eventSchedule,
      });
    }
    if (!compactEventMode && activeEventPass?.eventLocation) {
      textModules.push({
        id: "event_location",
        header: "LUGAR",
        body: activeEventPass.eventLocation,
      });
    }
    if (!compactEventMode && activeEventPass?.passCode) {
      textModules.push({
        id: "event_code",
        header: "CÓDIGO EVENTO",
        body: activeEventPass.passCode,
      });
    }
  }

  if (!compactEventMode && !isEventPass) {
    // Row 1: Plan Name
    if (hasMembership) {
      textModules.push({
        id: "plan",
        header: passHeader,
        body: membership.plan_name || "Plan Activo",
      });
      textModules.push({
        id: "modalidad",
        header: "MODALIDAD",
        body: membershipCategoryLabel,
      });
    } else {
      textModules.push({
        id: "plan",
        header: "ESTADO",
        body: "Sin membresía activa",
      });
    }

    // Row 2: Vigencia (valid until)
    if (hasMembership && membership.end_date) {
      const endDate = new Date(membership.end_date);
      const now = new Date();
      const daysLeft = Math.max(0, Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)));
      const endFormatted = endDate.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
      textModules.push({
        id: "vigencia",
        header: "VIGENTE HASTA",
        body: `${endFormatted} (${daysLeft} días restantes)`,
      });
    }

    // Row 3: Classes info
    if (hasMembership) {
      if (isUnlimited) {
        textModules.push({
          id: "clases",
          header: "CLASES",
          body: "♾️ Ilimitadas",
        });
      } else if (membership.class_limit && !hasIconStampMode) {
        const used = Math.max(0, (membership.class_limit || 0) - (membership.classes_remaining || 0));
        textModules.push({
          id: "clases",
          header: "CLASES DISPONIBLES",
          body: `${membership.classes_remaining ?? 0} de ${membership.class_limit} restantes (${used} usadas)`,
        });
      }
    }

    // Row 3.1: Membership rules
    if (hasMembership) {
      const rules = [];
      if (nonTransferable) rules.push("No transferible");
      if (nonRepeatable) rules.push("No repetible");
      if (rules.length) {
        textModules.push({
          id: "reglas",
          header: "REGLAS",
          body: rules.join(" · "),
        });
      }
    }

    // Row 4: Next class
    if (nextBooking) {
      const bookingDate = new Date(nextBooking.date);
      const dateStr = bookingDate.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
      const timeStr = nextBooking.start_time ? String(nextBooking.start_time).substring(0, 5) : "";
      textModules.push({
        id: "next_class",
        header: "PRÓXIMA CLASE",
        body: `${nextBooking.class_name || "Clase"} — ${dateStr} ${timeStr}`,
      });
      if (nextBooking.instructor_name) {
        textModules.push({
          id: "instructor",
          header: "INSTRUCTORA",
          body: nextBooking.instructor_name,
        });
      }
    }
  }

  // Row 5: Points
  textModules.push({
    id: "puntos",
    header: "PUNTOS TEP",
    body: `${points.toLocaleString("es-MX")} pts`,
  });

  const infoRows = [];
  if (compactEventMode) {
    infoRows.push({
      columns: [
        { label: "Evento", value: eventTitle },
        { label: "Fecha", value: eventSchedule || "—" },
      ],
    });
    infoRows.push({
      columns: [
        { label: "Código", value: activeEventPass?.passCode || "—" },
        { label: "Puntos", value: String(points) },
      ],
    });
  } else if (hasEventPass) {
    infoRows.push({
      columns: [
        { label: "Evento", value: eventTitle },
        { label: "Código", value: activeEventPass.passCode || "—" },
      ],
    });
    infoRows.push({
      columns: [
        { label: "Horario", value: eventSchedule || "—" },
        { label: "Sede", value: activeEventPass.eventLocation || "—" },
      ],
    });
  }
  if (hasMembership) {
    infoRows.push({
      columns: [
        { label: "Miembro", value: userName },
        { label: "Plan", value: membership.plan_name || "—" },
      ],
    });
    infoRows.push({
      columns: [
        { label: "Modalidad", value: membershipCategoryLabel },
        { label: "Reglas", value: [nonTransferable ? "No transferible" : "", nonRepeatable ? "No repetible" : ""].filter(Boolean).join(" · ") || "—" },
      ],
    });
  } else {
    infoRows.push({
      columns: [
        { label: "Miembro", value: userName },
        { label: "Puntos", value: String(points) },
      ],
    });
  }

  // ── Build loyaltyObject ──────────────────────────────────────────────────
  const loyaltyObject = {
    id: objectId,
    classId: GW_CLASS_ID,
    state: "ACTIVE",
    accountId: userId,
    accountName: userName,
    hexBackgroundColor: hasEventPass ? GW_HEX_BG_EVENT : GW_HEX_BG,
    barcode: {
      type: "QR_CODE",
      value: qrCode,
    },
    loyaltyPoints: {
      balance: { int: points },
      label: "PUNTOS",
    },
    header: {
      defaultValue: { language: "es", value: passHeader },
    },
    textModulesData: textModules,
    linksModuleData: {
      uris: [
        { uri: `${SITE_URL}/app/wallet`, description: "Mi Wallet", id: "wallet_link" },
        {
          uri: hasEventPass ? `${SITE_URL}/app/events` : `${SITE_URL}/app/bookings`,
          description: hasEventPass ? "Mis Eventos" : "Reservar Clase",
          id: hasEventPass ? "events_link" : "book_link",
        },
      ],
    },
    infoModuleData: {
      showLastUpdateTime: true,
      labelValueRows: infoRows,
    },
  };

  const payload = {
    iss: GW_SA_EMAIL,
    aud: "google",
    origins: [SITE_URL],
    typ: "savetowallet",
    payload: {
      loyaltyObjects: [loyaltyObject],
    },
  };
  const signedJwt = jwt.sign(payload, GW_SA_PRIVATE_KEY, { algorithm: "RS256" });
  return `https://pay.google.com/gp/v/save/${signedJwt}`;
}

// ─── Routes: /api/wallet/google ─────────────────────────────────────────────

// GET /api/wallet/google/save-url — returns Save URL for logged-in user
app.get("/api/wallet/google/save-url", authMiddleware, async (req, res) => {
  if (!isGoogleWalletConfigured()) {
    return res.status(503).json({ message: "Google Wallet no configurado", detail: { issuer: !!GW_ISSUER_ID, email: !!GW_SA_EMAIL, key: !!GW_SA_PRIVATE_KEY } });
  }
  try {
    // Ensure loyalty class exists (best-effort — don't fail the request if this errors)
    try {
      await ensureGoogleWalletClass();
    } catch (classErr) {
      console.error("Google Wallet class ensure error (non-fatal):", classErr.response?.data || classErr.message);
    }
    const snapshot = await getWalletSnapshotForUser(req.userId);
    if (!snapshot) return res.status(404).json({ message: "Usuario no encontrado" });
    const saveUrl = buildGoogleWalletSaveUrl({ ...snapshot, activeEventPass: null, passKind: "membership" });
    return res.json({ data: { saveUrl } });
  } catch (err) {
    console.error("Google Wallet save-url error:", err.response?.data || err.message, err.stack?.split("\n").slice(0, 3).join("\n"));
    return res.status(500).json({ message: "Error generando pase de Google Wallet", detail: err.message });
  }
});

// GET /api/wallet/events/google/save-url — returns event-specific Save URL for logged-in user
app.get("/api/wallet/events/google/save-url", authMiddleware, async (req, res) => {
  if (!isGoogleWalletConfigured()) {
    return res.status(503).json({ message: "Google Wallet no configurado", detail: { issuer: !!GW_ISSUER_ID, email: !!GW_SA_EMAIL, key: !!GW_SA_PRIVATE_KEY } });
  }
  try {
    const eventIdRaw = String(req.query?.eventId || "").trim();
    const eventId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventIdRaw)
      ? eventIdRaw
      : null;
    if (!eventId) return res.status(400).json({ message: "eventId inválido" });

    try {
      await ensureGoogleWalletClass();
    } catch (classErr) {
      console.error("Google Wallet class ensure error (non-fatal):", classErr.response?.data || classErr.message);
    }

    const snapshot = await getWalletSnapshotForUser(req.userId, { eventId });
    if (!snapshot) return res.status(404).json({ message: "Usuario no encontrado" });
    if (!snapshot.activeEventPass) {
      return res.status(404).json({ message: "No existe pase activo para ese evento" });
    }
    const saveUrl = buildGoogleWalletSaveUrl({
      ...snapshot,
      membership: null,
      nextBooking: null,
      passKind: "event",
    });
    return res.json({ data: { saveUrl } });
  } catch (err) {
    console.error("Google Wallet event save-url error:", err.response?.data || err.message, err.stack?.split("\n").slice(0, 3).join("\n"));
    return res.status(500).json({ message: "Error generando pase de evento en Google Wallet", detail: err.message });
  }
});

// GET /api/wallet/google/diagnostics — check env config (admin only)
app.get("/api/wallet/google/diagnostics", adminMiddleware, async (_req, res) => {
  const rawKey = process.env.GOOGLE_SA_PRIVATE_KEY || "";
  const keyPreview = GW_SA_PRIVATE_KEY
    ? `parsed_length=${GW_SA_PRIVATE_KEY.length}, hasNewlines=${GW_SA_PRIVATE_KEY.includes("\n")}, begins=${GW_SA_PRIVATE_KEY.substring(0, 32)}…`
    : "❌ missing";
  const rawKeyPreview = rawKey
    ? `raw_length=${rawKey.length}, hasBeginMarker=${rawKey.includes("-----BEGIN")}, hasLiteralBackslashN=${rawKey.includes("\\n")}`
    : "❌ env var not set";

  // Test JWT signing
  let jwtSignTest = "not tested";
  if (GW_SA_EMAIL && GW_SA_PRIVATE_KEY) {
    try {
      jwt.sign({ iss: GW_SA_EMAIL, aud: "test", iat: Math.floor(Date.now() / 1000) }, GW_SA_PRIVATE_KEY, { algorithm: "RS256" });
      jwtSignTest = "✅ JWT signing works";
    } catch (e) {
      jwtSignTest = `❌ JWT signing failed: ${e.message}`;
    }
  }

  // Test OAuth token
  let oauthTest = "not tested";
  if (isGoogleWalletConfigured()) {
    try {
      const token = await getGoogleWalletAccessToken();
      oauthTest = `✅ Got access token (${token.substring(0, 10)}...)`;
    } catch (e) {
      oauthTest = `❌ OAuth failed: ${e.response?.data?.error_description || e.message}`;
    }
  }

  return res.json({
    configured: isGoogleWalletConfigured(),
    issuerId: GW_ISSUER_ID ? `✅ ${GW_ISSUER_ID}` : "❌ missing",
    saEmail: GW_SA_EMAIL ? `✅ ${GW_SA_EMAIL}` : "❌ missing",
    saPrivateKey: keyPreview,
    rawKeyInfo: rawKeyPreview,
    classId: GW_CLASS_ID || "N/A",
    issuerName: GW_ISSUER_NAME,
    programName: GW_PROGRAM_NAME,
    jwtSignTest,
    oauthTest,
  });
});

// ─── Apple Wallet config ────────────────────────────────────────────────────

const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID || "";
const APPLE_PASS_TYPE_ID = process.env.APPLE_PASS_TYPE_ID || "";
const APPLE_KEY_ID = process.env.APPLE_KEY_ID || "";
const APPLE_APNS_KEY_BASE64 = process.env.APPLE_APNS_KEY_BASE64 || "";
const APPLE_AUTH_TOKEN = process.env.APPLE_AUTH_TOKEN || crypto.randomBytes(32).toString("hex");
const APPLE_CERT_PASSWORD = process.env.APPLE_CERT_PASSWORD || "";

// ── Certificate loading: files first, then base64 env vars ──────────────────
// Priority 1: Read from files in wallet-assets/apple-pass/
// Priority 2: Decode from base64 env vars (APPLE_SIGNER_CERT_BASE64, etc.)

function safeExists(filePath) {
  try {
    return !!filePath && fs.existsSync(filePath);
  } catch (_) {
    return false;
  }
}

function normalizePemText(value) {
  if (!value) return "";
  return String(value)
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function looksLikeBase64(value) {
  const raw = String(value || "").replace(/\s/g, "");
  if (raw.length < 100) return false;
  return /^[A-Za-z0-9+/=]+$/.test(raw);
}

const WALLET_ASSET_DIR_CANDIDATES = [
  process.env.APPLE_PASS_CERT_DIR,
  path.join(__dirname, "..", "wallet-assets", "apple-pass"),
  path.join(__dirname, "wallet-assets", "apple-pass"),
  path.join(process.cwd(), "wallet-assets", "apple-pass"),
  "/app/wallet-assets/apple-pass",
  "/app/server/wallet-assets/apple-pass",
].filter(Boolean);

const WALLET_ASSETS_DIR = WALLET_ASSET_DIR_CANDIDATES.find((dir) => safeExists(dir)) || WALLET_ASSET_DIR_CANDIDATES[0];

const CERT_FILE_CANDIDATES = {
  cert: [
    process.env.APPLE_PASS_CERT_PATH,
    process.env.APPLE_PASS_CERT,
    path.join(WALLET_ASSETS_DIR, "pass.pem"),
    path.join(WALLET_ASSETS_DIR, "certificate.pem"),
  ].filter(Boolean),
  key: [
    process.env.APPLE_PASS_KEY_PATH,
    process.env.APPLE_PASS_KEY,
    path.join(WALLET_ASSETS_DIR, "pass.key"),
    path.join(WALLET_ASSETS_DIR, "private.key"),
  ].filter(Boolean),
  wwdr: [
    process.env.APPLE_PASS_WWDR_PATH,
    process.env.APPLE_PASS_WWDR,
    path.join(WALLET_ASSETS_DIR, "wwdr.pem"),
    path.join(WALLET_ASSETS_DIR, "AppleWWDRCA.pem"),
    path.join(WALLET_ASSETS_DIR, "wwdr_rsa.pem"),
  ].filter(Boolean),
};

/** Try to load PEM from file, return empty string if not found */
function loadCertFile(filePath) {
  try {
    if (safeExists(filePath)) {
      const content = normalizePemText(fs.readFileSync(filePath, "utf8"));
      if (content.includes("-----BEGIN")) {
        console.log(`[Apple Wallet] ✅ Loaded cert from file: ${filePath} (${content.length} chars)`);
        return content;
      }
    }
  } catch (e) {
    console.error(`[Apple Wallet] ❌ Error reading ${filePath}:`, e.message);
  }
  return "";
}

function loadFirstCertFile(paths = []) {
  for (const p of paths) {
    const cert = loadCertFile(p);
    if (cert) return cert;
  }
  return "";
}

/** Decode base64 env var to PEM, ensuring proper PEM formatting */
function decodeBase64ToPem(b64, label = "CERTIFICATE") {
  if (!b64) return "";
  try {
    let raw = Buffer.from(String(b64), "base64").toString("utf8").trim();
    if (!raw) return "";
    if (raw.includes("-----BEGIN")) {
      return normalizePemText(raw);
    }
    const cleanB64 = String(b64).replace(/[\s\n\r]/g, "");
    if (!cleanB64) return "";
    const lines = cleanB64.match(/.{1,64}/g) || [cleanB64];
    return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
  } catch (_) {
    return "";
  }
}

function loadPemFromEnvValue(value, label = "CERTIFICATE") {
  const raw = normalizePemText(value || "");
  if (!raw) return "";
  if (raw.includes("-----BEGIN")) return raw;
  if (safeExists(raw)) return loadCertFile(raw);
  if (looksLikeBase64(raw)) return decodeBase64ToPem(raw, label);
  return "";
}

const CERT_FILE_PATHS = {
  cert: CERT_FILE_CANDIDATES.cert.find((p) => safeExists(p)) || CERT_FILE_CANDIDATES.cert[0] || "",
  key: CERT_FILE_CANDIDATES.key.find((p) => safeExists(p)) || CERT_FILE_CANDIDATES.key[0] || "",
  wwdr: CERT_FILE_CANDIDATES.wwdr.find((p) => safeExists(p)) || CERT_FILE_CANDIDATES.wwdr[0] || "",
};

// Load certs: env PEM/path first, then files, then base64 env vars
const APPLE_SIGNER_CERT_PEM =
  loadPemFromEnvValue(process.env.APPLE_SIGNER_CERT_PEM || process.env.APPLE_PASS_CERT_PEM || process.env.APPLE_PASS_CERT, "CERTIFICATE")
  || loadFirstCertFile(CERT_FILE_CANDIDATES.cert)
  || decodeBase64ToPem(process.env.APPLE_SIGNER_CERT_BASE64 || process.env.APPLE_PASS_CERT_BASE64 || "", "CERTIFICATE");

const APPLE_SIGNER_KEY_PEM =
  loadPemFromEnvValue(process.env.APPLE_SIGNER_KEY_PEM || process.env.APPLE_PASS_KEY_PEM || process.env.APPLE_PASS_KEY, "PRIVATE KEY")
  || loadFirstCertFile(CERT_FILE_CANDIDATES.key)
  || decodeBase64ToPem(process.env.APPLE_SIGNER_KEY_BASE64 || process.env.APPLE_PASS_KEY_BASE64 || "", "PRIVATE KEY");

const APPLE_WWDR_CERT_PEM =
  loadPemFromEnvValue(process.env.APPLE_WWDR_CERT_PEM || process.env.APPLE_PASS_WWDR_PEM || process.env.APPLE_PASS_WWDR, "CERTIFICATE")
  || loadFirstCertFile(CERT_FILE_CANDIDATES.wwdr)
  || decodeBase64ToPem(process.env.APPLE_WWDR_CERT_BASE64 || process.env.APPLE_PASS_WWDR_BASE64 || "", "CERTIFICATE");

const APPLE_APNS_KEY_PEM =
  loadPemFromEnvValue(process.env.APPLE_APNS_KEY_PEM || process.env.APPLE_APNS_KEY || process.env.APPLE_APNS_KEY_PATH, "PRIVATE KEY")
  || decodeBase64ToPem(APPLE_APNS_KEY_BASE64 || "", "PRIVATE KEY");
const APPLE_APNS_HOST = process.env.APPLE_APNS_HOST || "https://api.push.apple.com";

function isAppleWalletConfigured() {
  return !!(APPLE_TEAM_ID && APPLE_PASS_TYPE_ID && APPLE_SIGNER_CERT_PEM && APPLE_SIGNER_KEY_PEM && APPLE_WWDR_CERT_PEM);
}

function isAppleApnsConfigured() {
  return !!(APPLE_TEAM_ID && APPLE_KEY_ID && APPLE_PASS_TYPE_ID && APPLE_APNS_KEY_PEM);
}

function buildAppleWalletSerialFromUserId(userId) {
  const cleaned = String(userId || "").trim();
  if (!cleaned) return "";
  return `pn_${cleaned.replace(/-/g, "")}`;
}

function parseUserIdFromAppleWalletSerial(serial) {
  const raw = String(serial || "").replace(/^pn_/, "").trim();
  if (!/^[0-9a-fA-F]{32}$/.test(raw)) return null;
  return raw.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5").toLowerCase();
}

function truncateWalletField(value, max = 26) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Find image assets — check both public/ and dist/ directories */
function findAssetDir() {
  const candidates = [
    path.join(__dirname, "..", "public"),
    path.join(__dirname, "..", "dist"),
    path.join(__dirname, "..", "dist", "public"),
    path.join(process.cwd(), "public"),
    path.join(process.cwd(), "dist"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "pn-logo.png"))) {
      return dir;
    }
  }
  return candidates[0];
}

/** Find the first existing asset file by trying file names across common asset dirs. */
function findAssetFile(fileNames = []) {
  const dirs = [
    findAssetDir(),
    path.join(__dirname, "..", "public"),
    path.join(__dirname, "..", "src", "assets"),
    path.join(process.cwd(), "public"),
    path.join(process.cwd(), "src", "assets"),
  ];
  const checked = new Set();
  for (const dir of dirs) {
    if (!dir || checked.has(dir)) continue;
    checked.add(dir);
    for (const name of fileNames) {
      const fullPath = path.join(dir, name);
      if (fs.existsSync(fullPath)) return fullPath;
    }
  }
  return null;
}

const WALLET_STRIP_TOTAL_BUCKETS = [1, 4, 8, 12, 16, 20];

function resolveWalletStripStampState(classLimitRaw, classesRemainingRaw) {
  const classLimit = Number(classLimitRaw ?? 0);
  const classesRemaining = Math.max(0, Number(classesRemainingRaw ?? 0));
  if (!Number.isFinite(classLimit) || classLimit <= 0) {
    return { total: 0, remaining: 0 };
  }
  const nearestTotal = WALLET_STRIP_TOTAL_BUCKETS.reduce((best, current) =>
    Math.abs(current - classLimit) < Math.abs(best - classLimit) ? current : best,
    WALLET_STRIP_TOTAL_BUCKETS[0]);
  const ratio = classLimit > 0 ? Math.min(1, Math.max(0, classesRemaining / classLimit)) : 0;
  const remainingBucket = Math.min(nearestTotal, Math.max(0, Math.round(ratio * nearestTotal)));
  return { total: nearestTotal, remaining: remainingBucket };
}

const appleApnsProviderTokenCache = {
  token: "",
  expiresAtMs: 0,
};

function getAppleApnsProviderToken() {
  const now = Date.now();
  if (appleApnsProviderTokenCache.token && appleApnsProviderTokenCache.expiresAtMs > now + 30_000) {
    return appleApnsProviderTokenCache.token;
  }
  if (!isAppleApnsConfigured()) {
    throw new Error("Apple APNS no configurado");
  }
  const iat = Math.floor(now / 1000);
  const token = jwt.sign(
    { iss: APPLE_TEAM_ID, iat },
    APPLE_APNS_KEY_PEM,
    {
      algorithm: "ES256",
      header: { alg: "ES256", kid: APPLE_KEY_ID },
    },
  );
  // Apple recomienda reutilizar por hasta 60 min. Renovamos cada 50 min.
  appleApnsProviderTokenCache.token = token;
  appleApnsProviderTokenCache.expiresAtMs = now + 50 * 60 * 1000;
  return token;
}

function shouldPruneApplePushToken(pushResult) {
  if (!pushResult || pushResult.ok) return false;
  if (pushResult.status === 410) return true;
  const badReasons = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"]);
  return pushResult.status === 400 && badReasons.has(pushResult.reason);
}

function sendApplePassUpdatedPush(pushToken, providerToken) {
  return new Promise((resolve) => {
    const session = http2.connect(APPLE_APNS_HOST);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { session.close(); } catch (_) { }
      resolve(result);
    };
    session.setTimeout(12_000, () => finish({ ok: false, status: 0, reason: "APNS timeout", pushToken }));
    session.on("error", (err) => finish({ ok: false, status: 0, reason: err.message, pushToken }));

    const req = session.request({
      ":method": "POST",
      ":path": `/3/device/${pushToken}`,
      authorization: `bearer ${providerToken}`,
      "apns-topic": APPLE_PASS_TYPE_ID,
      "apns-push-type": "background",
      "apns-priority": "5",
      "content-type": "application/json",
    });

    let status = 0;
    let body = "";
    req.setEncoding("utf8");
    req.on("response", (headers) => {
      status = Number(headers?.[":status"] || 0);
    });
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let reason = "";
      if (body) {
        try {
          reason = JSON.parse(body)?.reason || "";
        } catch (_) {
          reason = body.slice(0, 120);
        }
      }
      finish({ ok: status === 200, status, reason, pushToken });
    });
    req.on("error", (err) => finish({ ok: false, status: 0, reason: err.message, pushToken }));
    req.end("{}");
  });
}

async function getWalletSnapshotForUser(userId, { eventId = null } = {}) {
  const userRes = await pool.query("SELECT id, email, display_name FROM users WHERE id = $1 LIMIT 1", [userId]);
  if (!userRes.rows.length) return null;
  const user = userRes.rows[0];
  const userName = user.display_name || user.email;

  const pointsRes = await pool.query(
    "SELECT COALESCE(SUM(CASE WHEN type='earn' THEN points WHEN type='adjust' THEN points ELSE -points END), 0) AS total FROM loyalty_transactions WHERE user_id = $1",
    [userId],
  );
  const points = parseInt(pointsRes.rows[0]?.total ?? 0, 10) || 0;

  let membership = null;
  try {
    const memRes = await pool.query(
      `SELECT m.id, m.status, m.classes_remaining, m.start_date, m.end_date,
              m.plan_name_override, m.class_limit_override,
              p.name AS plan_name, p.class_limit AS plan_class_limit,
              p.class_category, p.is_non_transferable, p.is_non_repeatable, p.repeat_key
       FROM memberships m
       LEFT JOIN plans p ON m.plan_id = p.id
       WHERE m.user_id = $1 AND m.status = 'active' AND (m.end_date IS NULL OR m.end_date >= CURRENT_DATE)
       ORDER BY m.end_date DESC NULLS LAST
       LIMIT 1`,
      [userId],
    );
    if (memRes.rows.length > 0) {
      const m = memRes.rows[0];
      membership = {
        plan_name: m.plan_name_override || m.plan_name || "Plan Activo",
        class_limit: m.class_limit_override ?? m.plan_class_limit,
        classes_remaining: m.classes_remaining,
        start_date: m.start_date,
        end_date: m.end_date,
        class_category: normalizeClassCategory(m.class_category, "all"),
        is_non_transferable: parseBooleanFlag(m.is_non_transferable),
        is_non_repeatable: parseBooleanFlag(m.is_non_repeatable),
        repeat_key: m.repeat_key || null,
      };
    }
  } catch (err) {
    console.error("[Wallet] membership snapshot error:", err.message);
  }

  let nextBooking = null;
  try {
    const bookRes = await pool.query(
      `SELECT c.date, c.start_time, ct.name AS class_name, i.display_name AS instructor_name
       FROM bookings b
       JOIN classes c ON b.class_id = c.id
       JOIN class_types ct ON c.class_type_id = ct.id
       LEFT JOIN instructors i ON c.instructor_id = i.id
       WHERE b.user_id = $1
         AND b.status IN ('confirmed', 'waitlist')
         AND c.date >= CURRENT_DATE
       ORDER BY c.date ASC, c.start_time ASC
       LIMIT 1`,
      [userId],
    );
    if (bookRes.rows.length > 0) nextBooking = bookRes.rows[0];
  } catch (err) {
    console.error("[Wallet] next booking snapshot error:", err.message);
  }

  let activeEventPass = null;
  try {
    const params = [userId];
    const where = [
      "ep.user_id = $1",
      "ep.status = 'issued'",
      "e.status <> 'cancelled'",
    ];
    if (eventId) {
      params.push(eventId);
      where.push(`ep.event_id = $${params.length}`);
    } else {
      where.push(`(
        e.date > CURRENT_DATE
        OR (e.date = CURRENT_DATE AND (e.end_time IS NULL OR e.end_time >= CURRENT_TIME))
      )`);
    }
    const eventPassRes = await pool.query(
      `SELECT ep.id,
              ep.pass_code,
              ep.status,
              ep.issued_at,
              e.id AS event_id,
              e.title AS event_title,
              e.date AS event_date,
              e.start_time AS event_start_time,
              e.end_time AS event_end_time,
              e.location AS event_location
         FROM event_passes ep
         JOIN events e ON e.id = ep.event_id
        WHERE ${where.join("\n          AND ")}
        ORDER BY e.date ASC, e.start_time ASC, ep.issued_at DESC
        LIMIT 1`,
      params,
    );
    if (eventPassRes.rows.length > 0) {
      const ev = eventPassRes.rows[0];
      activeEventPass = {
        id: ev.id,
        passCode: ev.pass_code,
        status: ev.status,
        issuedAt: ev.issued_at,
        eventId: ev.event_id,
        eventTitle: ev.event_title || "Evento especial",
        eventDate: ev.event_date,
        eventStartTime: ev.event_start_time,
        eventEndTime: ev.event_end_time,
        eventLocation: ev.event_location || "",
      };
    }
  } catch (err) {
    console.error("[Wallet] active event pass snapshot error:", err.message);
  }

  return {
    userId,
    userName,
    points,
    qrCode: Buffer.from(String(userId)).toString("base64"),
    membership,
    nextBooking,
    activeEventPass,
  };
}

function decodeBase64UrlToObject(value) {
  if (!value) return null;
  try {
    const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch (_) {
    return null;
  }
}

function extractGoogleLoyaltyObjectFromSaveUrl(saveUrl) {
  const token = String(saveUrl || "").split("/save/")[1] || "";
  const payloadPart = token.split(".")[1] || "";
  const decoded = decodeBase64UrlToObject(payloadPart);
  return decoded?.payload?.loyaltyObjects?.[0] || null;
}

async function syncGoogleWalletObjectForUser(userId, { reason = "wallet_update" } = {}) {
  if (!isGoogleWalletConfigured()) {
    return { synced: false, reason: "google_wallet_not_configured" };
  }
  const snapshot = await getWalletSnapshotForUser(userId);
  if (!snapshot) return { synced: false, reason: "user_not_found" };

  const saveUrl = buildGoogleWalletSaveUrl({ ...snapshot, activeEventPass: null, passKind: "membership" });
  const loyaltyObject = extractGoogleLoyaltyObjectFromSaveUrl(saveUrl);
  if (!loyaltyObject?.id) {
    return { synced: false, reason: "google_object_build_failed" };
  }

  try {
    await ensureGoogleWalletClass();
    const accessToken = await getGoogleWalletAccessToken();
    const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
    const objectIdPath = encodeURIComponent(loyaltyObject.id);
    try {
      await axios.put(
        `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${objectIdPath}`,
        loyaltyObject,
        { headers },
      );
      return { synced: true, mode: "updated", objectId: loyaltyObject.id };
    } catch (err) {
      if (err.response?.status !== 404) throw err;
      await axios.post(
        "https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject",
        loyaltyObject,
        { headers },
      );
      return { synced: true, mode: "created", objectId: loyaltyObject.id };
    }
  } catch (err) {
    console.error(`[Google Wallet] sync failed (${reason}) user=${userId}:`, err.response?.data || err.message);
    return { synced: false, reason: err.message || "google_sync_failed" };
  }
}

async function notifyApplePassUpdatedForUser(userId, { reason = "wallet_update" } = {}) {
  const serial = buildAppleWalletSerialFromUserId(userId);
  if (!serial || !APPLE_PASS_TYPE_ID) {
    return { serial, touched: 0, sent: 0, failed: 0, reason: "missing_serial_or_pass_type" };
  }

  let touched = 0;
  try {
    const touchRes = await pool.query(
      "UPDATE apple_wallet_devices SET updated_at = NOW() WHERE pass_type_id = $1 AND serial_number = $2",
      [APPLE_PASS_TYPE_ID, serial],
    );
    touched = touchRes.rowCount || 0;
  } catch (err) {
    console.error("[Apple Wallet] touch serial error:", err.message);
  }

  const regRes = await pool.query(
    `SELECT device_id, push_token
     FROM apple_wallet_devices
     WHERE pass_type_id = $1 AND serial_number = $2 AND COALESCE(push_token, '') <> ''`,
    [APPLE_PASS_TYPE_ID, serial],
  ).catch(() => ({ rows: [] }));
  const pushTokens = [...new Set(regRes.rows.map((r) => String(r.push_token || "").trim()).filter(Boolean))];

  if (!pushTokens.length) {
    return { serial, touched, total: 0, sent: 0, failed: 0, reason: "no_registered_devices" };
  }

  if (!isAppleApnsConfigured()) {
    console.log(`[Apple Wallet] APNS no configurado; pase marcado para ${serial} (${reason})`);
    return { serial, touched, total: pushTokens.length, sent: 0, failed: 0, reason: "apns_not_configured" };
  }

  let providerToken = "";
  try {
    providerToken = getAppleApnsProviderToken();
  } catch (err) {
    console.error("[Apple Wallet] APNS token error:", err.message);
    return { serial, touched, total: pushTokens.length, sent: 0, failed: pushTokens.length, reason: "apns_token_error" };
  }

  const pushResults = [];
  for (const pushToken of pushTokens) {
    // Throttle light to reduce burst rate on APNS.
    const result = await sendApplePassUpdatedPush(pushToken, providerToken);
    pushResults.push(result);
    await new Promise((r) => setTimeout(r, 120));
  }

  const sent = pushResults.filter((r) => r.ok).length;
  const failed = pushResults.length - sent;
  const tokensToPrune = pushResults.filter(shouldPruneApplePushToken).map((r) => r.pushToken);
  if (tokensToPrune.length) {
    await pool.query(
      `UPDATE apple_wallet_devices
       SET push_token = '', updated_at = NOW()
       WHERE pass_type_id = $1 AND serial_number = $2 AND push_token = ANY($3::text[])`,
      [APPLE_PASS_TYPE_ID, serial, tokensToPrune],
    ).catch(() => { });
  }

  if (failed > 0) {
    const sampleReason = pushResults.find((r) => !r.ok)?.reason || "unknown";
    console.warn(`[Apple Wallet] push parcial serial=${serial}, sent=${sent}, failed=${failed}, reason=${sampleReason}`);
  }

  return { serial, touched, total: pushResults.length, sent, failed, reason: failed ? "partial_failure" : "ok" };
}

async function persistWalletNotificationLog(payload) {
  const userId = payload?.userId || null;
  const reason = String(payload?.reason || "wallet_update").slice(0, 160);
  const apple = payload?.apple || {};
  const google = payload?.google || {};
  const appleSent = Number(apple.sent || 0);
  const appleFailed = Number(apple.failed || 0);
  const googleSynced = !!google.synced;
  const googleMode = google.mode ? String(google.mode).slice(0, 40) : null;
  const appleReason = String(apple.reason || "");
  const googleReason = String(google.reason || "");
  const appleOk = appleFailed === 0 && !["apns_token_error"].includes(appleReason);
  const googleOk = googleSynced || ["google_wallet_not_configured", "user_not_found"].includes(googleReason);
  const status = appleOk && googleOk ? "ok" : (appleOk || googleOk ? "partial" : "failed");

  await pool.query(
    `INSERT INTO wallet_notification_logs
      (user_id, reason, apple_sent, apple_failed, google_synced, google_mode, status, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [userId, reason, appleSent, appleFailed, googleSynced, googleMode, status, JSON.stringify({ apple, google })],
  );
}

async function notifyWalletPassesUpdatedForUser(userId, { reason = "wallet_update" } = {}) {
  if (!userId) {
    return { userId, reason, apple: { reason: "missing_user_id" }, google: { reason: "missing_user_id" } };
  }
  const [appleResult, googleResult] = await Promise.allSettled([
    notifyApplePassUpdatedForUser(userId, { reason }),
    syncGoogleWalletObjectForUser(userId, { reason }),
  ]);
  const result = {
    userId,
    reason,
    apple: appleResult.status === "fulfilled" ? appleResult.value : { reason: appleResult.reason?.message || "apple_notify_failed" },
    google: googleResult.status === "fulfilled" ? googleResult.value : { reason: googleResult.reason?.message || "google_sync_failed" },
  };
  await persistWalletNotificationLog(result).catch((err) => {
    console.error("[Wallet] could not persist notification log:", err.message);
  });
  return result;
}

const walletSyncQueue = new Map();

function triggerWalletPassSync(userId, reason = "wallet_update") {
  if (!userId) return;
  const key = String(userId);
  const existing = walletSyncQueue.get(key);
  if (existing?.timer) {
    clearTimeout(existing.timer);
    existing.reasons.add(reason);
  }
  const reasons = existing?.reasons || new Set([reason]);
  const timer = setTimeout(() => {
    walletSyncQueue.delete(key);
    const mergedReason = [...reasons].join(",");
    notifyWalletPassesUpdatedForUser(userId, { reason: mergedReason }).catch((err) => {
      console.error(`[Wallet] async sync failed (${mergedReason}) user=${userId}:`, err.message);
    });
  }, 1500);
  walletSyncQueue.set(key, { timer, reasons });
}

console.log("[Apple Wallet] Config check:",
  isAppleWalletConfigured() ? "✅ All certs configured — .pkpass mode" : "⚠️ Missing certs — web pass fallback mode");
console.log("[Apple Wallet]",
  "| TEAM:", APPLE_TEAM_ID ? "✅" : "❌",
  "| PASS_TYPE:", APPLE_PASS_TYPE_ID ? "✅" : "❌",
  "| CERT:", APPLE_SIGNER_CERT_PEM ? `✅ (${APPLE_SIGNER_CERT_PEM.length} chars)` : "❌",
  "| KEY:", APPLE_SIGNER_KEY_PEM ? `✅ (${APPLE_SIGNER_KEY_PEM.length} chars)` : "❌",
  "| WWDR:", APPLE_WWDR_CERT_PEM ? `✅ (${APPLE_WWDR_CERT_PEM.length} chars)` : "❌",
  "| APNS:", isAppleApnsConfigured() ? "✅" : "⚠️");
console.log("[Apple Wallet] File paths checked:",
  "cert:", CERT_FILE_PATHS.cert, safeExists(CERT_FILE_PATHS.cert) ? "✅" : "❌",
  "| key:", CERT_FILE_PATHS.key, safeExists(CERT_FILE_PATHS.key) ? "✅" : "❌",
  "| wwdr:", CERT_FILE_PATHS.wwdr, safeExists(CERT_FILE_PATHS.wwdr) ? "✅" : "❌");
console.log("[Apple Wallet] Cert dir candidates:", WALLET_ASSET_DIR_CANDIDATES.join(" | "));
console.log("[Apple Wallet] ASSET_DIR:", findAssetDir());

// Validate certs at startup if configured
if (isAppleWalletConfigured()) {
  try {
    console.log("[Apple Wallet] Cert PEM starts with:", APPLE_SIGNER_CERT_PEM.substring(0, 50));
    console.log("[Apple Wallet] Key PEM starts with:", APPLE_SIGNER_KEY_PEM.substring(0, 50));
    console.log("[Apple Wallet] WWDR PEM starts with:", APPLE_WWDR_CERT_PEM.substring(0, 50));
    try {
      crypto.createPrivateKey(APPLE_SIGNER_KEY_PEM);
      console.log("[Apple Wallet] ✅ Private key validated successfully");
    } catch (keyErr) {
      console.error("[Apple Wallet] ❌ Private key validation failed:", keyErr.message);
    }
  } catch (certErr) {
    console.error("[Apple Wallet] ❌ Cert decode error:", certErr.message);
  }
}

/** Check if we can at least generate a web pass (always true — no certs needed) */
function isAppleWebPassAvailable() {
  return true;
}

/**
 * Generate a .pkpass file as a Buffer for a given user.
 * Apple .pkpass = ZIP containing: pass.json, manifest.json, signature, icon.png, logo.png, strip.png
 */
async function generateApplePkpass({ userId, userName, points, qrCode, membership, nextBooking, activeEventPass }) {
  const baseSerialNumber = buildAppleWalletSerialFromUserId(userId);
  const hasMembership = !!membership;
  const hasEventPass = !!activeEventPass;
  const eventSerialHash = hasEventPass
    ? crypto.createHash("sha1").update(String(activeEventPass?.eventId || activeEventPass?.passCode || "")).digest("hex").slice(0, 12)
    : "";
  const serialNumber = hasEventPass ? `${baseSerialNumber}_ev_${eventSerialHash}` : baseSerialNumber;
  const eventSchedule = formatWalletEventSchedule(activeEventPass);
  const eventTitle = truncateWalletField(activeEventPass?.eventTitle || "Evento especial", 30);
  const eventDateObj = activeEventPass?.eventDate ? new Date(activeEventPass.eventDate) : null;
  const hasValidEventDate = !!eventDateObj && !Number.isNaN(eventDateObj.getTime());
  const eventDateShort = hasValidEventDate
    ? eventDateObj.toLocaleDateString("es-MX", { day: "numeric", month: "short" })
    : "Por confirmar";
  const eventDateLong = hasValidEventDate
    ? eventDateObj.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    : "Fecha por confirmar";
  const eventStartTimeLabel = activeEventPass?.eventStartTime ? String(activeEventPass.eventStartTime).slice(0, 5) : "";
  const eventEndTimeLabel = activeEventPass?.eventEndTime ? String(activeEventPass.eventEndTime).slice(0, 5) : "";
  const eventTimeShort = eventStartTimeLabel && eventEndTimeLabel
    ? `${eventStartTimeLabel}-${eventEndTimeLabel}`
    : (eventStartTimeLabel || "Por confirmar");
  const eventTimeLong = eventStartTimeLabel && eventEndTimeLabel
    ? `${eventStartTimeLabel} - ${eventEndTimeLabel}`
    : (eventStartTimeLabel || "Horario por confirmar");
  const eventLocationShort = truncateWalletField(activeEventPass?.eventLocation || "Tu Espacio Pilates", 24);
  const eventLocationLong = truncateWalletField(activeEventPass?.eventLocation || "Tu Espacio Pilates", 38);
  const eventCodeLabel = truncateWalletField(activeEventPass?.passCode || "—", 18);
  const eventRelevantDate = (() => {
    if (!hasEventPass || !hasValidEventDate) return new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const startDate = new Date(eventDateObj);
    if (eventStartTimeLabel) {
      const [hh, mm] = eventStartTimeLabel.split(":").map((p) => Number(p));
      if (Number.isFinite(hh) && Number.isFinite(mm)) {
        startDate.setHours(hh, mm, 0, 0);
      }
    } else {
      startDate.setHours(10, 0, 0, 0);
    }
    return startDate.toISOString();
  })();
  const eventExpirationDate = (() => {
    if (!hasEventPass || !hasValidEventDate) return null;
    const endDate = new Date(eventDateObj);
    if (eventEndTimeLabel) {
      const [hh, mm] = eventEndTimeLabel.split(":").map((p) => Number(p));
      if (Number.isFinite(hh) && Number.isFinite(mm)) {
        endDate.setHours(hh, mm, 0, 0);
      }
    } else {
      endDate.setHours(23, 0, 0, 0);
    }
    endDate.setHours(endDate.getHours() + 8);
    return endDate.toISOString();
  })();
  const membershipCategory = hasMembership
    ? normalizeClassCategory(membership.class_category, "all")
    : "all";
  const membershipCategoryLabel =
    membershipCategory === "pilates" ? "Pilates" :
      membershipCategory === "bienestar" ? "Bienestar" :
        membershipCategory === "funcional" ? "Funcional" :
          membershipCategory === "mixto" ? "Mixto" : "General";
  const isUnlimited = hasMembership && (membership.class_limit === null || membership.class_limit >= 9999);
  const isTrialSingleSession = hasMembership && String(membership.repeat_key || "").startsWith("trial_single_session");
  const nonTransferable = hasMembership && parseBooleanFlag(membership.is_non_transferable);
  const nonRepeatable = hasMembership && parseBooleanFlag(membership.is_non_repeatable);
  const passAccent = hasEventPass
    ? "rgb(231, 235, 110)"
    : membershipCategory === "pilates"
      ? "rgb(181, 191, 156)"
      : membershipCategory === "bienestar"
        ? "rgb(148, 134, 122)"
        : membershipCategory === "funcional"
          ? "rgb(178, 152, 218)"
          : "rgb(181, 191, 156)";
  const passForeground = hasEventPass ? "rgb(249, 247, 232)" : "rgb(247, 245, 255)";
  const passBackground = hasEventPass ? "rgb(31, 0, 71)" : "rgb(20, 11, 31)";
  const classLimit = hasMembership ? Number(membership.class_limit ?? 0) : 0;
  const classesRemaining = hasMembership
    ? Math.max(0, Number(membership.classes_remaining ?? classLimit ?? 0))
    : 0;
  const stripStampState = resolveWalletStripStampState(classLimit, classesRemaining);
  const hasIconStampMode = hasMembership && !isUnlimited && stripStampState.total > 0;
  const membershipHeadline = isUnlimited ? "Membresía" : membershipCategoryLabel;
  const memberDisplayName = truncateWalletField(userName, 22);
  const planDisplayName = truncateWalletField(
    hasMembership ? (membership.plan_name || `${membershipCategoryLabel} ${isUnlimited ? "Ilimitado" : ""}`.trim()) : "",
    28,
  );
  const shouldUseStampStrip = !hasEventPass && hasMembership && !isUnlimited && stripStampState.total > 0;
  const showFullFrontTextFields = hasEventPass
    ? parseBooleanFlag(process.env.APPLE_WALLET_SHOW_FRONT_TEXT_EVENT || false)
    : parseBooleanFlag(process.env.APPLE_WALLET_SHOW_FRONT_TEXT_MEMBERSHIP || false);

  // Build secondary/auxiliary fields
  const secondaryFields = [];
  const auxiliaryFields = [];
  const compactAuxiliaryFields = [];
  const backFields = [];

  if (hasEventPass) {
    secondaryFields.push({
      key: "event_title",
      label: "EVENTO",
      value: truncateWalletField(eventTitle, 24),
    });
    secondaryFields.push({
      key: "event_date",
      label: "FECHA",
      value: eventDateLong,
    });
    auxiliaryFields.push({
      key: "event_time",
      label: "HORARIO",
      value: eventTimeLong,
    });
    auxiliaryFields.push({
      key: "event_code",
      label: "CÓDIGO",
      value: eventCodeLabel,
    });
    if (activeEventPass?.eventLocation) {
      auxiliaryFields.push({
        key: "event_location",
        label: "SEDE",
        value: eventLocationLong,
      });
    }
    compactAuxiliaryFields.push(
      {
        key: "compact_event_time",
        label: "HORA",
        value: eventTimeShort,
      },
      {
        key: "compact_event_venue",
        label: "SEDE",
        value: eventLocationShort,
      },
      {
        key: "compact_event_code",
        label: "CÓDIGO",
        value: eventCodeLabel,
      },
    );
  }

  if (hasMembership) {
    secondaryFields.push({
      key: "plan_name",
      label: "PLAN",
      value: planDisplayName || `${membershipCategoryLabel}${isUnlimited ? " ilimitado" : ""}`,
    });
    secondaryFields.push({
      key: "modalidad",
      label: "MODALIDAD",
      value: membershipCategoryLabel,
    });
    auxiliaryFields.push({
      key: "client_name",
      label: "CLIENTE",
      value: memberDisplayName || "Miembro",
    });
    if (membership.end_date) {
      const endDate = new Date(membership.end_date);
      const daysLeft = Math.max(0, Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24)));
      auxiliaryFields.push({
        key: "vigencia",
        label: "VIGENTE HASTA",
        value: `${endDate.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })} (${daysLeft}d)`,
      });
    }
    if (isUnlimited) {
      auxiliaryFields.push({ key: "clases", label: "CLASES", value: "♾️ Ilimitadas" });
    } else if (classLimit > 0 && !hasIconStampMode && !hasEventPass) {
      auxiliaryFields.push({
        key: "clases",
        label: "CLASES",
        value: `${classesRemaining} / ${classLimit} restantes`,
        changeMessage: "Clases restantes: %@",
      });
    }
    const rules = [];
    if (nonTransferable) rules.push("No transferible");
    if (nonRepeatable) rules.push("No repetible");
    if (rules.length) {
      auxiliaryFields.push({
        key: "reglas",
        label: "REGLAS",
        value: rules.join(" · "),
      });
    }
  } else {
    secondaryFields.push({ key: "estado", label: "ESTADO", value: "Sin membresía activa" });
  }

  if (nextBooking) {
    const bookingDate = new Date(nextBooking.date);
    const dateStr = bookingDate.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
    const timeStr = nextBooking.start_time ? String(nextBooking.start_time).substring(0, 5) : "";
    backFields.push({
      key: "next_class",
      label: "PRÓXIMA CLASE",
      value: `${nextBooking.class_name || "Clase"} — ${dateStr} ${timeStr}${nextBooking.instructor_name ? ` — ${nextBooking.instructor_name}` : ""}`,
      changeMessage: "%@",
    });
  }

  if (!showFullFrontTextFields) {
    if (hasMembership) {
      backFields.unshift(
        {
          key: "membership_plan_back",
          label: "PLAN",
          value: planDisplayName || `${membershipCategoryLabel}${isUnlimited ? " ilimitado" : ""}`,
        },
        {
          key: "membership_mode_back",
          label: "MODALIDAD",
          value: membershipCategoryLabel,
        },
      );
      if (membership.end_date) {
        const endDate = new Date(membership.end_date);
        const daysLeft = Math.max(0, Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24)));
        backFields.unshift({
          key: "membership_valid_back",
          label: "VIGENTE HASTA",
          value: `${endDate.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })} (${daysLeft}d)`,
        });
      }
      if (isUnlimited) {
        backFields.unshift({ key: "membership_classes_back", label: "CLASES", value: "♾️ Ilimitadas" });
      } else if (classLimit > 0) {
        backFields.unshift({
          key: "membership_classes_back",
          label: "CLASES",
          value: `${classesRemaining} / ${classLimit} restantes`,
        });
      }
      const rules = [];
      if (nonTransferable) rules.push("No transferible");
      if (nonRepeatable) rules.push("No repetible");
      if (rules.length) {
        backFields.unshift({
          key: "membership_rules_back",
          label: "REGLAS",
          value: rules.join(" · "),
        });
      }
    } else {
      backFields.unshift({ key: "membership_status_back", label: "ESTADO", value: "Sin membresía activa" });
    }
  }

  if (hasEventPass) {
    backFields.push(
      {
        key: "event_title_back",
        label: "EVENTO",
        value: activeEventPass.eventTitle || "Evento especial",
      },
      {
        key: "event_code_back",
        label: "CÓDIGO DE CHECK-IN",
        value: activeEventPass.passCode || "—",
      },
    );
    if (eventSchedule) {
      backFields.push({
        key: "event_schedule_back",
        label: "HORARIO",
        value: eventSchedule,
      });
    }
    if (activeEventPass?.eventLocation) {
      backFields.push({
        key: "event_location_back",
        label: "UBICACIÓN",
        value: activeEventPass.eventLocation,
      });
    }
    backFields.push(
      {
        key: "event_access_back",
        label: "ACCESO",
        value: "Pase personal de un solo acceso. No transferible.",
      },
      {
        key: "event_checkin_back",
        label: "CHECK-IN",
        value: "Presenta tu QR en recepción 10 minutos antes del evento.",
      },
    );
  }

  backFields.push(
    { key: "cliente", label: "CLIENTE", value: userName },
    { key: "puntos", label: "PUNTOS TEP", value: `${points.toLocaleString("es-MX")} pts` },
    { key: "web", label: "RESERVAR EN LÍNEA", value: `${SITE_URL}/app/bookings` },
    {
      key: "terms",
      label: "TÉRMINOS",
      value: hasEventPass
        ? "Pase válido para un acceso al evento indicado. Presenta el QR en recepción."
        : "Válido para clases de Tu Espacio Pilates. Presenta tu pase al ingresar.",
    }
  );

  const primaryFields = [
    {
      key: "headline",
      label: hasEventPass ? "EVENTO ACTIVO" : (hasMembership ? "PASE ACTIVO" : "MIEMBRO"),
      value: hasEventPass
        ? truncateWalletField(activeEventPass.eventTitle || "Evento especial", 20)
        : hasMembership
          ? truncateWalletField(membershipHeadline, 20)
          : (memberDisplayName || "Miembro"),
      changeMessage: hasEventPass
        ? "Evento activo: %@"
        : hasMembership
          ? "Tu pase ahora es %@"
          : undefined,
    },
  ];

  const compactPrimaryFields = hasEventPass
    ? []
    : [
      {
        key: "compact_title",
        label: hasMembership ? "PLAN" : "MIEMBRO",
        value: hasMembership
          ? truncateWalletField(planDisplayName || membershipHeadline, 22)
          : truncateWalletField(memberDisplayName || "Miembro", 22),
      },
    ];

  const compactSecondaryFields = [];
  if (hasEventPass) {
    compactSecondaryFields.push({
      key: "compact_event_title",
      label: "EVENTO",
      value: truncateWalletField(activeEventPass?.eventTitle || "Evento especial", 20),
    });
    compactSecondaryFields.push({
      key: "compact_event_date",
      label: "FECHA",
      value: truncateWalletField(eventDateShort, 16),
    });
  } else if (hasMembership && membership.end_date) {
    const endDate = new Date(membership.end_date);
    const daysLeft = Math.max(0, Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24)));
    compactSecondaryFields.push({
      key: "compact_valid_until",
      label: "VIGENCIA",
      value: `${endDate.toLocaleDateString("es-MX", { day: "numeric", month: "short" })} (${daysLeft}d)`,
    });
  }

  // Build pass.json
  const passJson = {
    formatVersion: 1,
    passTypeIdentifier: APPLE_PASS_TYPE_ID,
    serialNumber,
    teamIdentifier: APPLE_TEAM_ID,
    organizationName: "Tu Espacio Pilates",
    description: hasEventPass
      ? `Evento — ${activeEventPass?.eventTitle || "Tu Espacio Pilates"}`
      : `${membershipCategoryLabel} — Tu Espacio Pilates`,
    logoText: "",
    foregroundColor: passForeground,
    backgroundColor: passBackground,
    labelColor: passAccent,
    storeCard: {
      headerFields: [
        { key: "points", label: "PUNTOS", value: points, textAlignment: "PKTextAlignmentRight", changeMessage: "Ahora tienes %@ puntos" },
      ],
      primaryFields: hasEventPass
        ? (showFullFrontTextFields ? primaryFields : compactPrimaryFields)
        : (showFullFrontTextFields ? primaryFields : []),
      secondaryFields: hasEventPass
        ? (showFullFrontTextFields ? secondaryFields : compactSecondaryFields)
        : secondaryFields,
      auxiliaryFields: hasEventPass
        ? (showFullFrontTextFields ? auxiliaryFields : compactAuxiliaryFields)
        : auxiliaryFields,
      backFields,
    },
    barcode: {
      message: qrCode,
      format: "PKBarcodeFormatQR",
      messageEncoding: "iso-8859-1",
    },
    barcodes: [
      {
        message: qrCode,
        format: "PKBarcodeFormatQR",
        messageEncoding: "iso-8859-1",
      },
    ],
    webServiceURL: `${SITE_URL}/api/wallet`,
    authenticationToken: APPLE_AUTH_TOKEN,
    relevantDate: eventRelevantDate,
  };
  if (eventExpirationDate) {
    passJson.expirationDate = eventExpirationDate;
  }

  // Read image assets with dedicated retina variants to avoid pixelation in Wallet.
  const assetCategory =
    hasEventPass
      ? "event"
      : membershipCategory === "pilates"
        ? "pilates"
        : membershipCategory === "bienestar"
          ? "bienestar"
          : "mixto";

  const iconPath = findAssetFile([
    `wallet-icon-${assetCategory}.png`,
    "wallet-icon-event.png",
    "wallet-icon-mixto.png",
    "pn-logo.png",
  ]);
  const icon2xPath = findAssetFile([
    `wallet-icon-${assetCategory}@2x.png`,
    "wallet-icon-event@2x.png",
    "wallet-icon-mixto@2x.png",
    `wallet-icon-${assetCategory}.png`,
    "wallet-icon-event.png",
    "wallet-icon-mixto.png",
    "pn-logo.png",
  ]);
  const icon3xPath = findAssetFile([
    `wallet-icon-${assetCategory}@3x.png`,
    "wallet-icon-event@3x.png",
    "wallet-icon-mixto@3x.png",
    `wallet-icon-${assetCategory}@2x.png`,
    "wallet-icon-event@2x.png",
    "wallet-icon-mixto@2x.png",
    `wallet-icon-${assetCategory}.png`,
    "wallet-icon-event.png",
    "wallet-icon-mixto.png",
    "pn-logo.png",
  ]);

  const logoPath = findAssetFile([
    "wallet-logo.png",
    "pn-logo-full.png",
    "pn-logo.png",
    "wallet-logo-black.png",
  ]);
  const logo2xPath = findAssetFile([
    "wallet-logo@2x.png",
    "wallet-logo.png",
    "pn-logo-full.png",
    "pn-logo.png",
    "wallet-logo-black@2x.png",
    "wallet-logo-black.png",
  ]);
  const logo3xPath = findAssetFile([
    "wallet-logo@3x.png",
    "wallet-logo@2x.png",
    "wallet-logo.png",
    "pn-logo-full.png",
    "pn-logo.png",
    "wallet-logo-black@3x.png",
    "wallet-logo-black@2x.png",
    "wallet-logo-black.png",
  ]);

  const thumbPath = findAssetFile([
    `wallet-thumb-${assetCategory}.png`,
    "wallet-thumb-event.png",
    `wallet-icon-${assetCategory}.png`,
    "wallet-icon-event.png",
    "pn-logo.png",
  ]);
  const thumb2xPath = findAssetFile([
    `wallet-thumb-${assetCategory}@2x.png`,
    "wallet-thumb-event@2x.png",
    `wallet-thumb-${assetCategory}.png`,
    "wallet-thumb-event.png",
    `wallet-icon-${assetCategory}@2x.png`,
    "wallet-icon-event@2x.png",
    `wallet-icon-${assetCategory}.png`,
    "wallet-icon-event.png",
    "pn-logo.png",
  ]);

  let dynamicStripName = "none";
  let stripPath = null;
  let strip2xPath = null;
  let strip3xPath = null;
  if (!hasEventPass) {
    const stripCategory =
      membershipCategory === "pilates" ? "pilates"
        : membershipCategory === "bienestar" ? "bienestar"
          : "mixto";
    dynamicStripName = shouldUseStampStrip
      ? `wallet-strip-${stripCategory}-t${stripStampState.total}-r${stripStampState.remaining}.png`
      : `wallet-strip-${stripCategory}.png`;
    const dynamicStripPath = shouldUseStampStrip
      ? findAssetFile([dynamicStripName])
      : null;
    const stripCandidates = [`wallet-strip-${stripCategory}.png`, "wallet-strip-mixto.png"];
    const strip2xCandidates = [`wallet-strip-${stripCategory}@2x.png`, "wallet-strip-mixto@2x.png"];
    const strip3xCandidates = [`wallet-strip-${stripCategory}@3x.png`, "wallet-strip-mixto@3x.png"];
    stripPath = dynamicStripPath || findAssetFile(stripCandidates);
    strip2xPath = dynamicStripPath
      ? findAssetFile([dynamicStripName.replace(".png", "@2x.png")])
      : findAssetFile(strip2xCandidates);
    strip3xPath = dynamicStripPath
      ? findAssetFile([dynamicStripName.replace(".png", "@3x.png")])
      : findAssetFile(strip3xCandidates);
  }

  const readAssetBuffer = (assetPath) => (assetPath && fs.existsSync(assetPath) ? fs.readFileSync(assetPath) : null);
  const iconBuffer = readAssetBuffer(iconPath);
  const icon2xBuffer = readAssetBuffer(icon2xPath) || iconBuffer;
  const icon3xBuffer = readAssetBuffer(icon3xPath) || icon2xBuffer || iconBuffer;
  const logoBuffer = readAssetBuffer(logoPath);
  const logo2xBuffer = readAssetBuffer(logo2xPath) || logoBuffer;
  const logo3xBuffer = readAssetBuffer(logo3xPath) || logo2xBuffer || logoBuffer;
  const thumbBuffer = readAssetBuffer(thumbPath);
  const thumb2xBuffer = readAssetBuffer(thumb2xPath) || thumbBuffer;
  const stripBuffer = readAssetBuffer(stripPath);
  const strip2xBuffer = readAssetBuffer(strip2xPath) || stripBuffer;
  const strip3xBuffer = readAssetBuffer(strip3xPath) || strip2xBuffer || stripBuffer;

  console.log(
    "[Apple Wallet] Assets found — icon:", !!iconBuffer,
    "icon@2x:", !!icon2xBuffer,
    "icon@3x:", !!icon3xBuffer,
    "logo:", !!logoBuffer,
    "logo@2x:", !!logo2xBuffer,
    "logo@3x:", !!logo3xBuffer,
    "thumbnail:", !!thumbBuffer,
    "thumbnail@2x:", !!thumb2xBuffer,
    "strip:", !!stripBuffer,
    "stripState:", `${stripStampState.remaining}/${stripStampState.total}`,
    "stripAsset:", dynamicStripName,
  );

  // Build file map for the pass
  const files = {};
  const passJsonBuffer = Buffer.from(JSON.stringify(passJson));
  files["pass.json"] = passJsonBuffer;
  if (iconBuffer) {
    files["icon.png"] = iconBuffer;
    files["icon@2x.png"] = icon2xBuffer || iconBuffer;
    files["icon@3x.png"] = icon3xBuffer || icon2xBuffer || iconBuffer;
  }
  if (logoBuffer) {
    files["logo.png"] = logoBuffer;
    files["logo@2x.png"] = logo2xBuffer || logoBuffer;
    files["logo@3x.png"] = logo3xBuffer || logo2xBuffer || logoBuffer;
  }
  if (thumbBuffer) {
    files["thumbnail.png"] = thumbBuffer;
    files["thumbnail@2x.png"] = thumb2xBuffer || thumbBuffer;
  }
  if (stripBuffer) files["strip.png"] = stripBuffer;
  if (strip2xBuffer) files["strip@2x.png"] = strip2xBuffer;
  if (strip3xBuffer) files["strip@3x.png"] = strip3xBuffer;

  // Build manifest.json (SHA1 hashes of each file)
  const manifest = {};
  for (const [name, buf] of Object.entries(files)) {
    manifest[name] = crypto.createHash("sha1").update(buf).digest("hex");
  }
  const manifestBuffer = Buffer.from(JSON.stringify(manifest));
  files["manifest.json"] = manifestBuffer;

  // Sign manifest with Apple certificates to create PKCS#7 signature
  // Use pre-loaded PEM variables (from files or base64 env vars)
  const signerCertPem = APPLE_SIGNER_CERT_PEM;
  const signerKeyPem = APPLE_SIGNER_KEY_PEM;
  const wwdrPem = APPLE_WWDR_CERT_PEM;

  console.log("[Apple Wallet] PEM sizes — cert:", signerCertPem.length, "key:", signerKeyPem.length, "wwdr:", wwdrPem.length);

  // Use openssl to create detached PKCS#7 signature
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pkpass-"));
  const manifestPath = path.join(tmpDir, "manifest.json");
  const certPath = path.join(tmpDir, "signer.pem");
  const keyPath = path.join(tmpDir, "signer.key");
  const wwdrPath = path.join(tmpDir, "wwdr.pem");
  const sigPath = path.join(tmpDir, "signature");

  fs.writeFileSync(manifestPath, manifestBuffer);
  fs.writeFileSync(certPath, signerCertPem);
  fs.writeFileSync(keyPath, signerKeyPem);
  fs.writeFileSync(wwdrPath, wwdrPem);

  const opensslCmd = `openssl smime -binary -sign -certfile "${wwdrPath}" -signer "${certPath}" -inkey "${keyPath}" -in "${manifestPath}" -out "${sigPath}" -outform DER${APPLE_CERT_PASSWORD ? ` -passin pass:${APPLE_CERT_PASSWORD}` : ""}`;
  console.log("[Apple Wallet] Signing manifest with openssl...");
  try {
    execSync(opensslCmd, { stdio: "pipe" });
    console.log("[Apple Wallet] ✅ Signature created successfully");
  } catch (opensslErr) {
    const errMsg = opensslErr.stderr?.toString() || opensslErr.message;
    console.error("[Apple Wallet] ❌ OpenSSL signing failed:", errMsg);
    // Clean up temp files
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`OpenSSL signing failed: ${errMsg}`);
  }

  const signatureBuffer = fs.readFileSync(sigPath);
  files["signature"] = signatureBuffer;

  // Clean up temp files
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // Create ZIP (.pkpass)
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { store: true }); // no compression for .pkpass
    const chunks = [];
    archive.on("data", (chunk) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);

    for (const [name, buf] of Object.entries(files)) {
      archive.append(buf, { name });
    }
    archive.finalize();
  });
}

// ── Apple Wallet endpoints ─────────────────────────────────────────────────

// GET /api/wallet/apple/pkpass — generate and download .pkpass (or web pass fallback)
app.get("/api/wallet/apple/pkpass", authMiddleware, async (req, res) => {
  try {
    const snapshot = await getWalletSnapshotForUser(req.userId);
    if (!snapshot) return res.status(404).json({ message: "Usuario no encontrado" });
    const { userName, points, qrCode, membership, nextBooking } = snapshot;

    // If Apple Developer certs are configured, generate real .pkpass
    if (isAppleWalletConfigured()) {
      console.log("[Apple Wallet] ✅ Certs detected — generating real .pkpass for user:", req.userId);
      try {
        const pkpassBuffer = await generateApplePkpass({
          userId: req.userId,
          userName,
          points,
          qrCode,
          membership,
          nextBooking,
          activeEventPass: null,
        });
        console.log("[Apple Wallet] ✅ .pkpass generated, size:", pkpassBuffer.length, "bytes");
        res.setHeader("Content-Type", "application/vnd.apple.pkpass");
        res.setHeader("Content-Disposition", `attachment; filename="tu-espacio-pilates-pass.pkpass"`);
        res.setHeader("Content-Length", pkpassBuffer.length);
        return res.send(pkpassBuffer);
      } catch (pkpassErr) {
        console.error("[Apple Wallet] ❌ .pkpass generation failed:", pkpassErr.message);
        console.error("[Apple Wallet] ❌ Full error:", pkpassErr.stack || pkpassErr);
        // Return JSON error so frontend knows what happened
        return res.status(500).json({
          message: "Error generando pase .pkpass",
          error: pkpassErr.message,
          fallback: "webpass",
        });
      }
    }

    // No certs configured — return web pass HTML
    console.log("[Apple Wallet] ⚠️ Certs not configured — using web pass fallback.",
      "TEAM:", APPLE_TEAM_ID ? "✅" : "❌",
      "PASS_TYPE:", APPLE_PASS_TYPE_ID ? "✅" : "❌",
      "CERT:", APPLE_SIGNER_CERT_PEM ? "✅" : "❌",
      "KEY:", APPLE_SIGNER_KEY_PEM ? "✅" : "❌",
      "WWDR:", APPLE_WWDR_CERT_PEM ? "✅" : "❌"
    );

    // Fallback: generate a beautiful standalone HTML pass page
    const nextBookingHtml = nextBooking
      ? `<div class="field"><span class="label">Próxima clase</span><span class="value">${nextBooking.class_name || ""}</span></div>
         <div class="field"><span class="label">Fecha</span><span class="value">${nextBooking.date ? new Date(nextBooking.date).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : ""} ${nextBooking.start_time || ""}</span></div>`
      : "";
    const membershipHtml = membership
      ? `<div class="field"><span class="label">Plan</span><span class="value">${membership.plan_name}</span></div>
         <div class="field"><span class="label">Clases restantes</span><span class="value">${membership.classes_remaining ?? "∞"} / ${membership.class_limit ?? "∞"}</span></div>
         <div class="field"><span class="label">Vigencia</span><span class="value">${membership.end_date ? new Date(membership.end_date).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "—"}</span></div>`
      : `<div class="field"><span class="label">Plan</span><span class="value">Sin membresía activa</span></div>`;

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Tu Espacio Pilates">
<title>Tu Espacio Pilates — ${userName}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.pass{width:100%;max-width:380px;border-radius:24px;overflow:hidden;background:linear-gradient(160deg,#1a0b26 0%,#2d0a40 50%,#1a0b26 100%);box-shadow:0 20px 60px rgba(225,92,184,.2),0 0 0 1px rgba(202,113,225,.15)}
.header{padding:24px 24px 16px;display:flex;align-items:center;justify-content:space-between}
.logo{font-size:18px;font-weight:800;background:linear-gradient(135deg,#E15CB8,#CA71E1);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.badge{font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:rgba(202,113,225,.7);border:1px solid rgba(202,113,225,.3);padding:4px 10px;border-radius:20px}
.points-section{text-align:center;padding:8px 24px 24px}
.points-label{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#CA71E1;margin-bottom:4px}
.points{font-size:72px;font-weight:900;background:linear-gradient(135deg,#E15CB8,#CA71E1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;line-height:1}
.points-sub{font-size:13px;color:rgba(255,255,255,.5);margin-top:4px}
.qr-section{display:flex;justify-content:center;padding:0 24px 24px}
.qr-wrap{background:#fff;border-radius:20px;padding:16px;box-shadow:0 8px 32px rgba(0,0,0,.3)}
.qr-wrap img{width:160px;height:160px;display:block}
.qr-hint{text-align:center;font-size:11px;color:rgba(255,255,255,.35);padding:0 24px 20px;line-height:1.5}
.fields{padding:0 24px 24px;display:flex;flex-direction:column;gap:12px}
.field{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:rgba(255,255,255,.05);border-radius:14px;border:1px solid rgba(255,255,255,.06)}
.label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.45)}
.value{font-size:14px;font-weight:600;color:#fff;text-align:right}
.footer{text-align:center;padding:0 24px 24px;display:flex;gap:8px;justify-content:center}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:12px 20px;border-radius:14px;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all .2s}
.btn-primary{background:linear-gradient(135deg,#E15CB8,#CA71E1);color:#fff;flex:1}
.btn-primary:hover{opacity:.9}
.btn-outline{background:rgba(255,255,255,.06);color:#fff;border:1px solid rgba(255,255,255,.1);flex:1}
.btn-outline:hover{background:rgba(255,255,255,.1)}
.name{text-align:center;font-size:16px;font-weight:700;padding:0 24px 4px;color:#fff}
</style>
</head>
<body>
<div class="pass">
  <div class="header">
    <div class="logo">Tu Espacio Pilates</div>
    <div class="badge">Club</div>
  </div>
  <div class="name">${userName}</div>
  <div class="points-section">
    <div class="points-label">Puntos acumulados</div>
    <div class="points">${points}</div>
    <div class="points-sub">Tu Espacio Pilates</div>
  </div>
  <div class="qr-section">
    <div class="qr-wrap">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrCode)}&bgcolor=FFFFFF&color=1a0b26" alt="QR Code" />
    </div>
  </div>
  <div class="qr-hint">Tu código de acceso a Tu Espacio Pilates</div>
  <div class="fields">
    ${membershipHtml}
    ${nextBookingHtml}
  </div>
  <div class="footer">
    <button class="btn btn-primary" onclick="window.print()">🖨 Imprimir</button>
    <button class="btn btn-outline" onclick="alert('Consejo: En Safari, toca Compartir → Añadir a pantalla de inicio para tener tu pase siempre a la mano')">📱 Guardar</button>
  </div>
</div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (err) {
    console.error("Apple Wallet pkpass error:", err.message);
    return res.status(500).json({ message: "Error generando pase de Apple Wallet" });
  }
});

// GET /api/wallet/events/apple/pkpass — generate and download event-specific .pkpass
app.get("/api/wallet/events/apple/pkpass", authMiddleware, async (req, res) => {
  try {
    const eventIdRaw = String(req.query?.eventId || "").trim();
    const eventId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventIdRaw)
      ? eventIdRaw
      : null;
    if (!eventId) return res.status(400).json({ message: "eventId inválido" });

    const snapshot = await getWalletSnapshotForUser(req.userId, { eventId });
    if (!snapshot) return res.status(404).json({ message: "Usuario no encontrado" });
    const { userName, points, qrCode, activeEventPass } = snapshot;
    if (!activeEventPass) return res.status(404).json({ message: "No existe pase activo para ese evento" });
    const eventDateObj = activeEventPass?.eventDate ? new Date(activeEventPass.eventDate) : null;
    const hasValidEventDate = !!eventDateObj && !Number.isNaN(eventDateObj.getTime());
    const eventDateLong = hasValidEventDate
      ? eventDateObj.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
      : "Fecha por confirmar";
    const eventStartTimeLabel = activeEventPass?.eventStartTime ? String(activeEventPass.eventStartTime).slice(0, 5) : "";
    const eventEndTimeLabel = activeEventPass?.eventEndTime ? String(activeEventPass.eventEndTime).slice(0, 5) : "";
    const eventTimeLong = eventStartTimeLabel && eventEndTimeLabel
      ? `${eventStartTimeLabel} - ${eventEndTimeLabel}`
      : (eventStartTimeLabel || "Horario por confirmar");
    const eventLocationLong = truncateWalletField(activeEventPass?.eventLocation || "Tu Espacio Pilates", 38);

    if (isAppleWalletConfigured()) {
      const pkpassBuffer = await generateApplePkpass({
        userId: req.userId,
        userName,
        points,
        qrCode,
        membership: null,
        nextBooking: null,
        activeEventPass,
      });
      res.setHeader("Content-Type", "application/vnd.apple.pkpass");
      res.setHeader("Content-Disposition", `attachment; filename="tu-espacio-pilates-event-pass.pkpass"`);
      res.setHeader("Content-Length", pkpassBuffer.length);
      return res.send(pkpassBuffer);
    }

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Pase de Evento — Tu Espacio Pilates</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.pass{width:100%;max-width:390px;border-radius:24px;overflow:hidden;background:linear-gradient(165deg,#1F0047 0%,#2D0A40 56%,#1F0047 100%);box-shadow:0 22px 60px rgba(225,92,184,.2),0 0 0 1px rgba(202,113,225,.18)}
.header{padding:20px 22px 10px}
.badge{display:inline-flex;align-items:center;gap:8px;padding:4px 10px;border-radius:999px;background:rgba(231,235,110,.13);color:#E7EB6E;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase}
.title{margin-top:10px;font-weight:800;font-size:22px;line-height:1.1;color:#F9F7E8}
.meta{padding:0 22px 6px;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.meta-item{border:1px solid rgba(249,247,232,.16);border-radius:12px;padding:10px 11px;background:rgba(255,255,255,.02)}
.meta-label{font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:#E7EB6E;font-weight:700}
.meta-value{font-size:13px;line-height:1.3;color:#F9F7E8;margin-top:4px}
.qr{display:flex;justify-content:center;padding:16px 20px 10px}
.qr img{background:#fff;border-radius:18px;padding:12px}
.code{padding:0 22px 22px;text-align:center;font-size:13px;color:#F9F7E8}
.code strong{color:#E7EB6E;letter-spacing:.04em}
</style>
</head>
<body>
  <div class="pass">
    <div class="header">
      <span class="badge">Pase de evento</span>
      <div class="title">${activeEventPass.eventTitle || "Evento Tu Espacio Pilates"}</div>
    </div>
    <div class="meta">
      <div class="meta-item">
        <div class="meta-label">Fecha</div>
        <div class="meta-value">${eventDateLong || "Por confirmar"}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Horario</div>
        <div class="meta-value">${eventTimeLong || "Por confirmar"}</div>
      </div>
      <div class="meta-item" style="grid-column:1 / span 2;">
        <div class="meta-label">Sede</div>
        <div class="meta-value">${eventLocationLong || "Tu Espacio Pilates"}</div>
      </div>
    </div>
    <div class="qr"><img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(activeEventPass.passCode || qrCode)}&bgcolor=FFFFFF&color=1F0047" alt="QR"/></div>
    <div class="code">Código de acceso: <strong>${activeEventPass.passCode || "—"}</strong></div>
  </div>
</body>
</html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (err) {
    console.error("Apple Wallet event pkpass error:", err.message);
    return res.status(500).json({ message: "Error generando pase de evento Apple Wallet" });
  }
});

// GET /api/wallet/apple/status — check Apple Wallet config (admin only)
app.get("/api/wallet/apple/status", adminMiddleware, async (_req, res) => {
  return res.json({
    configured: true, // Always true — we have web pass fallback even without Apple certs
    nativePkpass: isAppleWalletConfigured(),
    apnsConfigured: isAppleApnsConfigured(),
    teamId: APPLE_TEAM_ID ? "✅ set" : "❌ (web pass mode)",
    passTypeId: APPLE_PASS_TYPE_ID || "N/A (web pass mode)",
    keyId: APPLE_KEY_ID ? "✅ set" : "❌",
    apnsKey: APPLE_APNS_KEY_PEM ? `✅ loaded (${APPLE_APNS_KEY_PEM.length} chars)` : "❌",
    apnsHost: APPLE_APNS_HOST,
    signerCert: APPLE_SIGNER_CERT_PEM ? `✅ loaded (${APPLE_SIGNER_CERT_PEM.length} chars)` : "❌ (web pass mode)",
    signerKey: APPLE_SIGNER_KEY_PEM ? `✅ loaded (${APPLE_SIGNER_KEY_PEM.length} chars)` : "❌ (web pass mode)",
    wwdrCert: APPLE_WWDR_CERT_PEM ? `✅ loaded (${APPLE_WWDR_CERT_PEM.length} chars)` : "❌ (web pass mode)",
    certFiles: {
      cert: `${CERT_FILE_PATHS.cert} ${safeExists(CERT_FILE_PATHS.cert) ? "✅" : "❌"}`,
      key: `${CERT_FILE_PATHS.key} ${safeExists(CERT_FILE_PATHS.key) ? "✅" : "❌"}`,
      wwdr: `${CERT_FILE_PATHS.wwdr} ${safeExists(CERT_FILE_PATHS.wwdr) ? "✅" : "❌"}`,
    },
    certDirCandidates: WALLET_ASSET_DIR_CANDIDATES,
  });
});

// GET /api/wallet/apple/debug — detailed cert diagnostics (admin only)
app.get("/api/wallet/apple/debug", authMiddleware, async (req, res) => {
  // Check if user is admin
  try {
    const userRes = await pool.query("SELECT role FROM users WHERE id = $1", [req.userId]);
    if (userRes.rows[0]?.role !== "admin") return res.status(403).json({ message: "Solo admin" });
  } catch { return res.status(403).json({ message: "Error" }); }

  const checks = {
    configured: isAppleWalletConfigured(),
    apnsConfigured: isAppleApnsConfigured(),
    envVars: {
      APPLE_TEAM_ID: APPLE_TEAM_ID ? `✅ "${APPLE_TEAM_ID}"` : "❌ not set",
      APPLE_PASS_TYPE_ID: APPLE_PASS_TYPE_ID ? `✅ "${APPLE_PASS_TYPE_ID}"` : "❌ not set",
      APPLE_KEY_ID: APPLE_KEY_ID ? `✅ "${APPLE_KEY_ID}"` : "❌ not set",
      APPLE_CERT_PASSWORD: APPLE_CERT_PASSWORD ? "✅ set" : "⬜ not set (OK if key has no password)",
    },
    certFiles: {
      certPath: `${CERT_FILE_PATHS.cert} ${safeExists(CERT_FILE_PATHS.cert) ? "✅ exists" : "❌ not found"}`,
      keyPath: `${CERT_FILE_PATHS.key} ${safeExists(CERT_FILE_PATHS.key) ? "✅ exists" : "❌ not found"}`,
      wwdrPath: `${CERT_FILE_PATHS.wwdr} ${safeExists(CERT_FILE_PATHS.wwdr) ? "✅ exists" : "❌ not found"}`,
    },
    certDirCandidates: WALLET_ASSET_DIR_CANDIDATES,
    loadedPems: {
      signerCert: APPLE_SIGNER_CERT_PEM ? `✅ loaded (${APPLE_SIGNER_CERT_PEM.length} chars), starts: ${APPLE_SIGNER_CERT_PEM.substring(0, 40)}...` : "❌ not loaded",
      signerKey: APPLE_SIGNER_KEY_PEM ? `✅ loaded (${APPLE_SIGNER_KEY_PEM.length} chars), starts: ${APPLE_SIGNER_KEY_PEM.substring(0, 40)}...` : "❌ not loaded",
      wwdr: APPLE_WWDR_CERT_PEM ? `✅ loaded (${APPLE_WWDR_CERT_PEM.length} chars), starts: ${APPLE_WWDR_CERT_PEM.substring(0, 40)}...` : "❌ not loaded",
      apnsKey: APPLE_APNS_KEY_PEM ? `✅ loaded (${APPLE_APNS_KEY_PEM.length} chars), starts: ${APPLE_APNS_KEY_PEM.substring(0, 40)}...` : "❌ not loaded",
    },
    base64EnvFallback: {
      APPLE_SIGNER_CERT_BASE64: process.env.APPLE_SIGNER_CERT_BASE64 ? `✅ (${process.env.APPLE_SIGNER_CERT_BASE64.length} chars)` : "⬜ not set",
      APPLE_SIGNER_KEY_BASE64: process.env.APPLE_SIGNER_KEY_BASE64 ? `✅ (${process.env.APPLE_SIGNER_KEY_BASE64.length} chars)` : "⬜ not set",
      APPLE_WWDR_CERT_BASE64: process.env.APPLE_WWDR_CERT_BASE64 ? `✅ (${process.env.APPLE_WWDR_CERT_BASE64.length} chars)` : "⬜ not set",
      APPLE_APNS_KEY_BASE64: process.env.APPLE_APNS_KEY_BASE64 ? `✅ (${process.env.APPLE_APNS_KEY_BASE64.length} chars)` : "⬜ not set",
    },
    assetDir: findAssetDir(),
    assetsFound: {
      "pn-logo.png": fs.existsSync(path.join(findAssetDir(), "pn-logo.png")),
      "pn-logo-full.png": fs.existsSync(path.join(findAssetDir(), "pn-logo-full.png")),
    },
    opensslVersion: "unknown",
    keyValidation: "not tested",
    apnsKeyValidation: "not tested",
  };

  // Check openssl
  try {
    checks.opensslVersion = execSync("openssl version", { encoding: "utf8" }).trim();
  } catch (e) {
    checks.opensslVersion = "❌ openssl not found: " + e.message;
  }

  // Validate private key
  if (APPLE_SIGNER_KEY_PEM) {
    try {
      crypto.createPrivateKey(APPLE_SIGNER_KEY_PEM);
      checks.keyValidation = "✅ key is valid";
    } catch (keyErr) {
      checks.keyValidation = "❌ " + keyErr.message;
    }
  }

  if (APPLE_APNS_KEY_PEM) {
    try {
      crypto.createPrivateKey(APPLE_APNS_KEY_PEM);
      checks.apnsKeyValidation = "✅ key is valid";
    } catch (keyErr) {
      checks.apnsKeyValidation = "❌ " + keyErr.message;
    }
  }

  return res.json(checks);
});

// Apple Wallet Web Service endpoints (protocol V1)

// POST /api/wallet/v1/devices/:deviceId/registrations/:passTypeId/:serial
app.post("/api/wallet/v1/devices/:deviceId/registrations/:passTypeId/:serial", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("ApplePass ") || authHeader.replace("ApplePass ", "") !== APPLE_AUTH_TOKEN) {
    return res.status(401).send("Unauthorized");
  }
  const { deviceId, serial, passTypeId } = req.params;
  const effectivePassTypeId = passTypeId || APPLE_PASS_TYPE_ID;
  const pushToken = req.body?.pushToken || "";
  try {
    await pool.query(`
      INSERT INTO apple_wallet_devices (device_id, push_token, pass_type_id, serial_number)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (device_id, pass_type_id, serial_number) DO UPDATE SET push_token = $2, updated_at = NOW()
    `, [deviceId, pushToken, effectivePassTypeId, serial]);
    return res.status(201).send();
  } catch (err) {
    console.error("Apple register device error:", err);
    return res.status(500).send();
  }
});

// GET /api/wallet/v1/devices/:deviceId/registrations/:passTypeId
app.get("/api/wallet/v1/devices/:deviceId/registrations/:passTypeId", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("ApplePass ") || authHeader.replace("ApplePass ", "") !== APPLE_AUTH_TOKEN) {
    return res.status(401).send("Unauthorized");
  }
  const { deviceId, passTypeId } = req.params;
  const effectivePassTypeId = passTypeId || APPLE_PASS_TYPE_ID;
  const rawSince = String(req.query?.passesUpdatedSince || "").trim();
  const sinceDate = rawSince ? new Date(rawSince) : null;
  const hasValidSince = !!(sinceDate && !Number.isNaN(sinceDate.getTime()));
  try {
    const params = [deviceId, effectivePassTypeId];
    let query = `
      SELECT serial_number, updated_at
      FROM apple_wallet_devices
      WHERE device_id = $1 AND pass_type_id = $2
    `;
    if (hasValidSince) {
      params.push(sinceDate.toISOString());
      query += ` AND updated_at > $${params.length}`;
    }
    query += " ORDER BY updated_at DESC";
    const r = await pool.query(query, params);
    if (r.rows.length === 0) return res.status(204).send();
    const latestUpdatedAt = r.rows.reduce((latest, row) => {
      const current = row.updated_at ? new Date(row.updated_at) : null;
      if (!current || Number.isNaN(current.getTime())) return latest;
      if (!latest) return current;
      return current > latest ? current : latest;
    }, null);
    return res.json({
      serialNumbers: r.rows.map((d) => d.serial_number),
      lastUpdated: latestUpdatedAt?.toISOString() || new Date().toISOString(),
    });
  } catch (err) {
    console.error("Apple list passes error:", err);
    return res.status(500).send();
  }
});

// GET /api/wallet/v1/passes/:passTypeId/:serial — download updated pass
app.get("/api/wallet/v1/passes/:passTypeId/:serial", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("ApplePass ") || authHeader.replace("ApplePass ", "") !== APPLE_AUTH_TOKEN) {
    return res.status(401).send("Unauthorized");
  }
  if (!isAppleWalletConfigured()) {
    return res.status(501).json({ message: "Apple Wallet signing not configured" });
  }
  const { serial, passTypeId } = req.params;
  const effectivePassTypeId = passTypeId || APPLE_PASS_TYPE_ID;
  const userId = parseUserIdFromAppleWalletSerial(serial);
  if (!userId) return res.status(404).send();
  try {
    const snapshot = await getWalletSnapshotForUser(userId);
    if (!snapshot) return res.status(404).send();
    const { userName, points, qrCode, membership, nextBooking } = snapshot;
    const pkpassBuffer = await generateApplePkpass({
      userId,
      userName,
      points,
      qrCode,
      membership,
      nextBooking,
      activeEventPass: null,
    });
    const touchRes = await pool.query(
      "SELECT MAX(updated_at) AS updated_at FROM apple_wallet_devices WHERE pass_type_id = $1 AND serial_number = $2",
      [effectivePassTypeId, serial],
    ).catch(() => ({ rows: [] }));
    const lastUpdated = touchRes.rows[0]?.updated_at ? new Date(touchRes.rows[0].updated_at) : new Date();
    res.setHeader("Content-Type", "application/vnd.apple.pkpass");
    res.setHeader("Last-Modified", lastUpdated.toUTCString());
    return res.send(pkpassBuffer);
  } catch (err) {
    console.error("Apple V1 pass download error:", err.message);
    return res.status(500).send();
  }
});

// DELETE /api/wallet/v1/devices/:deviceId/registrations/:passTypeId/:serial
app.delete("/api/wallet/v1/devices/:deviceId/registrations/:passTypeId/:serial", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("ApplePass ") || authHeader.replace("ApplePass ", "") !== APPLE_AUTH_TOKEN) {
    return res.status(401).send("Unauthorized");
  }
  const { deviceId, serial, passTypeId } = req.params;
  const effectivePassTypeId = passTypeId || APPLE_PASS_TYPE_ID;
  try {
    await pool.query(
      "DELETE FROM apple_wallet_devices WHERE device_id = $1 AND pass_type_id = $2 AND serial_number = $3",
      [deviceId, effectivePassTypeId, serial]
    );
    return res.status(200).send();
  } catch (err) {
    console.error("Apple unregister device error:", err);
    return res.status(500).send();
  }
});

// POST /api/wallet/v1/log — Apple Wallet error log
app.post("/api/wallet/v1/log", (req, res) => {
  console.log("Apple Wallet log:", JSON.stringify(req.body));
  return res.status(200).send();
});

// GET /api/admin/wallet/notifications — latest wallet push/sync logs
app.get("/api/admin/wallet/notifications", adminMiddleware, async (req, res) => {
  try {
    const parsedLimit = Number(req.query.limit ?? 30);
    const limit = Math.min(120, Math.max(1, Number.isFinite(parsedLimit) ? parsedLimit : 30));
    const r = await pool.query(
      `SELECT l.*,
              u.display_name,
              u.email
         FROM wallet_notification_logs l
         LEFT JOIN users u ON u.id = l.user_id
        ORDER BY l.created_at DESC
        LIMIT $1`,
      [limit],
    );
    return res.json({ data: r.rows });
  } catch (err) {
    console.error("[Admin wallet notifications] error:", err.message);
    return res.status(500).json({ message: "Error obteniendo historial de notificaciones de Wallet" });
  }
});

// POST /api/admin/wallet/notify/:userId — force pass update notifications
app.post("/api/admin/wallet/notify/:userId", adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason = "manual_admin_notify" } = req.body || {};
    const result = await notifyWalletPassesUpdatedForUser(userId, { reason });
    return res.json({ data: result });
  } catch (err) {
    console.error("[Admin wallet notify] error:", err.message);
    return res.status(500).json({ message: "Error notificando wallet", detail: err.message });
  }
});

// ─── Routes: /api/videos ────────────────────────────────────────────────────

// GET /api/videos/categories
app.get("/api/videos/categories", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ct.id, ct.name, COUNT(v.id) AS video_count
       FROM class_types ct
       JOIN videos v ON v.class_type_id = ct.id AND v.is_published = true
       GROUP BY ct.id, ct.name
       ORDER BY ct.name`
    );
    return res.json({ data: r.rows });
  } catch (err) {
    console.error("Videos/categories error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/videos?search=&category=&limit=
app.get("/api/videos", authMiddleware, async (req, res) => {
  try {
    const { search = "", category = "", limit } = req.query;
    let query = `
      SELECT v.*,
             ct.name AS category_name,
             i.display_name AS instructor_name
      FROM videos v
      LEFT JOIN class_types ct ON v.class_type_id = ct.id
      LEFT JOIN instructors i ON v.instructor_id = i.id
      WHERE v.is_published = true
    `;
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (v.title ILIKE $${params.length} OR v.description ILIKE $${params.length})`;
    }
    if (category) {
      params.push(category);
      query += ` AND ct.id = $${params.length}`;
    }
    query += " ORDER BY v.is_featured DESC, v.sort_order ASC, v.created_at DESC";
    if (limit) { params.push(parseInt(limit)); query += ` LIMIT $${params.length}`; }
    const r = await pool.query(query, params);
    // Check membership access
    const memRes = await pool.query(
      "SELECT id FROM memberships WHERE user_id = $1 AND status = 'active' LIMIT 1",
      [req.userId]
    );
    const hasMembership = memRes.rows.length > 0;
    const rows = r.rows.map(v => {
      // Derive video_url from drive_file_id (proxy) if available
      let videoUrl = v.video_url;
      if (v.drive_file_id) {
        videoUrl = `/api/drive/video/${v.drive_file_id}`;
      } else if (videoUrl) {
        const m = videoUrl.match(/drive\.google\.com\/file\/d\/([^/]+)\/preview/);
        if (m) videoUrl = `/api/drive/video/${m[1]}`;
      }
      return { ...v, video_url: videoUrl, has_access: v.access_type === "free" || v.access_type === "gratuito" || hasMembership };
    });
    return res.json({ data: rows });
  } catch (err) {
    console.error("Videos error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/videos/:id
app.get("/api/videos/:id", authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT v.*,
              ct.name AS category_name,
              i.display_name AS instructor_name, i.bio AS instructor_bio
       FROM videos v
       LEFT JOIN class_types ct ON v.class_type_id = ct.id
       LEFT JOIN instructors i ON v.instructor_id = i.id
       WHERE v.id = $1 AND v.is_published = true`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ message: "Video no encontrado" });
    const video = r.rows[0];
    // Derive video_url from drive_file_id (proxy) if available
    if (video.drive_file_id) {
      video.video_url = `/api/drive/video/${video.drive_file_id}`;
    } else if (video.video_url) {
      const m = video.video_url.match(/drive\.google\.com\/file\/d\/([^\/]+)\/preview/);
      if (m) video.video_url = `/api/drive/video/${m[1]}`;
    }
    const memRes = await pool.query(
      "SELECT id FROM memberships WHERE user_id = $1 AND status = 'active' LIMIT 1",
      [req.userId]
    );
    const hasMembership = memRes.rows.length > 0;
    video.has_access = video.access_type === "free" || video.access_type === "gratuito" || hasMembership;
    // Log view
    await pool.query("UPDATE videos SET view_count = view_count + 1 WHERE id = $1", [req.params.id]);
    return res.json({ data: video });
  } catch (err) {
    console.error("Videos/:id error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/videos/:id/view
app.post("/api/videos/:id/view", authMiddleware, async (req, res) => {
  try {
    await pool.query("UPDATE videos SET view_count = view_count + 1 WHERE id = $1", [req.params.id]);
    return res.json({ ok: true });
  } catch { return res.json({ ok: true }); }
});

// POST /api/videos/:id/purchase
app.post("/api/videos/:id/purchase", authMiddleware, async (req, res) => {
  try {
    const vRes = await pool.query(
      "SELECT * FROM videos WHERE id = $1 AND is_published = true AND sales_enabled = true",
      [req.params.id]
    );
    if (vRes.rows.length === 0) return res.status(404).json({ message: "Video no disponible para compra" });
    const video = vRes.rows[0];
    const r = await pool.query(
      `INSERT INTO video_purchases (video_id, user_id, status, amount_mxn, payment_method)
       VALUES ($1, $2, 'pending_payment', $3, 'transfer')
       ON CONFLICT (video_id, user_id) DO UPDATE SET status = EXCLUDED.status
       RETURNING *`,
      [req.params.id, req.userId, video.sales_price_mxn]
    );
    const bankInfo = await getConfiguredBankInfo(pool);
    return res.status(201).json({
      data: {
        ...r.rows[0],
        bank_details: {
          ...bankInfo,
          amount: Number(video.sales_price_mxn || 0),
          currency: "MXN",
        },
      },
    });
  } catch (err) {
    console.error("Video/purchase error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/videos/purchases/:id/proof  (multipart)
app.post("/api/videos/purchases/:id/proof", authMiddleware, upload.single("proof"), async (req, res) => {
  try {
    await pool.query(
      "UPDATE video_purchases SET status = 'pending_verification', proof_uploaded_at = NOW() WHERE id = $1 AND user_id = $2",
      [req.params.id, req.userId]
    );
    return res.json({ message: "Comprobante recibido" });
  } catch (err) {
    console.error("Video/purchase proof error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Routes: /api/users ─────────────────────────────────────────────────────

// PUT /api/users/:id
app.put("/api/users/:id", authMiddleware, async (req, res) => {
  // Allow own profile edit OR admin editing any user
  try {
    const selfRes = await pool.query("SELECT role FROM users WHERE id = $1", [req.userId]);
    const callerRole = selfRes.rows[0]?.role || "client";
    const isAdminCaller = ["admin", "super_admin"].includes(callerRole);
    if (req.params.id !== req.userId && !isAdminCaller) {
      return res.status(403).json({ message: "Acceso denegado" });
    }
    const {
      displayName, phone, dateOfBirth, gender,
      emergencyContactName, emergencyContactPhone, healthNotes,
      receiveReminders, receivePromotions, receiveWeeklySummary,
      acceptsCommunications,
      pushReminders,
      role,
    } = req.body;
    // Non-admins cannot change role
    const newRole = isAdminCaller && role ? role : null;
    const targetId = req.params.id;
    const r = await pool.query(
      `UPDATE users SET
         display_name              = COALESCE($1, display_name),
         phone                     = COALESCE($2, phone),
         date_of_birth             = COALESCE($3, date_of_birth),
         emergency_contact_name    = COALESCE($4, emergency_contact_name),
         emergency_contact_phone   = COALESCE($5, emergency_contact_phone),
         health_notes              = COALESCE($6, health_notes),
         receive_reminders         = COALESCE($7, receive_reminders),
         receive_promotions        = COALESCE($8, receive_promotions),
         receive_weekly_summary    = COALESCE($9, receive_weekly_summary),
         accepts_communications    = COALESCE($10, accepts_communications),
         push_reminders            = COALESCE($11, push_reminders),
         role                      = COALESCE($12, role),
         gender                    = COALESCE($13, gender),
         updated_at                = NOW()
       WHERE id = $14
       RETURNING *`,
      [
        displayName || null, normalizePhoneForStorage(phone), dateOfBirth || null,
        emergencyContactName || null, emergencyContactPhone || null, healthNotes || null,
        receiveReminders ?? null, receivePromotions ?? null, receiveWeeklySummary ?? null,
        acceptsCommunications ?? null,
        pushReminders ?? null,
        newRole,
        gender || null,
        targetId,
      ]
    );
    return res.json({ user: mapUser(r.rows[0]) });
  } catch (err) {
    console.error("PUT users/:id error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Web Push: configuración y suscripciones ─────────────────────────────────
app.get("/api/push/config", (req, res) => {
  res.json({ enabled: isPushConfigured(), publicKey: getVapidPublicKey() });
});

app.post("/api/push/subscribe", authMiddleware, async (req, res) => {
  try {
    const { endpoint, keys } = req.body || {};
    const p256dh = keys?.p256dh;
    const auth = keys?.auth;
    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ message: "Suscripción inválida" });
    }
    const userAgent = String(req.headers["user-agent"] || "").slice(0, 255);
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, last_used_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             p256dh = EXCLUDED.p256dh,
             auth = EXCLUDED.auth,
             user_agent = EXCLUDED.user_agent,
             last_used_at = NOW()`,
      [req.userId, endpoint, p256dh, auth, userAgent]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/push/subscribe:", err.message);
    return res.status(500).json({ message: "Error interno" });
  }
});

app.post("/api/push/unsubscribe", authMiddleware, async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ message: "Falta endpoint" });
    await pool.query(
      "DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2",
      [endpoint, req.userId]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/push/unsubscribe:", err.message);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Routes: /api/referrals ─────────────────────────────────────────────────

// GET /api/referrals/code
app.get("/api/referrals/code", authMiddleware, async (req, res) => {
  try {
    let r = await pool.query(
      "SELECT * FROM referral_codes WHERE user_id = $1 LIMIT 1",
      [req.userId]
    );
    if (r.rows.length === 0) {
      const code = "OPH" + Math.random().toString(36).slice(2, 8).toUpperCase();
      r = await pool.query(
        "INSERT INTO referral_codes (user_id, code) VALUES ($1, $2) RETURNING *",
        [req.userId, code]
      );
    }
    return res.json({ data: r.rows[0] });
  } catch (err) {
    console.error("Referrals/code error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Routes: /api/admin/class-types ─────────────────────────────────────────

// GET /api/admin/class-types
app.get("/api/admin/class-types", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM class_types ORDER BY sort_order, name");
    return res.json({ data: camelRows(r.rows) });
  } catch (err) {
    console.error("GET admin/class-types error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/admin/class-types
app.post("/api/admin/class-types", adminMiddleware, async (req, res) => {
  const { name, subtitle, description, category, intensity, level, duration_min, capacity, color, emoji, sort_order } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: "name requerido" });
  try {
    const r = await pool.query(
      `INSERT INTO class_types (name, subtitle, description, category, intensity, level, duration_min, capacity, color, emoji, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [name.trim(), subtitle || null, description || null,
      category || "pilates", intensity || "media",
      level || "Todos los niveles", duration_min || 50, capacity || 10,
      color || "#c026d3", emoji || "🏃", sort_order ?? 0]
    );
    return res.status(201).json({ data: r.rows[0] });
  } catch (err) {
    console.error("POST admin/class-types error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// PUT /api/admin/class-types/:id
app.put("/api/admin/class-types/:id", adminMiddleware, async (req, res) => {
  const { name, subtitle, description, category, intensity, level, duration_min, capacity, color, emoji, is_active, sort_order } = req.body;
  try {
    const r = await pool.query(
      `UPDATE class_types SET
         name         = COALESCE($1, name),
         subtitle     = COALESCE($2, subtitle),
         description  = COALESCE($3, description),
         category     = COALESCE($4, category),
         intensity    = COALESCE($5, intensity),
         level        = COALESCE($6, level),
         duration_min = COALESCE($7, duration_min),
         capacity     = COALESCE($8, capacity),
         color        = COALESCE($9, color),
         emoji        = COALESCE($10, emoji),
         is_active    = COALESCE($11, is_active),
         sort_order   = COALESCE($12, sort_order),
         updated_at   = NOW()
       WHERE id = $13 RETURNING *`,
      [name || null, subtitle || null, description || null,
      category || null, intensity || null, level || null,
      duration_min || null, capacity || null, color || null,
      emoji || null, is_active ?? null, sort_order ?? null,
      req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ message: "No encontrado" });
    return res.json({ data: r.rows[0] });
  } catch (err) {
    console.error("PUT admin/class-types error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// DELETE /api/admin/class-types/:id
app.delete("/api/admin/class-types/:id", adminMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM class_types WHERE id = $1", [req.params.id]);
    return res.json({ message: "Eliminado" });
  } catch (err) {
    console.error("DELETE admin/class-types error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Routes: /api/admin/schedule-slots ──────────────────────────────────────

// GET /api/admin/schedule-slots
app.get("/api/admin/schedule-slots", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ss.*, ct.color as class_color, ct.emoji as class_emoji
       FROM schedule_slots ss
       LEFT JOIN class_types ct ON ss.class_type_id = ct.id
       WHERE ss.is_active = true
       ORDER BY ss.time_slot, ss.day_of_week`
    );
    return res.json({ data: r.rows });
  } catch (err) {
    console.error("GET admin/schedule-slots error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/admin/schedule-slots
app.post("/api/admin/schedule-slots", adminMiddleware, async (req, res) => {
  const { time_slot, day_of_week, class_type_id, class_type_name, instructor_name } = req.body;
  if (!time_slot?.trim() || !day_of_week) return res.status(400).json({ message: "time_slot y day_of_week requeridos" });
  try {
    // Resolve name from class_type_id if provided
    let ctName = class_type_name || null;
    if (class_type_id && !ctName) {
      const ct = await pool.query("SELECT name FROM class_types WHERE id = $1", [class_type_id]);
      ctName = ct.rows[0]?.name || null;
    }
    const r = await pool.query(
      `INSERT INTO schedule_slots (time_slot, day_of_week, class_type_id, class_type_name, instructor_name)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT ON CONSTRAINT idx_schedule_slots_slot DO UPDATE
         SET class_type_id = EXCLUDED.class_type_id,
             class_type_name = EXCLUDED.class_type_name,
             instructor_name = EXCLUDED.instructor_name
       RETURNING *`,
      [time_slot.trim(), parseInt(day_of_week), class_type_id || null, ctName, instructor_name || null]
    );
    return res.status(201).json({ data: r.rows[0] });
  } catch (err) {
    console.error("POST admin/schedule-slots error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// PUT /api/admin/schedule-slots/:id
app.put("/api/admin/schedule-slots/:id", adminMiddleware, async (req, res) => {
  const { time_slot, day_of_week, class_type_id, class_type_name, instructor_name, is_active } = req.body;
  try {
    let ctName = class_type_name || null;
    if (class_type_id && !ctName) {
      const ct = await pool.query("SELECT name FROM class_types WHERE id = $1", [class_type_id]);
      ctName = ct.rows[0]?.name || null;
    }
    const r = await pool.query(
      `UPDATE schedule_slots SET
         time_slot       = COALESCE($1, time_slot),
         day_of_week     = COALESCE($2, day_of_week),
         class_type_id   = COALESCE($3, class_type_id),
         class_type_name = COALESCE($4, class_type_name),
         instructor_name = COALESCE($5, instructor_name),
         is_active       = COALESCE($6, is_active)
       WHERE id = $7 RETURNING *`,
      [time_slot || null, day_of_week ? parseInt(day_of_week) : null,
      class_type_id || null, ctName, instructor_name || null, is_active ?? null, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ message: "No encontrado" });
    return res.json({ data: r.rows[0] });
  } catch (err) {
    console.error("PUT admin/schedule-slots error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// DELETE /api/admin/schedule-slots/:id
app.delete("/api/admin/schedule-slots/:id", adminMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM schedule_slots WHERE id = $1", [req.params.id]);
    return res.json({ message: "Eliminado" });
  } catch (err) {
    console.error("DELETE admin/schedule-slots error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Routes: /api/admin/plans (CRUD) ────────────────────────────────────────

// POST /api/admin/plans
app.post("/api/admin/plans", adminMiddleware, async (req, res) => {
  const {
    name, description, price, currency, duration_days, class_limit, class_category,
    features, is_active, sort_order, is_non_transferable, is_non_repeatable, repeat_key,
    discount_price, time_restriction,
  } = req.body;
  if (!name?.trim() || price === undefined) return res.status(400).json({ message: "name y price requeridos" });
  try {
    const validCats = ["reformer", "barre", "pilates", "bienestar", "funcional", "mixto", "all"];
    const cat = validCats.includes(class_category) ? class_category : "all";
    const nonTransferable = parseBooleanFlag(is_non_transferable);
    const nonRepeatable = parseBooleanFlag(is_non_repeatable);
    const safeRepeatKey = nonRepeatable ? String(repeat_key ?? "").trim() || null : null;
    const tr = sanitizeTimeRestriction(time_restriction);
    const r = await pool.query(
      `INSERT INTO plans
        (name, description, price, currency, duration_days, class_limit, class_category, features, is_active, sort_order, is_non_transferable, is_non_repeatable, repeat_key, discount_price, time_restriction)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [name.trim(), description || null, price, currency || "MXN",
      duration_days || 30, class_limit || null,
        cat, JSON.stringify(features || []), is_active ?? true, sort_order ?? 0, nonTransferable, nonRepeatable, safeRepeatKey,
        discount_price != null && discount_price !== "" ? parseFloat(discount_price) : null,
        tr ? JSON.stringify(tr) : null]
    );
    return res.status(201).json({ data: r.rows[0] });
  } catch (err) {
    console.error("POST admin/plans error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// PUT /api/admin/plans/:id
app.put("/api/admin/plans/:id", adminMiddleware, async (req, res) => {
  const {
    name, description, price, currency, duration_days, class_limit, class_category,
    features, is_active, sort_order, is_non_transferable, is_non_repeatable, repeat_key,
    discount_price, time_restriction,
  } = req.body;

  const validCats = ["pilates", "bienestar", "funcional", "mixto", "all"];
  const cat = validCats.includes(class_category) ? class_category : null;
  const nonTransferable = parseBooleanFlag(is_non_transferable);
  const nonRepeatable = parseBooleanFlag(is_non_repeatable);
  const safeRepeatKey = nonRepeatable ? String(repeat_key ?? "").trim() || null : null;
  // time_restriction: undefined = leave alone, null = clear, object = set/replace
  const trProvided = Object.prototype.hasOwnProperty.call(req.body, "time_restriction");
  const tr = trProvided ? sanitizeTimeRestriction(time_restriction) : undefined;

  // Transacción: el UPDATE del plan y la cascada de end_date deben ser atómicos
  // para evitar estado inconsistente (plan con duración nueva pero memberships
  // con vigencia vieja).
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `UPDATE plans SET
         name          = COALESCE($1, name),
         description   = COALESCE($2, description),
         price         = COALESCE($3, price),
         currency      = COALESCE($4, currency),
         duration_days = COALESCE($5, duration_days),
         class_limit   = $6,
         class_category= COALESCE($7, class_category),
         features      = COALESCE($8, features),
         is_active     = COALESCE($9, is_active),
         sort_order    = COALESCE($10, sort_order),
         is_non_transferable = COALESCE($11, is_non_transferable),
         is_non_repeatable   = COALESCE($12, is_non_repeatable),
         repeat_key          = CASE WHEN COALESCE($12, is_non_repeatable) = true THEN $13 ELSE NULL END,
         discount_price      = $14,
         time_restriction    = CASE WHEN $16::boolean THEN $15::jsonb ELSE time_restriction END,
         updated_at    = NOW()
       WHERE id = $17 RETURNING *`,
      [name || null, description || null, price ?? null, currency || null,
      duration_days || null, class_limit ?? null,
        cat, features ? JSON.stringify(features) : null,
      is_active ?? null, sort_order ?? null, nonTransferable, nonRepeatable, safeRepeatKey,
        discount_price != null && discount_price !== "" ? parseFloat(discount_price) : null,
        tr ? JSON.stringify(tr) : null,
        trProvided,
        req.params.id]
    );
    if (r.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "No encontrado" });
    }

    // Cascada de vigencia: si cambió duration_days, recalcular end_date
    // en memberships vivas del mismo plan. Excluye cancelled/expired para
    // no reabrir historial.
    let cascaded = 0;
    if (duration_days) {
      const cascade = await client.query(
        `UPDATE memberships
           SET end_date = (start_date::date + ($1::int || ' days')::interval)::date,
               updated_at = NOW()
         WHERE plan_id = $2
           AND start_date IS NOT NULL
           AND status IN ('active', 'paused', 'pending_payment', 'pending_activation')`,
        [duration_days, req.params.id]
      );
      cascaded = cascade.rowCount ?? 0;
    }

    await client.query("COMMIT");
    return res.json({ data: r.rows[0], cascadedMemberships: cascaded });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { }
    console.error("PUT admin/plans error:", err);
    return res.status(500).json({ message: "Error interno" });
  } finally {
    client.release();
  }
});

// DELETE /api/admin/plans/:id
// Default: soft delete (is_active = false).
// ?hard=true: borrado permanente, solo permitido si no tiene memberships asociadas.
app.delete("/api/admin/plans/:id", adminMiddleware, async (req, res) => {
  const hard = req.query.hard === "true";
  try {
    const existing = await pool.query("SELECT id FROM plans WHERE id = $1", [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: "Plan no encontrado" });
    }

    if (hard) {
      const ref = await pool.query(
        "SELECT COUNT(*)::int AS count FROM memberships WHERE plan_id = $1",
        [req.params.id]
      );
      const n = ref.rows[0]?.count ?? 0;
      if (n > 0) {
        return res.status(409).json({
          message: "No se puede eliminar permanentemente",
          detail: `El plan tiene ${n} suscripción(es) asociada(s). Desactívalo en su lugar.`,
          membershipsCount: n,
        });
      }
      // Aun con la verificación previa puede ocurrir TOCTOU si justo entre el
      // COUNT y el DELETE alguien crea una membership. La FK
      // `memberships.plan_id REFERENCES plans(id) ON DELETE RESTRICT` lo
      // protege a nivel de DB; aquí mapeamos el error a 409 con detalle.
      try {
        await pool.query("DELETE FROM plans WHERE id = $1", [req.params.id]);
      } catch (e) {
        if (e?.code === "23503") {
          return res.status(409).json({
            message: "No se puede eliminar permanentemente",
            detail: "El plan está referenciado por suscripciones (posiblemente creadas en este momento). Desactívalo en su lugar.",
          });
        }
        throw e;
      }
      return res.json({ message: "Plan eliminado permanentemente" });
    }

    await pool.query("UPDATE plans SET is_active = false WHERE id = $1", [req.params.id]);
    return res.json({ message: "Plan desactivado" });
  } catch (err) {
    console.error("DELETE admin/plans error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Routes: /api/admin/schedule (schedule_templates) ───────────────────────

// GET /api/admin/schedule
app.get("/api/admin/schedule", adminMiddleware, async (_req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM schedule_templates ORDER BY time_slot ASC, day_of_week ASC"
    );
    return res.json({ data: r.rows });
  } catch (err) {
    console.error("GET admin/schedule error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/admin/schedule
app.post("/api/admin/schedule", adminMiddleware, async (req, res) => {
  const { time_slot, day_of_week, class_label, shift } = req.body;
  if (!time_slot || !day_of_week || !class_label) {
    return res.status(400).json({ message: "time_slot, day_of_week y class_label requeridos" });
  }
  try {
    const r = await pool.query(
      `INSERT INTO schedule_templates (time_slot, day_of_week, class_label, shift)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (time_slot, day_of_week) DO UPDATE
         SET class_label = EXCLUDED.class_label, shift = EXCLUDED.shift, updated_at = NOW()
       RETURNING *`,
      [time_slot, Number(day_of_week), class_label.toUpperCase(), shift || "morning"]
    );
    return res.status(201).json({ data: r.rows[0] });
  } catch (err) {
    console.error("POST admin/schedule error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// PUT /api/admin/schedule/:id
app.put("/api/admin/schedule/:id", adminMiddleware, async (req, res) => {
  const { time_slot, day_of_week, class_label, shift, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE schedule_templates SET
         time_slot   = COALESCE($1, time_slot),
         day_of_week = COALESCE($2, day_of_week),
         class_label = COALESCE($3, class_label),
         shift       = COALESCE($4, shift),
         is_active   = COALESCE($5, is_active),
         updated_at  = NOW()
       WHERE id = $6 RETURNING *`,
      [time_slot || null, day_of_week ? Number(day_of_week) : null,
      class_label ? class_label.toUpperCase() : null,
      shift || null, is_active ?? null, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ message: "No encontrado" });
    return res.json({ data: r.rows[0] });
  } catch (err) {
    console.error("PUT admin/schedule error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// DELETE /api/admin/schedule/:id
app.delete("/api/admin/schedule/:id", adminMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM schedule_templates WHERE id = $1", [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE admin/schedule error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Routes: /api/packages ──────────────────────────────────────────────────

// GET /api/packages  (público — landing + checkout)
app.get("/api/packages", async (_req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM packages WHERE is_active = true ORDER BY category ASC, sort_order ASC"
    );
    return res.json({ data: r.rows });
  } catch (err) {
    console.error("GET packages error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/admin/packages
app.post("/api/admin/packages", adminMiddleware, async (req, res) => {
  const { name, num_classes, price, category, validity_days, sort_order } = req.body;
  if (!name?.trim() || !num_classes || price === undefined || !category) {
    return res.status(400).json({ message: "name, num_classes, price y category requeridos" });
  }
  try {
    const r = await pool.query(
      `INSERT INTO packages (name, num_classes, price, category, validity_days, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name.trim(), num_classes, Number(price), category, validity_days || 30, sort_order || 0]
    );
    return res.status(201).json({ data: r.rows[0] });
  } catch (err) {
    console.error("POST admin/packages error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// PUT /api/admin/packages/:id
app.put("/api/admin/packages/:id", adminMiddleware, async (req, res) => {
  const { name, num_classes, price, category, validity_days, is_active, sort_order } = req.body;
  try {
    const r = await pool.query(
      `UPDATE packages SET
         name          = COALESCE($1, name),
         num_classes   = COALESCE($2, num_classes),
         price         = COALESCE($3, price),
         category      = COALESCE($4, category),
         validity_days = COALESCE($5, validity_days),
         is_active     = COALESCE($6, is_active),
         sort_order    = COALESCE($7, sort_order),
         updated_at    = NOW()
       WHERE id = $8 RETURNING *`,
      [name || null, num_classes || null,
      price !== undefined ? Number(price) : null,
      category || null, validity_days ?? null,
      is_active ?? null, sort_order ?? null, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ message: "No encontrado" });
    return res.json({ data: r.rows[0] });
  } catch (err) {
    console.error("PUT admin/packages error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// DELETE /api/admin/packages/:id
app.delete("/api/admin/packages/:id", adminMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM packages WHERE id = $1", [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE admin/packages error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Routes: /api/admin (protected admin routes) ────────────────────────────

// GET /api/users/:id — get single user (admin)
app.get("/api/users/:id", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM users WHERE id = $1 AND COALESCE(is_hidden, false) = false", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ message: "Usuario no encontrado" });
    return res.json({ data: mapUser(r.rows[0]) });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// GET /api/class-types — public alias for admin/class-types
app.get("/api/class-types", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM class_types WHERE is_active = true ORDER BY sort_order ASC");
    return res.json({ data: camelRows(r.rows) });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// GET /api/public/instructors — public (no auth) active instructors for homepage
app.get("/api/public/instructors", async (_req, res) => {
  try {
    const r = await pool.query(
      "SELECT id, display_name, bio, specialties, photo_url, photo_focus_x, photo_focus_y, sort_order FROM instructors WHERE is_active = true ORDER BY sort_order ASC, created_at ASC"
    );
    return res.json({ data: camelRows(r.rows) });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// GET /api/public/review-tags — public (no auth) review tags for client review form
app.get("/api/public/review-tags", async (_req, res) => {
  try {
    const r = await pool.query("SELECT * FROM review_tags ORDER BY name");
    return res.json({ data: r.rows });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// POST /api/class-types — alias CRUD (admin)
app.post("/api/class-types", adminMiddleware, async (req, res) => {
  const { name, color, category, defaultDuration, maxCapacity, isActive } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: "name requerido" });
  const validCategories = ["reformer", "barre", "pilates", "bienestar", "funcional", "mixto", "all"];
  const cat = validCategories.includes(category) ? category : "reformer";
  try {
    const r = await pool.query(
      `INSERT INTO class_types (name, color, category, duration_min, capacity, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,0) RETURNING *`,
      [name.trim(), color || "#c026d3", cat, defaultDuration || 60, maxCapacity || 10, isActive !== false]
    );
    return res.status(201).json({ data: camelRow(r.rows[0]) });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// PUT /api/class-types/:id — alias CRUD (admin)
app.put("/api/class-types/:id", adminMiddleware, async (req, res) => {
  const { name, color, category, defaultDuration, maxCapacity, isActive } = req.body;
  const validCategories = ["reformer", "barre", "pilates", "bienestar", "funcional", "mixto", "all"];
  const cat = validCategories.includes(category) ? category : null;
  try {
    const r = await pool.query(
      `UPDATE class_types SET name=COALESCE($1,name), color=COALESCE($2,color),
       category=COALESCE($3,category),
       duration_min=COALESCE($4,duration_min), capacity=COALESCE($5,capacity),
       is_active=COALESCE($6,is_active), updated_at=NOW() WHERE id=$7 RETURNING *`,
      [name || null, color || null, cat, defaultDuration || null, maxCapacity || null, isActive ?? null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: "No encontrado" });
    return res.json({ data: camelRow(r.rows[0]) });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// DELETE /api/class-types/:id — alias CRUD (admin)
app.delete("/api/class-types/:id", adminMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM class_types WHERE id = $1", [req.params.id]);
    return res.json({ message: "Eliminado" });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// POST /api/classes — admin creates a class (alias)
app.post("/api/classes", adminMiddleware, async (req, res) => {
  try {
    const { classTypeId, instructorId, startTime, endTime, maxCapacity, capacity, notes } = req.body;
    if (!classTypeId) return res.status(400).json({ message: "classTypeId requerido" });
    if (!instructorId) return res.status(400).json({ message: "instructorId requerido" });

    // startTime may come as a full ISO/datetime-local string "YYYY-MM-DDTHH:mm"
    // The classes table uses separate DATE and TIME columns
    let dateStr, startTimeStr, endTimeStr;
    if (startTime && startTime.includes("T")) {
      const [d, t] = startTime.split("T");
      dateStr = d;
      startTimeStr = t.slice(0, 5); // "HH:mm"
    } else {
      return res.status(400).json({ message: "startTime debe ser datetime (YYYY-MM-DDTHH:mm)" });
    }
    if (endTime && endTime.includes("T")) {
      endTimeStr = endTime.split("T")[1].slice(0, 5);
    } else if (endTime && endTime.length === 5) {
      endTimeStr = endTime; // already "HH:mm"
    } else {
      // default +55 min
      const [h, m] = startTimeStr.split(":").map(Number);
      const total = h * 60 + m + 55;
      endTimeStr = String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
    }
    const cap = maxCapacity ?? capacity ?? 10;
    const r = await pool.query(
      `INSERT INTO classes (class_type_id, instructor_id, date, start_time, end_time, max_capacity, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled') RETURNING *`,
      [classTypeId, instructorId, dateStr, startTimeStr, endTimeStr, cap, notes || null]
    );
    return res.status(201).json({ data: r.rows[0] });
  } catch (err) { console.error("POST /classes error:", err); return res.status(500).json({ message: "Error interno" }); }
});

// PUT /api/classes/:id/cancel
app.put("/api/classes/:id/cancel", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query("UPDATE classes SET status='cancelled', updated_at=NOW() WHERE id=$1 RETURNING *", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ message: "Clase no encontrada" });
    return res.json({ data: r.rows[0] });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// DELETE /api/classes/week — clear classes in date range
app.delete("/api/classes/week", adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.body || {};
    const start = typeof startDate === "string" ? startDate.slice(0, 10) : null;
    const end = typeof endDate === "string" ? endDate.slice(0, 10) : null;

    if (!start || !end) {
      return res.status(400).json({ message: "startDate y endDate requeridos" });
    }
    if (start > end) {
      return res.status(400).json({ message: "Rango de fechas inválido" });
    }

    const activeBookingsRes = await pool.query(
      `SELECT COUNT(*)::INT AS total
       FROM bookings b
       JOIN classes c ON c.id = b.class_id
       WHERE c.date >= $1 AND c.date <= $2
         AND b.status != 'cancelled'`,
      [start, end]
    );
    const activeBookings = Number(activeBookingsRes.rows?.[0]?.total ?? 0);
    if (activeBookings > 0) {
      return res.status(409).json({
        message: "No se puede limpiar esta semana porque hay reservas activas.",
        activeBookings,
      });
    }

    const deleted = await pool.query(
      "DELETE FROM classes WHERE date >= $1 AND date <= $2 RETURNING id",
      [start, end]
    );
    return res.json({
      deleted: deleted.rowCount ?? deleted.rows.length,
      startDate: start,
      endDate: end,
    });
  } catch (err) {
    console.error("DELETE /classes/week error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

function toDbDateString(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function addMinutesToTimeString(timeValue, minutesToAdd) {
  const [hours, minutes] = String(timeValue || "00:00").split(":").map(Number);
  const totalMinutes = (hours * 60) + minutes + minutesToAdd;
  const normalizedMinutes = ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalizedMinutes / 60)).padStart(2, "0")}:${String(normalizedMinutes % 60).padStart(2, "0")}`;
}

function parseTimeSlotTo24Hour(timeValue) {
  const raw = String(timeValue || "").trim().toLowerCase();
  if (!raw) return null;

  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const meridiem = match[3];

  if (meridiem === "pm" && hours !== 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// POST /api/classes/generate — bulk generate
app.post("/api/classes/generate", adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, classTypeId, instructorId, daysOfWeek, startTime, endTime, maxCapacity = 10, focus } = req.body;
    // Etiqueta opcional de grupo muscular; vacío/ausente → NULL (el front usa el default por día).
    const focusVal = (typeof focus === "string" && focus.trim()) ? focus.trim() : null;
    if (!startDate || !endDate) return res.status(400).json({ message: "startDate y endDate requeridos" });
    if (!classTypeId) return res.status(400).json({ message: "classTypeId requerido" });
    if (!instructorId) return res.status(400).json({ message: "instructorId requerido" });
    if (!Array.isArray(daysOfWeek) || !daysOfWeek.length) return res.status(400).json({ message: "Selecciona al menos un día" });
    if (!/^\d{2}:\d{2}$/.test(String(startTime || "")) || !/^\d{2}:\d{2}$/.test(String(endTime || ""))) {
      return res.status(400).json({ message: "startTime y endTime deben tener formato HH:mm" });
    }

    const created = [];
    // Append T00:00:00 to parse as local midnight (not UTC)
    const start = new Date(startDate + "T00:00:00");
    const end = new Date(endDate + "T00:00:00");

    // If classTypeId + daysOfWeek provided → generate from form data
    if (classTypeId && Array.isArray(daysOfWeek) && daysOfWeek.length && startTime && endTime) {
      let skipped = 0;
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const jsDay = d.getDay(); // 0=Sun,1=Mon...
        if (!daysOfWeek.includes(jsDay)) continue;
        const classDate = toDbDateString(d);
        // Only treat ACTIVE classes as duplicates. Cancelled classes from past
        // edits should not block new generation at the same slot.
        const exists = await pool.query(
          `SELECT id FROM classes
            WHERE date = $1 AND start_time = $2 AND class_type_id = $3
              AND status <> 'cancelled'`,
          [classDate, startTime, classTypeId]
        );
        if (exists.rows.length) { skipped++; continue; }
        const r = await pool.query(
          `INSERT INTO classes (class_type_id, instructor_id, date, start_time, end_time, max_capacity, status, focus)
           VALUES ($1,$2,$3,$4,$5,$6,'scheduled',$7) RETURNING *`,
          [classTypeId, instructorId, classDate, startTime, endTime, maxCapacity, focusVal]
        );
        created.push(r.rows[0]);
      }
      return res.json({ created: created.length, skipped, data: created });
    }

    // Fallback: generate from schedule_templates
    const slotsRes = await pool.query("SELECT * FROM schedule_templates WHERE is_active = true");
    const classTypeRes = await pool.query("SELECT id, name, category FROM class_types WHERE is_active = true");
    const classTypes = classTypeRes.rows;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay();
      const daySlots = slotsRes.rows.filter(s => s.day_of_week === dayOfWeek);
      for (const slot of daySlots) {
        const startTimeValue = parseTimeSlotTo24Hour(slot.time_slot);
        if (!startTimeValue) continue;
        const classDate = toDbDateString(d);
        const endTimeValue = addMinutesToTimeString(startTimeValue, 55);
        const label = slot.class_label?.toLowerCase();
        let ct = classTypes.find(c => c.category?.toLowerCase() === label || c.name?.toLowerCase().includes(label));
        if (!ct) ct = classTypes[0];
        if (!ct) continue;
        const exists = await pool.query(
          "SELECT id FROM classes WHERE date = $1 AND start_time = $2 AND class_type_id = $3",
          [classDate, startTimeValue, ct.id]
        );
        if (exists.rows.length) continue;
        const r = await pool.query(
          `INSERT INTO classes (class_type_id, instructor_id, date, start_time, end_time, max_capacity, status)
           VALUES ($1,$2,$3,$4,$5,10,'scheduled') RETURNING *`,
          [ct.id, instructorId, classDate, startTimeValue, endTimeValue]
        );
        created.push(r.rows[0]);
      }
    }
    return res.json({ created: created.length, data: created });
  } catch (err) { console.error("generate classes error:", err); return res.status(500).json({ message: "Error interno" }); }
});

// ─── Schedules (schedule_slots) CRUD ────────────────────────────────────────

// GET /api/schedules
app.get("/api/schedules", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM schedule_slots ORDER BY day_of_week, time_slot");
    return res.json({ data: r.rows });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// POST /api/schedules
app.post("/api/schedules", adminMiddleware, async (req, res) => {
  try {
    const { timeSlot, dayOfWeek, classTypeName, classTypeId, instructorName, isActive = true } = req.body;
    if (!timeSlot || !dayOfWeek) return res.status(400).json({ message: "timeSlot y dayOfWeek requeridos" });
    const r = await pool.query(
      `INSERT INTO schedule_slots (time_slot, day_of_week, class_type_id, class_type_name, instructor_name, is_active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [timeSlot, dayOfWeek, classTypeId || null, classTypeName || null, instructorName || null, isActive]
    );
    return res.status(201).json({ data: r.rows[0] });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// PUT /api/schedules/:id
app.put("/api/schedules/:id", adminMiddleware, async (req, res) => {
  try {
    const { timeSlot, dayOfWeek, classTypeName, classTypeId, instructorName, isActive } = req.body;
    const r = await pool.query(
      `UPDATE schedule_slots SET time_slot=$1, day_of_week=$2, class_type_id=$3, class_type_name=$4, instructor_name=$5, is_active=$6
       WHERE id=$7 RETURNING *`,
      [timeSlot, dayOfWeek, classTypeId || null, classTypeName || null, instructorName || null, isActive !== false, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Slot no encontrado" });
    return res.json({ data: r.rows[0] });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// DELETE /api/schedules/:id
app.delete("/api/schedules/:id", adminMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM schedule_slots WHERE id = $1", [req.params.id]);
    return res.json({ message: "Slot eliminado" });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// POST /api/pos/checkout — alias for /pos/sale
app.post("/api/pos/checkout", adminMiddleware, async (req, res) => {
  try {
    const { userId, items, paymentMethod = "efectivo", discountCode } = req.body;
    const result = await processPosSale({ userId, items, paymentMethod, discountCode });
    if (result.error) {
      return res.status(result.error.status).json({ message: result.error.message });
    }
    return res.status(201).json({ data: result.data });
  } catch (err) {
    console.error("pos/checkout error:", err);
    const status = Number.isInteger(err?.status) ? err.status : 500;
    return res.status(status).json({ message: err?.message || "Error interno" });
  }
});

// ─── Loyalty config & rewards admin ─────────────────────────────────────────

// GET/PUT /api/loyalty/config
app.get("/api/loyalty/config", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query("SELECT value FROM settings WHERE key='loyalty_config' LIMIT 1");
    const defaults = { enabled: false, points_per_class: 10, points_per_peso: 1, welcome_bonus: 50, birthday_bonus: 100 };
    return res.json({ data: r.rows.length ? { ...defaults, ...r.rows[0].value } : defaults });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

app.put("/api/loyalty/config", adminMiddleware, async (req, res) => {
  try {
    // Strip referral_bonus if accidentally sent
    const { referral_bonus, pointsPerReferral, ...clean } = req.body;
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('loyalty_config', $1)
       ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
      [JSON.stringify(clean)]
    );
    invalidateSettingsCache("loyalty_config");
    return res.json({ data: clean });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// POST /api/loyalty/rewards — admin CRUD for loyalty rewards
app.post("/api/loyalty/rewards", adminMiddleware, async (req, res) => {
  try {
    const { name, description, points_cost, reward_type = "custom", reward_value = "", is_active = true, stock = null } = req.body;
    if (!name || !points_cost) return res.status(400).json({ message: "name y points_cost requeridos" });
    const r = await pool.query(
      "INSERT INTO loyalty_rewards (name, description, points_cost, reward_type, reward_value, stock, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [name, description || null, points_cost, reward_type, reward_value || null, stock || null, is_active]
    );
    return res.status(201).json({ data: r.rows[0] });
  } catch (err) { console.error("loyalty rewards POST:", err); return res.status(500).json({ message: "Error interno" }); }
});

app.put("/api/loyalty/rewards/:id", adminMiddleware, async (req, res) => {
  try {
    const { name, description, points_cost, reward_type, reward_value, stock, is_active } = req.body;
    const r = await pool.query(
      "UPDATE loyalty_rewards SET name=$1, description=$2, points_cost=$3, reward_type=$4, reward_value=$5, stock=$6, is_active=$7 WHERE id=$8 RETURNING *",
      [name, description || null, points_cost, reward_type || "custom", reward_value || null, stock || null, is_active !== false, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Recompensa no encontrada" });
    return res.json({ data: r.rows[0] });
  } catch (err) { console.error("loyalty rewards PUT:", err); return res.status(500).json({ message: "Error interno" }); }
});

app.delete("/api/loyalty/rewards/:id", adminMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM loyalty_rewards WHERE id=$1", [req.params.id]);
    return res.json({ message: "Recompensa eliminada" });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// GET /api/loyalty/points/:userId
app.get("/api/loyalty/points/:userId", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT COALESCE(SUM(CASE WHEN type='earn' OR type='adjust' THEN points ELSE -points END),0) AS balance FROM loyalty_transactions WHERE user_id=$1",
      [req.params.userId]
    );
    return res.json({ data: { balance: parseInt(r.rows[0].balance) } });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// ─── Reports sub-routes ──────────────────────────────────────────────────────

app.get("/api/reports/overview", adminMiddleware, async (req, res) => {
  try {
    // Compute month start in CDMX so reports align with how the studio counts
    // the month (avoids off-by-one on the 1st when server runs in UTC).
    const monthStartExpr = `date_trunc('month', NOW() AT TIME ZONE 'America/Mexico_City')`;

    // Cada query se aísla con su propio catch para que una columna/tabla
    // ausente en prod no tumbe el endpoint completo. Cualquier fallo se
    // loggea (visible en Railway) y la métrica afectada cae a 0.
    const safe = async (label, q) => {
      try { return await q; }
      catch (e) {
        console.error(`[reports/overview] ${label} failed:`, e.message);
        return null;
      }
    };

    const [members, revenue, bookings, classes, newMembers, reviews] = await Promise.all([
      safe("members",    pool.query("SELECT COUNT(*) FROM memberships WHERE status='active'")),
      safe("revenue",    pool.query(
        `SELECT COALESCE(SUM(total_amount),0) AS total
           FROM orders
          WHERE status='approved' AND created_at >= ${monthStartExpr}`
      )),
      safe("bookings",   pool.query(
        `SELECT COUNT(*) AS total,
                COUNT(CASE WHEN status='checked_in' THEN 1 END) AS attended
           FROM bookings
          WHERE status <> 'cancelled'
            AND created_at >= ${monthStartExpr}`
      )),
      safe("classes",    pool.query(
        `SELECT COUNT(*) FROM classes
          WHERE status='scheduled'
            AND date >= (${monthStartExpr})::date`
      )),
      safe("newMembers", pool.query(
        `SELECT COUNT(*) FROM users
          WHERE role='client' AND COALESCE(is_hidden,false)=false AND created_at >= ${monthStartExpr}`
      )),
      safe("reviews",    pool.query(
        `SELECT COUNT(*) AS total,
                COUNT(CASE WHEN is_approved = false THEN 1 END) AS pending,
                COALESCE(AVG(rating),0) AS average
           FROM reviews
          WHERE created_at >= ${monthStartExpr}`
      )),
    ]);

    const monthlyBookings = parseInt(bookings?.rows?.[0]?.total || 0);
    const attended = parseInt(bookings?.rows?.[0]?.attended || 0);
    const classOccupancyRate = monthlyBookings > 0
      ? Number(((attended / monthlyBookings) * 100).toFixed(1))
      : 0;

    return res.json({
      data: {
        activeMembers:        parseInt(members?.rows?.[0]?.count || 0),
        monthlyRevenue:       parseFloat(revenue?.rows?.[0]?.total || 0),
        monthlyBookings,
        upcomingClasses:      parseInt(classes?.rows?.[0]?.count || 0),
        classOccupancyRate,
        newMembersThisMonth:  parseInt(newMembers?.rows?.[0]?.count || 0),
        churnRate: 0,
        reviewsTotal:         parseInt(reviews?.rows?.[0]?.total || 0),
        reviewsPending:       parseInt(reviews?.rows?.[0]?.pending || 0),
        reviewsAverage: Number(parseFloat(reviews?.rows?.[0]?.average || 0).toFixed(1)),
      }
    });
  } catch (err) {
    console.error("Reports/overview error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

app.get("/api/reports/revenue", adminMiddleware, async (req, res) => {
  // Acepta rango opcional ?from=YYYY-MM-DD&to=YYYY-MM-DD.
  // Si rango ≤ 92 días → buckets diarios, si no → mensuales.
  // Sin rango → comportamiento legacy (12 meses).
  const { from, to } = req.query;
  const isValidIso = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  try {
    if (isValidIso(from) && isValidIso(to)) {
      const fromD = new Date(`${from}T00:00:00`);
      const toD   = new Date(`${to}T00:00:00`);
      const days  = Math.max(1, Math.round((toD - fromD) / 86_400_000) + 1);
      const useDaily = days <= 92;
      const trunc = useDaily ? "day" : "month";
      const r = await pool.query(
        `WITH buckets AS (
           SELECT generate_series(
             DATE_TRUNC($3, $1::date),
             DATE_TRUNC($3, $2::date),
             ('1 ' || $3)::interval
           ) AS bucket_start
         ),
         orders_by_bucket AS (
           SELECT DATE_TRUNC($3, (created_at AT TIME ZONE 'America/Mexico_City')) AS bucket_start,
                  COALESCE(SUM(total_amount), 0) AS total,
                  COUNT(*) AS count
             FROM orders
            WHERE status = 'approved'
              AND (created_at AT TIME ZONE 'America/Mexico_City') >= $1::date
              AND (created_at AT TIME ZONE 'America/Mexico_City') <  ($2::date + INTERVAL '1 day')
            GROUP BY 1
         )
         SELECT b.bucket_start AS month,
                COALESCE(o.total, 0) AS amount,
                COALESCE(o.count, 0) AS count
           FROM buckets b
           LEFT JOIN orders_by_bucket o ON o.bucket_start = b.bucket_start
          ORDER BY b.bucket_start ASC`,
        [from, to, trunc]
      );
      return res.json({ data: r.rows, granularity: trunc });
    }

    const r = await pool.query(
      `WITH months AS (
         SELECT DATE_TRUNC('month', CURRENT_DATE) - (INTERVAL '1 month' * gs.n) AS month_start
         FROM generate_series(0, 11) AS gs(n)
       ),
       orders_by_month AS (
         SELECT DATE_TRUNC('month', created_at) AS month_start,
                COALESCE(SUM(total_amount), 0) AS total,
                COUNT(*) AS count
           FROM orders
          WHERE status = 'approved'
          GROUP BY 1
       )
       SELECT m.month_start AS month,
              COALESCE(o.total, 0) AS amount,
              COALESCE(o.count, 0) AS count
         FROM months m
         LEFT JOIN orders_by_month o ON o.month_start = m.month_start
        ORDER BY m.month_start ASC`
    );
    return res.json({ data: r.rows, granularity: "month" });
  } catch (err) {
    console.error("Reports/revenue error:", err);
    const months = Array.from({ length: 12 }).map((_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - (11 - i));
      d.setDate(1);
      return { month: d.toISOString(), amount: 0, count: 0 };
    });
    return res.json({ data: months, granularity: "month" });
  }
});

app.get("/api/reports/classes", adminMiddleware, async (req, res) => {
  try {
    // Top class types by ACTIVE bookings (excludes cancelled, since those
    // never happened from a business standpoint).
    const r = await pool.query(
      `SELECT ct.name,
              COUNT(b.id)::INT AS bookings,
              COUNT(CASE WHEN b.status='checked_in' THEN 1 END)::INT AS attended
         FROM classes c
         JOIN class_types ct ON c.class_type_id = ct.id
         LEFT JOIN bookings b
           ON b.class_id = c.id
          AND b.status <> 'cancelled'
        GROUP BY ct.name
       HAVING COUNT(b.id) > 0
        ORDER BY bookings DESC
        LIMIT 10`
    );
    return res.json({ data: camelRows(r.rows) });
  } catch (err) {
    console.error("Reports/classes error:", err);
    return res.json({ data: [] });
  }
});

app.get("/api/reports/retention", adminMiddleware, async (req, res) => {
  try {
    // "newThisMonth" was using a rolling 30-day window which contradicted
    // the rest of the dashboard (calendar-month basis). Align it.
    const r = await pool.query(
      `SELECT COUNT(*) AS total,
              COUNT(CASE
                WHEN created_at >= date_trunc('month', NOW() AT TIME ZONE 'America/Mexico_City')
                THEN 1
              END) AS new_this_month
         FROM users
        WHERE role='client' AND COALESCE(is_hidden,false)=false`
    );
    return res.json({ data: camelRow(r.rows[0]) });
  } catch (err) {
    console.error("Reports/retention error:", err);
    return res.json({ data: { total: 0, newThisMonth: 0 } });
  }
});

app.get("/api/reports/instructors", adminMiddleware, async (req, res) => {
  try {
    // Active bookings only; instructors with zero classes hidden by HAVING.
    const r = await pool.query(
      `SELECT i.id,
              i.display_name AS name,
              COUNT(DISTINCT c.id)::INT AS class_count,
              COUNT(b.id) FILTER (WHERE b.status <> 'cancelled')::INT AS total_students
         FROM instructors i
         LEFT JOIN classes  c ON c.instructor_id = i.id
         LEFT JOIN bookings b ON b.class_id = c.id
        GROUP BY i.id, i.display_name
       HAVING COUNT(DISTINCT c.id) > 0
        ORDER BY class_count DESC`
    );
    return res.json({ data: camelRows(r.rows) });
  } catch (err) {
    console.error("Reports/instructors error:", err);
    return res.json({ data: [] });
  }
});

// GET /api/reports/totalpass — métricas del convenio TotalPass (walk-in)
app.get("/api/reports/totalpass", adminMiddleware, async (req, res) => {
  try {
    const monthStartExpr = `date_trunc('month', NOW() AT TIME ZONE 'America/Mexico_City')`;
    // Bookings ligados a una orden cuyo plan_id es TotalPass (cualquier
    // variante del nombre, por si en el futuro hay TotalPass 200 etc.).
    const sql = `
      WITH tp_plans AS (
        SELECT id FROM plans WHERE LOWER(name) LIKE 'totalpass%'
      ),
      tp_orders AS (
        SELECT o.id, o.total_amount, o.created_at, o.guest_phone, o.guest_name, o.user_id
          FROM orders o
         WHERE o.status = 'approved'
           AND o.plan_id IN (SELECT id FROM tp_plans)
      ),
      tp_bookings AS (
        SELECT b.id AS booking_id,
               b.created_at AS b_created,
               b.status,
               b.user_id,
               b.guest_phone,
               b.guest_name,
               b.order_id,
               o.total_amount
          FROM bookings b
          JOIN tp_orders o ON o.id = b.order_id
         WHERE b.status <> 'cancelled'
      )
      SELECT
        (SELECT COUNT(*) FROM tp_orders)                                     AS orders_total,
        (SELECT COUNT(*) FROM tp_orders WHERE created_at >= ${monthStartExpr}) AS orders_month,
        (SELECT COALESCE(SUM(total_amount),0) FROM tp_orders)                AS revenue_total,
        (SELECT COALESCE(SUM(total_amount),0) FROM tp_orders WHERE created_at >= ${monthStartExpr}) AS revenue_month,
        (SELECT COUNT(*) FROM tp_bookings)                                   AS bookings_total,
        (SELECT COUNT(*) FROM tp_bookings WHERE b_created >= ${monthStartExpr}) AS bookings_month,
        (SELECT COUNT(DISTINCT COALESCE(user_id::text, NULLIF(guest_phone,''), NULLIF(guest_name,''))) FROM tp_bookings) AS unique_clients,
        (SELECT COUNT(DISTINCT COALESCE(user_id::text, NULLIF(guest_phone,''), NULLIF(guest_name,'')))
           FROM tp_bookings WHERE b_created >= ${monthStartExpr})            AS unique_clients_month
    `;
    const r = await pool.query(sql);
    const row = r.rows[0] || {};
    // Top 10 clientas TotalPass (por bookings totales)
    const top = await pool.query(`
      WITH tp_plans AS (SELECT id FROM plans WHERE LOWER(name) LIKE 'totalpass%')
      SELECT
        COALESCE(u.display_name, b.guest_name, 'Invitada') AS name,
        COALESCE(u.email, '')                              AS email,
        COALESCE(NULLIF(b.guest_phone,''), u.phone, '')    AS phone,
        COUNT(b.id)::INT                                   AS bookings,
        MAX(b.created_at)                                  AS last_visit
        FROM bookings b
        JOIN orders o ON o.id = b.order_id AND o.plan_id IN (SELECT id FROM tp_plans)
        LEFT JOIN users u ON u.id = b.user_id
       WHERE b.status <> 'cancelled'
       GROUP BY u.display_name, b.guest_name, u.email, b.guest_phone, u.phone
       ORDER BY bookings DESC, last_visit DESC
       LIMIT 10
    `);
    return res.json({
      data: {
        ordersTotal:        parseInt(row.orders_total || 0),
        ordersMonth:        parseInt(row.orders_month || 0),
        revenueTotal:       parseFloat(row.revenue_total || 0),
        revenueMonth:       parseFloat(row.revenue_month || 0),
        bookingsTotal:      parseInt(row.bookings_total || 0),
        bookingsMonth:      parseInt(row.bookings_month || 0),
        uniqueClients:      parseInt(row.unique_clients || 0),
        uniqueClientsMonth: parseInt(row.unique_clients_month || 0),
        top: top.rows.map(camelRow),
      },
    });
  } catch (err) {
    console.error("Reports/totalpass error:", err.message);
    return res.json({
      data: {
        ordersTotal: 0, ordersMonth: 0,
        revenueTotal: 0, revenueMonth: 0,
        bookingsTotal: 0, bookingsMonth: 0,
        uniqueClients: 0, uniqueClientsMonth: 0,
        top: [],
      },
    });
  }
});

// ─── Reviews public endpoints & admin ───────────────────────────────────────

// GET /api/reviews (public, approved only; admin sees all via /api/admin/reviews)
app.get("/api/reviews", async (req, res) => {
  try {
    const { limit = 50, approved } = req.query;
    let q = `SELECT rv.*, u.display_name AS user_name FROM reviews rv LEFT JOIN users u ON rv.user_id=u.id WHERE 1=1`;
    const params = [];
    if (approved !== "false") { q += ` AND rv.is_approved=true`; }
    params.push(parseInt(limit)); q += ` ORDER BY rv.created_at DESC LIMIT $${params.length}`;
    const r = await pool.query(q, params);
    return res.json({ data: r.rows });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// GET /api/reviews/stats
app.get("/api/reviews/stats", async (req, res) => {
  try {
    const r = await pool.query("SELECT AVG(rating) AS average, COUNT(*) AS total FROM reviews WHERE is_approved=true");
    const dist = await pool.query("SELECT rating, COUNT(*) FROM reviews WHERE is_approved=true GROUP BY rating ORDER BY rating DESC");
    return res.json({ data: { average: parseFloat(r.rows[0].average || 0).toFixed(1), total: parseInt(r.rows[0].total), distribution: dist.rows } });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// Review tags (admin)
app.get("/api/review-tags", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM review_tags ORDER BY name").catch(() => ({ rows: [] }));
    return res.json({ data: r.rows });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

app.post("/api/review-tags", adminMiddleware, async (req, res) => {
  try {
    const { name, color } = req.body;
    const r = await pool.query(
      "INSERT INTO review_tags (name, color) VALUES ($1,$2) RETURNING *",
      [name, color || "#c026d3"]
    ).catch(() => ({ rows: [{ id: "1", name, color }] }));
    return res.status(201).json({ data: r.rows[0] });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

app.put("/api/review-tags/:id", adminMiddleware, async (req, res) => {
  try {
    const { name, color } = req.body;
    const r = await pool.query(
      "UPDATE review_tags SET name=$1, color=$2 WHERE id=$3 RETURNING *",
      [name, color || "#c026d3", req.params.id]
    ).catch(() => ({ rows: [{ id: req.params.id, name, color }] }));
    return res.json({ data: r.rows[0] });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

app.delete("/api/review-tags/:id", adminMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM review_tags WHERE id=$1", [req.params.id]).catch(() => { });
    return res.json({ message: "Tag eliminado" });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// ─── Referrals admin ─────────────────────────────────────────────────────────

// GET /api/referrals/codes — all codes (admin)
app.get("/api/referrals/codes", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT rc.*, u.display_name AS user_name, u.email, rc.uses_count
       FROM referral_codes rc LEFT JOIN users u ON rc.user_id=u.id
       ORDER BY rc.uses_count DESC`
    );
    return res.json({ data: r.rows });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// GET /api/referrals — referral history
app.get("/api/referrals", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT r.*, rc.code, u.display_name AS referred_name
       FROM referrals r
       JOIN referral_codes rc ON r.referral_code_id=rc.id
       LEFT JOIN users u ON r.referred_user_id=u.id
       ORDER BY r.created_at DESC LIMIT 100`
    );
    return res.json({ data: r.rows });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// GET /api/referrals/stats
app.get("/api/referrals/stats", adminMiddleware, async (req, res) => {
  try {
    const [total, rewarded] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM referrals"),
      pool.query("SELECT COUNT(*) FROM referrals WHERE rewarded=true"),
    ]);
    return res.json({ data: { total: parseInt(total.rows[0].count), rewarded: parseInt(rewarded.rows[0].count) } });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// ─── Settings ────────────────────────────────────────────────────────────────

const PUBLIC_SETTINGS_KEYS = new Set([
  "policies_settings",
  "cancellation_settings",
]);

// ─── Settings cache (in-memory, TTL-based, invalidated on write) ────────────
const SETTINGS_CACHE_TTL_MS = 60_000; // 1 minute
const settingsCache = new Map(); // key → { value, expiresAt }

function invalidateSettingsCache(key) {
  if (key) { settingsCache.delete(key); } else { settingsCache.clear(); }
}

async function getSettingValueWithDefaults(key) {
  const cached = settingsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return mergeSettingsWithDefaults(key, cached.value);
  }
  const r = await pool.query("SELECT value FROM settings WHERE key=$1", [key]);
  const raw = r.rows.length ? r.rows[0].value : null;
  settingsCache.set(key, { value: raw, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS });
  return mergeSettingsWithDefaults(key, raw);
}

async function getCancellationConfig() {
  return /** @type {typeof DEFAULT_CANCELLATION_SETTINGS} */ (
    await getSettingValueWithDefaults("cancellation_settings")
  );
}

app.get("/api/public/settings/:key", async (req, res) => {
  try {
    const { key } = req.params;
    if (!PUBLIC_SETTINGS_KEYS.has(key)) {
      return res.status(403).json({ message: "Configuración no pública" });
    }
    const value = await getSettingValueWithDefaults(key);
    return res.json({ data: value });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

app.get("/api/settings/:key", adminMiddleware, async (req, res) => {
  try {
    const value = await getSettingValueWithDefaults(req.params.key);
    return res.json({ data: value });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

app.put("/api/settings/:key", adminMiddleware, async (req, res) => {
  try {
    const { value } = req.body;
    if (value === undefined) {
      return res.status(400).json({ message: "Falta `value` en el body" });
    }
    const merged = mergeSettingsWithDefaults(req.params.key, value);
    await pool.query(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()",
      [req.params.key, JSON.stringify(merged)]
    );
    invalidateSettingsCache(req.params.key);
    return res.json({ data: { key: req.params.key, value: merged } });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// ─── Membership date helper ──────────────────────────────────────────────────
// Adds N months (calendar-based) to a YYYY-MM-DD string.
// e.g. addMonths("2026-03-24", 1) → "2026-04-24"
// Handles month-end: addMonths("2026-01-31", 1) → "2026-02-28"
function addMonths(dateStr, months) {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // If the day overflowed (e.g. Jan 31 → Mar 3), clamp to last day of target month
  if (d.getDate() !== day) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

// Calcula la fecha de fin de vigencia de la membresía.
// Paquetes / clase suelta / clase extra (duration_days <= 31) → VIGENCIA POR
// DÍAS CORRIDOS desde la compra (decidido 2026-06-28): p.ej. un paquete de 30
// días comprado el 30-jun vence el 30-jul. No acumulable. La reserva se valida
// contra esta fecha (selectMembershipForClass + reschedule).
// Planes de largo plazo (p.ej. Inscripción 3650d) → meses de calendario.
function calcMembershipEndDate(startStr, plan) {
  // Los PAQUETES de clases (>=2 clases) vencen al FIN DEL MES de compra; pero
  // las compras del día 26 en adelante vencen al fin del mes SIGUIENTE (gracia,
  // para que a quien compra a fin de mes no le queden 1-2 días). Los cargos
  // sueltos (1 clase) y la inscripción conservan su vigencia por días.
  const classLimit = Number(plan.class_limit ?? plan.classLimit ?? 0);
  if (classLimit >= 2) {
    const [y, m, d] = String(startStr).split("-").map(Number);
    if (d <= 25) return endOfPurchaseMonth(startStr);
    const ny = m === 12 ? y + 1 : y;       // del 26 en adelante → mes siguiente
    const nm = m === 12 ? 1 : m + 1;
    return endOfPurchaseMonth(`${ny}-${String(nm).padStart(2, "0")}-01`);
  }
  const days = plan.duration_days || 30;
  if (days <= 31) {
    const d = new Date(startStr + "T12:00:00");
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
  const months = Math.max(1, Math.round(days / 30));
  return addMonths(startStr, months);
}

// ─── Evolution API (WhatsApp) ─────────────────────────────────────────────────

// Helper: normalise phone to WhatsApp format (521XXXXXXXXXX for MX)
function normalisePhone(raw) {
  let phone = String(raw).replace(/\D/g, "");
  if (phone.startsWith("52") && phone.length === 12) return phone;
  if (phone.length === 10) return "52" + phone;
  return phone;
}

// Helper: normalise phone for DB storage (+52XXXXXXXXXX for MX)
function normalizePhoneForStorage(raw) {
  if (!raw) return null;
  let phone = String(raw).trim().replace(/[\s\-()]/g, "");
  if (phone.startsWith("+")) return phone; // already has country code
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return "+52" + digits;
  if (digits.length === 12 && digits.startsWith("52")) return "+" + digits;
  return phone; // return as-is if unrecognized format
}

// Anti-bloqueo: separación base entre WhatsApps (configurable). Con el jitter de
// abajo, el espaciado real queda ~3.5–7 s aleatorio entre mensajes (más humano).
const EVOLUTION_SEND_DELAY_MS = Number(process.env.EVOLUTION_SEND_DELAY_MS || 3500);
let evolutionSendQueue = Promise.resolve();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isEvolutionConfigured() {
  return Boolean(EVOLUTION_API_URL && EVOLUTION_API_KEY);
}

async function sendWhatsAppNow(number, text) {
  if (!isEvolutionConfigured()) {
    console.log("[WhatsApp] Skipped — Evolution API not configured");
    return { skipped: true };
  }
  const payload = { number, text };
  return evolutionApi.post(`/message/sendText/${EVOLUTION_INSTANCE}`, payload);
}

function queueWhatsAppSend(number, text) {
  const run = evolutionSendQueue.then(async () => {
    // Jitter amplio (hasta ~el delay base) para que el ritmo no sea constante.
    const jitter = Math.floor(Math.random() * Math.max(1000, EVOLUTION_SEND_DELAY_MS));
    return sendWhatsAppNow(number, text).finally(async () => {
      await sleep(Math.max(1500, EVOLUTION_SEND_DELAY_MS + jitter));
    });
  });
  // Keep queue alive even if one send fails
  evolutionSendQueue = run.catch(() => { });
  return run;
}

async function getSettingsValue(key, fallback = null) {
  try {
    const cached = settingsCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value ?? fallback;
    }
    const r = await pool.query("SELECT value FROM settings WHERE key = $1 LIMIT 1", [key]);
    const raw = r.rows.length ? r.rows[0].value : null;
    settingsCache.set(key, { value: raw, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS });
    return raw ?? fallback;
  } catch (_) {
    return fallback;
  }
}

function renderTemplateVars(template, vars = {}) {
  if (typeof template !== "string" || !template.trim()) return "";
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key) => {
    const value = vars[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

// ── Anti-bloqueo de Evolution: SOLO estos eventos salen por WhatsApp ──────────
// Evolution es WhatsApp NO oficial y banea por volumen. Mantener la lista mínima
// protege el número. El resto de notificaciones sigue saliendo por email/push,
// pero NO por WhatsApp.
const WHATSAPP_ALLOWED_TEMPLATES = new Set([
  "class_reminder_12h",        // recordatorio 12 h antes
  "class_reminder_30m",        // recordatorio 30 min antes
  "booking_waitlist_promoted", // se liberó tu lugar y quedaste confirmada
]);

async function sendConfiguredWhatsAppTemplate({ templateKey, phone, vars = {}, fallbackMessage = "" }) {
  if (!phone) return { sent: false, reason: "no_phone" };
  // Whitelist: cualquier evento fuera de la lista NO se envía por WhatsApp.
  if (!WHATSAPP_ALLOWED_TEMPLATES.has(templateKey)) {
    return { sent: false, reason: "not_in_whatsapp_whitelist" };
  }
  const notificationSettings = await getSettingsValue("notification_settings", DEFAULT_NOTIFICATION_SETTINGS);
  if (notificationSettings?.whatsapp_reminders === false) {
    return { sent: false, reason: "whatsapp_disabled" };
  }
  const templates = await getSettingsValue("notification_templates", DEFAULT_NOTIFICATION_TEMPLATES);
  const templateBody = templates?.[templateKey]?.body || "";
  const rendered = renderTemplateVars(templateBody, vars).trim();
  const text = rendered || String(fallbackMessage || "").trim();
  if (!text) return { sent: false, reason: "empty_message" };
  await queueWhatsAppSend(normalisePhone(phone), text);
  return { sent: true };
}

// URL a abrir al tocar la notificación, por tipo de evento.
const PUSH_TEMPLATE_URLS = {
  booking_confirmed: "/app/bookings",
  booking_waitlist: "/app/bookings",
  booking_waitlist_promoted: "/app/bookings",
  booking_cancelled: "/app/bookings",
  membership_activated: "/app",
  transfer_rejected: "/app/orders",
  last_class_reminder: "/app",
};

// Fan-out a todas las suscripciones de una alumna. Best-effort: poda muertas,
// nunca lanza (no debe romper reserva/pago/cron).
async function sendPushToUser(userId, { title, body, url = "/", tag, respectPrefs = true } = {}) {
  if (!isPushConfigured() || !userId) return { sent: 0, failed: 0, pruned: 0 };
  try {
    if (respectPrefs) {
      const pref = await pool.query("SELECT push_reminders FROM users WHERE id = $1", [userId]);
      if (pref.rows[0] && pref.rows[0].push_reminders === false) {
        return { sent: 0, failed: 0, pruned: 0, reason: "push_disabled" };
      }
    }
    const subs = await pool.query(
      "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1",
      [userId]
    );
    if (!subs.rows.length) return { sent: 0, failed: 0, pruned: 0 };
    const payload = buildPushPayload({ title, body, url, tag });
    let sent = 0, failed = 0, pruned = 0;
    for (const row of subs.rows) {
      const subscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
      try {
        await sendWebPush(subscription, payload);
        sent++;
        pool.query("UPDATE push_subscriptions SET last_used_at = NOW() WHERE id = $1", [row.id]).catch(() => { });
      } catch (err) {
        if (shouldPruneSubscription(err)) {
          pruned++;
          pool.query("DELETE FROM push_subscriptions WHERE id = $1", [row.id]).catch(() => { });
        } else {
          failed++;
          console.error("[Push] send error:", err?.statusCode || err?.message);
        }
      }
    }
    return { sent, failed, pruned };
  } catch (e) {
    console.error("[sendPushToUser]", e.message);
    return { sent: 0, failed: 0, pruned: 0 };
  }
}

// Versión que reutiliza las plantillas de notificación (subject→title, body→body).
async function sendConfiguredPushTemplate({ templateKey, userId, vars = {}, urlPath } = {}) {
  if (!isPushConfigured() || !userId) return { sent: 0 };
  const templates = await getSettingsValue("notification_templates", DEFAULT_NOTIFICATION_TEMPLATES);
  const tpl = templates?.[templateKey] || DEFAULT_NOTIFICATION_TEMPLATES[templateKey];
  if (!tpl) return { sent: 0 };
  const title = renderTemplateVars(tpl.subject || "Tu Espacio Pilates", vars).trim();
  // Quitar asteriscos de markdown de WhatsApp para texto plano de notificación.
  const body = renderTemplateVars(tpl.body || "", vars).replace(/\*/g, "").trim();
  const url = urlPath || PUSH_TEMPLATE_URLS[templateKey] || "/app";
  return sendPushToUser(userId, { title, body, url, tag: templateKey });
}

// Mensajes de lista de espera (texto único, reutilizado como fallback en los
// envíos y dentro de notifyWaitlistPromotion). Mantener alineados con los
// bodies por defecto de booking_waitlist / booking_waitlist_promoted.
function waitlistJoinFallback(name, className, dateStr, timeStr) {
  return `Hola ${name} 💜 Quedaste en *lista de espera* para ${className} el ${dateStr} a las ${timeStr}.\n\nTu lugar todavía NO está confirmado. Si alguien cancela, entras automáticamente por orden de llegada y te avisamos por aquí. 🤍`;
}
function waitlistPromotedFallback(name, className, dateStr, timeStr) {
  return `¡Buenas noticias, ${name}! 💜 Se liberó un lugar y tu clase *${className}* del ${dateStr} a las ${timeStr} quedó *confirmada*.\n\n¡Te esperamos! 🤍`;
}

// Avisa a una alumna que fue PROMOVIDA de lista de espera a confirmada porque
// se liberó un lugar (alguien canceló). Envía WhatsApp + email de confirmación.
async function notifyWaitlistPromotion(userId, classId) {
  try {
    const uRes = await pool.query("SELECT email, display_name, phone FROM users WHERE id = $1", [userId]);
    const cRes = await pool.query(
      `SELECT c.date, c.start_time, ct.name AS class_type_name, i.display_name AS instructor_name
         FROM classes c
         JOIN class_types ct ON c.class_type_id = ct.id
         LEFT JOIN instructors i ON c.instructor_id = i.id
        WHERE c.id = $1`,
      [classId]
    );
    const u = uRes.rows[0];
    const cl = cRes.rows[0];
    if (!u || !cl) return;
    const dateStr = cl.date ? new Date(cl.date).toLocaleDateString("es-MX") : "";
    const timeStr = cl.start_time ? String(cl.start_time).slice(0, 5) : "";
    const className = cl.class_type_name || "tu clase";
    const name = u.display_name || "Alumna";
    if (await areEmailNotificationsEnabled()) {
      sendBookingConfirmed({
        to: u.email,
        name,
        className: cl.class_type_name,
        date: cl.date,
        startTime: cl.start_time,
        instructor: cl.instructor_name,
        classesLeft: null,
        isWaitlist: false,
      }).catch((e) => console.error("[Email] waitlist promoted:", e.message));
    }
    sendConfiguredWhatsAppTemplate({
      templateKey: "booking_waitlist_promoted",
      phone: u.phone,
      vars: { name, class: className, date: dateStr, time: timeStr },
      fallbackMessage: waitlistPromotedFallback(name, className, dateStr, timeStr),
    }).catch((e) => console.error("[WA] waitlist promoted:", e.message));
    sendConfiguredPushTemplate({
      templateKey: "booking_waitlist_promoted",
      userId,
      vars: { name, class: className, date: dateStr, time: timeStr },
    }).catch((e) => console.error("[Push] waitlist promoted:", e.message));
  } catch (e) {
    console.error("[notifyWaitlistPromotion]", e.message);
  }
}

// ─── Auto-promoción de lista de espera (FIFO) ────────────────────────────────
// Promueve a la primera persona ELEGIBLE (con crédito) de la lista de espera de
// una clase cuando hay cupo. Es atómica e idempotente bajo concurrencia:
//   1) bloquea la fila de la clase (FOR UPDATE) y re-verifica cupo y estado,
//   2) respeta el cutoff (no promueve si faltan < waitlist_cutoff_hours),
//   3) itera la cola por antigüedad (created_at) SALTANDO a quien no tenga
//      crédito, promueve a la primera elegible, descuenta 1 crédito.
// Devuelve { bookingId, userId } de la promovida, o null. NO notifica — el
// caller debe llamar notifyWaitlistPromotion(userId, classId) tras un éxito.
async function promoteWaitlist(classId) {
  const cfg = await getCancellationConfig();
  const cutoffHours = Number(cfg.waitlist_cutoff_hours);
  const cutoff = Number.isFinite(cutoffHours) ? cutoffHours : 3;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // (1) Lock the class row; read capacity, status, category and start time.
    const clsRes = await client.query(
      `SELECT c.id, c.current_bookings, c.max_capacity, c.status,
              ct.category AS class_category,
              (c.date + c.start_time::time) AT TIME ZONE 'America/Mexico_City' AS class_start_utc
         FROM classes c JOIN class_types ct ON c.class_type_id = ct.id
        WHERE c.id = $1 FOR UPDATE OF c`,
      [classId]
    );
    const cls = clsRes.rows[0];
    if (!cls || cls.status === "cancelled") { await client.query("ROLLBACK"); return null; }
    const classCategory = normalizeClassCategory(cls.class_category, "all");
    if (Number(cls.current_bookings) >= Number(cls.max_capacity)) { await client.query("ROLLBACK"); return null; }
    // (2) Cutoff: no promover dentro de la ventana de bloqueo.
    if (cutoff > 0 && cls.class_start_utc) {
      const minsUntil = (new Date(cls.class_start_utc).getTime() - Date.now()) / 60_000;
      if (minsUntil < cutoff * 60) { await client.query("ROLLBACK"); return null; }
    }
    // (3) Cola FIFO; bloquea solo las filas de bookings (no la membresía nullable).
    const wlRes = await client.query(
      `SELECT id, user_id, membership_id
         FROM bookings
        WHERE class_id = $1 AND status = 'waitlist'
        ORDER BY created_at ASC
        FOR UPDATE`,
      [classId]
    );
    let promoted = null;
    for (const wl of wlRes.rows) {
      // Re-leer y bloquear el crédito de su membresía justo antes de promover.
      let remaining = null;
      if (wl.membership_id) {
        const mRes = await client.query(
          "SELECT classes_remaining FROM memberships WHERE id = $1 FOR UPDATE",
          [wl.membership_id]
        );
        remaining = mRes.rows[0]?.classes_remaining ?? null;
      }
      const hasCredit = remaining === null || Number(remaining) >= 9999 || Number(remaining) > 0;
      if (!hasCredit) continue;            // saltar a la siguiente con crédito
      await client.query("UPDATE bookings SET status = 'confirmed' WHERE id = $1", [wl.id]);
      await client.query("UPDATE classes SET current_bookings = current_bookings + 1 WHERE id = $1", [classId]);
      if (wl.membership_id) {
        // Descuenta classes_remaining (+ discipline_credits del combo si aplica);
        // no-op interno para membresías ilimitadas (null o >= 9999).
        await consumeMembershipCredit(client, wl.membership_id, classCategory);
      }
      promoted = { bookingId: wl.id, userId: wl.user_id };
      break;
    }
    await client.query("COMMIT");
    return promoted;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (_) { /* noop */ }
    console.error("[promoteWaitlist]", e.message);
    return null;
  } finally {
    client.release();
  }
}

async function areEmailNotificationsEnabled() {
  const notificationSettings = await getSettingsValue("notification_settings", DEFAULT_NOTIFICATION_SETTINGS);
  return notificationSettings?.email_reminders !== false;
}

// Webhook (no auth) — receives Evolution API events
app.post("/api/webhook/evolution", async (req, res) => {
  try {
    const body = req.body;
    console.log("[EVOLUTION WEBHOOK]", JSON.stringify(body).slice(0, 400));
    // TODO: handle inbound messages / delivery receipts
    return res.sendStatus(200);
  } catch (err) {
    console.error("[EVOLUTION WEBHOOK ERROR]", err.message);
    return res.sendStatus(200);
  }
});

// GET /api/evolution/status
app.get("/api/evolution/status", adminMiddleware, async (req, res) => {
  try {
    // Check if instance exists first
    let instanceExists = false;
    try {
      const listRes = await evolutionApi.get("/instance/fetchInstances");
      const instances = listRes.data?.data || listRes.data || [];
      instanceExists = Array.isArray(instances)
        ? instances.some((i) =>
          i.instance?.instanceName === EVOLUTION_INSTANCE ||
          i.instanceName === EVOLUTION_INSTANCE ||
          i.name === EVOLUTION_INSTANCE
        )
        : false;
    } catch (_) { instanceExists = false; }

    if (!instanceExists) {
      return res.json({ data: { connected: false, state: "disconnected", instanceExists: false } });
    }

    const r = await evolutionApi.get(`/instance/connectionState/${EVOLUTION_INSTANCE}`);
    const state = r.data?.instance?.state || r.data?.state || "unknown";

    let qrCode = null;
    if (state === "connecting" || state === "qr") {
      try {
        const qrRes = await evolutionApi.get(`/instance/connect/${EVOLUTION_INSTANCE}`);
        qrCode = normalizeQrDataUrl(pickEvolutionQrPayload(qrRes.data));
      } catch (_) { }
    }

    return res.json({
      data: {
        connected: state === "open",
        state: state === "open" ? "connected" : state === "qr" || state === "connecting" ? "qr_pending" : "disconnected",
        number: r.data?.instance?.profileName || null,
        instanceExists: true,
        qrCode,
      },
    });
  } catch (err) {
    console.error("[EVOLUTION STATUS]", err.response?.data || err.message);
    return res.json({ data: { connected: false, state: "disconnected", instanceExists: false } });
  }
});

// POST /api/evolution/connect — create instance (or fetch QR if already exists)
app.post("/api/evolution/connect", adminMiddleware, async (req, res) => {
  try {
    const isAlreadyInUseError = (status, rawMessage) =>
      status === 409 || status === 403 || /already in use|in use|ya existe/i.test(rawMessage || "");

    // Try creating the instance
    let createData = null;
    let createErrStatus = null;
    let createErrMessage = "";
    let createAlreadyInUse = false;
    try {
      const createRes = await evolutionApi.post("/instance/create", {
        instanceName: EVOLUTION_INSTANCE,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
      });
      createData = createRes.data;
    } catch (createErr) {
      createErrStatus = createErr.response?.status ?? null;
      createErrMessage = JSON.stringify(createErr.response?.data || createErr.message || "");
      createAlreadyInUse = isAlreadyInUseError(createErrStatus, createErrMessage);
      // "already in use" is an expected case when the instance already exists.
      if (!createAlreadyInUse) {
        console.error("[EVOLUTION CREATE]", createErr.response?.data || createErr.message);
      } else {
        console.log("[EVOLUTION CREATE] Instance already exists, proceeding to connect:", EVOLUTION_INSTANCE);
      }
    }

    // Extract QR from create response (Evolution v2 returns it inline)
    let qrCode =
      normalizeQrDataUrl(pickEvolutionQrPayload(createData));

    // If not in create response, try the connect endpoint
    if (!qrCode) {
      try {
        const qrRes = await evolutionApi.get(`/instance/connect/${EVOLUTION_INSTANCE}`);
        console.log("[EVOLUTION QR RESPONSE]", JSON.stringify(qrRes.data).slice(0, 300));
        qrCode = normalizeQrDataUrl(pickEvolutionQrPayload(qrRes.data));
      } catch (qrErr) {
        console.error("[EVOLUTION QR FETCH]", qrErr.response?.data || qrErr.message);
      }
    }

    if (!qrCode) {
      // If there is no QR, check if the instance is already linked/open.
      try {
        const stateResp = await evolutionApi.get(`/instance/connectionState/${EVOLUTION_INSTANCE}`);
        const currentState = stateResp.data?.instance?.state || stateResp.data?.state || "unknown";
        if (currentState === "open") {
          return res.json({
            data: {
              state: "connected",
              connected: true,
              message: "WhatsApp ya está conectado en esta instancia",
            },
          });
        }
      } catch (_) {
        // ignore and continue with error mapping below
      }

      if (createAlreadyInUse) {
        return res.status(409).json({
          message: `No se pudo obtener QR para la instancia "${EVOLUTION_INSTANCE}". Ese nombre ya está en uso. Cambia EVOLUTION_INSTANCE_NAME en Railway por un nombre único (ej. tu-espacio-pilates-2026).`,
        });
      }
      return res.status(502).json({ message: "Evolution respondió sin QR. Intenta nuevamente en unos segundos." });
    }

    return res.json({ data: { qrCode, state: "qr_pending", message: "Escanea el código QR con WhatsApp" } });
  } catch (err) {
    console.error("[EVOLUTION CONNECT]", err.response?.data || err.message);
    return res.status(500).json({ message: "Error al conectar con Evolution API" });
  }
});

// POST /api/evolution/disconnect
app.post("/api/evolution/disconnect", adminMiddleware, async (req, res) => {
  try {
    await evolutionApi.delete(`/instance/logout/${EVOLUTION_INSTANCE}`);
    return res.json({ data: { message: "WhatsApp desconectado correctamente" } });
  } catch (err) {
    // If instance not found it's already disconnected
    if (err.response?.status === 404) {
      return res.json({ data: { message: "Ya estaba desconectado" } });
    }
    console.error("[EVOLUTION DISCONNECT]", err.response?.data || err.message);
    return res.status(500).json({ message: "Error al desconectar WhatsApp" });
  }
});

// POST /api/evolution/send-test  { phone: "5219XXXXXXXXX" }
app.post("/api/evolution/send-test", adminMiddleware, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: "Se requiere número de teléfono" });
    const number = normalisePhone(phone);
    await queueWhatsAppSend(
      number,
      "✅ Mensaje de prueba desde Tu Espacio Pilates. ¡WhatsApp conectado correctamente!",
    );
    return res.json({ data: { message: "Mensaje de prueba enviado correctamente" } });
  } catch (err) {
    console.error("[EVOLUTION SEND-TEST]", err.response?.data || err.message);
    return res.status(500).json({ message: "Error al enviar mensaje de prueba" });
  }
});

// POST /api/evolution/send-message  { phone, message }
app.post("/api/evolution/send-message", adminMiddleware, async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ message: "Se requieren teléfono y mensaje" });
    const number = normalisePhone(phone);
    await queueWhatsAppSend(number, message);
    return res.json({ data: { message: "Mensaje enviado", number } });
  } catch (err) {
    console.error("[EVOLUTION SEND-MSG]", err.response?.data || err.message);
    return res.status(500).json({ message: "Error al enviar mensaje" });
  }
});

// POST /api/evolution/notify-clients — disabled for safety
app.post("/api/evolution/notify-clients", adminMiddleware, async (req, res) => {
  return res.status(410).json({
    message: "Los envíos masivos por WhatsApp fueron deshabilitados por seguridad.",
  });
});

// ─── Videos purchases approve/reject ────────────────────────────────────────

app.post("/api/videos/purchases/:id/approve", adminMiddleware, async (req, res) => {
  try {
    const { admin_notes } = req.body;
    const r = await pool.query(
      "UPDATE video_purchases SET status='active', admin_notes=$1, verified_at=NOW() WHERE id=$2 RETURNING *",
      [admin_notes || null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Compra no encontrada" });
    return res.json({ data: r.rows[0] });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

app.post("/api/videos/purchases/:id/reject", adminMiddleware, async (req, res) => {
  try {
    const { admin_notes } = req.body;
    const r = await pool.query(
      "UPDATE video_purchases SET status='rejected', admin_notes=$1, verified_at=NOW() WHERE id=$2 RETURNING *",
      [admin_notes || null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Compra no encontrada" });
    return res.json({ data: r.rows[0] });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// Admin Videos — also available at /api/videos (CRUD) for admin use

// POST /api/videos/upload  — upload video file (+ optional thumbnail) to Google Drive
app.post("/api/videos/upload", adminMiddleware, uploadVideo.fields([{ name: "video", maxCount: 1 }, { name: "thumbnail", maxCount: 1 }]), async (req, res) => {
  try {
    const videoFile = req.files?.video?.[0];
    const thumbnailFile = req.files?.thumbnail?.[0];
    if (!videoFile) return res.status(400).json({ message: "Se requiere el archivo de video" });

    const isDriveConfigured = Boolean(
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REFRESH_TOKEN
    );
    if (!isDriveConfigured) {
      return res.status(503).json({ message: "Google Drive no configurado. Define GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN en Railway." });
    }

    const accessToken = await getGoogleDriveAccessToken();

    // Upload video using resumable upload (streams from disk in 5 MB chunks)
    const videoResult = await uploadFileToDriveResumable(
      videoFile.path,
      videoFile.originalname,
      videoFile.mimetype,
      accessToken
    );
    // Clean up temp file
    fs.unlink(videoFile.path, () => { });
    await makeGoogleDriveFilePublic(videoResult.id, accessToken);

    // Upload thumbnail (optional) — small file, use buffer multipart
    let thumbnailUrl = `https://drive.google.com/thumbnail?id=${videoResult.id}&sz=w640`;
    let thumbnailDriveId = "";
    if (thumbnailFile) {
      const thumbBuffer = fs.readFileSync(thumbnailFile.path);
      const thumbResult = await uploadBufferToDrive(
        thumbBuffer,
        thumbnailFile.originalname,
        thumbnailFile.mimetype,
        accessToken
      );
      fs.unlink(thumbnailFile.path, () => { });
      await makeGoogleDriveFilePublic(thumbResult.id, accessToken);
      thumbnailUrl = `https://drive.google.com/thumbnail?id=${thumbResult.id}&sz=w640`;
      thumbnailDriveId = thumbResult.id;
    }

    return res.json({
      drive_file_id: videoResult.id,
      cloudinary_id: videoResult.id,           // same value for compat
      thumbnail_url: thumbnailUrl,
      thumbnail_drive_id: thumbnailDriveId,
      secure_url: `https://drive.google.com/file/d/${videoResult.id}/view`,
      embed_url: `https://drive.google.com/file/d/${videoResult.id}/preview`,
      duration_seconds: 0,
    });
  } catch (err) {
    // Clean up temp files on error
    if (req.files?.video?.[0]?.path) fs.unlink(req.files.video[0].path, () => { });
    if (req.files?.thumbnail?.[0]?.path) fs.unlink(req.files.thumbnail[0].path, () => { });
    console.error("Video upload error:", err?.response?.data || err.message);
    return res.status(500).json({ message: "Error al subir video: " + (err?.response?.data?.error?.message || err.message) });
  }
});

app.post("/api/videos", adminMiddleware, async (req, res) => {
  try {
    const {
      title, description, subtitle, tagline, days, brand_color,
      drive_file_id, cloudinary_id, thumbnail_url, thumbnail_drive_id,
      class_type_id, instructor_id, duration_seconds,
      access_type = "free", is_published = false, is_featured = false, sort_order = 0,
      sales_enabled = false, sales_unlocks_video = false, sales_price_mxn, sales_class_credits, sales_cta_text,
      category_id,
    } = req.body;
    if (!title) return res.status(400).json({ message: "title es requerido" });
    const r = await pool.query(
      `INSERT INTO videos (
         title, description, subtitle, tagline, days, brand_color,
         drive_file_id, cloudinary_id, thumbnail_url, thumbnail_drive_id,
         class_type_id, instructor_id, duration_seconds,
         access_type, is_published, is_featured, sort_order,
         sales_enabled, sales_unlocks_video, sales_price_mxn, sales_class_credits, sales_cta_text
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING *`,
      [
        title, description || null, subtitle || null, tagline || null, days || null, brand_color || null,
        drive_file_id || null, cloudinary_id || drive_file_id || null, thumbnail_url || null, thumbnail_drive_id || null,
        class_type_id || category_id || null, instructor_id || null, duration_seconds || 0,
        access_type, is_published, is_featured, sort_order,
        sales_enabled, sales_unlocks_video, sales_price_mxn || null, sales_class_credits || null, sales_cta_text || null,
      ]
    );
    return res.status(201).json({ data: r.rows[0] });
  } catch (err) {
    console.error("POST /videos error:", err.message);
    return res.status(500).json({ message: "Error interno" });
  }
});

app.put("/api/videos/:id", adminMiddleware, async (req, res) => {
  try {
    const {
      title, description, subtitle, tagline, days, brand_color,
      drive_file_id, cloudinary_id, thumbnail_url, thumbnail_drive_id,
      class_type_id, instructor_id, duration_seconds,
      access_type, is_published, is_featured, sort_order,
      sales_enabled, sales_unlocks_video, sales_price_mxn, sales_class_credits, sales_cta_text,
      category_id,
    } = req.body;
    const r = await pool.query(
      `UPDATE videos SET
         title=$1, description=$2, subtitle=$3, tagline=$4, days=$5, brand_color=$6,
         drive_file_id=COALESCE($7, drive_file_id),
         cloudinary_id=COALESCE($8, cloudinary_id),
         thumbnail_url=COALESCE($9, thumbnail_url),
         thumbnail_drive_id=COALESCE($10, thumbnail_drive_id),
         class_type_id=$11, instructor_id=$12,
         duration_seconds=COALESCE($13, duration_seconds),
         access_type=COALESCE($14, access_type),
         is_published=COALESCE($15, is_published),
         is_featured=COALESCE($16, is_featured),
         sort_order=COALESCE($17, sort_order),
         sales_enabled=COALESCE($18, sales_enabled),
         sales_unlocks_video=COALESCE($19, sales_unlocks_video),
         sales_price_mxn=$20, sales_class_credits=$21, sales_cta_text=$22,
         updated_at=NOW()
       WHERE id=$23 RETURNING *`,
      [
        title, description || null, subtitle || null, tagline || null, days || null, brand_color || null,
        drive_file_id || null, cloudinary_id || drive_file_id || null,
        thumbnail_url || null, thumbnail_drive_id || null,
        class_type_id || category_id || null, instructor_id || null,
        duration_seconds ?? null,
        access_type || null, is_published ?? null, is_featured ?? null, sort_order ?? null,
        sales_enabled ?? null, sales_unlocks_video ?? null,
        sales_price_mxn ?? null, sales_class_credits ?? null, sales_cta_text ?? null,
        req.params.id,
      ]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Video no encontrado" });
    return res.json({ data: r.rows[0] });
  } catch (err) {
    console.error("PUT /videos/:id error:", err.message);
    return res.status(500).json({ message: "Error interno" });
  }
});

app.delete("/api/videos/:id", adminMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM videos WHERE id=$1", [req.params.id]);
    return res.json({ message: "Video eliminado" });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// ─── Homepage Video Cards ────────────────────────────────────────────────────
// GET /api/homepage-video-cards  (public)
app.get("/api/homepage-video-cards", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM homepage_video_cards ORDER BY sort_order ASC");
    // Normalize any old Google Drive preview URLs to proxy URLs
    const rows = r.rows.map(card => {
      if (card.video_url) {
        const m = card.video_url.match(/drive\.google\.com\/file\/d\/([^/]+)\/preview/);
        if (m) card.video_url = `/api/drive/video/${m[1]}`;
      }
      return card;
    });
    return res.json({ data: rows });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// PUT /api/homepage-video-cards/:id  (admin — text fields)
app.put("/api/homepage-video-cards/:id", adminMiddleware, async (req, res) => {
  try {
    const { title, description, emoji, thumbnail_url } = req.body;
    if (!title || !description) return res.status(400).json({ message: "title y description requeridos" });
    const r = await pool.query(
      `UPDATE homepage_video_cards
       SET title=$1, description=$2, emoji=$3, thumbnail_url=COALESCE($4, thumbnail_url), updated_at=NOW()
       WHERE id=$5 RETURNING *`,
      [title.trim(), description.trim(), (emoji || "🎬").trim(), thumbnail_url || null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Tarjeta no encontrada" });
    return res.json({ data: r.rows[0] });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// POST /api/homepage-video-cards/:id/thumbnail — upload a thumbnail image (admin)
app.post("/api/homepage-video-cards/:id/thumbnail", adminMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No se envió archivo" });
    const cardId = req.params.id;

    // Upload image to Google Drive (reuse existing OAuth setup)
    const isDriveConfigured = Boolean(
      process.env.GOOGLE_DRIVE_FOLDER_ID &&
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REFRESH_TOKEN
    );

    let thumbnailUrl;
    if (isDriveConfigured) {
      // Get access token
      const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
          grant_type: "refresh_token",
        }),
      });
      const { access_token } = await tokenResp.json();

      // Upload to Drive
      const boundary = "thumbnail_boundary_" + Date.now();
      const metadata = JSON.stringify({
        name: `thumbnail_card_${cardId}_${Date.now()}.${req.file.originalname.split(".").pop()}`,
        parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
      });
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${req.file.mimetype}\r\n\r\n`),
        req.file.buffer,
        Buffer.from(`\r\n--${boundary}--`),
      ]);

      const uploadResp = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
        method: "POST",
        headers: { Authorization: `Bearer ${access_token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      });
      const uploadJson = await uploadResp.json();
      if (!uploadJson.id) throw new Error("Error al subir imagen a Drive");

      // Make public
      await fetch(`https://www.googleapis.com/drive/v3/files/${uploadJson.id}/permissions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      });

      // Use proxy URL for consistency
      thumbnailUrl = `/api/drive/image/${uploadJson.id}`;
    } else {
      // Fallback: store as base64 data URI (small images only)
      thumbnailUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
    }

    const r = await pool.query(
      `UPDATE homepage_video_cards SET thumbnail_url=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [thumbnailUrl, cardId]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Tarjeta no encontrada" });
    return res.json({ data: r.rows[0] });
  } catch (err) {
    console.error("Thumbnail upload error:", err);
    return res.status(500).json({ message: err.message || "Error al subir miniatura" });
  }
});

// DELETE /api/homepage-video-cards/:id/thumbnail — remove thumbnail (admin)
app.delete("/api/homepage-video-cards/:id/thumbnail", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE homepage_video_cards SET thumbnail_url=NULL, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Tarjeta no encontrada" });
    return res.json({ data: r.rows[0] });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// ─── Direct-to-Drive Upload (server proxies upload to avoid CORS) ───────────

// POST /api/drive/init-upload — creates a Google Drive resumable session, returns sessionId
app.post("/api/drive/init-upload", adminMiddleware, async (req, res) => {
  try {
    const { fileName, mimeType, fileSize } = req.body;
    if (!fileName || !mimeType) {
      return res.status(400).json({ message: "fileName y mimeType son requeridos" });
    }

    const isDriveConfigured = Boolean(
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REFRESH_TOKEN
    );
    if (!isDriveConfigured) {
      return res.status(503).json({ message: "Google Drive no configurado" });
    }

    const accessToken = await getGoogleDriveAccessToken();
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || "";
    const metadata = { name: fileName, ...(folderId ? { parents: [folderId] } : {}) };

    // Initiate a resumable upload session on Google Drive
    const initResp = await axios.post(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink",
      metadata,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mimeType,
          ...(fileSize ? { "X-Upload-Content-Length": String(fileSize) } : {}),
        },
      }
    );

    const uploadUrl = initResp.headers.location;
    if (!uploadUrl) {
      return res.status(500).json({ message: "No se obtuvo URL de subida de Google Drive" });
    }

    // Store session in memory (short-lived) for the chunk upload endpoint
    const sessionId = crypto.randomBytes(16).toString("hex");
    driveUploadSessions.set(sessionId, { uploadUrl, accessToken, mimeType, fileSize: Number(fileSize) || 0, createdAt: Date.now() });
    // Clean up old sessions after 2 hours
    setTimeout(() => driveUploadSessions.delete(sessionId), 2 * 60 * 60 * 1000);

    return res.json({ data: { sessionId } });
  } catch (err) {
    console.error("Drive init-upload error:", err?.response?.data || err.message);
    return res.status(500).json({ message: "Error al iniciar subida: " + (err?.response?.data?.error?.message || err.message) });
  }
});

// In-memory map to store active Drive upload sessions
const driveUploadSessions = new Map();

// PUT /api/drive/upload-chunk/:sessionId — proxy a chunk from browser to Google Drive
// The browser sends chunks of ~5MB via this endpoint; the server forwards them to Drive.
// This avoids CORS issues (browser → our server → googleapis.com)
app.put("/api/drive/upload-chunk/:sessionId", adminMiddleware, async (req, res) => {
  const session = driveUploadSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ message: "Sesión de upload no encontrada o expirada" });

  const contentRange = req.headers["content-range"] || "";
  const contentLength = req.headers["content-length"] || "";
  const contentType = req.headers["content-type"] || session.mimeType;

  try {
    // Collect the chunk from the browser request
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);

    // Forward to Google Drive
    const driveResp = await axios.put(session.uploadUrl, body, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(body.length),
        ...(contentRange ? { "Content-Range": contentRange } : {}),
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: (s) => s === 200 || s === 201 || s === 308,
    });

    if (driveResp.status === 200 || driveResp.status === 201) {
      // Upload complete — return the file data
      driveUploadSessions.delete(req.params.sessionId);
      return res.json({ done: true, data: driveResp.data });
    }

    // 308 Resume Incomplete — return range info so browser knows where to continue
    const range = driveResp.headers.range || "";
    return res.json({ done: false, range });
  } catch (err) {
    console.error("Drive upload-chunk error:", err?.response?.data || err.message);
    return res.status(500).json({ message: "Error al subir chunk: " + (err?.response?.data?.error?.message || err.message) });
  }
});

// POST /api/drive/make-public/:fileId — make a Drive file publicly readable
app.post("/api/drive/make-public/:fileId", adminMiddleware, async (req, res) => {
  try {
    const accessToken = await getGoogleDriveAccessToken();
    await makeGoogleDriveFilePublic(req.params.fileId, accessToken);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Drive make-public error:", err?.response?.data || err.message);
    return res.status(500).json({ message: "Error al hacer público el archivo" });
  }
});

// GET /api/drive/video/:fileId — stream a public Google Drive video (proxy)
app.get("/api/drive/video/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    if (!fileId || fileId.length < 10) return res.status(400).end();

    const accessToken = await getGoogleDriveAccessToken();

    // First, get file metadata to know the mimeType & size
    const metaResp = await axios.get(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType,size,name`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const { mimeType, size, name } = metaResp.data;
    const totalSize = parseInt(size, 10);

    // Support Range requests for seeking
    const rangeHeader = req.headers.range;
    let start = 0;
    let end = totalSize - 1;

    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      start = parseInt(parts[0], 10);
      end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
      if (start >= totalSize || end >= totalSize) {
        res.writeHead(416, { "Content-Range": `bytes */${totalSize}` });
        return res.end();
      }
    }

    const chunkSize = end - start + 1;
    const driveHeaders = {
      Authorization: `Bearer ${accessToken}`,
      Range: `bytes=${start}-${end}`,
    };

    const driveResp = await axios.get(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: driveHeaders, responseType: "stream" }
    );

    const statusCode = rangeHeader ? 206 : 200;
    res.writeHead(statusCode, {
      "Content-Type": mimeType || "video/mp4",
      "Content-Length": chunkSize,
      "Content-Range": `bytes ${start}-${end}/${totalSize}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=86400",
      "Content-Disposition": `inline; filename="${name || "video.mp4"}"`,
    });

    driveResp.data.pipe(res);
  } catch (err) {
    console.error("Drive video proxy error:", err?.response?.data || err.message);
    if (!res.headersSent) res.status(500).json({ message: "Error al obtener video" });
  }
});

// GET /api/drive/image/:fileId — proxy a public Google Drive image
app.get("/api/drive/image/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    if (!fileId || fileId.length < 10) return res.status(400).end();
    const accessToken = await getGoogleDriveAccessToken();
    const metaResp = await axios.get(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType,name`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const { mimeType, name } = metaResp.data;
    const driveResp = await axios.get(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` }, responseType: "stream" }
    );
    res.set({
      "Content-Type": mimeType || "image/jpeg",
      "Cache-Control": "public, max-age=604800",
      "Content-Disposition": `inline; filename="${name || "image.jpg"}"`,
    });
    driveResp.data.pipe(res);
  } catch (err) {
    console.error("Drive image proxy error:", err?.response?.data || err.message);
    if (!res.headersSent) res.status(500).json({ message: "Error al obtener imagen" });
  }
});

// POST /api/homepage-video-cards/:id/set-drive-video — save Drive file ID to card
app.post("/api/homepage-video-cards/:id/set-drive-video", adminMiddleware, async (req, res) => {
  try {
    const { driveFileId } = req.body;
    if (!driveFileId) return res.status(400).json({ message: "driveFileId requerido" });

    // Store the proxy URL instead of the Google Drive preview URL
    const videoUrl = `/api/drive/video/${driveFileId}`;
    const r = await pool.query(
      `UPDATE homepage_video_cards SET video_url=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [videoUrl, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Tarjeta no encontrada" });
    return res.json({ data: r.rows[0] });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/homepage-video-cards/migrate-urls — convert old Google Drive preview URLs to proxy URLs
app.post("/api/homepage-video-cards/migrate-urls", adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE homepage_video_cards
       SET video_url = '/api/drive/video/' || regexp_replace(video_url, '^https://drive\\.google\\.com/file/d/([^/]+)/preview$', '\\1'),
           updated_at = NOW()
       WHERE video_url LIKE 'https://drive.google.com/file/d/%/preview'
       RETURNING id, video_url`
    );
    return res.json({ migrated: result.rowCount, rows: result.rows });
  } catch (err) {
    console.error("Migration error:", err.message);
    return res.status(500).json({ message: "Error al migrar URLs" });
  }
});

// POST /api/homepage-video-cards/:id/upload  (admin — upload video file, max 500 MB)
app.post("/api/homepage-video-cards/:id/upload", adminMiddleware, (req, res, next) => {
  uploadVideo.single("video")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ message: `El archivo es demasiado grande. Máximo ${VIDEO_MAX_MB} MB.` });
      }
      return res.status(400).json({ message: err.message || "Error al procesar archivo" });
    }
    next();
  });
}, async (req, res) => {
  try {
    const videoFile = req.file;
    if (!videoFile) return res.status(400).json({ message: "Se requiere un archivo de video" });

    const isDriveConfigured = Boolean(
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REFRESH_TOKEN
    );

    let videoUrl;

    if (isDriveConfigured) {
      // Upload to Google Drive using resumable upload (streams in 5 MB chunks)
      const accessToken = await getGoogleDriveAccessToken();
      const result = await uploadFileToDriveResumable(
        videoFile.path,
        `homepage_card_${req.params.id}_${Date.now()}_${videoFile.originalname}`,
        videoFile.mimetype,
        accessToken
      );
      // Clean up temp file
      fs.unlink(videoFile.path, () => { });
      await makeGoogleDriveFilePublic(result.id, accessToken);
      videoUrl = `/api/drive/video/${result.id}`;
    } else {
      if (videoFile.path) fs.unlink(videoFile.path, () => { });
      return res.status(503).json({
        message: "Google Drive no está configurado. Configura GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REFRESH_TOKEN para subir videos.",
      });
    }

    // Save video_url to DB
    const r = await pool.query(
      `UPDATE homepage_video_cards SET video_url=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [videoUrl, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Tarjeta no encontrada" });
    return res.json({ data: r.rows[0] });
  } catch (err) {
    // Clean up temp file on error
    if (req.file?.path) fs.unlink(req.file.path, () => { });
    console.error("Homepage card video upload error:", err?.response?.data || err.message);
    return res.status(500).json({ message: "Error al subir video: " + (err?.response?.data?.error?.message || err.message) });
  }
});

// DELETE /api/homepage-video-cards/:id/video  (admin — remove video)
app.delete("/api/homepage-video-cards/:id/video", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE homepage_video_cards SET video_url=NULL, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Tarjeta no encontrada" });
    return res.json({ data: r.rows[0] });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// GET /api/admin/stats
app.get("/api/admin/stats", adminMiddleware, async (req, res) => {
  try {
    // Fecha LOCAL de México (CST/CDT), no la UTC del servidor (Railway corre en UTC):
    // si no, un domingo por la noche en SLP ya es lunes UTC y "clases de hoy" contaría las del lunes.
    const mxParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const mxPart = (t) => mxParts.find((p) => p.type === t)?.value;
    const today = `${mxPart("year")}-${mxPart("month")}-${mxPart("day")}`;
    const monthStart = `${mxPart("year")}-${mxPart("month")}-01`;

    const [classesToday, activeMembers, monthlyRevenue, pendingAlerts] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM classes WHERE date = $1", [today]),
      pool.query("SELECT COUNT(*) FROM memberships WHERE status = 'active'"),
      pool.query("SELECT COALESCE(SUM(total_amount),0) AS total FROM orders WHERE status = 'approved' AND created_at >= $1", [monthStart]),
      pool.query("SELECT COUNT(*) FROM orders WHERE status = 'pending_verification'"),
    ]);

    return res.json({
      classesToday: parseInt(classesToday.rows[0].count),
      activeMembers: parseInt(activeMembers.rows[0].count),
      monthlyRevenue: parseFloat(monthlyRevenue.rows[0].total),
      pendingAlerts: parseInt(pendingAlerts.rows[0].count),
    });
  } catch (err) {
    console.error("admin/stats error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/users?role=&search=
app.get("/api/users", adminMiddleware, async (req, res) => {
  try {
    const { role, search = "" } = req.query;
    // COALESCE(is_hidden,false)=false excluye cuentas ocultas (admin dueño) de toda lista del panel.
    let q = `SELECT id, display_name, email, phone, role, created_at FROM users WHERE COALESCE(is_hidden, false) = false`;
    const params = [];
    if (role) { params.push(role); q += ` AND role = $${params.length}`; }
    const searchValue = String(search ?? "").trim();
    if (searchValue) {
      params.push(`%${searchValue}%`);
      const textIdx = params.length;
      const digitSearch = searchValue.replace(/\D/g, "");
      let phoneClause = "";
      if (digitSearch) {
        params.push(`%${digitSearch}%`);
        phoneClause = ` OR regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') LIKE $${params.length}`;
      }
      q += ` AND (display_name ILIKE $${textIdx} OR email ILIKE $${textIdx}${phoneClause})`;
    }
    q += " ORDER BY display_name ASC LIMIT 200";
    const r = await pool.query(q, params);
    return res.json({ data: camelRows(r.rows) });
  } catch (err) {
    console.error("GET /api/users error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/users — admin creates a client
app.post("/api/users", adminMiddleware, async (req, res) => {
  try {
    const { email, displayName, phone, role = "client", dateOfBirth, emergencyContactName, emergencyContactPhone, healthNotes } = req.body;
    if (!displayName || !phone) return res.status(400).json({ message: "Nombre y teléfono requeridos" });
    const normalizedPhone = normalizePhoneForStorage(phone);
    const normalizedEmail = email ? email.toLowerCase().trim() : null;
    if (role === "client") {
      const phoneExists = await pool.query("SELECT id FROM users WHERE phone = $1 AND role = 'client'", [normalizedPhone]);
      if (phoneExists.rows.length) return res.status(409).json({ message: "Teléfono ya registrado" });
    }
    if (normalizedEmail) {
      const emailExists = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
      if (emailExists.rows.length) return res.status(409).json({ message: "Email ya registrado" });
    }
    const tempPassword = crypto.randomBytes(8).toString("base64url").slice(0, 10);
    const hash = await bcrypt.hash(tempPassword, 12);
    const r = await pool.query(
      `INSERT INTO users (display_name, email, phone, role, password_hash, date_of_birth, emergency_contact_name, emergency_contact_phone, health_notes, accepts_terms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) RETURNING *`,
      [displayName, normalizedEmail, normalizedPhone, role, hash, dateOfBirth || null, emergencyContactName || null, emergencyContactPhone || null, healthNotes || null]
    );
    return res.status(201).json({ user: mapUser(r.rows[0]), tempPassword });
  } catch (err) {
    console.error("POST /api/users error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// DELETE /api/users/:id
app.delete("/api/users/:id", adminMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]);
    return res.json({ message: "Usuario eliminado" });
  } catch (err) {
    console.error("DELETE /api/users/:id error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/admin/users/:id/reset-password — admin restablece la contraseña de un cliente
app.post("/api/admin/users/:id/reset-password", adminMiddleware, async (req, res) => {
  try {
    const { password } = req.body || {};
    const newPassword = (password && String(password).length >= 8)
      ? String(password)
      : crypto.randomBytes(8).toString("base64url").slice(0, 10) + "A1";
    const hash = await bcrypt.hash(newPassword, 12);
    const r = await pool.query(
      "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 AND role = 'client' RETURNING id",
      [hash, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ message: "Clienta no encontrada" });
    // Invalidar links de recuperación pendientes
    await pool.query("UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false", [req.params.id]).catch((e) => { console.warn("reset-password: no se pudieron invalidar tokens previos", req.params.id, e?.message); });
    return res.json({ message: "Contraseña restablecida", tempPassword: newPassword });
  } catch (err) {
    console.error("POST /api/admin/users/:id/reset-password error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Memberships admin CRUD ──────────────────────────────────────────────────

// GET /api/memberships — admin list all
app.get("/api/memberships", adminMiddleware, async (req, res) => {
  try {
    const { status, userId, limit = 100 } = req.query;
    // start_date / end_date son DATE → pg los devuelve como Date UTC midnight,
    // que en CDMX (UTC-6) se ve como el día anterior. Casteamos a TEXT con
    // to_char para que el front reciba "YYYY-MM-DD" sin ambigüedad.
    let q = `SELECT m.id, m.user_id, m.plan_id, m.status, m.payment_method,
                    m.classes_remaining, m.bundle_parent_id, m.notes, m.created_at,
                    m.order_id, m.discipline_credits,
                    to_char(m.start_date, 'YYYY-MM-DD') AS start_date,
                    to_char(m.end_date,   'YYYY-MM-DD') AS end_date,
                    u.display_name AS user_name,
                    p.name AS plan_name,
                    p.class_limit, p.duration_days, p.class_category,
                    p.bundle_components,
                    (p.bundle_components IS NOT NULL
                       AND jsonb_typeof(p.bundle_components) = 'array'
                       AND jsonb_array_length(p.bundle_components) > 0) AS has_bundle_components
             FROM memberships m
             LEFT JOIN users u ON m.user_id = u.id
             LEFT JOIN plans p ON m.plan_id = p.id
             WHERE 1=1`;
    const params = [];
    if (userId) { params.push(userId); q += ` AND m.user_id = $${params.length}`; }
    if (status) { params.push(status); q += ` AND m.status = $${params.length}`; }
    params.push(parseInt(limit)); q += ` ORDER BY m.created_at DESC LIMIT $${params.length}`;
    const r = await pool.query(q, params);
    return res.json({
      data: r.rows.map(m => ({
        id: m.id,
        userId: m.user_id,
        userName: m.user_name ?? m.user_id,
        planId: m.plan_id,
        planName: m.plan_name ?? m.plan_id,
        classCategory: m.class_category ?? "all",
        status: m.status,
        paymentMethod: m.payment_method,
        startDate: m.start_date,
        endDate: m.end_date,
        classesRemaining: m.classes_remaining,
        classLimit: m.class_limit,
        bundleParentId: m.bundle_parent_id ?? null,
        hasBundleComponents: !!m.has_bundle_components,
        bundleComponents: Array.isArray(m.bundle_components)
          ? m.bundle_components
          : (typeof m.bundle_components === "string"
              ? (() => { try { return JSON.parse(m.bundle_components); } catch { return null; } })()
              : null),
        disciplineCredits: m.discipline_credits ?? null,
        notes: m.notes ?? null,
        createdAt: m.created_at,
        orderId: m.order_id ?? null,
      }))
    });
  } catch (err) {
    console.error("GET /memberships error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/memberships — admin assigns membership to a user
app.post("/api/memberships", adminMiddleware, async (req, res) => {
  try {
    const { userId, planId, paymentMethod: rawPM = "cash", startDate, complementType } = req.body;
    const paymentMethod = normalizePaymentMethod(rawPM);
    if (!userId || !planId) return res.status(400).json({ message: "userId y planId requeridos" });
    const planRes = await pool.query("SELECT * FROM plans WHERE id = $1 AND is_active = true", [planId]);
    if (!planRes.rows.length) return res.status(404).json({ message: "Plan no encontrado" });
    const plan = planRes.rows[0];

    // Bundle plans (Combos) → create one child membership per component so
    // each discipline keeps its own classes_remaining. Reuses the same logic
    // as POST /memberships/bundle to avoid drift.
    const bundleRaw = plan.bundle_components;
    const bundleComps = Array.isArray(bundleRaw)
      ? bundleRaw
      : (typeof bundleRaw === "string" ? (() => { try { return JSON.parse(bundleRaw); } catch { return null; } })() : null);
    if (Array.isArray(bundleComps) && bundleComps.length > 0) {
      const dbClient = await pool.connect();
      try {
        await dbClient.query("BEGIN");
        const startStr = startDate ? String(startDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
        const endStr = calcMembershipEndDate(startStr, plan);
        const created = [];
        let bundleParentId = null;
        for (const comp of bundleComps) {
          const compPlanRes = await dbClient.query("SELECT * FROM plans WHERE id = $1", [comp.planId]);
          if (!compPlanRes.rows.length) {
            await dbClient.query("ROLLBACK");
            return res.status(400).json({ message: `Plan componente del bundle no encontrado (${comp.planId})` });
          }
          const compPlan = compPlanRes.rows[0];
          const conflict = await findNonRepeatablePlanConflict({ userId, plan: compPlan, client: dbClient });
          if (conflict) {
            await dbClient.query("ROLLBACK");
            return res.status(409).json({ message: conflict.message });
          }
          const ins = await dbClient.query(
            `INSERT INTO memberships
               (user_id, plan_id, status, payment_method, start_date, end_date,
                classes_remaining, bundle_parent_id, notes)
             VALUES ($1,$2,'active',$3,$4,$5,$6,$7,$8) RETURNING *`,
            [
              userId,
              compPlan.id,
              paymentMethod,
              startStr,
              endStr,
              compPlan.class_limit ?? null,
              bundleParentId,
              `Bundle: ${plan.name}${comp.label ? ` — ${comp.label}` : ""}`,
            ]
          );
          if (!bundleParentId) bundleParentId = ins.rows[0].id;
          created.push(ins.rows[0]);
        }
        await dbClient.query("COMMIT");
        triggerWalletPassSync(userId, "bundle_created");
        return res.status(201).json({
          data: { bundleParentId, bundleName: plan.name, memberships: created.map(camelRow) },
          message: `Combo asignado: ${created.length} membresías creadas`,
        });
      } catch (bundleErr) {
        try { await dbClient.query("ROLLBACK"); } catch (_) {}
        console.error("POST /memberships (bundle path):", bundleErr.message);
        return res.status(500).json({ message: bundleErr.message || "Error al asignar combo" });
      } finally {
        dbClient.release();
      }
    }

    const nonRepeatableConflict = await findNonRepeatablePlanConflict({ userId, plan });
    if (nonRepeatableConflict) {
      return res.status(409).json({ message: nonRepeatableConflict.message });
    }
    const startStr = startDate ? String(startDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
    const endStr = calcMembershipEndDate(startStr, plan);
    const compInfo = complementType ? COMPLEMENT_MAP[complementType] : null;
    const complementNote = compInfo ? `Complemento: ${compInfo.name} — ${compInfo.specialist}` : null;
    const r = await pool.query(
      `INSERT INTO memberships (user_id, plan_id, status, payment_method, start_date, end_date, classes_remaining, notes)
       VALUES ($1,$2,'active',$3,$4,$5,$6,$7) RETURNING *`,
      [userId, planId, paymentMethod, startStr, endStr, plan.class_limit ?? null, complementNote]
    );

    // ── Create consultation if complement was selected ────────────────
    if (compInfo && r.rows[0]) {
      try {
        await pool.query(
          `INSERT INTO consultations (membership_id, user_id, complement_type, complement_name, specialist, status)
           VALUES ($1, $2, $3, $4, $5, 'pending')`,
          [r.rows[0].id, userId, complementType, compInfo.name, compInfo.specialist]
        );
      } catch (consultErr) {
        console.error("[consultations] insert error:", consultErr.message);
      }
    }

    // ── Email: membership activated ──────────────────────────────────────
    try {
      const uRes = await pool.query("SELECT email, display_name, phone FROM users WHERE id = $1", [userId]);
      if (uRes.rows[0]) {
        const u = uRes.rows[0];
        if (await areEmailNotificationsEnabled()) {
          sendMembershipActivated({
            to: u.email,
            name: u.display_name || "Alumna",
            planName: plan.name,
            startDate: new Date(startStr).toISOString(),
            endDate: new Date(endStr).toISOString(),
            classLimit: plan.class_limit ?? null,
          }).catch((e) => console.error("[Email] membership activated:", e.message));
        }
        sendConfiguredWhatsAppTemplate({
          templateKey: "membership_activated",
          phone: u.phone,
          vars: {
            name: u.display_name || "Alumna",
            plan: plan.name || "tu plan",
            startDate: new Date(startStr).toLocaleDateString("es-MX"),
            endDate: new Date(endStr).toLocaleDateString("es-MX"),
          },
          fallbackMessage: `Hola ${u.display_name || "Alumna"}, tu membresía ${plan.name || ""} ya está activa. Vigencia: ${new Date(startStr).toLocaleDateString("es-MX")} al ${new Date(endStr).toLocaleDateString("es-MX")}.`,
        }).catch((e) => console.error("[WA] membership activated:", e.message));
        sendConfiguredPushTemplate({
          templateKey: "membership_activated",
          userId,
          vars: {
            name: u.display_name || "Alumna",
            plan: plan.name || "tu plan",
            startDate: new Date(startStr).toLocaleDateString("es-MX"),
            endDate: new Date(endStr).toLocaleDateString("es-MX"),
          },
        }).catch((e) => console.error("[Push] membership activated:", e.message));
      }
    } catch (emailErr) {
      console.error("[Email] membership create query:", emailErr.message);
    }

    // ── Award loyalty points for membership purchase ────────────────────
    if (userId && parseFloat(plan.price) > 0) {
      try {
        const cfgRes = await pool.query("SELECT value FROM system_settings WHERE key='loyalty_settings' LIMIT 1");
        const cfg = cfgRes.rows.length ? cfgRes.rows[0].value : {};
        const pts = Math.floor(parseFloat(plan.price) * (cfg.points_per_peso ?? 1));
        if (cfg.enabled !== false && pts > 0) {
          await pool.query(
            "INSERT INTO loyalty_points (user_id, points, type, description) VALUES ($1, $2, 'bonus', $3)",
            [userId, pts, `Membresía asignada — ${plan.name} ($${plan.price})`]
          ).catch(() => {});
        }
      } catch (e) { /* loyalty error shouldn't fail membership creation */ }
    }

    triggerWalletPassSync(userId, "membership_created");
    return res.status(201).json({ data: r.rows[0] });
  } catch (err) {
    console.error("POST /memberships error:", err);
    return res.status(500).json({ message: err.message || "Error interno" });
  }
});

// POST /api/memberships/bundle — assigns multiple memberships from a bundle plan
// Bundle plans store their components in plans.bundle_components as JSONB:
//   [{ "planId": "<uuid>", "label": "Reformer x4" }, { "planId": "<uuid>", "label": "Barre x4" }]
// All child memberships share the same start_date / end_date and are tagged
// via memberships.bundle_parent_id so we can roll them up in reports.
app.post("/api/memberships/bundle", adminMiddleware, async (req, res) => {
  const { userId, bundlePlanId, paymentMethod: rawPM = "cash", startDate } = req.body || {};
  if (!userId || !bundlePlanId) {
    return res.status(400).json({ message: "userId y bundlePlanId requeridos" });
  }
  const paymentMethod = normalizePaymentMethod(rawPM);
  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");

    const bundleRes = await dbClient.query(
      "SELECT id, name, price, duration_days, bundle_components FROM plans WHERE id = $1 AND is_active = true",
      [bundlePlanId]
    );
    if (!bundleRes.rows.length) {
      await dbClient.query("ROLLBACK");
      return res.status(404).json({ message: "Bundle no encontrado" });
    }
    const bundle = bundleRes.rows[0];
    const rawComponents = bundle.bundle_components;
    const components = Array.isArray(rawComponents)
      ? rawComponents
      : (typeof rawComponents === "string" ? JSON.parse(rawComponents) : null);
    if (!Array.isArray(components) || components.length === 0) {
      await dbClient.query("ROLLBACK");
      return res.status(400).json({ message: "Este plan no tiene componentes de bundle" });
    }

    const startStr = startDate ? String(startDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
    const endStr = calcMembershipEndDate(startStr, bundle);

    const created = [];
    let bundleParentId = null;
    for (const comp of components) {
      const compPlanRes = await dbClient.query(
        "SELECT * FROM plans WHERE id = $1",
        [comp.planId]
      );
      if (!compPlanRes.rows.length) {
        await dbClient.query("ROLLBACK");
        return res.status(400).json({ message: `Plan componente ${comp.planId} no encontrado` });
      }
      const compPlan = compPlanRes.rows[0];
      const conflict = await findNonRepeatablePlanConflict({ userId, plan: compPlan, client: dbClient });
      if (conflict) {
        await dbClient.query("ROLLBACK");
        return res.status(409).json({ message: conflict.message });
      }
      const ins = await dbClient.query(
        `INSERT INTO memberships
           (user_id, plan_id, status, payment_method, start_date, end_date,
            classes_remaining, bundle_parent_id, notes)
         VALUES ($1,$2,'active',$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          userId,
          compPlan.id,
          paymentMethod,
          startStr,
          endStr,
          compPlan.class_limit ?? null,
          bundleParentId,
          `Bundle: ${bundle.name}${comp.label ? ` — ${comp.label}` : ""}`,
        ]
      );
      // First child becomes the parent for the rest (self-referencing tree).
      if (!bundleParentId) bundleParentId = ins.rows[0].id;
      created.push(ins.rows[0]);
    }

    await dbClient.query("COMMIT");

    triggerWalletPassSync(userId, "bundle_created");
    return res.status(201).json({
      data: {
        bundleParentId,
        bundleName: bundle.name,
        memberships: created,
      },
    });
  } catch (err) {
    try { await dbClient.query("ROLLBACK"); } catch (_) {}
    console.error("POST /memberships/bundle error:", err);
    return res.status(500).json({ message: err.message || "Error interno" });
  } finally {
    dbClient.release();
  }
});

// PUT /api/memberships/:id/activate
app.put("/api/memberships/:id/activate", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE memberships SET status = 'active', updated_at = NOW() WHERE id = $1
       RETURNING *, (SELECT name FROM plans WHERE id = memberships.plan_id) AS plan_name,
                    (SELECT class_limit FROM plans WHERE id = memberships.plan_id) AS plan_class_limit`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Membresía no encontrada" });
    const mem = r.rows[0];

    // ── Email: membership activated ──────────────────────────────────────
    try {
      const uRes = await pool.query("SELECT email, display_name, phone FROM users WHERE id = $1", [mem.user_id]);
      if (uRes.rows[0]) {
        const u = uRes.rows[0];
        if (await areEmailNotificationsEnabled()) {
          sendMembershipActivated({
            to: u.email,
            name: u.display_name || "Alumna",
            planName: mem.plan_name || mem.plan_name_override || "Tu membresía",
            startDate: mem.start_date,
            endDate: mem.end_date,
            classLimit: mem.plan_class_limit ?? mem.class_limit_override ?? null,
          }).catch((e) => console.error("[Email] membership activate:", e.message));
        }
        sendConfiguredWhatsAppTemplate({
          templateKey: "membership_activated",
          phone: u.phone,
          vars: {
            name: u.display_name || "Alumna",
            plan: mem.plan_name || mem.plan_name_override || "tu plan",
            startDate: mem.start_date ? new Date(mem.start_date).toLocaleDateString("es-MX") : "",
            endDate: mem.end_date ? new Date(mem.end_date).toLocaleDateString("es-MX") : "",
          },
          fallbackMessage: `Hola ${u.display_name || "Alumna"}, tu membresía ${mem.plan_name || mem.plan_name_override || ""} ya está activa.`,
        }).catch((e) => console.error("[WA] membership activate:", e.message));
        sendConfiguredPushTemplate({
          templateKey: "membership_activated",
          userId: mem.user_id,
          vars: {
            name: u.display_name || "Alumna",
            plan: mem.plan_name || mem.plan_name_override || "tu plan",
            startDate: mem.start_date ? new Date(mem.start_date).toLocaleDateString("es-MX") : "",
            endDate: mem.end_date ? new Date(mem.end_date).toLocaleDateString("es-MX") : "",
          },
        }).catch((e) => console.error("[Push] membership activate:", e.message));
      }
    } catch (emailErr) {
      console.error("[Email] activate query:", emailErr.message);
    }

    triggerWalletPassSync(mem.user_id, "membership_activated");
    return res.json({ data: mem });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// PUT /api/memberships/:id/cancel
app.put("/api/memberships/:id/cancel", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      "UPDATE memberships SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Membresía no encontrada" });
    triggerWalletPassSync(r.rows[0].user_id, "membership_cancelled");
    return res.json({ data: r.rows[0] });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// PUT /api/memberships/:id/credits — admin adjusts classes_remaining
// Body (modo simple): { mode: "set" | "add" | "subtract", value: number, reason?: string }
// Body (modo combo):  { disciplineCredits: { reformer: 8, barre: 4 }, reason?: string }
//   → fija discipline_credits y classes_remaining = sum del map.
app.put("/api/memberships/:id/credits", adminMiddleware, async (req, res) => {
  const { mode = "set", value, reason, disciplineCredits } = req.body || {};

  // Modo combo: disciplineCredits map → fija el desglose y la suma.
  if (disciplineCredits && typeof disciplineCredits === "object" && !Array.isArray(disciplineCredits)) {
    try {
      const cur = await pool.query(
        "SELECT classes_remaining, discipline_credits, user_id FROM memberships WHERE id = $1",
        [req.params.id]
      );
      if (!cur.rows.length) return res.status(404).json({ message: "Membresía no encontrada" });
      const cleanMap = {};
      let total = 0;
      for (const [k, val] of Object.entries(disciplineCredits)) {
        const n = Number(val);
        if (!Number.isFinite(n) || n < 0 || n > 9999) {
          return res.status(400).json({ message: `Valor inválido para "${k}" (0–9999)` });
        }
        cleanMap[String(k).toLowerCase()] = Math.floor(n);
        total += Math.floor(n);
      }
      const before = cur.rows[0].classes_remaining;
      const beforeMap = cur.rows[0].discipline_credits;
      const r = await pool.query(
        `UPDATE memberships
            SET classes_remaining = $1,
                discipline_credits = $2::jsonb,
                updated_at = NOW()
          WHERE id = $3
        RETURNING *`,
        [total, JSON.stringify(cleanMap), req.params.id]
      );
      const adminId = req.userId || null;
      const adminName = adminId
        ? (await pool.query("SELECT display_name FROM users WHERE id = $1", [adminId])).rows[0]?.display_name || "admin"
        : "admin";
      const stamp = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
      const note = `[${stamp}] ${adminName}: créditos por disciplina ${JSON.stringify(beforeMap ?? {})} → ${JSON.stringify(cleanMap)} (total ${before ?? "—"} → ${total})${reason ? ` (${reason})` : ""}`;
      await pool.query(
        `UPDATE memberships SET notes = COALESCE(notes || E'\n', '') || $1 WHERE id = $2`,
        [note, req.params.id]
      ).catch(() => {});
      triggerWalletPassSync(cur.rows[0].user_id, "membership_credits_adjusted");
      return res.json({ data: r.rows[0], before, after: total, disciplineCredits: cleanMap });
    } catch (err) {
      console.error("PUT /memberships/:id/credits (split)", err);
      return res.status(500).json({ message: "Error interno", detail: err.message });
    }
  }

  // Modo simple
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0 || v > 9999) {
    return res.status(400).json({ message: "value inválido (0–9999)" });
  }
  if (!["set", "add", "subtract"].includes(mode)) {
    return res.status(400).json({ message: "mode debe ser set, add o subtract" });
  }
  try {
    const cur = await pool.query("SELECT classes_remaining, user_id FROM memberships WHERE id = $1", [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ message: "Membresía no encontrada" });

    const before = cur.rows[0].classes_remaining;
    let next;
    if (mode === "set") next = v;
    else if (mode === "add") next = (before ?? 0) + v;
    else next = Math.max(0, (before ?? 0) - v);

    const r = await pool.query(
      "UPDATE memberships SET classes_remaining = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
      [next, req.params.id]
    );

    // Audit note: append to existing notes
    const adminId = req.userId || null;
    const adminName = adminId
      ? (await pool.query("SELECT display_name FROM users WHERE id = $1", [adminId])).rows[0]?.display_name || "admin"
      : "admin";
    const stamp = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
    const note = `[${stamp}] ${adminName}: clases ${before ?? "—"} → ${next}${reason ? ` (${reason})` : ""}`;
    await pool.query(
      `UPDATE memberships SET notes = COALESCE(notes || E'\n', '') || $1 WHERE id = $2`,
      [note, req.params.id]
    ).catch(() => {});

    triggerWalletPassSync(cur.rows[0].user_id, "membership_credits_adjusted");
    return res.json({ data: r.rows[0], before, after: next });
  } catch (err) {
    console.error("PUT /memberships/:id/credits", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/memberships/:id/split-bundle — converts an existing combo
// membership (single classes_remaining) into N child memberships, one per
// bundle component. Idempotent: refuses to run if already split.
//
// The original parent gets cancelled with a stamped note. Children inherit
// the parent's start/end dates and start with their full class_limit; the
// admin can fine-tune via "Ajustar créditos" afterwards if some classes
// were already used on the original combo.
app.post("/api/memberships/:id/split-bundle", adminMiddleware, async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const memRes = await dbClient.query(
      `SELECT m.id, m.user_id, m.status, m.start_date, m.end_date, m.payment_method,
              m.bundle_parent_id, p.id AS plan_id, p.name AS plan_name, p.bundle_components
         FROM memberships m
         JOIN plans p ON p.id = m.plan_id
        WHERE m.id = $1
        FOR UPDATE`,
      [req.params.id]
    );
    if (!memRes.rows.length) {
      await dbClient.query("ROLLBACK");
      return res.status(404).json({ message: "Membresía no encontrada" });
    }
    const m = memRes.rows[0];
    if (m.bundle_parent_id) {
      await dbClient.query("ROLLBACK");
      return res.status(400).json({ message: "Esta membresía ya forma parte de un bundle" });
    }
    const rawComps = m.bundle_components;
    const components = Array.isArray(rawComps)
      ? rawComps
      : (typeof rawComps === "string" ? (() => { try { return JSON.parse(rawComps); } catch { return null; } })() : null);
    if (!Array.isArray(components) || components.length === 0) {
      await dbClient.query("ROLLBACK");
      return res.status(400).json({ message: "El plan de esta membresía no tiene componentes de bundle (no es un combo)" });
    }
    // Defensive: if children already exist for this membership, do nothing.
    const existing = await dbClient.query(
      "SELECT id FROM memberships WHERE bundle_parent_id = $1",
      [m.id]
    );
    if (existing.rows.length > 0) {
      await dbClient.query("ROLLBACK");
      return res.status(409).json({ message: "Ya existen membresías hijas para este combo" });
    }

    const startStr = m.start_date ? String(m.start_date).slice(0, 10) : new Date().toISOString().slice(0, 10);
    const endStr = m.end_date ? String(m.end_date).slice(0, 10) : null;

    const created = [];
    let parentId = m.id;
    for (const comp of components) {
      const compPlanRes = await dbClient.query("SELECT * FROM plans WHERE id = $1", [comp.planId]);
      if (!compPlanRes.rows.length) {
        await dbClient.query("ROLLBACK");
        return res.status(400).json({ message: `Plan componente ${comp.planId} no encontrado` });
      }
      const compPlan = compPlanRes.rows[0];
      const ins = await dbClient.query(
        `INSERT INTO memberships
           (user_id, plan_id, status, payment_method, start_date, end_date,
            classes_remaining, bundle_parent_id, notes)
         VALUES ($1,$2,'active',$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          m.user_id,
          compPlan.id,
          m.payment_method || "transfer",
          startStr,
          endStr,
          compPlan.class_limit ?? null,
          parentId,
          `Bundle: ${m.plan_name}${comp.label ? ` — ${comp.label}` : ""} (split desde combo único)`,
        ]
      );
      created.push(ins.rows[0]);
    }

    // Mark original as cancelled with audit note.
    const adminId = req.userId || null;
    const adminName = adminId
      ? (await dbClient.query("SELECT display_name FROM users WHERE id = $1", [adminId])).rows[0]?.display_name || "admin"
      : "admin";
    const stamp = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
    const note = `[${stamp}] ${adminName}: combo dividido en ${created.length} bundle(s). Membresía original cancelada.`;
    await dbClient.query(
      `UPDATE memberships
          SET status = 'cancelled',
              notes = COALESCE(notes || E'\n', '') || $1,
              updated_at = NOW()
        WHERE id = $2`,
      [note, m.id]
    );

    await dbClient.query("COMMIT");
    triggerWalletPassSync(m.user_id, "combo_split_to_bundle");
    return res.json({
      data: { parentId: m.id, created: created.map(camelRow) },
      message: `Combo dividido: ${created.length} membresías creadas`,
    });
  } catch (err) {
    try { await dbClient.query("ROLLBACK"); } catch (_) {}
    console.error("POST /memberships/:id/split-bundle", err.message);
    return res.status(500).json({ message: "Error interno", detail: err.message });
  } finally {
    dbClient.release();
  }
});

// PUT /api/memberships/:id/extend — admin adjusts vigencia (end_date)
// Body: one of:
//   { mode: "set",     endDate: "YYYY-MM-DD" }
//   { mode: "add",     days: number }
//   { mode: "subtract",days: number }
//   { mode: "renew" }                              ← +plan.duration_days desde hoy
// Optional: { reason: string } — appended to notes audit trail.
app.put("/api/memberships/:id/extend", adminMiddleware, async (req, res) => {
  const { mode = "set", endDate: rawEnd, days: rawDays, reason } = req.body || {};
  if (!["set", "add", "subtract", "renew"].includes(mode)) {
    return res.status(400).json({ message: "mode debe ser set, add, subtract o renew" });
  }
  try {
    const cur = await pool.query(
      `SELECT m.id, m.user_id, m.end_date, m.start_date, p.duration_days
         FROM memberships m
         LEFT JOIN plans p ON p.id = m.plan_id
        WHERE m.id = $1`,
      [req.params.id]
    );
    if (!cur.rows.length) return res.status(404).json({ message: "Membresía no encontrada" });
    const row = cur.rows[0];
    const beforeStr = row.end_date ? new Date(row.end_date).toISOString().slice(0, 10) : null;

    let nextStr;
    if (mode === "set") {
      if (!rawEnd) return res.status(400).json({ message: "endDate requerido en mode=set" });
      const m = String(rawEnd).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return res.status(400).json({ message: "endDate debe ser YYYY-MM-DD" });
      nextStr = `${m[1]}-${m[2]}-${m[3]}`;
    } else if (mode === "renew") {
      const days = Number(row.duration_days) || 30;
      const todayStr = new Date().toISOString().slice(0, 10);
      const d = new Date(todayStr + "T12:00:00");
      d.setDate(d.getDate() + days);
      nextStr = d.toISOString().slice(0, 10);
    } else {
      const days = Number(rawDays);
      if (!Number.isFinite(days) || days <= 0 || days > 3650) {
        return res.status(400).json({ message: "days inválido (1–3650)" });
      }
      const baseStr = beforeStr || new Date().toISOString().slice(0, 10);
      const d = new Date(baseStr + "T12:00:00");
      d.setDate(d.getDate() + (mode === "add" ? days : -days));
      nextStr = d.toISOString().slice(0, 10);
    }

    const upd = await pool.query(
      `UPDATE memberships
          SET end_date = $1::date,
              status = CASE WHEN $1::date >= CURRENT_DATE AND status = 'expired' THEN 'active' ELSE status END,
              updated_at = NOW()
        WHERE id = $2
       RETURNING *`,
      [nextStr, req.params.id]
    );

    // Audit
    const adminId = req.userId || null;
    const adminName = adminId
      ? (await pool.query("SELECT display_name FROM users WHERE id = $1", [adminId])).rows[0]?.display_name || "admin"
      : "admin";
    const stamp = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
    const note = `[${stamp}] ${adminName}: vigencia ${beforeStr ?? "—"} → ${nextStr}${reason ? ` (${reason})` : ""}`;
    await pool.query(
      `UPDATE memberships SET notes = COALESCE(notes || E'\n', '') || $1 WHERE id = $2`,
      [note, req.params.id]
    ).catch(() => {});

    triggerWalletPassSync(row.user_id, "membership_extended");
    return res.json({ data: upd.rows[0], before: beforeStr, after: nextStr });
  } catch (err) {
    console.error("PUT /memberships/:id/extend", err);
    return res.status(500).json({ message: "Error interno", detail: err.message });
  }
});

// PUT /api/memberships/:id — update any field
app.put("/api/memberships/:id", adminMiddleware, async (req, res) => {
  try {
    const { status, classesRemaining, endDate, paymentMethod } = req.body;
    const r = await pool.query(
      `UPDATE memberships SET
         status = COALESCE($1, status),
         classes_remaining = COALESCE($2, classes_remaining),
         end_date = COALESCE($3, end_date),
         payment_method = COALESCE($4, payment_method),
         updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [status || null, classesRemaining ?? null, endDate || null, paymentMethod || null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Membresía no encontrada" });
    triggerWalletPassSync(r.rows[0].user_id, "membership_updated");
    return res.json({ data: r.rows[0] });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Plans admin CRUD ────────────────────────────────────────────────────────

// GET /api/plans — public
// (Already exists above as GET /api/plans)

// POST /api/plans — admin (mirror of /api/admin/plans)
// PUT /api/plans/:id
app.put("/api/plans/:id", adminMiddleware, async (req, res) => {
  try {
    const {
      name, description, price, currency, durationDays, classLimit, classCategory,
      features, isActive, sortOrder, isNonTransferable, isNonRepeatable, repeatKey,
      discountPrice, discount_price, time_restriction, timeRestriction,
    } = req.body;
    const validCats = ["reformer", "barre", "pilates", "bienestar", "funcional", "mixto", "all"];
    const cat = validCats.includes(classCategory) ? classCategory : null;
    const nonTransferable = parseBooleanFlag(isNonTransferable ?? req.body.is_non_transferable);
    const nonRepeatable = parseBooleanFlag(isNonRepeatable ?? req.body.is_non_repeatable);
    const safeRepeatKey = nonRepeatable
      ? String(repeatKey ?? req.body.repeat_key ?? "").trim() || null
      : null;
    // features can be array or comma-string — always store as jsonb array
    const featuresArr = Array.isArray(features)
      ? features
      : typeof features === "string" && features.trim()
        ? features.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
    const rawDiscount = discountPrice ?? discount_price;
    const safeDiscount = rawDiscount != null && rawDiscount !== "" ? parseFloat(rawDiscount) : null;
    // time_restriction: only update when key is present in body. null clears it.
    const trKey = Object.prototype.hasOwnProperty.call(req.body, "time_restriction")
      ? "time_restriction"
      : Object.prototype.hasOwnProperty.call(req.body, "timeRestriction")
        ? "timeRestriction"
        : null;
    const trProvided = Boolean(trKey);
    const trRaw = trKey ? req.body[trKey] : null;
    const tr = trProvided ? sanitizeTimeRestriction(trRaw) : null;
    const r = await pool.query(
      `UPDATE plans SET name=$1, description=$2, price=$3, currency=$4, duration_days=$5,
       class_limit=$6, features=$7, is_active=$8, sort_order=$9,
       class_category=COALESCE($10, class_category),
       is_non_transferable=$11, is_non_repeatable=$12, repeat_key=$13,
       discount_price=$15,
       time_restriction = CASE WHEN $17::boolean THEN $16::jsonb ELSE time_restriction END,
       updated_at=NOW()
       WHERE id=$14 RETURNING *`,
      [
        name,
        description || null,
        price,
        currency || "MXN",
        durationDays || 30,
        classLimit ?? null,
        JSON.stringify(featuresArr),
        isActive !== false,
        sortOrder || 0,
        cat,
        nonTransferable,
        nonRepeatable,
        safeRepeatKey,
        req.params.id,
        safeDiscount,
        tr ? JSON.stringify(tr) : null,
        trProvided,
      ]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Plan no encontrado" });
    return res.json({ data: camelRow(r.rows[0]) });
  } catch (err) {
    console.error("[PUT /plans]", err.message);
    return res.status(500).json({ message: "Error interno" });
  }
});

// DELETE /api/plans/:id
app.delete("/api/plans/:id", adminMiddleware, async (req, res) => {
  const cascade = parseBooleanFlag(
    req.query?.cascade ?? req.query?.purgeRelated ?? req.body?.cascade ?? req.body?.purgeRelated
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (cascade) {
      await client.query(
        `UPDATE memberships
            SET order_id = NULL
          WHERE order_id IN (SELECT id FROM orders WHERE plan_id = $1)`,
        [req.params.id]
      ).catch(() => { });
      await client.query("DELETE FROM discount_codes WHERE plan_id = $1", [req.params.id]).catch(() => { });
      await client.query("DELETE FROM memberships WHERE plan_id = $1", [req.params.id]).catch(() => { });
      await client.query("DELETE FROM orders WHERE plan_id = $1", [req.params.id]).catch(() => { });
    }

    const del = await client.query("DELETE FROM plans WHERE id = $1 RETURNING id", [req.params.id]);
    if (!del.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Plan no encontrado" });
    }

    await client.query("COMMIT");
    if (cascade) {
      return res.json({ message: "Plan y datos relacionados eliminados" });
    }
    return res.json({ message: "Plan eliminado" });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => { });
    if (!cascade && err?.code === "23503") {
      try {
        await pool.query("UPDATE plans SET is_active = false, updated_at = NOW() WHERE id = $1", [req.params.id]);
        return res.json({ message: "Plan desactivado (tiene registros asociados)" });
      } catch (softErr) {
        console.error("[DELETE /plans soft-delete]", softErr?.message || softErr);
      }
    }
    console.error("[DELETE /plans]", err.message);
    return res.status(500).json({ message: "Error interno" });
  } finally {
    client.release();
  }
});

// POST /api/plans
app.post("/api/plans", adminMiddleware, async (req, res) => {
  try {
    const {
      name, description, price, currency = "MXN", durationDays = 30, classLimit,
      classCategory, features, isActive = true, sortOrder = 0,
      isNonTransferable, isNonRepeatable, repeatKey,
      discountPrice, discount_price, time_restriction, timeRestriction,
    } = req.body;
    if (!name) return res.status(400).json({ message: "Nombre requerido" });
    const validCats = ["reformer", "barre", "pilates", "bienestar", "funcional", "mixto", "all"];
    const cat = validCats.includes(classCategory) ? classCategory : "all";
    const nonTransferable = parseBooleanFlag(isNonTransferable ?? req.body.is_non_transferable);
    const nonRepeatable = parseBooleanFlag(isNonRepeatable ?? req.body.is_non_repeatable);
    const safeRepeatKey = nonRepeatable
      ? String(repeatKey ?? req.body.repeat_key ?? "").trim() || null
      : null;
    const featuresArr = Array.isArray(features)
      ? features
      : typeof features === "string" && features.trim()
        ? features.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
    const rawDiscount = discountPrice ?? discount_price;
    const safeDiscount = rawDiscount != null && rawDiscount !== "" ? parseFloat(rawDiscount) : null;
    const tr = sanitizeTimeRestriction(time_restriction ?? timeRestriction);
    const r = await pool.query(
      `INSERT INTO plans
        (name, description, price, currency, duration_days, class_limit, class_category, features, is_active, sort_order, is_non_transferable, is_non_repeatable, repeat_key, discount_price, time_restriction)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        name,
        description || null,
        price || 0,
        currency,
        durationDays,
        classLimit ?? null,
        cat,
        JSON.stringify(featuresArr),
        isActive,
        sortOrder,
        nonTransferable,
        nonRepeatable,
        safeRepeatKey,
        safeDiscount,
        tr ? JSON.stringify(tr) : null,
      ]
    );
    return res.status(201).json({ data: camelRow(r.rows[0]) });
  } catch (err) {
    console.error("[POST /plans]", err.message);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Bookings admin ──────────────────────────────────────────────────────────

// GET /api/bookings — admin sees all
app.get("/api/bookings", adminMiddleware, async (req, res) => {
  try {
    const { status, classId, userId, limit = 100 } = req.query;
    let q = `SELECT b.*, u.display_name AS user_name, (c.date || 'T' || c.start_time || '-06:00') AS start_time,
                    to_char(c.date, 'YYYY-MM-DD') AS class_date, ct.name AS class_name
             FROM bookings b
             LEFT JOIN users u ON b.user_id = u.id
             LEFT JOIN classes c ON b.class_id = c.id
             LEFT JOIN class_types ct ON c.class_type_id = ct.id
             WHERE 1=1`;
    const params = [];
    if (userId) { params.push(userId); q += ` AND b.user_id = $${params.length}`; }
    if (status) { params.push(status); q += ` AND b.status = $${params.length}`; }
    if (classId) { params.push(classId); q += ` AND b.class_id = $${params.length}`; }
    params.push(parseInt(limit)); q += ` ORDER BY b.created_at DESC LIMIT $${params.length}`;
    const r = await pool.query(q, params);
    return res.json({ data: r.rows.map(b => ({ ...b, userName: b.user_name, className: b.class_name, startTime: b.start_time, classDate: b.class_date })) });
  } catch (err) {
    console.error("GET /bookings error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/admin/clients/:id/reschedules — a client's reschedule history (newest first)
app.get("/api/admin/clients/:id/reschedules", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT r.id, r.created_at,
              fc.date AS from_date, fc.start_time AS from_time, fct.name AS from_class,
              tc.date AS to_date,   tc.start_time AS to_time,   tct.name AS to_class
       FROM booking_reschedules r
       LEFT JOIN classes fc ON r.from_class_id = fc.id
       LEFT JOIN class_types fct ON fc.class_type_id = fct.id
       LEFT JOIN classes tc ON r.to_class_id = tc.id
       LEFT JOIN class_types tct ON tc.class_type_id = tct.id
       WHERE r.user_id = $1
       ORDER BY r.created_at DESC`,
      [req.params.id]
    );
    return res.json({ data: r.rows });
  } catch (err) {
    console.error("GET /admin/clients/:id/reschedules error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/admin/bookings/assign — admin assigns a class booking to a specific member
app.post("/api/admin/bookings/assign", adminMiddleware, async (req, res) => {
  const { classId, userId } = req.body;
  if (!classId || !userId) return res.status(400).json({ message: "classId y userId requeridos" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // c.date and c.start_time are required by checkPlanTimeRestriction below;
    // without them the day-of-week check coerces to NaN and Morning Pass / other
    // time-windowed plans get blocked with their custom error message even when
    // the class is actually within the allowed window.
    const classRes = await client.query(
      `SELECT c.id, c.max_capacity, c.current_bookings, c.status, c.date, c.start_time,
              ct.category AS class_category
       FROM classes c
       JOIN class_types ct ON c.class_type_id = ct.id
       WHERE c.id = $1
       FOR UPDATE`,
      [classId]
    );
    if (classRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Clase no encontrada" });
    }
    const cls = classRes.rows[0];
    if (cls.status === "cancelled") {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Esta clase fue cancelada" });
    }

    const clsCategory = normalizeClassCategory(cls.class_category, "all");
    const membership = await selectMembershipForClass({
      userId,
      classCategory: clsCategory,
      classDate: cls.date,
      classStartTime: cls.start_time,
      client,
    });
    if (!membership) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "La clienta no tiene membresía activa con créditos para esta clase" });
    }

    const lockedMembershipRes = await client.query(
      "SELECT id, classes_remaining FROM memberships WHERE id = $1 FOR UPDATE",
      [membership.id]
    );
    const lockedMembership = lockedMembershipRes.rows[0];
    if (!lockedMembership) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "No se encontró una membresía válida para esta clase" });
    }

    if (!isMembershipCategoryCompatible(membership.class_category, clsCategory)) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        message: `La membresía de la clienta no incluye este tipo de clase.`,
      });
    }

    // Admin assigns bypass trial-slot and time-window restrictions.
    // The owner may intentionally place a trial or Morning Pass member
    // outside the normal self-service windows; blocking here gives a
    // confusing "Error interno" if checkPlanTimeRestriction throws on
    // an edge-case membership. Self-service (/api/bookings) still enforces.

    if (!isUnlimitedClasses(lockedMembership.classes_remaining) && Number(lockedMembership.classes_remaining) <= 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        message: "La clienta ya no tiene clases disponibles en su membresía.",
      });
    }

    const dupRes = await client.query(
      "SELECT id FROM bookings WHERE class_id = $1 AND user_id = $2 AND status != 'cancelled'",
      [classId, userId]
    );
    if (dupRes.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "La clienta ya tiene una reserva para esta clase" });
    }

    const isWaitlist = cls.current_bookings >= cls.max_capacity;
    const bookingStatus = isWaitlist ? "waitlist" : "confirmed";
    const result = await client.query(
      `INSERT INTO bookings (class_id, user_id, membership_id, status)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [classId, userId, membership.id, bookingStatus]
    );

    if (!isWaitlist) {
      await client.query(
        "UPDATE classes SET current_bookings = current_bookings + 1 WHERE id = $1",
        [classId]
      );
      if (!isUnlimitedClasses(lockedMembership.classes_remaining)) {
        await consumeMembershipCredit(client, membership.id, clsCategory);
      }
    }
    await client.query("COMMIT");

    try {
      const userRes = await pool.query("SELECT email, display_name, phone FROM users WHERE id = $1", [userId]);
      const classFullRes = await pool.query(
        `SELECT c.date, c.start_time, ct.name AS class_type_name,
                i.display_name AS instructor_name
         FROM classes c
         JOIN class_types ct ON c.class_type_id = ct.id
         LEFT JOIN instructors i ON c.instructor_id = i.id
         WHERE c.id = $1`,
        [classId]
      );
      const memAfter = await pool.query("SELECT classes_remaining FROM memberships WHERE id = $1", [membership.id]);
      const classesLeft = memAfter.rows[0]?.classes_remaining ?? null;

      if (userRes.rows[0] && classFullRes.rows[0]) {
        const u = userRes.rows[0];
        const cl = classFullRes.rows[0];
        if (await areEmailNotificationsEnabled()) {
          sendBookingConfirmed({
            to: u.email,
            name: u.display_name || "Alumna",
            className: cl.class_type_name,
            date: cl.date,
            startTime: cl.start_time,
            instructor: cl.instructor_name,
            classesLeft,
            isWaitlist,
          }).catch((e) => console.error("[Email] booking confirmed (admin):", e.message));
        }
        const waName = u.display_name || "Alumna";
        const waClass = cl.class_type_name || "tu clase";
        const waDate = cl.date ? new Date(cl.date).toLocaleDateString("es-MX") : "";
        const waTime = cl.start_time ? String(cl.start_time).slice(0, 5) : "";
        sendConfiguredWhatsAppTemplate({
          templateKey: isWaitlist ? "booking_waitlist" : "booking_confirmed",
          phone: u.phone,
          vars: { name: waName, class: waClass, date: waDate, time: waTime },
          fallbackMessage: isWaitlist
            ? waitlistJoinFallback(waName, waClass, waDate, waTime)
            : `Hola ${waName}, tu reserva para ${waClass} (${waDate} ${waTime}) está confirmada.`,
        }).catch((e) => console.error("[WA] booking confirmed (admin):", e.message));
      }
    } catch (emailErr) {
      console.error("[Email] booking confirmed (admin) query error:", emailErr.message);
    }

    const message = isWaitlist
      ? "Clienta agregada a lista de espera"
      : "Reserva asignada correctamente";
    triggerWalletPassSync(userId, isWaitlist ? "admin_booking_waitlist_created" : "admin_booking_created");
    return res.status(201).json({ message, data: { booking: result.rows[0], isWaitlist } });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { }
    console.error("POST /admin/bookings/assign error:", err?.stack || err?.message || err);
    // Unique constraint violation — e.g. re-booking a user who already has
    // (or had) a booking for this class. Return a 409 with a clear message
    // instead of the generic 500.
    if (err?.code === "23505") {
      return res.status(409).json({ message: "La clienta ya tiene una reserva registrada para esta clase (incluyendo canceladas). Verifica el historial." });
    }
    return res.status(500).json({ message: "Error interno al asignar reserva" });
  } finally {
    client.release();
  }
});

// POST /api/admin/bookings/bulk-month
// Reserva en lote todas las ocurrencias de un slot recurrente (schedule_slot)
// para las fechas seleccionadas de un mes. Pensado para el flujo donde una
// clienta con suscripción mensual asiste a un horario fijo.
//
// Body: { userId, scheduleSlotId, selectedDates: ['YYYY-MM-DD', ...] }
//
// Match por atributo (class_type + hora + día de semana), NO por FK schedule_id
// (que puede venir inconsistente en classes generadas fuera del flujo normal).
// No filtra por instructor: los instructores rotan semana a semana.
app.post("/api/admin/bookings/bulk-month", adminMiddleware, async (req, res) => {
  const { userId, scheduleSlotId, selectedDates } = req.body || {};
  if (!userId || !scheduleSlotId) {
    return res.status(400).json({ message: "userId y scheduleSlotId requeridos" });
  }
  if (!Array.isArray(selectedDates) || selectedDates.length === 0) {
    return res.status(400).json({ message: "Selecciona al menos una fecha" });
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  const cleanDates = [...new Set(selectedDates)].filter(d => dateRegex.test(d));
  if (cleanDates.length === 0) {
    return res.status(400).json({ message: "Formato de fechas inválido (usa YYYY-MM-DD)" });
  }
  // Cap defensivo: un mes natural tiene máximo 31 días, y para un slot
  // recurrente con mismo day_of_week son ~5. 31 cubre con margen y evita
  // que un payload abusivo tenga la transacción con FOR UPDATE durante mucho.
  if (cleanDates.length > 31) {
    return res.status(400).json({ message: "Máximo 31 fechas por operación" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const slotRes = await client.query(
      `SELECT ss.id, ss.time_slot, ss.day_of_week, ss.class_type_id, ss.class_type_name,
              ct.id AS resolved_ct_id, ct.category AS class_category
         FROM schedule_slots ss
         LEFT JOIN class_types ct
                ON ct.id = ss.class_type_id
                OR (ss.class_type_id IS NULL AND LOWER(TRIM(ct.name)) = LOWER(TRIM(ss.class_type_name)))
        WHERE ss.id = $1
        LIMIT 1`,
      [scheduleSlotId]
    );
    if (slotRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Horario no encontrado" });
    }
    const slot = slotRes.rows[0];
    const classTypeId = slot.class_type_id || slot.resolved_ct_id;
    if (!classTypeId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "El horario no tiene un tipo de clase válido" });
    }

    const startTime24 = parseTimeSlotTo24Hour(slot.time_slot);
    if (!startTime24) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Hora del horario inválida" });
    }

    const dayOfWeekSqlStyle = slot.day_of_week === 7 ? 0 : slot.day_of_week; // schedule_slots: Mon=1..Sun=7; EXTRACT DOW: Sun=0..Sat=6
    const clsCategory = normalizeClassCategory(slot.class_category, "all");

    // Candidatos: match por class_type + hora + día de semana, restringido a las fechas seleccionadas.
    // Incluye FOR UPDATE para bloquear current_bookings mientras insertamos.
    const candidatesRes = await client.query(
      `SELECT c.id, c.date, c.start_time, c.current_bookings, c.max_capacity, c.status
         FROM classes c
        WHERE c.class_type_id = $1
          AND SUBSTRING(c.start_time::text, 1, 5) = $2
          AND EXTRACT(DOW FROM c.date) = $3
          AND c.date = ANY($4::date[])
          AND c.status = 'scheduled'
        ORDER BY c.date ASC
        FOR UPDATE`,
      [classTypeId, startTime24, dayOfWeekSqlStyle, cleanDates]
    );

    const allCandidates = candidatesRes.rows;
    const foundDates = new Set(allCandidates.map(c => toDbDateString(new Date(c.date))));
    const missingDates = cleanDates.filter(d => !foundDates.has(d));

    if (allCandidates.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: "No se encontraron clases programadas en las fechas seleccionadas",
        missingDates,
      });
    }

    // Excluir clases ya reservadas por esta clienta (no duplicar).
    const candidateIds = allCandidates.map(c => c.id);
    const existingRes = await client.query(
      `SELECT class_id FROM bookings
        WHERE user_id = $1 AND class_id = ANY($2::uuid[]) AND status != 'cancelled'`,
      [userId, candidateIds]
    );
    const alreadyBooked = new Set(existingRes.rows.map(r => r.class_id));

    // Clases disponibles (no llenas, no ya reservadas).
    const bookable = [];
    const full = [];
    const duplicates = [];
    for (const cls of allCandidates) {
      if (alreadyBooked.has(cls.id)) {
        duplicates.push({ classId: cls.id, date: toDbDateString(new Date(cls.date)) });
        continue;
      }
      if (cls.current_bookings >= cls.max_capacity) {
        full.push({ classId: cls.id, date: toDbDateString(new Date(cls.date)) });
        continue;
      }
      bookable.push(cls);
    }

    if (bookable.length === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "Ninguna clase disponible: todas están llenas o ya reservadas",
        missingDates,
        full,
        duplicates,
      });
    }

    // Selección de membresía: usa la mejor compatible con la categoría.
    // Si classes_remaining es NULL/ilimitada, toma esa. Si no, debe tener >= bookable.length.
    const needed = bookable.length;
    const memRes = await client.query(
      `SELECT m.id, m.classes_remaining, m.end_date,
              COALESCE(p.class_category, 'all') AS class_category,
              p.time_restriction
         FROM memberships m
         LEFT JOIN plans p ON p.id = m.plan_id
        WHERE m.user_id = $1
          AND m.status = 'active'
          AND (m.end_date IS NULL OR m.end_date >= CURRENT_DATE)
          AND (
            COALESCE(p.class_category, 'all') IN ('all', 'mixto')
            OR COALESCE(p.class_category, 'all') = $2
          )
          AND (
            m.classes_remaining IS NULL
            OR m.classes_remaining >= 9999
            OR m.classes_remaining >= $3
          )
        ORDER BY
          CASE WHEN m.classes_remaining IS NULL OR m.classes_remaining >= 9999 THEN 1 ELSE 0 END ASC,
          CASE WHEN m.end_date IS NULL THEN 1 ELSE 0 END ASC,
          m.end_date ASC,
          m.created_at ASC
        LIMIT 1
        FOR UPDATE`,
      [userId, clsCategory, needed]
    );
    const membership = memRes.rows[0];
    // Filter bookable by membership time-restriction (e.g. Morning Pass).
    // Classes outside the allowed window are removed from this batch and
    // returned in skipped.outOfWindow.
    const outOfWindow = [];
    if (membership?.time_restriction) {
      const stillBookable = [];
      for (const cls of bookable) {
        const tc = checkPlanTimeRestriction(membership, cls.date, cls.start_time);
        if (tc.allowed) stillBookable.push(cls);
        else outOfWindow.push({ classId: cls.id, date: toDbDateString(new Date(cls.date)), reason: tc.message });
      }
      bookable.length = 0;
      bookable.push(...stillBookable);
    }
    if (!membership) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        message: `Se necesitan ${needed} créditos; la clienta no tiene una membresía activa con ese saldo para esta categoría de clase.`,
        needed,
      });
    }

    const unlimited = isUnlimitedClasses(membership.classes_remaining);

    // Transacción: insertar bookings + sumar current_bookings + restar créditos.
    const createdBookings = [];
    for (const cls of bookable) {
      const ins = await client.query(
        `INSERT INTO bookings (class_id, user_id, membership_id, status)
         VALUES ($1, $2, $3, 'confirmed') RETURNING id`,
        [cls.id, userId, membership.id]
      );
      createdBookings.push({ bookingId: ins.rows[0].id, classId: cls.id, date: toDbDateString(new Date(cls.date)) });
      await client.query(
        `UPDATE classes SET current_bookings = current_bookings + 1 WHERE id = $1`,
        [cls.id]
      );
    }

    if (!unlimited) {
      await client.query(
        `UPDATE memberships
            SET classes_remaining = GREATEST(classes_remaining - $1, 0),
                updated_at = NOW()
          WHERE id = $2`,
        [createdBookings.length, membership.id]
      );
    }

    await client.query("COMMIT");

    triggerWalletPassSync(userId, "admin_bulk_month_booking_created");

    return res.status(201).json({
      message: `${createdBookings.length} reserva(s) creada(s)`,
      data: {
        booked: createdBookings.length,
        bookings: createdBookings,
        membershipId: membership.id,
        creditsRemaining: unlimited ? null : Math.max(0, (membership.classes_remaining ?? 0) - createdBookings.length),
        skipped: {
          missingDates,
          full,
          duplicates,
          outOfWindow,
        },
      },
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { }
    console.error("POST /admin/bookings/bulk-month error:", err);
    return res.status(500).json({ message: "Error interno" });
  } finally {
    client.release();
  }
});

// PUT /api/bookings/:id/check-in
app.put("/api/bookings/:id/check-in", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      "UPDATE bookings SET status = 'checked_in', checked_in_at = NOW() WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Reserva no encontrada" });
    const booking = r.rows[0];
    // Award loyalty points for attending a class
    if (booking.user_id) {
      try {
        const cfgRes = await pool.query("SELECT value FROM settings WHERE key='loyalty_config' LIMIT 1");
        const cfg = cfgRes.rows.length ? cfgRes.rows[0].value : {};
        const pts = cfg.points_per_class ?? 10;
        if (cfg.enabled !== false && pts > 0) {
          await pool.query(
            "INSERT INTO loyalty_transactions (user_id, type, points, description) VALUES ($1, 'earn', $2, 'Clase asistida')",
            [booking.user_id, pts]
          );
        }
      } catch (e) { /* loyalty earn error shouldn't fail check-in */ }
    }
    triggerWalletPassSync(booking.user_id, "booking_checked_in");
    return res.json({ data: r.rows[0] });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// PUT /api/bookings/:id/no-show
app.put("/api/bookings/:id/no-show", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      "UPDATE bookings SET status = 'no_show' WHERE id = $1 AND status NOT IN ('cancelled','no_show') RETURNING *",
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Reserva no encontrada o ya procesada" });
    triggerWalletPassSync(r.rows[0].user_id, "booking_no_show");
    return res.json({ data: r.rows[0] });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// PUT /api/admin/bookings/:id/cancel — admin cancels a booking
// Applies the same cancellation rules as the client-facing DELETE /api/bookings/:id:
//   • respects the global "cancellations enabled" flag
//   • counts against and enforces the per-membership cancellation limit
//   • credit is refunded only inside the advance-notice window AND when the
//     refund_credit_on_cancel config flag is on; a late admin cancel frees the
//     spot but does NOT return the credit (treated as a class taken)
// Pass `?force=1` (or { force: true } in the body) to override the limit and
// the disabled flag for genuine exceptions — still respects the late-cancel
// no-refund rule.
app.put("/api/admin/bookings/:id/cancel", adminMiddleware, async (req, res) => {
  const force = req.query.force === "1" || req.query.force === "true" || req.body?.force === true;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const booking = await client.query(
      `SELECT b.*, c.date, c.start_time,
              (c.date + c.start_time::time) AT TIME ZONE 'America/Mexico_City' AS class_start_utc
         FROM bookings b
         JOIN classes c ON b.class_id = c.id
        WHERE b.id = $1
        FOR UPDATE`,
      [req.params.id]
    );
    if (!booking.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Reserva no encontrada" });
    }
    const b = booking.rows[0];
    if (b.status === "cancelled") {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Ya está cancelada" });
    }

    // ── Load cancellation config + cancelling membership ──────────────────────
    const cancelConfig = await getCancellationConfig();
    let membership = null;
    if (b.membership_id) {
      const memRes = await client.query(
        "SELECT id, classes_remaining, cancellations_used FROM memberships WHERE id = $1 FOR UPDATE",
        [b.membership_id]
      );
      membership = memRes.rows[0] ?? null;
    }

    // Global kill-switch — same as the client endpoint, but admins can force.
    if (!cancelConfig.enabled && !force) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        code: "CANCELLATIONS_DISABLED",
        message: "Las cancelaciones están deshabilitadas. Reactívalas en Configuración o usa la opción de forzar.",
      });
    }

    // Per-membership cancellation limit — applies to confirmed bookings only
    // (waitlist cancels don't consume the limit). Admin can force past it.
    const cancelLimit = Number(cancelConfig.cancellations_limit) || 0;
    const willCount = b.status === "confirmed" && !!membership;
    if (willCount && cancelLimit > 0 && (membership.cancellations_used ?? 0) >= cancelLimit && !force) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        code: "CANCELLATIONS_LIMIT_REACHED",
        message: `La clienta ya alcanzó el límite de ${cancelLimit} cancelacion${cancelLimit === 1 ? "" : "es"} de su membresía. Usa la opción de forzar si es una excepción.`,
      });
    }

    // Advance-notice window. A late cancel is allowed (admin frees the spot)
    // but the credit is NOT refunded — same intent as the client policy text
    // ("se tomará como clase impartida").
    const classStartUTC = b.class_start_utc ? new Date(b.class_start_utc) : null;
    const minutesUntilClass = classStartUTC
      ? (classStartUTC.getTime() - Date.now()) / 60_000
      : 999;
    const minMinutes = (Number(cancelConfig.min_hours) || 0) * 60;
    const isLate = minMinutes > 0 && minutesUntilClass < minMinutes;
    const refundConfigured = cancelConfig.refund_credit_on_cancel !== false;
    const shouldRefund = refundConfigured && !isLate;

    await client.query(
      "UPDATE bookings SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = 'admin' WHERE id = $1",
      [req.params.id]
    );

    let promotedBookingId = null;
    if (b.status === "confirmed" || b.status === "checked_in") {
      // Free the class spot
      await client.query(
        "UPDATE classes SET current_bookings = GREATEST(current_bookings - 1, 0) WHERE id = $1",
        [b.class_id]
      );

      // Count this cancellation against the membership's limit (confirmed only).
      if (willCount) {
        await client.query(
          "UPDATE memberships SET cancellations_used = COALESCE(cancellations_used, 0) + 1 WHERE id = $1",
          [b.membership_id]
        );
      }

      // Restore credit only when in-window and refund is configured.
      if (shouldRefund && membership) {
        await client.query(
          `UPDATE memberships SET classes_remaining = classes_remaining + 1
            WHERE id = $1 AND classes_remaining IS NOT NULL AND classes_remaining < 9999`,
          [b.membership_id]
        );
      }

      // La auto-promoción de la lista de espera ocurre DESPUÉS del COMMIT, vía
      // promoteWaitlist (abre su propia transacción atómica con lock de la clase).
    }

    await client.query("COMMIT");

    // Auto-promover la lista de espera si esta cancelación liberó un lugar.
    if (b.status === "confirmed" || b.status === "checked_in") {
      const promoted = await promoteWaitlist(b.class_id);
      promotedBookingId = promoted?.bookingId ?? null;
    }

    triggerWalletPassSync(b.user_id, "booking_cancelled_by_admin");
    if (promotedBookingId) {
      const promotedUserRes = await pool.query("SELECT user_id FROM bookings WHERE id = $1", [promotedBookingId]);
      const promotedUserId = promotedUserRes.rows[0]?.user_id;
      if (promotedUserId) {
        triggerWalletPassSync(promotedUserId, "booking_promoted_from_waitlist");
        // Avisar a la alumna que se liberó su lugar y ya está confirmada.
        notifyWaitlistPromotion(promotedUserId, b.class_id).catch(() => {});
      }
    }
    const msg = shouldRefund
      ? "Reserva cancelada y crédito devuelto."
      : (isLate
          ? "Reserva cancelada. Crédito no devuelto: la cancelación quedó fuera de la ventana de anticipación."
          : "Reserva cancelada. Crédito no devuelto (reembolso desactivado en Configuración).");
    return res.json({
      data: {
        message: msg,
        creditRefunded: !!shouldRefund,
        countedAgainstLimit: !!willCount,
        forced: !!force,
        promotedFromWaitlist: !!promotedBookingId,
      },
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { }
    console.error("PUT /admin/bookings/:id/cancel error:", err);
    return res.status(500).json({ message: "Error interno" });
  } finally {
    client.release();
  }
});

// GET /api/classes/:id/roster — lista de alumnos reservados en una clase
app.get("/api/classes/:id/roster", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT b.id AS booking_id, b.status, b.checked_in_at, b.guest_name,
              u.id AS user_id, u.display_name, u.email, u.phone,
              m.plan_id, p.name AS plan_name, m.classes_remaining
       FROM bookings b
       LEFT JOIN users u ON b.user_id = u.id
       LEFT JOIN memberships m ON b.membership_id = m.id
       LEFT JOIN plans p ON m.plan_id = p.id
       WHERE b.class_id = $1 AND b.status != 'cancelled'
       ORDER BY CASE b.status
         WHEN 'confirmed'  THEN 1
         WHEN 'checked_in' THEN 2
         WHEN 'waitlist'   THEN 3
         WHEN 'no_show'    THEN 4
         ELSE 5 END,
         COALESCE(u.display_name, b.guest_name) ASC`,
      [req.params.id]
    );
    // Also get class info
    const cls = await pool.query(
      `SELECT c.*, ct.name AS class_type_name, ct.color,
              i.display_name AS instructor_name,
              (c.date || 'T' || c.start_time || '-06:00') AS starts_at
       FROM classes c
       JOIN class_types ct ON c.class_type_id = ct.id
       JOIN instructors i ON c.instructor_id = i.id
       WHERE c.id = $1`,
      [req.params.id]
    );
    return res.json({ data: { class: camelRow(cls.rows[0] ?? {}), roster: r.rows.map(camelRow) } });
  } catch (err) {
    console.error("[GET /classes/:id/roster]", err.message);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/admin/classes/:id/walkin — bloquea un lugar + registra cobro de walk-in
app.post("/api/admin/classes/:id/walkin", adminMiddleware, async (req, res) => {
  const classId = req.params.id;
  const { name, phone, planId, paymentMethod: rawPM, amount } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ message: "Se requiere el nombre del invitado" });

  const client = await pool.connect();
  try {
    // Idempotent: defensive ALTERs in case migrations didn't run on this DB.
    // These are no-ops if columns/constraints already match.
    await client.query(`ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL`).catch(() => { });
    await client.query(`ALTER TABLE orders ALTER COLUMN plan_id DROP NOT NULL`).catch(() => { });
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_name TEXT`).catch(() => { });
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_phone TEXT`).catch(() => { });
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel VARCHAR(30) DEFAULT 'web'`).catch(() => { });
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE`).catch(() => { });
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS approved_by UUID`).catch(() => { });
    await client.query(`ALTER TABLE bookings ALTER COLUMN user_id DROP NOT NULL`).catch(() => { });
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_name TEXT`).catch(() => { });
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_phone TEXT`).catch(() => { });
    await client.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE SET NULL`).catch(() => { });

    await client.query("BEGIN");

    const cls = await client.query("SELECT id, current_bookings, max_capacity, status FROM classes WHERE id = $1 FOR UPDATE", [classId]);
    if (!cls.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Clase no encontrada" }); }
    const c = cls.rows[0];
    if (c.status === "cancelled") { await client.query("ROLLBACK"); return res.status(400).json({ message: "Esta clase fue cancelada" }); }
    if ((c.current_bookings ?? 0) >= (c.max_capacity ?? 0)) { await client.query("ROLLBACK"); return res.status(409).json({ message: "La clase está llena" }); }

    const guestName = String(name).trim();
    const guestPhone = phone ? normalizePhoneForStorage(String(phone).trim()) : null;

    // Create order if payment info provided
    let orderId = null;
    const amt = Number(amount);
    if (Number.isFinite(amt) && amt > 0) {
      const paymentMethod = normalizePaymentMethod(rawPM || "cash");
      const orderRes = await client.query(
        `INSERT INTO orders (user_id, plan_id, status, payment_method, subtotal, total_amount,
                             guest_name, guest_phone, channel, paid_at, approved_at, approved_by, verified_at, verified_by)
         VALUES (NULL, $1, 'approved', $2, $3, $3, $4, $5, 'walkin', NOW(), NOW(), $6, NOW(), $6)
         RETURNING id`,
        [planId || null, paymentMethod, amt, guestName, guestPhone, req.userId || null]
      );
      orderId = orderRes.rows[0].id;
    }

    const bookingRes = await client.query(
      `INSERT INTO bookings (class_id, user_id, guest_name, guest_phone, order_id, status)
       VALUES ($1, NULL, $2, $3, $4, 'confirmed') RETURNING *`,
      [classId, guestName, guestPhone, orderId]
    );
    await client.query("UPDATE classes SET current_bookings = current_bookings + 1 WHERE id = $1", [classId]);

    await client.query("COMMIT");
    return res.json({ data: { ...bookingRes.rows[0], orderId } });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[POST /admin/classes/:id/walkin]", err.code, err.message);
    return res.status(500).json({ message: "Error al bloquear lugar", detail: err.message, code: err.code });
  } finally {
    client.release();
  }
});

// GET /api/admin/walkins/by-phone?phone=xxx — busca compras previas de invitadas por teléfono
app.get("/api/admin/walkins/by-phone", adminMiddleware, async (req, res) => {
  const raw = String(req.query.phone || "").trim();
  if (!raw) return res.json({ data: [] });
  const normalized = normalizePhoneForStorage(raw);
  try {
    const r = await pool.query(
      `SELECT o.id, o.total_amount, o.payment_method, o.paid_at, o.created_at,
              o.guest_name, o.guest_phone,
              p.name AS plan_name
       FROM orders o
       LEFT JOIN plans p ON p.id = o.plan_id
       WHERE o.user_id IS NULL AND o.guest_phone = $1
       ORDER BY o.created_at DESC`,
      [normalized]
    );
    return res.json({ data: r.rows.map(camelRow) });
  } catch (err) {
    console.error("[GET /admin/walkins/by-phone]", err.message);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/admin/walkins/link — vincula órdenes y bookings de invitada a un usuario
app.post("/api/admin/walkins/link", adminMiddleware, async (req, res) => {
  const { userId, phone } = req.body;
  if (!userId || !phone) return res.status(400).json({ message: "userId y phone son requeridos" });
  const normalized = normalizePhoneForStorage(String(phone).trim());
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ordersUpd = await client.query(
      `UPDATE orders SET user_id = $1, guest_name = NULL, guest_phone = NULL
       WHERE user_id IS NULL AND guest_phone = $2 RETURNING id`,
      [userId, normalized]
    );
    const bookingsUpd = await client.query(
      `UPDATE bookings SET user_id = $1, guest_name = NULL, guest_phone = NULL
       WHERE user_id IS NULL AND guest_phone = $2 RETURNING id`,
      [userId, normalized]
    );
    await client.query("COMMIT");
    return res.json({
      data: { ordersLinked: ordersUpd.rowCount, bookingsLinked: bookingsUpd.rowCount },
      message: `Vinculado: ${ordersUpd.rowCount} pago(s) y ${bookingsUpd.rowCount} reserva(s)`,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[POST /admin/walkins/link]", err.message);
    return res.status(500).json({ message: "Error interno" });
  } finally {
    client.release();
  }
});

// POST /api/admin/classes/reconcile-counts — recalcula current_bookings de
// todas las clases (futuras y recientes) a partir del recuento real de
// reservas activas. Útil cuando el contador queda desincronizado por bugs
// históricos. Devuelve cuántas clases se ajustaron.
app.post("/api/admin/classes/reconcile-counts", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`
      WITH actual AS (
        SELECT c.id AS class_id,
               COALESCE(COUNT(b.id) FILTER (WHERE b.status IN ('confirmed','checked_in')), 0)::int AS cnt
        FROM classes c
        LEFT JOIN bookings b ON b.class_id = c.id
        GROUP BY c.id
      )
      UPDATE classes c
      SET current_bookings = a.cnt
      FROM actual a
      WHERE c.id = a.class_id AND c.current_bookings IS DISTINCT FROM a.cnt
      RETURNING c.id
    `);
    return res.json({ data: { fixed: r.rowCount }, message: `${r.rowCount} clase(s) reconciliadas` });
  } catch (err) {
    console.error("[reconcile-counts]", err.message);
    return res.status(500).json({ message: "Error interno", detail: err.message });
  }
});

// DELETE /api/admin/bookings/:id/walkin — cancela un lugar bloqueado (walk-in)
app.delete("/api/admin/bookings/:id/walkin", adminMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const b = await client.query(
      "SELECT id, class_id, status FROM bookings WHERE id = $1 AND user_id IS NULL FOR UPDATE",
      [req.params.id]
    );
    if (!b.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Reserva walk-in no encontrada" });
    }
    const row = b.rows[0];
    // Idempotent: if already cancelled, do nothing (don't double-decrement).
    if (row.status === "cancelled") {
      await client.query("ROLLBACK");
      return res.json({ ok: true, alreadyCancelled: true });
    }
    await client.query(
      "UPDATE bookings SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1",
      [req.params.id]
    );
    // Only decrement if the walk-in was actually counted in current_bookings.
    if (row.status === "confirmed" || row.status === "checked_in") {
      await client.query(
        "UPDATE classes SET current_bookings = GREATEST(current_bookings - 1, 0) WHERE id = $1",
        [row.class_id]
      );
    }
    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[DELETE /admin/bookings/:id/walkin]", err.message);
    return res.status(500).json({ message: "Error interno", detail: err.message });
  } finally {
    client.release();
  }
});

// POST /api/admin/clients/manual — crea clienta + membresía en un solo paso (sin que use la app)
app.post("/api/admin/clients/manual", adminMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      displayName, email, phone, dateOfBirth,
      emergencyContactName, emergencyContactPhone, healthNotes,
      planId, paymentMethod: rawPM = "cash", startDate,
      notes, complementType,
    } = req.body;
    const paymentMethod = normalizePaymentMethod(rawPM);
    if (!displayName) return res.status(400).json({ message: "Nombre es requerido" });

    await client.query("BEGIN");

    // 1. Create user (random password — they can reset later)
    // If no email provided, generate a placeholder so the unique constraint is satisfied
    const finalEmail = email
      ? email.toLowerCase().trim()
      : `sin-correo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@puntoneutro.local`;
    const tempPassword = Math.random().toString(36).slice(2, 10) + "Op1!";
    const hash = await bcrypt.hash(tempPassword, 10);
    const userRes = await client.query(
      `INSERT INTO users (display_name, email, phone, date_of_birth, emergency_contact_name,
        emergency_contact_phone, health_notes, role, password_hash, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'client',$8,true)
       ON CONFLICT (email) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         phone = EXCLUDED.phone,
         updated_at = NOW()
       RETURNING id, display_name, email`,
      [displayName, finalEmail, normalizePhoneForStorage(phone), dateOfBirth || null,
        emergencyContactName || null, emergencyContactPhone || null, healthNotes || null, hash]
    );
    const user = userRes.rows[0];

    // 2. Assign membership if plan selected
    let membership = null;
    if (planId) {
      const planRes = await client.query("SELECT * FROM plans WHERE id = $1 AND is_active = true", [planId]);
      if (!planRes.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Plan no encontrado" }); }
      const plan = planRes.rows[0];
      const nonRepeatableConflict = await findNonRepeatablePlanConflict({ userId: user.id, plan, client });
      if (nonRepeatableConflict) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: nonRepeatableConflict.message });
      }
      const startStr = startDate ? String(startDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
      const endStr = calcMembershipEndDate(startStr, plan);
      const memRes = await client.query(
        `INSERT INTO memberships (user_id, plan_id, status, payment_method, start_date, end_date,
          classes_remaining, notes)
         VALUES ($1,$2,'active',$3,$4,$5,$6,$7) RETURNING *`,
        [user.id, plan.id, paymentMethod, startStr, endStr,
        plan.class_limit === 0 ? null : plan.class_limit,
        (complementType ? `${notes || "Alta manual por admin"} | Complemento: ${complementType}` : notes || `Alta manual por admin`)]
      );
      membership = camelRow(memRes.rows[0]);

      // Create consultation if complement was selected
      const compInfo = complementType ? COMPLEMENT_MAP[complementType] : null;
      if (compInfo && memRes.rows[0]) {
        await client.query(
          `INSERT INTO consultations (membership_id, user_id, complement_type, complement_name, specialist, status)
           VALUES ($1, $2, $3, $4, $5, 'pending')`,
          [memRes.rows[0].id, user.id, complementType, compInfo.name, compInfo.specialist]
        ).catch((e) => console.error("[consultations] insert error:", e.message));
      }
    }

    // Auto-link previous walk-in orders/bookings by matching phone
    let walkinLinks = { ordersLinked: 0, bookingsLinked: 0 };
    const normalizedPhone = phone ? normalizePhoneForStorage(phone) : null;
    if (normalizedPhone) {
      const ordersUpd = await client.query(
        `UPDATE orders SET user_id = $1, guest_name = NULL, guest_phone = NULL
         WHERE user_id IS NULL AND guest_phone = $2 RETURNING id`,
        [user.id, normalizedPhone]
      );
      const bookingsUpd = await client.query(
        `UPDATE bookings SET user_id = $1, guest_name = NULL, guest_phone = NULL
         WHERE user_id IS NULL AND guest_phone = $2 RETURNING id`,
        [user.id, normalizedPhone]
      );
      walkinLinks = { ordersLinked: ordersUpd.rowCount, bookingsLinked: bookingsUpd.rowCount };
    }

    await client.query("COMMIT");
    if (membership?.userId || user?.id) {
      triggerWalletPassSync(membership?.userId || user.id, membership ? "admin_client_manual_with_membership" : "admin_client_manual_created");
    }

    // Send welcome email with credentials only if a real email was provided.
    const isRealEmail = !!email && !finalEmail.endsWith("@puntoneutro.local");
    if (isRealEmail && (await areEmailNotificationsEnabled())) {
      const planNameForEmail = membership?.planName ?? null;
      sendClientWelcomeWithCredentials({
        to: finalEmail,
        name: displayName,
        email: finalEmail,
        tempPassword,
        planName: planNameForEmail,
      }).catch((e) => console.error("[Email] welcome credentials:", e.message));
    }

    const linkMsg = walkinLinks.ordersLinked > 0
      ? ` · Se vincularon ${walkinLinks.ordersLinked} compra(s) previa(s) como invitada`
      : "";
    return res.status(201).json({
      data: {
        user: camelRow(user),
        membership,
        // Always return tempPassword so admin can copy/share if email isn't sent.
        tempPassword,
        emailSent: isRealEmail,
        walkinLinks,
      },
      message: (planId ? "Clienta registrada y membresía activada" : "Clienta registrada") + linkMsg,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[POST /admin/clients/manual]", err.message, err.code);
    if (err.code === "23505") {
      const isPhone = err.constraint === "uq_users_phone_client" || /phone/i.test(err.detail || "");
      return res.status(409).json({ message: isPhone ? "Ya existe una clienta con ese teléfono" : "Ya existe una clienta con ese email" });
    }
    return res.status(500).json({ message: err.message || "Error interno" });
  } finally {
    client.release();
  }
});

// GET /api/admin/orders — all orders
app.get("/api/admin/orders", adminMiddleware, async (req, res) => {
  try {
    const { status, limit = 100 } = req.query;
    // Check if complements table exists to avoid JOIN errors
    let hasComplements = false;
    try {
      await pool.query("SELECT 1 FROM complements LIMIT 0");
      hasComplements = true;
    } catch (_) {}
    let q = `SELECT o.*, u.display_name AS user_name, p.name AS plan_name,
                    pp.file_url AS proof_url, pp.status AS proof_status, pp.uploaded_at AS proof_uploaded_at,
                    COALESCE((
                      SELECT json_agg(json_build_object(
                               'plan_id', i.plan_id, 'plan_name', ip.name,
                               'quantity', i.quantity, 'unit_price', i.unit_price, 'line_total', i.line_total
                             ) ORDER BY i.created_at)
                      FROM order_plan_items i JOIN plans ip ON ip.id = i.plan_id
                      WHERE i.order_id = o.id
                    ), '[]'::json) AS items
                    ${hasComplements ? ", comp.name AS complement_name, comp.specialist AS complement_specialist" : ""}
             FROM orders o
             LEFT JOIN users u ON o.user_id = u.id
             LEFT JOIN plans p ON o.plan_id = p.id
             LEFT JOIN payment_proofs pp ON pp.order_id = o.id
             ${hasComplements ? "LEFT JOIN complements comp ON o.complement_id = comp.id" : ""}
             WHERE 1=1`;
    const params = [];
    if (status) { params.push(status); q += ` AND o.status = $${params.length}`; }
    params.push(parseInt(limit)); q += ` ORDER BY o.created_at DESC LIMIT $${params.length}`;
    const r = await pool.query(q, params);
    return res.json({
      data: r.rows.map(o => ({
        ...o,
        userName: o.user_name,
        userId: o.user_id,
        planName: o.plan_name,
        items: o.items,
        proofUrl: o.proof_url,
        proofStatus: o.proof_status,
        proofUploadedAt: o.proof_uploaded_at,
        totalAmount: o.total_amount,
        createdAt: o.created_at,
        complementId: o.complement_id,
        complementName: o.complement_name,
        complementSpecialist: o.complement_specialist,
      })),
    });
  } catch (err) {
    console.error("[GET /admin/orders]", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// PUT /api/admin/orders/:id/verify
app.put("/api/admin/orders/:id/verify", adminMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orderRes = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!orderRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Orden no encontrada" });
    }
    let order = orderRes.rows[0];
    let justApproved = false;

    if (order.status !== "approved") {
      let plan = null;
      if (order.plan_id) {
        const planRes = await client.query("SELECT * FROM plans WHERE id = $1", [order.plan_id]);
        if (planRes.rows.length) {
          plan = planRes.rows[0];
          const nonRepeatableConflict = await findNonRepeatablePlanConflict({
            userId: order.user_id,
            plan,
            excludeOrderId: order.id,
            client,
          });
          if (nonRepeatableConflict) {
            await client.query("ROLLBACK");
            return res.status(409).json({ message: nonRepeatableConflict.message });
          }
        }
      }

      const approvedRes = await client.query(
        `UPDATE orders
            SET status = 'approved',
                verified_at = NOW(),
                verified_by = $1,
                approved_at = COALESCE(approved_at, NOW()),
                approved_by = COALESCE(approved_by, $1),
                paid_at     = COALESCE(paid_at, NOW())
          WHERE id = $2
        RETURNING *`,
        [req.userId, req.params.id]
      );
      order = approvedRes.rows[0];
      justApproved = true;

      // Activate membership(s) — soporta carrito (order_plan_items) o plan suelto.
      if (order.user_id) {
        await createMembershipsForOrder(order, client, order.payment_method || "transfer");
      }

      // ── Create consultation record if order has a complement ──
      const orderComplementType = order.complement_type || null;
      if (orderComplementType) {
        const compInfo = COMPLEMENT_MAP[orderComplementType] || null;
        if (compInfo) {
          try {
            // Find the membership just created for this order
            const memForOrder = await client.query(
              "SELECT id FROM memberships WHERE order_id = $1 LIMIT 1", [order.id]
            );
            const membershipId = memForOrder.rows[0]?.id || null;
            await client.query(
              `INSERT INTO consultations (membership_id, user_id, complement_type, complement_name, specialist, status)
               VALUES ($1, $2, $3, $4, $5, 'pending')`,
              [membershipId, order.user_id, orderComplementType, compInfo.name, compInfo.specialist]
            );
          } catch (_compErr) {
            console.error("[consultations] insert on verify error:", _compErr.message);
          }
        }
      }

      if (order.discount_code_id) {
        await incrementDiscountUsage(order.discount_code_id, client);
      }
    }

    await client.query("COMMIT");

    let plan = null;
    if (order.plan_id) {
      const planRes = await pool.query("SELECT * FROM plans WHERE id = $1", [order.plan_id]);
      if (planRes.rows.length) plan = planRes.rows[0];
    }

    // Email: membership activated
    if (justApproved && order.user_id && plan) {
      try {
        const emailEndStr = calcMembershipEndDate(new Date().toISOString().slice(0, 10), plan);
        const uRes = await pool.query("SELECT email, display_name, phone FROM users WHERE id = $1", [order.user_id]);
        if (uRes.rows[0]) {
          const u = uRes.rows[0];
          if (await areEmailNotificationsEnabled()) {
            sendMembershipActivated({
              to: u.email,
              name: u.display_name || "Alumna",
              planName: plan.name,
              startDate: new Date().toISOString().slice(0, 10),
              endDate: emailEndStr,
              classLimit: plan.class_limit ?? null,
            }).catch((e) => console.error("[Email] admin order verify:", e.message));
          }
          sendConfiguredWhatsAppTemplate({
            templateKey: "membership_activated",
            phone: u.phone,
            vars: {
              name: u.display_name || "Alumna",
              plan: plan.name || "tu plan",
              startDate: new Date().toLocaleDateString("es-MX"),
              endDate: new Date(emailEndStr).toLocaleDateString("es-MX"),
            },
            fallbackMessage: `Hola ${u.display_name || "Alumna"}, tu membresía ${plan.name || ""} ya está activa.`,
          }).catch((e) => console.error("[WA] admin order verify:", e.message));
          sendConfiguredPushTemplate({
            templateKey: "membership_activated",
            userId: order.user_id,
            vars: {
              name: u.display_name || "Alumna",
              plan: plan.name || "tu plan",
              startDate: new Date().toLocaleDateString("es-MX"),
              endDate: new Date(emailEndStr).toLocaleDateString("es-MX"),
            },
          }).catch((e) => console.error("[Push] admin order verify:", e.message));
        }
      } catch (emailErr) {
        console.error("[Email] admin order verify query:", emailErr.message);
      }
    }

    // Award loyalty points for purchase
    if (justApproved && order.user_id && order.total_amount > 0) {
      try {
        const cfgRes = await pool.query("SELECT value FROM settings WHERE key='loyalty_config' LIMIT 1");
        const cfg = cfgRes.rows.length ? cfgRes.rows[0].value : {};
        const pts = Math.floor((order.total_amount || 0) * (cfg.points_per_peso ?? 1));
        if (cfg.enabled !== false && pts > 0) {
          await pool.query(
            "INSERT INTO loyalty_transactions (user_id, type, points, description) VALUES ($1, 'earn', $2, $3)",
            [order.user_id, pts, `Compra aprobada — $${order.total_amount}`]
          );
        }
      } catch (e) { /* loyalty earn error shouldn't fail verify */ }
    }

    if (order.user_id) {
      triggerWalletPassSync(order.user_id, justApproved ? "order_verified" : "order_verify_retrigger");
    }
    return res.json({ data: order });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { }
    console.error("PUT /admin/orders/:id/verify error:", err);
    const status = Number.isInteger(err?.status) ? err.status : 500;
    return res.status(status).json({ message: err?.message || "Error interno" });
  } finally {
    client.release();
  }
});

// ─── Routes: /api/consultations (client) ─────────────────────────────────────

// GET /api/consultations/my — client's own consultations
app.get("/api/consultations/my", authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, complement_type, complement_name, specialist, status,
              scheduled_date, notes, created_at
         FROM consultations
        WHERE user_id = $1
          AND status IN ('pending', 'scheduled')
        ORDER BY
          CASE status WHEN 'scheduled' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
          created_at DESC`,
      [req.userId]
    );
    return res.json({ data: r.rows });
  } catch (err) {
    console.error("GET /api/consultations/my error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Routes: /api/admin/consultations ────────────────────────────────────────

// GET /api/admin/consultations — list consultations with filters
app.get("/api/admin/consultations", adminMiddleware, async (req, res) => {
  try {
    const { status, complementType: qCompType } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    if (status) {
      params.push(status);
      where += ` AND c.status = $${params.length}`;
    }
    if (qCompType) {
      params.push(qCompType);
      where += ` AND c.complement_type = $${params.length}`;
    }
    const r = await pool.query(
      `SELECT c.*, u.display_name AS client_name, u.email AS client_email, u.phone AS client_phone
       FROM consultations c
       JOIN users u ON c.user_id = u.id
       ${where}
       ORDER BY c.created_at DESC`,
      params
    );
    return res.json({ data: camelRows(r.rows) });
  } catch (err) {
    if (err.code === "42P01") return res.json({ data: [] });
    console.error("GET admin/consultations error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// PUT /api/admin/consultations/:id — update consultation status/date/notes
app.put("/api/admin/consultations/:id", adminMiddleware, async (req, res) => {
  try {
    const { status, scheduledDate, notes } = req.body;
    const sets = [];
    const params = [];

    if (status) {
      params.push(status);
      sets.push(`status = $${params.length}`);
      if (status === "completed") {
        sets.push("completed_at = NOW()");
      }
    }
    if (scheduledDate !== undefined) {
      params.push(scheduledDate);
      sets.push(`scheduled_date = $${params.length}`);
    }
    if (notes !== undefined) {
      params.push(notes);
      sets.push(`notes = $${params.length}`);
    }

    if (sets.length === 0) {
      return res.status(400).json({ message: "Nada que actualizar" });
    }

    sets.push("updated_at = NOW()");
    params.push(req.params.id);

    const r = await pool.query(
      `UPDATE consultations SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!r.rows.length) return res.status(404).json({ message: "Consulta no encontrada" });
    return res.json({ data: camelRows(r.rows)[0] });
  } catch (err) {
    if (err.code === "42P01") return res.status(404).json({ message: "Tabla consultations no existe" });
    console.error("PUT admin/consultations error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/admin/consultations/stats — count by status
app.get("/api/admin/consultations/stats", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT status, COUNT(*)::int AS count FROM consultations GROUP BY status`
    );
    const stats = { pending: 0, scheduled: 0, completed: 0, cancelled: 0 };
    r.rows.forEach((row) => { stats[row.status] = row.count; });
    return res.json({ data: stats });
  } catch (err) {
    if (err.code === "42P01") return res.json({ data: { pending: 0, scheduled: 0, completed: 0, cancelled: 0 } });
    console.error("GET admin/consultations/stats error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// PUT /api/admin/orders/:id/reject
app.put("/api/admin/orders/:id/reject", adminMiddleware, async (req, res) => {
  try {
    const { notes, reason } = req.body;
    const rejectionReason = reason || notes || "No especificado";
    // Solo se puede rechazar una orden que sigue pendiente. NUNCA una ya aprobada
    // (eso dejaría la membresía y el pago activos con la orden en 'rejected').
    const r = await pool.query(
      `UPDATE orders SET status = 'rejected', verified_at = NOW(), notes = $2
         WHERE id = $1 AND status IN ('pending_payment','pending_verification')
       RETURNING *, user_id`,
      [req.params.id, rejectionReason]
    );
    if (!r.rows.length) {
      const exists = await pool.query("SELECT status FROM orders WHERE id = $1", [req.params.id]);
      if (!exists.rows.length) return res.status(404).json({ message: "Orden no encontrada" });
      return res.status(409).json({ message: `No se puede rechazar una orden en estado '${exists.rows[0].status}'.` });
    }
    const order = r.rows[0];

    // Notify the client about rejection via email and WhatsApp
    try {
      const uRes = await pool.query("SELECT email, display_name, phone FROM users WHERE id = $1", [order.user_id]);
      if (uRes.rows.length) {
        const u = uRes.rows[0];
        const userName = u.display_name || "Clienta";
        const rejMsg = `Hola ${userName} 👋\n\nTu comprobante de pago fue revisado y lamentablemente *no pudo ser aprobado*.\n\n📌 Motivo: ${rejectionReason}\n\nSi crees que es un error o tienes dudas, responde este mensaje. ¡Estamos para ayudarte! 💜`;

        // WhatsApp notification
        if (u.phone) {
          try {
            await sendConfiguredWhatsAppTemplate({
              templateKey: "transfer_rejected",
              phone: u.phone,
              vars: {
                name: userName,
                reason: rejectionReason,
              },
              fallbackMessage: rejMsg,
            });
          } catch (waErr) {
            console.error("[Reject WhatsApp]", waErr.response?.data || waErr.message);
          }
        }

        // Push notification
        sendConfiguredPushTemplate({
          templateKey: "transfer_rejected",
          userId: order.user_id,
          vars: { name: userName, reason: rejectionReason },
        }).catch((e) => console.error("[Push] transfer rejected:", e.message));

        // Email notification
        if (u.email) {
          try {
            const { sendOrderRejected } = await import("./emailService.js").catch(() => ({}));
            if (typeof sendOrderRejected === "function") {
              await sendOrderRejected({ to: u.email, name: userName, reason: rejectionReason });
            }
          } catch (emailErr) {
            console.error("[Reject Email]", emailErr.message);
          }
        }
      }
    } catch (notifyErr) {
      console.error("[Reject notify]", notifyErr.message);
    }

    return res.json({ data: order });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/admin/orders/:id/sync-mp — forzar reconciliación contra MercadoPago si el webhook no llegó
app.post("/api/admin/orders/:id/sync-mp", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query("SELECT id, mp_payment_id FROM orders WHERE id = $1", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ message: "Orden no encontrada" });
    const mpPaymentId = r.rows[0].mp_payment_id;
    if (!mpPaymentId) {
      return res.status(400).json({ message: "La orden no tiene un pago de MercadoPago asociado todavía" });
    }
    await handlePaymentWebhook(mpPaymentId);
    const after = await pool.query("SELECT status, mp_payment_status FROM orders WHERE id = $1", [req.params.id]);
    return res.json({ data: after.rows[0] });
  } catch (err) {
    console.error("sync-mp error:", err.message);
    return res.status(500).json({ message: "No se pudo sincronizar con MercadoPago" });
  }
});

// ─── Payments admin ──────────────────────────────────────────────────────────

// GET /api/payments
app.get("/api/payments", adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, userId, limit = 200 } = req.query;
    const params = [];
    let startIdx = null;
    let endIdx = null;
    let userIdx = null;
    if (startDate) { params.push(startDate); startIdx = params.length; }
    if (endDate) { params.push(endDate); endIdx = params.length; }
    if (userId) { params.push(userId); userIdx = params.length; }
    // Include approved orders AND manually-assigned memberships
    let q = `
      SELECT
        o.id,
        o.user_id,
        COALESCE(u.display_name, o.guest_name) AS user_name,
        COALESCE(p.name, 'Clase suelta') AS plan_name,
        o.total_amount,
        o.payment_method AS method,
        o.payment_provider AS provider,
        o.status::text AS status,
        o.created_at,
        CASE WHEN o.user_id IS NULL THEN 'walkin' ELSE 'order' END AS source
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN plans p ON o.plan_id = p.id
      WHERE o.status = 'approved'`;
    if (startIdx) q += ` AND o.created_at >= $${startIdx}`;
    if (endIdx) q += ` AND o.created_at <= $${endIdx}`;
    if (userIdx) q += ` AND o.user_id = $${userIdx}`;

    // Also fetch memberships assigned directly (cash/card/transfer)
    let mq = `
      SELECT
        m.id,
        m.user_id,
        u.display_name AS user_name,
        p.name AS plan_name,
        p.price AS total_amount,
        m.payment_method AS method,
        NULL::text AS provider,
        m.status::text AS status,
        m.created_at,
        'membership' AS source
      FROM memberships m
      LEFT JOIN users u ON m.user_id = u.id
      LEFT JOIN plans p ON m.plan_id = p.id
      WHERE m.order_id IS NULL`;
    if (startIdx) mq += ` AND m.created_at >= $${startIdx}`;
    if (endIdx) mq += ` AND m.created_at <= $${endIdx}`;
    if (userIdx) mq += ` AND m.user_id = $${userIdx}`;

    const combined = `(${q}) UNION ALL (${mq}) ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));
    const r = await pool.query(combined, params);
    const total = r.rows.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);
    return res.json({ data: r.rows.map((o) => ({ ...o, userName: o.user_name, planName: o.plan_name })), total });
  } catch (err) {
    console.error("[GET /payments]", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Discount codes admin CRUD ───────────────────────────────────────────────

// GET /api/discount-codes
app.get("/api/discount-codes", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT dc.*, p.name AS plan_name
       FROM discount_codes dc
       LEFT JOIN plans p ON p.id = dc.plan_id
       ORDER BY dc.created_at DESC`
    );
    return res.json({ data: camelRows(r.rows) });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/discount-codes
app.post("/api/discount-codes", adminMiddleware, async (req, res) => {
  try {
    const {
      code,
      discountType = "percent",
      discountValue,
      maxUses,
      expiresAt,
      minOrderAmount,
      minPurchaseAmount,
      planId,
      classCategory,
      channel,
      isActive = true,
    } = req.body;
    if (!code || !discountValue) return res.status(400).json({ message: "Código y valor requeridos" });
    const normalizedType = normalizeDiscountType(discountType);
    if (!normalizedType) return res.status(400).json({ message: "Tipo de descuento inválido" });
    const normalizedMinOrder = Number(minOrderAmount ?? minPurchaseAmount ?? 0) || 0;
    const normalizedCategory =
      classCategory === undefined || classCategory === null || classCategory === ""
        ? null
        : normalizeClassCategory(classCategory, "__invalid__");
    if (normalizedCategory === "__invalid__") {
      return res.status(400).json({ message: "Categoría inválida. Usa: all, pilates, bienestar, funcional o mixto." });
    }
    const normalizedChannel =
      channel === undefined || channel === null || channel === ""
        ? "all"
        : normalizeDiscountChannel(channel, "__invalid__");
    if (normalizedChannel === "__invalid__") {
      return res.status(400).json({ message: "Canal inválido. Usa: all, membership, pos o event." });
    }
    if (planId) {
      const planExists = await pool.query("SELECT id FROM plans WHERE id = $1", [planId]);
      if (!planExists.rows.length) return res.status(404).json({ message: "Plan no encontrado" });
    }
    const r = await pool.query(
      `INSERT INTO discount_codes (
         code, discount_type, discount_value, max_uses, expires_at,
         min_order_amount, plan_id, class_category, channel, is_active
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        code.toUpperCase(),
        normalizedType,
        discountValue,
        maxUses || null,
        expiresAt || null,
        normalizedMinOrder,
        planId || null,
        normalizedCategory,
        normalizedChannel,
        isActive,
      ]
    );
    const enriched = await pool.query(
      `SELECT dc.*, p.name AS plan_name
       FROM discount_codes dc
       LEFT JOIN plans p ON p.id = dc.plan_id
       WHERE dc.id = $1`,
      [r.rows[0].id]
    );
    return res.status(201).json({ data: camelRow(enriched.rows[0]) });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ message: "Código ya existe" });
    return res.status(500).json({ message: "Error interno" });
  }
});

// PUT /api/discount-codes/:id
app.put("/api/discount-codes/:id", adminMiddleware, async (req, res) => {
  try {
    const {
      code,
      discountType,
      discountValue,
      maxUses,
      expiresAt,
      minOrderAmount,
      minPurchaseAmount,
      planId,
      classCategory,
      channel,
      isActive,
    } = req.body;
    const normalizedType = normalizeDiscountType(discountType);
    if (!normalizedType) return res.status(400).json({ message: "Tipo de descuento inválido" });
    const normalizedMinOrder = Number(minOrderAmount ?? minPurchaseAmount ?? 0) || 0;
    const normalizedCategory =
      classCategory === undefined || classCategory === null || classCategory === ""
        ? null
        : normalizeClassCategory(classCategory, "__invalid__");
    if (normalizedCategory === "__invalid__") {
      return res.status(400).json({ message: "Categoría inválida. Usa: all, pilates, bienestar, funcional o mixto." });
    }
    const normalizedChannel =
      channel === undefined || channel === null || channel === ""
        ? "all"
        : normalizeDiscountChannel(channel, "__invalid__");
    if (normalizedChannel === "__invalid__") {
      return res.status(400).json({ message: "Canal inválido. Usa: all, membership, pos o event." });
    }
    if (planId) {
      const planExists = await pool.query("SELECT id FROM plans WHERE id = $1", [planId]);
      if (!planExists.rows.length) return res.status(404).json({ message: "Plan no encontrado" });
    }
    const r = await pool.query(
      `UPDATE discount_codes SET code=$1, discount_type=$2, discount_value=$3, max_uses=$4,
       expires_at=$5, min_order_amount=$6, plan_id=$7, class_category=$8, channel=$9, is_active=$10, updated_at=NOW()
       WHERE id=$11 RETURNING *`,
      [
        code?.toUpperCase(),
        normalizedType,
        discountValue,
        maxUses || null,
        expiresAt || null,
        normalizedMinOrder,
        planId || null,
        normalizedCategory,
        normalizedChannel,
        isActive !== false,
        req.params.id,
      ]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Código no encontrado" });
    const enriched = await pool.query(
      `SELECT dc.*, p.name AS plan_name
       FROM discount_codes dc
       LEFT JOIN plans p ON p.id = dc.plan_id
       WHERE dc.id = $1`,
      [r.rows[0].id]
    );
    return res.json({ data: camelRow(enriched.rows[0]) });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// DELETE /api/discount-codes/:id
app.delete("/api/discount-codes/:id", adminMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM discount_codes WHERE id = $1", [req.params.id]);
    return res.json({ message: "Código eliminado" });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Products CRUD (POS) ─────────────────────────────────────────────────────

// GET /api/products
app.get("/api/products", adminMiddleware, async (req, res) => {
  try {
    const { search = "", active } = req.query;
    let q = "SELECT * FROM products WHERE 1=1";
    const params = [];
    if (search) { params.push(`%${search}%`); q += ` AND name ILIKE $${params.length}`; }
    if (active !== undefined) {
      params.push(String(active) === "true");
      q += ` AND is_active = $${params.length}`;
    }
    q += " ORDER BY created_at DESC";
    const r = await pool.query(q, params);
    return res.json({ data: camelRows(r.rows) });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/products
app.post("/api/products", adminMiddleware, async (req, res) => {
  try {
    const { name, price, category, stock = 0, sku } = req.body;
    const isActive = parseBooleanFlag(req.body?.isActive ?? req.body?.is_active ?? true);
    if (!name) return res.status(400).json({ message: "Nombre requerido" });
    const r = await pool.query(
      "INSERT INTO products (name, price, category, stock, sku, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [name, price || 0, category || "accesorios", stock, sku || null, isActive]
    );
    return res.status(201).json({ data: camelRow(r.rows[0]) });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// PUT /api/products/:id
app.put("/api/products/:id", adminMiddleware, async (req, res) => {
  try {
    const { name, price, category, stock, sku } = req.body;
    const isActive = parseBooleanFlag(req.body?.isActive ?? req.body?.is_active ?? true);
    const r = await pool.query(
      "UPDATE products SET name=$1, price=$2, category=$3, stock=$4, sku=$5, is_active=$6, updated_at=NOW() WHERE id=$7 RETURNING *",
      [name, price, category, stock, sku || null, isActive, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Producto no encontrado" });
    return res.json({ data: camelRow(r.rows[0]) });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// DELETE /api/products/:id
app.delete("/api/products/:id", adminMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM products WHERE id = $1", [req.params.id]);
    return res.json({ message: "Producto eliminado" });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/pos/sale — POS transaction
app.post("/api/pos/sale", adminMiddleware, async (req, res) => {
  try {
    const { userId, items, paymentMethod = "efectivo", discountCode } = req.body;
    const result = await processPosSale({ userId, items, paymentMethod, discountCode });
    if (result.error) {
      return res.status(result.error.status).json({ message: result.error.message });
    }
    return res.status(201).json({ data: result.data });
  } catch (err) {
    console.error("POST /pos/sale error:", err);
    const status = Number.isInteger(err?.status) ? err.status : 500;
    return res.status(status).json({ message: err?.message || "Error interno" });
  }
});

// ─── Loyalty admin ───────────────────────────────────────────────────────────

// GET /api/admin/loyalty/users — list users with points
app.get("/api/admin/loyalty/users", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.display_name, u.email,
              COALESCE(SUM(CASE WHEN lt.type='earn' THEN lt.points ELSE -lt.points END), 0) AS balance
       FROM users u
       LEFT JOIN loyalty_transactions lt ON lt.user_id = u.id
       WHERE u.role = 'client' AND COALESCE(u.is_hidden, false) = false
       GROUP BY u.id ORDER BY balance DESC LIMIT 50`
    );
    return res.json({ data: r.rows });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/admin/loyalty/adjust — manual points adjustment
app.post("/api/admin/loyalty/adjust", adminMiddleware, async (req, res) => {
  try {
    const { userId, points, reason, type = "earn" } = req.body;
    if (!userId || !points) return res.status(400).json({ message: "userId y points requeridos" });
    const r = await pool.query(
      "INSERT INTO loyalty_transactions (user_id, type, points, description, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [userId, type, Math.abs(points), reason || "Ajuste manual", req.userId]
    );
    triggerWalletPassSync(userId, "loyalty_adjust");
    return res.status(201).json({ data: r.rows[0] });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/admin/loyalty/recalculate/:userId — award missing membership points retroactively
app.post("/api/admin/loyalty/recalculate/:userId", adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    // Get loyalty config
    const cfgRes = await pool.query("SELECT value FROM settings WHERE key='loyalty_config' LIMIT 1");
    const cfg = cfgRes.rows.length ? cfgRes.rows[0].value : {};
    const ppp = Number(cfg.points_per_peso ?? 1);
    if (cfg.enabled === false) return res.json({ data: { awarded: 0, message: "Loyalty desactivado en configuración" } });

    // Get all active/expired memberships for this user
    const mRes = await pool.query(
      `SELECT m.id, p.price, p.name
       FROM memberships m
       JOIN plans p ON m.plan_id = p.id
       WHERE m.user_id = $1 AND m.status IN ('active','expired')`,
      [userId]
    );
    if (!mRes.rows.length) return res.json({ data: { awarded: 0, message: "No hay membresías para recalcular" } });

    // Check which memberships already have a loyalty transaction
    const txRes = await pool.query(
      "SELECT description FROM loyalty_transactions WHERE user_id=$1 AND type='earn'",
      [userId]
    );
    const existingDescs = new Set(txRes.rows.map((r) => r.description));

    let awarded = 0;
    for (const m of mRes.rows) {
      const desc = `Membresía asignada — ${m.name} ($${m.price})`;
      // Skip if already awarded for this membership (by description match)
      if (existingDescs.has(desc)) continue;
      const pts = Math.floor(parseFloat(m.price) * ppp);
      if (pts <= 0) continue;
      await pool.query(
        "INSERT INTO loyalty_transactions (user_id, type, points, description) VALUES ($1, 'earn', $2, $3)",
        [userId, pts, desc]
      );
      awarded += pts;
    }

    if (awarded > 0) {
      triggerWalletPassSync(userId, "loyalty_recalculate");
    }
    return res.json({ data: { awarded, message: awarded > 0 ? `Se otorgaron ${awarded} puntos retroactivos` : "Todos los puntos ya estaban registrados" } });
  } catch (err) {
    console.error("[Recalculate loyalty]", err.message);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Instructors / Staff ─────────────────────────────────────────────────────

// GET /api/instructors
app.get("/api/instructors", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM instructors ORDER BY created_at DESC");
    return res.json({ data: camelRows(r.rows) });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/instructors
app.post("/api/instructors", adminMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const { displayName, email, phone, bio, specialties, isActive = true, photoFocusX = 50, photoFocusY = 50, sortOrder = 0 } = req.body;
    if (!displayName) return res.status(400).json({ message: "Nombre requerido" });
    const specialtiesValue = serializeSpecialtiesForDb(specialties);
    const safeFocusX = Math.max(0, Math.min(100, Number(photoFocusX || 50)));
    const safeFocusY = Math.max(0, Math.min(100, Number(photoFocusY || 50)));
    const safeSortOrder = Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0;

    await client.query("BEGIN");

    // Create or find user account for instructor
    let userId = null;
    if (email) {
      const existingUser = await client.query("SELECT id FROM users WHERE email = $1", [email]);
      if (existingUser.rows.length > 0) {
        userId = existingUser.rows[0].id;
        await client.query("UPDATE users SET role='instructor', is_active=$1 WHERE id=$2", [isActive, userId]);
      } else {
        const newUser = await client.query(
          "INSERT INTO users (display_name, email, phone, role, is_active, accepts_terms) VALUES ($1,$2,$3,'instructor',$4,true) RETURNING id",
          [displayName, email, phone || "0000000000", isActive]
        );
        userId = newUser.rows[0].id;
      }
    }

    const r = await client.query(
      "INSERT INTO instructors (user_id, display_name, email, phone, bio, specialties, is_active, photo_focus_x, photo_focus_y, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
      [userId, displayName, email || null, phone || null, bio || null, specialtiesValue, isActive, safeFocusX, safeFocusY, safeSortOrder]
    );
    await client.query("COMMIT");
    return res.status(201).json({ data: camelRow(r.rows[0]) });
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ message: "Error interno" });
  } finally {
    client.release();
  }
});

// PUT /api/instructors/:id
app.put("/api/instructors/:id", adminMiddleware, async (req, res) => {
  try {
    const { displayName, email, phone, bio, specialties, isActive, photoFocusX = 50, photoFocusY = 50, sortOrder = 0 } = req.body;
    const specialtiesValue = serializeSpecialtiesForDb(specialties);
    const safeFocusX = Math.max(0, Math.min(100, Number(photoFocusX || 50)));
    const safeFocusY = Math.max(0, Math.min(100, Number(photoFocusY || 50)));
    const safeSortOrder = Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0;
    const r = await pool.query(
      "UPDATE instructors SET display_name=$1, email=$2, phone=$3, bio=$4, specialties=$5, is_active=$6, photo_focus_x=$7, photo_focus_y=$8, sort_order=$9, updated_at=NOW() WHERE id=$10 RETURNING *",
      [displayName, email || null, phone || null, bio || null, specialtiesValue, isActive !== false, safeFocusX, safeFocusY, safeSortOrder, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Instructor no encontrado" });
    return res.json({ data: camelRow(r.rows[0]) });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// DELETE /api/instructors/:id
app.delete("/api/instructors/:id", adminMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM instructors WHERE id = $1", [req.params.id]);
    return res.json({ message: "Instructor eliminado" });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/users/:id/photo — upload user profile photo
// Auth: any logged-in user can upload their own photo. Admins can upload any.
app.post("/api/users/:id/photo", authMiddleware, upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Debes adjuntar una imagen" });
    if (!req.file.mimetype.startsWith("image/")) {
      return res.status(400).json({ message: "El archivo debe ser una imagen" });
    }

    const targetId = req.params.id;
    if (targetId !== req.userId) {
      const meRes = await pool.query("SELECT role FROM users WHERE id = $1", [req.userId]);
      const role = meRes.rows[0]?.role || "client";
      if (!["admin", "super_admin"].includes(role)) {
        return res.status(403).json({ message: "Solo puedes cambiar tu propia foto" });
      }
    }

    let photoUrl = null;
    if (isGoogleDriveConfigured()) {
      try {
        const ext = (req.file.originalname || "jpg").split(".").pop().toLowerCase();
        const { fileId } = await uploadBufferToGoogleDrive(
          req.file.buffer,
          `profile_${targetId}_${Date.now()}.${ext}`,
          req.file.mimetype
        );
        photoUrl = `/api/drive/image/${fileId}`;
      } catch (driveErr) {
        console.warn("[user photo] Drive upload failed, falling back to base64:", driveErr.message);
      }
    }

    if (!photoUrl) {
      if (req.file.size > 2 * 1024 * 1024) {
        return res.status(413).json({
          message: "Imagen muy grande para almacenamiento local (máx 2MB). Configura Google Drive o sube una imagen más pequeña.",
        });
      }
      photoUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
    }

    const r = await pool.query(
      "UPDATE users SET photo_url = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, display_name, photo_url, role",
      [photoUrl, targetId]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Usuario no encontrado" });

    triggerWalletPassSync(targetId, "profile_photo_updated");
    return res.json({ message: "Foto actualizada", data: camelRow(r.rows[0]), photoUrl });
  } catch (err) {
    console.error("[POST /users/:id/photo]", err);
    return res.status(500).json({ message: err.message || "Error al subir la foto" });
  }
});

// DELETE /api/users/:id/photo — clear profile photo
app.delete("/api/users/:id/photo", authMiddleware, async (req, res) => {
  try {
    const targetId = req.params.id;
    if (targetId !== req.userId) {
      const meRes = await pool.query("SELECT role FROM users WHERE id = $1", [req.userId]);
      const role = meRes.rows[0]?.role || "client";
      if (!["admin", "super_admin"].includes(role)) {
        return res.status(403).json({ message: "Solo puedes cambiar tu propia foto" });
      }
    }
    const r = await pool.query(
      "UPDATE users SET photo_url = NULL, updated_at = NOW() WHERE id = $1 RETURNING id",
      [targetId]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Usuario no encontrado" });
    return res.json({ message: "Foto eliminada" });
  } catch (err) {
    console.error("[DELETE /users/:id/photo]", err);
    return res.status(500).json({ message: "Error al eliminar foto" });
  }
});

// POST /api/instructors/:id/photo — upload instructor photo to Google Drive
app.post("/api/instructors/:id/photo", adminMiddleware, upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No se envió archivo" });
    const instructorId = req.params.id;

    let photoUrl;
    if (isGoogleDriveConfigured()) {
      const ext = (req.file.originalname || "jpg").split(".").pop();
      const { fileId } = await uploadBufferToGoogleDrive(
        req.file.buffer,
        `instructor_${instructorId}_${Date.now()}.${ext}`,
        req.file.mimetype
      );
      photoUrl = `/api/drive/image/${fileId}`;
    } else {
      photoUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
    }

    const r = await pool.query(
      "UPDATE instructors SET photo_url=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [photoUrl, instructorId]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Instructor no encontrado" });
    return res.json({ data: camelRow(r.rows[0]) });
  } catch (err) {
    console.error("Instructor photo upload error:", err);
    return res.status(500).json({ message: err.message || "Error al subir foto" });
  }
});

// POST /api/instructors/:id/magic-link — generate a one-time login link for an instructor
app.post("/api/instructors/:id/magic-link", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM instructors WHERE id = $1", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ message: "Instructor no encontrado" });
    const ins = r.rows[0];
    // Find or create a user account for this instructor
    let userRow = null;
    if (ins.email) {
      const uRes = await pool.query("SELECT * FROM users WHERE email = $1 LIMIT 1", [ins.email]);
      if (uRes.rows.length) {
        userRow = uRes.rows[0];
      } else {
        // Create a user for the instructor
        const newU = await pool.query(
          `INSERT INTO users (email, display_name, role, is_verified) VALUES ($1, $2, 'instructor', true) RETURNING *`,
          [ins.email, ins.display_name]
        );
        userRow = newU.rows[0];
      }
    }
    if (!userRow) return res.status(400).json({ message: "El instructor necesita un email para generar magic link" });
    // Generate a short-lived JWT
    const token = jwt.sign({ userId: userRow.id, role: userRow.role, type: "magic_link" }, JWT_SECRET, { expiresIn: "24h" });
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
    const link = `${baseUrl}/auth/magic?token=${token}`;
    return res.json({ data: { link } });
  } catch (err) {
    console.error("magic-link error:", err);
    return res.status(500).json({ message: "Error al generar magic link" });
  }
});


// GET /api/admin/reports?startDate=&endDate=
app.get("/api/admin/reports", adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const end = endDate || new Date().toISOString().slice(0, 10);

    const [revenue, newClients, bookings, topPlans] = await Promise.all([
      pool.query(
        "SELECT COALESCE(SUM(total_amount),0) AS total, COUNT(*) AS count FROM orders WHERE status='approved' AND created_at BETWEEN $1 AND $2",
        [start, end]
      ),
      pool.query(
        "SELECT COUNT(*) FROM users WHERE role='client' AND COALESCE(is_hidden,false)=false AND created_at BETWEEN $1 AND $2",
        [start, end]
      ),
      pool.query(
        "SELECT COUNT(*) AS total, COUNT(CASE WHEN status='checked_in' THEN 1 END) AS attended FROM bookings WHERE created_at BETWEEN $1 AND $2",
        [start, end]
      ),
      pool.query(
        `SELECT p.name, COUNT(m.id) AS sales, SUM(o.total_amount) AS revenue
         FROM memberships m
         JOIN plans p ON m.plan_id = p.id
         LEFT JOIN orders o ON o.plan_id = p.id AND o.status = 'approved'
         WHERE m.created_at BETWEEN $1 AND $2
         GROUP BY p.name ORDER BY sales DESC LIMIT 5`,
        [start, end]
      ),
    ]);

    return res.json({
      period: { start, end },
      revenue: { total: parseFloat(revenue.rows[0].total), count: parseInt(revenue.rows[0].count) },
      newClients: parseInt(newClients.rows[0].count),
      bookings: { total: parseInt(bookings.rows[0].total), attended: parseInt(bookings.rows[0].attended) },
      topPlans: topPlans.rows,
    });
  } catch (err) {
    console.error("GET /admin/reports error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Classes admin ──────────────────────────────────────────────────────────

// GET /api/admin/classes — all scheduled classes
app.get("/api/admin/classes", adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, instructorId } = req.query;
    // Same aggregate-once shape as /api/classes — avoids the per-row
    // correlated subquery that, combined with the missing index, was
    // tipping this endpoint into 503s under load.
    let q = `SELECT c.*, ct.name AS class_type_name, i.display_name AS instructor_name,
             COALESCE(b_agg.cnt, 0)::int AS current_bookings
             FROM classes c
             LEFT JOIN class_types ct ON c.class_type_id = ct.id
             LEFT JOIN instructors i ON c.instructor_id = i.id
             LEFT JOIN (
               SELECT class_id, COUNT(*) AS cnt
               FROM bookings
               WHERE status IN ('confirmed','checked_in')
               GROUP BY class_id
             ) b_agg ON b_agg.class_id = c.id
             WHERE 1=1`;
    const params = [];
    if (startDate) { params.push(startDate); q += ` AND c.date >= $${params.length}`; }
    if (endDate) { params.push(endDate); q += ` AND c.date <= $${params.length}`; }
    if (instructorId) { params.push(instructorId); q += ` AND c.instructor_id = $${params.length}`; }
    q += " ORDER BY c.date ASC, c.start_time ASC LIMIT 200";
    const r = await pool.query(q, params);
    return res.json({ data: r.rows });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/admin/classes — create a class
app.post("/api/admin/classes", adminMiddleware, async (req, res) => {
  try {
    const { classTypeId, instructorId, startTime, endTime, capacity = 10, maxCapacity, notes } = req.body;
    if (!classTypeId || !startTime) return res.status(400).json({ message: "classTypeId y startTime requeridos" });
    // Parse start ISO into date + time parts (matches /api/classes endpoint)
    const startDate = new Date(startTime);
    const dateStr = startDate.toISOString().slice(0, 10);
    const startTimeStr = startDate.toISOString().slice(11, 19);
    const endTimeStr = endTime ? new Date(endTime).toISOString().slice(11, 19) : null;
    const cap = Number(maxCapacity ?? capacity);
    const r = await pool.query(
      `INSERT INTO classes (class_type_id, instructor_id, date, start_time, end_time, max_capacity, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled') RETURNING *`,
      [classTypeId, instructorId || null, dateStr, startTimeStr, endTimeStr, cap, notes || null]
    );
    return res.status(201).json({ data: r.rows[0] });
  } catch (err) {
    console.error("POST /admin/classes error:", err.message);
    return res.status(500).json({ message: "Error interno", detail: err.message });
  }
});

// PUT /api/admin/classes/:id
app.put("/api/admin/classes/:id", adminMiddleware, async (req, res) => {
  try {
    const { classTypeId, instructorId, startTime, endTime, capacity, maxCapacity, status, notes } = req.body;
    const cap = maxCapacity ?? capacity;
    const r = await pool.query(
      `UPDATE classes SET class_type_id=COALESCE($1,class_type_id), instructor_id=COALESCE($2,instructor_id),
       start_time=COALESCE($3,start_time), end_time=COALESCE($4,end_time),
       max_capacity=COALESCE($5,max_capacity), status=COALESCE($6,status), notes=COALESCE($7,notes), updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [classTypeId || null, instructorId || null, startTime || null, endTime || null, cap || null, status || null, notes || null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Clase no encontrada" });
    return res.json({ data: r.rows[0] });
  } catch (err) {
    console.error("PUT /admin/classes error:", err.message);
    return res.status(500).json({ message: "Error interno", detail: err.message });
  }
});

// DELETE /api/admin/classes/:id
app.delete("/api/admin/classes/:id", adminMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM classes WHERE id = $1", [req.params.id]);
    return res.json({ message: "Clase eliminada" });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/admin/classes/generate — bulk generate from schedule templates
app.post("/api/admin/classes/generate", adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, instructorId } = req.body;
    if (!startDate || !endDate) return res.status(400).json({ message: "startDate y endDate requeridos" });
    if (!instructorId) return res.status(400).json({ message: "instructorId requerido" });
    // Get schedule slots
    const slotsRes = await pool.query("SELECT * FROM schedule_templates WHERE is_active = true");
    const slots = slotsRes.rows;
    if (!slots.length) return res.status(400).json({ message: "No hay horarios configurados" });
    // Get a default class type for each label
    const classTypeRes = await pool.query("SELECT id, name, category FROM class_types WHERE is_active = true");
    const classTypes = classTypeRes.rows;
    const created = [];
    // Append T00:00:00 to parse as local midnight (not UTC)
    const start = new Date(startDate + "T00:00:00");
    const end = new Date(endDate + "T00:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay(); // Mon=1..Sun=7
      const daySlots = slots.filter(s => s.day_of_week === dayOfWeek);
      for (const slot of daySlots) {
        const classDate = toDbDateString(d);
        const startTimeValue = parseTimeSlotTo24Hour(slot.time_slot);
        if (!startTimeValue) continue;
        const endTimeValue = addMinutesToTimeString(startTimeValue, 55);
        // Pick class type by label
        const label = slot.class_label?.toUpperCase();
        let ct = classTypes.find(ct => ct.category?.toLowerCase() === label?.toLowerCase());
        if (!ct) ct = classTypes[0];
        if (!ct) continue;
        // Check no duplicate
        const exists = await pool.query(
          "SELECT id FROM classes WHERE date = $1 AND start_time = $2 AND class_type_id = $3",
          [classDate, startTimeValue, ct.id]
        );
        if (exists.rows.length) continue;
        const r = await pool.query(
          `INSERT INTO classes (class_type_id, instructor_id, date, start_time, end_time, max_capacity, status)
           VALUES ($1,$2,$3,$4,$5,10,'scheduled') RETURNING *`,
          [ct.id, instructorId, classDate, startTimeValue, endTimeValue]
        );
        created.push(r.rows[0]);
      }
    }
    return res.json({ created: created.length, data: created });
  } catch (err) {
    console.error("POST /admin/classes/generate error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/admin/referrals
app.get("/api/admin/referrals", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT rc.*, u.display_name AS user_name, u.email,
              COUNT(r2.id) AS referral_count
       FROM referral_codes rc
       LEFT JOIN users u ON rc.user_id = u.id
       LEFT JOIN referrals r2 ON r2.referral_code_id = rc.id
       GROUP BY rc.id, u.display_name, u.email
       ORDER BY referral_count DESC`
    );
    return res.json({ data: r.rows });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/admin/videos — video list for admin
app.get("/api/admin/videos", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT v.*, ct.name AS class_type_name, i.display_name AS instructor_name
       FROM videos v
       LEFT JOIN class_types ct ON v.class_type_id = ct.id
       LEFT JOIN instructors i ON v.instructor_id = i.id
       ORDER BY v.created_at DESC`
    );
    return res.json({ data: r.rows });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/admin/videos
app.post("/api/admin/videos", adminMiddleware, async (req, res) => {
  try {
    const { title, description, videoUrl, thumbnailUrl, classTypeId, instructorId, durationMinutes, accessType = "membership", isPublished = false, isFeatured = false, sortOrder = 0 } = req.body;
    if (!title || !videoUrl) return res.status(400).json({ message: "title y videoUrl requeridos" });
    const r = await pool.query(
      `INSERT INTO videos (title, description, video_url, thumbnail_url, class_type_id, instructor_id, duration_minutes, access_type, is_published, is_featured, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [title, description || null, videoUrl, thumbnailUrl || null, classTypeId || null, instructorId || null, durationMinutes || null, accessType, isPublished, isFeatured, sortOrder]
    );
    return res.status(201).json({ data: r.rows[0] });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// PUT /api/admin/videos/:id
app.put("/api/admin/videos/:id", adminMiddleware, async (req, res) => {
  try {
    const { title, description, videoUrl, thumbnailUrl, classTypeId, instructorId, durationMinutes, accessType, isPublished, isFeatured, sortOrder } = req.body;
    const r = await pool.query(
      `UPDATE videos SET title=$1, description=$2, video_url=$3, thumbnail_url=$4, class_type_id=$5,
       instructor_id=$6, duration_minutes=$7, access_type=$8, is_published=$9, is_featured=$10, sort_order=$11, updated_at=NOW()
       WHERE id=$12 RETURNING *`,
      [title, description || null, videoUrl, thumbnailUrl || null, classTypeId || null, instructorId || null, durationMinutes || null, accessType || "membership", isPublished !== false, isFeatured === true, sortOrder || 0, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Video no encontrado" });
    return res.json({ data: r.rows[0] });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// DELETE /api/admin/videos/:id
app.delete("/api/admin/videos/:id", adminMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM videos WHERE id = $1", [req.params.id]);
    return res.json({ message: "Video eliminado" });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/admin/reviews
app.get("/api/admin/reviews", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT rv.*,
              u.display_name AS user_name,
              u.email,
              i.display_name AS instructor_name,
              ct.name AS class_type_name,
              c.date AS class_date,
              c.start_time AS class_start_time
       FROM reviews rv
       LEFT JOIN users u ON rv.user_id = u.id
       LEFT JOIN bookings b ON rv.booking_id = b.id
       LEFT JOIN classes c ON c.id = COALESCE(rv.class_id, b.class_id)
       LEFT JOIN class_types ct ON c.class_type_id = ct.id
       LEFT JOIN instructors i ON i.id = COALESCE(rv.instructor_id, c.instructor_id)
       ORDER BY rv.created_at DESC LIMIT 100`
    );
    return res.json({ data: r.rows });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// PUT /api/admin/reviews/:id/approve
app.put("/api/admin/reviews/:id/approve", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query("UPDATE reviews SET is_approved=true WHERE id=$1 RETURNING *", [req.params.id]);
    return res.json({ data: r.rows[0] });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// DELETE /api/admin/reviews/:id
app.delete("/api/admin/reviews/:id", adminMiddleware, async (req, res) => {
  try {
    await pool.query("DELETE FROM reviews WHERE id = $1", [req.params.id]);
    return res.json({ message: "Reseña eliminada" });
  } catch (err) { return res.status(500).json({ message: "Error interno" }); }
});

// ─── MÓDULO DE EVENTOS ────────────────────────────────────────────────────────

/** Helper: normalize a DB row to camelCase API shape */
function mapEventRow(row) {
  const toYMD = (v) => {
    if (!v) return null;
    if (typeof v === "string") return v.slice(0, 10);
    return new Date(v).toISOString().slice(0, 10);
  };
  const toHM = (v) => {
    if (!v) return null;
    return String(v).slice(0, 5);
  };
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    instructor: row.instructor_name,
    instructorPhoto: row.instructor_photo || null,
    date: toYMD(row.date),
    startTime: toHM(row.start_time),
    endTime: toHM(row.end_time),
    location: row.location,
    capacity: Number(row.capacity),
    registered: Number(row.registered || 0),
    price: Number(row.price || 0),
    currency: row.currency || "MXN",
    earlyBirdPrice: row.early_bird_price != null ? Number(row.early_bird_price) : null,
    earlyBirdDeadline: toYMD(row.early_bird_deadline),
    memberDiscount: Number(row.member_discount || 0),
    image: row.image || null,
    requirements: row.requirements || "",
    includes: Array.isArray(row.includes) ? row.includes : (row.includes ? JSON.parse(row.includes) : []),
    tags: Array.isArray(row.tags) ? row.tags : (row.tags ? JSON.parse(row.tags) : []),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRegRow(row) {
  return {
    id: row.id,
    userId: row.user_id || null,
    name: row.name,
    email: row.email,
    phone: row.phone || "",
    status: row.status,
    amount: Number(row.amount || 0),
    paymentMethod: row.payment_method || null,
    paymentReference: row.payment_reference || null,
    hasPaymentProof: !!row.payment_proof_url,
    paymentProofFileName: row.payment_proof_file_name || null,
    transferDate: row.transfer_date ? String(row.transfer_date).slice(0, 10) : null,
    paidAt: row.paid_at || null,
    checkedIn: !!row.checked_in,
    checkedInAt: row.checked_in_at || null,
    waitlistPosition: row.waitlist_position || null,
    notes: row.notes || null,
    eventPassId: row.event_pass_id || null,
    eventPassCode: row.event_pass_code || null,
    eventPassStatus: row.event_pass_status || null,
    eventPassIssuedAt: row.event_pass_issued_at || null,
    eventPassUsedAt: row.event_pass_used_at || null,
    createdAt: row.created_at,
  };
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeDecodeBase64ToText(value) {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(padded, "base64").toString("utf8").trim();
  } catch (_) {
    return "";
  }
}

function extractScanTokens(rawCode) {
  const raw = String(rawCode || "").trim();
  if (!raw) return [];
  const tokens = new Set([raw]);
  const passCodeMatch = raw.match(/EV-[A-Z0-9-]{6,}/i);
  if (passCodeMatch) tokens.add(passCodeMatch[0].toUpperCase());
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const params = parsed.searchParams;
      ["code", "pass", "passCode", "qr", "id", "user", "userId", "token"].forEach((key) => {
        const value = params.get(key);
        if (value) tokens.add(value.trim());
      });
      parsed.pathname
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => tokens.add(part));
    } catch (_) {
      // ignore malformed URLs from third-party scanners
    }
  }
  return [...tokens].filter(Boolean);
}

function extractUserIdFromToken(token) {
  const raw = String(token || "").trim();
  if (!raw) return null;
  if (UUID_V4_RE.test(raw)) return raw;
  const decoded = safeDecodeBase64ToText(raw);
  if (UUID_V4_RE.test(decoded)) return decoded;
  return null;
}

async function resolveEventRegistrationFromScanCode(eventId, rawCode) {
  const tokens = extractScanTokens(rawCode);
  if (!tokens.length) return null;

  for (const token of tokens) {
    const byEventPass = await pool.query(
      `SELECT er.*
         FROM event_registrations er
         JOIN event_passes ep ON ep.registration_id = er.id
        WHERE er.event_id = $1
          AND UPPER(ep.pass_code) = UPPER($2)
        LIMIT 1`,
      [eventId, token],
    );
    if (byEventPass.rows.length) {
      return { registration: byEventPass.rows[0], source: "event_pass" };
    }
  }

  for (const token of tokens) {
    if (!UUID_V4_RE.test(token)) continue;
    const byRegId = await pool.query(
      `SELECT *
         FROM event_registrations
        WHERE event_id = $1 AND id = $2
        LIMIT 1`,
      [eventId, token],
    );
    if (byRegId.rows.length) {
      return { registration: byRegId.rows[0], source: "registration_id" };
    }
  }

  for (const token of tokens) {
    const userId = extractUserIdFromToken(token);
    if (!userId) continue;
    const byUser = await pool.query(
      `SELECT *
         FROM event_registrations
        WHERE event_id = $1 AND user_id = $2 AND status != 'cancelled'
        ORDER BY CASE WHEN status = 'confirmed' THEN 0 WHEN status = 'pending' THEN 1 ELSE 2 END, created_at DESC
        LIMIT 1`,
      [eventId, userId],
    );
    if (byUser.rows.length) {
      return { registration: byUser.rows[0], source: "wallet_user_qr" };
    }
  }

  return null;
}

async function performEventCheckin({ eventId, registrationId, adminUserId, source = "manual" }) {
  const regRes = await pool.query(
    `SELECT *
       FROM event_registrations
      WHERE id = $1 AND event_id = $2
      LIMIT 1`,
    [registrationId, eventId],
  );
  if (!regRes.rows.length) {
    return { ok: false, code: "not_found", status: 404, message: "Inscripción no encontrada" };
  }
  const reg = regRes.rows[0];
  if (reg.status !== "confirmed") {
    return { ok: false, code: "not_confirmed", status: 409, message: "Solo puedes hacer check-in a inscripciones confirmadas", registration: reg };
  }
  if (reg.checked_in) {
    return { ok: true, alreadyCheckedIn: true, registration: reg, source };
  }

  const upd = await pool.query(
    `UPDATE event_registrations
        SET checked_in = true,
            checked_in_at = NOW(),
            checked_in_by = $1,
            updated_at = NOW()
      WHERE id = $2
      RETURNING *`,
    [adminUserId, registrationId],
  );
  const updated = upd.rows[0];
  await markEventPassUsedByRegistration({ registrationId: updated.id }).catch(() => { });
  triggerWalletPassSync(updated.user_id, "event_checked_in");
  return { ok: true, alreadyCheckedIn: false, registration: updated, source };
}

// ── GET /api/events — Lista pública (solo published) ──────────────────────────
app.get("/api/events", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    let userId = null;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded?.sub || decoded?.userId || null;
      } catch { }
    }
    const { type, upcoming } = req.query;
    const conditions = ["e.status = 'published'"];
    const params = [];
    if (type) { conditions.push(`e.type = $${params.length + 1}`); params.push(type); }
    if (upcoming === "true") { conditions.push(`e.date >= CURRENT_DATE`); }
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const rows = await pool.query(
      `SELECT * FROM events e ${where} ORDER BY e.date ASC, e.start_time ASC`,
      params
    );
    return res.json(rows.rows.map(mapEventRow));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── GET /api/events/admin/all — Todos los eventos con inscripciones ──────────
app.get("/api/events/admin/all", adminMiddleware, async (req, res) => {
  try {
    const evRows = await pool.query(
      `SELECT * FROM events ORDER BY date DESC, start_time DESC`
    );
    const regRows = await pool.query(
      `SELECT er.*, u.display_name,
              ep.id AS event_pass_id,
              ep.pass_code AS event_pass_code,
              ep.status AS event_pass_status,
              ep.issued_at AS event_pass_issued_at,
              ep.used_at AS event_pass_used_at
         FROM event_registrations er
       LEFT JOIN users u ON er.user_id = u.id
       LEFT JOIN event_passes ep ON ep.registration_id = er.id
       ORDER BY er.created_at ASC`
    );
    const regsByEvent = {};
    for (const r of regRows.rows) {
      if (!regsByEvent[r.event_id]) regsByEvent[r.event_id] = [];
      regsByEvent[r.event_id].push(mapRegRow(r));
    }
    const events = evRows.rows.map((e) => ({
      ...mapEventRow(e),
      registrations: regsByEvent[e.id] || [],
    }));
    return res.json(events);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── GET /api/events/:id — Detalle de evento ───────────────────────────────────
app.get("/api/events/:id", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    let userId = null;
    let isAdmin = false;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded?.sub || decoded?.userId || null;
        isAdmin = decoded?.role === "admin" || decoded?.role === "super_admin";
      } catch { }
    }
    const evRes = await pool.query("SELECT * FROM events WHERE id = $1", [req.params.id]);
    if (!evRes.rows.length) return res.status(404).json({ message: "Evento no encontrado" });
    const ev = evRes.rows[0];
    if (!isAdmin && ev.status !== "published") return res.status(404).json({ message: "Evento no disponible" });
    const result = mapEventRow(ev);
    if (userId) {
      const regRes = await pool.query(
        `SELECT er.*,
                ep.id AS event_pass_id,
                ep.pass_code AS event_pass_code,
                ep.status AS event_pass_status,
                ep.issued_at AS event_pass_issued_at,
                ep.used_at AS event_pass_used_at
           FROM event_registrations er
           LEFT JOIN event_passes ep ON ep.registration_id = er.id
          WHERE er.event_id = $1 AND er.user_id = $2 AND er.status != 'cancelled'
          LIMIT 1`,
        [req.params.id, userId]
      );
      result.myRegistration = regRes.rows.length ? mapRegRow(regRes.rows[0]) : null;
    }
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── POST /api/events — Crear evento ──────────────────────────────────────────
app.post("/api/events", adminMiddleware, async (req, res) => {
  try {
    const {
      type, title, description, instructor_name, instructor_photo,
      date, start_time, end_time, location, capacity = 12, price = 0,
      early_bird_price, early_bird_deadline, member_discount = 0,
      image, requirements = "", includes = [], tags = [],
      status = "draft",
    } = req.body;
    if (!type || !title || !description || !instructor_name || !date || !start_time || !end_time || !location) {
      return res.status(400).json({ message: "Faltan campos requeridos" });
    }
    const r = await pool.query(
      `INSERT INTO events (type, title, description, instructor_name, instructor_photo,
        date, start_time, end_time, location, capacity, price, early_bird_price,
        early_bird_deadline, member_discount, image, requirements, includes, tags,
        status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [
        type, title, description, instructor_name, instructor_photo || null,
        date, start_time, end_time, location, capacity, price,
        early_bird_price || null, early_bird_deadline || null, member_discount,
        image || null, requirements,
        JSON.stringify(Array.isArray(includes) ? includes.filter(Boolean) : []),
        JSON.stringify(Array.isArray(tags) ? tags.filter(Boolean) : []),
        status, req.userId,
      ]
    );
    return res.status(201).json(mapEventRow(r.rows[0]));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── PUT /api/events/:id — Actualizar evento ───────────────────────────────────
app.put("/api/events/:id", adminMiddleware, async (req, res) => {
  try {
    const allowed = [
      "type", "title", "description", "instructor_name", "instructor_photo",
      "date", "start_time", "end_time", "location", "capacity", "price",
      "early_bird_price", "early_bird_deadline", "member_discount", "image",
      "requirements", "includes", "tags", "status",
    ];
    const sets = [];
    const vals = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        vals.push(["includes", "tags"].includes(key) ? JSON.stringify(req.body[key]) : req.body[key]);
        sets.push(`${key} = $${vals.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ message: "Nada que actualizar" });
    vals.push(req.params.id);
    sets.push("updated_at = NOW()");
    const r = await pool.query(
      `UPDATE events SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    if (!r.rows.length) return res.status(404).json({ message: "Evento no encontrado" });
    return res.json(mapEventRow(r.rows[0]));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── DELETE /api/events/:id — Eliminar evento ──────────────────────────────────
app.delete("/api/events/:id", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query("DELETE FROM events WHERE id = $1 RETURNING id", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ message: "Evento no encontrado" });
    return res.json({ message: "Evento eliminado" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── POST /api/events/:id/register — Inscribirse ───────────────────────────────
app.post("/api/events/:id/register", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const { name, email, phone = "", payment_method } = req.body;
    if (!name || !email) return res.status(400).json({ message: "name y email son requeridos" });
    const evRes = await pool.query("SELECT * FROM events WHERE id = $1 AND status = 'published'", [req.params.id]);
    if (!evRes.rows.length) return res.status(404).json({ message: "Evento no disponible" });
    const ev = evRes.rows[0];

    // Check existing registration
    const existingRes = await pool.query(
      "SELECT * FROM event_registrations WHERE event_id = $1 AND user_id = $2 LIMIT 1",
      [req.params.id, userId]
    );
    const existing = existingRes.rows[0];
    if (existing && existing.status !== "cancelled") {
      return res.status(400).json({ message: "Ya estás inscrito en este evento" });
    }

    // Calculate price
    let amount = Number(ev.price);
    const now = new Date();
    if (ev.early_bird_price != null && ev.early_bird_deadline) {
      const deadline = new Date(ev.early_bird_deadline);
      if (now <= deadline) amount = Number(ev.early_bird_price);
    }
    if (Number(ev.member_discount) > 0) {
      const memRes = await pool.query(
        `SELECT id FROM memberships WHERE user_id = $1 AND status = 'active' AND end_date >= CURRENT_DATE LIMIT 1`,
        [userId]
      );
      if (memRes.rows.length) {
        amount = Math.round(amount * (1 - Number(ev.member_discount) / 100));
      }
    }

    // Determine status
    const regCount = await pool.query(
      "SELECT COUNT(*) FROM event_registrations WHERE event_id = $1 AND status = 'confirmed'",
      [req.params.id]
    );
    const confirmedCount = Number(regCount.rows[0].count);
    let regStatus = "pending";
    let waitlistPosition = null;
    let paidAt = null;
    if (confirmedCount >= Number(ev.capacity)) {
      regStatus = "waitlist";
      const wlRes = await pool.query(
        "SELECT COALESCE(MAX(waitlist_position), 0) + 1 AS pos FROM event_registrations WHERE event_id = $1 AND status = 'waitlist'",
        [req.params.id]
      );
      waitlistPosition = wlRes.rows[0].pos;
    } else if (amount === 0) {
      regStatus = "confirmed";
      paidAt = new Date();
    }

    let reg;
    if (existing && existing.status === "cancelled") {
      const r = await pool.query(
        `UPDATE event_registrations SET name=$1, email=$2, phone=$3, status=$4, amount=$5,
         payment_method=$6, payment_reference=NULL, payment_proof_url=NULL,
         payment_proof_file_name=NULL, transfer_date=NULL,
         paid_at=$7, waitlist_position=$8, checked_in=false, checked_in_at=NULL, updated_at=NOW()
         WHERE id=$9 RETURNING *`,
        [name, email, phone, regStatus, amount, payment_method || null, paidAt, waitlistPosition, existing.id]
      );
      reg = r.rows[0];
    } else {
      const r = await pool.query(
        `INSERT INTO event_registrations (event_id, user_id, name, email, phone, status, amount, payment_method, paid_at, waitlist_position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.params.id, userId, name, email, phone, regStatus, amount, payment_method || null, paidAt, waitlistPosition]
      );
      reg = r.rows[0];
    }

    // Update registered count if confirmed
    if (regStatus === "confirmed") {
      await pool.query(
        "UPDATE events SET registered = (SELECT COUNT(*) FROM event_registrations WHERE event_id=$1 AND status='confirmed') WHERE id=$1",
        [req.params.id]
      );
    }

    let issuedPass = null;
    if (regStatus === "confirmed" && reg.user_id) {
      issuedPass = await ensureEventPassForRegistration({
        eventId: req.params.id,
        registrationId: reg.id,
        userId: reg.user_id,
      }).catch((passErr) => {
        console.error("[Events] pass issue on register:", passErr?.message || passErr);
        return null;
      });
    } else {
      await cancelEventPassByRegistration({ registrationId: reg.id }).catch(() => { });
    }

    let message;
    if (regStatus === "waitlist") message = `Te agregamos a la lista de espera (posición ${waitlistPosition})`;
    else if (amount === 0) message = "¡Registro confirmado! Te esperamos en el evento.";
    else if (payment_method === "cash") message = "Registro pendiente. Puedes pagar en recepción del studio para confirmar tu lugar.";
    else message = "Registro pendiente de pago. Una vez confirmado tu pago, recibirás la confirmación.";

    return res.status(201).json({
      id: reg.id,
      status: reg.status,
      amount: Number(reg.amount),
      isFree: amount === 0,
      waitlistPosition,
      passCode: issuedPass?.pass_code ?? null,
      message,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── DELETE /api/events/:id/register — Cancelar inscripción ───────────────────
app.delete("/api/events/:id/register", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const regRes = await pool.query(
      "SELECT * FROM event_registrations WHERE event_id=$1 AND user_id=$2 LIMIT 1",
      [req.params.id, userId]
    );
    if (!regRes.rows.length) return res.status(404).json({ message: "No tienes inscripción en este evento" });
    const reg = regRes.rows[0];
    if (!["confirmed", "pending", "waitlist"].includes(reg.status)) {
      return res.status(400).json({ message: "No puedes cancelar este registro" });
    }
    await pool.query(
      "UPDATE event_registrations SET status='cancelled', updated_at=NOW() WHERE id=$1",
      [reg.id]
    );
    await cancelEventPassByRegistration({ registrationId: reg.id }).catch(() => { });
    await pool.query(
      "UPDATE events SET registered = GREATEST(0, (SELECT COUNT(*) FROM event_registrations WHERE event_id=$1 AND status='confirmed')) WHERE id=$1",
      [req.params.id]
    );
    return res.json({ message: "Registro cancelado exitosamente" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── GET /api/events/:id/registrations — Inscripciones admin ──────────────────
app.get("/api/events/:id/registrations", adminMiddleware, async (req, res) => {
  try {
    const rows = await pool.query(
      `SELECT er.*, u.display_name,
              ep.id AS event_pass_id,
              ep.pass_code AS event_pass_code,
              ep.status AS event_pass_status,
              ep.issued_at AS event_pass_issued_at,
              ep.used_at AS event_pass_used_at
         FROM event_registrations er
       LEFT JOIN users u ON er.user_id = u.id
       LEFT JOIN event_passes ep ON ep.registration_id = er.id
       WHERE er.event_id = $1 ORDER BY er.created_at ASC`,
      [req.params.id]
    );
    return res.json(rows.rows.map(mapRegRow));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── PUT /api/events/:eventId/registrations/:regId — Actualizar status ─────────
app.put("/api/events/:eventId/registrations/:regId", adminMiddleware, async (req, res) => {
  try {
    const { status, notes } = req.body;
    const valid = ["confirmed", "pending", "waitlist", "cancelled", "no_show"];
    if (status && !valid.includes(status)) {
      return res.status(400).json({ message: "Status inválido" });
    }
    const sets = ["updated_at=NOW()"];
    const vals = [];
    if (status) {
      vals.push(status);
      sets.push(`status=$${vals.length}`);
      if (status === "confirmed") {
        sets.push("paid_at = COALESCE(paid_at, NOW())");
      }
    }
    if (notes !== undefined) {
      vals.push(notes);
      sets.push(`notes=$${vals.length}`);
    }
    vals.push(req.params.regId);
    const r = await pool.query(
      `UPDATE event_registrations SET ${sets.join(",")} WHERE id=$${vals.length} AND event_id=$${vals.length + 1} RETURNING *`,
      [...vals, req.params.eventId]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Inscripción no encontrada" });
    // Refresh registered count
    await pool.query(
      "UPDATE events SET registered = (SELECT COUNT(*) FROM event_registrations WHERE event_id=$1 AND status='confirmed') WHERE id=$1",
      [req.params.eventId]
    );
    const updatedReg = r.rows[0];
    if (updatedReg.status === "confirmed" && updatedReg.user_id) {
      await ensureEventPassForRegistration({
        eventId: req.params.eventId,
        registrationId: updatedReg.id,
        userId: updatedReg.user_id,
      }).catch((passErr) => {
        console.error("[Events] pass issue on admin status update:", passErr?.message || passErr);
      });
    } else if (["cancelled", "no_show", "waitlist", "pending"].includes(updatedReg.status)) {
      await cancelEventPassByRegistration({ registrationId: updatedReg.id }).catch(() => { });
    }
    return res.json({ message: "Inscripción actualizada", status: r.rows[0].status });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── POST /api/events/:eventId/checkin/scan — Check-in por QR/código ─────────
// IMPORTANT: /scan MUST be declared before /:regId; Express matches in order
// and the parameterized route would otherwise consume "scan" as a regId.
app.post("/api/events/:eventId/checkin/scan", adminMiddleware, async (req, res) => {
  try {
    const code = String(req.body?.code || "").trim();
    if (!code) {
      return res.status(400).json({ message: "Debes enviar un código QR para validar" });
    }

    const resolved = await resolveEventRegistrationFromScanCode(req.params.eventId, code);
    if (!resolved?.registration?.id) {
      return res.status(404).json({ message: "No se encontró una inscripción válida para este QR en el evento" });
    }

    const result = await performEventCheckin({
      eventId: req.params.eventId,
      registrationId: resolved.registration.id,
      adminUserId: req.userId,
      source: resolved.source,
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({ message: result.message || "No se pudo registrar el check-in" });
    }

    return res.json({
      message: result.alreadyCheckedIn ? "La clienta ya tenía check-in registrado" : "Check-in exitoso",
      data: {
        registrationId: result.registration.id,
        name: result.registration.name,
        email: result.registration.email,
        alreadyCheckedIn: !!result.alreadyCheckedIn,
        source: resolved.source,
      },
    });
  } catch (err) {
    console.error("[Events] scan check-in error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── POST /api/events/:eventId/checkin/:regId — Check-in manual ────────────────
// Declared AFTER /scan above so that "scan" doesn't get matched as :regId.
app.post("/api/events/:eventId/checkin/:regId", adminMiddleware, async (req, res) => {
  try {
    const result = await performEventCheckin({
      eventId: req.params.eventId,
      registrationId: req.params.regId,
      adminUserId: req.userId,
      source: "manual",
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({ message: result.message || "No se pudo registrar el check-in" });
    }
    return res.json({
      message: result.alreadyCheckedIn ? "Esta inscripción ya tenía check-in" : "Check-in exitoso",
      checkedIn: true,
      alreadyCheckedIn: result.alreadyCheckedIn,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── PUT /api/events/:id/register/payment — Enviar comprobante ─────────────────
app.put("/api/events/:id/register/payment", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const { payment_method, transfer_reference, transfer_date, file_data, file_name, notes } = req.body;

    const regRes = await pool.query(
      "SELECT * FROM event_registrations WHERE event_id=$1 AND user_id=$2 AND status='pending' LIMIT 1",
      [req.params.id, userId]
    );
    if (!regRes.rows.length)
      return res.status(404).json({ message: "No tienes una inscripción pendiente en este evento" });
    const reg = regRes.rows[0];

    if (payment_method === "transfer" && !transfer_reference && !file_data) {
      return res.status(400).json({ message: "Debes proporcionar una referencia o comprobante de transferencia" });
    }

    let r;
    if (payment_method === "cash") {
      r = await pool.query(
        `UPDATE event_registrations
         SET payment_method='cash',
             payment_reference=NULL,
             payment_proof_url=NULL,
             payment_proof_file_name=NULL,
             transfer_date=NULL,
             updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [reg.id]
      );
    } else {
      r = await pool.query(
        `UPDATE event_registrations
         SET payment_method='transfer',
             payment_reference=$1,
             transfer_date=$2,
             payment_proof_url=$3,
             payment_proof_file_name=$4,
             updated_at=NOW()
         WHERE id=$5 RETURNING *`,
        [transfer_reference || null, transfer_date || null, file_data || null, file_name || null, reg.id]
      );
    }

    return res.json({
      message: payment_method === "cash"
        ? "Seleccionado pago en studio. El admin confirmará tu lugar cuando pagues en recepción."
        : "Comprobante enviado exitosamente. Tu pago será verificado pronto.",
      registration: {
        id: r.rows[0].id,
        status: r.rows[0].status,
        paymentReference: r.rows[0].payment_reference,
        hasPaymentProof: !!r.rows[0].payment_proof_url,
      },
    });
  } catch (err) {
    console.error("PUT events/register/payment error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Web Push: avisos del admin ──────────────────────────────────────────────
app.get("/api/admin/push/stats", adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT COUNT(DISTINCT user_id)::int AS subscribers, COUNT(*)::int AS devices FROM push_subscriptions"
    );
    return res.json({
      enabled: isPushConfigured(),
      subscribers: r.rows[0]?.subscribers ?? 0,
      devices: r.rows[0]?.devices ?? 0,
    });
  } catch (err) {
    console.error("GET /api/admin/push/stats:", err.message);
    return res.status(500).json({ message: "Error interno" });
  }
});

app.post("/api/admin/push/broadcast", adminMiddleware, async (req, res) => {
  try {
    if (!isPushConfigured()) return res.status(400).json({ message: "Push no configurado" });
    const { title, body, url, segment } = req.body || {};
    if (!title || !body) return res.status(400).json({ message: "Falta título o mensaje" });
    const seg = segment === "active_membership" ? "active_membership" : "all";
    let userQuery;
    if (seg === "active_membership") {
      userQuery = `
        SELECT DISTINCT ps.user_id
          FROM push_subscriptions ps
         WHERE EXISTS (
           SELECT 1 FROM memberships m
            WHERE m.user_id = ps.user_id
              AND m.status = 'active'
              AND (m.end_date IS NULL OR m.end_date >= CURRENT_DATE)
         )`;
    } else {
      userQuery = "SELECT DISTINCT user_id FROM push_subscriptions";
    }
    const users = await pool.query(userQuery);
    let sent = 0, failed = 0, pruned = 0;
    for (const row of users.rows) {
      const r = await sendPushToUser(row.user_id, {
        title: String(title).slice(0, 80),
        body: String(body).slice(0, 240),
        url: url || "/app",
        tag: "admin_broadcast",
        respectPrefs: true,
      });
      sent += r.sent; failed += r.failed; pruned += r.pruned;
    }
    return res.json({ recipients: users.rows.length, sent, failed, pruned });
  } catch (err) {
    console.error("POST /api/admin/push/broadcast:", err.message);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─── Email test endpoint (admin only) ─────────────────────────────────────────
app.post("/api/admin/test-emails", adminMiddleware, async (req, res) => {
  const testTo = req.body.to || "saidromero19@gmail.com";
  const testName = "Said (Test)";
  const results = [];
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  const jobs = [
    { label: "Membresía activada", fn: () => sendMembershipActivated({ to: testTo, name: testName, planName: "4 Clases", startDate: new Date().toISOString(), endDate: new Date(Date.now() + 30 * 86400000).toISOString(), classLimit: 4 }) },
    { label: "Reserva confirmada", fn: () => sendBookingConfirmed({ to: testTo, name: testName, className: "Pilates Matt Clásico", date: new Date().toISOString(), startTime: "09:00", instructor: "Instructora Angelina", classesLeft: 3, isWaitlist: false }) },
    { label: "Reserva cancelada (a tiempo)", fn: () => sendBookingCancelled({ to: testTo, name: testName, className: "Flex & Flow", date: new Date().toISOString(), startTime: "11:00", creditRestored: true, isLate: false, classesLeft: 4 }) },
    { label: "Reserva cancelada (tardía)", fn: () => sendBookingCancelled({ to: testTo, name: testName, className: "Body Strong", date: new Date().toISOString(), startTime: "18:00", creditRestored: false, isLate: true, classesLeft: 3 }) },
    { label: "Recordatorio semanal", fn: () => sendWeeklyReminder({ to: testTo, name: testName, classesLeft: 2, endDate: new Date(Date.now() + 15 * 86400000).toISOString() }) },
    { label: "Renovación (última clase)", fn: () => sendRenewalReminder({ to: testTo, name: testName, planName: "4 Clases", classesLeft: 1, endDate: new Date(Date.now() + 5 * 86400000).toISOString(), reason: "last_class" }) },
    { label: "Renovación (por vencer)", fn: () => sendRenewalReminder({ to: testTo, name: testName, planName: "Mensual Ilimitado", classesLeft: null, endDate: new Date(Date.now() + 3 * 86400000).toISOString(), reason: "expiring_soon" }) },
    { label: "Reset de contraseña", fn: () => sendPasswordResetEmail({ to: testTo, name: testName, token: "test-token-123456" }) },
  ];

  // Send one at a time with 700ms delay to respect Resend's 2 req/s limit
  for (const job of jobs) {
    try {
      await job.fn();
      results.push(`✅ ${job.label}`);
    } catch (e) {
      results.push(`❌ ${job.label}: ${e.message}`);
    }
    await delay(700);
  }

  const hasResendKey = !!process.env.RESEND_API_KEY;
  return res.json({
    message: hasResendKey
      ? `Se enviaron ${results.filter(r => r.startsWith("✅")).length} emails de prueba a ${testTo}`
      : "⚠️ RESEND_API_KEY no está configurada. Los emails NO se enviaron.",
    resendKeySet: hasResendKey,
    fromEmail: process.env.EMAIL_FROM || "onboarding@resend.dev (default)",
    results,
  });
});

// ─── Serve React SPA (static) ────────────────────────────────────────────────
const distDir = path.join(__dirname, "../dist");
app.use(express.static(distDir, {
  setHeaders: (res, path) => {
    if (path.endsWith(".css")) {
      res.setHeader("Content-Type", "text/css");
    } else if (path.endsWith(".js")) {
      res.setHeader("Content-Type", "application/javascript");
    }
  }
}));

app.get("*", (_req, res, next) => {
  if (_req.path.startsWith("/api")) return next();
  res.sendFile(path.join(distDir, "index.html"));
});

/**
 * Runs every Sunday at 8:00 AM Mexico City time (UTC-6 = 14:00 UTC).
 * Sends weekly reminder to all users with an active membership.
 */
async function runWeeklyReminderCron() {
  try {
    const res = await pool.query(`
      SELECT u.email, COALESCE(u.display_name, 'Alumna') AS name,
             m.classes_remaining, m.end_date
      FROM memberships m
      JOIN users u ON m.user_id = u.id
      WHERE m.status = 'active'
        AND (m.end_date IS NULL OR m.end_date >= CURRENT_DATE)
    `);
    console.log(`[Cron] Weekly reminder — ${res.rows.length} members`);
    for (const row of res.rows) {
      await sendWeeklyReminder({
        to: row.email,
        name: row.name,
        classesLeft: row.classes_remaining,
        endDate: row.end_date,
      }).catch((e) => console.error("[Email] weekly cron:", e.message));
      // Small delay to avoid rate limits
      await new Promise((r) => setTimeout(r, 200));
    }
  } catch (err) {
    console.error("[Cron] Weekly reminder error:", err.message);
  }
}

/**
 * Runs every day at 9:00 AM.
 * Sends renewal reminder to members with 1 class left OR expiring in ≤7 days.
 */
async function runRenewalReminderCron() {
  try {
    // El aviso por FECHA de vencimiento ("tu plan vence el X") se retiró a
    // petición del estudio (jun 2026). Este cron ahora solo notifica el caso
    // de "última clase" (a la alumna le queda 1 clase de un plan multi-clase),
    // por créditos — nunca por fecha. El ajuste renewal_reminder_days dejó de
    // usarse.

    // Dedup table — one row per (membership_id, dedup_key) so el aviso de
    // última clase se manda una sola vez por membresía.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS renewal_reminders_sent (
        membership_id UUID NOT NULL,
        dedup_key     TEXT NOT NULL,
        sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (membership_id, dedup_key)
      )
    `).catch(() => {});

    const res = await pool.query(`
      SELECT m.id AS membership_id,
             u.id AS user_id,
             u.email, u.phone, COALESCE(u.display_name, 'Alumna') AS name,
             m.classes_remaining, m.end_date,
             COALESCE(m.class_limit_override, p.class_limit) AS effective_class_limit,
             (m.end_date - CURRENT_DATE) AS days_remaining,
             COALESCE(p.name, m.plan_name_override, 'Tu membresía') AS plan_name
      FROM memberships m
      JOIN users u ON m.user_id = u.id
      LEFT JOIN plans p ON m.plan_id = p.id
      WHERE m.status = 'active'
        AND u.receive_reminders IS NOT FALSE
        AND (m.end_date IS NULL OR m.end_date >= CURRENT_DATE)
        -- Solo "última clase": a la alumna le queda 1 clase de un plan que
        -- empezó con más de 1 (estado BAJO; un plan de 1 sola clase con 1
        -- restante es su estado lleno, no bajo). El aviso por fecha de
        -- vencimiento se retiró a petición del estudio.
        AND (m.classes_remaining = 1 AND COALESCE(m.class_limit_override, p.class_limit, 0) > 1)
    `);
    console.log(`[Cron] Renewal reminder — ${res.rows.length} candidates`);

    // Filter out already-sent (membership, dedup_key) pairs.
    // Único caso vivo: última clase. Una fila = una membresía con 1 clase
    // restante; se avisa una sola vez (dedup_key fijo "last_class").
    const candidates = res.rows.map((row) => ({ ...row, reason: "last_class", dedupKey: "last_class" }));
    const keys = candidates.map((c) => [c.membership_id, c.dedupKey]);
    let alreadySent = new Set();
    if (keys.length) {
      const sentRes = await pool.query(
        `SELECT membership_id, dedup_key
           FROM renewal_reminders_sent
          WHERE (membership_id, dedup_key) IN (
            SELECT UNNEST($1::uuid[]), UNNEST($2::text[])
          )`,
        [keys.map((k) => k[0]), keys.map((k) => k[1])]
      ).catch(() => ({ rows: [] }));
      alreadySent = new Set(sentRes.rows.map((r) => `${r.membership_id}|${r.dedup_key}`));
    }
    const pending = candidates.filter((c) => !alreadySent.has(`${c.membership_id}|${c.dedupKey}`));
    console.log(`[Cron] Renewal reminder — sending ${pending.length} (skipped ${candidates.length - pending.length} already-sent)`);

    for (const row of pending) {
      await sendRenewalReminder({
        to: row.email,
        name: row.name,
        planName: row.plan_name,
        classesLeft: row.classes_remaining,
        endDate: row.end_date,
        reason: row.reason,
      }).catch((e) => console.error("[Email] renewal cron:", e.message));
      // WhatsApp renewal reminder
      sendConfiguredWhatsAppTemplate({
        templateKey: "last_class_reminder",
        phone: row.phone,
        vars: {
          name: row.name,
          plan: row.plan_name,
          classesRemaining: row.classes_remaining ?? "",
        },
        fallbackMessage: `Hola ${row.name} 💜 Te queda *1 clase* en tu plan ${row.plan_name}. Renueva para seguir entrenando sin parar. 🤍`,
      }).catch((e) => console.error("[WA] last-class reminder:", e.message));
      sendConfiguredPushTemplate({
        templateKey: "last_class_reminder",
        userId: row.user_id,
        vars: { name: row.name, plan: row.plan_name, classesRemaining: row.classes_remaining ?? "" },
      }).catch((e) => console.error("[Push] last-class reminder:", e.message));

      // Mark as sent (best-effort; if it fails we'll retry tomorrow).
      await pool.query(
        `INSERT INTO renewal_reminders_sent (membership_id, dedup_key)
         VALUES ($1, $2)
         ON CONFLICT (membership_id, dedup_key) DO NOTHING`,
        [row.membership_id, row.dedupKey]
      ).catch((e) => console.error("[Cron] renewal dedup insert:", e.message));

      await new Promise((r) => setTimeout(r, 200));
    }
  } catch (err) {
    console.error("[Cron] Renewal reminder error:", err.message);
  }
}

/**
 * Two-shot daily WhatsApp reminder strategy:
 *
 *   9:00 PM  →  "morning" mode  — reminds for tomorrow's classes that start before noon
 *   8:00 AM  →  "afternoon" mode — reminds for today's classes that start at noon or later
 *
 * Every message is staggered 3 minutes apart to avoid Evolution API rate-limits.
 * A booking is only ever reminded once (tracked in whatsapp_reminders_sent).
 */
const CLASS_REMINDER_STAGGER_MS = 3 * 60 * 1000; // 3 min between each WhatsApp

async function runClassReminderCron(mode = "morning") {
  try {
    const notificationSettings = await getSettingsValue("notification_settings", DEFAULT_NOTIFICATION_SETTINGS);
    if (notificationSettings?.whatsapp_reminders === false) {
      console.log(`[Cron] Class reminder (${mode}) — WhatsApp disabled, skipping`);
      return;
    }
    if (notificationSettings?.class_reminder_enabled === false) {
      console.log(`[Cron] Class reminder (${mode}) — class_reminder_enabled=false, skipping`);
      return;
    }

    // morning  → tomorrow's classes that start before 12:00
    // afternoon → today's classes that start at 12:00 or later
    // EXTRACT(EPOCH FROM start_time) works for both TIME and INTERVAL column types.
    const targetDate = mode === "morning"
      ? `(CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::date + 1`
      : `(CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::date`;
    const timeFilter = mode === "morning"
      ? `EXTRACT(EPOCH FROM c.start_time) < 43200`
      : `EXTRACT(EPOCH FROM c.start_time) >= 43200`;
    const dayLabel = mode === "morning" ? "mañana" : "hoy";

    const res = await pool.query(`
      SELECT b.id AS booking_id, b.user_id,
             u.phone, COALESCE(u.display_name, 'Alumna') AS name,
             u.receive_reminders,
             ct.name AS class_name,
             c.date, c.start_time
      FROM bookings b
      JOIN classes c ON b.class_id = c.id
      JOIN class_types ct ON c.class_type_id = ct.id
      JOIN users u ON b.user_id = u.id
      WHERE b.status = 'confirmed'
        AND c.status = 'scheduled'
        AND c.date = ${targetDate}
        AND ${timeFilter}
        AND u.phone IS NOT NULL
        AND u.receive_reminders IS NOT FALSE
      ORDER BY c.start_time ASC, b.created_at ASC
    `);

    if (!res.rows.length) {
      console.log(`[Cron] Class reminder (${mode}) — no classes found`);
      return;
    }

    // Ensure dedup tracking table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_reminders_sent (
        booking_id UUID PRIMARY KEY,
        sent_date  DATE NOT NULL DEFAULT CURRENT_DATE,
        sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});

    // Filter out already-sent bookings
    const bookingIds = res.rows.map((r) => r.booking_id);
    const sentRes = await pool.query(
      `SELECT booking_id FROM whatsapp_reminders_sent WHERE booking_id = ANY($1)`,
      [bookingIds]
    ).catch(() => ({ rows: [] }));
    const alreadySent = new Set(sentRes.rows.map((r) => r.booking_id));

    const pending = res.rows.filter((r) => !alreadySent.has(r.booking_id));
    if (!pending.length) {
      console.log(`[Cron] Class reminder (${mode}) — all already sent`);
      return;
    }

    console.log(`[Cron] Class reminder (${mode}) — sending ${pending.length} reminders, staggered every 3 min`);

    let totalSent = 0;
    for (let i = 0; i < pending.length; i++) {
      const row = pending[i];

      // Wait before each subsequent message
      if (i > 0) await sleep(CLASS_REMINDER_STAGGER_MS);

      // Re-check right before sending: settings flag could have flipped, or
      // the booking/class could have been cancelled while we were waiting in
      // the staggered queue (3 min × N).
      invalidateSettingsCache("notification_settings");
      const ns = await getSettingsValue("notification_settings", DEFAULT_NOTIFICATION_SETTINGS);
      if (ns?.whatsapp_reminders === false || ns?.class_reminder_enabled === false) {
        console.log(`[Cron] Class reminder — flag flipped to off mid-run, aborting remaining ${pending.length - i}`);
        break;
      }

      const stillActive = await pool.query(
        `SELECT 1 FROM bookings b JOIN classes c ON b.class_id=c.id
         WHERE b.id=$1 AND b.status='confirmed' AND c.status='scheduled'`,
        [row.booking_id]
      );
      if (!stillActive.rows.length) {
        console.log(`[Cron] Class reminder — booking ${row.booking_id} no longer active, skipping`);
        continue;
      }

      const timeKey = String(row.start_time).slice(0, 5);
      const dateStr = row.date ? new Date(row.date).toLocaleDateString("es-MX") : "";

      await sendConfiguredWhatsAppTemplate({
        templateKey: "class_reminder",
        phone: row.phone,
        vars: {
          name: row.name,
          class: row.class_name,
          date: dateStr,
          time: timeKey,
        },
        fallbackMessage: `Hola ${row.name}, te recordamos tu clase de ${row.class_name} ${dayLabel} a las ${timeKey}. ¡Te esperamos!`,
      }).catch((e) => console.error("[WA] class reminder:", e.message));
      sendConfiguredPushTemplate({
        templateKey: "class_reminder",
        userId: row.user_id,
        vars: { name: row.name, class: row.class_name, date: dateStr, time: timeKey },
      }).catch((e) => console.error("[Push] class reminder:", e.message));

      await pool.query(
        `INSERT INTO whatsapp_reminders_sent (booking_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [row.booking_id]
      ).catch(() => {});

      totalSent++;
    }

    // Cleanup records older than 3 days
    await pool.query(
      `DELETE FROM whatsapp_reminders_sent WHERE sent_date < CURRENT_DATE - INTERVAL '3 days'`
    ).catch(() => {});

    console.log(`[Cron] Class reminder (${mode}) — ${totalSent} WhatsApp reminders sent`);
  } catch (err) {
    console.error(`[Cron] Class reminder (${mode}) error:`, err.message);
  }
}

// ── Recordatorios de clase: 12 h y 30 min antes (texto fijo) ───────────────────
// Corre cada ~5 min. Dedup por (booking_id, kind) en class_reminder_sent. Envía
// por la cola global (anti-bloqueo). Respeta whatsapp_reminders/class_reminder.
async function runClassReminders() {
  try {
    const ns = await getSettingsValue("notification_settings", DEFAULT_NOTIFICATION_SETTINGS);
    if (ns?.whatsapp_reminders === false || ns?.class_reminder_enabled === false) return;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS class_reminder_sent (
        booking_id UUID NOT NULL,
        kind       TEXT NOT NULL,
        sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (booking_id, kind)
      )
    `).catch(() => {});

    // Minutos hasta el inicio de cada clase (en hora de México) por reserva
    // confirmada, con teléfono y recordatorios activados; ventana ±1 día.
    const res = await pool.query(`
      SELECT b.id AS booking_id, u.phone, COALESCE(u.display_name,'Alumna') AS name,
             EXTRACT(EPOCH FROM (
               ((c.date + c.start_time::time) AT TIME ZONE 'America/Mexico_City') - now()
             )) / 60 AS mins_until
      FROM bookings b
      JOIN classes c ON b.class_id = c.id
      JOIN users u   ON b.user_id = u.id
      WHERE b.status = 'confirmed'
        AND c.status = 'scheduled'
        AND u.phone IS NOT NULL
        AND u.receive_reminders IS NOT FALSE
        AND c.date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 1
        AND ((c.date + c.start_time::time) AT TIME ZONE 'America/Mexico_City') > now()
    `);

    const due = [];
    for (const r of res.rows) {
      const m = Number(r.mins_until);
      if (m <= 720 && m > 45) due.push({ ...r, kind: "12h" });   // dentro de 12 h (>45 min)
      if (m <= 40 && m >= 15) due.push({ ...r, kind: "30m" });   // ~30 min antes (ventana 15–40)
    }
    if (!due.length) return;

    const sentRes = await pool.query(
      "SELECT booking_id, kind FROM class_reminder_sent WHERE booking_id = ANY($1)",
      [due.map((d) => d.booking_id)]
    ).catch(() => ({ rows: [] }));
    const already = new Set(sentRes.rows.map((r) => `${r.booking_id}:${r.kind}`));
    const pending = due.filter((d) => !already.has(`${d.booking_id}:${d.kind}`));
    if (!pending.length) return;
    // Encolar primero los de 30 min (más urgentes) antes que los de 12 h.
    pending.sort((a, b) => (a.kind === "30m" ? 0 : 1) - (b.kind === "30m" ? 0 : 1));

    console.log(`[Cron] Recordatorios de clase — ${pending.length} por enviar`);
    for (const d of pending) {
      // Marcar ANTES de encolar (la cola global espacia el envío 3.5–7 s); evita
      // duplicar si un tick se solapa. ON CONFLICT garantiza 1 envío por tipo.
      const ins = await pool.query(
        "INSERT INTO class_reminder_sent (booking_id, kind) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING booking_id",
        [d.booking_id, d.kind]
      ).catch(() => ({ rowCount: 0 }));
      if (!ins.rowCount) continue;
      const is12h = d.kind === "12h";
      sendConfiguredWhatsAppTemplate({
        templateKey: is12h ? "class_reminder_12h" : "class_reminder_30m",
        phone: d.phone,
        vars: { name: d.name },
        fallbackMessage: is12h
          ? "Recordatorio de clase.\nHola 🌞🌙\n\nRecuerda que tienes una clase programada en las próximas 12 hrs, no te la pierdas 🩷"
          : "Tu clase comienza en 30 minutos, no te la pierdas 🩷",
      }).catch((e) => console.error("[WA] recordatorio clase:", e.message));
    }

    await pool.query(
      "DELETE FROM class_reminder_sent WHERE sent_at < NOW() - INTERVAL '3 days'"
    ).catch(() => {});
  } catch (err) {
    console.error("[Cron] runClassReminders error:", err.message);
  }
}

function scheduleEmailCrons() {
  // Recordatorios de clase (12 h y 30 min antes): revisión cada 5 minutos.
  setInterval(() => { runClassReminders(); }, 5 * 60 * 1000);

  // Resumen semanal por EMAIL: domingos 8:00 AM hora de México.
  // (Renovación y los recordatorios viejos 9pm/8am quedaron retirados.)
  setInterval(() => {
    const now = new Date();
    const mexicoHour = (now.getUTCHours() - 6 + 24) % 24;
    const dayOfWeek = now.getUTCDay();
    if (dayOfWeek === 0 && mexicoHour === 8 && now.getUTCMinutes() < 60) {
      console.log("[Cron] Triggering weekly reminder...");
      runWeeklyReminderCron();
    }
  }, 60 * 60 * 1000);
}

// ─── Start ───────────────────────────────────────────────────────────────────
async function bootServer() {
  await ensureSchema();
  scheduleEmailCrons();
  // Initialize Google Wallet loyalty class if configured
  ensureGoogleWalletClass().catch(() => { });
  app.listen(PORT, () => {
    console.log(`🚀 Tu Espacio Pilates VM → http://localhost:${PORT}`);
  });
}

bootServer().catch((err) => {
  console.error("❌ Fatal startup error:", err.message);
  process.exit(1);
});
