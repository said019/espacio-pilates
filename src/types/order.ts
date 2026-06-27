export type OrderStatus =
  | "pending_payment"
  | "pending_verification"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";

export interface Order {
  id: string;
  user_id: string;
  plan_id: string;
  plan_name: string;
  amount?: number;
  total_amount?: number;
  subtotal?: number;
  currency: string;
  status: OrderStatus;
  payment_method: string;
  bank_clabe?: string;
  bank_name?: string;
  bank_account_holder?: string;
  proof_url?: string;
  admin_notes?: string;
  rejection_reason?: string;
  payment_provider?: string | null;
  mp_checkout_url?: string | null;
  mp_payment_id?: string | null;
  mp_payment_status?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateOrderRequest {
  planId: string;
  discountCode?: string;
  paymentMethod: "transfer" | "cash" | "card";
}
