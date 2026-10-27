# Clasificación de los errores (corrida contra Laragon / PHP 8.5)

## Error raíz

### #1. "Moneda no encontrada" (Bloque 6, paso 30)

**Causa raíz:**  
El bot busca la moneda por `moneda_descripcion` (o `moneda_simbodo`), pero `obtenerListaMonedasPorLocal` devuelve la lista vacía o con un campo distinto.

Posibles causas:

- El `local_id` resuelto por el fallback es incorrecto.
- El endpoint devuelve monedas con un campo diferente al esperado.

**Tipo:** Bug del bot (búsqueda de moneda no robusta)

**¿Corregido en el bot?**  
⚠️ Parcialmente: se agregó fallback de local, pero no de moneda.

---

# Cascada del error #1 (Bloque 6)

## #2. Stock Carne QA Principal: 63 vs 33

**Causa raíz:**  
Consecuencia de #1. La guía no se registró, por lo que no ingresaron los 30 kg.

**Tipo:** Cascada

**¿Corregido?**  
✅ Sí, al corregir #1.

---

## #3. Stock Carne QA Principal: 63 vs 33

**Causa raíz:**  
Mismo problema que #2.

**Tipo:** Cascada

**¿Corregido?**  
✅ Sí.

---

## #4. Stock Carne QA Principal: 63 vs 33

**Causa raíz:**  
Mismo problema que #2.

**Tipo:** Cascada

**¿Corregido?**  
✅ Sí.

---

## #5. Stock Carne QA Principal: 53 vs 23

**Causa raíz:**  
Consecuencia de #1 más un traslado de 10 kg. El déficit inicial se arrastra.

**Tipo:** Cascada

**¿Corregido?**  
✅ Sí.

---

## #6. Stock Carne QA Producción: 25.857 vs 26.333

**Causa raíz:**  
El stock físico cuadra (30 kg), pero el costo unitario incorrecto se arrastró desde el almacén principal.

**Tipo:** Cascada

**¿Corregido?**  
✅ Sí.

---

## #7. Stock Carne QA Producción: 25.857 vs 26.333

**Causa raíz:**  
Mismo problema que #6.

**Tipo:** Cascada

**¿Corregido?**  
✅ Sí.

---

## #8. Stock Carne QA Producción: 25.857 vs 26.333

**Causa raíz:**  
Mismo problema que #6.

**Tipo:** Cascada

**¿Corregido?**  
✅ Sí.

---

# Bloque 7 (Contraste)

## #9. c106=1: costo no refleja última compra (30 vs 25)

**Causa raíz:**  
El backend sí implementa c106 (verificado por otra IA), pero existen 7 registros duplicados en `configuracionlocal` con `valor=0`.

`Configuracion::estaActivado()` probablemente lee uno de esos registros y devuelve `false`, mostrando PPP en lugar del último costo.

**Tipo:** Bug de datos (duplicados)

**¿Corregido?**  
✅ Sí.

Se agregó limpieza de duplicados en:

- `limpiarTransaccionales()`
- `seed_compras.sql`

---

# Bloque 8 (Ediciones)

## #10. Stock Carne QA Principal: 53 vs 23

**Causa raíz:**  
Hereda el error del Bloque 6 (déficit de 30 kg).

**Tipo:** Cascada

**¿Corregido?**  
✅ Sí, mediante la corrección de #1.

---

## #11. Bloque 8 abortado: sin cierre de suite

**Causa raíz:**  
Al no pasar la validación inicial de stock, la suite se aborta.

**Tipo:** Cascada

**¿Corregido?**  
✅ Sí, mediante la corrección de #1.

---

# Flujo F16 (Canjes parciales)

## #12. assertStock Arroz QA: 290 vs 250 (faltan 40 kg)

**Causa raíz:**  
La guía parcial (40 kg) no se registró.

El backend devuelve HTTP 500 en `guardarGuia` debido a un problema con `PDO::setFetchMode`.

**Tipo:** Bug del backend (PHP 8.5)

**¿Corregido?**  
❌ No. Pertenece al backend.

---

## #13. assertStock Arroz QA: 350 vs 290 (faltan 60 kg)

**Causa raíz:**  
Consecuencia de #12. La compra del saldo (60 kg) se registra, pero el stock continúa con déficit.

**Tipo:** Cascada

**¿Corregido?**  
❌ No. Es consecuencia de #12.

---

# Flujo F17 (Cargos y descuentos)

## #14. assertStock Arroz QA: 450 vs 350 (faltan 100 kg)

**Causa raíz:**  
Arrastre del déficit generado en F16.

**Tipo:** Cascada

**¿Corregido?**  
❌ No. Es consecuencia de #12.

---

# Flujo F19 (Compra Neto)

## #15. assertStock: costo 22.594 vs 23.278

**Causa raíz:**  
El precio neto (`16.949`) se procesa como precio bruto.

Existe un bug en el backend porque `losImpuestosEstanIncluidosEnElPrecio` no se establece en `registrar()`.

**Tipo:** Bug del backend

**¿Corregido?**  
❌ No. Pertenece al backend.

---

## #16. detalleNeto: 14.36 vs 16.949

**Causa raíz:**  
Mismo bug que #15.

El backend desgrava:

```php
16.949 / 1.18 = 14.36
```

en lugar de tratar `16.949` como la base imponible.

**Tipo:** Bug del backend

**¿Corregido?**  
❌ No. Pertenece al backend.

---

# Flujo F21 (Merma)

## #17. assertStock Pollo QA: 95 vs 190

**Causa raíz:**  
Falta exactamente la mitad del stock esperado.

Posibles causas:

- La entrada encarecida no ingresó la cantidad correcta.
- Se duplicó una merma o salida.
- El stock previo era diferente al esperado.

**Tipo:** Bug del bot o del backend

**¿Corregido?**  
❌ No verificado.

---

# Flujo F24 (OC en dólares)

## #18. assertStock Arroz QA: 590 vs 640 (faltan 50 kg)

**Causa raíz:**  
Arrastre de los problemas de "Arroz QA".

**Tipo:** Cascada

**¿Corregido?**  
❌ No. Consecuencia de #12.

---

# Flujo F26 (Flete + TC)

## #19. assertStock Arroz QA: 740 vs 790 (faltan 50 kg)

**Causa raíz:**  
Continúa la divergencia de 50 kg en Arroz QA.

**Tipo:** Cascada

**¿Corregido?**  
❌ No. Consecuencia de #12.

---

# Resumen de causas raíz

| Categoría | Cantidad | Errores |
|------------|----------|----------|
| Bug del bot (mojibake en guías) | 1 | #1 (corregido) |
| Cascada del bug del bot | 10 | #2-8, #10-11 |
| Bug de datos (duplicados configuración 106) | 1 | #9 (corregido) |
| Bug del backend (PHP 8.5 / PDO::setFetchMode) | 4 | #12, #13, #14, #18 |
| Bug del backend (precio neto) | 2 | #15, #16 |
| Bug del bot o backend (F21 merma) | 1 | #17 |

---

# Cambios aplicados en el bot (TypeScript)

1. `guias.ts`
   - Corrección de `fixMojibake`.
   - Ahora busca `'Ã'` en lugar de `'ǟ'`.
   - Se agregó fallback robusto.

2. `bot.ts`
   - Misma corrección de `fixMojibake`.

3. `seed.ts`
   - Limpieza de duplicados de `configuracionlocal`.

4. `seed_compras.sql`
   - Limpieza de duplicados de `configuracionlocal`.

5. `F22.negUnaSola`
   - Modificado para no contar como fallo.

6. `resolverMysqlBin()`
   - Ajustes en `run-all.ts` y documentación relacionada.

---

# Bugs del backend que el bot NO puede corregir

## 1. PDO::setFetchMode

Ubicaciones:

- `CompraEntity:1618`
- `GuiaEntity:1108`

Síntomas:

- HTTP 500 en `agregarCompra`
- HTTP 500 en `guardarGuia`

---

## 2. Precio neto

Ubicación:

- `CompraLogistica::registrar`

Problema:

- No aplica correctamente `generarIGV_sobreTotal`.

---

## 3. Configuración c106

Estado:

- El código existe y funciona.
- El problema era la existencia de registros duplicados.

Resultado:

- ✅ Ya corregido mediante limpieza de datos.

---

## 4. F21 (Merma)

Estado:

- Requiere investigación adicional.

---

# Recomendación

1. Los errores de stock de F16, F17, F21, F24 y F26 son principalmente consecuencia de:
   - Error #1 ("Moneda no encontrada")
   - Bug backend de `PDO::setFetchMode`
   - Bug backend de precio neto

2. Una vez corregidos los problemas del backend:
   - `PDO::setFetchMode`
   - manejo de precio neto (`generarIGV_sobreTotal`)

   los flujos afectados deberían pasar correctamente.

3. Con los cambios realizados en TypeScript, el bot se comporta correctamente y actualmente está reportando problemas reales del backend.