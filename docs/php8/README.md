# PHP 8.5 — Migración y errores detectados por el bot

> Carpeta creada para registrar los errores que el bot detecta al correr contra el backend migrado a PHP 8.5 (rama `php_8_5`).
> El bot NO debe tocar el backend ni el frontend. Su rol es reportar.

## Subcarpetas

| Subcarpeta | Propósito |
|---|---|
| `actualizacionbot/` | Errores/modificaciones del backend a las que el **bot debe adaptarse** (cambios de contrato, formato de respuesta, campos nuevos/eliminados). |
| `dependencias/` | Dependencias del bot respecto al backend (rutas, binarios, estructura de BD, configs) que deben existir para que el bot funcione. |

## Reporte consolidado

- `REPORTE_ERRORES_BOT.md` — Reporte textual completo generado por el bot al correr contra Laragon (PHP 8.5). Incluye error principal (PDO setFetchMode), error secundario (mysql.exe), flujos que pasan/fallan, y fix sugerido.
- `REPORTE_BUGS_BACKEND.md` — Reporte detallado de bugs del backend (no del bot): c106, precio neto, agrupar <2, editar compra anulada. Con endpoint, flujo, variantes, causa raíz y fix sugerido. Para la IA que parcheará el backend.

## Errores registrados hasta ahora

### 1. `PDOStatement::setFetchMode(): Argument #2 must be a valid class`
- **Archivos**: `api/entitybase/CompraEntity.php:1618`, `api/entitybase/GuiaEntity.php:1108`
- **Causa**: En PHP 8.x, `PDO::FETCH_CLASS` exige que la clase exista y sea autoloadable. En PHP 7.1 se toleraba un nombre inválido (devolvía `stdClass` o se ignoraba). El backend legacy pasa un nombre de clase dinámico (`'Compra' . CLASE_MODULO_LOGISTICA` / `'Guia' . CLASE_MODULO_LOGISTICA`) que no se resuelve en PHP 8.5.
- **Impacto en el bot**: HTTP 500 en `agregarCompra` y `guardarGuia`. Cascada: todos los flujos que registran compras/guías fallan (Bloques 1-8, F1-F26).
- **Tipo**: Error del backend (PHP 8.5 incompatibilidad). El bot no puede adaptarse — el endpoint debe funcionar.

### 2. Seed SQL no se aplica (`mysql.exe` no encontrado)
- **Causa**: `seed.ts` y `suite.ts` tienen hardcodeada la ruta `C:\xampp\mysql\bin\mysql.exe`. En Laragon la ruta es distinta (`C:\laragon\bin\mysql\...`).
- **Impacto en el bot**: Los maestros (Carne QA, Verdura QA, etc.) no se crean. Todos los flujos que dependen de `maestro(estado, '...')` fallan con "Maestro no encontrado".
- **Tipo**: Dependencia del bot respecto al entorno (ruta del binario MySQL). Registrado en `dependencias/`.

### 3. `local_descripcion` mojibake ("CD LogÃstico")
- **Causa**: El backend devuelve UTF-8 leído como Latin-1. El bot ya tiene `fixMojibake` en `bot.ts` (FIX 1), pero sigue apareciendo en el payload (no bloquea porque el bot normaliza).
- **Impacto en el bot**: No bloquea (el bot normaliza). Solo cosmético.

### 4. Maestros no creados (consecuencia del punto 2)
- **Impacto**: Bloques 3-8 abortan por precondición; Flujos F3-F26 fallan con "Maestro no encontrado".

## Resumen
- **Errores de backend (PHP 8.5 incompatibilidad)**: 1 (PDO setFetchMode). Bloquea toda la suite.
- **Dependencias del bot (rutas/binarios)**: 1 (mysql.exe). Bloquea el seed.
- **Errores cosméticos**: 1 (mojibake). No bloquea.

El bot en sí (Node/TS) compila y ejecuta correctamente. Los fallos son del backend (PHP 8.5) y del entorno (rutas de binarios), no del bot.