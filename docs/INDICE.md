# Índice de Documentación — rpa-bot (Docs)

> Mapa de los documentos de `docs/`. Qué es cada archivo, para qué sirve y cuándo consultarlo.
> El bot es E2E sobre ERP logístico (AngularJS `logisticaview` + PHP/MySQL `webapp`). Objetivo: **auditar cálculos matemáticos** (PPP, Kardex, impuestos) y el viaje de la data, no la UI.

---

## 1. `arquitectura/` — Stack, inyección AngularJS y blueprint de automatización

| Documento | Para qué sirve |
|---|---|
| `ai-context.md` | Manual IA-a-IA del stack: Playwright+CDP, inyección al `$scope` AngularJS, scope-walk, ciclo `$digest`, configs de backend, errores duros ya resueltos. Punto de partida para tocar código. |
| `blueprint-automatizacion.md` | Selectores DOM, endpoints REST (`…/restaurant/logistica/rest/`), barreras de espera, fórmulas del oráculo, mocks. Base técnica del módulo Compras. |
| `blueprint-porcionar-insumos.md` | Blueprint del flujo **Porcionar Insumos** (desposte): digest-seguro, `ui-select`, selectores, fórmulas de prorrateo/merma, limpieza. |
| `manual-bot-rpa.md` | Manual de arquitectura y operación del bot completo: bloques de la suite, payloads canónicos, `[DIAG]`, entorno, reportes. Visión global del runner. |
| `mapeo-estructural-logistica.md` | Mapa del backend `webapp/logistica`: 15 dominios, rutas, controladores, modelos, sqlmanager y discrepancias de nombres. Referencia para localizar código. |

## 2. `negocio/` — Reglas de negocio, entidades y configuración

| Documento | Para qué sirve |
|---|---|
| `manual-maestro-logistica.md` | Manual funcional del ERP: ciclo de vida de guardado, tipología de ítems (Insumo/Consumible/Producto), cadena de documentos, producción MRP, almacenes. Contexto de negocio puro. |
| `mapeo-entidades-maestras.md` | Modelo de dominio de las 5 entidades maestras (Insumo, Porcionable, Consumible, Producto, Receta): tabla, flags, Kardex/espejo, restricciones de flujo, dependencias, min/max, varianza. Base para crear maestros. |
| `manual-configuraciones.md` | Las 27 configuraciones por local + globales: qué activan/desactivan, impacto técnico, si afectan al bot, plan de toggles mid-suite y decisiones. **Clave antes de programar flujos.** |

## 3. `negocio/compras/` — Mapeo completo del módulo Compras

### 3.1 Solicitud de compra
| Documento | Para qué sirve |
|---|---|
| `solicitud-de-compra.md` | Flujo Solicitud→OC: canje en 2 POST, checkbox "¿Activar distribución por local?" (`distribucionByLocal`), y por qué el checkbox solo diferencia con N solicitudes. |
| `solicitud-ciclo-vida.md` | Ciclo de vida y estados (7), endpoints, aprobar/rechazar, validator y permisos ACL de la solicitud. |
| `solicitud-filtros-canje.md` | Los 3 filtros pre-canje + vacío con literales exactos, y las negativas que frenan un lote. |
| `solicitud-agrupar.md` | `agrupar(idList)`: fusionar N solicitudes en 1 (autorreferencia, sin pivote) y su reversión al anular. |
| `solicitud-anular.md` | Anular solicitud: validator vacío, desagrupa hijos, no toca `ordencompra_id`. |
| `solicitud-origen-mrp.md` | Solicitudes generadas desde faltantes (MRP): endpoints D1/D2, payload, reserva de stock, trazabilidad de lotes. |

### 3.2 Orden de compra
| Documento | Para qué sirve |
|---|---|
| `orden-de-compra.md` | Núcleo: nacer manual o por canje, tipos de ítem, reglas, matemática (`precio=importe`, `sinImp=NULL`), ACL, dudas precisadas. **Referencia principal.** |
| `orden-compra-editar.md` | `actualizarOrdencompra`: recálculo, bloqueos, validaciones verificables. |
| `orden-compra-aprobar-evaluar.md` | Aprobar/rechazar y evaluación manual/auto (config 71), semáforo `evaluacion`. |
| `orden-compra-importar.md` | OC→Guía y OC→Compra: prorrateo por local, descuento de canjeado, estados resultantes. |
| `orden-compra-anular.md` | Anulación E2E: secuencia hijo→OC, `devolverStock`, literales. |
| `orden-compra-plantillas-masiva.md` | Plantillas 1x1 y carga masiva (Excel/grilla), validaciones por fila. |
| `bugs-orden-compra.md` | 3 bugs (validator de servicios, `||` en evaluar, falta gate ACL) + postura del bot. |
| `bugs-compra-editar.md` | Bug CE-1: `actualizarCompra` no valida el estado → una compra **anulada** se puede reescribir (el freno solo existe en el frontend). Detectado por el bot (Bloque 8, caso 45). |

### 3.3 Guía de compra
| Documento | Para qué sirve |
|---|---|
| `guia-de-compra.md` | Núcleo: nacer manual o desde OC, payload, validaciones, matemática (`ENTRADA_GUIA`, desgravación, merma), relación con compra. |
| `guia-compra-modificar-anular.md` | Modificar (diferencial Kardex) y anular (orden de validaciones, `devolverStock`), orden de desarme total. |
| `guia-compra-auxiliares.md` | Endpoints auxiliares: remisión, histórico, comparativo, última guía. |
| `bugs-guia-compra.md` | 6 bugs (mensajes "Compra", Kardex solo productos, huérfano `compra_id`, etc.). |

### 3.4 Compra (factura) y derivados
| Documento | Para qué sirve |
|---|---|
| `compra.md` | Núcleo: nacer manual o desde OC/Guía, payload, validaciones, matemática (`ENTRADA_COMPRA`, desgravación, crédito/caja), matriz de replicación. |
| `compra-modificar-anular.md` | Modificar (CxP regenerada) y anular (desvincula OC, libera guías), literales. |
| `nota-credito-cxp.md` | NC compra: ramas cantidad vs precio, y Cuentas por Pagar (cuotas, amortización). |
| `compra-servicio.md` | Compra de Servicio: intangible, doble detalle, sin Kardex de entrada. |
| `compra-rapida-borrador-plantilla.md` | Compra Rápida (caja chica), borrador (`avancecompra`) y plantillas. |
| `liquidacion-compra.md` | Liquidación: agrupador contable, **sin prorrateo** (fuera del alcance bot). |
| `compra-impuestos-configs.md` | Impuestos fijos vs dinámicos (config 65), IGV fiscalizado, matriz con/sin × stock × variación. |
| `compra-formas-pago.md` | Formas de pago (contado/mixto/crédito, débito = tarjeta), 5 medios de abono. |
| `compras-electronicas-calculadora.md` | DTE/OCR/XML (fuera de alcance) y Calculadora stock→OCs. |
| `compras-lecturas.md` | Catálogo de endpoints de lectura (oráculo/setup/precarga). |
| `contrato-json-compra.md` | Contrato JSON de compra: cada campo verificable, request/response. |
| `kardex-reporte-columnas.md` | Las 14 columnas del Kardex por movimiento (pre/post) y merma automática. |
| `flujos-e2e.md` | **Semilla maestra + 26 flujos replicables** (formato usuario paso-a-paso), matriz de totales. |
| `bugs-compras-flujos.md` | Bugs de flujos no mapeados (F27–F34), apartados del bot. |

## 4. `operacion/` — Formato de datos de entrada

| Documento | Para qué sirve |
|---|---|
| `formato-excel.md` | Estructura del `.xlsx` que lee el bot (hojas `INSUMOS`/`COMPRAS`, columnas exactas, agrupación por `ID_OPERACION`+`TIPO_FILA`). |

## 5. `php8/` — Migración a PHP 8.5 (errores y dependencias)
| Documento | Para qué sirve |
|---|---|
| `README.md` | Índice de la carpeta: errores del backend PHP 8.5 y dependencias del bot. |
| `actualizacionbot/README.md` | Errores/modificaciones del backend a las que el bot debe adaptarse. |
| `dependencias/README.md` | Dependencias del bot (rutas, binarios, BD, configs) que deben existir. |

## 6. `qa/` — Matrices y reglas de verificación

| Documento | Para qué sirve |
|---|---|
| `matriz-e2e-masiva.md` | Matriz E2E masiva (35 casos) de Aprovisionamiento→Consumibles→Traslados→Ajustes→MRP→Canjes, con estado acumulativo y resultados esperados. |
| `matriz-porcionar-insumos.md` | Matriz E2E del desposte: 30 casos de porcionado, hard-stops, anulaciones LIFO. |
| `reporte-arquitectura-kardex.md` | Reglas del Kardex: fórmulas, literales de bloqueo, varianza, notas de crédito, cuadres. |

---

## Cómo usar este índice

* **Para entender el stack/backend** → `arquitectura/`.
* **Para crear maestros y saber qué config activar** → `negocio/mapeo-entidades-maestras.md` + `negocio/manual-configuraciones.md`.
* **Para programar un flujo** → `negocio/compras/flujos-e2e.md` (paso a paso) + el doc del submódulo.
* **Para verificar matemática** → `negocio/compras/kardex-reporte-columnas.md` + `contrato-json-compra.md` + `qa/`.
* **Para saber qué NO programar (bugs)** → `negocio/compras/bugs-*.md`.
