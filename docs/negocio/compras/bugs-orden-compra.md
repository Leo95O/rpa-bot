# Bugs de Orden de Compra — Registro Técnico

> Alcance: defectos reales encontrados auditando código (`C:\xampp\htdocs\webapp` + `logisticaview`) durante el mapeo de OC. Cada ficha trae ubicación exacta, causa, impacto, reproducción paso a paso, verificabilidad por bot y fix sugerido. Estado: **reportados, no corregidos** (el bot y los docs asumen el comportamiento con bug).

---

## Bug A — `actualizarOrdencompra` valida con el validator de *Servicios* (grave)

### Dónde
* Llamada equivocada: `logistica/controllers/OrdencompraLogisticaController.php:257-270` (`actualizaOrdencompra` → `validar(OrdenservicioLogistica::MODIFICAR_ORDENSERVICIO)` en vez de un `MODIFICAR_ORDENCOMPRA`).
* Literales que realmente corren: `smart/validators/OrdenservicioLogisticaValidator.php:245` (`"No se puede editar una orden de servicio ya aprobada."`), `:90` (`"La cantidad o precio del: ... , no es valida."`), `:99` (`"Ingrese almenos un detalle en la órden de servicios."`), `:71` (referencia duplicada).
* El validator correcto existe pero no se usa: `smart/validators/OrdencompraLogisticaValidator.php:104-114` (`validarEstadoParaEdiccion`, `"No se puede editar una orden de compra ya aprobada."`).

### Causa probable
Copy-paste entre módulos gemelos (OC y Orden de Servicio comparten forma `{cabecera, productos, productosEliminados}`). Nadie notó el cambio porque el freno visible al usuario vive en el frontend (`lista.orden.compra.controller.js:181-186`: si `estado==APROBADO` muestra `"No es posible editar una orden de compra que ya ha sido aprobada."` y ni navega a edición), así que el mensaje backend casi nunca se ve en pantalla.

### Impacto
1. Mensaje confuso si se llega al backend (dice *servicio* editando una *compra*).
2. Las validaciones de detalle aplicadas son las de servicios (`consumibleordenservicio_*`), no las de `detalleordencompra_costo/cantidad` — un detalle OC inválido podría pasar o uno válido fallar según reglas ajenas.

### Reproducción paso a paso
1. Crear OC (queda PENDIENTE) y aprobarla (`GET aprobarOrdencompra/{id}` → `estado=1`).
2. Desde pantalla: clic derecho → Editar → toast rojo `"No es posible editar..."` (capa frontend, no llega a red).
3. Por API (como el bot): `POST actualizarOrdencompra {ordencompra:{ordencompra_id:<id>}, productos:[]}` → `tipo=ERROR` con `"...orden de servicio ya aprobada."` (capa backend, mensaje equivocado).

### Verificación por bot
`POST actualizarOrdencompra` sobre OC APROBADA → asertar `tipo=ERROR` y mensaje contiene `ya aprobada` (substring, nunca igualdad exacta). Dejar comentario en el spec: si el literal cambia a *"...orden de compra..."*, el bug se corrigió y hay que endurecer el assert.

### Fix sugerido (1 línea + validator)
Cambiar la llamada a `validar(OrdencompraLogisticaValidator::MODIFICAR_ORDENCOMPRA)` (crear la constante y el case, reutilizando `validarEstadoParaEdiccion` existente). Severidad: **media** (no corrompe datos, confunde y valida con reglas ajenas).

---

## Bug B — Condición `||` que nunca bloquea re-evaluar (`evaluarOrdenescompra`)

### Dónde
* `logistica/controllers/OrdencompraLogisticaController.php:607-646` (`evaluarOrdenescompra`), condición `:620`: `if (evaluacion != ACEPTADA || evaluacion != RECHAZADA)`.
* Valores: `api/definitions.php:2391-2394` (`PENDIENTE=0, ACEPTADA=1, OBSERVADA=2, RECHAZADA=3`).

### Causa y explicación detallada
Con `||`, la condición es **tautología**: cualquier valor es distinto de al menos uno de los dos. Con `evaluacion=1`: `(1≠1→false) || (1≠3→true)` = `true` → entra y sobrescribe. Debería ser `&&` (solo entra si es distinta de ambas, o sea PENDIENTE/OBSERVADA). Alguien quiso decir "si aún no está decidida" y escribió "o" en vez de "y".

### Impacto
Por API se puede re-evaluar infinitamente (Aceptar → Rechazar → Aceptar...), cada vez con mensaje de éxito `"Se evaluaron las ordenes compra con exito."` y evento registrado. El único freno es el frontend (checkbox deshabilitado + `"Las ordenes de compra con codigo: X ya fueron aceptadas."`, `lista...:1266,1369-1398`).

### Reproducción paso a paso
1. OC con `evaluacion=0`. 2. `POST evaluarOrdenescompra {listaOrdenescomopra:[X], tipo:1}` → `evaluacion=1`, éxito. 3. `POST ... {tipo:3}` misma OC → **éxito otra vez**, `evaluacion=3` (debería fallar). 4. Repetir con `tipo:1` → vuelve a `1`. Cada cambio queda en BD + evento.

### Verificación por bot
Solo verificable el camino feliz + permiso/rango (`tipo:0/4` o sin permiso 121 → `"El usuario no cuenta con el permiso..."`). La no-re-evaluación **no se aserta por backend** (falla por diseño); se documenta como limitación y se prueba vía UI si se automatiza la pantalla.

### Fix sugerido
`||` → `&&` en `:620` (+ literal `"La orden ya cuenta con evaluación final."`). Severidad: **media-baja** (requiere acceso API directo; por pantalla no se explota).

---

## Bug C — `registrarOrdencompra` sin gate ACL (posible olvido)

### Dónde
* Sin chequeo: `logistica/controllers/OrdencompraLogisticaController.php:512-599` (cero llamadas a `rolTienePermisoActivo`/`tienePermisoActivo`).
* Vecinos con gate: anular `:219,910` (`ANULAR_ORDEN_COMPRA='8'`), aprobar/rechazar `:724,773` (`APROBAR_RECHAZAR...='91'`), evaluar `:616` (`PERMITIR_EVALUAR...='121'`), calculadora masiva `:1044` (`REGISTRAR_ORDEN_COMPRA_LOGISTICA='6'`).
* Mecanismo: `Permisologistica::rolTienePermisoActivo(rol, permiso)` (`api/entity/Permisologistica.php:38-56`) busca en BD `rolpermisologistica(rollogistica_id, permisologistica_id, estado=ACTIVO)`; el rol sale de la sesión (`Security::getRolUsuarioLogistica()`, `api/core/Security.php:1434-1448` ← `$_SESSION["usuario_rol_logistica"]` del login; el bot hereda la sesión del Chrome por CDP, no loguea).

### Qué es `REGISTRAR_ORDEN_COMPRA=6
Es el ID del permiso en el catálogo `permisologistica` (`api/definitions.php:2800`). Cada acción del ERP tiene uno (6=registrar OC, 8=anular OC, 91=aprobar/rechazar, 121=evaluar, 10/12/62 los de solicitud...). Tener la fila en `rolpermisologistica` = poder hacer esa acción con ese rol.

### Impacto
Un rol sin la fila del 6 (ej. "Almacenero" solo-stock) no ve el botón, pero un POST directo con su sesión **crearía la OC igual**, mientras anular/aprobar sí lo frenarían. Inconsistencia de autorización (no se explota por pantalla, solo por API).

### Reproducción paso a paso
1. Crear rol sin permiso 6 (o quitar la fila en `rolpermisologistica`). 2. Iniciar sesión con un usuario de ese rol. 3. `POST registrarOrdencompra {ordencompra, productos}` válido → **éxito** (debería denegar). 4. `GET anularOrdencompra` con el mismo rol → `"No tienes permisos..."` (control que sí frena).

### Verificación por bot
Requiere sesión restringida (hoy el bot corre con admin full-permisos, donde todo pasa). Pasos: login rol sin fila 6 → `POST registrar` → si éxito, bug vigente; si `"No tienes permisos..."`, corregido. Marcar el caso como `pendiente-sesion` hasta tener el rol de prueba.

### Fix sugerido
Agregar al inicio de `registrarOrdencompra` el mismo gate de `:1044`. Severidad: **media** (seguridad por API; por UI no visible). Alternativa válida: declarar "registro abierto por diseño" y cerrar el bug como *won't fix* documentado.

---

## Postura del bot frente a estos bugs (decisión de arquitectura)

**El bot PUEDE explotarlos técnicamente, pero NO LO HARÁ.** Fundamento: el bot opera a través del frontend real (navegación por `$state`, scope-walk hasta el `vm`, llamadas vía los `Resource`/`Collection` Angular con la sesión del Chrome logueado). Eso significa:

* Cuando el flujo pasa por la pantalla (ej. menú Editar en OC aprobada), el gate frontend **sí lo detiene** igual que a un usuario (toast + `return`, sin POST). Para forzar el caso habría que invocar el servicio por `page.evaluate` saltándose la pantalla — posible, pero antinatural y fuera del alcance.
* Cuando invoca servicios directamente (ej. `registrarOrdencompra` con payload armado), viaja con la sesión admin full-permisos, así que los gates ACL pasan y los bugs de validación (A, B) responderían éxito donde un usuario vería freno. De nuevo: solo si un spec lo provoca a propósito.

**Decisión:** no se escriben specs que exploten vulnerabilidades. Los bugs quedan registrados aquí para el equipo de desarrollo, y el bot aserta el comportamiento vigente (substring tolerante) sin forzar caminos antinaturales. El objetivo del bot es **verificar cálculos y viaje de la data** (PPP, prorrateo, desgravación de impuestos, distribución, saldos de canje), no auditar seguridad. Si a futuro se quiere pentest, será una suite separada con sesión restringida, no esta.

## Anexo — Typos en literales (no son bugs lógicos, pero rompen asserts exactos)

`"orde de compra"`, `"anualada"`, `"cajeadas"`, `"distrubuir"`, `"Porveedores"`, espacio inicial en `" No es posible aprobar..."`. Regla del bot ya adoptada: asertar por **substring/flag/estado**, nunca igualdad exacta de mensaje.
