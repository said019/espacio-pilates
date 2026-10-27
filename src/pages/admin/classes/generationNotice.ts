export function generationNotice(result: { created?: number; skipped?: number }) {
  const created = result.created ?? 0;
  const skipped = result.skipped ?? 0;
  return {
    title: `${created} clases creadas · ${skipped} omitidas`,
    description: skipped > 0
      ? "Las omitidas ya existen en esa sucursal, fecha, hora y tipo de clase, aunque tengan otra coach. No se modificaron sus coaches ni reservas. Para cambiar la coach, abre la clase en Calendario → Opciones de clase → Editar clase."
      : "No se encontraron clases existentes que hubiera que omitir.",
  };
}
