# Memoria de fechas del servidor

`server/lib/dateFormatting.js` reutiliza cinco formatos de fecha `es-MX` de zona implícita, un formato UTC y dos formatos explícitos de México. `bookingPolicy.js` conserva su formato explícito `en-US` de México. Los cinco slots de zona implícita se invalidan cuando cambia `process.env.TZ`; no crecen según datos de usuarios. Se conservan opciones, puntuación, fechas inválidas y calendario comercial.

El cambio reemplaza 43 llamadas de presentación de fecha/hora, un constructor en estadísticas y el constructor repetido de `mexicoCityDate`. No modifica SQL, migraciones, reglas de créditos/reservas, cron, integraciones, arranque, Sharp ni Wallet PNG.

## Reproducir sin producción

Usar Node **20.18.1**, la versión observada de producción el 2 de octubre de 2026. En un checkout limpio:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run build
TZ=UTC node scripts/benchmark-date-formatting.mjs baseline > /tmp/espacio-dates-baseline.json
TZ=UTC node scripts/benchmark-date-formatting.mjs candidate > /tmp/espacio-dates-candidate.json
```

Ejecutar cada variante en un proceso nuevo y de forma secuencial. El script importa sólo helpers de fechas, usa fechas sintéticas, calienta 300 operaciones y ejecuta tres tandas de 4,800 formatos con pausas iguales. No arranca servidor, bases, jobs o integraciones; no fuerza GC ni pone un límite de heap. Comparar `hashes`, `warmupHash`, tiempos y todos los snapshots de RSS, no sólo la última muestra.

En tres pares locales Node 20.18.1 / ICU 75.1 / macOS arm64, los hashes fueron iguales en cada par. Picos RSS originales: 214–221 MiB; candidatos: 51–52 MiB. RSS al final del reposo: originales 44–220 MiB, candidatos 39–45 MiB. La liberación del original varía con GC/asignador; en un par cayó hasta 44 MiB durante el reposo. Tiempo de 14,400 formatos: original 409–496 ms, candidato 29–37 ms. Son medidas del helper, no RAM de la API completa ni ahorro mensual garantizado.

Suite Node 20: 269 pruebas aprobadas, siete pruebas existentes omitidas; build aprobado. Se comprobaron cuatro zonas al arrancar y cambios de TZ dentro del mismo proceso, restaurando la zona original. Para acreditar ahorro facturado, comparar RAM/CPU en Railway con tráfico y jobs equivalentes después del despliegue, incluyendo calentamiento y reposo. Producción Linux/glibc puede retener cantidades distintas de macOS.

Rollback: revertir el commit de formatos y publicar con la misma configuración de arranque. Este cambio no necesita revertir datos, credenciales ni migraciones.
