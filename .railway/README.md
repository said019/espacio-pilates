# Espacio: configuración parcial del frontend

Este partial declara sólo `service.frontend` en el proyecto `2a511edb-99c9-47ec-bc7d-7bfea61fadb6`, entorno `10871e83-5c64-4f94-8601-66e527b6c8aa`. Debe vincularse únicamente al servicio existente `e36c414c-21b9-4f86-8548-5a741b523dac`. La API `web` (`d92cc314-bbfc-49b2-b92d-653b687e0958`) no aparece en el grafo. La raíz compartida y sus defaults siguen intactos.

Se conserva el Dockerfile nginx ya publicado, contexto `/`, CMD/launcher, región, dominio Railway y dominio propio con puerto 8080. Los tres nombres existentes de variables usan `preserve()`; no hay valores ni credenciales en este directorio. Las dos políticas de reinicio se trasladan del JSON seleccionado para que no desaparezcan al retirar Config as Code. El SDK queda fijado a `railway@3.12.0` fuera de las dependencias de aplicación.

## Validación local y CI

Con Node 24.18.1, desde la raíz del repositorio:

```sh
npm ci --prefix .railway --ignore-scripts --no-audit --no-fund
npm test --prefix .railway
node .railway/render.mjs
```

Sólo evalúan el SDK y fixtures sin valores. No arrancan la aplicación, consultan Railway, conectan DB ni aplican configuración. Los contratos contrastan el **grafo serializado** contra un `config pull --json` sin `--include-variables`, conservando únicamente la fila frontend. Comprueban dominios/puertos, variables preservadas, guards de proyecto/entorno y hashes de los defaults de API y Dockerfile. El workflow mantiene aparte sus contratos existentes de artefactos y serving sobre la misma imagen nginx.

## Adopción pendiente, sólo del frontend

La comprobación del 4 de octubre de 2026 usó primero la CLI global 5.45.7: no resolvió el selector absoluto del JSON. Con **CLI 5.63.1 fijada**, el mismo dry-run `config migrate --service frontend` sí encontró `deploy/static-nginx/railway.json → frontend` y terminó correctamente. No se aplicó nada. La adopción sigue pendiente de retirar sólo el binding legacy y revisar/aplicar el partial completo; el dry-run no es un despliegue ni un plan convergente.

La salida automática de migrate contiene únicamente el launcher y deja builder/dockerfilePath como comentarios. No sustituir este partial por ese archivo mínimo: perdería la declaración explícita del build, dominios, variables y políticas. Conservar el commit revisado y comparar cualquier archivo generado antes de un apply.

1. Obtener una descripción fresca del frontend por los IDs anteriores, sin valores de variables. Guardar la respuesta junto con su `projectId` fuera del repo y comprobarla con `node deploy/static-nginx/check-iac-target.mjs /ruta/fresh-describe-service.json`. Es una verificación local de identidad previa a la adopción; no garantiza que el estado siga igual más tarde ni reemplaza el plan del proveedor. Detenerse ante variables nuevas, cambios pendientes, otro servicio/entorno o drift de configuración.
2. El servicio actual aún selecciona `/deploy/static-nginx/railway.json`. Railway no permite gestionar simultáneamente ese servicio con JSON e IaC: un plan puede bloquearse hasta migrarlo. Revisar **primero** el dry-run soportado `npx --yes --package @railway/cli@5.63.1 railway config migrate --service frontend` desde un directorio vinculado al proyecto/entorno/frontend exactos. No ejecutar `--apply`, `--force` o `--delete-files` a ciegas: el repo contiene también el JSON compartido de API, que debe permanecer intacto. El dry-run y cualquier archivo generado se revisan antes de retirar sólo la selección legacy del frontend; no usar el setter obsoleto `railwayConfigFile`.
3. Revisar el plan del partial con `npx --yes --package @railway/cli@5.63.1 railway config plan --file .railway/railway.ts --json`. El binding de `service.frontend` debe resolver al UUID exacto anterior, sin creación/borrado de recursos ni cambios en `web` o PostgreSQL. El guard TypeScript comprueba proyecto y entorno; **el nombre por sí solo no fija el UUID remoto**, por lo que revisar ese binding es obligatorio. Los únicos cambios esperados son la propiedad IaC/retirada del configFile legacy, root `/` explícito y materializar las dos políticas de reinicio ya efectivas; el resto debe conservarse. `preserve()` no crea valores para un servicio nuevo.
4. Aplicar sólo un plan revisado que cumpla esos límites, mediante coordinación de despliegue. Este PR y su CI no lo aplican. Verificar después la configuración persistida, un plan convergente, el SHA/artefactos/nginx y salud pública; confirmar que la API conserva su deployment. Antes del merge, excluir `.railway/**` de los watches de API sin excluir rutas de negocio.

El servicio existente puede seguir desplegando desde Git main con la selección nginx actual mientras se revisa la adopción. Para un nuevo frontend, usar el procedimiento de [selección explícita Docker por rol](../deploy/static-nginx/README.md), con sus propias variables públicas/API. Este partial rechaza deliberadamente otros proyectos; no es una plantilla que cree una API, DB o secretos.

Referencias: [Railway IaC](https://docs.railway.com/infrastructure-as-code), [Dockerfiles](https://docs.railway.com/builds/dockerfiles), [retirada de Config as Code](https://docs.railway.com/config-as-code).
