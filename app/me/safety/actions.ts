"use server";
// Safety — the employee's side: report a near miss / unsafe act / unsafe condition, and finish the actions given to him.
import { revalidatePath } from "next/cache";
import { assertUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { setFlash } from "@/lib/flash";
import { currentOrigin } from "@/lib/tenant";
import { istToday } from "@/lib/attendance/time";
import { EMPLOYEE_KINDS } from "@/lib/safety/rules";
import { notifyReported } from "@/lib/safety/service";
import { uploadSafetyFile } from "@/lib/safety/upload";
import type { ActionState } from "@/app/app/employees/actions";

const str = (f: FormData, k: string, max = 500) => String(f.get(k) ?? "").trim().slice(0, max);

export async function reportSafety(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertUser("hrm.skill-matrix-training-safety");
    if (!s.user.employee_id) return { error: "This is for employees." };
    const kind = str(f, "kind", 30), description = str(f, "description", 3000), area = str(f, "area", 160);
    if (!EMPLOYEE_KINDS.includes(kind)) return { error: "Choose what you saw." };
    if (area.length < 2) return { error: "Where was it?" };
    if (description.length < 5) return { error: "Tell us what you saw." };
    const photo = await uploadSafetyFile(s.tenant.id, f, "photo"); if (photo && typeof photo === "object") return photo;
    const db = await createClient();
    const { data: me } = await db.from("employees").select("plant_id,department_id").eq("id", s.user.employee_id).single();
    const { data, error } = await db.from("incidents").insert({ tenant_id: s.tenant.id, kind, occurred_at: new Date().toISOString(), area, description, plant_id: me?.plant_id ?? null,
      department_id: me?.department_id ?? null, photo_path: photo as string | null, reported_by: s.user.id, reported_by_name: s.user.full_name, reported_by_employee_id: s.user.employee_id, status: "reported" })
      .select("*").single();
    if (error) return { error: error.message };
    await notifyReported(s.tenant, data, await currentOrigin());
    revalidatePath("/me/safety"); revalidatePath("/app/safety");
    return { ok: `Thank you! Your report ${data.ref} has gone to the safety officer. Reporting before someone gets hurt is how accidents are prevented.` };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function myActionDone(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await assertUser("hrm.skill-matrix-training-safety");
    if (!s.user.employee_id) return { error: "This is for employees." };
    const id = String(f.get("id") ?? "");
    if (!/^[0-9a-f-]{36}$/.test(id)) return { error: "Not found." };
    const db = await createClient();
    const { data: a } = await db.from("incident_actions").select("id,status,owner_employee_id").eq("id", id).maybeSingle();   // only his own (row-level security)
    if (!a || a.owner_employee_id !== s.user.employee_id) return { error: "Not found." };
    if (a.status === "done") return { error: "Already done." };
    const note = str(f, "done_note", 1000);
    if (note.length < 3) return { error: "Say what you did." };
    await createAdminClient().from("incident_actions").update({ status: "done", done_on: istToday(), done_note: `${note} — ${s.user.full_name}` }).eq("id", id);
    revalidatePath("/me/safety"); revalidatePath("/app/safety");
    await setFlash({ ok: "Thank you — marked done. The safety officer checks it before the incident is closed." });
    return { ok: "Done.", flashed: true };
  } catch (e) { return { error: (e as Error).message }; }
}
