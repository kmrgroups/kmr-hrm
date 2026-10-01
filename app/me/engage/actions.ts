"use server";
// Engagement — the employee's side: read / acknowledge announcements, send suggestions, thank a colleague, answer surveys.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { setFlash } from "@/lib/flash";
import { notify } from "@/lib/notify";
import { currentOrigin } from "@/lib/tenant";
import { fullName } from "@/components/ui";
import { REC_CATEGORIES, SUG_CATEGORIES, type Question } from "@/lib/engage/rules";
import type { ActionState } from "@/app/app/employees/actions";

const fail = (e: unknown): ActionState => ({ error: (e as Error).message });
const str = (f: FormData, k: string, max = 500) => String(f.get(k) ?? "").trim().slice(0, max);
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);
const uuid = (f: FormData, k: string) => { const v = str(f, k, 40); return isId(v) ? v : null; };

async function me() {
  const s = await requireSession();
  if (!s.user.employee_id) throw new Error("This is for employees.");
  return s;
}

export async function acknowledge(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await me();
    const id = uuid(f, "id"); if (!id) return { error: "Not found." };
    const db = await createClient();
    const { data: a } = await db.from("announcements").select("id,needs_ack").eq("id", id).maybeSingle();
    if (!a) return { error: "Not found." };
    const now = new Date().toISOString();
    const { error } = await db.from("announcement_reads").upsert({ tenant_id: s.tenant.id, announcement_id: id, employee_id: s.user.employee_id, read_at: now, ...(a.needs_ack ? { acknowledged_at: now } : {}) },
      { onConflict: "announcement_id,employee_id" });
    if (error) return { error: error.message };
    revalidatePath("/me/engage"); revalidatePath("/me");
    const ok = a.needs_ack ? "Thank you — acknowledged." : "Marked as read.";
    await setFlash({ ok });
    return { ok, flashed: true };
  } catch (e) { return fail(e); }
}

export async function sendSuggestion(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await me();
    const title = str(f, "title", 160), problem = str(f, "problem", 2000), idea = str(f, "idea", 2000), category = str(f, "category", 20);
    if (title.length < 3) return { error: "Give your idea a short title." };
    if (problem.length < 3) return { error: "What is the problem today?" };
    if (idea.length < 3) return { error: "What should we change?" };
    const db = await createClient();
    const { data, error } = await db.from("suggestions").insert({ tenant_id: s.tenant.id, employee_id: s.user.employee_id, title, problem, idea, area: str(f, "area", 120) || null,
      team: str(f, "team", 300) || null, category: category in SUG_CATEGORIES ? category : "other", status: "submitted" }).select("id,ref").single();
    if (error) return { error: error.message };
    revalidatePath("/me/engage"); revalidatePath("/app/engage/suggestions");
    return { ok: `Thank you! Your suggestion ${data.ref} is sent. You will hear what is decided.` };
  } catch (e) { return fail(e); }
}

export async function thankColleague(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await me();
    const emp = uuid(f, "employee_id"), category = str(f, "category", 30), message = str(f, "message", 1000);
    if (!emp) return { error: "Choose the colleague." };
    if (emp === s.user.employee_id) return { error: "Choose a colleague, not yourself." };
    if (!(category in REC_CATEGORIES) || category === "employee_of_month") return { error: "Choose what it is for." };
    if (message.length < 3) return { error: "Write a line of thanks." };
    const db = await createClient();
    const { data: rec, error } = await db.from("recognitions").insert({ tenant_id: s.tenant.id, employee_id: emp, category, message, given_by: s.user.id, given_by_name: s.user.full_name,
      given_by_employee_id: s.user.employee_id, kind: "peer" }).select("id").single();
    if (error) return { error: error.message.includes("row-level") ? "You cannot thank this person." : error.message };
    const { data: e } = await createAdminClient().from("employees").select("first_name,last_name,email,mobile").eq("id", emp).eq("tenant_id", s.tenant.id).maybeSingle();
    if (e) await notify({ tenant: s.tenant, event: "recognition_received", to: { name: fullName(e), email: e.email, phone: e.mobile }, channels: ["email"], related: { type: "recognitions", id: rec.id },
      vars: { giver: s.user.full_name, category: REC_CATEGORIES[category]!, message, link: `${await currentOrigin()}/me/engage` } });
    revalidatePath("/me/engage"); revalidatePath("/app/engage/recognition");
    return { ok: `Your thanks to ${e ? fullName(e) : "your colleague"} is on the wall.` };
  } catch (e) { return fail(e); }
}

export async function answerSurvey(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    await me();
    const id = uuid(f, "survey_id"); if (!id) return { error: "Not found." };
    const db = await createClient();
    const { data: sv } = await db.from("surveys").select("questions").eq("id", id).maybeSingle();
    if (!sv) return { error: "This survey is not for you, or it is closed." };
    const answers: Record<string, string | number> = {};
    for (const q of sv.questions as Question[]) {
      const v = str(f, q.id, 2000);
      if (!v) { if (q.required) return { error: `Please answer: ${q.text}` }; continue; }
      answers[q.id] = q.type === "rating" || q.type === "enps" ? Number(v) : v;
    }
    const { error } = await db.rpc("submit_survey", { p_survey: id, p_answers: answers });
    if (error) return { error: error.message };
  } catch (e) { return fail(e); }
  await setFlash({ ok: "Thank you! Your answers are in." });
  revalidatePath("/me/engage");
  redirect("/me/engage");
}
