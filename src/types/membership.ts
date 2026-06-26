export interface ClientMembership {
  id: string;
  planId: string;
  planName: string;
  status: "active" | "expired" | "pending_payment" | "pending_activation" | "cancelled";
  startDate: string;
  endDate: string;
  classesRemaining: number | null;
  classLimit: number | null;
  paymentMethod?: string;
  // snake_case aliases kept for backwards compat
  plan_id?: string;
  plan_name?: string;
  start_date?: string;
  end_date?: string;
  classes_remaining?: number | null;
  class_limit?: number | null;
}
