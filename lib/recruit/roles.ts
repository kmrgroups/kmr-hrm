// What a Role adds to a position ("Shopfloor handling", "Manpower handling", "Calibration" …): responsibilities,
// authority, competencies and KPIs. A position = Position title + Role + Department; the Role may name several areas
// ("Shopfloor & manpower handling") and each area found adds its part. Free, rule-based, explainable.

export interface RoleArea {
  key: string; label: string; match: RegExp;
  responsibilities: string[]; authorities: string[];
  competencies: [string, number][];      // competency (recruitment vocabulary) and weight 1–3
  kpis: string[];
}

export const ROLE_AREAS: RoleArea[] = [
  { key: "shopfloor", label: "Shopfloor handling", match: /shop\s?floor|shift|\bline\b|production|output/i,
    responsibilities: ["Run the shift / line to the production plan: output, quality, delivery and safety", "Release the set-up and first-off; review check sheets every shift",
      "Hold the daily start-of-shift meeting on yesterday's quality, safety and output", "Escalate abnormalities through the escalation matrix within the agreed time"],
    authorities: ["Stop the line on a quality, safety or delivery risk", "Hold and red-tag suspect material"],
    competencies: [["Production / shop-floor management", 3], ["Shop-floor discipline (5S, SOP, check sheets)", 3]], kpis: ["Plan vs actual output", "OEE"] },
  { key: "manpower", label: "Manpower handling", match: /man\s?power|people|team|supervis|lead|staff/i,
    responsibilities: ["Plan manpower for each shift using the skill matrix; no one works alone on an operation he is not qualified for",
      "Raise training needs for the team and evaluate training effectiveness on the job", "Maintain attendance, discipline and morale; resolve grievances early",
      "Develop backups for key operations and people"],
    authorities: ["Allocate people to operations within their qualification", "Recommend leave, overtime and permission for the team"],
    competencies: [["People leadership", 3], ["Communication & documentation", 2]], kpis: ["Absenteeism %", "Skill matrix coverage %"] },
  { key: "calibration", label: "Calibration & gauge control", match: /calibrat|gauge|gage|metrolog|instrument|msa/i,
    responsibilities: ["Maintain the calibration plan and history of every gauge and measuring instrument", "Calibrate in-house as per the procedure, or through an accredited (NABL / ISO 17025) laboratory",
      "Run MSA (GR&R, bias, linearity) for the gauges in the control plan", "Assess the effect on product when a gauge is found out of calibration, and inform Quality",
      "Keep gauges identified, stored and protected; withdraw damaged gauges"],
    authorities: ["Withdraw an out-of-calibration or damaged gauge from use", "Reject a calibration certificate that does not meet the requirement"],
    competencies: [["Inspection & metrology", 3], ["Statistical analysis (SPC, Cpk, MSA)", 2], ["IATF 16949 / ISO 9001", 2]], kpis: ["Calibration plan adherence %", "Gauges overdue for calibration"] },
  { key: "quality", label: "Quality control", match: /quality|inspect|qc\b|qa\b|audit|customer complaint|ppap/i,
    responsibilities: ["Inspect as per the control plan; record results and act on out-of-tolerance readings", "Handle complaints with 8D; verify that corrective actions work",
      "Run layered process audits and follow up the findings"],
    authorities: ["Hold, segregate and reject non-conforming product", "Stop dispatch of suspect lots"],
    competencies: [["Problem solving (8D, RCA, CAPA)", 3], ["Core tools (APQP, PPAP, FMEA, SPC, MSA)", 2]], kpis: ["Customer PPM", "Internal rejection %"] },
  { key: "maintenance", label: "Maintenance", match: /mainten|breakdown|utilit|\bpm\b|tpm|electrical|mechanical/i,
    responsibilities: ["Attend breakdowns and find the root cause so they do not repeat", "Carry out preventive maintenance as per the PM plan", "Keep critical spares and the machine history card up to date"],
    authorities: ["Take a machine out of production for safety or repair", "Apply lock-out tag-out and permit to work"],
    competencies: [["TPM / maintenance excellence", 3], ["Mechanical maintenance", 2], ["Electrical maintenance", 2]], kpis: ["MTBF", "MTTR", "PM adherence %"] },
  { key: "machine", label: "Machine operation", match: /machine|operat|cnc|vmc|setting|setter|turning|milling|press|weld/i,
    responsibilities: ["Operate the machine as per the work instruction and set-up sheet", "Do first-off and in-process checks and record them", "Do the daily autonomous-maintenance checks"],
    authorities: ["Stop the machine on a quality or safety doubt"],
    competencies: [["CNC machining", 3], ["Inspection & metrology", 2], ["Shop-floor discipline (5S, SOP, check sheets)", 2]], kpis: ["Output per shift", "Rejection %"] },
  { key: "planning", label: "Planning & dispatch", match: /plan|ppc|dispatch|schedul|store|inventory|warehouse|logistic|material/i,
    responsibilities: ["Convert customer schedules into production and material plans", "Track WIP and finished goods; dispatch on time", "Keep inventory accurate with FIFO and cycle counts"],
    authorities: ["Change the daily production sequence to protect customer delivery"],
    competencies: [["Production planning & control", 3], ["ERP (SAP / Oracle / Tally)", 2]], kpis: ["On-time delivery %", "Inventory accuracy %"] },
  { key: "npd", label: "New product & process development", match: /npd|new product|develop|process|industriali|apqp|trial/i,
    responsibilities: ["Plan and launch new parts through APQP to PPAP approval", "Prepare PFMEA, control plan and process sheets", "Run trials and pilot lots; capture lessons learned"],
    authorities: ["Release a process for production after a successful trial"],
    competencies: [["Process engineering / NPD", 3], ["Core tools (APQP, PPAP, FMEA, SPC, MSA)", 3]], kpis: ["NPD milestones on time", "PPAP approval first time"] },
  { key: "purchase", label: "Purchase & supplier", match: /purchase|procure|sourc|vendor|supplier/i,
    responsibilities: ["Source and buy at the right cost, quality and delivery", "Rate suppliers and develop the weak ones"],
    authorities: ["Release purchase orders within the approved limit"],
    competencies: [["Purchase & sourcing", 3], ["Supplier quality development", 2]], kpis: ["Supplier on-time delivery", "Supplier PPM"] },
  { key: "safety", label: "Safety", match: /safety|ehs|hse|environment|fire/i,
    responsibilities: ["Identify hazards (HIRA) and keep controls in place", "Investigate incidents and near misses; close the actions", "Run safety training and mock drills"],
    authorities: ["Stop any unsafe work", "Issue and close work permits"],
    competencies: [["Health, safety & environment", 3]], kpis: ["Lost-time injuries", "Near misses reported"] },
  { key: "documentation", label: "Documentation & records", match: /document|record|mis|report|data/i,
    responsibilities: ["Maintain the controlled documents and records of the area", "Prepare MIS reports on time"],
    authorities: ["Withdraw obsolete documents from use"],
    competencies: [["Communication & documentation", 2], ["MS Excel / reporting", 2]], kpis: ["Reports on time %"] },
];

/** the role areas named in a Role ("Shopfloor & manpower handling" → shopfloor + manpower) */
export function roleAreas(role: string | null | undefined): RoleArea[] {
  const r = (role ?? "").trim();
  if (!r) return [];
  return ROLE_AREAS.filter((a) => a.match.test(r));
}

/** suggestions for the Role box */
export const ROLE_SUGGESTIONS = ["Shopfloor handling", "Manpower handling", "Shopfloor & manpower handling", "Calibration & gauge control", "Quality control",
  "Customer quality & audits", "Machine operation", "Maintenance", "Planning & dispatch", "New product & process development", "Purchase & supplier", "Safety", "Documentation & records"];
