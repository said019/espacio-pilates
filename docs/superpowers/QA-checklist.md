# QA — Verificación end-to-end · Tu Espacio Pilates VM (2026-06-26)

## Flujo de reservas (e2e contra API local, 9/9 ✅)
- ✅ Registro de cliente (con teléfono, como exige el formulario)
- ✅ Login admin (espaciopilatesvm@gmail.com)
- ✅ Admin asigna membresía → créditos = 7, vigencia = fin del mes de compra
- ✅ Calendario con clases reservables (cupo 8)
- ✅ Reservar → confirmada, crédito 7→6
- ✅ Cancelar ≥12h → crédito devuelto (6→7)
- ✅ Reagendar → mueve la reserva a otra clase SIN cambiar el crédito (sigue 6)
- ✅ Reagendar a la misma clase → rechazado ("Selecciona una clase distinta")
- Bloqueo cancelación <12h / reagenda <3h: cubierto por tests unitarios (bookingPolicy: canCancel/canReschedule).

## Datos / seed (DB fresca)
- 6 planes de catálogo VM: 7=$880, 9=$1,050, 14=$1,400, Clase Extra $130, Suelta/Visita $250, Inscripción $500
- 1 tipo de clase activo: "Pilates" (cupo 8)
- 28 schedule_slots = horario VM; 92 clases generadas (próximas 4 semanas, cupo 8)
- 1 coach (instructor con usuario), admin VM
- Lealtad: enabled=false (sin acumulación) · TotalPass: inactivo

## Build / tests / marca
- npm run build → exit 0
- npm test → 10/10 (incluye bookingPolicy: endOfPurchaseMonth, canCancel, canReschedule)
- Boot banner: "🚀 Tu Espacio Pilates VM" — sin warnings
- 0 strings "Valiance/Punto" user-facing (refs internas restantes: @puntoneutro.local sentinel, JWT_SECRET default, Google Wallet id — no visibles al usuario)

## Pendientes del cliente (no bloquean v1)
- Datos bancarios (CLABE/banco/titular) → Ajustes → Banco
- Logo limpio SVG/PNG (se usa el extraído del PDF)
- Fotos reales del studio (placeholders genéricos por ahora)
- Cuentas de producción: Supabase/Railway, Evolution API (WhatsApp), Resend (correo)
