export type AdminClassTypeOption = {
  name: string;
  category?: string;
};

function isFunctionalClassType(type: AdminClassTypeOption) {
  return type.category === "funcional" || /funcional|functional/i.test(type.name);
}

// Pozos has a Functional-only recurring schedule, but admins may still create
// intentional Pilates classes there. Villa Magna keeps its existing catalog.
export function manualClassTypesForBranch<T extends AdminClassTypeOption>(
  types: T[],
  branchCode?: string,
) {
  return branchCode === "pozos"
    ? types
    : types.filter((type) => !isFunctionalClassType(type));
}
