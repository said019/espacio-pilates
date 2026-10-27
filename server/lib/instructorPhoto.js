// Fotos de coach subidas sin Google Drive quedaron como data URL base64 de
// cientos de KB. Los listados mandan una URL cacheable en su lugar.
const INLINE_PHOTO = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function inlineInstructorPhotoPath(id, photoUrl, updatedAt) {
  if (typeof photoUrl !== "string" || !photoUrl.startsWith("data:")) return photoUrl;
  const version = updatedAt ? new Date(updatedAt).getTime() : 0;
  return `/api/public/instructors/${id}/photo?v=${version}`;
}

// Mismo resultado que inlineInstructorPhotoPath, pero en SQL para que el base64
// no salga de Postgres en cada fila de clase.
export function instructorPhotoSql(alias) {
  return `CASE WHEN ${alias}.photo_url LIKE 'data:%'
    THEN '/api/public/instructors/' || ${alias}.id || '/photo?v=' || COALESCE(FLOOR(EXTRACT(EPOCH FROM ${alias}.updated_at) * 1000)::bigint, 0)
    ELSE ${alias}.photo_url END`;
}

// El frontend vive en otro dominio, así que las rutas propias van con el host del API.
export function publicApiUrl(req, value) {
  return typeof value === "string" && value.startsWith("/api/") ? `//${req.get("host")}${value}` : value;
}

export function decodeInlinePhoto(value) {
  const match = INLINE_PHOTO.exec(typeof value === "string" ? value : "");
  return match ? { mimeType: match[1], buffer: Buffer.from(match[2], "base64") } : null;
}
