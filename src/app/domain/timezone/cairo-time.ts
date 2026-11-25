export const CAIRO_TIMEZONE = 'Africa/Cairo';

export type DstDisambiguation = 'earlier' | 'later' | 'reject';

export interface CairoDateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** 0 = Sunday, 1 = Monday, ..., 6 = Saturday */
  readonly dayOfWeek: number;
  /** YYYY-MM-DD in Africa/Cairo */
  readonly dateKey: string;
  /** Offset from UTC in minutes (e.g. +120 for UTC+2, +180 for UTC+3). */
  readonly offsetMinutes: number;
}

export type CairoLocalResolution =
  | { readonly status: 'exact'; readonly date: Date }
  | {
      readonly status: 'ambiguous';
      readonly earlier: Date;
      readonly later: Date;
      readonly date: Date | null;
    }
  | { readonly status: 'nonexistent'; readonly date: null };

const ISO_WITH_TZ_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/i;

const DATE_KEY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

const WEEKDAY_MAP: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

const cairoPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CAIRO_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() + 1 === month &&
    probe.getUTCDate() === day
  );
}

/**
 * Strictly parses an ISO-8601 timestamp containing an explicit UTC 'Z' or numeric offset ('±HH:MM').
 * Returns null for offset-less strings, invalid calendar dates (e.g. Feb 30), or invalid times.
 */
export function parseIsoTimestamp(iso: string): Date | null {
  const match = ISO_WITH_TZ_REGEX.exec(iso.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] !== undefined ? Number(match[6]) : 0;
  const tzPart = match[8];

  if (!isValidCalendarDate(year, month, day)) {
    return null;
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  if (tzPart.toUpperCase() !== 'Z') {
    const offsetHours = Number(tzPart.slice(1, 3));
    const offsetMins = Number(tzPart.slice(4, 6));
    if (offsetHours > 14 || offsetMins > 59) {
      return null;
    }
  }

  const parsed = new Date(iso.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Extracts wall-clock date/time components and active UTC offset for an instant in Africa/Cairo.
 */
export function getCairoParts(date: Date): CairoDateTimeParts {
  const parts = cairoPartsFormatter.formatToParts(date);
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let dayOfWeek = 0;

  for (const part of parts) {
    switch (part.type) {
      case 'year':
        year = Number(part.value);
        break;
      case 'month':
        month = Number(part.value);
        break;
      case 'day':
        day = Number(part.value);
        break;
      case 'hour':
        hour = Number(part.value) % 24;
        break;
      case 'minute':
        minute = Number(part.value);
        break;
      case 'second':
        second = Number(part.value);
        break;
      case 'weekday':
        dayOfWeek = WEEKDAY_MAP[part.value] ?? 0;
        break;
      default:
        break;
    }
  }

  const wallAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const actualTruncatedMs = Math.floor(date.getTime() / 1000) * 1000;
  const offsetMinutes = Math.round((wallAsUtcMs - actualTruncatedMs) / 60_000);

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dayOfWeek,
    dateKey: `${year}-${pad2(month)}-${pad2(day)}`,
    offsetMinutes
  };
}

/**
 * Resolves a Cairo wall-clock date/time to UTC instant(s), explicitly detecting
 * DST nonexistent times (spring-forward gap) and ambiguous times (fall-back overlap).
 */
export function resolveCairoLocalDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  disambiguation: DstDisambiguation = 'earlier'
): CairoLocalResolution {
  if (!isValidCalendarDate(year, month, day) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return { status: 'nonexistent', date: null };
  }

  const targetWallUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const probeWindowMs = 12 * 60 * 60 * 1000;

  // Sampling offsets 12h before and 12h after captures both sides of any DST transition.
  const candidateOffsets = new Set<number>([
    getCairoParts(new Date(targetWallUtcMs - probeWindowMs)).offsetMinutes,
    getCairoParts(new Date(targetWallUtcMs)).offsetMinutes,
    getCairoParts(new Date(targetWallUtcMs + probeWindowMs)).offsetMinutes
  ]);

  const matchedMs = new Set<number>();
  for (const offsetMinutes of candidateOffsets) {
    const candidateMs = targetWallUtcMs - offsetMinutes * 60_000;
    const check = getCairoParts(new Date(candidateMs));
    if (
      check.year === year &&
      check.month === month &&
      check.day === day &&
      check.hour === hour &&
      check.minute === minute
    ) {
      matchedMs.add(candidateMs);
    }
  }

  const sorted = Array.from(matchedMs)
    .sort((a, b) => a - b)
    .map((ms) => new Date(ms));

  if (sorted.length === 0) {
    return { status: 'nonexistent', date: null };
  }

  if (sorted.length === 1) {
    return { status: 'exact', date: sorted[0] };
  }

  const [earlier, later] = sorted;
  const resolved =
    disambiguation === 'earlier' ? earlier : disambiguation === 'later' ? later : null;

  return {
    status: 'ambiguous',
    earlier,
    later,
    date: resolved
  };
}

export function parseDateKey(dateKey: string): { year: number; month: number; day: number } | null {
  const match = DATE_KEY_REGEX.exec(dateKey);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidCalendarDate(year, month, day)) {
    return null;
  }
  return { year, month, day };
}

export function resolveCairoDateKeyTime(
  dateKey: string,
  hour: number,
  minute: number,
  disambiguation: DstDisambiguation = 'earlier'
): CairoLocalResolution {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    return { status: 'nonexistent', date: null };
  }
  return resolveCairoLocalDateTime(parsed.year, parsed.month, parsed.day, hour, minute, disambiguation);
}

/**
 * Adds whole calendar days to a YYYY-MM-DD Cairo date key without DST drift.
 */
export function addCairoDays(dateKey: string, days: number): string {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    throw new Error(`Invalid Cairo date key: ${dateKey}`);
  }
  const d = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function formatTimeHHMM(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

/**
 * Formats an instant as an ISO-8601 string with its active Africa/Cairo numeric offset (e.g. +02:00 or +03:00).
 */
export function formatCairoOffsetIso(date: Date): string {
  const p = getCairoParts(date);
  const sign = p.offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(p.offsetMinutes);
  const offH = Math.floor(absOffset / 60);
  const offM = absOffset % 60;
  return `${p.dateKey}T${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}${sign}${pad2(offH)}:${pad2(offM)}`;
}
