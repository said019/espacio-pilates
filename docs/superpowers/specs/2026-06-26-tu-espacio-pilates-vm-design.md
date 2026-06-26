# Tu Espacio Pilates VM — Diseño del Sistema (Spec)

- **Fecha:** 2026-06-26
- **Estado:** Aprobado para implementación (v1 "Esencial")
- **Studio:** Tu Espacio Pilates · Villa Magna (VM) — San Luis Potosí, S.L.P.

## 1. Objetivo

Crear el sistema de reservas y administración de **Tu Espacio Pilates VM** reutilizando como base la
plataforma existente de **Valiance Pilates** (React + Vite + TS + shadcn/ui · backend Express · Postgres/Supabase ·
WhatsApp Evolution API · correo Resend). Se hace un **rediseño profundo de identidad** y se **adapta el motor**
a la operación real de VM. La plataforma ya fue rebrandeada antes (Punto Neutro → Valiance), así que el theming
está centralizado y el riesgo es bajo.

## 2. Alcance v1 (decidido con el cliente)

- **v1 Esencial.** Incluye: reservas, paquetes/membresías, pagos por transferencia con validación,
  recordatorios automáticos WhatsApp/correo, panel admin y portal cliente — todo con marca VM.
- **Una sola clase "Pilates"** (cupo 8) con **tema muscular por día**.
- **Sin QR** en v1: check-in manual del admin.
- **Fuera de v1:** lealtad/puntos, biblioteca de videos, tarjetas Apple/Google Wallet, QR,
  y la separación Reformer/Barre/Combo de Valiance.
- **Eventos de cumpleaños/brunch:** informativos en el landing, **no reservables** en v1.

## 3. Identidad visual

- **Nombre:** Tu Espacio Pilates · Villa Magna (VM).
- **Tono:** sencillo, lindo, **exclusivo** pero **cercano / de comunidad**. Valores: disciplina, respeto,
  comunidad, higiene. Cliente objetivo: madres, embarazadas, mujeres de 25+.
- **Paleta:**

  | Rol | Color | Hex |
  |---|---|---|
  | Primario (blush/nude) | rosa marca | `#C9ADA3` |
  | Acento (lila/lavanda) | destacados / temas | `#C0AAD6` |
  | Neutro frío | fondos limpios | `#E3E7E9` |
  | Tinta | texto / line-art | `#1A1A1A` |
  | Premium | detalles finos | `#B8915A` (dorado) |

- **Tipografía:** display serif elegante (p. ej. Cormorant Garamond / Playfair) + cuerpo sans limpio (Inter).
- **Logo:** sello circular "TU ESPACIO PILATES / VILLA MAGNA" con line-art. Se usa el render del PDF como base
  hasta tener SVG/PNG transparente limpio.

## 4. Modelo de clases, horarios y datos

- **Clase única "Pilates"**, cupo **8**, duración 1 h.
- **Tema muscular por día** (se muestra en el calendario):
  - Lunes: Pierna & glúteo · Martes: Full body · Miércoles: Tren superior
  - Jueves: Pierna & glúteo · Viernes: Full body · Sábado: Core
- **Horarios:**
  - Lun / Mié / Vie: 7:00, 8:00, 9:00 am · 5:30, 6:30, 7:30, 8:30 pm
  - Mar / Jue: 5:30, 6:30, 7:30 pm
  - Sábado: 9:00 am
- **Paquetes (mensuales, no acumulables, vencen al fin del mes de compra):**
  - A — 7 clases/mes — $880
  - B — 9 clases/mes — $1,050
  - C — 14 clases/mes — $1,400
  - Inscripción (pago único): $500 — re-pago si ausencia > 3 meses.
  - Clase extra (ya inscrita): $130 · Clase suelta / visita: $250.
- **Vigencia:** `end_date` = **fin del mes de compra** (ajuste a la lógica actual de `duration_days`).
  Pago mensual antes del **día 4** de cada mes.

## 5. Regla de cancelación / reagenda (lógica nueva)

Sea `T` = inicio de la clase, `Δ = T − ahora`:

| Δ (antes de la clase) | ¿Cancelar? | ¿Reagendar? | Crédito |
|---|---|---|---|
| **≥ 12 h** | Sí | Sí | Se **devuelve** el crédito |
| **3 h – 12 h** | No sin penalización (si cancela, **pierde** crédito) | **Sí** | Crédito **ya consumido**, conserva la clase movida |
| **< 3 h** | No | No | **Pierde** el lugar |

- Agrega una operación real de **"reagendar"** (hoy solo existe cancelar + volver a reservar).
- Reagendar mueve la reserva a otra clase con cupo disponible sin devolver/cobrar crédito adicional.
- Configurable en Ajustes: ventana de cancelación (12 h) y ventana de reagenda (3 h).

## 6. Pagos

- **Solo transferencia.** Flujo: cliente crea orden → sube comprobante → admin valida (conciliación
  bancaria) → se activa la membresía. Las órdenes expiran si no se aprueban.
- **Datos bancarios** (CLABE, banco, titular, instrucciones) se configuran en **Ajustes → Banco**
  (`system_settings.bank_info`). Pendiente que el cliente los proporcione.

## 7. Recordatorios automáticos (se activan)

Por **WhatsApp (Evolution API) + correo (Resend)**, configurables en Ajustes:
- **Confirmación** al reservar (ya existe).
- **Recordatorio** la noche anterior y ~3 h antes de la clase.
- **Renovación** próxima (aviso antes del día 4) y **última clase** del paquete.
- Cancelación/promoción de lista de espera (ya existen).

Requiere activar el cron de recordatorios (el código existe pero está apagado).

## 8. Pantallas (se conservan, rebrandeadas)

- **Cliente:** landing · reservar (calendario semanal) · mis reservas (cancelar/reagendar) ·
  comprar paquete + subir comprobante · mis órdenes · perfil / preferencias de avisos.
- **Admin:** dashboard (KPIs) · clientes · membresías · clases · horarios · reservas + lista de espera ·
  pagos (verificación de transferencias) · reportes · staff · ajustes (general, banco, notificaciones, políticas, WhatsApp).

## 9. Datos de contacto / negocio (VM)

- Dirección: Av. Villa Magna Nte. 600 A, Villa Magna, 78183 San Luis Potosí, S.L.P. ("justo arriba de las pizzas").
- Teléfono / WhatsApp: 444 548 0352.
- Maps: https://g.co/kgs/AyHBK5d · Instagram: https://www.instagram.com/_espaciopilatesvm/
- Reglamento (mostrar en app): calcetín siempre, ingresar en silencio, limpiar el equipo usado,
  no azotar camas, celulares en silencio, entrar/salir por el lado derecho, esperar a que la compañera se retire,
  zapatos/objetos en el rack. Tolerancia 5 min.

## 10. Arquitectura técnica

- **Ubicación:** `/Users/saidromero/Tu Espacio Pilates` — copia limpia del repo Valiance (sin historial), git nuevo.
- **Stack sin cambios:** Vite/React/TS/shadcn, Express, Postgres (Supabase), Evolution API, Resend.
- **Despliegue:** primero **local** funcionando en la Mac; Railway/Supabase en producción es paso posterior
  con las cuentas del cliente.

## 11. Fases de trabajo

1. **Setup:** copiar repo a la carpeta nueva (sin `.git`), git limpio, `npm i`, levantar local con DB.
2. **Rebrand visual:** paleta, fuentes, logo, landing, copys, correos, meta/manifest, favicons.
3. **Datos reales:** seed con clases/horarios/temas/paquetes/precios VM; contacto y reglamento.
4. **Reglas de negocio:** cancelación 12 h / reagenda 3 h; vigencia fin de mes.
5. **Recordatorios:** activar cron WhatsApp/correo.
6. **Limpieza:** quitar módulos fuera de alcance (lealtad, videos, wallet, QR, barre/combo).
7. **Verificación:** correr y probar flujos end-to-end (reservar, cancelar, reagendar, pagar, recordatorios).

## 12. Datos / assets pendientes del cliente (no bloquean empezar)

1. Datos bancarios para transferencias (CLABE, banco, titular).
2. Logo limpio en SVG/PNG transparente.
3. Fotos del studio (se usan las del Instagram/PDF como placeholder).

## 13. Fuera de alcance (explícito)

Lealtad/puntos · videos on-demand · Apple/Google Wallet · QR check-in · reservas de eventos de cumpleaños ·
disciplinas separadas (Barre/Combo) · pagos con tarjeta/online · app nativa (queda como PWA responsive).
