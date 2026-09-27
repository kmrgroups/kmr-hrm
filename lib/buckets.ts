// Storage buckets of the HRM (prefixed so they never collide with other KMR products in the same project)
export const DOCS_BUCKET = "hrm-docs";          // private: Aadhaar, PAN, cheques, certificates, selfies
export const BRANDING_BUCKET = "hrm-branding";  // public: company logos
/** Database schema that holds the HRM's tables */
export const DB_SCHEMA = process.env.NEXT_PUBLIC_HRM_DB_SCHEMA || "hrm";
