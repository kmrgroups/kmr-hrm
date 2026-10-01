// Sensible starting values for a KPI named in a job description: unit, target, which way is better, how often it is
// reviewed and how. HR changes any of them on the R&R sheet. Matched on the KPI's words; first match wins.

export interface KpiDefault { unit: string | null; target: number | null; direction: "higher" | "lower"; frequency: string; review_method: string; data_source: string | null }

const D = (unit: string | null, target: number | null, direction: "higher" | "lower", frequency: string, review_method: string, data_source: string | null = null): KpiDefault =>
  ({ unit, target, direction, frequency, review_method, data_source });

const CATALOG: [RegExp, KpiDefault][] = [
  [/supplier ppm/i, D("PPM", 500, "lower", "monthly", "Supplier rating reviewed monthly with Purchase", "Incoming inspection register")],
  [/customer ppm|\bppm\b/i, D("PPM", 50, "lower", "monthly", "Customer scorecard reviewed in the monthly quality review", "Customer scorecard / complaint register")],
  [/internal rejection|rejection %|^rejection/i, D("%", 1, "lower", "monthly", "Rejection register reviewed in the daily meeting and monthly review", "Rejection register")],
  [/complaints? closed|8d/i, D("%", 100, "higher", "monthly", "8D tracker reviewed monthly", "Complaint register / 8D tracker")],
  [/cpk/i, D("Cpk", 1.33, "higher", "quarterly", "SPC study review", "SPC records")],
  [/audit (ncs?|observations|findings).*time|ncs? closed/i, D("%", 100, "higher", "monthly", "Audit NC tracker reviewed monthly", "Audit NC register")],
  [/audit observations/i, D("nos", 0, "lower", "yearly", "Statutory audit report review", "Audit report")],
  [/cost of poor quality|copq/i, D("% of sales", 1, "lower", "monthly", "COPQ statement in the monthly review", "Rejection & rework cost")],
  [/plan vs actual|schedule adherence|output vs plan/i, D("%", 98, "higher", "daily", "Daily production meeting; monthly summary", "Production report")],
  [/\boee\b/i, D("%", 75, "higher", "monthly", "OEE sheet reviewed monthly", "OEE sheet")],
  [/productivity|per man.?hour/i, D("parts/man-hr", null, "higher", "monthly", "Productivity report in the monthly review", "Production report")],
  [/safety incidents|lost.?time injur|^safety$/i, D("nos", 0, "lower", "monthly", "Safety committee meeting", "Incident register")],
  [/near miss/i, D("nos", 10, "higher", "monthly", "Safety committee meeting", "Near-miss register")],
  [/on.?time delivery|otd/i, D("%", 98, "higher", "monthly", "Customer delivery rating reviewed monthly", "Dispatch register / customer rating")],
  [/supplier on.?time/i, D("%", 95, "higher", "monthly", "Supplier rating reviewed monthly", "GRN register")],
  [/availability/i, D("%", 95, "higher", "monthly", "Breakdown analysis in the monthly review", "Breakdown register")],
  [/mtbf/i, D("hours", 200, "higher", "monthly", "Breakdown analysis in the monthly review", "Machine history card")],
  [/mttr/i, D("hours", 2, "lower", "monthly", "Breakdown analysis in the monthly review", "Breakdown register")],
  [/pm adherence|calibration plan adherence|plan adherence/i, D("%", 100, "higher", "monthly", "Plan vs actual reviewed monthly", "PM / calibration plan")],
  [/gauges? overdue|overdue for calibration/i, D("nos", 0, "lower", "monthly", "Calibration status check, monthly", "Calibration plan")],
  [/maintenance cost/i, D("Rs./unit", null, "lower", "monthly", "Maintenance cost statement, monthly", "Accounts")],
  [/repeat breakdowns/i, D("nos", 0, "lower", "monthly", "Why-why analysis review, monthly", "Breakdown register")],
  [/npd milestones|milestones on time/i, D("%", 100, "higher", "monthly", "APQP timing chart review", "APQP tracker")],
  [/ppap approval first time/i, D("%", 100, "higher", "quarterly", "PPAP status review", "PPAP register")],
  [/cycle.?time/i, D("%", 5, "higher", "quarterly", "Kaizen review", "Process sheets")],
  [/inventory days/i, D("days", 15, "lower", "monthly", "Inventory review, monthly", "ERP stock report")],
  [/inventory accuracy/i, D("%", 99, "higher", "monthly", "Cycle-count results, monthly", "Cycle-count register")],
  [/premium freight/i, D("Rs.", 0, "lower", "monthly", "Logistics cost review", "Freight bills")],
  [/cost savings|cost reduction/i, D("Rs. lakhs", null, "higher", "quarterly", "Savings tracker review", "Purchase records")],
  [/lead time/i, D("days", null, "lower", "monthly", "Lead-time report review", "ERP")],
  [/time to hire/i, D("days", 30, "lower", "monthly", "Recruitment tracker review", "HRM recruitment")],
  [/statutory compliance/i, D("lapses", 0, "lower", "monthly", "Compliance calendar check", "Compliance register")],
  [/attrition/i, D("%", 10, "lower", "quarterly", "HR review with management", "HRM employee data")],
  [/absenteeism/i, D("%", 3, "lower", "monthly", "Attendance report review", "HRM attendance")],
  [/skill matrix coverage/i, D("%", 100, "higher", "monthly", "Skill matrix review", "HRM skill matrix")],
  [/training (plan adherence|coverage)/i, D("%", 100, "higher", "monthly", "Training plan vs actual", "HRM training plan")],
  [/payroll accuracy/i, D("%", 100, "higher", "monthly", "Payroll error log", "Payroll")],
  [/month.?end close|returns filed/i, D("%", 100, "higher", "monthly", "Finance calendar check", "Accounts")],
  [/receivable days/i, D("days", 60, "lower", "monthly", "Debtors ageing review", "Accounts")],
  [/sales vs target/i, D("%", 100, "higher", "monthly", "Sales review", "Sales register")],
  [/new business/i, D("Rs. lakhs", null, "higher", "quarterly", "Business review", "Orders")],
  [/hit rate/i, D("%", 30, "higher", "quarterly", "Quotation tracker review", "Quotation register")],
  [/customer satisfaction/i, D("score", 4, "higher", "yearly", "Customer satisfaction survey", "Survey")],
  [/uptime/i, D("%", 99.5, "higher", "monthly", "IT service review", "Monitoring log")],
  [/tickets closed/i, D("%", 95, "higher", "monthly", "Helpdesk report", "Ticket log")],
  [/backup success/i, D("%", 100, "higher", "monthly", "Backup log check", "Backup log")],
  [/output per shift/i, D("parts", null, "higher", "daily", "Shift production report; monthly summary", "Production report")],
  [/check.?sheet compliance/i, D("%", 100, "higher", "monthly", "Layered process audit", "Check sheets / LPA")],
  [/reports on time/i, D("%", 100, "higher", "monthly", "MIS calendar check", "MIS")],
];

export function kpiDefault(name: string): KpiDefault {
  for (const [re, d] of CATALOG) if (re.test(name)) return d;
  return D(null, null, "higher", "monthly", "Monthly review by the reporting head", null);
}

export const FREQUENCIES: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", half_yearly: "Half-yearly", yearly: "Yearly" };
