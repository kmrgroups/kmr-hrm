import { p } from "@/lib/base-path";
import { requireRole } from "@/lib/auth";
import { listBackups, KEEP_DAYS } from "@/lib/data-tools";
import { AppShell } from "@/components/AppShell";
import { ActionForm } from "@/components/ActionForm";
import { AutoBackupToggle } from "@/components/AutoBackup";
import { Empty, fmtDate } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { importCompanyJson } from "./actions";

export const metadata = { title: "Data & backups" };

export default async function DataPage() {
  const session = await requireRole(["hr_manager"]);
  const t = session.tenant;
  const backups = await listBackups(t.id);
  return (
    <AppShell session={session} active="/app/settings/data">
      <div className="pagehead"><div><h1>Data &amp; backups</h1><p>A JSON copy of all your data, and the automatic nightly backups.</p></div></div>

      <div className="grid two">
        <div className="card">
          <h2>JSON download &amp; upload</h2>
          <p className="muted">Download everything — company settings, employees, documents list, attendance, leave and ID cards — as one JSON file. Uploading a file from this company restores it (logins are kept).</p>
          <a className="btn" href={p("/api/data/export")}><Icon name="download" /> Download JSON now</a>
          <details style={{ marginTop: 14 }}>
            <summary className="btn secondary small">Restore from a JSON file…</summary>
            <div className="alert warn" style={{ marginTop: 10 }}>Restoring <b>replaces</b> the company&apos;s current data with the file&apos;s. A safety copy of the current data is saved first under today&apos;s backup.</div>
            <ActionForm action={importCompanyJson} submitLabel="Restore" variant="danger" pendingLabel="Restoring…">
              <input type="file" name="file" accept="application/json,.json" required />
              <label className="field">Type the company name to confirm<input name="confirm" placeholder={t.name} required /></label>
            </ActionForm>
          </details>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Nightly backups</h2>
        <p className="muted">A full backup is saved automatically every night at 12 AM (India time) and kept for {KEEP_DAYS} days.</p>
        <AutoBackupToggle />
        {backups.length ? (
          <div className="tablewrap" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>Date</th><th className="num">Size</th><th></th></tr></thead>
              <tbody>{backups.map((b) => (
                <tr key={b.date}><td>{fmtDate(b.date)}</td><td className="num">{b.size ? `${Math.round(b.size / 1024)} KB` : ""}</td>
                  <td style={{ textAlign: "right" }}><a className="btn ghost small" href={p(`/api/data/backup?date=${b.date}`)}>Download</a></td></tr>))}
              </tbody>
            </table>
          </div>
        ) : <Empty>The first backup is saved tonight at 12 AM.</Empty>}
      </div>
    </AppShell>
  );
}
