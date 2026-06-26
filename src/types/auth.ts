export interface User {
  id: string;
  email: string;
  phone: string;
  displayName: string;
  display_name?: string;
  full_name?: string;
  gender?: "female" | "male" | "other" | null;
  photoUrl: string | null;
  photo_url?: string | null;
  avatar_url?: string | null;
  role: "client" | "instructor" | "admin" | "super_admin" | "reception" | "coach";
  emergencyContactName: string | null;
  emergency_contact_name?: string | null;
  emergencyContactPhone: string | null;
  emergency_contact_phone?: string | null;
  healthNotes: string | null;
  health_notes?: string | null;
  acceptsCommunications?: boolean;
  accepts_communications?: boolean;
  dateOfBirth: string | null;
  date_of_birth?: string | null;
  receiveReminders: boolean;
  receive_reminders?: boolean;
  receivePromotions: boolean;
  receive_promotions?: boolean;
  receiveWeeklySummary: boolean;
  receive_weekly_summary?: boolean;
  createdAt: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
  is_instructor?: boolean;
  instructor_id?: string;
  coach_number?: string;
}

export interface AuthResponse {
  message: string;
  user: User;
  token: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  displayName: string;
  phone: string;
  gender?: "female" | "male" | "other";
  acceptsTerms: boolean;
  acceptsCommunications: boolean;
}

export interface UpdateProfileData {
  displayName?: string;
  phone?: string;
  dateOfBirth?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  healthNotes?: string;
  receiveReminders?: boolean;
  receivePromotions?: boolean;
  receiveWeeklySummary?: boolean;
}
