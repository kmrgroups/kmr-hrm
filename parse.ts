// Reads punches from the formats biometric systems produce. All local times are India time.

import { istInstant } from "./time";

/** Device user IDs: numeric IDs lose leading zeros ("00101" = "101"), everything else is kept as typed. */
export function normalizeAttendanceId(v: string): string {
  const t = v.trim();
  return /^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, "") : t;
}

export interface PunchRow { attendance_id: string; punched_at: string; direction?: "in" | "out" | null }
export interface ParseResult { rows: PunchRow[]; errors: string[] }

/**
 * Local date-time text → ISO instant. Accepts
 *   2026-09-21 09:05[:00]   21-09-2026 09:05   21/09/2026 9:05 AM   2026-09-21T09:05:00+05:30 (explicit zone kept)
 */
export function parseLocalDateTime(text: string): string | null {
  const s = text.trim().replace(/\s+/g, " ");
  if (!s) return null;
  if (/[T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s) && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = Date.parse(s.replace(" ", "T"));
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const m = s.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let [, a, b, c, hh, mi, ss, ap] = m;
  let y: number, mo: number, d: number;
  if (a.length === 4) { y = +a; mo = +b; d = +c; } else if (c.length === 4) { d = +a; mo = +b; y = +c; } else return null;
  let h = +hh;
  if (ap) { const pm = ap.toLowerCase() === "pm"; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || +mi > 59 || +(ss ?? 0) > 59) return null;
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) return null;   // e.g. 31/02
  const date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const t = istInstant(date, h * 60 + +mi) + (+(ss ?? 0)) * 1000;
  return new Date(t).toISOString();
}

function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * CSV / TSV exported from eSSL eTimeTrackLite, ZKTeco, Matrix, Realtime or a spreadsheet.
 * Needs an employee / user ID column and either one date-time column or separate date and time columns.
 * A header row is detected by name; without one, the columns are taken as: ID, date-time (or ID, date, time).
 */
export function parseCsv(text: string): ParseResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  const errors: string[] = [];
  const rows: PunchRow[] = [];
  if (!lines.length) return { rows, errors: ["The file is empty."] };
  const delim = [",", "\t", ";", "|"].map((d) => [d, lines[0].split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];

  const head = splitLine(lines[0], delim).map((h) => h.toLowerCase());
  const find = (re: RegExp) => head.findIndex((h) => re.test(h));
  let idCol = find(/(^|\b|_)(emp(loyee)?[ _]?(code|id|no)?|user[ _]?id|enrol+(ment)?[ _]?(no|id)?|pin|card[ _]?no|badge|att(endance)?[ _]?id)(\b|$)/);
  let dtCol = find(/(date[ _-]?time|punch[ _]?time|timestamp|log[ _]?time|check[ _]?time)/);
  let dCol = find(/^(punch[ _])?date$/);
  let tCol = find(/^(punch[ _])?time$/);
  let start = 1;
  const hasHeader = idCol >= 0 && (dtCol >= 0 || (dCol >= 0 && tCol >= 0));
  if (!hasHeader) {
    const first = splitLine(lines[0], delim);
    if (first.length >= 2 && (parseLocalDateTime(first[1]) || (first.length >= 3 && parseLocalDateTime(`${first[1]} ${first[2]}`)))) {
      start = 0;
    } else if (head.some((h) => /[a-z]/.test(h))) {
      return { rows, errors: ["Could not find the columns. The file needs an employee / user ID column and a date-time column (or separate Date and Time columns)."] };
    }
    idCol = 0;
    const probe = splitLine(lines[start] ?? "", delim);
    if (parseLocalDateTime(probe[1] ?? "")) { dtCol = 1; dCol = -1; tCol = -1; } else { dtCol = -1; dCol = 1; tCol = 2; }
  }

  for (let i = start; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim);
    const id = normalizeAttendanceId(cells[idCol] ?? "");
    const raw = dtCol >= 0 ? cells[dtCol] ?? "" : `${cells[dCol] ?? ""} ${cells[tCol] ?? ""}`;
    const ts = parseLocalDateTime(raw);
    if (!id || !ts) {
      if (errors.length < 10) errors.push(`Line ${i + 1}: could not read "${lines[i].slice(0, 60)}"`);
      continue;
    }
    rows.push({ attendance_id: id, punched_at: ts });
  }
  if (errors.length === 10) errors.push("…more lines could not be read.");
  return { rows, errors };
}

/**
 * ZKTeco / eSSL "ADMS" push (POST /iclock/cdata?table=ATTLOG). One punch per line:
 *   PIN <TAB> YYYY-MM-DD HH:MM:SS <TAB> status <TAB> verify ...
 * status 0 = check-in, 1 = check-out (other values are ignored for direction).
 */
export function parseAdmsAttlog(body: string): PunchRow[] {
  const rows: PunchRow[] = [];
  for (const line of body.split(/\r?\n/)) {
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const id = normalizeAttendanceId(parts[0]);
    const ts = parseLocalDateTime(parts[1]);
    if (!id || !ts) continue;
    const st = parts[2]?.trim();
    rows.push({ attendance_id: id, punched_at: ts, direction: st === "0" ? "in" : st === "1" ? "out" : null });
  }
  return rows;
}

/** JSON body for POST /api/attendance/punches */
export function parseApiPayload(body: unknown): ParseResult {
  const list = (body as { punches?: unknown })?.punches;
  if (!Array.isArray(list)) return { rows: [], errors: ['Body must be {"punches": [{"user_id": "101", "time": "2026-09-21 09:05:00"}]}'] };
  const rows: PunchRow[] = [];
  const errors: string[] = [];
  list.slice(0, 5000).forEach((p, i) => {
    const o = (p ?? {}) as Record<string, unknown>;
    const id = normalizeAttendanceId(String(o.attendance_id ?? o.user_id ?? o.employee_code ?? ""));
    const ts = parseLocalDateTime(String(o.punched_at ?? o.time ?? ""));
    const dir = o.direction === "in" || o.direction === "out" ? o.direction : null;
    if (!id || !ts) { if (errors.length < 20) errors.push(`punches[${i}]: needs user_id and time`); return; }
    rows.push({ attendance_id: id, punched_at: ts, direction: dir });
  });
  if (list.length > 5000) errors.push("Only the first 5000 punches were read; send the rest in another request.");
  return { rows, errors };
}
