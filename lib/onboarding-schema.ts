// Validation for each self-onboarding section. Used by the API (authoritative)
// and mirrored in the browser for instant feedback.
import { z } from "zod";
import {
  BLOOD_GROUPS, isValidAadhaar, isValidAccountNumber, isValidEmail, isValidIfsc, isValidPan,
  isValidUan, normalizeIndianMobile,
} from "@/lib/validators";

const text = (max = 200) => z.string().trim().max(max);
const req = (label: string, max = 200) => z.string().trim().min(1, `${label} is required`).max(max);
const optional = (max = 200) => z.string().trim().max(max).optional().or(z.literal("")).transform((v) => v || undefined);
const date = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a date`);
const mobile = (label: string) =>
  z.string().trim().refine((v) => !!normalizeIndianMobile(v), `${label} must be a valid 10-digit mobile number`)
    .transform((v) => normalizeIndianMobile(v)!);

export const personalSchema = z.object({
  first_name: req("First name", 80),
  last_name: optional(80),
  father_name: optional(120),
  date_of_birth: date("Date of birth").refine((d) => {
    const age = (Date.now() - new Date(d).getTime()) / (365.25 * 864e5);
    return age >= 14 && age <= 80;
  }, "Please check the date of birth"),
  gender: z.enum(["Male", "Female", "Other"], { message: "Select gender" }),
  marital_status: z.enum(["Single", "Married", "Widowed", "Divorced", "Separated"]).optional(),
  blood_group: z.enum(BLOOD_GROUPS, { message: "Select blood group" }),
  nationality: text(60).default("Indian"),
  mobile: mobile("Mobile"),
  personal_email: optional(120).refine((v) => !v || isValidEmail(v), "Enter a valid email"),
  permanent_address: req("Permanent address", 500),
  present_address: req("Present address", 500),
  emergency_contacts: z.array(z.object({
    name: req("Contact name", 120),
    relation: req("Relation", 40),
    phone: mobile("Contact phone"),
  })).min(1, "Add at least one emergency contact").max(3),
});

export const familySchema = z.object({
  members: z.array(z.object({
    name: req("Name", 120), relation: req("Relation", 40),
    date_of_birth: optional(10), occupation: optional(80),
  })).max(12).default([]),
  nominees: z.array(z.object({
    name: req("Nominee name", 120), relation: req("Relation", 40),
    share: z.coerce.number().min(1).max(100),
    for: z.enum(["PF", "Gratuity", "ESI", "All"]),
  })).max(8).default([]),
}).superRefine((v, ctx) => {
  const totals: Record<string, number> = {};
  for (const n of v.nominees) totals[n.for] = (totals[n.for] ?? 0) + n.share;
  for (const [k, total] of Object.entries(totals)) {
    if (Math.round(total) !== 100) ctx.addIssue({ code: "custom", message: `Nominee shares for ${k} must add up to 100% (now ${total}%)`, path: ["nominees"] });
  }
});

export const academicSchema = z.object({
  education: z.array(z.object({
    qualification: req("Qualification", 100), institute: req("Institute / board", 160),
    year: z.string().regex(/^(19|20)\d{2}$/, "Year must be 4 digits"), score: optional(20),
  })).min(1, "Add at least your highest qualification").max(8),
  certifications: optional(1000),
});

export const professionalSchema = z.object({
  total_experience_years: optional(10),
  employers: z.array(z.object({
    company: req("Company", 160), designation: req("Designation", 100),
    from: z.string().regex(/^\d{4}-\d{2}$/, "From must be a month"), to: z.string().regex(/^\d{4}-\d{2}$/, "To must be a month"),
    last_ctc: optional(30), reason: optional(200),
  })).max(10).default([]),
  references: z.array(z.object({
    name: req("Reference name", 120), company: req("Company", 160), designation: optional(100),
    phone: mobile("Reference phone"), email: optional(120),
  })).max(3).default([]),
});

export const statutorySchema = z.object({
  pan: z.string().trim().toUpperCase().refine(isValidPan, "Enter a valid PAN (e.g. ABCDE1234F)"),
  aadhaar: z.string().trim().refine((v) => v === "" || isValidAadhaar(v), "Enter a valid 12-digit Aadhaar number"),
  uan: optional(12).refine((v) => !v || isValidUan(v), "UAN must be 12 digits"),
  previous_pf_no: optional(30),
  esi_ip_no: optional(17),
  bank_name: req("Bank name", 100),
  bank_branch: optional(100),
  account_holder: req("Account holder name", 120),
  account_number: z.string().trim().refine(isValidAccountNumber, "Account number must be 9–18 digits"),
  account_number_confirm: z.string().trim(),
  ifsc: z.string().trim().toUpperCase().refine(isValidIfsc, "Enter a valid IFSC (e.g. SBIN0001234)"),
  tax_regime: z.enum(["new", "old"]).default("new"),
}).refine((v) => v.account_number === v.account_number_confirm, { message: "Account numbers do not match", path: ["account_number_confirm"] });

export const SECTION_SCHEMAS = {
  personal: personalSchema,
  family: familySchema,
  academic: academicSchema,
  professional: professionalSchema,
  statutory: statutorySchema,
} as const;
export type FormSection = keyof typeof SECTION_SCHEMAS;

/** First error message per field path, for showing next to inputs */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
