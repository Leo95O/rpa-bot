# actualizacionbot/ — Errores del backend que requieren adaptación del bot

> Registrar aquí los errores/modificaciones del backend (PHP 8.5) a las que el **bot debe adaptarse**.
> El bot NO modifica el backend. Solo documenta y, si es posible, se adapta en código (TS).

## Formato de registro

```
### [FECHA] Título corto
- **Endpoint afectado**: ...
- **Error observado**: ...
- **Causa raíz**: ...
- **Impacto en el bot**: ...
- **Acción del bot**: (adaptarse / no puede / pendiente)
```

## Errores registrados

### 2026-10-23 — PDOStatement::setFetchMode(): Argument #2 must be a valid class
- **Endpoint afectado**: `agregarCompra`, `guardarGuia` (y cualquier endpoint que use `PDO::FETCH_CLASS` con nombre dinámico).
- **Error observado**: HTTP 500. `PDOStatement::setFetchMode(): Argument #2 must be a valid class`. Archivos: `CompraEntity.php:1618`, `GuiaEntity.php:1108`.
- **Causa raíz (detallada)**:
  - En `getByFields()`, el parámetro `$claseEspecifica` recibe el nombre completo de la clase (ej: `'CompraLogistica'`, `'GuiaLogistica'`).
  - El código hace `$claseEspecifica = 'Compra' . ucfirst($claseEspecifica)` → `'CompraCompraLogistica'` / `'GuiaGuiaLogistica'`.
  - Esta clase **no existe** → PHP 8.5 lanza `ValueError`/`PDOException` en `setFetchMode`.
  - En PHP 7.1, `setFetchMode` con clase inexistente **no lanzaba error inmediato** — devolvía `false` al `fetch()`, el `while` no ejecutaba, y el array quedaba vacío. La validación (`existeCompra`/`existeGuia`) devolvía `false` (sin duplicado). Era un **bug latente silenciosamente ignorado** que ahora es fatal.
  - Los callers que pasan el className son: `CompraLogisticaValidator` y `GuiaLogisticaValidator`, ambos con `"CompraLogistica"` / `"GuiaLogistica"` (nombre completo, no solo el sufijo).
- **Impacto en el bot**: HTTP 500 en `agregarCompra` y `guardarGuia`. Cascada: todos los flujos que registran compras/guías fallan (Bloques 1-8, F1-F26).
- **Acción del bot**: No puede adaptarse. El endpoint debe funcionar. El bot solo reporta el error.
- **Fix sugerido (backend, no bot)**: Cambiar los callers para pasar solo `'Logistica'` (sufijo), o cambiar `getByFields` para no hacer double-prefix si el nombre ya contiene el prefijo.

### 2026-10-23 — Maestros no encontrados (consecuencia del seed fallido)
- **Endpoint afectado**: N/A (seed SQL).
- **Error observado**: "Maestro no encontrado en el estado: Arroz QA / Verdura QA / Pollo QA / etc."
- **Causa raíz**: El seed SQL no se aplicó porque `mysql.exe` no se encontró en `C:\xampp\mysql\bin\` (ahora es Laragon).
- **Impacto en el bot**: Flujos F3-F26 fallan. Bloques 3-8 abortan por precondición.
- **Acción del bot**: No puede adaptarse al seed fallido. Ver `dependencias/`.

### 2026-10-23 — Internal Server Error en agregarCompra y guardarGuia
- **Endpoint afectado**: `agregarCompra`, `guardarGuia`.
- **Error observado**: HTTP 500 con body HTML de Slim.
- **Causa raíz**: Mismo que el punto 1 (PDO setFetchMode).
- **Impacto en el bot**: El bot no puede parsear la respuesta (no es JSON). `leerJson` falla.
- **Acción del bot**: Reporta el error tal cual. No puede adaptarse.

### 2026-10-23 — mojibake "CD LogÃstico" (cosmético)
- **Endpoint afectado**: Todos los que devuelven `local_descripcion`.
- **Error observado**: El backend devuelve UTF-8 leído como Latin-1.
- **Causa raíz**: Configuración de charset en PHP 8.5 / Laragon.
- **Impacto en el bot**: No bloquea (el bot normaliza con `fixMojibake`). Solo cosmético.
- **Acción del bot**: Ya adaptado (`fixMojibake` en `bot.ts`).

### 2026-10-23 — count_legacy() y PDOStatementLegacy (compat layer)
- **Archivo**: `api/compat/php8_compat.php`.
- **Causa raíz**: La migración PHP 8.5 creó un archivo de compatibilidad con `count_legacy()` y `PDOStatementLegacy`. El `count_legacy` replica el comportamiento de PHP 7.1 (devuelve 0 para null, 1 para otros). El `PDOStatementLegacy` ignora `bindParam`/`bindValue` en consultas sin marcadores.
- **Impacto en el bot**: Ninguno directo. El bot no usa estas funciones. Pero si el backend las usa incorrectamente, puede haber comportamiento inesperado en los endpoints.
- **Acción del bot**: No aplica. Solo informativo.