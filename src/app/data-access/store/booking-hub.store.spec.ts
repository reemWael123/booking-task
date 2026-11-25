import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { ApiError, Booking, BookingLiveEvent, BookingRequest } from '../../core/models';
import { ClockService } from '../../core/services/clock.service';
import { DEFAULT_CURRENT_USER } from '../../core/services/user-context.service';
import { BOOKING_GATEWAY } from '../../core/tokens/booking-gateway.token';
import { MockBookingGateway } from '../gateways/mock-booking.gateway';
import { MockBookingApiService } from '../mock-api/mock-booking-api.service';
import { BookingHubStore } from './booking-hub.store';

class TestClockService extends ClockService {
  current = new Date('2026-11-25T07:00:00+02:00');
  override now(): Date {
    return new Date(this.current.getTime());
  }
  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

describe('BookingHubStore', () => {
  let store: BookingHubStore;
  let mockApi: MockBookingApiService;
  let clock: TestClockService;

  beforeEach(() => {
    clock = new TestClockService();
    TestBed.configureTestingModule({
      providers: [
        { provide: ClockService, useValue: clock },
        { provide: BOOKING_GATEWAY, useExisting: MockBookingGateway }
      ]
    });

    mockApi = TestBed.inject(MockBookingApiService);
    mockApi.configureSimulation({ delayMs: 0, forceNextConflict: false, forceNextServerError: false });
    mockApi.resetData('2026-11-25', 6, 3);

    store = TestBed.inject(BookingHubStore);
    store.initialize();
  });

  function makeOpenRequest(overrides: Partial<BookingRequest> = {}): BookingRequest {
    const firstRoom = store.rooms()[0];
    return {
      roomId: firstRoom.id,
      title: 'Store Test Meeting',
      userId: DEFAULT_CURRENT_USER.id,
      userName: DEFAULT_CURRENT_USER.name,
      startIso: '2026-11-25T08:00:00+02:00',
      endIso: '2026-11-25T08:15:00+02:00',
      attendees: 2,
      requiredEquipment: [],
      ...overrides
    };
  }

  it('loads rooms and caches loaded dates without issuing duplicate requests', () => {
    const spy = spyOn(mockApi, 'getBookingsByDate').and.callThrough();

    // Already loaded during initialize()
    store.selectDate('2026-11-25');
    expect(spy).not.toHaveBeenCalled();

    // New date triggers 1 request, re-selecting it triggers 0 additional requests
    store.selectDate('2026-11-26');
    expect(spy).toHaveBeenCalledTimes(1);

    store.selectDate('2026-11-25');
    store.selectDate('2026-11-26');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('applies optimistic create immediately and prevents duplication when live event arrives before HTTP response', fakeAsync(() => {
    mockApi.configureSimulation({ delayMs: 200 });
    const req = makeOpenRequest();

    let confirmed: Booking | undefined;
    store.createBooking(req).subscribe((b) => (confirmed = b));

    // Immediately visible as optimistic before network completes
    const optimisticMatches = store
      .selectedDateBookings()
      .filter((b) => b.title === 'Store Test Meeting');
    expect(optimisticMatches.length).toBe(1);
    expect(optimisticMatches[0].optimistic).toBeTrue();

    // Simulate a live BOOKING_CREATED arriving BEFORE the HTTP response completes
    const earlyLiveEvent: BookingLiveEvent = {
      eventId: 'evt-early-1',
      sequence: mockApi.getCurrentSequence() + 1,
      type: 'BOOKING_CREATED',
      booking: {
        id: 'bk-early-server',
        roomId: req.roomId,
        title: req.title,
        userId: req.userId,
        userName: req.userName,
        startIso: req.startIso,
        endIso: req.endIso,
        attendees: req.attendees,
        requiredEquipment: req.requiredEquipment,
        status: 'confirmed'
      },
      emittedAtIso: clock.now().toISOString()
    };
    mockApi.emitRawLiveEvent(earlyLiveEvent);

    // Must NOT duplicate the booking while HTTP is still in flight
    const duringInFlight = store
      .selectedDateBookings()
      .filter((b) => b.roomId === req.roomId && b.startIso === req.startIso && b.status === 'confirmed');
    expect(duringInFlight.length).toBe(1);

    tick(200);
    expect(confirmed).toBeDefined();

    // Cleanly settled with no leftover optimistic entry
    const afterSettle = store
      .selectedDateBookings()
      .filter((b) => b.optimistic === true);
    expect(afterSettle.length).toBe(0);
  }));

  it('rolls back optimistic create on 409 Conflict race, shows competitor, and validates alternatives', fakeAsync(() => {
    mockApi.configureSimulation({
      delayMs: 150,
      forceNextConflict: true,
      conflictCompetitorName: 'Karim Mansour'
    });

    const req = makeOpenRequest();
    let failed = false;
    store.createBooking(req).subscribe({
      next: () => fail('Expected 409 conflict'),
      error: (err: ApiError) => {
        failed = err.status === 409;
      }
    });

    // Optimistic booking present while in flight
    expect(store.selectedDateBookings().some((b) => b.title === 'Store Test Meeting')).toBeTrue();

    tick(150);
    expect(failed).toBeTrue();

    // Optimistic booking rolled back cleanly
    expect(store.selectedDateBookings().some((b) => b.title === 'Store Test Meeting')).toBeFalse();
    expect(store.selectedDateBookings().some((b) => b.optimistic === true)).toBeFalse();

    // Competitor booking is now visible and Conflict Dialog state is populated
    const conflict = store.activeConflict();
    expect(conflict).not.toBeNull();
    expect(conflict?.conflictingBooking.userName).toBe('Karim Mansour');
    expect(conflict?.alternatives.length).toBe(3);
    expect(
      store.selectedDateBookings().some((b) => b.id === conflict!.conflictingBooking.id)
    ).toBeTrue();
  }));

  it('rolls back optimistic create and optimistic cancel cleanly on 500 server error', fakeAsync(() => {
    mockApi.configureSimulation({ delayMs: 100, forceNextServerError: true });

    const req = makeOpenRequest();
    let createFailed = false;
    store.createBooking(req).subscribe({
      error: (err: ApiError) => (createFailed = err.status === 500)
    });

    expect(store.selectedDateBookings().some((b) => b.title === 'Store Test Meeting')).toBeTrue();
    tick(100);

    expect(createFailed).toBeTrue();
    expect(store.selectedDateBookings().some((b) => b.title === 'Store Test Meeting')).toBeFalse();
    expect(store.errorMessage()).toContain('Simulated server error');

    // Now test optimistic cancel rollback on 500
    const userBooking = store.currentUserBookings().find((b) => b.status === 'confirmed')!;
    expect(userBooking).toBeDefined();

    mockApi.configureSimulation({ delayMs: 100, forceNextServerError: true });
    let cancelFailed = false;
    store.cancelBooking(userBooking.id).subscribe({
      error: (err: ApiError) => (cancelFailed = err.status === 500)
    });

    // Optimistically cancelled while in flight
    expect(store.mergedBookingsById().get(userBooking.id)?.status).toBe('cancelled');
    tick(100);

    // Rolled back to confirmed on failure
    expect(cancelFailed).toBeTrue();
    expect(store.mergedBookingsById().get(userBooking.id)?.status).toBe('confirmed');
  }));

  it('rolls back all optimistic recurring occurrences atomically if the API fails', fakeAsync(() => {
    mockApi.configureSimulation({ delayMs: 120, forceNextConflict: true });

    let failedStatus = 0;
    store
      .createRecurringBooking({
        ...makeOpenRequest({ title: 'Recurring Optimistic' }),
        weeks: 3
      })
      .subscribe({
        next: () => fail('Expected 409 conflict on recurring booking'),
        error: (err: ApiError) => (failedStatus = err.status)
      });

    // All 3 optimistic occurrences appear immediately while in flight
    const inFlight = Array.from(store.mergedBookingsById().values()).filter(
      (b) => b.title === 'Recurring Optimistic'
    );
    expect(inFlight.length).toBe(3);

    tick(120);
    expect(failedStatus).toBe(409);

    // Every single optimistic occurrence must be rolled back (zero partial bookings)
    const remaining = Array.from(store.mergedBookingsById().values()).filter(
      (b) => b.title === 'Recurring Optimistic'
    );
    expect(remaining.length).toBe(0);
    expect(store.activeConflict()).not.toBeNull();
  }));

  it('prevents incoming live events from overwriting an in-flight optimistic cancellation', fakeAsync(() => {
    const userBooking = store.currentUserBookings().find((b) => b.status === 'confirmed')!;
    mockApi.configureSimulation({ delayMs: 200 });

    store.cancelBooking(userBooking.id).subscribe();
    expect(store.mergedBookingsById().get(userBooking.id)?.status).toBe('cancelled');

    // A concurrent BOOKING_UPDATED event arrives while cancel HTTP is still pending
    mockApi.emitRawLiveEvent({
      eventId: 'evt-concurrent-update',
      sequence: mockApi.getCurrentSequence() + 1,
      type: 'BOOKING_UPDATED',
      booking: { ...userBooking, title: 'Updated Title', status: 'confirmed' },
      emittedAtIso: clock.now().toISOString()
    });

    // Optimistic cancellation overlay MUST remain active until API resolves
    expect(store.mergedBookingsById().get(userBooking.id)?.status).toBe('cancelled');
    expect(store.mergedBookingsById().get(userBooking.id)?.optimistic).toBeTrue();

    tick(200);
    expect(store.mergedBookingsById().get(userBooking.id)?.status).toBe('cancelled');
    expect(store.mergedBookingsById().get(userBooking.id)?.optimistic).toBeFalse();
    // Clean up 10s undo timer so fakeAsync exits cleanly
    store.dismissUndo();
  }));

  it('supports 10-second Undo after cancellation and expires Undo after 10 seconds', fakeAsync(() => {
    const userBooking = store.currentUserBookings().find((b) => b.status === 'confirmed')!;

    store.cancelBooking(userBooking.id).subscribe();
    expect(store.mergedBookingsById().get(userBooking.id)?.status).toBe('cancelled');
    expect(store.undoAction()?.bookingId).toBe(userBooking.id);

    // Undo within 10s restores the booking
    tick(4000);
    clock.advanceMs(4000);
    store.undoLastCancellation().subscribe();
    expect(store.mergedBookingsById().get(userBooking.id)?.status).toBe('confirmed');
    expect(store.undoAction()).toBeNull();

    // Cancel again and wait full 10 seconds -> Undo expires
    store.cancelBooking(userBooking.id).subscribe();
    expect(store.undoAction()).not.toBeNull();
    tick(10_000);
    clock.advanceMs(10_000);
    expect(store.undoAction()).toBeNull();
  }));

  it('validates suggested slots against the current user daily 3-booking limit before allowing confirmation', () => {
    // Seeded anchor day already has 1 active booking for DEFAULT_CURRENT_USER on 2026-11-25.
    // Create 2 more so user reaches 3 active bookings on 2026-11-25.
    const rooms = store.rooms();
    store
      .createBooking(
        makeOpenRequest({
          roomId: rooms[1].id,
          title: 'Daily #2',
          startIso: '2026-11-25T08:00:00+02:00',
          endIso: '2026-11-25T08:15:00+02:00'
        })
      )
      .subscribe();
    store
      .createBooking(
        makeOpenRequest({
          roomId: rooms[2].id,
          title: 'Daily #3',
          startIso: '2026-11-25T08:00:00+02:00',
          endIso: '2026-11-25T08:15:00+02:00'
        })
      )
      .subscribe();

    const baseReq = makeOpenRequest({
      roomId: rooms[3].id,
      title: 'Attempted #4',
      startIso: '2026-11-25T08:00:00+02:00',
      endIso: '2026-11-25T08:15:00+02:00'
    });

    const suggestions = store.getValidatedSuggestions(baseReq, 3);
    expect(suggestions.length).toBeGreaterThan(0);

    // Every suggestion on 2026-11-25 must be marked disallowed due to DAILY_LIMIT_EXCEEDED
    const sameDaySuggestion = suggestions.find((s) => s.slot.dateKey === '2026-11-25')!;
    expect(sameDaySuggestion).toBeDefined();
    expect(sameDaySuggestion.allowed).toBeFalse();
    expect(sameDaySuggestion.validation.errors.map((e) => e.code)).toContain('DAILY_LIMIT_EXCEEDED');

    // Attempting to confirm that suggested slot MUST be blocked without calling the API
    const createSpy = spyOn(mockApi, 'createBooking').and.callThrough();
    let blockedError: ApiError | undefined;
    store.confirmSuggestedSlot(sameDaySuggestion.slot, baseReq).subscribe({
      next: () => fail('Expected daily limit validation block'),
      error: (err: ApiError) => (blockedError = err)
    });

    expect(blockedError?.code).toBe('VALIDATION_ERROR');
    expect(createSpy).not.toHaveBeenCalled();

    // A suggested slot on 2026-11-26 (where user has < 3 bookings) IS allowed and confirms cleanly
    const nextDaySlot = {
      ...sameDaySuggestion.slot,
      dateKey: '2026-11-26',
      startIso: '2026-11-26T08:00:00+02:00',
      endIso: '2026-11-26T08:15:00+02:00'
    };
    let nextDayConfirmed: Booking | undefined;
    store.confirmSuggestedSlot(nextDaySlot, baseReq).subscribe((b) => (nextDayConfirmed = b));
    expect(nextDayConfirmed).toBeDefined();
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('handles duplicate events, out-of-order draining, and automatic snapshot recovery on sequence gap', fakeAsync(() => {
    const firstRoom = store.rooms()[0];
    const baseSeq = mockApi.getCurrentSequence();

    const b1: Booking = {
      id: 'bk-live-1',
      roomId: firstRoom.id,
      title: 'Seq 1 Booking',
      userId: 'user-omar',
      userName: 'Omar Tarek',
      startIso: '2026-11-25T14:00:00+02:00',
      endIso: '2026-11-25T14:30:00+02:00',
      attendees: 3,
      requiredEquipment: [],
      status: 'confirmed'
    };
    const b2: Booking = { ...b1, title: 'Seq 2 Updated' };

    const evt1: BookingLiveEvent = {
      eventId: 'evt-order-1',
      sequence: baseSeq + 1,
      type: 'BOOKING_CREATED',
      booking: b1,
      emittedAtIso: clock.now().toISOString()
    };
    const evt2: BookingLiveEvent = {
      eventId: 'evt-order-2',
      sequence: baseSeq + 2,
      type: 'BOOKING_UPDATED',
      booking: b2,
      emittedAtIso: clock.now().toISOString()
    };

    // Out-of-order: seq +2 arrives first -> buffered, gap detected
    mockApi.emitRawLiveEvent(evt2);
    expect(store.sequenceGap()?.missingCount).toBe(1);
    expect(store.mergedBookingsById().has('bk-live-1')).toBeFalse();

    // Duplicate of evt2 ignored
    mockApi.emitRawLiveEvent(evt2);
    expect(store.liveStreamStatus().bufferedCount).toBe(1);

    // Missing evt1 arrives -> drains both seq +1 and seq +2 in order
    mockApi.emitRawLiveEvent(evt1);
    expect(store.sequenceGap()).toBeNull();
    expect(store.mergedBookingsById().get('bk-live-1')?.title).toBe('Seq 2 Updated');

    // Now simulate a permanent sequence gap (skip baseSeq + 3, send baseSeq + 4)
    const resyncSpy = spyOn(mockApi, 'getBookingsByDate').and.callThrough();
    mockApi.emitRawLiveEvent({
      eventId: 'evt-gap-4',
      sequence: baseSeq + 4,
      type: 'BOOKING_CREATED',
      booking: { ...b1, id: 'bk-gap-4', title: 'After Gap' },
      emittedAtIso: clock.now().toISOString()
    });
    expect(store.sequenceGap()?.missingCount).toBe(1);

    // After 5s gap timeout, store automatically triggers snapshot resync
    clock.advanceMs(5000);
    tick(5000);
    expect(resyncSpy).toHaveBeenCalledWith('2026-11-25');
  }));
});
