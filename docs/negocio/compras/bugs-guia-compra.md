# Bugs de Guía de Compra — Registro Técnico (doble nivel)

> Cada ficha se explica dos veces: **a nivel usuario** (qué ve y qué le pasa a alguien operando la pantalla) y **a nivel técnico** (qué línea de código lo causa y por qué). Estado: **reportados, no corregidos**.

---

## Bug G1 — El mensaje de error dice "Compra" cuando falla una Guía

### A nivel usuario
Registras una guía con un dato malo (ej. sin almacén) y el sistema responde en rojo: *"Se produjo un error al crear tu **Compra**. Inténtalo de nuevo."* No creaste ninguna compra — estabas en Guías. El mensaje confunde: el usuario cree que el error es de otro módulo o que hizo algo en la pantalla equivocada. Lo mismo al modificar: *"Se produjo un error al crear tu **actualizar**..."* (frase sin sentido).

### A nivel técnico
`logistica/controllers/GuiaLogisticaController.php:93` (`guardarGuia`, rama error) y `:388` (`actualizarGuia`). Copy-paste del controller de Compras sin renombrar el literal. El `tipo=ERROR` y el flujo son correctos; solo el texto miente.

### Reproducción / bot / fix
Repro: `POST guardarGuia` con detalle sin `almacen_id` → `tipo=ERROR` + ese literal. Bot: asertar `tipo` y substring `error`, nunca el texto completo. Fix: renombrar a *"...crear tu Guía..."* / *"...actualizar tu guía..."*. Severidad: **baja** (cosmético).

---

## Bug G2 — Modificar salta el freno de Kardex posterior que anular sí aplica

### A nivel usuario
Día 1: registras guía con 100kg de pollo. Día 5: la cocina consume 40kg en producción. Día 6: **modificas** la guía y bajas la cantidad a 50kg — el sistema lo acepta sin quejarse, aunque 40kg ya se consumieron (el Kardex queda descuadrado hacia atrás). En cambio, si intentas **anular** esa misma guía, el sistema sí te frena: *"El producto de la posición N, ya ha sido usado para otra operación, verifica el kardex."* Misma guía, mismo consumo posterior, dos criterios distintos.

### A nivel técnico
`smart/validators/GuiaLogisticaValidator.php`: `_validarModificacion()` tiene la llamada a `guiaTieneProductosConOperaciones2()` **comentada** (`:107-114`), mientras `_validarAnulacion()` la ejecuta (`:129-133`, motivos `SALIDA_MOVIMIENTO, SALIDA_PREPARACION_RECETA_BASE, SALIDA_MERMA` vía `Utility::existeMovimientosPosteriores`). La modificación recalcula diferencial (`modificacionDetalle`: nueva→insert+entrada, cambiada→update+re-entrada, eliminada→contra-salida) sin preguntar si el lote ya se movió.

### Reproducción / bot / fix
Repro: guía → consumo posterior del mismo ítem/almacén → `POST actualizarGuia` reduciendo cantidad → éxito (debería frenar como el anular). Bot: **no asertar bloqueo aquí**; documentar la asimetría y preferir casos de modificación antes de consumos. Fix: descomentar el chequeo en modificación, o documentar como diseño ("el diferencial se autocorrige") con prueba que lo demuestre. Severidad: **media** (puede descuadrar Kardex histórico).

---

## Bug G3 — El freno de Kardex posterior solo protege productos, nunca insumos

### A nivel usuario
Si la guía trae gaseosas (producto) consumidas después, anular se bloquea. Si trae pollo (insumo) consumido después, **anular pasa limpio** aunque el Kardex quede en negativo hacia atrás. El usuario ve protección en un módulo y desprotección en el otro sin razón aparente.

### A nivel técnico
`GuiaLogisticaValidator.php:292-319`: la función solo evalúa `_esUnProducto()` (`producto_id`); la rama de insumos está comentada (`:312-319`). `Utility::existeMovimientosPosteriores` nunca se invoca con `TIPO_INSUMO` en este flujo.

### Reproducción / bot / fix
Repro: guía de insumo → salida posterior (merma/movimiento) → `GET anularGuia/{id}/1` → éxito + stock negativo hacia atrás. Bot: los casos de anulación con consumo posterior deben usar **productos** si quieren verificar el bloqueo; con insumos, esperar éxito. Fix: activar la rama de insumos o declarar el alcance ("solo productos") en el mensaje. Severidad: **media**.

---

## Bug G4 — Anular una guía usada por una compra deja la compra huérfana

### A nivel usuario
Guía G-10 → Compra C-5 la usa (factura lo recibido). Anulas la guía G-10 (con devolver stock). La compra C-5 **sigue diciendo que vino de la guía G-10**, pero esa guía ahora está anulada (INACTIVO). Si alguien abre la compra y quiere ver su guía, encuentra un documento muerto. Ningún mensaje avisa.

### A nivel técnico
`GuiaLogistica.php:438-452 anular()` desvincula OCs (`desvincularOrdenesCompras`) y remisión (`guia_id=null`), pero **jamás limpia `guia.compra_id` / `guia_porcompra`**. No existe validación previa que lo impida (a diferencia de OC, que sí bloquea anular si tiene `compra_id`). El sentido contrario sí está resuelto: anular compra libera sus guías (`CompraLogistica.php:2604 liberarCompraVinculada` → `compra_id=null, porcompra=0`, guía queda ACTIVA). Asimetría: compra→guía libera; guía→compra abandona.

### Reproducción / bot / fix
Repro: guía → compra que la vincula (`actualizarGuiasEnCompra`) → `anularGuia/1` → éxito; `obtenerGuia` muestra `INACTIVO` con `compra_id` todavía seteado. Bot: tras A-recibos, verificar huérfano (`compra_id` persistente) en vez de asumir limpieza; nunca esperarlo como error. Fix (a elegir): o validación previa (`"La guía está vinculada a la compra X"`), o desvinculación espejo (`compra_id=null` al anular guía). Severidad: **media-baja** (integridad referencial lógica, no rompe stock porque ese ya se revirtió con `fueeliminado=SI`).

---

## Bug G5 — Dos literales distintos para los mismos 90 días

### A nivel usuario
Modificas una guía de hace 100 días: *"La **guia** tiene más de 90 días registrada."* Anulas otra igual: *"La **guía de compra** tiene más de 90 días registrada."* Mismo límite, redacción distinta (y una sin tilde). Si el usuario busca el mensaje en el manual, encuentra dos versiones.

### A nivel técnico
`GuiaLogisticaValidator.php:97-102` (modificar) vs `:122-127` (anular), ambos contra `DIAS_MAXIMO_ANULACION=90` (`:10`). Duplicación de literales en vez de constante compartida.

### Reproducción / bot / fix
Repro: guía con `fechaemision = hoy−100` → modificar y anular → comparar textos. Bot: distinguir por substring `90` + contexto (endpoint llamado), nunca por texto exacto. Fix: unificar en un literal. Severidad: **baja**.

---

## Bug G6 — TODO muerto sobre guías en Compras

### A nivel usuario
Ninguno visible (es código comentado). Riesgo: alguien lo "implementa" sin contexto y cambia el comportamiento de anular-compra-con-guías.

### A nivel técnico
`CompraLogistica.php:2597`: `//$this->_descontarStockAGuiasVinculadas(); //TODO ... cuando ya se encuentre implementado el modulo de guias`. El módulo de guías existe y opera hace años; el TODO es obsoleto. Fix: borrar la línea o convertirla en issue real. Severidad: **informativa**.
