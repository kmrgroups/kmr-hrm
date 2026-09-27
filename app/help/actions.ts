"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionState } from "@/app/app/employees/actions";
import pkg from "@/package.json";

// Tickets go to the KMR Console (schema "console") with the service key, after the HRM has checked who is signed in.
const consoleDb = () => createAdminClient().schema("console");

export async function raiseTicket(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await requireSession();
    const subject = String(form.get("subject") ?? "").trim();
    const body = String(form.get("body") ?? "").trim();
    const priority = ["low", "normal", "high", "urgent"].includes(String(form.get("priority"))) ? String(form.get("priority")) : "normal";
    if (subject.length < 3) return { error: "Give the ticket a short title." };
    if (body.length < 10) return { error: "Please describe the problem in a sentence or two." };
    const ref = (await headers()).get("referer");
    const db = consoleDb();
    const { data: t, error } = await db.from("tickets").insert({
      product_code: "hrm", product_ref: tenant.id, raised_by_email: user.email, raised_by_name: user.full_name,
      subject: subject.slice(0, 150), priority, page_url: ref, app_version: pkg.version,
    }).select("id,number").single();
    if (error || !t) return { error: "Could not send the ticket right now. Please try again, or email KMR." };
    await db.from("ticket_messages").insert({ ticket_id: t.id, author_kind: "customer", author_name: user.full_name, body: body.slice(0, 5000) });
    revalidatePath("/help");
    return { ok: `Ticket ${t.number} sent to KMR support. You'll see their reply here.` };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function replyToTicket(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { user, tenant } = await requireSession();
    const id = String(form.get("id") ?? "");
    const body = String(form.get("body") ?? "").trim();
    if (!body) return { error: "Write a reply first." };
    const db = consoleDb();
    const { data: t } = await db.from("tickets").select("id").eq("id", id).eq("product_code", "hrm").eq("product_ref", tenant.id).maybeSingle();
    if (!t) return { error: "Ticket not found." };
    await db.from("ticket_messages").insert({ ticket_id: id, author_kind: "customer", author_name: user.full_name, body: body.slice(0, 5000) });
    revalidatePath("/help");
    return { ok: "Reply sent." };
  } catch (e) { return { error: (e as Error).message }; }
}
