/**
 * Irish public holidays (BK-15). Pre-loaded into core.clinic_holidays and editable in admin.
 * Weekend substitute days are NOT computed: admin should add them if the clinic closes.
 */
export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Day of week, 0 = Sunday. */
const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

function firstMonday(y: number, m: number): number {
  return 1 + ((8 - dow(y, m, 1)) % 7);
}

function lastMonday(y: number, m: number): number {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return last - ((dow(y, m, last) + 6) % 7);
}

/** Anonymous Gregorian algorithm. Returns { month, day } of Easter Sunday. */
function easter(y: number): { month: number; day: number } {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  return { month: Math.floor((h + l - 7 * m + 114) / 31), day: ((h + l - 7 * m + 114) % 31) + 1 };
}

export function irishPublicHolidays(year: number): Holiday[] {
  const e = easter(year);
  const easterMonday = new Date(Date.UTC(year, e.month - 1, e.day + 1));
  // St Brigid's Day: first Monday of February, or 1 Feb if that is a Friday.
  const brigid = dow(year, 2, 1) === 5 ? 1 : firstMonday(year, 2);
  return [
    { date: iso(year, 1, 1), name: "New Year's Day" },
    { date: iso(year, 2, brigid), name: "St Brigid's Day" },
    { date: iso(year, 3, 17), name: "St Patrick's Day" },
    {
      date: iso(year, easterMonday.getUTCMonth() + 1, easterMonday.getUTCDate()),
      name: "Easter Monday",
    },
    { date: iso(year, 5, firstMonday(year, 5)), name: "May Bank Holiday" },
    { date: iso(year, 6, firstMonday(year, 6)), name: "June Bank Holiday" },
    { date: iso(year, 8, firstMonday(year, 8)), name: "August Bank Holiday" },
    { date: iso(year, 10, lastMonday(year, 10)), name: "October Bank Holiday" },
    { date: iso(year, 12, 25), name: "Christmas Day" },
    { date: iso(year, 12, 26), name: "St Stephen's Day" },
  ].sort((x, y) => x.date.localeCompare(y.date));
}
