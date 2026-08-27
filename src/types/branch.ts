export type BranchCode = "villa-magna" | "pozos";
export type StudioProgram = "pilates" | "functional" | "prenatal";

export interface Branch {
  id: string;
  code: BranchCode;
  name: string;
  address: string | null;
  phone?: string | null;
  timezone?: string;
  // Admin normalizes branches to snake_case; public endpoints also expose
  // camelCase aliases while the migration rolls out.
  is_active: boolean;
  is_public?: boolean;
  sort_order: number;
  isActive?: boolean;
  sortOrder?: number;
}

export const DEFAULT_BRANCH_CODE: BranchCode = "villa-magna";
