import { Booking, BookingRequest, RecurringBookingRequest, Room } from '../../core/models';
import { findConflicts, validateBooking } from './booking-validation';
import { validateRecurringBooking } from './recurring-validation';
import { suggestSlots } from './slot-suggestions';

describe('Domain Booking Rules', () => {
  // Wednesday, 2026-11-25 07:00 Cairo (+02:00) = 05:00Z
  const WINTER_NOW = new Date('2026-11-25T05:00:00Z');
  // Wednesday, 2026-07-01 07:00 Cairo (+03:00) = 04:00Z
  const SUMMER_NOW = new Date('2026-07-01T04:00:00Z');

  const ROOM_A: Room = {
    id: 'room-101',
    name: 'Nile Boardroom',
    floor: 1,
    capacity: 10,
    equipment: ['projector', 'whiteboard', 'video-conferencing']
  };

  const ROOM_B: Room = {
    id: 'room-102',
    name: 'Delta Huddle',
    floor: 1,
    capacity: 6,
    equipment: ['whiteboard']
  };

  const ROOM_C: Room = {
    id: 'room-201',
    name: 'Alexandria Suite',
    floor: 2,
    capacity: 12,
    equipment: ['projector', 'whiteboard', 'video-conferencing', 'tv-screen']
  };

  function makeRequest(overrides: Partial<BookingRequest> = {}): BookingRequest {
    return {
      roomId: ROOM_A.id,
      title: 'Architecture Review',
      userId: 'user-nadia',
      userName: 'Nadia Hassan',
      startIso: '2026-11-25T09:00:00+02:00',
      endIso: '2026-11-25T10:00:00+02:00',
      attendees: 6,
      requiredEquipment: ['projector'],
      ...overrides
    };
  }

  function makeBooking(overrides: Partial<Booking> = {}): Booking {
    return {
      id: 'bk-1',
      roomId: ROOM_A.id,
      title: 'Existing Meeting',
      userId: 'user-omar',
      userName: 'Omar Tarek',
      startIso: '2026-11-25T09:00:00+02:00',
      endIso: '2026-11-25T10:00:00+02:00',
      attendees: 4,
      requiredEquipment: [],
      status: 'confirmed',
      ...overrides
    };
  }

  describe('validateBooking - happy paths & timestamp formats', () => {
    it('accepts a valid Sun–Thu booking at exact opening/closing and max 2h boundaries', () => {
      const openBoundary = validateBooking(
        makeRequest({
          startIso: '2026-11-25T08:00:00+02:00',
          endIso: '2026-11-25T10:00:00+02:00',
          attendees: 10
        }),
        ROOM_A,
        [],
        [],
        WINTER_NOW
      );
      expect(openBoundary.valid).toBeTrue();

      const closeBoundary = validateBooking(
        makeRequest({
          startIso: '2026-11-25T16:00:00+02:00',
          endIso: '2026-11-25T18:00:00+02:00'
        }),
        ROOM_A,
        [],
        [],
        WINTER_NOW
      );
      expect(closeBoundary.valid).toBeTrue();
    });

    it('handles UTC Z, +02:00, and +03:00 timestamps consistently in Africa/Cairo time', () => {
      // Winter: 06:00Z === 08:00+02:00 (valid opening hour)
      const winterUtc = validateBooking(
        makeRequest({
          startIso: '2026-11-25T06:00:00Z',
          endIso: '2026-11-25T07:00:00Z'
        }),
        ROOM_A,
        [],
        [],
        WINTER_NOW
      );
      expect(winterUtc.valid).toBeTrue();

      // Winter: 05:00Z === 07:00+02:00 (outside working hours)
      const winterTooEarly = validateBooking(
        makeRequest({
          startIso: '2026-11-25T05:00:00Z',
          endIso: '2026-11-25T06:00:00Z'
        }),
        ROOM_A,
        [],
        [],
        WINTER_NOW
      );
      expect(winterTooEarly.valid).toBeFalse();
      expect(winterTooEarly.errors.map((e) => e.code)).toContain('OUTSIDE_WORKING_HOURS');

      // Summer DST (+03:00): 05:00Z === 08:00+03:00 (valid opening hour!)
      const summerUtc = validateBooking(
        makeRequest({
          startIso: '2026-07-01T05:00:00Z',
          endIso: '2026-07-01T06:00:00Z'
        }),
        ROOM_A,
        [],
        [],
        SUMMER_NOW
      );
      expect(summerUtc.valid).toBeTrue();

      // Summer DST: 15:00Z === 18:00+03:00 (valid closing boundary)
      const summerClose = validateBooking(
        makeRequest({
          startIso: '2026-07-01T14:00:00Z',
          endIso: '2026-07-01T15:00:00Z'
        }),
        ROOM_A,
        [],
        [],
        SUMMER_NOW
      );
      expect(summerClose.valid).toBeTrue();

      // Summer DST: 17:00+02:00 === 18:00+03:00 Cairo (outside working hours!)
      const summerWrongOffset = validateBooking(
        makeRequest({
          startIso: '2026-07-01T17:00:00+02:00',
          endIso: '2026-07-01T17:30:00+02:00'
        }),
        ROOM_A,
        [],
        [],
        SUMMER_NOW
      );
      expect(summerWrongOffset.valid).toBeFalse();
      expect(summerWrongOffset.errors.map((e) => e.code)).toContain('OUTSIDE_WORKING_HOURS');
    });

    it('rejects offset-less timestamps and invalid time ranges', () => {
      const noTz = validateBooking(
        makeRequest({ startIso: '2026-11-25T09:00:00', endIso: '2026-11-25T10:00:00' }),
        ROOM_A,
        [],
        [],
        WINTER_NOW
      );
      expect(noTz.valid).toBeFalse();
      expect(noTz.errors[0].code).toBe('INVALID_TIMESTAMP');

      const reversed = validateBooking(
        makeRequest({
          startIso: '2026-11-25T10:00:00+02:00',
          endIso: '2026-11-25T09:00:00+02:00'
        }),
        ROOM_A,
        [],
        [],
        WINTER_NOW
      );
      expect(reversed.valid).toBeFalse();
      expect(reversed.errors.map((e) => e.code)).toContain('INVALID_TIME_RANGE');
    });
  });

  describe('validateBooking - time, duration, and working hours boundaries', () => {
    it('rejects bookings in the past and accepts bookings starting exactly at now', () => {
      const exactNow = new Date('2026-11-25T09:00:00+02:00');
      const atNow = validateBooking(makeRequest(), ROOM_A, [], [], exactNow);
      expect(atNow.valid).toBeTrue();

      const oneMsLater = new Date(exactNow.getTime() + 1);
      const inPast = validateBooking(makeRequest(), ROOM_A, [], [], oneMsLater);
      expect(inPast.valid).toBeFalse();
      expect(inPast.errors.map((e) => e.code)).toContain('IN_THE_PAST');
    });

    it('rejects bookings exceeding the 2-hour maximum duration (121 mins)', () => {
      const res = validateBooking(
        makeRequest({
          startIso: '2026-11-25T09:00:00+02:00',
          endIso: '2026-11-25T11:01:00+02:00'
        }),
        ROOM_A,
        [],
        [],
        WINTER_NOW
      );
      expect(res.valid).toBeFalse();
      expect(res.errors.map((e) => e.code)).toContain('MAX_DURATION_EXCEEDED');
    });

    it('rejects bookings crossing closing time on Sun–Thu', () => {
      const res = validateBooking(
        makeRequest({
          startIso: '2026-11-25T17:30:00+02:00',
          endIso: '2026-11-25T18:01:00+02:00'
        }),
        ROOM_A,
        [],
        [],
        WINTER_NOW
      );
      expect(res.valid).toBeFalse();
      expect(res.errors.map((e) => e.code)).toContain('CROSSES_CLOSING_TIME');
    });

    it('rejects bookings crossing Cairo midnight (even when input is in UTC)', () => {
      // 21:30Z to 22:30Z in winter Cairo = 23:30 to 00:30 next day
      const res = validateBooking(
        makeRequest({
          startIso: '2026-11-25T21:30:00Z',
          endIso: '2026-11-25T22:30:00Z'
        }),
        ROOM_A,
        [],
        [],
        WINTER_NOW
      );
      expect(res.valid).toBeFalse();
      expect(res.errors.map((e) => e.code)).toContain('CROSSES_MIDNIGHT');
    });

    it('enforces Friday half-day working hours (08:00–13:00)', () => {
      // 2026-11-27 is Friday
      const validFri = validateBooking(
        makeRequest({
          startIso: '2026-11-27T11:00:00+02:00',
          endIso: '2026-11-27T13:00:00+02:00'
        }),
        ROOM_A,
        [],
        [],
        WINTER_NOW
      );
      expect(validFri.valid).toBeTrue();

      const crossesFriClose = validateBooking(
        makeRequest({
          startIso: '2026-11-27T12:00:00+02:00',
          endIso: '2026-11-27T13:01:00+02:00'
        }),
        ROOM_A,
        [],
        [],
        WINTER_NOW
      );
      expect(crossesFriClose.valid).toBeFalse();
      expect(crossesFriClose.errors.map((e) => e.code)).toContain('CROSSES_CLOSING_TIME');

      const afterFriClose = validateBooking(
        makeRequest({
          startIso: '2026-11-27T13:00:00+02:00',
          endIso: '2026-11-27T14:00:00+02:00'
        }),
        ROOM_A,
        [],
        [],
        WINTER_NOW
      );
      expect(afterFriClose.valid).toBeFalse();
      expect(afterFriClose.errors.map((e) => e.code)).toContain('OUTSIDE_WORKING_HOURS');
    });

    it('rejects bookings on Saturday (closed)', () => {
      // 2026-11-28 is Saturday
      const satRes = validateBooking(
        makeRequest({
          startIso: '2026-11-28T10:00:00+02:00',
          endIso: '2026-11-28T11:00:00+02:00'
        }),
        ROOM_A,
        [],
        [],
        WINTER_NOW
      );
      expect(satRes.valid).toBeFalse();
      expect(satRes.errors.map((e) => e.code)).toContain('DAY_CLOSED');
    });
  });

  describe('validateBooking - capacity, equipment, conflicts, buffer & daily limit', () => {
    it('rejects when room capacity is sufficient but required equipment is missing', () => {
      const res = validateBooking(
        makeRequest({
          roomId: ROOM_B.id,
          attendees: 4, // capacity is 6
          requiredEquipment: ['whiteboard', 'projector', 'video-conferencing']
        }),
        ROOM_B,
        [],
        [],
        WINTER_NOW
      );
      expect(res.valid).toBeFalse();
      const eqErr = res.errors.find((e) => e.code === 'MISSING_EQUIPMENT');
      expect(eqErr).toBeDefined();
      expect(eqErr?.details?.['missing']).toEqual(['projector', 'video-conferencing']);
    });

    it('rejects when attendees exceed room capacity or are less than 1', () => {
      const tooMany = validateBooking(
        makeRequest({ attendees: 11 }),
        ROOM_A,
        [],
        [],
        WINTER_NOW
      );
      expect(tooMany.valid).toBeFalse();
      expect(tooMany.errors.map((e) => e.code)).toContain('CAPACITY_EXCEEDED');

      const zero = validateBooking(makeRequest({ attendees: 0 }), ROOM_A, [], [], WINTER_NOW);
      expect(zero.valid).toBeFalse();
      expect(zero.errors.map((e) => e.code)).toContain('INVALID_ATTENDEES');
    });

    it('ignores cancelled bookings when checking availability and conflicts', () => {
      const cancelled = makeBooking({ status: 'cancelled' });
      expect(findConflicts(makeRequest(), [cancelled], 15)).toEqual([]);

      const res = validateBooking(makeRequest(), ROOM_A, [cancelled], [], WINTER_NOW);
      expect(res.valid).toBeTrue();
    });

    it('handles back-to-back bookings (ending exactly when another starts) and 15-min buffer boundaries', () => {
      const existing = [
        makeBooking({
          startIso: '2026-11-25T09:00:00+02:00',
          endIso: '2026-11-25T10:00:00+02:00'
        })
      ];

      // Exact touch: 10:00 start when existing ends at 10:00
      const touchingReq = makeRequest({
        startIso: '2026-11-25T10:00:00+02:00',
        endIso: '2026-11-25T11:00:00+02:00'
      });
      expect(findConflicts(touchingReq, existing, 0).length).toBe(0);
      expect(findConflicts(touchingReq, existing, 15).length).toBe(1);

      const touchingVal = validateBooking(touchingReq, ROOM_A, existing, [], WINTER_NOW);
      expect(touchingVal.valid).toBeFalse();
      expect(touchingVal.errors.map((e) => e.code)).toContain('BUFFER_VIOLATION');

      // 14-minute gap after existing: rejected
      const gap14After = validateBooking(
        makeRequest({
          startIso: '2026-11-25T10:14:00+02:00',
          endIso: '2026-11-25T11:00:00+02:00'
        }),
        ROOM_A,
        existing,
        [],
        WINTER_NOW
      );
      expect(gap14After.valid).toBeFalse();
      expect(gap14After.errors.map((e) => e.code)).toContain('BUFFER_VIOLATION');

      // Exact 15-minute gap after existing: allowed
      const gap15After = validateBooking(
        makeRequest({
          startIso: '2026-11-25T10:15:00+02:00',
          endIso: '2026-11-25T11:00:00+02:00'
        }),
        ROOM_A,
        existing,
        [],
        WINTER_NOW
      );
      expect(gap15After.valid).toBeTrue();

      // 14-minute gap before existing: rejected
      const gap14Before = validateBooking(
        makeRequest({
          startIso: '2026-11-25T08:00:00+02:00',
          endIso: '2026-11-25T08:46:00+02:00'
        }),
        ROOM_A,
        existing,
        [],
        WINTER_NOW
      );
      expect(gap14Before.valid).toBeFalse();
      expect(gap14Before.errors.map((e) => e.code)).toContain('BUFFER_VIOLATION');

      // Exact 15-minute gap before existing: allowed
      const gap15Before = validateBooking(
        makeRequest({
          startIso: '2026-11-25T08:00:00+02:00',
          endIso: '2026-11-25T08:45:00+02:00'
        }),
        ROOM_A,
        existing,
        [],
        WINTER_NOW
      );
      expect(gap15Before.valid).toBeTrue();
    });

    it('detects direct overlap across mixed UTC and Cairo offset formats', () => {
      // Existing is 09:00–10:00+02:00 (07:00Z–08:00Z)
      const existing = [makeBooking()];
      // Request is 07:30Z–08:30Z (09:30–10:30+02:00)
      const overlap = validateBooking(
        makeRequest({
          startIso: '2026-11-25T07:30:00Z',
          endIso: '2026-11-25T08:30:00Z'
        }),
        ROOM_A,
        existing,
        [],
        WINTER_NOW
      );
      expect(overlap.valid).toBeFalse();
      expect(overlap.errors.map((e) => e.code)).toContain('ROOM_CONFLICT');
    });

    it('enforces maximum 3 active bookings per user per Cairo day and ignores cancelled ones', () => {
      const userDayBookings: Booking[] = [
        makeBooking({
          id: 'u-1',
          roomId: ROOM_B.id,
          userId: 'user-nadia',
          startIso: '2026-11-25T08:00:00+02:00',
          endIso: '2026-11-25T08:30:00+02:00'
        }),
        makeBooking({
          id: 'u-2',
          roomId: ROOM_B.id,
          userId: 'user-nadia',
          startIso: '2026-11-25T11:00:00+02:00',
          endIso: '2026-11-25T11:30:00+02:00'
        }),
        makeBooking({
          id: 'u-3',
          roomId: ROOM_B.id,
          userId: 'user-nadia',
          startIso: '2026-11-25T13:00:00+02:00',
          endIso: '2026-11-25T13:30:00+02:00'
        })
      ];

      // 4th active booking on same day -> rejected
      const fourth = validateBooking(makeRequest(), ROOM_A, [], userDayBookings, WINTER_NOW);
      expect(fourth.valid).toBeFalse();
      expect(fourth.errors.map((e) => e.code)).toContain('DAILY_LIMIT_EXCEEDED');

      // If one of the 3 is cancelled -> allowed
      const withOneCancelled = [
        userDayBookings[0],
        userDayBookings[1],
        { ...userDayBookings[2], status: 'cancelled' as const }
      ];
      const allowed = validateBooking(makeRequest(), ROOM_A, [], withOneCancelled, WINTER_NOW);
      expect(allowed.valid).toBeTrue();

      // Next day booking is allowed even with 3 active bookings today
      const nextDay = validateBooking(
        makeRequest({
          startIso: '2026-11-26T09:00:00+02:00',
          endIso: '2026-11-26T10:00:00+02:00'
        }),
        ROOM_A,
        [],
        userDayBookings,
        WINTER_NOW
      );
      expect(nextDay.valid).toBeTrue();
    });
  });

  describe('validateRecurringBooking - independent all-or-nothing validation', () => {
    it('approves up to 4 weekly occurrences when every week is valid', () => {
      const req: RecurringBookingRequest = {
        ...makeRequest(),
        weeks: 4
      };
      const res = validateRecurringBooking(req, ROOM_A, [], [], WINTER_NOW);
      expect(res.valid).toBeTrue();
      expect(res.allOrNothingFailed).toBeFalse();
      expect(res.occurrences.length).toBe(4);
      expect(res.occurrences.map((o) => o.dateKey)).toEqual([
        '2026-11-25',
        '2026-12-02',
        '2026-12-09',
        '2026-12-16'
      ]);
    });

    it('rejects the entire recurring series when one occurrence has a conflict (all-or-nothing)', () => {
      const week3Conflict = makeBooking({
        id: 'bk-week3',
        startIso: '2026-12-09T09:30:00+02:00',
        endIso: '2026-12-09T10:30:00+02:00'
      });

      const req: RecurringBookingRequest = {
        ...makeRequest(),
        weeks: 4
      };
      const res = validateRecurringBooking(req, ROOM_A, [week3Conflict], [], WINTER_NOW);
      expect(res.valid).toBeFalse();
      expect(res.allOrNothingFailed).toBeTrue();
      expect(res.occurrences[0].result.valid).toBeTrue();
      expect(res.occurrences[1].result.valid).toBeTrue();
      expect(res.occurrences[2].result.valid).toBeFalse();
      expect(res.occurrences[2].result.errors.map((e) => e.code)).toContain('ROOM_CONFLICT');
      expect(res.occurrences[3].result.valid).toBeTrue();
    });

    it('preserves Cairo local wall-clock time across DST spring-forward transitions', () => {
      // Thu 2026-04-16 (+02:00) -> Thu 2026-04-23 (+02:00) -> Thu 2026-04-30 (+03:00 after Apr 24 DST)
      const now = new Date('2026-04-15T06:00:00Z');
      const req: RecurringBookingRequest = {
        ...makeRequest({
          startIso: '2026-04-16T10:00:00+02:00',
          endIso: '2026-04-16T11:00:00+02:00'
        }),
        weeks: 3
      };
      const res = validateRecurringBooking(req, ROOM_A, [], [], now);
      expect(res.valid).toBeTrue();
      expect(res.occurrences[0].startIso).toBe('2026-04-16T10:00:00+02:00');
      expect(res.occurrences[1].startIso).toBe('2026-04-23T10:00:00+02:00');
      expect(res.occurrences[2].startIso).toBe('2026-04-30T10:00:00+03:00');
      expect(res.occurrences[2].endIso).toBe('2026-04-30T11:00:00+03:00');
    });

    it('rejects recurrence counts outside 1–4 weeks', () => {
      expect(
        validateRecurringBooking({ ...makeRequest(), weeks: 0 }, ROOM_A, [], [], WINTER_NOW).valid
      ).toBeFalse();
      expect(
        validateRecurringBooking({ ...makeRequest(), weeks: 5 }, ROOM_A, [], [], WINTER_NOW).valid
      ).toBeFalse();
    });
  });

  describe('suggestSlots', () => {
    it('returns the next available slots respecting 15-min buffer, capacity, equipment, and limit', () => {
      const existing: Booking[] = [
        makeBooking({
          id: 'b-1',
          roomId: ROOM_A.id,
          startIso: '2026-11-25T09:00:00+02:00',
          endIso: '2026-11-25T10:00:00+02:00'
        }),
        makeBooking({
          id: 'b-2',
          roomId: ROOM_C.id,
          startIso: '2026-11-25T09:00:00+02:00',
          endIso: '2026-11-25T10:00:00+02:00'
        })
      ];

      // ROOM_B has capacity 6 and lacks projector -> must NOT be suggested
      const req = makeRequest({
        roomId: ROOM_A.id,
        attendees: 8,
        requiredEquipment: ['projector'],
        startIso: '2026-11-25T09:00:00+02:00',
        endIso: '2026-11-25T10:00:00+02:00'
      });

      const slots = suggestSlots(req, [ROOM_B, ROOM_C, ROOM_A], existing, WINTER_NOW, 3);
      expect(slots.length).toBe(3);
      expect(slots.every((s) => s.roomId !== ROOM_B.id)).toBeTrue();
      // First slot should prefer ROOM_A at 10:15 (respecting 15-min buffer after 10:00)
      expect(slots[0].roomId).toBe(ROOM_A.id);
      expect(slots[0].startLocal).toBe('10:15');
      expect(slots[0].endLocal).toBe('11:15');
      expect(slots[1].roomId).toBe(ROOM_C.id);
      expect(slots[1].startLocal).toBe('10:15');
    });

    it('skips Saturday (closed) and rolls over from Friday closing time to Sunday 08:00', () => {
      // Friday 2026-11-27 at 12:30 (cannot fit 1-hour meeting before 13:00 close)
      const friNow = new Date('2026-11-27T12:15:00+02:00');
      const req = makeRequest({
        startIso: '2026-11-27T12:30:00+02:00',
        endIso: '2026-11-27T13:30:00+02:00'
      });

      const slots = suggestSlots(req, [ROOM_A], [], friNow, 2);
      expect(slots.length).toBe(2);
      // 2026-11-28 is Saturday (skipped) -> lands on Sunday 2026-11-29 08:00
      expect(slots[0].dateKey).toBe('2026-11-29');
      expect(slots[0].startLocal).toBe('08:00');
      expect(slots[0].endLocal).toBe('09:00');
    });
  });
});
