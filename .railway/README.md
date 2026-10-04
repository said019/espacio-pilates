# Espacio: configuración parcial del frontend

Este partial declara sólo `service.frontend` en el proyecto `2a511edb-99c9-47ec-bc7d-7bfea61fadb6`, entorno `10871e83-5c64-4f94-8601-66e527b6c8aa`. Debe vincularse únicamente al servicio existente `e36c414c-21b9-4f86-8548-5a741b523dac`. La API `web` (`d92cc314-bbfc-49b2-b92d-653b687e0958`) no aparece en el grafo. La raíz compartida y sus defaults siguen intactos.

Se conserva el contexto `/`, CMD/launcher nginx, región, dominio Railway y dominio propio con puerto 8080. La imagen añade un alias local compatible con `sh start.sh`, descrito en el [README del runtime](../deploy/static-nginx/README.md). Los tres nombres existentes de variables usan `preserve()`; no hay valores ni credenciales en este directorio. El partial requiere salud HTTP `/` y mantiene tres reintentos. `restartPolicyType` se omite porque el proveedor no lo conserva al leer tras apply: la política efectiva sigue siendo el [default oficial On Failure](https://docs.railway.com/deployments/restart-policy), también fijado por el JSON raíz. No se omite ningún otro campo para ocultar drift. El SDK queda fijado a `railway@3.12.0` fuera de las dependencias de aplicación.

## Validación local y CI

Con Node 24.18.1, desde la raíz del repositorio:

```sh
npm ci --prefix .railway --ignore-scripts --no-audit --no-fund
npm test --prefix .railway
node .railway/render.mjs
```

Sólo evalúan el SDK y fixtures sin valores. No arrancan la aplicación, consultan Railway, conectan DB ni aplican configuración. Los contratos contrastan el **grafo serializado** contra el `config pull --json` histórico sin `--include-variables`, conservando únicamente la fila frontend, con el cambio explícito de healthcheck y la omisión del default de reinicio. Comprueban dominios/puertos, variables preservadas, guards de proyecto/entorno y hashes de los defaults de API e inputs intactos. El Dockerfile cambia sólo el arranque de la imagen final; el workflow prueba el árbol de artefactos y ambos comandos reales de serving. Los fixtures no representan el estado cloud posterior al incidente.

## Adopción pendiente, sólo del frontend

La comprobación del 4 de octubre de 2026 usó primero la CLI global 5.45.7: no resolvió el selector absoluto del JSON. Con **CLI 5.63.1 fijada**, el dry-run `config migrate --service frontend` sí encontró `deploy/static-nginx/railway.json → frontend`. La posterior migración/apply coordinada informó SUCCESS, pero el frontend devolvió 502: el selector vacío permitió autodescubrir el JSON compartido, cuyo `sh start.sh` no existía en la imagen nginx. Se recuperó el servicio mediante rollback oficial al nginx previo, sin modificar la API. La adopción continúa incompleta hasta publicar la corrección compatible, verificar HTTP y obtener un plan sin cambios. No repetir la migración ni asumir que `configFile: ""` desactiva autodetección.

La salida automática de migrate contiene únicamente el launcher y deja builder/dockerfilePath como comentarios. No sustituir este partial por ese archivo mínimo: perdería la declaración explícita del build, dominios, variables y políticas. Conservar el commit revisado y comparar cualquier archivo generado antes de un apply.

1. Obtener una descripción fresca del frontend por los IDs anteriores, sin valores de variables; guardar la respuesta junto con su `projectId` fuera del repo. Revisar identidad, configuración, dominios y ausencia de cambios pendientes. `check-iac-target.mjs` conserva deliberadamente el guard del estado legacy previo: debe rechazar el estado migrado, y no se deben modificar sus fixtures para simular que acepta el estado actual. La nueva revisión usa evidencia fresca y el plan del proveedor.
2. Conservar el rollback nginx recuperado mientras se revisa la corrección. No volver a migrar, borrar el JSON raíz compartido con API ni usar el setter obsoleto `railwayConfigFile`. No se ha encontrado un sentinel soportado que desactive la autodetección legacy; este parche hace compatible el comando realmente observado dentro de la imagen frontend.
3. Revisar el plan con `npx --yes --package @railway/cli@5.63.1 railway config plan --file .railway/railway.ts --json`. `service.frontend` debe resolver al UUID exacto anterior, sin creación/borrado de recursos ni cambios en `web` o PostgreSQL. El guard TypeScript comprueba proyecto y entorno; **el nombre por sí solo no fija el UUID remoto**. El delta intencional es healthcheck `/`; `restartPolicyType` queda ausente y su política efectiva continúa ON_FAILURE, con `restartPolicyMaxRetries: 3`. No editar ni normalizar manualmente el plan, ni ocultar otros drifts. `preserve()` no crea valores para un servicio nuevo.
4. Aplicar sólo el plan revisado, con publicación coordinada de la imagen compatible. Este PR y su CI no lo aplican. Verificar configuración efectiva, plan con cero cambios, SHA/artefactos/nginx PID 1 y salud pública en ambos dominios, además del healthcheck `/`; confirmar que la API conserva su deployment. `.railway/**` y los archivos del frontend deben quedar excluidos del watch de API sin excluir rutas de negocio.

La recuperación actual es un rollback oficial, no prueba de adopción durable. Para un nuevo frontend, usar el procedimiento de [selección explícita Docker por rol](../deploy/static-nginx/README.md), con sus propias variables públicas/API. Este partial rechaza deliberadamente otros proyectos; no es una plantilla que cree una API, DB o secretos.

Referencias: [Railway IaC](https://docs.railway.com/infrastructure-as-code), [Dockerfiles](https://docs.railway.com/builds/dockerfiles), [retirada de Config as Code](https://docs.railway.com/config-as-code).
