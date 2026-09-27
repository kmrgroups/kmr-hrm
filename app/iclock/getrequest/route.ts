import { deviceBySerial, touchDevice } from "@/lib/attendance/devices";

// Devices poll this for commands; there are none, so they simply stay connected.
export async function GET(req: Request) {
  const device = await deviceBySerial(new URL(req.url).searchParams.get("SN") ?? "");
  if (!device) return new Response("Unknown device", { status: 401 });
  await touchDevice(device.id, req);
  return new Response("OK", { headers: { "Content-Type": "text/plain" } });
}
