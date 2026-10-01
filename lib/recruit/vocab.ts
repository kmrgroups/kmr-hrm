// What the recruitment engines know about manufacturing roles — no AI service, no cost.
// A competency has the words people really write in resumes for it ("reduced line rejection" = quality improvement),
// so the match score recognises the capability even when the competency's own name is missing.

export interface Competency { name: string; terms: string[] }

/** Competency name → words and phrases that show it in a resume (lower case; matched on word boundaries). */
export const COMPETENCIES: Record<string, string[]> = {
  "IATF 16949 / ISO 9001": ["iatf", "ts 16949", "ts16949", "iso 9001", "iso9001", "qms", "quality management system"],
  "Core tools (APQP, PPAP, FMEA, SPC, MSA)": ["core tools", "apqp", "ppap", "fmea", "pfmea", "dfmea", "spc", "msa", "control plan"],
  "Problem solving (8D, RCA, CAPA)": ["8d", "8 d", "root cause", "rca", "capa", "why why", "5 why", "fishbone", "ishikawa", "kepner", "a3", "corrective action", "problem solving"],
  "Quality improvement": ["ppm", "rejection", "rework", "scrap", "defect", "first pass yield", "fpy", "customer complaint", "warranty", "zero defect", "poka yoke", "pokayoke", "mistake proofing", "cost of poor quality", "copq"],
  "Customer quality / OEM interface": ["customer quality", "oem", "customer audit", "customer complaint", "csr", "customer specific", "supplier quality engineer", "sqa", "field failure"],
  "Supplier quality development": ["supplier quality", "supplier audit", "supplier development", "vendor development", "sqd", "incoming inspection", "vendor rating", "supplier ppm"],
  "Internal / process audits": ["internal audit", "internal auditor", "process audit", "vda 6.3", "vda6.3", "product audit", "layered process audit", "lpa", "audit"],
  "Inspection & metrology": ["inspection", "metrology", "cmm", "calibration", "gauge", "gage", "vernier", "micrometer", "height gauge", "profile projector", "contracer", "surface roughness", "gd&t", "gd t", "drawing reading"],
  "Statistical analysis (SPC, Cpk, MSA)": ["spc", "cpk", "ppk", "control chart", "process capability", "gauge r&r", "grr", "minitab", "doe", "design of experiments", "anova"],
  "Lean / continuous improvement": ["lean", "kaizen", "5s", "smed", "value stream", "vsm", "kanban", "continuous improvement", "line balancing", "waste reduction", "muda", "gemba", "jidoka"],
  "Six Sigma": ["six sigma", "green belt", "black belt", "dmaic", "lean six sigma"],
  "TPM / maintenance excellence": ["tpm", "total productive maintenance", "oee", "mtbf", "mttr", "breakdown", "preventive maintenance", "predictive maintenance", "autonomous maintenance", "jishu hozen", "pm schedule"],
  "Production planning & control": ["production planning", "ppc", "mrp", "mps", "scheduling", "capacity planning", "dispatch", "on time delivery", "otd", "wip", "line planning", "material planning"],
  "Production / shop-floor management": ["production", "shop floor", "shift incharge", "shift in charge", "line supervisor", "manpower handling", "productivity", "output", "assembly line", "cycle time", "takt"],
  "CNC machining": ["cnc", "vmc", "hmc", "turning", "milling", "lathe", "fanuc", "siemens 840", "sinumerik", "g code", "g-code", "cnc programming", "machining", "turn mill", "setting", "cnc operator", "cnc setter"],
  "Tooling / fixtures": ["tool design", "fixture", "jig", "press tool", "die", "mould", "mold", "tool room", "cutting tool", "tool life", "insert"],
  "Process engineering / NPD": ["process engineering", "npd", "new product development", "process planning", "industrialisation", "industrialization", "pfd", "process flow", "trial", "pilot lot", "ecn", "engineering change"],
  "CAD (AutoCAD / SolidWorks / Creo / CATIA)": ["autocad", "solidworks", "solid works", "creo", "pro e", "proe", "catia", "nx", "unigraphics", "inventor", "fusion 360", "3d modelling", "3d modeling", "drafting"],
  "Welding / fabrication": ["welding", "mig", "tig", "arc welding", "spot welding", "fabrication", "wps", "pqr", "welder"],
  "Forging / casting / heat treatment": ["forging", "casting", "foundry", "heat treatment", "hardening", "tempering", "induction hardening", "carburising", "carburizing", "annealing", "die casting"],
  "Electrical maintenance": ["electrical maintenance", "plc", "scada", "hmi", "vfd", "drives", "motor", "control panel", "electrician", "wiring", "allen bradley", "siemens plc", "mitsubishi plc"],
  "Mechanical maintenance": ["mechanical maintenance", "hydraulic", "hydraulics", "pneumatic", "pneumatics", "bearing", "gearbox", "alignment", "lubrication", "fitter", "breakdown maintenance"],
  "Stores & inventory": ["stores", "inventory", "warehouse", "grn", "fifo", "stock", "material handling", "bin card", "cycle count"],
  "Purchase & sourcing": ["purchase", "procurement", "sourcing", "buyer", "rfq", "negotiation", "vendor", "po", "purchase order", "cost reduction"],
  "Logistics": ["logistics", "transport", "e way bill", "eway bill", "freight", "packing", "dispatch"],
  "ERP (SAP / Oracle / Tally)": ["sap", "sap pp", "sap mm", "sap qm", "sap fico", "oracle", "erp", "tally", "microsoft dynamics", "navision", "ifs"],
  "MS Excel / reporting": ["excel", "pivot", "vlookup", "xlookup", "mis", "dashboard", "power bi", "reporting", "data analysis"],
  "People leadership": ["team lead", "team leader", "led a team", "leading a team", "managed a team", "team of", "supervised", "mentoring", "manpower", "headed", "reporting to me", "people management"],
  "Customer handling / sales": ["sales", "business development", "key account", "customer relationship", "crm", "order booking", "target", "enquiry", "quotation", "rfq"],
  "Costing & finance": ["costing", "cost estimation", "budget", "p&l", "pnl", "variance", "accounts", "gst", "tds", "audit", "balance sheet", "reconciliation", "accounts payable", "accounts receivable"],
  "HR operations": ["recruitment", "onboarding", "payroll", "statutory compliance", "pf", "esi", "labour law", "industrial relations", "employee relations", "training", "performance appraisal", "hrms"],
  "Health, safety & environment": ["ehs", "hse", "safety", "iso 14001", "iso 45001", "ohsas", "fire safety", "risk assessment", "hira", "accident", "near miss", "permit to work", "loto", "ppe"],
  "IT / systems": ["networking", "server", "active directory", "windows server", "linux", "firewall", "it support", "helpdesk", "sql", "python", "javascript", "erp support", "cyber security"],
  "Communication & documentation": ["communication", "presentation", "documentation", "report writing", "english", "coordination", "cross functional", "cft"],
};

/** Words that show the operating context (industry, plant type, standards) — compared with the role's context. */
export const CONTEXT_TERMS = ["automotive", "auto component", "auto components", "tier 1", "tier-1", "tier1", "tier 2", "oem", "iatf", "machining",
  "manufacturing", "plant", "factory", "engineering", "forging", "casting", "sheet metal", "assembly", "precision", "aerospace", "two wheeler", "four wheeler",
  "commercial vehicle", "tractor", "hyundai", "maruti", "suzuki", "tata motors", "mahindra", "ashok leyland", "tvs", "bajaj", "hero", "honda", "toyota", "bosch",
  "volvo", "daimler", "caterpillar", "cummins", "high volume", "mass production"];

/** Indian cities (for the candidate's location). */
export const CITIES = ["bengaluru", "bangalore", "hosur", "chennai", "coimbatore", "madurai", "trichy", "tiruchirappalli", "salem", "erode", "tiruppur", "pondicherry", "puducherry",
  "mysuru", "mysore", "tumkur", "belgaum", "belagavi", "hubli", "mangalore", "hyderabad", "secunderabad", "vijayawada", "visakhapatnam", "pune", "pimpri", "chakan",
  "aurangabad", "nashik", "mumbai", "thane", "navi mumbai", "ahmedabad", "vadodara", "rajkot", "surat", "sanand", "gurugram", "gurgaon", "manesar", "faridabad", "noida",
  "delhi", "new delhi", "ghaziabad", "jaipur", "neemrana", "bhiwadi", "ludhiana", "chandigarh", "kolkata", "jamshedpur", "indore", "pithampur", "nagpur", "kochi", "cochin"];

export interface Family {
  key: string; label: string;
  match: RegExp;                          // designation / department words that point to this family
  purpose: string;                        // {title}, {department}, {company} are filled in
  responsibilities: string[];
  kpis: string[];
  must: [string, number][];               // [competency, weight 1–3]
  good: string[];
  qualification: { senior: string; junior: string };
  outcomes: string[];
  education: RegExp;                       // degrees that fit the family
}

const QMS_CONTEXT = "Automotive / engineering manufacturing plant working to IATF 16949 / ISO 9001";

export const FAMILIES: Family[] = [
  { key: "quality", label: "Quality", match: /quality|qa\b|qc\b|inspect|metrolog|sqe|sqa|audit/i,
    purpose: "Make sure every part the {department} team ships meets the customer's requirements, and drive down rejections and customer complaints across the plant.",
    responsibilities: ["Run incoming, in-process and final inspection as per the control plan and inspection standards",
      "Handle customer complaints end to end with 8D / root-cause analysis and verify corrective actions",
      "Prepare and maintain PPAP, APQP, PFMEA and control-plan documents for new and changed parts",
      "Monitor process capability with SPC (Cp/Cpk) and MSA studies; act on out-of-control signals",
      "Plan and conduct internal process and product audits; close non-conformities on time",
      "Work with suppliers on incoming quality, supplier PPM and corrective actions",
      "Maintain calibration of gauges and measuring instruments", "Train operators on quality standards, poka-yoke and work instructions"],
    kpis: ["Customer PPM", "Internal rejection %", "Customer complaints closed on time (8D)", "Cpk of critical characteristics ≥ 1.33", "Audit NCs closed on time", "Cost of poor quality"],
    must: [["Core tools (APQP, PPAP, FMEA, SPC, MSA)", 3], ["Problem solving (8D, RCA, CAPA)", 3], ["Quality improvement", 2], ["Inspection & metrology", 2], ["IATF 16949 / ISO 9001", 2]],
    good: ["Customer quality / OEM interface", "Supplier quality development", "Internal / process audits", "Six Sigma", "Statistical analysis (SPC, Cpk, MSA)"],
    qualification: { senior: "B.E / B.Tech (Mechanical / Production / Automobile); IATF internal-auditor training preferred", junior: "Diploma or B.E / B.Tech (Mechanical / Production)" },
    outcomes: ["Bring customer PPM down and hold it", "Close customer complaints with effective, verified corrective action", "Keep the plant audit-ready for IATF 16949"],
    education: /b\.?\s?e\b|b\.?\s?tech|diploma|m\.?\s?tech|mechanical|production|automobile/i },
  { key: "production", label: "Production", match: /production|shift|\bline\b|assembly|manufactur|shop\s?floor|supervisor|operations?/i,
    purpose: "Deliver the daily production plan of the {department} line safely, on time and right first time, with the agreed manpower and machine capacity.",
    responsibilities: ["Run the shift or line to the daily production plan; report output, rejections and downtime",
      "Allocate manpower and machines; balance the line to the takt time", "Ensure work instructions, set-up approval and first-off inspection are followed",
      "Drive productivity, OEE and cycle-time improvement with kaizens", "Maintain 5S, safety and housekeeping on the shop floor",
      "Coordinate with quality, maintenance and planning to remove bottlenecks", "Train and develop operators; keep the skill matrix up to date"],
    kpis: ["Plan vs actual output", "OEE", "Internal rejection %", "Productivity (parts per man-hour)", "Safety incidents", "On-time delivery"],
    must: [["Production / shop-floor management", 3], ["People leadership", 2], ["Lean / continuous improvement", 2], ["Quality improvement", 1]],
    good: ["Production planning & control", "TPM / maintenance excellence", "CNC machining", "ERP (SAP / Oracle / Tally)", "Health, safety & environment"],
    qualification: { senior: "B.E / B.Tech or Diploma (Mechanical / Production)", junior: "Diploma (Mechanical / Production) or ITI with shop-floor experience" },
    outcomes: ["Meet the daily plan with first-time-right quality", "Raise OEE and productivity on the line", "Zero safety incidents"],
    education: /b\.?\s?e\b|b\.?\s?tech|diploma|iti|mechanical|production/i },
  { key: "maintenance", label: "Maintenance", match: /mainten|electrical|electrician|utility|utilities|fitter|tpm/i,
    purpose: "Keep plant machines and utilities available and reliable through planned maintenance and quick, lasting breakdown repair.",
    responsibilities: ["Attend breakdowns quickly and find the root cause so they do not repeat", "Plan and carry out preventive and predictive maintenance as per the PM schedule",
      "Maintain hydraulic, pneumatic, electrical and PLC-controlled systems", "Keep critical spares and the maintenance history up to date",
      "Drive TPM, autonomous maintenance and MTBF / MTTR improvement", "Follow LOTO and permit-to-work safety rules"],
    kpis: ["Machine availability %", "MTBF", "MTTR", "PM adherence %", "Maintenance cost per unit", "Repeat breakdowns"],
    must: [["TPM / maintenance excellence", 3], ["Mechanical maintenance", 2], ["Electrical maintenance", 2], ["Problem solving (8D, RCA, CAPA)", 1]],
    good: ["Health, safety & environment", "CNC machining", "ERP (SAP / Oracle / Tally)", "Lean / continuous improvement"],
    qualification: { senior: "B.E / Diploma (Mechanical / Electrical / Mechatronics)", junior: "Diploma or ITI (Fitter / Electrician)" },
    outcomes: ["Raise machine availability and MTBF", "Cut repeat breakdowns"], education: /b\.?\s?e\b|b\.?\s?tech|diploma|iti|electrical|mechanical|mechatronic/i },
  { key: "engineering", label: "Engineering / NPD", match: /engineer|npd|process|design|tool|method|industriali/i,
    purpose: "Industrialise new and changed parts — process design, tooling and trials — so they reach mass production at the right cost, quality and capacity.",
    responsibilities: ["Plan processes for new parts: process flow, PFMEA, control plan, cycle time and capacity", "Design or specify fixtures, tooling and gauges; run trials and pilot lots",
      "Prepare and update drawings and process sheets in CAD", "Handle engineering changes (ECN) and keep documents current",
      "Improve cycle time, tool life and cost on running parts", "Support PPAP submission with process and capability data"],
    kpis: ["NPD milestones on time", "PPAP approval first time", "Cycle-time reduction", "Tooling cost per part", "Trial-to-SOP lead time"],
    must: [["Process engineering / NPD", 3], ["Core tools (APQP, PPAP, FMEA, SPC, MSA)", 2], ["CAD (AutoCAD / SolidWorks / Creo / CATIA)", 2], ["Tooling / fixtures", 2]],
    good: ["CNC machining", "Lean / continuous improvement", "Problem solving (8D, RCA, CAPA)", "Costing & finance"],
    qualification: { senior: "B.E / B.Tech / M.Tech (Mechanical / Production / Automobile)", junior: "B.E / Diploma (Mechanical / Tool & Die)" },
    outcomes: ["Bring new parts to SOP on time with PPAP approved first time", "Lower cycle time and tooling cost"],
    education: /b\.?\s?e\b|b\.?\s?tech|m\.?\s?tech|diploma|mechanical|production|automobile|tool/i },
  { key: "ppc", label: "Planning, stores & logistics", match: /ppc|planning|planner|store|inventory|warehouse|logistic|dispatch|material/i,
    purpose: "Turn customer schedules into a workable production and material plan, and keep inventory accurate and lean.",
    responsibilities: ["Convert customer schedules into monthly and daily production plans", "Plan materials and capacity; raise purchase requirements on time",
      "Track WIP and finished goods; ensure on-time dispatch", "Maintain inventory accuracy with FIFO, cycle counts and ERP transactions",
      "Report plan adherence, inventory days and shortages"],
    kpis: ["On-time delivery %", "Schedule adherence", "Inventory days", "Inventory accuracy %", "Premium freight cost"],
    must: [["Production planning & control", 3], ["Stores & inventory", 2], ["ERP (SAP / Oracle / Tally)", 2], ["MS Excel / reporting", 2]],
    good: ["Logistics", "Purchase & sourcing", "Lean / continuous improvement"],
    qualification: { senior: "B.E / MBA (Operations) or graduate with PPC experience", junior: "Graduate or Diploma with stores / planning experience" },
    outcomes: ["100% on-time delivery", "Lower inventory with no line stoppage"], education: /b\.?\s?e\b|mba|b\.?\s?com|b\.?\s?sc|diploma|graduate/i },
  { key: "purchase", label: "Purchase", match: /purchase|procure|sourcing|buyer|vendor/i,
    purpose: "Source materials and services at the right cost, quality and delivery, and develop a reliable supplier base.",
    responsibilities: ["Raise RFQs, compare quotations and negotiate prices and terms", "Release purchase orders and follow up deliveries",
      "Evaluate and develop suppliers with quality and delivery ratings", "Drive cost reduction and alternate sourcing", "Keep purchase records audit-ready"],
    kpis: ["Supplier on-time delivery", "Cost savings achieved", "Supplier PPM", "PO lead time"],
    must: [["Purchase & sourcing", 3], ["ERP (SAP / Oracle / Tally)", 2], ["Supplier quality development", 1], ["MS Excel / reporting", 1]],
    good: ["Costing & finance", "Logistics"], qualification: { senior: "B.E / MBA (Materials)", junior: "Graduate / Diploma" },
    outcomes: ["Reduce material cost", "Reliable supplier base"], education: /b\.?\s?e\b|mba|b\.?\s?com|diploma|graduate/i },
  { key: "hr", label: "Human resources", match: /\bhr\b|human|personnel|admin|recruit|payroll|people|industrial relation/i,
    purpose: "Run the people processes of the plant — hiring, onboarding, payroll inputs, statutory compliance and employee relations.",
    responsibilities: ["Hire to the approved manpower plan and onboard new joiners", "Maintain attendance, leave and payroll inputs; ensure PF, ESI and other statutory compliance",
      "Keep employee records, competency and training records audit-ready (IATF 7.2)", "Handle employee relations, grievances and discipline as per standing orders",
      "Run training, engagement and welfare programmes"],
    kpis: ["Time to hire", "Statutory compliance (no lapses)", "Attrition %", "Training plan adherence", "Payroll accuracy"],
    must: [["HR operations", 3], ["MS Excel / reporting", 1], ["Communication & documentation", 2]],
    good: ["ERP (SAP / Oracle / Tally)", "IATF 16949 / ISO 9001", "Health, safety & environment"],
    qualification: { senior: "MBA / MSW (HR)", junior: "Graduate with HR / admin experience" },
    outcomes: ["Fill positions on time", "Zero statutory non-compliance"], education: /mba|msw|pgdm|graduate|b\.?\s?com|ba\b/i },
  { key: "accounts", label: "Accounts & finance", match: /account|finance|cost|commercial|audit|tax|gst/i,
    purpose: "Keep the books, taxes and costing accurate and on time, and give management clear numbers to decide on.",
    responsibilities: ["Maintain books of accounts and reconcile banks, vendors and customers", "File GST, TDS and other returns on time",
      "Prepare product costing, budgets and variance reports", "Support statutory and internal audits", "Manage payables, receivables and cash flow"],
    kpis: ["Month-end close on time", "Returns filed on time", "Receivable days", "Audit observations"],
    must: [["Costing & finance", 3], ["ERP (SAP / Oracle / Tally)", 2], ["MS Excel / reporting", 2]],
    good: ["Communication & documentation"], qualification: { senior: "CA / ICWA / M.Com / MBA (Finance)", junior: "B.Com / M.Com" },
    outcomes: ["Accurate, on-time books and returns"], education: /\bca\b|icwa|cma|m\.?\s?com|b\.?\s?com|mba/i },
  { key: "sales", label: "Sales & marketing", match: /sales|marketing|business development|\bbd\b|key account|customer service/i,
    purpose: "Grow the business with existing and new customers and keep customers satisfied from enquiry to delivery.",
    responsibilities: ["Handle enquiries, RFQs and quotations; follow up to order", "Manage key accounts and customer schedules", "Find new customers and products",
      "Coordinate with planning and quality on delivery and complaints", "Report sales against target"],
    kpis: ["Sales vs target", "New business won", "Quotation hit rate", "Customer satisfaction"],
    must: [["Customer handling / sales", 3], ["Communication & documentation", 2], ["MS Excel / reporting", 1]],
    good: ["Costing & finance", "Customer quality / OEM interface"], qualification: { senior: "B.E / MBA", junior: "Graduate" },
    outcomes: ["Grow sales with profitable new business"], education: /b\.?\s?e\b|mba|graduate|b\.?\s?com/i },
  { key: "ehs", label: "Safety (EHS)", match: /safety|ehs|hse|environment/i,
    purpose: "Keep people and the plant safe and compliant with safety and environmental law.",
    responsibilities: ["Run safety inspections, risk assessments (HIRA) and permit-to-work", "Investigate incidents and near misses; drive corrective actions",
      "Run safety training and mock drills", "Maintain statutory safety and environmental compliance and records"],
    kpis: ["Lost-time injuries", "Near misses reported", "Safety training coverage", "Statutory compliance"],
    must: [["Health, safety & environment", 3], ["Communication & documentation", 1]], good: ["Internal / process audits"],
    qualification: { senior: "B.E + Advanced Diploma in Industrial Safety", junior: "Diploma in Industrial Safety" },
    outcomes: ["Zero lost-time injuries"], education: /safety|b\.?\s?e\b|diploma/i },
  { key: "it", label: "IT", match: /\bit\b|information technology|system|software|network|erp admin/i,
    purpose: "Keep the company's systems, network and ERP running and secure.",
    responsibilities: ["Support users, hardware and software", "Maintain servers, network, backups and security", "Support the ERP and its users", "Keep IT assets and licences recorded"],
    kpis: ["System uptime", "Tickets closed on time", "Backup success"], must: [["IT / systems", 3], ["ERP (SAP / Oracle / Tally)", 1]],
    good: ["Communication & documentation"], qualification: { senior: "B.E / MCA", junior: "Graduate / Diploma in computers" },
    outcomes: ["Reliable, secure systems"], education: /b\.?\s?e\b|mca|bca|b\.?\s?sc|diploma/i },
  { key: "operator", label: "Operator / technician", match: /operator|technician|setter|machinist|welder|helper|trainee|apprentice|grinder|turner/i,
    purpose: "Operate and set machines safely to produce good parts to the drawing and work instruction.",
    responsibilities: ["Operate and set the machine as per the work instruction", "Do first-off and in-process checks with gauges; record them",
      "Report abnormalities and stop on doubt", "Maintain 5S and do autonomous maintenance checks", "Follow safety rules and wear PPE"],
    kpis: ["Output per shift", "Rejection %", "Check-sheet compliance", "Safety"],
    must: [["CNC machining", 3], ["Inspection & metrology", 2], ["Production / shop-floor management", 1]],
    good: ["Lean / continuous improvement", "TPM / maintenance excellence", "Welding / fabrication"],
    qualification: { senior: "ITI / Diploma (Machinist / Turner / Fitter)", junior: "ITI / 10th / 12th" },
    outcomes: ["Right-first-time parts at the planned output"], education: /iti|diploma|10th|12th|sslc|hsc/i },
];

export const GENERAL: Family = {
  key: "general", label: "General", match: /.^/,
  purpose: "Deliver the results expected of the {title} in the {department} team.",
  responsibilities: ["Plan and carry out the work of the role to the agreed standard", "Keep records and reports up to date", "Coordinate with other departments", "Follow company policies, quality and safety rules"],
  kpis: ["Work completed on time", "Quality of work", "Safety"], must: [["Communication & documentation", 2], ["MS Excel / reporting", 1]], good: ["People leadership"],
  qualification: { senior: "Graduate in a relevant discipline", junior: "Graduate / Diploma" }, outcomes: ["Deliver the role's results"], education: /graduate|b\.?\s?e\b|diploma|b\.?\s?com|b\.?\s?sc/i,
};

export const familyByKey = (k?: string | null) => FAMILIES.find((f) => f.key === k) ?? (k === "general" ? GENERAL : null);

/** The family of a role from its designation, department and title (first match wins). */
export function detectFamily(...words: (string | null | undefined)[]): Family {
  const text = words.filter(Boolean).join(" ");
  // the designation and title are a stronger hint than the department ("Quality Engineer" in Production is Quality)
  // "engineer" is in many titles (Sales Engineer, Maintenance Engineer): Engineering only wins when nothing more specific matches
  const pick = (w: string) => { const all = FAMILIES.filter((x) => x.match.test(w)); return all.find((x) => x.key !== "engineering") ?? all[0]; };
  for (const w of words.filter(Boolean) as string[]) { const f = pick(w); if (f) return f; }
  return pick(text) ?? GENERAL;
}

export { QMS_CONTEXT };
