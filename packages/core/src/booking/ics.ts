/** BK-09. Minimal RFC 5545 calendar file. Contains no health information. */
export interface IcsInput {
  bookingRef: string;
  startAt: Date;
  endAt: Date;
  serviceName: string;
  clinicName: string;
  clinicAddress: string;
  clinicPhone: string;
  now?: Date;
  domain?: string;
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Fold lines longer than 75 octets as the spec requires. */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let i = 0;
  let limit = 75;
  while (i < bytes.length) {
    let end = Math.min(i + limit, bytes.length);
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--; // never split a UTF-8 character
    parts.push(bytes.subarray(i, end).toString("utf8"));
    i = end;
    limit = 74; // continuation lines start with a space
  }
  return parts.join("\r\n ");
}

export function buildIcs(i: IcsInput): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Royal Medics Clinic//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${i.bookingRef}@${i.domain ?? "royalclinicmedics.ie"}`,
    `DTSTAMP:${stamp(i.now ?? new Date())}`,
    `DTSTART:${stamp(i.startAt)}`,
    `DTEND:${stamp(i.endAt)}`,
    `SUMMARY:${esc(`${i.serviceName} at ${i.clinicName}`)}`,
    `LOCATION:${esc(i.clinicAddress)}`,
    `DESCRIPTION:${esc(`Booking reference ${i.bookingRef}. Phone ${i.clinicPhone}.`)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Appointment reminder",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
