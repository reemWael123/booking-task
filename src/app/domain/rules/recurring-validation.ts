import {
  Booking,
  BookingRequest,
  RecurringBookingRequest,
  RecurringOccurrenceValidation,
  RecurringValidationResult,
  Room,
  ValidationIssue
} from '../../core/models';
import {
  addCairoDays,
  formatCairoOffsetIso,
  getCairoParts,
  parseIsoTimestamp,
  resolveCairoDateKeyTime
} from '../timezone/cairo-time';
import { validateBooking } from './booking-validation';
import { MAX_RECURRENCE_WEEKS } from './working-hours';

/**
 * Validates a weekly recurring booking (1–4 weeks) with strict all-or-nothing semantics.
 * Preserves Cairo wall-clock start time across DST transitions so a 10:00 meeting stays at 10:00.
 */
export function validateRecurringBooking(
  req: RecurringBookingRequest,
  room: Room,
  existing: Booking[],
  userBookings: Booking[],
  now: Date
): RecurringValidationResult {
  const topErrors: ValidationIssue[] = [];

  if (!Number.isInteger(req.weeks) || req.weeks < 1 || req.weeks > MAX_RECURRENCE_WEEKS) {
    topErrors.push({
      code: 'INVALID_RECURRENCE_WEEKS',
      message: `Weekly recurrence must be between 1 and ${MAX_RECURRENCE_WEEKS} weeks.`
    });
    return {
      valid: false,
      allOrNothingFailed: true,
      occurrences: [],
      errors: topErrors
    };
  }

  const baseStart = parseIsoTimestamp(req.startIso);
  const baseEnd = parseIsoTimestamp(req.endIso);
  if (!baseStart || !baseEnd) {
    const single = validateBooking(req, room, existing, userBookings, now);
    return {
      valid: false,
      allOrNothingFailed: true,
      occurrences: [
        {
          weekIndex: 0,
          dateKey: '',
          startIso: null,
          endIso: null,
          result: single
        }
      ],
      errors: single.errors
    };
  }

  const durationMs = baseEnd.getTime() - baseStart.getTime();
  const baseCairo = getCairoParts(baseStart);
  const occurrences: RecurringOccurrenceValidation[] = [];

  for (let weekIndex = 0; weekIndex < req.weeks; weekIndex++) {
    const occDateKey = addCairoDays(baseCairo.dateKey, weekIndex * 7);
    const resolvedStart = resolveCairoDateKeyTime(
      occDateKey,
      baseCairo.hour,
      baseCairo.minute,
      'earlier'
    );

    if (resolvedStart.status === 'nonexistent' || !resolvedStart.date) {
      const issue: ValidationIssue = {
        code: 'NONEXISTENT_LOCAL_TIME',
        message: `Week ${weekIndex + 1} (${occDateKey}) falls on a nonexistent Cairo DST local time.`
      };
      occurrences.push({
        weekIndex,
        dateKey: occDateKey,
        startIso: null,
        endIso: null,
        result: { valid: false, errors: [issue], conflicts: [] }
      });
      topErrors.push(issue);
      continue;
    }

    const occStartDate = resolvedStart.date;
    const occEndDate = new Date(occStartDate.getTime() + durationMs);
    const occStartIso = weekIndex === 0 ? req.startIso : formatCairoOffsetIso(occStartDate);
    const occEndIso = weekIndex === 0 ? req.endIso : formatCairoOffsetIso(occEndDate);

    const occReq: BookingRequest = {
      ...req,
      startIso: occStartIso,
      endIso: occEndIso
    };

    const result = validateBooking(occReq, room, existing, userBookings, now);
    occurrences.push({
      weekIndex,
      dateKey: occDateKey,
      startIso: occStartIso,
      endIso: occEndIso,
      result
    });

    if (!result.valid) {
      for (const err of result.errors) {
        topErrors.push({
          ...err,
          message: `Week ${weekIndex + 1} (${occDateKey}): ${err.message}`
        });
      }
    }
  }

  const valid = occurrences.every((occ) => occ.result.valid);

  return {
    valid,
    allOrNothingFailed: !valid,
    occurrences,
    errors: topErrors
  };
}
