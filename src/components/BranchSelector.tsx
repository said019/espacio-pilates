import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranch, type BranchOption } from "@/hooks/useBranch";

interface BranchSelectorProps {
  className?: string;
  compact?: boolean;
  inverse?: boolean;
  label?: string;
  onChange?: (branch: BranchOption) => void;
}

export function BranchSelector({
  className,
  compact = false,
  inverse = false,
  label = "Sucursal",
  onChange,
}: BranchSelectorProps) {
  const { branchCode, branches, setBranchCode } = useBranch();

  return (
    <div className={cn("space-y-2", className)}>
      {!compact && (
        <div className={cn(
          "flex items-center gap-2 text-[0.68rem] font-medium uppercase tracking-[0.16em]",
          inverse ? "text-valiance-nude/70" : "text-valiance-mauve",
        )}>
          <MapPin size={13} strokeWidth={1.8} />
          {label}
        </div>
      )}
      <div
        role="group"
        aria-label={label}
        className={cn(
          "grid grid-cols-2 gap-1 rounded-xl border p-1",
          compact ? "min-w-[166px]" : "w-full",
          inverse
            ? "border-valiance-nude/20 bg-valiance-charcoal/25"
            : "border-valiance-blush/60 bg-valiance-blush/20",
        )}
      >
        {branches.map((branch) => {
          const selected = branch.code === branchCode;
          return (
            <button
              key={branch.code}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setBranchCode(branch.code);
                onChange?.(branch);
              }}
              className={cn(
                "whitespace-nowrap rounded-lg px-2.5 py-2 text-xs font-medium transition-colors active:scale-[0.98]",
                selected
                  ? inverse
                    ? "bg-valiance-nude text-valiance-charcoal shadow-sm"
                    : "bg-valiance-charcoal text-valiance-nude shadow-sm"
                  : inverse
                    ? "text-valiance-nude/70 hover:bg-valiance-nude/10 hover:text-valiance-nude"
                    : "text-valiance-charcoal/60 hover:bg-valiance-nude/70 hover:text-valiance-charcoal",
              )}
            >
              {branch.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default BranchSelector;
