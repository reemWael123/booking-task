import { parseDateKey } from '../timezone/cairo-time';

export const MAX_BOOKING_DURATION_MINUTES = 120;
export const BOOKING_BUFFER_MINUTES = 15;
export const MAX_DAILY_BOOKINGS_PER_USER = 3;
export const MAX_RECURRENCE_WEEKS = 4;

export interface WorkingHoursWindow {
  /** Inclusive opening time in minutes from Cairo midnight (e.g. 480 = 08:00). */
  readonly openMinute: number;
  /** Exclusive/closing boundary in minutes from Cairo midnight (e.g. 1080 = 18:00). */
  readonly closeMinute: number;
}

/**
 * Cairo office working hours:
 * - Sunday (0) to Thursday (4): 08:00–18:00
 * - Friday (5): 08:00–13:00
 * - Saturday (6): Closed (null)
 */
export function getWorkingHoursForDay(dayOfWeek: number): WorkingHoursWindow | null {
  if (dayOfWeek >= 0 && dayOfWeek <= 4) {
    return { openMinute: 8 * 60, closeMinute: 18 * 60 };
  }
  if (dayOfWeek === 5) {
    return { openMinute: 8 * 60, closeMinute: 13 * 60 };
  }
  return null;
}

export function getWorkingHoursForDateKey(dateKey: string): WorkingHoursWindow | null {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    return null;
  }
  const dayOfWeek = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
  return getWorkingHoursForDay(dayOfWeek);
}
