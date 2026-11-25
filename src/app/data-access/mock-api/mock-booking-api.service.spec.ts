import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { ApiError, Booking, BookingLiveEvent, BookingRequest } from '../../core/models';
import { ClockService } from '../../core/services/clock.service';
import { MockBookingApiService } from './mock-booking-api.service';

class FixedClockService extends ClockService {
  current = new Date('2026-11-25T07:00:00+02:00');
  override now(): Date {
    return new Date(this.current.getTime());
  }
}

describe('MockBookingApiService', () => {
  let api: MockBookingApiService;
  let clock: FixedClockService;

  beforeEach(() => {
    clock = new FixedClockService();
    TestBed.configureTestingModule({
      providers: [{ provide: ClockService, useValue: clock }]
    });
    api = TestBed.inject(MockBookingApiService);
    api.configureSimulation({ delayMs: 0, forceNextConflict: false, forceNextServerError: false });
  });

  function findOpenSlot(dateKey: string): { roomId: string; startIso: string; endIso: string } {
    let roomsCount = 0;
    let roomId = '';
    api.getRooms().subscribe((r) => {
      roomsCount = r.data.length;
      roomId = r.data[0].id;
    });
    expect(roomsCount).toBeGreaterThan(0);

    // 08:00–08:15 is before the 08:30 first seeded slot (respects 15-min buffer cleanly)
    // Or pick an empty day/slot by resetting to a small clean seed in tests that need empty slots.
    return {
      roomId,
      startIso: `${dateKey}T08:00:00+02:00`,
      endIso: `${dateKey}T08:15:00+02:00`
    };
  }

  it('generates deterministic 60 rooms and 30 days of bookings consistently', () => {
    api.resetData('2026-11-25', 60, 30);
    let roomsA: string[] = [];
    let dayBookingsA: string[] = [];
    api.getRooms().subscribe((res) => (roomsA = res.data.map((r) => `${r.id}:${r.capacity}`)));
    api.getBookingsByDate('2026-11-25').subscribe((res) => {
      dayBookingsA = res.data.bookings.map((b) => `${b.id}:${b.roomId}:${b.startIso}`);
    });

    expect(roomsA.length).toBe(60);
    expect(dayBookingsA.length).toBeGreaterThan(0);

    // Reset with same anchor -> exact same data
    api.resetData('2026-11-25', 60, 30);
    let roomsB: string[] = [];
    let dayBookingsB: string[] = [];
    api.getRooms().subscribe((res) => (roomsB = res.data.map((r) => `${r.id}:${r.capacity}`)));
    api.getBookingsByDate('2026-11-25').subscribe((res) => {
      dayBookingsB = res.data.bookings.map((b) => `${b.id}:${b.roomId}:${b.startIso}`);
    });

    expect(roomsB).toEqual(roomsA);
    expect(dayBookingsB).toEqual(dayBookingsA);
  });

  it('creates a booking, emits a sequenced BOOKING_CREATED live event, and persists it', () => {
    api.resetData('2026-11-25', 6, 5);
    const events: BookingLiveEvent[] = [];
    const sub = api.liveEvents$.subscribe((e) => events.push(e));

    const slot = findOpenSlot('2026-11-25');
    const req: BookingRequest = {
      roomId: slot.roomId,
      title: 'Quick Standup',
      userId: 'user-nadia',
      userName: 'Nadia Hassan',
      startIso: slot.startIso,
      endIso: slot.endIso,
      attendees: 2,
      requiredEquipment: []
    };

    let created: Booking | undefined;
    api.createBooking(req).subscribe((res) => {
      expect(res.status).toBe(201);
      created = res.data;
    });

    expect(created).toBeDefined();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('BOOKING_CREATED');
    expect(events[0].sequence).toBe(1);
    expect(events[0].booking.id).toBe(created!.id);

    sub.unsubscribe();
  });

  it('reliably reproduces a 409 Conflict race even on an available slot and returns 3 alternatives', () => {
    api.resetData('2026-11-25', 6, 5);
    const events: BookingLiveEvent[] = [];
    const sub = api.liveEvents$.subscribe((e) => events.push(e));

    const slot = findOpenSlot('2026-11-25');
    api.configureSimulation({ forceNextConflict: true, conflictCompetitorName: 'Karim Mansour' });

    const req: BookingRequest = {
      roomId: slot.roomId,
      title: 'My Available Slot',
      userId: 'user-nadia',
      userName: 'Nadia Hassan',
      startIso: slot.startIso,
      endIso: slot.endIso,
      attendees: 2,
      requiredEquipment: []
    };

    let capturedError: ApiError | undefined;
    api.createBooking(req).subscribe({
      next: () => fail('Expected 409 conflict error'),
      error: (err: ApiError) => (capturedError = err)
    });

    expect(capturedError).toBeInstanceOf(ApiError);
    expect(capturedError?.status).toBe(409);
    expect(capturedError?.code).toBe('CONFLICT');
    expect(capturedError?.conflict?.conflictingBooking.userName).toBe('Karim Mansour');
    expect(capturedError?.conflict?.alternatives.length).toBe(3);

    // Competing booking was also broadcast on live stream
    expect(events.length).toBe(1);
    expect(events[0].booking.userName).toBe('Karim Mansour');
    // Flag auto-resets after firing once
    expect(api.getSimulationConfig().forceNextConflict).toBeFalse();

    sub.unsubscribe();
  });

  it('simulates network delay and 500 server errors cleanly', fakeAsync(() => {
    api.resetData('2026-11-25', 4, 3);
    const slot = findOpenSlot('2026-11-25');
    api.configureSimulation({ delayMs: 250, forceNextServerError: true });

    let settled = false;
    let errorStatus = 0;

    api
      .createBooking({
        roomId: slot.roomId,
        title: 'Delayed Request',
        userId: 'user-nadia',
        userName: 'Nadia Hassan',
        startIso: slot.startIso,
        endIso: slot.endIso,
        attendees: 2,
        requiredEquipment: []
      })
      .subscribe({
        error: (err: ApiError) => {
          settled = true;
          errorStatus = err.status;
        }
      });

    tick(200);
    expect(settled).toBeFalse();
    tick(50);
    expect(settled).toBeTrue();
    expect(errorStatus).toBe(500);
    expect(api.getSimulationConfig().forceNextServerError).toBeFalse();
  }));

  it('creates recurring bookings atomically and rejects all-or-nothing when one week conflicts', () => {
    api.resetData('2026-11-25', 4, 1); // Only day 1 seeded; future weeks are clean
    const slot = findOpenSlot('2026-11-25');

    // Create a conflict on week 3 (2026-12-09)
    api
      .createBooking({
        roomId: slot.roomId,
        title: 'Blocker Week 3',
        userId: 'user-omar',
        userName: 'Omar Tarek',
        startIso: '2026-12-09T08:00:00+02:00',
        endIso: '2026-12-09T08:15:00+02:00',
        attendees: 2,
        requiredEquipment: []
      })
      .subscribe();

    let errStatus = 0;
    api
      .createRecurringBooking({
        roomId: slot.roomId,
        title: 'Weekly Sync',
        userId: 'user-nadia',
        userName: 'Nadia Hassan',
        startIso: slot.startIso,
        endIso: slot.endIso,
        attendees: 2,
        requiredEquipment: [],
        weeks: 4
      })
      .subscribe({
        next: () => fail('Expected all-or-nothing failure'),
        error: (err: ApiError) => (errStatus = err.status)
      });

    expect(errStatus).toBe(409);

    // Verify ZERO occurrences were created on week 2 (2026-12-02)
    let week2Count = -1;
    api.getBookingsByDate('2026-12-02').subscribe((res) => (week2Count = res.data.bookings.length));
    expect(week2Count).toBe(0);
  });

  it('cancels and restores bookings, rejecting restore with 409 if another user took the slot', () => {
    api.resetData('2026-11-25', 4, 1);
    const slot = findOpenSlot('2026-11-25');

    let bookingId = '';
    api
      .createBooking({
        roomId: slot.roomId,
        title: 'Cancelable Sync',
        userId: 'user-nadia',
        userName: 'Nadia Hassan',
        startIso: slot.startIso,
        endIso: slot.endIso,
        attendees: 2,
        requiredEquipment: []
      })
      .subscribe((res) => (bookingId = res.data.id));

    api.cancelBooking(bookingId).subscribe((res) => {
      expect(res.data.status).toBe('cancelled');
    });

    // Restore works while slot is still free
    api.restoreBooking(bookingId).subscribe((res) => {
      expect(res.data.status).toBe('confirmed');
    });

    // Cancel again, then another user books that exact slot -> restore must fail with 409
    api.cancelBooking(bookingId).subscribe();
    api
      .createBooking({
        roomId: slot.roomId,
        title: 'Snatched Slot',
        userId: 'user-omar',
        userName: 'Omar Tarek',
        startIso: slot.startIso,
        endIso: slot.endIso,
        attendees: 2,
        requiredEquipment: []
      })
      .subscribe();

    let restoreError: ApiError | undefined;
    api.restoreBooking(bookingId).subscribe({
      next: () => fail('Expected 409 when restoring taken slot'),
      error: (err: ApiError) => (restoreError = err)
    });

    expect(restoreError?.status).toBe(409);
  });
});
