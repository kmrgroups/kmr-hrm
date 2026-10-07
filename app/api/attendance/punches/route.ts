import { NextResponse } from "next/server";
import { deviceByKey, touchDevice } from "@/lib/attendance/devices";
import { parseApiPayload } from "@/lib/attendance/parse";
import { ingestPunches } from "@/lib/attendance/service";
import { licenceFor } from "@/lib/licence";
import { hasFeature } from "@/lib/features";

// Punches from a bridge program or a device that can call a web API.
//   POST /api/attendance/punches
//   Authorization: Bearer <device API key from Settings → Attendance setup>
//   {"punches":[{"user_id":"101","time":"2026-09-21 09:02:00"}]}     (time in India time, or ISO with zone)
export async function POST(req: Request) {
  const key = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const device = await deviceByKey(key);
  if (!device) return NextResponse.json({ error: "Unknown or disabled device key" }, { status: 401 });
  const lic = await licenceFor(device.tenant_id);
  if (!lic.ok) return NextResponse.json({ error: "Subscription not active" }, { status: 403 });
  if (!hasFeature(lic.features, "hrm.attendance-shifts-leave")) return NextResponse.json({ error: "Attendance is not in this company's plan" }, { status: 403 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be JSON" }, { status: 400 }); }
  const { rows, errors } = parseApiPayload(body);
  if (!rows.length) return NextResponse.json({ error: errors[0] ?? "No punches", errors }, { status: 400 });
  try {
    const r = await ingestPunches(device.tenant_id, rows, "device", device.id);
    await touchDevice(device.id, req);
    return NextResponse.json({ received: rows.length, stored: r.inserted, duplicates: rows.length - r.inserted, unmatched: r.unmatched, errors });
  } catch (e) {
    console.error("[punches]", e);
    return NextResponse.json({ error: "Could not store punches, please retry" }, { status: 500 });
  }
}
