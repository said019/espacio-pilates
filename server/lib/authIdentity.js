// server/lib/authIdentity.js
// Decide si un identificador de login es un correo (admin) o un teléfono (cliente).
export function isEmailIdentifier(value) {
  return typeof value === "string" && value.includes("@");
}
