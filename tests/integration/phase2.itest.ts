import { beforeAll, describe, expect, it } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { addDays, istInstant, istToday, weekday } from "@/lib/attendance/time";
import { leaveYearOf } from "@/lib/leave/rules";
import type { Tenant } from "@/lib/types";

const URL_ = process.env.IT_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.IT_JWT_SECRET ?? "super-secret-jwt-token-with-at-least-32-characters-long";
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload: object) => { const h = b64({ alg: "HS256", typ: "JWT" }), p = b64(payload); return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`; };
const SERVICE = jwt({ role: "service_role", exp: Math.floor(Date.now() / 1000) + 3600 });
process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = jwt({ role: "anon", exp: Math.floor(Date.now() / 1000) + 3600 });
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE;

let db: SupabaseClient;
let tenant: Tenant;
let svc: typeof import("@/lib/attendance/service");
let leave: typeof import("@/lib/leave/service");
const E1 = randomUUID(), E2 = randomUUID(), E3 = randomUUID();
const today = istToday();
// A working day (Mon–Fri) at least 3 days ago, so its night shift ends before today
let d1 = addDays(today, -3);
while ([0, 6].includes(weekday(d1))) d1 = addDays(d1, -1);
const at = (date: string, hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return new Date(istInstant(date, h * 60 + m)).toISOString(); };
const day = async (emp: string, date: string) => (await db.from("attendance_days").select("*").eq("employee_id", emp).eq("work_date", date).maybeSingle()).data;
let typeId: Record<string, string> = {};
const balance = async (emp: string, code: string, year: number) => {
  const { data } = await db.from("leave_balances").select("balance").eq("employee_id", emp).eq("leave_type_id", typeId[code]).eq("leave_year", year).maybeSingle();
  return Number(data?.balance ?? 0);
};

beforeAll(async () => {
  db = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  svc = await import("@/lib/attendance/service");
  leave = await import("@/lib/leave/service");
  const slug = `it-${Date.now().toString(36)}`;
  const { data: t, error } = await db.from("tenants").insert({ slug, name: "IT Co", emp_code_prefix: "ITC" }).select("*").single();
  if (error) throw error;
  tenant = t as Tenant;
  await db.rpc("seed_tenant_defaults", { p_tenant: tenant.id });
  const { data: shifts } = await db.from("shifts").select("id,code").eq("tenant_id", tenant.id);
  const G = shifts!.find((s) => s.code === "G")!.id;
  const { error: e2 } = await db.from("employees").insert([
    { id: E3, tenant_id: tenant.id, first_name: "Manager", status: "active", employee_code: "ITC-0003", date_of_joining: "2020-01-01", weekly_offs: [0], attendance_id: null, shift_id: null, reporting_manager_id: null },
    { id: E1, tenant_id: tenant.id, first_name: "Day", status: "active", employee_code: "ITC-0001", attendance_id: "101", shift_id: G, weekly_offs: [0], date_of_joining: "2020-01-01", reporting_manager_id: E3 },
    { id: E2, tenant_id: tenant.id, first_name: "Rotating", status: "active", employee_code: "ITC-0002", attendance_id: "102", weekly_offs: [0], date_of_joining: "2020-01-01", shift_id: null, reporting_manager_id: null },
  ]);
  if (e2) throw e2;
  const { data: types } = await db.from("leave_types").select("id,code").eq("tenant_id", tenant.id);
  typeId = Object.fromEntries(types!.map((x) => [x.code, x.id]));
});

describe("attendance pipeline (real database)", () => {
  it("stores punches, ignores duplicates, keeps unmatched IDs, and computes the days", async () => {
    const rows = [
      { attendance_id: "101", punched_at: at(d1, "09:05") }, { attendance_id: "101", punched_at: at(d1, "17:40") },
      { attendance_id: "102", punched_at: at(d1, "22:55") }, { attendance_id: "102", punched_at: at(addDays(d1, 1), "06:05") },
      { attendance_id: "999", punched_at: at(d1, "09:00") },
    ];
    const r = await svc.ingestPunches(tenant.id, rows, "csv");
    expect(r).toMatchObject({ inserted: 5, unmatched: 1 });
    expect((await svc.ingestPunches(tenant.id, rows, "csv")).inserted).toBe(0);

    const a = await day(E1, d1);
    expect(a).toMatchObject({ status: "present", worked_minutes: 8 * 60 + 35 - 30, present_days: 1 });
    const b = await day(E2, d1);
    expect(b?.status).toBe("present");
    const { data: c } = await db.from("shifts").select("code").eq("id", b!.shift_id).single();
    expect(c?.code).toBe("C");
  });

  it("marks absentees and weekly offs when a range is recalculated", async () => {
    const from = addDays(d1, -7);
    await svc.recomputeAttendance(tenant.id, "all", from, d1);
    const { data } = await db.from("attendance_days").select("work_date,status").eq("employee_id", E1).gte("work_date", from).lte("work_date", d1).order("work_date");
    expect(data!.length).toBe(8);
    for (const r of data!) {
      if (r.work_date === d1) expect(r.status).toBe("present");
      else expect(r.status).toBe(weekday(r.work_date) === 0 ? "weekly_off" : "absent");
    }
  });

  it("links earlier punches when HR sets a device ID later", async () => {
    await db.from("employees").update({ attendance_id: "999" }).eq("id", E3);
    await svc.recomputeAttendance(tenant.id, [E3], d1, d1);
    expect((await day(E3, d1))?.status).toBe("missed_punch");
  });

  it("holidays are respected", async () => {
    await db.from("holidays").insert({ tenant_id: tenant.id, holiday_date: addDays(d1, -1), name: "Test holiday" });
    await svc.recomputeAttendance(tenant.id, [E1], addDays(d1, -1), addDays(d1, -1));
    const h = await day(E1, addDays(d1, -1));
    expect(h?.status).toBe(weekday(addDays(d1, -1)) === 0 ? "weekly_off" : "holiday");
  });
});

describe("leave workflow (real database)", () => {
  const year = leaveYearOf(today, 1);

  it("credits are added once", async () => {
    const n = await leave.applyCredits(tenant.id, year, today);
    expect(n).toBeGreaterThan(0);
    expect(await leave.applyCredits(tenant.id, year, today)).toBe(0);
    expect(await balance(E1, "CL", year)).toBe(12);
    // EL: 15/yr monthly → 1.25 per month up to the current month
    expect(await balance(E1, "EL", year)).toBeCloseTo(1.25 * Number(today.slice(5, 7)), 2);
  });

  it("validates, approves, debits, updates attendance and cancels with a credit back", async () => {
    // An absent past working day, recorded by HR as casual leave
    let past = addDays(d1, -2);
    while ([0, 6].includes(weekday(past)) || past === addDays(d1, -1)) past = addDays(past, -1);
    const input = { employeeId: E1, leaveTypeId: typeId.CL, from: past, to: past, half: "none" as const, reason: "test" };
    const v = await leave.validateLeave(tenant, input, true);
    expect("days" in v && v.days).toBe(1);
    const { data: req } = await db.from("leave_requests").insert({ tenant_id: tenant.id, employee_id: E1, leave_type_id: typeId.CL, from_date: past, to_date: past, days: 1 }).select("id").single();
    await leave.approveLeave(tenant, req!.id, null as unknown as string, null);
    expect(await balance(E1, "CL", year)).toBe(11);
    expect(await day(E1, past)).toMatchObject({ status: "leave", leave_days: 1, absent_days: 0, leave_type_code: "CL" });

    const overlap = await leave.validateLeave(tenant, input, true);
    expect("error" in overlap && overlap.error).toMatch(/overlap/);

    await leave.cancelLeave(tenant, req!.id, null as unknown as string);
    expect(await balance(E1, "CL", year)).toBe(12);
    expect((await day(E1, past))?.status).toBe("absent");
  });

  it("refuses more than the balance, and skips weekly offs when counting", async () => {
    let mon = addDays(today, 14);
    while (weekday(mon) !== 1) mon = addDays(mon, 1);
    const tooMuch = await leave.validateLeave(tenant, { employeeId: E1, leaveTypeId: typeId.SL, from: mon, to: addDays(mon, 20), half: "none", reason: "x" }, false);
    expect("error" in tooMuch && tooMuch.error).toMatch(/Not enough/);
    const week = await leave.validateLeave(tenant, { employeeId: E1, leaveTypeId: typeId.SL, from: mon, to: addDays(mon, 6), half: "none", reason: "x" }, false);
    expect("days" in week && week.days).toBe(6);
    const lop = await leave.validateLeave(tenant, { employeeId: E1, leaveTypeId: typeId.LOP, from: mon, to: addDays(mon, 30), half: "none", reason: "x" }, false);
    expect("days" in lop).toBe(true);
  });

  it("pending requests reserve balance", async () => {
    let mon = addDays(today, 40);
    while (weekday(mon) !== 1) mon = addDays(mon, 1);
    if (leaveYearOf(addDays(mon, 20), 1) !== year) return;   // not enough days left in the year to test
    await db.from("leave_requests").insert({ tenant_id: tenant.id, employee_id: E1, leave_type_id: typeId.CL, from_date: mon, to_date: addDays(mon, 4), days: 5 });
    const more = await leave.validateLeave(tenant, { employeeId: E1, leaveTypeId: typeId.CL, from: addDays(mon, 7), to: addDays(mon, 20), half: "none", reason: "x" }, false);
    expect("error" in more && more.error).toMatch(/after pending/);
  });

  it("year end carries forward up to the limit and lapses the rest, once", async () => {
    const prev = year - 1;
    await db.from("leave_ledger").insert([
      { tenant_id: tenant.id, employee_id: E2, leave_type_id: typeId.EL, leave_year: prev, kind: "opening", days: 50, period: `opening-${prev}` },
      { tenant_id: tenant.id, employee_id: E2, leave_type_id: typeId.CL, leave_year: prev, kind: "opening", days: 3, period: `opening-${prev}` },
    ]);
    const r = await leave.closeLeaveYear(tenant.id, prev, null as unknown as string);
    expect(r).toEqual({ carried: 1, lapsed: 2 });
    expect(await balance(E2, "EL", prev)).toBe(45);   // 50 − 5 lapsed; 45 carried into the new year
    await leave.closeLeaveYear(tenant.id, prev, null as unknown as string);
    const { count } = await db.from("leave_ledger").select("id", { count: "exact", head: true }).eq("employee_id", E2).eq("kind", "carry_forward");
    expect(count).toBe(1);
  });
});

describe("device endpoints (real database)", () => {
  it("API key device: stores punches and rejects bad keys", async () => {
    const { hashToken } = await import("@/lib/tokens");
    const key = `hrm_${randomUUID().replace(/-/g, "")}`;
    await db.from("attendance_devices").insert({ tenant_id: tenant.id, name: "Bridge", kind: "api", key_hash: hashToken(key) });
    const { POST } = await import("@/app/api/attendance/punches/route");
    const call = (k: string, body: unknown) => POST(new Request("http://x/api/attendance/punches", { method: "POST", headers: { authorization: `Bearer ${k}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
    expect((await call("hrm_wrong_key_123456789012345", { punches: [] })).status).toBe(401);
    const d = addDays(d1, -3);
    const res = await call(key, { punches: [{ user_id: "0101", time: `${d} 09:00:00` }, { user_id: "101", time: `${d} 18:00:00` }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: 2, stored: 2, unmatched: 0 });
    expect((await day(E1, d))?.status).toBe(weekday(d) === 0 ? "weekly_off" : "present");
  });

  it("eSSL / ZKTeco ADMS push: handshake, ATTLOG upload, unknown serial refused", async () => {
    const sn = `SN${Date.now()}`;
    await db.from("attendance_devices").insert({ tenant_id: tenant.id, name: "Gate", kind: "adms", serial_no: sn });
    const { GET, POST } = await import("@/app/iclock/cdata/route");
    const hs = await GET(new Request(`http://x/iclock/cdata?SN=${sn}&options=all`));
    expect(await hs.text()).toMatch(/GET OPTION FROM/);
    expect((await GET(new Request("http://x/iclock/cdata?SN=NOPE"))).status).toBe(401);
    const d = addDays(d1, -4);
    const body = `102\t${d} 06:01:00\t0\t1\t0\t0\n102\t${d} 14:40:00\t1\t1\t0\t0\n`;
    const up = await POST(new Request(`http://x/iclock/cdata?SN=${sn}&table=ATTLOG&Stamp=1`, { method: "POST", body }));
    expect(await up.text()).toBe("OK: 2");
    const r = await day(E2, d);
    if (weekday(d) !== 0) expect(r?.status).toBe("present");
    const { data: dev } = await db.from("attendance_devices").select("last_seen_at").eq("serial_no", sn).single();
    expect(dev?.last_seen_at).toBeTruthy();
  });
});
