# Prenatal en Wallet + fecha de Inscripción en detalle de clienta — Diseño

## Resumen

Dos ajustes chicos, independientes entre sí, confirmados con la dueña:

1. El plan "Prenatal" (nuevo, `class_category = 'prenatal'`) no tiene tratamiento propio en los pases de Wallet — cae en el genérico "Mixto"/"General".
2. El detalle de una clienta en el admin no muestra en qué pago se le cobró la Inscripción.

## 1. Wallet — categoría Prenatal

**Hallazgo:** dos lugares en `server/index.js` calculan `membershipCategoryLabel` con el mismo ternario de 4 ramas (pilates/bienestar/funcional/mixto), sin rama para "prenatal" — cae al `else` final, `"General"`:
- `server/index.js:6119` (dentro de `buildGoogleWalletSaveUrl`, usado en el campo "Modalidad" del pase Google).
- `server/index.js:7286` (dentro del builder de Apple Wallet, usado en headline/nombre de pase/descripción — más superficies que en Google).

`normalizeClassCategory` (`server/lib/classAccess.js`) ya reconoce `"prenatal"` como categoría válida y la deja pasar tal cual — el problema es solo el ternario de la etiqueta, no la normalización.

**Ícono:** solo Apple Wallet usa un ícono por categoría (`wallet-icon-{categoria}.png`, `server/index.js:7646-7653`); Google no — su logo es fijo a nivel de "clase" de loyalty, no por membresía. Hoy Prenatal cae en `wallet-icon-mixto.png` por no existir un asset propio.

**Decisión (confirmada con la dueña):** no hay ícono de Prenatal listo todavía — se usa temporalmente una copia de `wallet-icon-bienestar.png`/`@2x`/`@3x` como `wallet-icon-prenatal.png`/`@2x`/`@3x`. Cuando haya arte propio, basta con reemplazar esos 3 archivos — cero cambio de código adicional.

**Cambios:**
- Copiar los 3 archivos de asset.
- Agregar rama `membershipCategory === "prenatal" ? "Prenatal" : ...` a los dos ternarios de label (Google y Apple).
- Agregar rama `membershipCategory === "prenatal" ? "prenatal" : ...` al ternario de `assetCategory` en Apple (línea ~7649).

**Fuera de alcance:** no se toca la discrepancia preexistente donde `membershipCategory === "pilates"` nunca es cierta en este ternario (porque `normalizeClassCategory` convierte `"pilates"` → `"reformer"` antes) — es un comportamiento anterior, no relacionado a Prenatal, y tocarlo es riesgo innecesario fuera de este pedido.

## 2. Fecha de pago de Inscripción en detalle de clienta

**Hallazgo:** el dato ya existe completo del lado del servidor — `GET /api/payments?userId=X` (`server/index.js:13692`) ya devuelve `plan_name` e `inscription_amount` por cada pago. El hueco es 100% de frontend: la tabla "Historial de pagos" en `src/pages/admin/clients/ClientDetail.tsx` (pestaña "Pagos", ~línea 769-812) solo muestra Origen/Monto/Estado/Fecha — sin el plan.

**Matiz importante:** la Inscripción casi nunca es su propia fila — lo normal es que se sume automáticamente al comprar un paquete (regla ya documentada: "Inscripción automática"), así que el pago relevante suele ser el de un PAQUETE con `inscription_amount > 0`, no una fila que diga literalmente "Inscripción". Por eso la columna nueva debe mostrar ambas cosas: el nombre del plan, Y una nota cuando ese mismo pago incluyó inscripción.

**Cambio:** agregar columna "Plan" a la tabla (usa `p.plan_name`, ya viene en la respuesta). Si `p.inscription_amount > 0`, mostrar una nota pequeña debajo del nombre del plan: "+ Inscripción $500". Así la fecha de cualquiera de los dos casos (comprada sola o incluida) es visible con solo mirar la fila.

**Fuera de alcance:** no se agrega un filtro dedicado "solo pagos de inscripción" ni un campo separado "fecha de inscripción" en el perfil — mostrarlo en la tabla existente es suficiente para lo pedido.

## Testing

Ninguno de los dos cambios tiene lógica pura nueva que amerite test unitario (son ternarios de texto/UI de 1-2 líneas cada uno, mismo criterio ya aplicado a cambios de UI similares en este proyecto). Verificación manual: ver un pase Wallet real de una alumna con plan Prenatal, y ver el detalle de una clienta con inscripción ya pagada.
