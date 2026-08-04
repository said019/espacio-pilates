import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

export interface CancellationConfig {
  enabled: boolean;
  min_hours: number;
  reschedule_hours: number;
  refund_credit_on_cancel: boolean;
  cancellations_limit: number;
  late_cancel_message: string;
}

export function useCancellationConfig(): CancellationConfig {
  const { data } = useQuery({
    queryKey: ["public-settings", "cancellation_settings"],
    queryFn: async () => (await api.get("/public/settings/cancellation_settings")).data,
    staleTime: 5 * 60 * 1000,
  });
  const raw = data?.data ?? data?.value ?? {};

  return {
    enabled: raw.enabled !== false,
    min_hours: Number(raw.min_hours ?? 12),
    reschedule_hours: Number(raw.reschedule_hours ?? 8),
    refund_credit_on_cancel: raw.refund_credit_on_cancel !== false,
    cancellations_limit: Number(raw.cancellations_limit ?? 2),
    late_cancel_message: String(raw.late_cancel_message ?? ""),
  };
}
