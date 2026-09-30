import { NextResponse } from "next/server";
import { getSession, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/attendance/service";
import { isMonth } from "@/lib/attendance/time";
import { logAudit } from "@/lib/audit";
import { loadSetup, type Line } from "@/lib/payroll/service";
import { buildPayslipsPdf } from "@/lib/payroll/payslip";
import { bankCsv, ecrText, esiCsv, ptCsv, registerCsv } from "@/lib/payroll/exports";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// /api/payroll/2026-09/<kind>: payslips.pdf · register.csv · bank.csv · ecr.txt · esi.csv · pt.csv · payslip?e=<employee> (HR / payroll)
//                            mine (the signed-in employee's own payslip, finalised months only)
export async function GET(req: Request, ctx: { params: Promise<{ month: string; kind: string }> }) {
  const { month, kind } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!isMonth(month)) return NextResponse.json({ error: "Bad month." }, { status: 400 });
  const supabase = await createClient();
  const hr = hasRole(session.user, ["hr_manager", "payroll"]);
  const file = (body: string | Uint8Array, type: string, name: string) =>
    new NextResponse(typeof body === "string" ? body : Buffer.from(body), { headers: { "content-type": type, "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });

  const { data: run } = await supabase.from("payroll_runs").select("id,status").eq("month", month).maybeSingle();
  if (!run) return NextResponse.json({ error: "No payroll for this month." }, { status: 404 });

  if (kind === "mine") {
    if (!session.user.employee_id) return NextResponse.json({ error: "No employee record." }, { status: 404 });
    // row-level security only returns the employee's own, finalised payslip
    const { data: line } = await supabase.from("payroll_lines").select("*").eq("run_id", run.id).eq("employee_id", session.user.employee_id).maybeSingle();
    if (!line) return NextResponse.json({ error: "Payslip not available." }, { status: 404 });
    const { settings } = await loadSetup(supabase, session.tenant.id);
    return file(await buildPayslipsPdf(session.tenant, month, [line as Line], settings.payslip_note), "application/pdf", `Payslip-${month}.pdf`);
  }
  if (!hr) return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  const url = new URL(req.url);
  let lines = await fetchAll<Line>((a, b) => supabase.from("payroll_lines").select("*").eq("run_id", run.id).range(a, b));
  lines = lines.sort((a, b) => String(a.info.code ?? a.info.name).localeCompare(String(b.info.code ?? b.info.name), undefined, { numeric: true }));
  const tag = run.status === "draft" ? "-DRAFT" : "";
  await logAudit({ tenantId: session.tenant.id, actorId: session.user.id, action: "payroll.downloaded", entity: "payroll_runs", entityId: run.id, data: { month, kind } });
  switch (kind) {
    case "payslip": {
      const one = lines.filter((l) => l.employee_id === url.searchParams.get("e"));
      if (!one.length) return NextResponse.json({ error: "Not found." }, { status: 404 });
      const { settings } = await loadSetup(supabase, session.tenant.id);
      return file(await buildPayslipsPdf(session.tenant, month, one, settings.payslip_note), "application/pdf", `Payslip-${month}-${one[0].info.code ?? "employee"}${tag}.pdf`);
    }
    case "payslips.pdf": {
      const { settings } = await loadSetup(supabase, session.tenant.id);
      return file(await buildPayslipsPdf(session.tenant, month, lines, settings.payslip_note), "application/pdf", `Payslips-${month}${tag}.pdf`);
    }
    case "register.csv": return file(registerCsv(lines), "text/csv; charset=utf-8", `Salary-register-${month}${tag}.csv`);
    case "bank.csv": return file(bankCsv(lines, month), "text/csv; charset=utf-8", `Bank-transfer-${month}${tag}.csv`);
    case "ecr.txt": return file(ecrText(lines), "text/plain; charset=utf-8", `PF-ECR-${month}${tag}.txt`);
    case "esi.csv": return file(esiCsv(lines), "text/csv; charset=utf-8", `ESI-${month}${tag}.csv`);
    case "pt.csv": return file(ptCsv(lines), "text/csv; charset=utf-8", `Professional-tax-${month}${tag}.csv`);
    default: return NextResponse.json({ error: "Unknown file." }, { status: 404 });
  }
}
