/**
 * Minimal but correct 5-field cron expression evaluator
 * (minute hour day-of-month month day-of-week).
 *
 * Supports: star, step (star slash n), `a`, `a-b`, `a-b/n`, comma lists, and
 * 3-letter month (jan..dec) / weekday (sun..sat) names. DOW accepts 0 or 7 = Sunday.
 * Follows Vixie-cron DOM/DOW semantics: when BOTH day-of-month and day-of-week
 * are restricted, a tick matches if EITHER field matches.
 *
 * Pure and side-effect free (aside from reading the clock the caller passes in),
 * so scheduling is unit-testable.
 */

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const DOW_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

function parseField(
  raw: string,
  min: number,
  max: number,
  names?: Record<string, number>
): { set: Set<number>; restricted: boolean } {
  const field = raw.trim().toLowerCase();
  const set = new Set<number>();
  if (field === "*") {
    for (let i = min; i <= max; i += 1) set.add(i);
    return { set, restricted: false };
  }

  const resolve = (token: string): number => {
    if (names && token in names) return names[token];
    const n = Number(token);
    if (!Number.isInteger(n)) throw new Error(`Invalid cron field token: "${token}"`);
    return n;
  };

  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step <= 0) throw new Error(`Invalid cron step: "${part}"`);

    let lo = min;
    let hi = max;
    if (rangePart !== "*") {
      const [a, b] = rangePart.split("-");
      lo = resolve(a);
      hi = b !== undefined ? resolve(b) : a !== undefined && stepPart ? max : lo;
    }
    for (let i = lo; i <= hi; i += step) {
      let v = i;
      if (max === 6 && v === 7) v = 0; // Sunday normalization handled below too
      if (v < min || v > max + (max === 6 ? 1 : 0)) continue;
      set.add(v === 7 && max === 6 ? 0 : v);
    }
  }
  return { set, restricted: true };
}

export function parseCronExpression(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Cron expression must have 5 fields, got ${parts.length}: "${expr}"`);
  }
  const minute = parseField(parts[0], 0, 59);
  const hour = parseField(parts[1], 0, 23);
  const dom = parseField(parts[2], 1, 31);
  const month = parseField(parts[3], 1, 12, MONTH_NAMES);
  const dow = parseField(parts[4], 0, 6, DOW_NAMES);
  return {
    minute: minute.set,
    hour: hour.set,
    dom: dom.set,
    month: month.set,
    dow: dow.set,
    domRestricted: dom.restricted,
    dowRestricted: dow.restricted,
  };
}

/** Calendar fields for an epoch ms, in local time or a given IANA timezone. */
function fieldsAt(ms: number, tz?: string): {
  minute: number;
  hour: number;
  dom: number;
  month: number;
  dow: number;
} {
  if (!tz) {
    const d = new Date(ms);
    return {
      minute: d.getMinutes(),
      hour: d.getHours(),
      dom: d.getDate(),
      month: d.getMonth() + 1,
      dow: d.getDay(),
    };
  }
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ms))) parts[p.type] = p.value;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0; // some engines emit 24 for midnight
  const minute = Number(parts.minute);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { minute, hour, dom: day, month, dow };
}

const MAX_MINUTES = 366 * 24 * 60; // search up to ~1 year ahead

/**
 * Next epoch-ms at which the cron expression fires, strictly after `fromMs`.
 * Resolution is one minute; seconds are zeroed. Throws on invalid expressions.
 */
export function nextCronRun(expr: string, fromMs: number = Date.now(), tz?: string): number {
  const fields = parseCronExpression(expr);
  // Start at the next whole minute after fromMs.
  let candidate = Math.floor(fromMs / 60000) * 60000 + 60000;

  for (let i = 0; i < MAX_MINUTES; i += 1) {
    const f = fieldsAt(candidate, tz);
    if (fields.minute.has(f.minute) && fields.hour.has(f.hour) && fields.month.has(f.month)) {
      const domOk = fields.dom.has(f.dom);
      const dowOk = fields.dow.has(f.dow);
      // Vixie semantics: both restricted -> OR; otherwise the restricted one (or *) wins.
      const dayOk =
        fields.domRestricted && fields.dowRestricted
          ? domOk || dowOk
          : fields.domRestricted
            ? domOk
            : fields.dowRestricted
              ? dowOk
              : true;
      if (dayOk) return candidate;
    }
    candidate += 60000;
  }
  throw new Error(`Cron expression "${expr}" did not match within a year`);
}
