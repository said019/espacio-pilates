import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import api from "@/lib/api";
import type { BranchCode } from "@/types/branch";

export type StudioProgram = "pilates" | "functional" | "prenatal";

export interface BranchOption {
  id: string;
  code: BranchCode;
  name: string;
  address: string | null;
  mapsUrl?: string | null;
  phone?: string | null;
  timezone?: string;
  isActive: boolean;
}

const FALLBACK_BRANCHES: BranchOption[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    code: "villa-magna",
    name: "Villa Magna",
    address: "Av. Villa Magna Nte. 600 A, Villa Magna, San Luis Potosí, S.L.P.",
    phone: "444 548 0352",
    timezone: "America/Mexico_City",
    isActive: true,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    code: "pozos",
    name: "Pozos",
    address: "Camino a los Pozos, Boulevard de Pozos 302-E, 78420 Laguna de Santa Rita, S.L.P.",
    mapsUrl: "https://www.google.com/maps?q=Tu+Espacio+Pilates+Pozos,+Camino+a+los+Pozos,+Boulevard+de+Pozos+302-E,+78420+Laguna+de+Santa+Rita,+S.L.P.&ftid=0x842aa5ec38bd6d83:0x83d5a2cdd0d0d0da",
    phone: null,
    timezone: "America/Mexico_City",
    isActive: true,
  },
];

interface BranchState {
  branchCode: BranchCode;
  setBranchCode: (branchCode: BranchCode) => void;
}

export const useBranchStore = create<BranchState>()(
  persist(
    (set) => ({
      branchCode: "villa-magna",
      setBranchCode: (branchCode) => set({ branchCode }),
    }),
    { name: "tu-espacio-selected-branch" },
  ),
);

function toBranchCode(value: unknown): BranchCode | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "pozos" || normalized.includes("pozos")) return "pozos";
  if (
    normalized === "villa-magna"
    || normalized === "villa_magna"
    || normalized.includes("villa magna")
  ) return "villa-magna";
  return undefined;
}

function normalizeBranch(row: any): BranchOption | null {
  const code = toBranchCode(row?.code ?? row?.slug ?? row?.branch_code ?? row?.name);
  if (!code) return null;
  return {
    id: String(row?.id ?? code),
    code,
    name: String(row?.name ?? (code === "pozos" ? "Pozos" : "Villa Magna")),
    address: row?.address ? String(row.address) : null,
    mapsUrl: row?.mapsUrl || row?.maps_url ? String(row.mapsUrl ?? row.maps_url) : null,
    phone: row?.phone ? String(row.phone) : null,
    timezone: String(row?.timezone ?? "America/Mexico_City"),
    isActive: (row?.isActive ?? row?.is_active) !== false,
  };
}

export function useBranches() {
  const query = useQuery({
    queryKey: ["public-branches"],
    queryFn: async () => (await api.get("/branches")).data,
    staleTime: 1000 * 60 * 10,
    retry: 1,
  });

  const payload = query.data?.data ?? query.data;
  const remote = (Array.isArray(payload) ? payload : [])
    .map(normalizeBranch)
    .filter((branch): branch is BranchOption => Boolean(branch?.isActive));

  // Keep both launch branches selectable while the branches endpoint rolls out.
  const branches = FALLBACK_BRANCHES.map((fallback) =>
    remote.find((branch) => branch.code === fallback.code) ?? fallback,
  );

  return { ...query, branches };
}

export function useBranch() {
  const branchCode = useBranchStore((state) => state.branchCode);
  const setBranchCode = useBranchStore((state) => state.setBranchCode);
  const { branches, ...query } = useBranches();
  const branch = branches.find((item) => item.code === branchCode) ?? branches[0] ?? FALLBACK_BRANCHES[0];

  return {
    branch,
    branches,
    branchCode,
    setBranchCode,
    ...query,
  };
}

export function getEntityBranchCode(entity: any): BranchCode | undefined {
  return toBranchCode(
    entity?.branchCode
      ?? entity?.branch_code
      ?? entity?.branchSlug
      ?? entity?.branch_slug
      ?? entity?.branch?.code
      ?? entity?.branchName
      ?? entity?.branch_name
      ?? entity?.branch?.name,
  );
}

export function getEntityBranchName(entity: any, fallback: BranchOption | BranchCode = "villa-magna") {
  const explicit = entity?.branchSnapshotName
    ?? entity?.branch_snapshot_name
    ?? entity?.branchName
    ?? entity?.branch_name
    ?? entity?.branch?.name;
  if (explicit) return String(explicit);
  const code = getEntityBranchCode(entity)
    ?? (typeof fallback === "string" ? fallback : fallback.code);
  return code === "pozos" ? "Pozos" : "Villa Magna";
}

export function matchesBranch(entity: any, branch: BranchOption, unscoped: "villa-magna" | "universal" = "villa-magna") {
  const entityId = entity?.branchId ?? entity?.branch_id ?? entity?.branch?.id;
  if (entityId && String(entityId) === String(branch.id)) return true;
  const code = getEntityBranchCode(entity);
  if (code) return code === branch.code;
  return unscoped === "universal" || branch.code === "villa-magna";
}

export function getEntityProgram(entity: any): StudioProgram {
  const raw = String(
    entity?.program
      ?? entity?.classProgram
      ?? entity?.class_program
      ?? entity?.classCategory
      ?? entity?.class_category
      ?? entity?.category
      ?? "",
  ).toLowerCase();
  const name = String(entity?.name ?? entity?.planName ?? entity?.plan_name ?? entity?.class_type_name ?? "").toLowerCase();
  if (raw.includes("prenatal") || name.includes("prenatal")) return "prenatal";
  if (raw.includes("func") || name.includes("funcional")) return "functional";
  return "pilates";
}

export function programLabel(program: StudioProgram) {
  if (program === "functional") return "Funcional";
  if (program === "prenatal") return "Prenatal";
  return "Pilates";
}

export function extractMemberships(response: any): any[] {
  const payload = response?.data !== undefined ? response.data : response;
  const rows = [
    ...(Array.isArray(response?.memberships) ? response.memberships : []),
    ...(Array.isArray(payload?.memberships) ? payload.memberships : []),
    ...(Array.isArray(payload) ? payload : []),
    ...(payload && typeof payload === "object" && "id" in payload ? [payload] : []),
  ];
  return rows.filter(
    (item, index) => item?.id && rows.findIndex((candidate) => candidate?.id === item.id) === index,
  );
}
