import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { DEFAULT_TEMPLATES, EVENT_LABELS, type NotificationEvent } from "@/lib/notify/templates";
import { saveTemplate } from "../actions";

export const metadata = { title: "Message templates" };

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const session = await requireRole(["hr_manager"]);
  const { e } = await searchParams;
  const events = Object.keys(DEFAULT_TEMPLATES) as NotificationEvent[];
  const event = events.includes(e as NotificationEvent) ? (e as NotificationEvent) : events[0];
  const supabase = await createClient();
  const { data: rows } = await supabase.from("notification_templates").select("event,channel,subject,body,wa_template,active").eq("event", event);
  const def = DEFAULT_TEMPLATES[event];
  const email = rows?.find((r) => r.channel === "email");
  const wa = rows?.find((r) => r.channel === "whatsapp");
  const vars = [...new Set([...(def.email + def.whatsapp + def.subject).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];

  return (
    <AppShell session={session} active="/app/settings/templates">
      <div className="pagehead"><div><h1>Message templates</h1><p>The wording of every automatic email and WhatsApp message.</p></div></div>
      <div className="tabs">
        {events.map((ev) => <a key={ev} href={`?e=${ev}`} className={ev === event ? "active" : ""}>{EVENT_LABELS[ev]}</a>)}
      </div>
      <div className="card">
        <h2>{EVENT_LABELS[event]} {rows?.length ? <span className="badge info">Customised</span> : <span className="badge">Default</span>}</h2>
        <p className="muted" style={{ fontSize: 13.5 }}>
          Placeholders: {vars.map((v) => <code key={v} className="mono" style={{ marginRight: 6 }}>{`{{${v}}}`}</code>)}
          <br />A line like <code className="mono">[[Button text|{"{{link}}"}]]</code> becomes a button in email.
        </p>
        <ActionForm action={saveTemplate} submitLabel="Save wording" hidden={{ event }}>
          <div className="grid two">
            <div className="stack">
              <label className="check"><input type="checkbox" name="email_on" value="1" defaultChecked={email ? email.active : true} /> Send by email</label>
              <label className="field">Subject<input name="subject" defaultValue={email?.subject ?? def.subject} /></label>
              <label className="field">Email text<textarea name="email_body" rows={14} defaultValue={email?.body ?? def.email} /></label>
            </div>
            <div className="stack">
              <label className="check"><input type="checkbox" name="wa_on" value="1" defaultChecked={wa ? wa.active : true} /> Send on WhatsApp</label>
              <label className="field">Approved WhatsApp template name<input name="wa_template" defaultValue={wa?.wa_template ?? def.wa_template} />
                <span className="help">Business-initiated WhatsApp messages must use a template approved in Meta Business Manager. Its variables are filled in this order: {def.wa_params.join(", ")}.</span>
              </label>
              <label className="field">WhatsApp text (preview / test mode)<textarea name="wa_body" rows={8} defaultValue={wa?.body ?? def.whatsapp} /></label>
            </div>
          </div>
        </ActionForm>
        {rows?.length ? (
          <div style={{ marginTop: 10 }}>
            <ActionForm action={saveTemplate} submitLabel="Restore default wording" variant="secondary" hidden={{ event, reset: "1" }} confirm="Discard your changes to this message?" />
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
