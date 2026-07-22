# Prenatal en Wallet + fecha de Inscripción en detalle de clienta — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los pases de Wallet reconozcan la categoría "Prenatal" (label + ícono temporal), y que el detalle de una clienta en el admin muestre en qué pago se le cobró la Inscripción.

**Architecture:** Dos tareas independientes, sin dependencias entre sí. Task 1 son 3 ediciones puntuales en `server/index.js` (dos ternarios de texto + un ternario de asset) más 3 archivos de imagen copiados. Task 2 es una edición en `src/pages/admin/clients/ClientDetail.tsx` (agregar una columna a una tabla ya existente, usando datos que el backend ya devuelve).

**Tech Stack:** Node/Express (`server/index.js`), React/TypeScript (`ClientDetail.tsx`).

Diseño completo: `docs/superpowers/specs/2026-07-08-prenatal-wallet-y-fecha-inscripcion-design.md`.

---

### Task 1: Categoría "Prenatal" en Wallet (label + ícono temporal)

**Files:**
- Modify: `server/index.js:6119-6123` (label, Google), `server/index.js:7286-7290` (label, Apple), `server/index.js:7646-7653` (ícono, Apple)
- Create (copy): `public/wallet-icon-prenatal.png`, `public/wallet-icon-prenatal@2x.png`, `public/wallet-icon-prenatal@3x.png`

- [ ] **Step 1: Copiar el asset temporal**

```bash
cp public/wallet-icon-bienestar.png public/wallet-icon-prenatal.png
cp public/wallet-icon-bienestar@2x.png public/wallet-icon-prenatal@2x.png
cp public/wallet-icon-bienestar@3x.png public/wallet-icon-prenatal@3x.png
```

- [ ] **Step 2: Agregar rama "Prenatal" al label de Google Wallet**

Localiza este bloque (ya existente, alrededor de la línea 6119, dentro de `buildGoogleWalletSaveUrl`):

```js
  const membershipCategoryLabel =
    membershipCategory === "pilates" ? "Pilates" :
      membershipCategory === "bienestar" ? "Bienestar" :
        membershipCategory === "funcional" ? "Funcional" :
          membershipCategory === "mixto" ? "Mixto" : "General";
```

Reemplázalo por:

```js
  const membershipCategoryLabel =
    membershipCategory === "pilates" ? "Pilates" :
      membershipCategory === "bienestar" ? "Bienestar" :
        membershipCategory === "funcional" ? "Funcional" :
          membershipCategory === "mixto" ? "Mixto" :
            membershipCategory === "prenatal" ? "Prenatal" : "General";
```

- [ ] **Step 3: Agregar rama "Prenatal" al label de Apple Wallet**

Localiza este bloque (ya existente, alrededor de la línea 7286, en el builder de Apple Wallet — es un bloque casi idéntico al de Google pero en otra función):

```js
  const membershipCategoryLabel =
    membershipCategory === "pilates" ? "Pilates" :
      membershipCategory === "bienestar" ? "Bienestar" :
        membershipCategory === "funcional" ? "Funcional" :
          membershipCategory === "mixto" ? "Mixto" : "General";
```

Reemplázalo por (idéntico al Step 2 — hay DOS bloques iguales en el archivo, uno para Google y otro para Apple; edita ambos, no asumas que son el mismo):

```js
  const membershipCategoryLabel =
    membershipCategory === "pilates" ? "Pilates" :
      membershipCategory === "bienestar" ? "Bienestar" :
        membershipCategory === "funcional" ? "Funcional" :
          membershipCategory === "mixto" ? "Mixto" :
            membershipCategory === "prenatal" ? "Prenatal" : "General";
```

- [ ] **Step 4: Agregar rama "prenatal" al selector de ícono de Apple Wallet**

Localiza este bloque (ya existente, alrededor de la línea 7646-7653):

```js
  const assetCategory =
    hasEventPass
      ? "event"
      : membershipCategory === "pilates"
        ? "pilates"
        : membershipCategory === "bienestar"
          ? "bienestar"
          : "mixto";
```

Reemplázalo por:

```js
  const assetCategory =
    hasEventPass
      ? "event"
      : membershipCategory === "pilates"
        ? "pilates"
        : membershipCategory === "bienestar"
          ? "bienestar"
          : membershipCategory === "prenatal"
            ? "prenatal"
            : "mixto";
```

- [ ] **Step 5: Verificar sintaxis**

Run: `node --check server/index.js`
Expected: sin salida.

- [ ] **Step 6: Commit**

```bash
git add server/index.js public/wallet-icon-prenatal.png public/wallet-icon-prenatal@2x.png public/wallet-icon-prenatal@3x.png
git commit -m "feat(wallet): categoría Prenatal en label y (Apple) ícono del pase"
```

---

### Task 2: Columna "Plan" + nota de Inscripción en detalle de clienta

**Files:**
- Modify: `src/pages/admin/clients/ClientDetail.tsx:769-812`

- [ ] **Step 1: Agregar la columna al header de la tabla**

Localiza este bloque (ya existente, alrededor de la línea 776-782):

```tsx
                      <TableHeader>
                        <TableRow className="bg-tep-nude/60 hover:bg-tep-nude/60">
                          <TableHead className="text-valiance-mauve">Origen / método</TableHead>
                          <TableHead className="text-valiance-mauve text-right">Monto</TableHead>
                          <TableHead className="text-valiance-mauve">Estado</TableHead>
                          <TableHead className="text-valiance-mauve">Fecha</TableHead>
                        </TableRow>
                      </TableHeader>
```

Reemplázalo por:

```tsx
                      <TableHeader>
                        <TableRow className="bg-tep-nude/60 hover:bg-tep-nude/60">
                          <TableHead className="text-valiance-mauve">Origen / método</TableHead>
                          <TableHead className="text-valiance-mauve">Plan</TableHead>
                          <TableHead className="text-valiance-mauve text-right">Monto</TableHead>
                          <TableHead className="text-valiance-mauve">Estado</TableHead>
                          <TableHead className="text-valiance-mauve">Fecha</TableHead>
                        </TableRow>
                      </TableHeader>
```

- [ ] **Step 2: Agregar la celda con el plan y la nota de inscripción**

Localiza este bloque (ya existente, alrededor de la línea 785-805):

```tsx
                        {paymentsArr.map((p: any) => {
                          const origin = paymentOrigin(p);
                          const OriginIcon = origin.icon;
                          const st = paymentStatus(p.status);
                          const amount = parseFloat(pick(p, "total_amount", "totalAmount", "amount") ?? 0);
                          const date = pick(p, "created_at", "createdAt");
                          return (
                            <TableRow key={p.id}>
                              <TableCell>
                                <StatusPill className={origin.cls}>
                                  <OriginIcon size={12} />
                                  {origin.label}
                                </StatusPill>
                              </TableCell>
                              <TableCell className="text-right font-semibold text-valiance-charcoal">${amount.toFixed(2)}</TableCell>
                              <TableCell>
                                <Badge variant={st.variant}>{st.label}</Badge>
                              </TableCell>
                              <TableCell className="text-valiance-mauve">{fmtDateTime(date)}</TableCell>
                            </TableRow>
                          );
                        })}
```

Reemplázalo por:

```tsx
                        {paymentsArr.map((p: any) => {
                          const origin = paymentOrigin(p);
                          const OriginIcon = origin.icon;
                          const st = paymentStatus(p.status);
                          const amount = parseFloat(pick(p, "total_amount", "totalAmount", "amount") ?? 0);
                          const date = pick(p, "created_at", "createdAt");
                          const planName = pick(p, "plan_name", "planName") || "—";
                          const inscriptionAmount = parseFloat(pick(p, "inscription_amount", "inscriptionAmount") ?? 0);
                          return (
                            <TableRow key={p.id}>
                              <TableCell>
                                <StatusPill className={origin.cls}>
                                  <OriginIcon size={12} />
                                  {origin.label}
                                </StatusPill>
                              </TableCell>
                              <TableCell>
                                <p className="text-valiance-charcoal">{planName}</p>
                                {inscriptionAmount > 0 && (
                                  <p className="text-xs text-valiance-mauve">+ Inscripción ${inscriptionAmount.toFixed(2)}</p>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-semibold text-valiance-charcoal">${amount.toFixed(2)}</TableCell>
                              <TableCell>
                                <Badge variant={st.variant}>{st.label}</Badge>
                              </TableCell>
                              <TableCell className="text-valiance-mauve">{fmtDateTime(date)}</TableCell>
                            </TableRow>
                          );
                        })}
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos relacionados a `ClientDetail.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/clients/ClientDetail.tsx
git commit -m "feat(admin): mostrar plan y nota de inscripción en historial de pagos del cliente"
```

---

### Task 3: Verificación manual

**Files:** ninguno.

- [ ] **Step 1:** Asigna o sincroniza el pase Wallet de una clienta con membresía Prenatal (o crea una de prueba). Confirma que el pase muestra "Prenatal" en vez de "General", y que el ícono ya no es el de "mixto" (ahora es una copia del de bienestar, temporalmente).
- [ ] **Step 2:** Abre el detalle de una clienta que haya comprado un paquete (con inscripción automática incluida) y otra que haya comprado la Inscripción sola. Confirma que la pestaña "Pagos" muestra el plan correcto en cada fila, y la nota "+ Inscripción $..." donde aplique.
- [ ] **Step 3:** Corre la suite completa: `npm test` — debe seguir en verde (este plan no toca lógica pura, no debería romper nada).
