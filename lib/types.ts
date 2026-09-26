export type Role =
  | "platform_admin"
  | "company_admin"
  | "hr_manager"
  | "hr_executive"
  | "payroll"
  | "manager"
  | "interviewer"
  | "employee";

export const ROLE_LABELS: Record<Role, string> = {
  platform_admin: "Platform Admin",
  company_admin: "Company Admin",
  hr_manager: "HR Manager",
  hr_executive: "HR Executive",
  payroll: "Payroll / Accounts",
  manager: "Reporting Manager",
  interviewer: "Interviewer",
  employee: "Employee",
};

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  logo_path: string | null;
  primary_color: string;
  accent_color: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  emp_code_prefix: string;
  settings: TenantSettings;
}

export interface TenantSettings {
  email_from?: string;          // verified sender on the tenant's own domain
  email_reply_to?: string;
  hr_notify_email?: string;     // where "onboarding submitted" alerts go
  hr_notify_phone?: string;
  id_card_validity_years?: number;
  id_card_signatory?: string;
  onboarding_link_days?: number;
}

export interface AppUser {
  id: string;
  tenant_id: string;
  role: Role;
  full_name: string;
  email: string;
  phone: string | null;
  employee_id: string | null;
  must_change_password: boolean;
  active: boolean;
}

export type EmployeeStatus =
  | "invited" | "onboarding" | "submitted" | "sent_back" | "active" | "inactive" | "exited";

export const STATUS_LABELS: Record<EmployeeStatus, string> = {
  invited: "Link sent",
  onboarding: "Filling form",
  submitted: "Awaiting review",
  sent_back: "Sent back",
  active: "Active",
  inactive: "Inactive",
  exited: "Exited",
};

export interface Employee {
  id: string;
  tenant_id: string;
  employee_code: string | null;
  status: EmployeeStatus;
  first_name: string;
  last_name: string | null;
  email: string | null;
  mobile: string | null;
  plant_id: string | null;
  department_id: string | null;
  designation_id: string | null;
  reporting_manager_id: string | null;
  employment_type: string;
  category: string;
  date_of_joining: string | null;
  date_of_birth: string | null;
  gender: string | null;
  blood_group: string | null;
  photo_path: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  profile: OnboardingProfile;
  verify_token: string;
  created_at: string;
}

/** Sections filled by the employee during self-onboarding, stored in employees.profile */
export interface OnboardingProfile {
  personal?: {
    first_name?: string; last_name?: string; date_of_birth?: string; gender?: string;
    marital_status?: string; blood_group?: string; nationality?: string;
    personal_email?: string; mobile?: string; father_name?: string;
    permanent_address?: string; present_address?: string;
    emergency_contacts?: { name: string; relation: string; phone: string }[];
  };
  family?: {
    members?: { name: string; relation: string; date_of_birth?: string; occupation?: string }[];
    nominees?: { name: string; relation: string; share: number; for: string }[];
  };
  academic?: {
    education?: { qualification: string; institute: string; year: string; score?: string }[];
    certifications?: string;
  };
  professional?: {
    total_experience_years?: string;
    employers?: { company: string; designation: string; from: string; to: string; last_ctc?: string; reason?: string }[];
    references?: { name: string; company: string; designation?: string; phone: string; email?: string }[];
  };
}

export const ONBOARDING_SECTIONS = [
  { key: "personal", label: "Personal" },
  { key: "family", label: "Family & nominees" },
  { key: "academic", label: "Education" },
  { key: "professional", label: "Experience & references" },
  { key: "statutory", label: "Bank & statutory" },
  { key: "documents", label: "Documents" },
  { key: "selfie", label: "Selfie & consent" },
] as const;
export type SectionKey = (typeof ONBOARDING_SECTIONS)[number]["key"];

export const DOCUMENT_TYPES: { key: string; label: string; required: boolean }[] = [
  { key: "aadhaar", label: "Aadhaar card", required: true },
  { key: "pan", label: "PAN card", required: true },
  { key: "cheque", label: "Cancelled cheque / passbook", required: true },
  { key: "qualification", label: "Qualification certificates", required: true },
  { key: "relieving", label: "Relieving letter (previous employer)", required: false },
  { key: "experience", label: "Experience letters", required: false },
  { key: "payslip", label: "Last 3 payslips", required: false },
  { key: "photo", label: "Passport-size photo", required: false },
  { key: "other", label: "Other", required: false },
];
