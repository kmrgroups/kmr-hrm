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
  | "payslip_ready"
  | "application_received"
  | "interview_invite"
  | "interview_panel"
  | "interview_reminder"
  | "interview_update"
  | "recruit_regret"
  | "offer_letter"
  | "offer_response"
  | "training_invite"
  | "training_reminder"
  | "effectiveness_due"
  | "rr_published"
  | "announcement"
  | "survey_invite"
  | "survey_reminder"
  | "recognition_received"
  | "suggestion_update"
  | "policy_published"
  | "compliance_digest";

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
  application_received: "Application received (to candidate)",
  interview_invite: "Shortlisted — interview details (to candidate)",
  interview_panel: "Interview scheduled (to panel, with calendar invite)",
  interview_reminder: "Interview reminder (to candidate)",
  interview_update: "Candidate confirmed / asked to reschedule (to HR)",
  recruit_regret: "Not selected — courteous regret (to candidate)",
  offer_letter: "Offer letter with accept / decline link (to candidate)",
  offer_response: "Offer accepted / declined (to HR)",
  training_invite: "Training invitation (to employee)",
  training_reminder: "Training reminder, the day before (to employee)",
  effectiveness_due: "Training effectiveness to evaluate (to supervisor)",
  rr_published: "Roles & responsibilities to acknowledge (to employee)",
  announcement: "Announcement (to employees)",
  survey_invite: "Survey invitation (to employees)",
  survey_reminder: "Survey reminder, 2 days before it closes (to those who have not answered)",
  recognition_received: "Recognition received (to employee)",
  suggestion_update: "Your suggestion: decision / implemented (to employee)",
  policy_published: "Policy to read and acknowledge (to employees)",
  compliance_digest: "Compliance due / overdue and documents due for review (to HR)",
};

/** Events sent by email only until their WhatsApp templates are approved by Meta */
export const EMAIL_ONLY_EVENTS: NotificationEvent[] = ["leave_applied", "leave_decided", "regularisation_applied", "regularisation_decided", "login_code", "payslip_ready",
  "application_received", "interview_panel", "interview_update", "recruit_regret", "offer_response",
  "effectiveness_due", "rr_published", "survey_reminder", "recognition_received", "suggestion_update", "compliance_digest"];

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
  application_received: {
    subject: "We have received your application — {{role}}, {{company}}",
    email: `Dear {{name}},

Thank you for applying for {{role}} at {{company}}. We have received your resume and our team will review it.

If your profile matches the role, we will contact you on this e-mail or your mobile with the next steps.

Talent team, {{company}}`,
    whatsapp: `Dear {{name}}, thank you for applying for {{role}} at {{company}}. We have received your resume and will contact you if your profile matches.`,
    wa_template: "hrm_application_received",
    wa_params: ["name", "role", "company"],
  },
  interview_invite: {
    subject: "Interview for {{role}} — {{when}} — {{company}}",
    email: `Dear {{name}},

Thank you for your interest in {{role}} at {{company}}. We are pleased to invite you for an interview.

Round: {{round}}
Date and time: {{when}} ({{duration}} minutes)
Mode: {{mode}}
{{where}}

Please bring: {{bring}}

Please confirm that you can attend, or ask for another time, using the button below.

[[Confirm or reschedule|{{link}}]]

We look forward to meeting you.

Talent team, {{company}}`,
    whatsapp: `Dear {{name}}, you are shortlisted for {{role}} at {{company}}. Interview: {{when}}, {{mode}}. {{where}}. Please bring: {{bring}}.

[[Confirm or reschedule|{{link}}]]`,
    wa_template: "hrm_interview_invite",
    wa_params: ["name", "role", "company", "when", "mode", "where", "bring", "link"],
  },
  interview_panel: {
    subject: "Interview panel: {{candidate}} for {{role}} — {{when}}",
    email: `Dear {{name}},

You are on the interview panel for {{candidate}} ({{role}}).

Round: {{round}}
Date and time: {{when}} ({{duration}} minutes)
Mode: {{mode}}
{{where}}

The calendar invite is attached. After the interview, please fill in your scorecard in the HR portal.

[[Open the interview|{{link}}]]

HR, {{company}}`,
    whatsapp: `You are on the interview panel for {{candidate}} ({{role}}) on {{when}}. Scorecard: {{link}}`,
    wa_template: "hrm_interview_panel",
    wa_params: ["candidate", "role", "when", "link"],
  },
  interview_reminder: {
    subject: "Reminder: your interview {{day}} — {{company}}",
    email: `Dear {{name}},

This is a reminder of your interview for {{role}} at {{company}} {{day}}, {{when}}.

Mode: {{mode}}
{{where}}

[[Confirm or reschedule|{{link}}]]

Talent team, {{company}}`,
    whatsapp: `Reminder: your interview for {{role}} at {{company}} is {{day}}, {{when}}. {{where}}

[[Confirm or reschedule|{{link}}]]`,
    wa_template: "hrm_interview_reminder",
    wa_params: ["role", "company", "day", "when", "where", "link"],
  },
  interview_update: {
    subject: "{{candidate}} {{update}} — interview for {{role}}",
    email: `{{candidate}} {{update}} for the interview on {{when}} ({{role}}).

{{note}}

[[Open the candidate|{{link}}]]`,
    whatsapp: `{{candidate}} {{update}} for the interview on {{when}} ({{role}}). {{note}}`,
    wa_template: "hrm_interview_update",
    wa_params: ["candidate", "update", "when", "role", "note"],
  },
  recruit_regret: {
    subject: "Your application for {{role}} — {{company}}",
    email: `Dear {{name}},

Thank you for your interest in {{role}} at {{company}} and for the time you gave us.

After careful consideration, we will not be taking your application further at this time. This was not an easy decision, and it is not a judgement of your abilities. We will keep your profile and may contact you about other suitable openings.

We wish you every success.

Talent team, {{company}}`,
    whatsapp: `Dear {{name}}, thank you for applying for {{role}} at {{company}}. We will not be taking your application further this time, and we wish you every success.`,
    wa_template: "hrm_recruit_regret",
    wa_params: ["name", "role", "company"],
  },
  offer_letter: {
    subject: "Offer of employment — {{role}}, {{company}}",
    email: `Dear {{name}},

Congratulations! We are pleased to offer you the position of {{role}} at {{company}}.

Annual CTC: {{ctc}}
Date of joining: {{doj}}
This offer is valid until {{valid_until}}.

Your offer letter is attached. Please read it and accept or decline using the button below. When you accept, you will receive a link to complete your joining formalities online.

[[View and respond to the offer|{{link}}]]

We look forward to welcoming you.

HR, {{company}}`,
    whatsapp: `Congratulations {{name}}! {{company}} offers you {{role}} with an annual CTC of {{ctc}}, joining on {{doj}}. Please accept or decline by {{valid_until}}.

[[View and respond|{{link}}]]`,
    wa_template: "hrm_offer_letter",
    wa_params: ["name", "company", "role", "ctc", "doj", "valid_until", "link"],
  },
  offer_response: {
    subject: "Offer {{response}}: {{candidate}} — {{role}}",
    email: `{{candidate}} has {{response}} the offer for {{role}} ({{ctc}}).

{{note}}

[[Open the offer|{{link}}]]`,
    whatsapp: `{{candidate}} has {{response}} the offer for {{role}}. {{note}}`,
    wa_template: "hrm_offer_response",
    wa_params: ["candidate", "response", "role", "note"],
  },
  training_invite: {
    subject: "Training: {{training}} — {{when}}",
    email: `Dear {{name}},

You are nominated for the training "{{training}}".

When: {{when}}
Where: {{venue}}
Trainer: {{trainer}}

Please be on time. Your attendance is recorded by scanning your ID card, so please bring it.

HR, {{company}}`,
    whatsapp: `{{company}}: you are nominated for the training "{{training}}" on {{when}} at {{venue}}. Please bring your ID card.`,
    wa_template: "hrm_training_invite",
    wa_params: ["company", "training", "when", "venue"],
  },
  training_reminder: {
    subject: "Reminder: training tomorrow — {{training}}",
    email: `Dear {{name}},

A reminder of your training "{{training}}" tomorrow, {{when}}, at {{venue}}.

Please bring your ID card.

HR, {{company}}`,
    whatsapp: `Reminder from {{company}}: training "{{training}}" tomorrow, {{when}}, at {{venue}}. Please bring your ID card.`,
    wa_template: "hrm_training_reminder",
    wa_params: ["company", "training", "when", "venue"],
  },
  effectiveness_due: {
    subject: "Training effectiveness to evaluate: {{count}} of your team",
    email: `Dear {{name}},

The training below was some weeks ago. Please check on the job whether it worked, and record the result:

{{list}}

[[Evaluate now|{{link}}]]

If a training did not work, the HRM schedules the training again automatically.

HR, {{company}}`,
    whatsapp: `{{count}} training evaluations are due for your team. {{link}}`,
    wa_template: "hrm_effectiveness_due",
    wa_params: ["count", "link"],
  },
  rr_published: {
    subject: "Your roles and responsibilities — please read and acknowledge",
    email: `Dear {{name}},

Your roles and responsibilities as {{designation}} (version {{version}}) are published. Please read them and acknowledge in your portal.

[[Read and acknowledge|{{link}}]]

HR, {{company}}`,
    whatsapp: `Your roles and responsibilities as {{designation}} are published. Please read and acknowledge: {{link}}`,
    wa_template: "hrm_rr_published",
    wa_params: ["designation", "link"],
  },
  announcement: {
    subject: "{{title}}",
    email: `Dear {{name}},

{{body}}

[[Open in your portal|{{link}}]]

{{company}}`,
    whatsapp: `{{company}} — {{title}}. Read it in your portal: {{link}}`,
    wa_template: "hrm_announcement",
    wa_params: ["company", "title", "link"],
  },
  survey_invite: {
    subject: "Your opinion please: {{survey}}",
    email: `Dear {{name}},

We would like your honest opinion: "{{survey}}". It takes a few minutes{{until}}.

{{privacy}}

[[Answer the survey|{{link}}]]

HR, {{company}}`,
    whatsapp: `{{company}}: please answer the survey "{{survey}}" — a few minutes{{until}}. {{link}}`,
    wa_template: "hrm_survey_invite",
    wa_params: ["company", "survey", "until", "link"],
  },
  survey_reminder: {
    subject: "Reminder: {{survey}} closes on {{closes_on}}",
    email: `Dear {{name}},

The survey "{{survey}}" closes on {{closes_on}}. If you have not answered yet, it takes only a few minutes.

{{privacy}}

[[Answer the survey|{{link}}]]

HR, {{company}}`,
    whatsapp: `Reminder: the survey "{{survey}}" closes on {{closes_on}}. {{link}}`,
    wa_template: "hrm_survey_reminder",
    wa_params: ["survey", "closes_on", "link"],
  },
  recognition_received: {
    subject: "Well done, {{name}}! {{category}} recognition",
    email: `Dear {{name}},

{{giver}} has recognised you for {{category}}:

"{{message}}"

Thank you for your good work. It is on the recognition wall in your portal.

[[See it in your portal|{{link}}]]

{{company}}`,
    whatsapp: `Well done! {{giver}} recognised you for {{category}}: "{{message}}" — {{company}}`,
    wa_template: "hrm_recognition",
    wa_params: ["giver", "category", "message", "company"],
  },
  policy_published: {
    subject: "Please read: {{title}} ({{revision}})",
    email: `Dear {{name}},

{{company}} has published "{{title}}" ({{revision}}), effective {{effective}}.

{{change}}

Please read it and acknowledge in your portal.

[[Read and acknowledge|{{link}}]]

HR, {{company}}`,
    whatsapp: `{{company}}: please read and acknowledge the policy "{{title}}" in your portal: {{link}}`,
    wa_template: "hrm_policy_published",
    wa_params: ["company", "title", "link"],
  },
  compliance_digest: {
    subject: "Compliance: {{headline}}",
    email: `Dear {{name}},

{{list}}

[[Open the compliance register|{{link}}]]

KMR HRM — {{company}}`,
    whatsapp: `Compliance: {{headline}}. {{link}}`,
    wa_template: "hrm_compliance_digest",
    wa_params: ["headline", "link"],
  },
  suggestion_update: {
    subject: "Your suggestion {{ref}}: {{status}}",
    email: `Dear {{name}},

Your suggestion "{{title}}" ({{ref}}) is now: {{status}}.

{{note}}

Thank you for helping us improve. Keep the ideas coming!

[[See your suggestions|{{link}}]]

{{company}}`,
    whatsapp: `Your suggestion "{{title}}" is now: {{status}}. {{note}}`,
    wa_template: "hrm_suggestion_update",
    wa_params: ["title", "status", "note"],
  },
};
