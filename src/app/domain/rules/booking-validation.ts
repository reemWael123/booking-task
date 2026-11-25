import {
  Booking,
  BookingRequest,
  Room,
  ValidationIssue,
  ValidationResult
} from '../../core/models';
import { getCairoParts, parseIsoTimestamp } from '../timezone/cairo-time';
import {
  BOOKING_BUFFER_MINUTES,
  getWorkingHoursForDay,
  MAX_BOOKING_DURATION_MINUTES,
  MAX_DAILY_BOOKINGS_PER_USER
} from './working-hours';

/**
 * Returns all active bookings in the same room that overlap with `req`
 * or violate the required buffer (in minutes) before or after the booking.
 * Cancelled bookings are ignored.
 */
export function findConflicts(
  req: BookingRequest,
  existing: Booking[],
  bufferMins: number
): Booking[] {
  const reqStart = parseIsoTimestamp(req.startIso);
  const reqEnd = parseIsoTimestamp(req.endIso);
  if (!reqStart || !reqEnd || reqEnd.getTime() <= reqStart.getTime()) {
    return [];
  }

  const reqStartMs = reqStart.getTime();
  const reqEndMs = reqEnd.getTime();
  const bufferMs = Math.max(0, bufferMins) * 60_000;

  const conflicts: Booking[] = [];
  for (const booking of existing) {
    if (booking.status === 'cancelled') {
      continue;
    }
    if (booking.roomId !== req.roomId) {
      continue;
    }
    if (req.excludeBookingId && booking.id === req.excludeBookingId) {
      continue;
    }

    const bStart = parseIsoTimestamp(booking.startIso);
    const bEnd = parseIsoTimestamp(booking.endIso);
    if (!bStart || !bEnd) {
      continue;
    }

    const bStartMs = bStart.getTime();
    const bEndMs = bEnd.getTime();

    if (reqStartMs < bEndMs + bufferMs && bStartMs < reqEndMs + bufferMs) {
      conflicts.push(booking);
    }
  }

  return conflicts;
}

/**
 * Validates a single booking request against all business rules in Africa/Cairo time.
 * Pure function: requires `now` to be injected rather than calling `new Date()`.
 */
export function validateBooking(
  req: BookingRequest,
  room: Room,
  existing: Booking[],
  userBookings: Booking[],
  now: Date
): ValidationResult {
  const errors: ValidationIssue[] = [];

  const start = parseIsoTimestamp(req.startIso);
  const end = parseIsoTimestamp(req.endIso);

  if (!start || !end) {
    errors.push({
      code: 'INVALID_TIMESTAMP',
      message: 'Start and end timestamps must be valid ISO-8601 strings with a timezone offset or Z.'
    });
    return { valid: false, errors, conflicts: [] };
  }

  const startMs = start.getTime();
  const endMs = end.getTime();

  if (endMs <= startMs) {
    errors.push({
      code: 'INVALID_TIME_RANGE',
      message: 'End time must be after start time.'
    });
  }

  if (startMs < now.getTime()) {
    errors.push({
      code: 'IN_THE_PAST',
      message: 'Bookings cannot start in the past.'
    });
  }

  const durationMins = (endMs - startMs) / 60_000;
  if (durationMins > MAX_BOOKING_DURATION_MINUTES) {
    errors.push({
      code: 'MAX_DURATION_EXCEEDED',
      message: `Maximum booking duration is ${MAX_BOOKING_DURATION_MINUTES} minutes (2 hours).`,
      details: { durationMins, maxMinutes: MAX_BOOKING_DURATION_MINUTES }
    });
  }

  const startCairo = getCairoParts(start);
  const endCairo = getCairoParts(end);
  const workingHours = getWorkingHoursForDay(startCairo.dayOfWeek);

  if (startCairo.dateKey !== endCairo.dateKey) {
    errors.push({
      code: 'CROSSES_MIDNIGHT',
      message: 'Bookings cannot cross Cairo midnight.'
    });
  } else if (!workingHours) {
    errors.push({
      code: 'DAY_CLOSED',
      message: 'Rooms are closed on Saturdays.'
    });
  } else {
    const startMinuteOfDay = startCairo.hour * 60 + startCairo.minute + startCairo.second / 60;
    const endMinuteOfDay = endCairo.hour * 60 + endCairo.minute + endCairo.second / 60;

    if (startMinuteOfDay < workingHours.openMinute || startMinuteOfDay >= workingHours.closeMinute) {
      errors.push({
        code: 'OUTSIDE_WORKING_HOURS',
        message: 'Booking starts outside Cairo office working hours.'
      });
    } else if (endMinuteOfDay > workingHours.closeMinute) {
      errors.push({
        code: 'CROSSES_CLOSING_TIME',
        message: 'Booking extends past closing time.'
      });
    }
  }

  if (req.attendees < 1) {
    errors.push({
      code: 'INVALID_ATTENDEES',
      message: 'At least 1 attendee is required.'
    });
  } else if (req.attendees > room.capacity) {
    errors.push({
      code: 'CAPACITY_EXCEEDED',
      message: `${room.name} accommodates up to ${room.capacity} attendees (requested ${req.attendees}).`,
      details: { capacity: room.capacity, attendees: req.attendees }
    });
  }

  const missingEquipment = req.requiredEquipment.filter((eq) => !room.equipment.includes(eq));
  if (missingEquipment.length > 0) {
    errors.push({
      code: 'MISSING_EQUIPMENT',
      message: `${room.name} is missing required equipment: ${missingEquipment.join(', ')}.`,
      details: { missing: missingEquipment }
    });
  }

  const conflicts = findConflicts(req, existing, BOOKING_BUFFER_MINUTES);
  if (conflicts.length > 0) {
    const hasDirectOverlap = conflicts.some((booking) => {
      const bStart = parseIsoTimestamp(booking.startIso);
      const bEnd = parseIsoTimestamp(booking.endIso);
      return bStart !== null && bEnd !== null && startMs < bEnd.getTime() && bStart.getTime() < endMs;
    });

    if (hasDirectOverlap) {
      errors.push({
        code: 'ROOM_CONFLICT',
        message: 'This room is already booked during the selected time.'
      });
    } else {
      errors.push({
        code: 'BUFFER_VIOLATION',
        message: `A minimum ${BOOKING_BUFFER_MINUTES}-minute buffer is required between bookings in the same room.`
      });
    }
  }

  const activeUserBookingsOnDay = userBookings.filter((booking) => {
    if (booking.status === 'cancelled' || booking.userId !== req.userId) {
      return false;
    }
    if (req.excludeBookingId && booking.id === req.excludeBookingId) {
      return false;
    }
    const bStart = parseIsoTimestamp(booking.startIso);
    if (!bStart) {
      return false;
    }
    return getCairoParts(bStart).dateKey === startCairo.dateKey;
  });

  if (activeUserBookingsOnDay.length >= MAX_DAILY_BOOKINGS_PER_USER) {
    errors.push({
      code: 'DAILY_LIMIT_EXCEEDED',
      message: `You can hold at most ${MAX_DAILY_BOOKINGS_PER_USER} active bookings per day.`,
      details: { currentCount: activeUserBookingsOnDay.length, maxDaily: MAX_DAILY_BOOKINGS_PER_USER }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    conflicts
  };
}
