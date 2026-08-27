import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import api from "@/lib/api";
import type { Branch } from "@/types/branch";
import { Building2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const ALL_BRANCHES = "all" as const;
export type AdminBranchScope = typeof ALL_BRANCHES | string;

const STORAGE_KEY = "tep_admin_branch_scope";

function initialScope(): AdminBranchScope {
  if (typeof window === "undefined") return ALL_BRANCHES;
  try {
    return typeof window.localStorage?.getItem === "function"
      ? window.localStorage.getItem(STORAGE_KEY) || ALL_BRANCHES
      : ALL_BRANCHES;
  } catch {
    return ALL_BRANCHES;
  }
}

interface BranchScopeStore {
  branchScope: AdminBranchScope;
  setBranchScope: (scope: AdminBranchScope) => void;
}

const useBranchScopeStore = create<BranchScopeStore>((set) => ({
  branchScope: initialScope(),
  setBranchScope: (branchScope) => {
    if (typeof window !== "undefined" && typeof window.localStorage?.setItem === "function") {
      try {
        window.localStorage.setItem(STORAGE_KEY, branchScope);
      } catch {
        // The selector still works in memory when storage is blocked or unavailable.
      }
    }
    set({ branchScope });
  },
}));

function normalizeBranch(row: any): Branch {
  return {
    id: String(row?.id ?? ""),
    code: row?.code === "pozos" ? "pozos" : "villa-magna",
    name: String(row?.name ?? (row?.code === "pozos" ? "Pozos" : "Villa Magna")),
    address: row?.address == null ? null : String(row.address),
    is_active: Boolean(row?.is_active ?? row?.isActive ?? true),
    is_public: Boolean(row?.is_public ?? row?.isPublic ?? true),
    sort_order: Number(row?.sort_order ?? row?.sortOrder ?? 0),
  };
}

export function useAdminBranches() {
  return useQuery<{ data: Branch[] }>({
    queryKey: ["admin-branches"],
    queryFn: async () => {
      const response = await api.get("/branches");
      const rows = Array.isArray(response.data?.data)
        ? response.data.data
        : Array.isArray(response.data)
          ? response.data
          : [];
      return {
        data: rows
          .map(normalizeBranch)
          .filter((branch: Branch) => branch.id && branch.is_active)
          .sort((a: Branch, b: Branch) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useAdminBranchScope() {
  const branchScope = useBranchScopeStore((state) => state.branchScope);
  const setBranchScope = useBranchScopeStore((state) => state.setBranchScope);
  const branchesQuery = useAdminBranches();
  const branches = branchesQuery.data?.data ?? [];
  const selectedBranch = branches.find((branch) => branch.id === branchScope) ?? null;

  useEffect(() => {
    if (!branchesQuery.isSuccess || branchScope === ALL_BRANCHES) return;
    if (!branches.some((branch) => branch.id === branchScope)) {
      setBranchScope(ALL_BRANCHES);
    }
  }, [branchScope, branches, branchesQuery.isSuccess, setBranchScope]);

  return {
    branchScope,
    setBranchScope,
    branches,
    selectedBranch,
    isAllBranches: branchScope === ALL_BRANCHES,
    branchId: branchScope === ALL_BRANCHES ? null : branchScope,
    isLoading: branchesQuery.isLoading,
    isError: branchesQuery.isError,
  };
}

export function branchQueryParams(branchScope: AdminBranchScope) {
  return branchScope === ALL_BRANCHES ? { all_branches: true } : { branch_id: branchScope };
}

interface BranchSelectorProps {
  allowAll?: boolean;
  className?: string;
  compact?: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
  ariaLabel?: string;
}

export function BranchSelector({
  allowAll = true,
  className,
  compact = false,
  value,
  onValueChange,
  ariaLabel = "Filtrar por sucursal",
}: BranchSelectorProps) {
  const scope = useAdminBranchScope();
  const selectedValue = value ?? scope.branchScope;
  const setValue = onValueChange ?? scope.setBranchScope;

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      {!compact && <Building2 size={15} className="shrink-0 text-valiance-mauve" aria-hidden="true" />}
      <Select
        value={selectedValue || undefined}
        onValueChange={setValue}
        disabled={scope.isLoading || scope.isError}
      >
        <SelectTrigger
          className={cn(
            "h-9 border-valiance-blush bg-valiance-nude text-valiance-charcoal focus:ring-valiance-mauve",
            compact ? "w-[142px]" : "w-[176px]",
          )}
          aria-label={ariaLabel}
        >
          <SelectValue placeholder={scope.isError ? "Sin sucursales" : "Sucursal"} />
        </SelectTrigger>
        <SelectContent>
          {allowAll && <SelectItem value={ALL_BRANCHES}>Todas las sucursales</SelectItem>}
          {scope.branches.map((branch) => (
            <SelectItem key={branch.id} value={branch.id}>
              {branch.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function BranchRequiredNotice({ action = "continuar" }: { action?: string }) {
  return (
    <p className="rounded-xl border border-[#E5CF9F] bg-[#F4EAD6]/70 px-3 py-2 text-xs text-[#6B4F2F]" role="status">
      Selecciona Villa Magna o Pozos para {action}. Las acciones no se ejecutan sobre todas las sucursales.
    </p>
  );
}

export function branchNameFromRow(row: any, branches: Branch[]) {
  const direct = row?.branchName ?? row?.branch_name;
  if (direct) return String(direct);
  const id = row?.branchId ?? row?.branch_id;
  return branches.find((branch) => branch.id === id)?.name ?? "Sucursal sin asignar";
}
