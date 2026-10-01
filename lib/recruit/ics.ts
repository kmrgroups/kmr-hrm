// Calendar invite (.ics) for an interview — opens in Outlook, Gmail and phone calendars; free, no calendar API.
export interface IcsEvent {
  uid: string; start: Date; durationMin: number; title: string; description: string; location?: string;
  organizer?: { name: string; email: string }; attendees?: { name?: string; email: string }[]; method?: "REQUEST" | "CANCEL"; sequence?: number;
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const escText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** lines longer than 75 octets are folded, as the calendar standard (RFC 5545) requires */
const fold = (line: string) => { const out: string[] = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74); } out.push(s); return out.join("\r\n"); };

export function buildIcs(e: IcsEvent): string {
  const end = new Date(e.start.getTime() + e.durationMin * 60000);
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//KMR Group//HRM Suite//EN", "CALSCALE:GREGORIAN", `METHOD:${e.method ?? "REQUEST"}`,
    "BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(end)}`,
    `SEQUENCE:${e.sequence ?? 0}`, `SUMMARY:${escText(e.title)}`, `DESCRIPTION:${escText(e.description)}`,
    e.location ? `LOCATION:${escText(e.location)}` : "",
    e.organizer ? `ORGANIZER;CN=${escText(e.organizer.name)}:mailto:${e.organizer.email}` : "",
    ...(e.attendees ?? []).map((a) => `ATTENDEE;CN=${escText(a.name || a.email)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${a.email}`),
    `STATUS:${e.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", "DESCRIPTION:Interview in 30 minutes", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean);
  return lines.map(fold).join("\r\n") + "\r\n";
}
