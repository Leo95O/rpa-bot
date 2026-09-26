# logisticaview-rpa-bot — Suite E2E Masiva (35 casos, 90/90 en verde)

Bot RPA atendido con **Playwright** (`chromium.connectOverCDP`, sin lanzar navegador) que valida
de extremo a extremo el ERP logístico: **AngularJS 1.x** (`logisticaview`) + **PHP Slim Fat-Model**
(`webapp/logistica`) + **MySQL `logisticaaa`**. No valida la GUI: valida la **matemática del backend**
(PPP, Kardex por almacén, LIFO, canjes, bloqueos) con estado acumulativo entre módulos.

```powershell
npm install
npx tsc -p tsconfig.json --noEmit   # compilación sana
```

**0. Preparar Chrome con CDP (obligatorio antes de cada corrida):**

```powershell
taskkill /F /IM chrome.exe /T & "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-temp" --remote-allow-origins="*"
```

Luego abrir `http://localhost:9002/#!/escritorio` e **iniciar sesión** (`admin / seven26$`).
El bot se adosa a ese Chrome (`connectOverCDP`); sin pestaña logueada, todo timeoutea.

```powershell
npm run test:suite                   # 35 casos, ~5 min en verde
$env:DEBUG='1'; npm run test:suite   # modo diagnóstico ([DIAG] payloads + JSON PHP)
```

## Wiki de documentación (`docs/`)

### Arquitectura (`docs/arquitectura/`) — el núcleo técnico del bot

| Documento | Qué contiene |
|---|---|
| [manual-bot-rpa.md](docs/arquitectura/manual-bot-rpa.md) | **Manual definitivo**: visión, bloques, payloads + workarounds, oráculo/PPP, deep dives MRP y Canjes, diagnósticos, operación (§7: ejecución, nuevos bloques, mantenimiento BD, reportes) |
| [ai-context.md](docs/arquitectura/ai-context.md) | Reglas de inyección AngularJS: `$scope`/scope-walk, UI-Router, `$digest`, HandsOnTable, modales, `FOREIGN_KEY_CHECKS=0` |
| [blueprint-automatizacion.md](docs/arquitectura/blueprint-automatizacion.md) | Mapa topográfico: selectores CSS, rutas `$scope`, endpoints `waitForResponse`, spinners, validaciones frontend |
| [blueprint-porcionar-insumos.md](docs/arquitectura/blueprint-porcionar-insumos.md) | Fórmulas de prorrateo/merma + recetas transversales `$digest`/`ui-select` |
| [mapeo-estructural-logistica.md](docs/arquitectura/mapeo-estructural-logistica.md) | Mapa de carpetas del backend PHP |

### QA (`docs/qa/`) — casos y oráculo

| Documento | Qué contiene |
|---|---|
| [matriz-e2e-masiva.md](docs/qa/matriz-e2e-masiva.md) | **Los 35 casos definitivos** con valores esperados (fuente de verdad de la suite) |
| [matriz-porcionar-insumos.md](docs/qa/matriz-porcionar-insumos.md) | Matriz del módulo desposte (fuera del alcance actual) |
| [reporte-arquitectura-kardex.md](docs/qa/reporte-arquitectura-kardex.md) | Fórmulas del Kardex y reglas SQL del oráculo (incl. tabla espejo de consumibles) |

### Operación (`docs/operacion/`) y Negocio (`docs/negocio/`)

| Documento | Qué contiene |
|---|---|
| [operacion/formato-excel.md](docs/operacion/formato-excel.md) | Formato de reportes Excel |
| [negocio/manual-maestro-logistica.md](docs/negocio/manual-maestro-logistica.md) | Lógica de negocio del ERP (contexto funcional, no técnico del bot) |

## Estructura del código (`src/`)

| Ruta | Contenido |
|---|---|
| `src/e2e/suite.ts` | Orquestador: 1 limpieza + 1 navegador + estado/reporte compartidos (`npm run test:suite`) |
| `src/e2e/*.spec.ts` | Bloques 1-6 (`runBloqueN` reutilizable + `main()` standalone tras `require.main`) |
| `src/e2e/harness.ts` | `ContextoSuite`, `logFila`, `diag()`/`DEBUG`, `abrirStandalone` (+ fail-fast) |
| `src/e2e/fixtures.ts` | Datos QA, `EstadoSuite`, `ppp()` |
| `src/e2e/oracle.ts` | `assertStockInsumo[EnAlmacen]`, oráculo de consumibles (tabla espejo) |
| `src/{bot,compras,guias,kardex,db,reporte}.ts` | Helpers Playwright, operaciones y reportes HTML/PDF |
| `src/legacy/` | Suite vieja de 33 casos — **carpeta muerta, no usar** |
| `data/` | `limpieza_bd.sql` (77 statements), reportes `Reporte_Suite.*` / `Reporte_BloqueN.*` |

## Cross-linking (cómo mantener la wiki navegable)

1. **Enlaces relativos, nunca absolutos**: desde `docs/arquitectura/X.md` → `[texto](../qa/archivo.md)` (subir un nivel) o `[texto](archivo.md)` (misma carpeta). Desde la raíz → `docs/qa/archivo.md`.
2. **Anclas a secciones**: `[PPP](manual-bot-rpa.md#43-ppp-esperado-vs-real)` — los slugs de GitHub convierten `## 4.3 PPP esperado vs real` en `#43-ppp-esperado-vs-real` (minúsculas, espacios→guiones, sin tildes... verificar render).
3. **Regla de actualización**: todo cambio de fórmula toca **matriz + spec + reporte-kardex** el mismo día; todo payload nuevo cita `archivo:línea` del fuente. Si un doc referencia a otro, el enlace va en ambas direcciones (ver pie del manual).
4. **Nombres**: kebab-case, sin espacios ni tildes — los espacios rompen enlaces en algunos visores.
