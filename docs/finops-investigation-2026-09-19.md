# Investigación FinOps — Tu Espacio Pilates

Observación: 19 de septiembre de 2026, hora de México; consultas hasta 20 de septiembre, 04:33 UTC. Solo diagnóstico: sin reinicios, cambios de configuración, reservas ni modificaciones de datos.

## Resultado

No se observa crecimiento sostenido de memoria durante los tres últimos bloques completos de 24 horas analizados. El promedio semanal y el último día se solapan y no prueban una tendencia creciente. La comparación inicial de 279 MB contra 244 MB semanales no era suficiente para concluir aceleración.

| Ventana UTC (inicio inclusivo, fin exclusivo) | RAM media API, MB decimales | Solicitudes HTTP |
|---|---:|---:|
| 17 sep 04:00 – 18 sep 04:00 | 304.23 | No consultadas |
| 18 sep 04:00 – 19 sep 04:00 | 293.55 | 3,864 |
| 19 sep 04:00 – 20 sep 04:00 | 278.91 | 1,239 |

Memoria: GraphQL Railway `metrics`, muestras horarias, 24 muestras por ventana. Solicitudes: herramienta HTTP de Railway, suma de buckets horarios completos del mismo intervalo; se excluyó el bucket parcial final. La diferencia entre viernes y sábado no permite extrapolar crecimiento o caída permanente del tráfico.

Inspección de proceso: un solo Node, PID 1, activo por aproximadamente 3 días y 8 horas. RSS 262,924 KiB; memoria anónima 242,364 KiB; sin swap. La mayor parte está en el proceso, no en caché de archivos. RSS no separa heap JavaScript de buffers o asignaciones nativas; no se tomó heap snapshot ni se activó inspector en producción.

## Hallazgos confirmados

### 1. Consulta de actualizaciones de Apple Wallet devuelve 401 indebidamente

`server/index.js`, ruta GET `/api/wallet/v1/devices/:deviceId/registrations/:passTypeId`, exige `ApplePass` antes de consultar los registros del dispositivo. Apple especifica que esta operación no tiene un token de pase apropiado: utiliza el identificador del dispositivo y sus registros.

Fuente: https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/PassKit_PG/Updating.html — sección donde el dispositivo pide seriales actualizados.

En una muestra acotada de 501 entradas HTTP del último intervalo hubo 36 respuestas 401 para esta ruta y 36 respuestas 200 para el registro de errores de Wallet. No son el total diario ni prueban una correspondencia uno a uno; sí corroboran el problema de protocolo observado en el código y los logs.

Corrección propuesta: ajustar únicamente la consulta de seriales al protocolo, conservar la restricción por dispositivo/pase registrado y mantener autenticación en registro, descarga y eliminación. Añadir pruebas antes de desplegar. Beneficio: actualizaciones funcionales y menos solicitudes fallidas. Ahorro monetario no medido.

### 2. Notificaciones consultan una columna inexistente

`server/index.js`, GET `/api/notifications`, selecciona `o.total`. Los logs de producción reportan `column o.total does not exist`. La pantalla `src/pages/client/Notifications.tsx` consulta cada 30 segundos mientras está activa.

Corrección propuesta: alinear la consulta con el esquema real de órdenes y probar estados de pago, sin cambiar cobros. Beneficio: recuperar la pantalla y eliminar consultas fallidas periódicas. No se atribuye a este defecto todo el uso de memoria.

## Riesgos posibles, no causas demostradas

- El proxy de subida a Drive acumula todos los fragmentos del cuerpo antes de `Buffer.concat`, sin un límite explícito de bytes en esa ruta, y utiliza `maxBodyLength: Infinity`. Puede generar picos si se recibe un fragmento grande; no hay evidencia de que explique la memoria de este periodo. Recomendación: límite de tamaño, streaming y timeout después de pruebas.
- Las sesiones de subida se eliminan al terminar o a las dos horas; no es correcto afirmar que ese mapa crece para siempre.
- El trabajo con imágenes de Wallet utiliza Sharp y buffers. No hay una medición del heap/nativo que demuestre retención indebida.

## Contexto de costos

Consulta de Railway durante esta investigación y el análisis inmediatamente anterior, ciclo 29 ago–29 sep 2026: proyecto aproximadamente US$3.37 acumulados (API US$1.57, frontend US$1.04, PostgreSQL US$0.76). Son costos de recursos acumulados, no tarifa ni factura mensual final. Workspace aproximadamente US$106.32; no atribuir el resto a Pilates.

No se estiman ahorros a partir de CPU baja o memoria RSS. Aplicando Cloud FinOps de OptimNow, se separan defectos confirmados, sospechas y ahorro realizado. Este proyecto está en una etapa de medición manual: primero corregir trabajo fallido y observar ventanas equivalentes; después decidir límites o cambios arquitectónicos. No apagar servicios de reservas ni recortar memoria basándose en una sola métrica.

## Correcciones autorizadas después del diagnóstico

Tras la autorización del usuario se corrigió el requisito de token exclusivamente en la consulta de actualizaciones de Wallet y se añadió Cache-Control: no-store. Registro, descarga y eliminación conservan autenticación. Notificaciones usa total_amount y reconoce el estado approved, sin modificar pagos.

Verificación local: 223 pruebas pasaron, 3 pruebas opcionales de integración se omitieron; compilación correcta. Las 6 pruebas nuevas ejecutan los handlers reales y verifican aislamiento por dispositivo/pase, actualizaciones incrementales, autenticación de las otras rutas y estados/importes de notificaciones. El handler corregido de notificaciones devolvió HTTP 200 contra el esquema real dentro de una transacción READ ONLY, sin escrituras ni envíos.

Pendiente después del despliegue: comparar errores, memoria y costos por servicio en ventanas equivalentes. No se afirma ahorro realizado con una medición inmediata.
