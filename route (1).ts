import { NextResponse } from "next/server";
import { getSession, hasRole, HR_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cellCode, loadRegister } from "@/lib/attendance/register";
import { isMonth } from "@/lib/attendance/time";
import { fmtDays } from "@/lib/leave/rules";

// Monthly register as CSV (opens in Excel). Row-level security limits managers to their team.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !hasRole(session.user, [...HR_ROLES, "manager", "payroll"])) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? "";
  if (!isMonth(month)) return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });
  const { days, list } = await loadRegister(await createClient(), month, url.searchParams.get("plant") || undefined);

  const esc = (v: string | number | null) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [
    ["Employee code", "Name", "Department", ...days.map((d) => d.slice(8)), "Present", "Leave", "Absent/LOP", "Weekly off/Holiday", "OT hours", "Late days"].map(esc).join(","),
    ...list.map((r) => [r.code, r.name, r.department, ...days.map((d) => cellCode(r.cells.get(d))), fmtDays(r.present), fmtDays(r.leave), fmtDays(r.absent), r.offs, (r.ot / 60).toFixed(2), r.late].map(esc).join(",")),
  ];
  return new NextResponse("\uFEFF" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="attendance-${session.tenant.slug}-${month}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
