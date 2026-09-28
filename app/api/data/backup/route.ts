import { NextResponse } from "next/server";
import { getSession, hasRole } from "@/lib/auth";
import { listBackups, readBackup } from "@/lib/data-tools";

// Nightly backups: ?latest=1 → {date} of the newest; ?date=YYYY-MM-DD → downloads that backup (administrators only)
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || !hasRole(s.user, ["hr_manager"])) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  if (url.searchParams.get("latest")) return NextResponse.json({ date: (await listBackups(s.tenant.id))[0]?.date ?? null });
  const date = url.searchParams.get("date") ?? "";
  const blob = await readBackup(s.tenant.id, date);
  if (!blob) return NextResponse.json({ error: "No backup for that date." }, { status: 404 });
  return new NextResponse(blob, { headers: {
    "Content-Type": "application/json", "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="hrm-${s.tenant.slug}-backup-${date}.json"`,
  } });
}
