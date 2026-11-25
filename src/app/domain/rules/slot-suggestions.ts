import { Booking, BookingRequest, Room, SuggestedSlot } from '../../core/models';
import {
  addCairoDays,
  formatCairoOffsetIso,
  formatTimeHHMM,
  getCairoParts,
  parseIsoTimestamp,
  resolveCairoDateKeyTime
} from '../timezone/cairo-time';
import { findConflicts } from './booking-validation';
import {
  BOOKING_BUFFER_MINUTES,
  getWorkingHoursForDateKey,
  MAX_BOOKING_DURATION_MINUTES
} from './working-hours';

const SLOT_STEP_MINUTES = 15;
const MAX_SEARCH_DAYS = 14;

/**
 * Finds up to `limit` next available slots matching the request's duration,
 * attendee capacity, and equipment requirements in Africa/Cairo working hours.
 */
export function suggestSlots(
  req: BookingRequest,
  rooms: Room[],
  existing: Booking[],
  now: Date,
  limit: number
): SuggestedSlot[] {
  if (limit <= 0) {
    return [];
  }

  const reqStart = parseIsoTimestamp(req.startIso);
  const reqEnd = parseIsoTimestamp(req.endIso);
  if (!reqStart || !reqEnd) {
    return [];
  }

  const durationMs = reqEnd.getTime() - reqStart.getTime();
  const durationMins = Math.round(durationMs / 60_000);
  if (durationMins <= 0 || durationMins > MAX_BOOKING_DURATION_MINUTES) {
    return [];
  }

  const eligibleRooms = rooms
    .filter(
      (room) =>
        room.capacity >= Math.max(1, req.attendees) &&
        req.requiredEquipment.every((eq) => room.equipment.includes(eq))
    )
    .sort((a, b) => {
      if (a.id === req.roomId) return -1;
      if (b.id === req.roomId) return 1;
      return a.capacity - b.capacity || a.name.localeCompare(b.name);
    });

  if (eligibleRooms.length === 0) {
    return [];
  }

  // Group active existing bookings by room once to avoid repeated full scans.
  const bookingsByRoom = new Map<string, Booking[]>();
  for (const booking of existing) {
    if (booking.status === 'cancelled') {
      continue;
    }
    const list = bookingsByRoom.get(booking.roomId);
    if (list) {
      list.push(booking);
    } else {
      bookingsByRoom.set(booking.roomId, [booking]);
    }
  }

  const earliestInstantMs = Math.max(reqStart.getTime(), now.getTime());
  const startDayKey = getCairoParts(new Date(earliestInstantMs)).dateKey;
  const suggestions: SuggestedSlot[] = [];

  for (let dayOffset = 0; dayOffset < MAX_SEARCH_DAYS && suggestions.length < limit; dayOffset++) {
    const dateKey = addCairoDays(startDayKey, dayOffset);
    const hours = getWorkingHoursForDateKey(dateKey);
    if (!hours) {
      continue;
    }

    for (
      let startMin = hours.openMinute;
      startMin + durationMins <= hours.closeMinute && suggestions.length < limit;
      startMin += SLOT_STEP_MINUTES
    ) {
      const startHour = Math.floor(startMin / 60);
      const startMinute = startMin % 60;
      const resolvedStart = resolveCairoDateKeyTime(dateKey, startHour, startMinute, 'earlier');
      if (resolvedStart.status === 'nonexistent' || !resolvedStart.date) {
        continue;
      }

      const candidateStart = resolvedStart.date;
      if (candidateStart.getTime() < earliestInstantMs) {
        continue;
      }

      const candidateEnd = new Date(candidateStart.getTime() + durationMs);
      const endCairo = getCairoParts(candidateEnd);
      const endMinuteOfDay = endCairo.hour * 60 + endCairo.minute + endCairo.second / 60;
      if (endCairo.dateKey !== dateKey || endMinuteOfDay > hours.closeMinute) {
        continue;
      }

      const candidateStartIso = formatCairoOffsetIso(candidateStart);
      const candidateEndIso = formatCairoOffsetIso(candidateEnd);

      for (const room of eligibleRooms) {
        if (suggestions.length >= limit) {
          break;
        }

        const roomBookings = bookingsByRoom.get(room.id) ?? [];
        const candidateReq: BookingRequest = {
          ...req,
          roomId: room.id,
          startIso: candidateStartIso,
          endIso: candidateEndIso
        };

        if (findConflicts(candidateReq, roomBookings, BOOKING_BUFFER_MINUTES).length === 0) {
          suggestions.push({
            roomId: room.id,
            roomName: room.name,
            startIso: candidateStartIso,
            endIso: candidateEndIso,
            dateKey,
            startLocal: formatTimeHHMM(startHour, startMinute),
            endLocal: formatTimeHHMM(endCairo.hour, endCairo.minute)
          });
        }
      }
    }
  }

  return suggestions;
}
