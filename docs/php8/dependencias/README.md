# dependencias/ — Dependencias del bot respecto al backend/entorno

> Registrar aquí las dependencias del bot (rutas, binarios, estructura de BD, configs) que deben existir para que el bot funcione.
> Si alguna falla, el bot no puede ejecutarse correctamente.

## Formato de registro

```
### [FECHA] Título corto
- **Tipo**: binario | ruta | config | BD | frontend
- **Valor actual**: ...
- **Valor requerido**: ...
- **Impacto si falla**: ...
```

## Dependencias registradas

### 2026-10-23 — Ruta del binario MySQL (hardcodeada) — RESUELTO
- **Tipo**: binario
- **Valor actual**: Auto-detectado por `resolverMysqlBin()` en `seed.ts`. Prioridad: `DB_MYSQL_BIN` env > XAMPP (`C:\xampp\mysql\bin\mysql.exe`) > Laragon (auto-detect en `C:\laragon\bin\mysql\mysql-*\bin\mysql.exe`) > `mysql` en PATH.
- **Valor requerido**: Cualquiera de las rutas anteriores. Para forzar una específica: `set DB_MYSQL_BIN=C:\laragon\bin\mysql\mysql-8.0.30\bin\mysql.exe`.
- **Impacto si falla**: El seed SQL no se aplica. Los maestros no se crean. Todos los flujos que dependen de `maestro(estado, '...')` fallan con "Maestro no encontrado".
- **Archivos afectados**: `src/e2e/compras/seed.ts` (`resolverMysqlBin`), `src/e2e/compras/suite.ts` (`aplicarSeedCompras`), `src/e2e/suite.ts` (seed inline).
- **Selección de backend**: El bot no se conecta al backend por ruta de archivo — se conecta por HTTP (`localhost:9001`/`localhost:9002`). La "selección" XAMPP vs Laragon se reduce a la ruta del binario MySQL. La BD siempre es `logisticaaa` en `localhost:3306` (misma para ambos). Para seleccionar el backend, basta con setear `DB_MYSQL_BIN` apuntando al binario del entorno deseado.

### 2026-10-23 — Base de datos `logisticaaa` en MySQL
- **Tipo**: BD
- **Valor actual**: MySQL en `localhost:3306`, user `root`, sin password, BD `logisticaaa`.
- **Valor requerido**: Misma BD con el schema `estructura_ligera.sql` aplicado.
- **Impacto si falla**: El bot no puede leer/escribir datos. `limpiarTransaccionales()` falla.

### 2026-10-23 — Chrome con CDP en puerto 9222
- **Tipo**: entorno
- **Valor actual**: Chrome abierto con `--remote-debugging-port=9222`, sesión iniciada en `http://localhost:9002`.
- **Valor requerido**: Chrome dedicado con CDP y sesión logueada (usuario admin con todos los permisos).
- **Impacto si falla**: El bot no puede conectarse (`connectOverCDP` falla). Timeout en todas las acciones.

### 2026-10-23 — App bajo prueba en `http://localhost:9002`
- **Tipo**: entorno
- **Valor actual**: AngularJS app servida en `http://localhost:9002`, API REST en `http://localhost:9001/restaurant/logistica/rest/`.
- **Valor requerido**: App corriendo con el backend PHP 8.5 (Laragon) respondiendo.
- **Impacto si falla**: El bot no puede navegar ni llamar endpoints.

### 2026-10-23 — XAMPP MySQL (legacy)
- **Tipo**: binario
- **Valor actual**: `C:\xampp\mysql\bin\mysql.exe` (usado en seed y en `limpiarTransaccionales` vía `execSync`).
- **Valor requerido**: Migrar a la ruta de Laragon o hacer la ruta configurable por variable de entorno (`DB_MYSQL_BIN`).
- **Impacto si falla**: Seed no se aplica. Base de datos no se limpia entre corridas.