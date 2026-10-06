/**
 * Features a company bought (KMR Console › quotation / paid invoice). A company only gets the features on its invoice;
 * the rest are locked. `features` null = no list set for the company, so every feature is open.
 */
export const FEATURE_NAME: Record<string, string> = {
  "hrm.attendance-shifts-leave": "Attendance, shifts & leave",
  "hrm.payroll-statutory-reports": "Payroll & statutory reports",
  "hrm.recruitment-onboarding": "Recruitment & onboarding",
  "hrm.skill-matrix-training-safety": "Skill matrix, training & safety",
};

/** Screens that belong to an optional feature (longest matching prefix wins). Everything else is the core "Employee records & ID cards". */
const PATH_FEATURE: Array<[string, string]> = [
  ["/app/attendance", "hrm.attendance-shifts-leave"], ["/app/leave", "hrm.attendance-shifts-leave"],
  ["/app/settings/attendance", "hrm.attendance-shifts-leave"], ["/app/settings/leave", "hrm.attendance-shifts-leave"],
  ["/me/attendance", "hrm.attendance-shifts-leave"], ["/me/leave", "hrm.attendance-shifts-leave"],
  ["/app/payroll", "hrm.payroll-statutory-reports"], ["/me/payslips", "hrm.payroll-statutory-reports"],
  ["/app/recruitment", "hrm.recruitment-onboarding"],
  ["/app/qms", "hrm.skill-matrix-training-safety"], ["/app/safety", "hrm.skill-matrix-training-safety"],
  ["/app/settings/qms", "hrm.skill-matrix-training-safety"], ["/me/development", "hrm.skill-matrix-training-safety"], ["/me/safety", "hrm.skill-matrix-training-safety"],
];

export function featureForPath(path: string): string | null {
  const hit = PATH_FEATURE.filter(([p]) => path === p || path.startsWith(p + "/")).sort((a, b) => b[0].length - a[0].length)[0];
  return hit ? hit[1] : null;
}
export function hasFeature(features: string[] | null | undefined, key: string | null): boolean {
  return !key || !features || features.includes(key);
}
