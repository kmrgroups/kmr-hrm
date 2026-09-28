import { NextResponse } from "next/server";
import { getSession, hasRole } from "@/lib/auth";
import { exportCompany } from "@/lib/data-tools";
import { istToday } from "@/lib/attendance/time";

// JSON download of all of the company's HRM data (administrators only)
export async function GET() {
  const s = await getSession();
  if (!s || !hasRole(s.user, ["hr_manager"])) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const data = await exportCompany(s.tenant.id);
  return new NextResponse(JSON.stringify(data, null, 1), { headers: {
    "Content-Type": "application/json", "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="hrm-${s.tenant.slug}-${istToday()}.json"`,
  } });
}
