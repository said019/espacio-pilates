export interface BookingClient {
  id: string;
  class_id: string;
  class_type_name: string;
  class_category?: string;
  instructor_name: string;
  start_time: string;
  end_time: string;
  status: "confirmed" | "waitlist" | "checked_in" | "no_show" | "cancelled";
  booked_at: string;
  has_review?: boolean;
  waitlist_position?: number | null;
}
