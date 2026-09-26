import { NextResponse } from "next/server";
import { getSession, isHr } from "@/lib/auth";
import { currentOrigin } from "@/lib/tenant";
import { loadIdCardData } from "@/lib/idcard-data";
import { buildIdCardsPdf } from "@/lib/idcard";
import { logAudit } from "@/lib/audit";

// GET /api/id-cards?ids=a,b,c   (HR: any active employees of the company)
// GET /api/id-cards?me=1        (employee: own card)
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const url = new URL(req.url);
  let ids: string[];
  if (url.searchParams.get("me")) {
    if (!session.user.employee_id) return NextResponse.json({ error: "No employee record." }, { status: 404 });
    ids = [session.user.employee_id];
  } else {
    if (!isHr(session.user)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
    ids = (url.searchParams.get("ids") || "").split(",").filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  }
  if (!ids.length) return NextResponse.json({ error: "No employees selected." }, { status: 400 });

  const cards = await loadIdCardData(session.tenant, ids, await currentOrigin());
  if (!cards.length) return NextResponse.json({ error: "No active employees found." }, { status: 404 });
  const pdf = await buildIdCardsPdf(cards);
  await logAudit({ tenantId: session.tenant.id, actorId: session.user.id, action: "id_card.downloaded", entity: "id_cards", data: { count: cards.length } });

  const name = cards.length === 1 ? `ID-${cards[0].employeeCode}.pdf` : `ID-cards-${cards.length}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
