export function RosterPhone({ phone }: { phone?: string | null }) {
  const value = String(phone ?? "").trim();
  if (!value) return <p className="text-[11px] text-muted-foreground">Sin teléfono registrado</p>;
  const dial = value.replace(/[^\d+]/g, "");
  return (
    <a href={`tel:${dial}`} aria-label={`Llamar al ${value}`}
      className="block text-xs text-muted-foreground underline break-all py-1">
      {value}
    </a>
  );
}
