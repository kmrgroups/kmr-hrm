// Default message templates. A company can override any of them in
// Settings -> Notifications (stored in notification_templates).
//
// Syntax:
//   {{variable}}          replaced with a value
//   [[Button label|url]]  becomes a button in email; plain "Label: url" in WhatsApp text
//
// WhatsApp business-initiated messages must use templates pre-approved by Meta.
// `wa_template` is the name to register, `wa_params` the order of {{1}}, {{2}}...
// The exact text to submit to Meta is in docs/whatsapp-templates.md.

export type NotificationEvent =
  | "onboarding_invite"
  | "onboarding_reminder"
  | "onboarding_submitted"
  | "onboarding_sent_back"
  | "onboarding_approved"
  | "user_invited"
  | "id_card_issued"
  | "leave_applied"
  | "leave_decided"
  | "regularisation_applied"
  | "regularisation_decided"
  | "login_code"
  | "payslip_ready";

export interface MessageTemplate {
  subject: string;
  email: string;
  whatsapp: string;
  wa_template: string;
  wa_params: string[];
}

export const EVENT_LABELS: Record<NotificationEvent, string> = {
  onboarding_invite: "Self-onboarding link to new joiner",
  onboarding_reminder: "Reminder: onboarding form incomplete",
  onboarding_submitted: "Onboarding submitted (to HR)",
  onboarding_sent_back: "Onboarding sent back for correction",
  onboarding_approved: "Welcome + login details after approval",
  user_invited: "Staff user account created",
  id_card_issued: "ID card issued",
  leave_applied: "Leave request (to approver)",
  leave_decided: "Leave approved / rejected (to employee)",
  regularisation_applied: "Attendance correction request (to approver)",
  regularisation_decided: "Attendance correction approved / rejected (to employee)",
  login_code: "Sign-in code",
  payslip_ready: "Payslip for the month (with PDF)",
};

/** Events sent by email only until their WhatsApp templates are approved by Meta */
export const EMAIL_ONLY_EVENTS: NotificationEvent[] = ["leave_applied", "leave_decided", "regularisation_applied", "regularisation_decided", "login_code", "payslip_ready"];

export const DEFAULT_TEMPLATES: Record<NotificationEvent, MessageTemplate> = {
  onboarding_invite: {
    subject: "Welcome to {{company}} — complete your joining formalities",
    email: `Dear {{name}},

Welcome to {{company}}! We are delighted to have you join us as {{designation}}.

To make your first day smooth, please complete your joining details online. It takes about 15 minutes and works on your phone. Please keep these ready: Aadhaar, PAN, a cancelled cheque or bank passbook, education certificates and your previous employer's relieving letter.

[[Start onboarding|{{link}}]]

This secure link is personal to you and is valid until {{expires_on}}.

Warm regards,
{{hr_name}}
Human Resources, {{company}}`,
    whatsapp: `Dear {{name}}, welcome to {{company}}! Please complete your joining details online (about 15 minutes, works on your phone). Keep Aadhaar, PAN, cancelled cheque and certificates ready.

[[Start onboarding|{{link}}]]

Link valid until {{expires_on}}. — HR, {{company}}`,
    wa_template: "hrm_onboarding_invite",
    wa_params: ["name", "company", "link", "expires_on"],
  },

  onboarding_reminder: {
    subject: "Reminder: your joining details for {{company}} are pending",
    email: `Dear {{name}},

This is a gentle reminder that your joining details for {{company}} are not complete yet. You can continue from where you left off.

[[Continue onboarding|{{link}}]]

The link is valid until {{expires_on}}. If you need help, simply reply to this email.

Regards,
Human Resources, {{company}}`,
    whatsapp: `Dear {{name}}, your joining details for {{company}} are still pending. Continue from where you left off:

[[Continue onboarding|{{link}}]]

Valid until {{expires_on}}.`,
    wa_template: "hrm_onboarding_reminder",
    wa_params: ["name", "company", "link", "expires_on"],
  },

  onboarding_submitted: {
    subject: "Onboarding submitted: {{employee_name}} ({{designation}})",
    email: `Hello,

{{employee_name}} has submitted the self-onboarding form for the position of {{designation}}, {{department}}.

Documents uploaded: {{document_count}}

[[Review and approve|{{link}}]]

— HRM Suite`,
    whatsapp: `{{employee_name}} ({{designation}}) has submitted the onboarding form. Review and approve:

[[Review|{{link}}]]`,
    wa_template: "hrm_onboarding_submitted",
    wa_params: ["employee_name", "designation", "link"],
  },

  onboarding_sent_back: {
    subject: "Action needed: please update your joining details",
    email: `Dear {{name}},

Thank you for submitting your details. Our HR team needs a few corrections before we can complete your onboarding.

Sections to update: {{sections}}
Comment from HR: {{comment}}

[[Update my details|{{link}}]]

Regards,
Human Resources, {{company}}`,
    whatsapp: `Dear {{name}}, HR needs a few corrections to your joining details.
Sections: {{sections}}
Comment: {{comment}}

[[Update details|{{link}}]]`,
    wa_template: "hrm_onboarding_sent_back",
    wa_params: ["name", "sections", "comment", "link"],
  },

  onboarding_approved: {
    subject: "Welcome aboard, {{name}} — your employee ID {{employee_code}}",
    email: `Dear {{name}},

Your onboarding is complete. Welcome to the {{company}} family!

Employee ID: {{employee_code}}
Portal: {{login_url}}
Username: {{username}}
Temporary password: {{temp_password}}

Please sign in and set your own password. You can also turn on Face ID or fingerprint login from your phone for quicker access. Your digital ID card is available in the portal.

[[Sign in to the employee portal|{{login_url}}]]

Warm regards,
Human Resources, {{company}}`,
    whatsapp: `Welcome to {{company}}, {{name}}! Your employee ID is {{employee_code}}.
Portal: {{login_url}}
Username: {{username}}
Temporary password: {{temp_password}}
Please sign in and change your password.`,
    wa_template: "hrm_onboarding_approved",
    wa_params: ["company", "name", "employee_code", "login_url", "username", "temp_password"],
  },

  user_invited: {
    subject: "Your {{company}} HR portal account",
    email: `Dear {{name}},

An account has been created for you on the {{company}} HR portal with the role {{role}}.

Portal: {{login_url}}
Username: {{username}}
Temporary password: {{temp_password}}

[[Sign in|{{login_url}}]]

Please change your password after the first sign-in.`,
    whatsapp: `Dear {{name}}, your {{company}} HR portal account ({{role}}) is ready.
Portal: {{login_url}}
Username: {{username}}
Temporary password: {{temp_password}}`,
    wa_template: "hrm_user_invited",
    wa_params: ["name", "company", "role", "login_url", "username", "temp_password"],
  },

  id_card_issued: {
    subject: "Your {{company}} ID card is ready",
    email: `Dear {{name}},

Your employee ID card ({{employee_code}}) has been issued. You can view and download the digital card from the employee portal. Please collect the printed card from HR.

[[View my ID card|{{link}}]]

Regards,
Human Resources, {{company}}`,
    whatsapp: `Dear {{name}}, your {{company}} ID card ({{employee_code}}) is ready. View it here:

[[My ID card|{{link}}]]`,
    wa_template: "hrm_id_card_issued",
    wa_params: ["name", "company", "employee_code", "link"],
  },

  leave_applied: {
    subject: "Leave request from {{employee}} — {{leave_type}}, {{dates}}",
    email: `Dear {{name}},

{{employee}} ({{employee_code}}) has applied for {{leave_type}}:

Dates: {{dates}} ({{days}} day(s))
Reason: {{reason}}
Balance before this request: {{balance}}

[[Review request|{{link}}]]

Regards,
{{company}} HR portal`,
    whatsapp: `{{employee}} has applied for {{leave_type}} on {{dates}} ({{days}} day(s)). Reason: {{reason}}

[[Review|{{link}}]]`,
    wa_template: "hrm_leave_applied",
    wa_params: ["employee", "leave_type", "dates", "days", "reason", "link"],
  },

  leave_decided: {
    subject: "Your {{leave_type}} for {{dates}} was {{decision}}",
    email: `Dear {{name}},

Your {{leave_type}} request for {{dates}} ({{days}} day(s)) was {{decision}} by {{approver}}.
{{comment}}

[[View my leave|{{link}}]]

Regards,
Human Resources, {{company}}`,
    whatsapp: `Dear {{name}}, your {{leave_type}} for {{dates}} was {{decision}} by {{approver}}. {{comment}}

[[My leave|{{link}}]]`,
    wa_template: "hrm_leave_decided",
    wa_params: ["name", "leave_type", "dates", "decision", "approver", "comment", "link"],
  },

  regularisation_applied: {
    subject: "Attendance correction from {{employee}} for {{date}}",
    email: `Dear {{name}},

{{employee}} ({{employee_code}}) has asked to correct attendance for {{date}}:

In: {{in_time}}   Out: {{out_time}}
Reason: {{reason}}

[[Review request|{{link}}]]

Regards,
{{company}} HR portal`,
    whatsapp: `{{employee}} asked to correct attendance for {{date}} (in {{in_time}}, out {{out_time}}). Reason: {{reason}}

[[Review|{{link}}]]`,
    wa_template: "hrm_regularisation_applied",
    wa_params: ["employee", "date", "in_time", "out_time", "reason", "link"],
  },

  regularisation_decided: {
    subject: "Attendance correction for {{date}} was {{decision}}",
    email: `Dear {{name}},

Your attendance correction for {{date}} was {{decision}} by {{approver}}.
{{comment}}

[[View my attendance|{{link}}]]

Regards,
Human Resources, {{company}}`,
    whatsapp: `Dear {{name}}, your attendance correction for {{date}} was {{decision}} by {{approver}}. {{comment}}

[[My attendance|{{link}}]]`,
    wa_template: "hrm_regularisation_decided",
    wa_params: ["name", "date", "decision", "approver", "comment", "link"],
  },

  login_code: {
    subject: "{{otp}} is your {{company}} sign-in code",
    email: `Dear {{name}},

Your code to sign in to the {{company}} HR portal is:

{{otp}}

Enter it on the sign-in screen. It works once and expires in {{minutes}} minutes.

If you did not ask for this code, you can ignore this email — your account stays safe.

Human Resources, {{company}}`,
    whatsapp: `{{otp}} is your {{company}} HR portal sign-in code. It expires in {{minutes}} minutes. Do not share it with anyone.`,
    wa_template: "hrm_login_code",
    wa_params: ["otp", "company", "minutes"],
  },
  payslip_ready: {
    subject: "Your payslip for {{month}} — {{company}}",
    email: `Dear {{name}},

Your payslip for {{month}} is attached. Net pay: {{net_pay}}.

You can also see and download all your payslips any time in the HR portal.

[[My payslips|{{link}}]]

If anything looks wrong, please reply to this email.

Payroll, {{company}}`,
    whatsapp: `Dear {{name}}, your payslip for {{month}} is ready. Net pay: {{net_pay}}.

[[My payslips|{{link}}]]

— Payroll, {{company}}`,
    wa_template: "hrm_payslip_ready",
    wa_params: ["name", "month", "net_pay", "link"],
  },
};
