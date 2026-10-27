# Reporte de errores detectados por el bot (rpa-bot) contra backend PHP 8.5

> Generado por el bot E2E (rpa-bot) al correr `npm run test:suite` contra el backend en `C:\laragon\www\webapp` (rama `php_8_5`, PHP 8.5.12).
> El bot NO modifica el backend. Solo reporta.

## Resumen de la corrida

| Métrica | Valor |
|---|---|
| Exitosos | 33 |
| Fallidos | 61 |
| Pendientes | 0 |
| Total | 94 |

## Error principal (bloqueante)

### `PDOStatement::setFetchMode(): Argument #2 must be a valid class`

- **Archivos**: `api/entitybase/CompraEntity.php:1618`, `api/entitybase/GuiaEntity.php:1108`
- **Endpoints afectados**: `agregarCompra`, `guardarGuia`, `agregarCompraServicio`
- **Mensaje exacto**: `PDOStatement::setFetchMode(): Argument #2 must be a valid class`
- **Clase inválida**: `'CompraCompraLogistica...'` / `'GuiaGuiaLogistica...'` (double-prefix)
- **Causa raíz**: En `getByFields()`, el parámetro `$claseEspecifica` recibe el nombre completo de la clase (ej: `'CompraLogistica'`, `'GuiaLogistica'`). El código hace `$claseEspecifica = 'Compra' . ucfirst($claseEspecifica)` → `'CompraCompraLogistica'` / `'GuiaGuiaLogistica'`. Esta clase no existe.
- **Por qué en PHP 7.1 "funcionaba"**: `setFetchMode` con clase inexistente devolvía `false` al `fetch()`, el `while` no ejecutaba, el array quedaba vacío. La validación (`existeCompra`/`existeGuia`) devolvía `false` (sin duplicado). Era un bug latente silenciosamente ignorado.
- **Por qué en PHP 8.5 rompe**: `setFetchMode` valida la clase inmediatamente y lanza `ValueError`/`PDOException` → HTTP 500.
- **Impacto en el bot**: HTTP 500 en `agregarCompra` y `guardarGuia`. Cascada: todos los flujos que registran compras o guías fallan.
- **Callers que pasan el className**: `CompraLogisticaValidator::existeCompra()` y `GuiaLogisticaValidator::existeGuia()`, ambos con `"CompraLogistica"` / `"GuiaLogistica"` (nombre completo, no solo el sufijo).
- **Fix sugerido (backend)**: Cambiar los callers para pasar solo `'Logistica'` (sufijo), o cambiar `getByFields`/`getById` para no hacer double-prefix si el nombre ya contiene el prefijo.

## Error secundario (dependencia del entorno)

### Seed SQL no se aplica (`mysql.exe` no encontrado)

- **Causa**: `seed.ts` y `suite.ts` tienen hardcodeada la ruta `C:\xampp\mysql\bin\mysql.exe`. En Laragon la ruta es distinta.
- **Impacto**: Los maestros (Carne QA, Verdura QA, etc.) no se crean. Flujos F3-F26 fallan con "Maestro no encontrado en el estado".
- **Fix sugerido (bot)**: Hacer la ruta configurable por variable de entorno (`DB_MYSQL_BIN`) o detectar automáticamente.

## Errores cosméticos (no bloqueantes)

### mojibake "CD LogÃstico"
- El backend devuelve UTF-8 leído como Latin-1. El bot ya normaliza con `fixMojibake` en `bot.ts`. Solo cosmético.

## Flujos que pasan vs. fallan

### Pasan (26 OK)
- Bloque 1: pasos 1, 2, 3, 9A (crear insumo, solicitud, OC, crear exonerado)
- Bloque 2: pasos 10, 12 (crear consumible, salida directa)
- Bloque 7: pasos 36, 37 (costo==sin-imp), 39 (flags restaurados)
- F1: solicitud, oc
- F2: solicitud, oc
- F3: oc
- F10: solicitudes, canje, assertEstadoOC, assertDistribucionOC, assertVinculosCanje
- F22: solicitudes, agrupar, origenesAgrupados
- F23: ocs

### Fallan (61 FALLO) — todos por el mismo error de backend
- Todos los que llaman `agregarCompra` o `guardarGuia` → HTTP 500 (PDO setFetchMode).
- Todos los que dependen de maestros no creados → "Maestro no encontrado" (consecuencia del seed fallido).

## Conclusión para la IA que parcheará

1. **Fix principal**: `CompraEntity.php:1618` y `GuiaEntity.php:1108` — resolver el double-prefix en `getByFields`/`getById` cuando `$claseEspecifica` ya contiene el prefijo.
2. **Fix secundario**: Hacer la ruta de `mysql.exe` configurable en el bot (o aplicar el seed manualmente).
3. **No tocar el bot**: El bot está correcto. Solo reporta lo que el backend responde.

## Nota sobre cambios previos del bot en XAMPP

El bot tenía 4 fixes aplicados en el backend de XAMPP (PHP 7.1) que NO están en Laragon:
1. Bloqueo de edición de compra anulada (`actualizarCompra`).
2. Validación ≥2 solicitudes en `agrupar`.
3. Seteo de `losImpuestosEstanIncluidosEnElPrecio` en `registrar()` (precio neto).
4. OC queda `ENPROCESO` en canje parcial (Guía).

Estos fixes **no están en Laragon**. Si se revierten (o no se aplican en Laragon), 6 tests adicionales fallarán. El bot reportará esos bugs correctamente.