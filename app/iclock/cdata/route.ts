import { deviceBySerial, touchDevice } from "@/lib/attendance/devices";
import { parseAdmsAttlog } from "@/lib/attendance/parse";
import { ingestPunches } from "@/lib/attendance/service";
import { licenceFor } from "@/lib/licence";
import { hasFeature } from "@/lib/features";

// "ADMS" push protocol used by eSSL / ZKTeco devices (Cloud Server Setting on the device).
// Devices are recognised by their serial number, which HR registers under Settings → Attendance setup.
const text = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain" } });

export async function GET(req: Request) {
  const sn = new URL(req.url).searchParams.get("SN") ?? "";
  const device = await deviceBySerial(sn);
  if (!device) return text("Unknown device", 401);
  await touchDevice(device.id, req);
  // Handshake: ask for new attendance logs only, pushed in real time
  return text([
    `GET OPTION FROM: ${sn}`, "ATTLOGStamp=None", "OPERLOGStamp=9999", "ATTPHOTOStamp=9999",
    "ErrorDelay=60", "Delay=30", "TransTimes=00:00;14:05", "TransInterval=1",
    "TransFlag=TransData AttLog", "Realtime=1", "Encrypt=None",
  ].join("\n"));
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const device = await deviceBySerial(url.searchParams.get("SN") ?? "");
  if (!device) return text("Unknown device", 401);
  const body = await req.text();
  if ((url.searchParams.get("table") ?? "").toUpperCase() !== "ATTLOG") {
    await touchDevice(device.id, req);
    return text("OK");            // user lists, photos and operation logs are not needed
  }
  // attendance is an optional feature: without it the device keeps its logs (and retries) until the company adds it
  const lic = await licenceFor(device.tenant_id);
  if (!hasFeature(lic.features, "hrm.attendance-shifts-leave")) return text("ERROR: attendance not in plan", 403);
  const rows = parseAdmsAttlog(body);
  try {
    await ingestPunches(device.tenant_id, rows, "device", device.id);
    await touchDevice(device.id, req);
    return text(`OK: ${rows.length}`);
  } catch (e) {
    console.error("[iclock]", e);
    return text("ERROR", 500);    // the device keeps the logs and retries
  }
}
