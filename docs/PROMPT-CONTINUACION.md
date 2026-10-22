# PROMPT DE CONTINUACIÓN — Bot E2E Compras (rpa-bot)

> Copiar este bloque completo como primer mensaje a una IA con 0 contexto. Está diseñado para que entienda el proyecto leyendo los docs y aplique 5 fixes concretos.
> Autor del handoff: asistente SDET. Estado: diagnóstico completado, fixes aprobados, **pendiente aplicar**.

---

## 0. TU ROL Y OBJETIVO

Eres un Ingeniero SDET senior. El proyecto es un **bot E2E** que automatiza y **audita la matemática de un ERP logístico** (Kardex, stock, costo promedio ponderado, impuestos, variación). Tu trabajo:

1. **Leer los documentos** de `docs/` (empieza por `docs/INDICE.md`) para entender el proyecto.
2. **Aplicar 5 fixes** a un bot que está a medio integrar (ver sección 4).
3. **Verificar** con `npm run test:suite` y el PDF generado.
4. No inventar flujos nuevos ni reescribir el bot: **solo los 5 fixes**.

---

## 1. PROYECTO — QUÉ ES Y DÓNDE ESTÁ

| Elemento | Valor |
|---|---|
| Directorio del bot | `C:\Practicas\RESTAURANT_PROYECT\rpa-bot` |
| Backend PHP (leer, NO editar salvo fix) | `C:\xampp\htdocs\webapp\logistica\` (Slim 3, Fat Model) |
| Frontend AngularJS 1.x (solo lectura) | `C:\Practicas\RESTAURANT_PROYECT\logisticaview\` |
| Base de datos | MySQL `logisticaaa`, host `localhost:3306`, user `root`, **sin password** |
| CLI MySQL | `C:\xampp\mysql\bin\mysql.exe -u root logisticaaa` |
| App bajo prueba | `http://localhost:9002` (AngularJS), API REST `…/restaurant/logistica/rest/` |
| Navegador | Chrome **ya abierto** con `--remote-debugging-port=9222`; el bot se adosa por CDP (`connectOverCDP`), **no lanza navegador** |
| Runtime | Node.js + TypeScript (`ts-node`), Playwright, mysql2, exceljs |

**Comandos clave** (desde `C:\Practicas\RESTAURANT_PROYECT\rpa-bot`):

    npm run test:suite     # suite unificada: seed + Bloques 1-8 + Flujos Compras F1-F13 + PDF
    npm run test:compras   # solo el módulo de Compras (F1-F13)
    npx tsc --noEmit       # typecheck (debe salir limpio)

**Regla de oro de operación**: XAMPP corriendo (Apache :80 + MySQL :3306), Chrome con CDP y sesión iniciada en la app (usuario admin con todos los permisos). Sin sesión, el bot timeoutea.

---

## 2. DOCUMENTACIÓN — LÉELA PRIMERO (en este orden)

1. **`docs/INDICE.md`** — mapa de los 42 documentos. Léelo completo.
2. **`docs/arquitectura/ai-context.md`** — stack, inyección AngularJS, ciclo digest, errores duros ya resueltos.
3. **`docs/negocio/manual-configuraciones.md`** — las 27 configs que afectan al bot y el plan de toggles.
4. **`docs/negocio/mapeo-entidades-maestras.md`** — modelo de dominio (Insumo/Porcionable/Consumible/Producto/Receta).
5. **`docs/negocio/compras/orden-de-compra.md`** — la matemática principal (precio=importe, sinImp=NULL, ACL).
6. **`docs/negocio/compras/kardex-reporte-columnas.md`** — las 14 columnas del Kardex y la merma.
7. **`docs/negocio/compras/flujos-e2e.md`** — semilla maestra + los 26 flujos replicables.
8. **`docs/negocio/compras/bugs-orden-compra.md`**, **`bugs-guia-compra.md`**, **`bugs-compras-flujos.md`** — bugs documentados: **no los explotes**.

---

## 3. ESTADO ACTUAL DEL CÓDIGO (lo que ya existe)

    src/e2e/compras/
      tipos.ts        — contratos (ContextoCompra, LineaDetalle, Veredicto, TotalesCompra)
      seed.ts         — limpieza transaccional + lectura de maestros/configs/IGV/TC
      helpers.ts      — inyección a scope (solicitud, OC), totales, PPP
      oraculo.ts      — verificaciones (stock, totales, Kardex)
      flujos.ts       — F1-F5 completos + F6-F13 stubs
      suite.ts        — runner de Compras (npm run test:compras)
      analisis/       — módulos de análisis matemático (kardex, impuestos, nc, cxp, distribucion, merma, moneda)
    data/seed_compras.sql — seed idempotente (locales, maestros, configs)
    src/e2e/suite.ts — orquestador unificado: limpieza -> seed -> F1-F13 -> Bloques 1-8 -> PDF

**Convenciones obligatorias (SOLID, ya establecidas):**

- Servicios AngularJS por nombre exacto: `CompraResource`, `OrdencompraResource`, `GuiaResource` (NO `Compra`).
- Métodos: `agregar`, `actualizarCompra`, `anularCompra`, `agregarNotaCredito`.
- Inyección de datos vía `page.evaluate` + scope-walk; **nunca** `page.fill` en grids virtuales.
- Fechas: `YYYY-MM-DD HH:mm:ss` para compras; `YYYY-MM-DD` para entregas.
- Comprobantes únicos por corrida: `serie/numero + '-' + Date.now()` (evita colisión `existeCompra`).
- Reporte: filas `{fase, paso, ok, esperado, real, error}` -> PDF/HTML en `data/`.

---

## 4. LOS 5 FIXES (aplicar exactamente estos)

### FIX 1 — Mojibake del local (CRÍTICO, bloqueador principal)

**Archivo:** `src/bot.ts`, función `registrarCompra` (bloque `if (cab.local)`, ~línea 458-481).

**Problema:** el backend devuelve `"CD LogÃstico"` (UTF-8 leído como Latin-1). La normalización actual solo quita tildes (`logastico` != `logistico`), así que no encuentra el local y **todas las compras del Bloque 1 fallan**.

**Fix:**

    const fixMojibake = (s: any) => {
      const str = String(s || '');
      if (str.includes('Ã')) {
        try { return Buffer.from(str, 'latin1').toString('utf8'); } catch { return str; }
      }
      return str;
    };
    const norm = (s: any) =>
      fixMojibake(s).normalize('NFD').replace(/[^\x00-\x7F]/g, '').toLowerCase();
    const local = locales.find(
      (l: any) => norm(l.local_descripcion || l.local_nombre) === norm(cab.local),
    );
    // Fallback robusto: si no encuentra por nombre, usar el local de la sesión
    if (!local && locales.length) {
      const sessionLocalId = SecurityService.getLocalId();
      const fallback = locales.find((l: any) => l.local_id === sessionLocalId) || locales[0];
      localId = fallback.local_id;
      vm.fnCambioLocal(fallback);
    } else if (!local) {
      return { ok: false, error: 'Local no encontrado: ' + cab.local };
    } else {
      localId = local.local_id;
      vm.fnCambioLocal(local);
    }

**Verificación:** tras el fix, el Bloque 1 debe poder registrar compras por canje de OC y directas.

### FIX 2 — Contaminación / maestros duplicados

**Archivo:** `data/seed_compras.sql` (sección de maestros) y `src/e2e/suite.ts` (orden de ejecución).

**Problema:** el seed crea `Carne QA` (id 1001) y el Bloque 1 intenta crearlo de nuevo -> `"El nombre del insumo ya existe"`, y el stock arranca contaminado (130 en vez de 0).

**Fix:**

1. **Quitar `Carne QA` del seed** (dejar que el Bloque 1 lo cree). Mantener en el seed los maestros NUEVOS que los bloques no crean: `Verdura QA`, `Pollo QA`, `Arroz QA`, `Caja Empaque QA`, `Gaseosa QA`, `Gaseosa Sin Control QA`.
2. **Reordenar `suite.ts`:** Bloques 1-8 **primero** (crean `Carne QA`, `Insumo Exonerado QA`, `Caja de Empaque QA`), **luego** los Flujos F1-F13 (que reusan `Carne QA`).
3. Ajustar los `esperado` de F1-F5 para reflejar el estado que dejan los Bloques 1-8 (ver FIX 3).

### FIX 3 — F4 sinImp: expected incorrecto

**Archivo:** `src/e2e/compras/flujos.ts`, flujo F4.

**Problema:** el sistema da `sinImp = 20.600` y **es correcto**; el expected `20.2086` estaba mal (usó el sin-IGV de F1 en vez del PPP sin-IGV acumulado).

**Cálculo correcto:**

- Tras F1 (50@20) + F2 guía (30@22): `sinPPP = (50x16.949 + 30x18.644)/80 = 17.585`
- Tras F4 (50@30): `sinPPP = (80x17.585 + 50x25.424)/130 = 20.600`

**Fix:** cambiar el `esperado` de sinImp de `20.2086` a `20.600` (y el costo con impuestos a `24.308`).

### FIX 4 — NC / anular LIFO / anular OC

**Problema:** posiblemente efecto de la BD sucia (los IDs de compra no coinciden). El bloqueo de OC anulada **sí existe** en el validator (`OrdencompraLogisticaValidator.php:119`), así que si tras el reordenamiento sigue pasando, es bug real.

**Fix:** aplicar FIX 2 (reordenar + limpieza). Si tras ello el Bloque 1 sigue fallando en NC/anular, investigar el payload de NC y el ID de compra (los IDs deben venir del `estado` del Bloque 1, no hardcodeados).

### FIX 5 — Consumible -50

**Problema:** consecuencia directa del punto 1 (la compra de `Caja Empaque QA` nunca se procesó por el error de local, y la salida de 50 dejó stock en -50).

**Fix:** se resuelve automáticamente con FIX 1. Verificar que tras el fix el consumible compra 200 y la salida deja 150.

---

## 5. PROTOCOLO DE VERIFICACIÓN

1. `npx tsc --noEmit` -> debe salir limpio.
2. `npm run test:suite` -> revisar consola y `data/Reporte_Suite.pdf`.
3. Criterios de éxito:
   - Bloque 1: solicitud -> OC -> compra -> NC -> anular -> OC anulada bloqueada.
   - Bloque 2: consumible compra 200, salida 50, stock 150.
   - Flujos F1-F5: totales y Kardex cuadran (afecto y exonerado).
   - Sin errores de `Local no encontrado`.
4. Si algo falla, no cambiar el enfoque: revisar el doc del submódulo correspondiente y el `bugs-*.md`.

---

## 6. REGLAS DURAS (no violar)

- **No explotar bugs documentados** (`bugs-*.md`): el bot audita matemática, no vulnerabilidades.
- **No usar `page.fill` en grids** (HandsOnTable): inyectar al `$scope`.
- **No hardcodear IDs** de compra/OC/guía: tomarlos del `estado` de la corrida.
- **No asumir configuración**: leer configs/IGV/TC en vivo (como ya hace `seed.ts`).
- **No reescribir el bot**: solo los 5 fixes.
- **Asertar por substring/flag**, nunca por igualdad exacta de literales (tienen typos conocidos).
