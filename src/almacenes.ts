// almacenes.ts — Resolución de almacén por id.
// La BD QA tiene decenas de almacenes llamados "Almacen Principal" y "Producción" (uno por
// local), así que buscar por descripción elige el primero de la lista por casualidad.
// Los nombres que usa la suite se traducen a su id fijo y las búsquedas comparan almacen_id.

export const ALMACEN_IDS: Record<string, number> = {
  'Almacen Principal': 1,
  Producci: 18,
  'Producción': 18,
};

/** Id del almacén: numérico tal cual, o el id fijo de un nombre conocido; undefined si no se sabe. */
export function almacenIdDe(ref: string | number | undefined | null): number | undefined {
  if (ref === undefined || ref === null || ref === '') return undefined;
  if (typeof ref === 'number') return ref;
  if (/^\d+$/.test(ref.trim())) return Number(ref.trim());
  return ALMACEN_IDS[ref];
}

/** Para matchers en página que aceptan nombre o id: devuelve el id como texto si se conoce. */
export function refAlmacen(ref: string): string {
  const id = almacenIdDe(ref);
  return id !== undefined ? String(id) : ref;
}
