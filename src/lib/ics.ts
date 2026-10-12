/** Minimal iCalendar (RFC 5545) file for one event. */
export function icsFor(e: { id: string; title: string; description: string; starts_at: string; ends_at: string; url: string }, now = new Date()): string {
  const stamp = (iso: string | Date) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
  // Lines longer than 75 octets are folded with CRLF + space.
  const fold = (line: string) => {
    const out: string[] = [];
    let rest = line;
    while (rest.length > 74) {
      out.push(rest.slice(0, 74));
      rest = " " + rest.slice(74);
    }
    out.push(rest);
    return out.join("\r\n");
  };
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OpenCtrl//Ctrl Room//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.id}@ctrlroom`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(e.starts_at)}`,
    `DTEND:${stamp(e.ends_at)}`,
    `SUMMARY:${esc(e.title)}`,
    `DESCRIPTION:${esc([e.description, e.url].filter(Boolean).join("\n\n"))}`,
    `URL:${e.url}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .map(fold)
    .join("\r\n");
}
