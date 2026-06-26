export interface BookingClient {
  id: string;
  class_id: string;
  class_type_name: string;
  instructor_name: string;
  start_time: string;
  end_time: string;
  status: "confirmed" | "waitlist" | "checked_in" | "no_show" | "cancelled";
  booked_at: string;
  has_review?: boolean;
}
