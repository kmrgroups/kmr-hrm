import { logoUrl } from "@/lib/tenant";
import type { Tenant } from "@/lib/types";
import { DOC_KINDS } from "@/lib/compliance/rules";
import { PrintButton } from "@/app/app/qms/ai/quiz/[id]/PrintButton";

const dmy = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");

/** a controlled document as it is printed: header box with doc no., revision, dates, prepared / approved by */
export function PrintView({ tenant, d, v }: { tenant: Tenant; d: { doc_no: string; title: string; kind: string; owner_name: string | null };
  v: { revision: number; body: string | null; file_name: string | null; effective_from: string | null; review_due: string | null; prepared_by_name: string | null; approved_by_name: string | null; approved_at: string | null; change_note: string | null; status: string } }) {
  const logo = logoUrl(tenant);
  const cell: React.CSSProperties = { border: "1px solid #9aa5b4", padding: "4px 8px", fontSize: 12 };
  return (
    <div style={{ maxWidth: 820, margin: "24px auto", padding: "0 16px", fontFamily: "system-ui, sans-serif", color: "#111", background: "#fff" }}>
      <div className="noprint" style={{ marginBottom: 12, textAlign: "right" }}><PrintButton label="Print" /></div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}><tbody>
        <tr><td style={{ ...cell, width: 140, textAlign: "center" }} rowSpan={4}>{logo ? <img src={logo} alt="" style={{ maxWidth: 120, maxHeight: 50 }} /> : <b>{tenant.name}</b>}</td>
          <td style={{ ...cell, textAlign: "center", fontWeight: 700 }} rowSpan={2}>{tenant.legal_name || tenant.name}</td><td style={cell}>Doc. no.</td><td style={{ ...cell, fontWeight: 700 }}>{d.doc_no}</td></tr>
        <tr><td style={cell}>Revision</td><td style={{ ...cell, fontWeight: 700 }}>{v.revision}</td></tr>
        <tr><td style={{ ...cell, textAlign: "center", fontWeight: 700, fontSize: 15 }} rowSpan={2}>{d.title}<div style={{ fontWeight: 400, fontSize: 11 }}>{DOC_KINDS[d.kind]} · ISO 9001 7.5</div></td><td style={cell}>Effective</td><td style={cell}>{dmy(v.effective_from)}</td></tr>
        <tr><td style={cell}>Review due</td><td style={cell}>{dmy(v.review_due)}</td></tr>
      </tbody></table>
      {v.status !== "approved" && <p style={{ color: "#b42318", fontWeight: 700 }}>{v.status === "draft" ? "DRAFT — NOT APPROVED" : "OBSOLETE — FOR REFERENCE ONLY"}</p>}
      <div style={{ whiteSpace: "pre-line", lineHeight: 1.55, margin: "18px 0", fontSize: 14 }}>{v.body ?? (v.file_name ? `See the attached PDF: ${v.file_name}` : "")}</div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 24 }}><tbody>
        <tr><td style={cell}>Prepared by: <b>{v.prepared_by_name ?? "—"}</b></td><td style={cell}>Approved by: <b>{v.approved_by_name ?? "—"}</b>{v.approved_at ? ` on ${dmy(v.approved_at)}` : ""}</td><td style={cell}>Owner: {d.owner_name ?? "—"}</td></tr>
        <tr><td style={cell} colSpan={3}>Change in this revision: {v.change_note ?? "—"}</td></tr>
      </tbody></table>
      <p style={{ fontSize: 11, color: "#555" }}>Printed copies are uncontrolled. The current revision is the one in the HRM.</p>
    </div>
  );
}
