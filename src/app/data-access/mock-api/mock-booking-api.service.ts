import { inject, Injectable } from '@angular/core';
import { defer, Observable, of, Subject, throwError, timer } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import {
  ApiError,
  ApiResponse,
  Booking,
  BookingEventType,
  BookingLiveEvent,
  BookingRequest,
  BookingsSnapshot,
  MockSimulationConfig,
  RecurringBookingRequest,
  Room
} from '../../core/models';
import { ClockService } from '../../core/services/clock.service';
import {
  formatCairoOffsetIso,
  getCairoParts,
  parseIsoTimestamp,
  resolveCairoDateKeyTime,
  suggestSlots,
  validateBooking,
  validateRecurringBooking
} from '../../domain';
import { generateSeedDataset } from './seed-data';

const DEFAULT_SIMULATION_CONFIG: MockSimulationConfig = {
  delayMs: 180,
  forceNextConflict: false,
  conflictCompetitorName: 'Karim Mansour',
  forceNextServerError: false
};

@Injectable({ providedIn: 'root' })
export class MockBookingApiService {
  private readonly clock = inject(ClockService);

  private rooms: readonly Room[] = [];
  private roomsById = new Map<string, Room>();
  private bookingsById = new Map<string, Booking>();
  private bookingIdsByDate = new Map<string, Set<string>>();

  private sequence = 0;
  private nextBookingCounter = 1;
  private nextEventCounter = 1;
  private config: MockSimulationConfig = { ...DEFAULT_SIMULATION_CONFIG };

  private readonly liveEventsSubject = new Subject<BookingLiveEvent>();
  readonly liveEvents$: Observable<BookingLiveEvent> = this.liveEventsSubject.asObservable();

  constructor() {
    const anchorDateKey = getCairoParts(this.clock.now()).dateKey;
    this.resetData(anchorDateKey, 60, 30);
  }

  /**
   * Re-seeds the Mock API deterministically. Useful for tests and simulation resets.
   */
  resetData(anchorDateKey: string, roomCount = 60, dayCount = 30): void {
    const dataset = generateSeedDataset(anchorDateKey, roomCount, dayCount);
    this.rooms = dataset.rooms;
    this.roomsById = new Map(dataset.rooms.map((r) => [r.id, r]));
    this.bookingsById = new Map<string, Booking>();
    this.bookingIdsByDate = new Map<string, Set<string>>();
    this.sequence = 0;
    this.nextBookingCounter = 1;
    this.nextEventCounter = 1;

    for (const booking of dataset.bookings) {
      this.indexBooking(booking);
    }
  }

  configureSimulation(partial: Partial<MockSimulationConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  getSimulationConfig(): MockSimulationConfig {
    return { ...this.config };
  }

  getCurrentSequence(): number {
    return this.sequence;
  }

  getRooms(): Observable<ApiResponse<readonly Room[]>> {
    return this.withNetworkDelay(() => this.ok(200, this.rooms));
  }

  getBookingsByDate(dateKey: string): Observable<ApiResponse<BookingsSnapshot>> {
    return this.withNetworkDelay(() => {
      const bookings = this.getBookingsForDateSync(dateKey);
      return this.ok(200, {
        dateKey,
        bookings,
        sequence: this.sequence
      });
    });
  }

  getUserBookings(userId: string): Observable<ApiResponse<readonly Booking[]>> {
    return this.withNetworkDelay(() => {
      const result: Booking[] = [];
      for (const booking of this.bookingsById.values()) {
        if (booking.userId === userId) {
          result.push(booking);
        }
      }
      result.sort((a, b) => a.startIso.localeCompare(b.startIso));
      return this.ok(200, result);
    });
  }

  createBooking(req: BookingRequest): Observable<ApiResponse<Booking>> {
    return this.withNetworkDelay(() => {
      this.throwIfServerErrorArmed();

      const room = this.roomsById.get(req.roomId);
      if (!room) {
        throw new ApiError(404, 'NOT_FOUND', `Room ${req.roomId} was not found.`);
      }

      const now = this.clock.now();

      // Reproducible 409 race simulation even when the slot initially appeared available.
      if (this.config.forceNextConflict) {
        this.config = { ...this.config, forceNextConflict: false };
        const competitorBooking = this.commitCompetitorBooking(req);
        const alternatives = suggestSlots(req, [...this.rooms], this.getAllBookingsSync(), now, 3);
        throw new ApiError(409, 'CONFLICT', `Room was just booked by ${competitorBooking.userName}.`, {
          message: `This slot was just reserved by ${competitorBooking.userName}.`,
          conflictingBooking: competitorBooking,
          alternatives
        });
      }

      const start = parseIsoTimestamp(req.startIso);
      const dateKey = start ? getCairoParts(start).dateKey : '';
      const dayBookings = dateKey ? this.getBookingsForDateSync(dateKey) : this.getAllBookingsSync();
      const userDayBookings = dayBookings.filter((b) => b.userId === req.userId);

      const validation = validateBooking(req, room, dayBookings, userDayBookings, now);
      if (!validation.valid) {
        if (validation.conflicts.length > 0) {
          const conflictingBooking = validation.conflicts[0];
          const alternatives = suggestSlots(req, [...this.rooms], this.getAllBookingsSync(), now, 3);
          throw new ApiError(409, 'CONFLICT', validation.errors[0].message, {
            message: validation.errors[0].message,
            conflictingBooking,
            alternatives
          });
        }
        throw new ApiError(400, 'VALIDATION_ERROR', validation.errors[0].message);
      }

      const created: Booking = {
        id: `bk-srv-${this.nextBookingCounter++}`,
        roomId: req.roomId,
        title: req.title.trim(),
        userId: req.userId,
        userName: req.userName,
        startIso: req.startIso,
        endIso: req.endIso,
        attendees: req.attendees,
        requiredEquipment: [...req.requiredEquipment],
        status: 'confirmed'
      };

      this.indexBooking(created);
      this.emitEvent('BOOKING_CREATED', created);

      return this.ok(201, created);
    });
  }

  createRecurringBooking(req: RecurringBookingRequest): Observable<ApiResponse<readonly Booking[]>> {
    return this.withNetworkDelay(() => {
      this.throwIfServerErrorArmed();

      const room = this.roomsById.get(req.roomId);
      if (!room) {
        throw new ApiError(404, 'NOT_FOUND', `Room ${req.roomId} was not found.`);
      }

      const now = this.clock.now();

      if (this.config.forceNextConflict) {
        this.config = { ...this.config, forceNextConflict: false };
        const competitorBooking = this.commitCompetitorBooking(req);
        const alternatives = suggestSlots(req, [...this.rooms], this.getAllBookingsSync(), now, 3);
        throw new ApiError(409, 'CONFLICT', `Recurring slot conflict with ${competitorBooking.userName}.`, {
          message: `The first occurrence was just reserved by ${competitorBooking.userName}. No occurrences were booked.`,
          conflictingBooking: competitorBooking,
          alternatives
        });
      }

      const allBookings = this.getAllBookingsSync();
      const userBookings = allBookings.filter((b) => b.userId === req.userId);
      const validation = validateRecurringBooking(req, room, allBookings, userBookings, now);

      if (!validation.valid) {
        const conflictedOcc = validation.occurrences.find((occ) => occ.result.conflicts.length > 0);
        if (conflictedOcc) {
          const conflictingBooking = conflictedOcc.result.conflicts[0];
          const alternatives = suggestSlots(req, [...this.rooms], allBookings, now, 3);
          throw new ApiError(409, 'CONFLICT', validation.errors[0].message, {
            message: validation.errors[0].message,
            conflictingBooking,
            alternatives
          });
        }
        throw new ApiError(400, 'VALIDATION_ERROR', validation.errors[0].message);
      }

      const recurrenceGroupId = `rec-${this.nextBookingCounter}`;
      const createdList: Booking[] = [];

      for (const occ of validation.occurrences) {
        if (!occ.startIso || !occ.endIso) {
          continue;
        }
        const created: Booking = {
          id: `bk-srv-${this.nextBookingCounter++}`,
          roomId: req.roomId,
          title: req.title.trim(),
          userId: req.userId,
          userName: req.userName,
          startIso: occ.startIso,
          endIso: occ.endIso,
          attendees: req.attendees,
          requiredEquipment: [...req.requiredEquipment],
          status: 'confirmed',
          recurrenceGroupId
        };
        this.indexBooking(created);
        this.emitEvent('BOOKING_CREATED', created);
        createdList.push(created);
      }

      return this.ok(201, createdList);
    });
  }

  cancelBooking(bookingId: string): Observable<ApiResponse<Booking>> {
    return this.withNetworkDelay(() => {
      this.throwIfServerErrorArmed();

      const existing = this.bookingsById.get(bookingId);
      if (!existing) {
        throw new ApiError(404, 'NOT_FOUND', `Booking ${bookingId} was not found.`);
      }

      const cancelled: Booking = { ...existing, status: 'cancelled' };
      this.indexBooking(cancelled);
      this.emitEvent('BOOKING_CANCELLED', cancelled);

      return this.ok(200, cancelled);
    });
  }

  restoreBooking(bookingId: string): Observable<ApiResponse<Booking>> {
    return this.withNetworkDelay(() => {
      this.throwIfServerErrorArmed();

      const existing = this.bookingsById.get(bookingId);
      if (!existing) {
        throw new ApiError(404, 'NOT_FOUND', `Booking ${bookingId} was not found.`);
      }

      const room = this.roomsById.get(existing.roomId);
      if (!room) {
        throw new ApiError(404, 'NOT_FOUND', `Room ${existing.roomId} was not found.`);
      }

      const now = this.clock.now();
      const start = parseIsoTimestamp(existing.startIso);
      const dateKey = start ? getCairoParts(start).dateKey : '';
      const dayBookings = dateKey ? this.getBookingsForDateSync(dateKey) : this.getAllBookingsSync();
      const userDayBookings = dayBookings.filter((b) => b.userId === existing.userId);

      const req: BookingRequest = {
        roomId: existing.roomId,
        title: existing.title,
        userId: existing.userId,
        userName: existing.userName,
        startIso: existing.startIso,
        endIso: existing.endIso,
        attendees: existing.attendees,
        requiredEquipment: existing.requiredEquipment,
        excludeBookingId: existing.id
      };

      const validation = validateBooking(req, room, dayBookings, userDayBookings, now);
      if (!validation.valid) {
        if (validation.conflicts.length > 0) {
          const alternatives = suggestSlots(req, [...this.rooms], this.getAllBookingsSync(), now, 3);
          throw new ApiError(409, 'CONFLICT', 'Slot was taken before undo could restore it.', {
            message: `Cannot restore: ${validation.conflicts[0].userName} reserved this slot.`,
            conflictingBooking: validation.conflicts[0],
            alternatives
          });
        }
        throw new ApiError(400, 'VALIDATION_ERROR', validation.errors[0].message);
      }

      const restored: Booking = { ...existing, status: 'confirmed' };
      this.indexBooking(restored);
      this.emitEvent('BOOKING_UPDATED', restored);

      return this.ok(200, restored);
    });
  }

  /**
   * Emits a custom live event directly on the stream (for testing duplicates,
   * out-of-order sequences, and missing sequence gaps).
   */
  emitRawLiveEvent(event: BookingLiveEvent): void {
    this.liveEventsSubject.next(event);
  }

  /**
   * Emits a realistic live stream burst (out-of-order + duplicate) for UI verification.
   */
  simulateLiveEventBurst(dateKey: string): void {
    const firstRoom = this.rooms[0];
    if (!firstRoom) {
      return;
    }

    const startRes = resolveCairoDateKeyTime(dateKey, 14, 0, 'earlier');
    const endRes = resolveCairoDateKeyTime(dateKey, 14, 45, 'earlier');
    if (!startRes.date || !endRes.date) {
      return;
    }

    const baseBooking: Booking = {
      id: `bk-live-${this.nextBookingCounter++}`,
      roomId: firstRoom.id,
      title: 'Executive Briefing (Live)',
      userId: 'user-karim',
      userName: 'Karim Mansour',
      startIso: formatCairoOffsetIso(startRes.date),
      endIso: formatCairoOffsetIso(endRes.date),
      attendees: Math.min(4, firstRoom.capacity),
      requiredEquipment: [],
      status: 'confirmed'
    };

    this.indexBooking(baseBooking);
    const seq1 = ++this.sequence;
    const seq2 = ++this.sequence;

    const updatedBooking: Booking = { ...baseBooking, title: 'Executive Briefing (Confirmed)' };
    this.indexBooking(updatedBooking);

    const evt1: BookingLiveEvent = {
      eventId: `evt-${this.nextEventCounter++}`,
      sequence: seq1,
      type: 'BOOKING_CREATED',
      booking: baseBooking,
      emittedAtIso: this.clock.now().toISOString()
    };
    const evt2: BookingLiveEvent = {
      eventId: `evt-${this.nextEventCounter++}`,
      sequence: seq2,
      type: 'BOOKING_UPDATED',
      booking: updatedBooking,
      emittedAtIso: this.clock.now().toISOString()
    };

    // Emit out-of-order (seq2 then seq1) plus duplicate of seq2
    this.liveEventsSubject.next(evt2);
    this.liveEventsSubject.next(evt2);
    this.liveEventsSubject.next(evt1);
  }

  private commitCompetitorBooking(req: BookingRequest): Booking {
    const competitor: Booking = {
      id: `bk-race-${this.nextBookingCounter++}`,
      roomId: req.roomId,
      title: 'Urgent Client Escalation',
      userId: 'user-karim',
      userName: this.config.conflictCompetitorName,
      startIso: req.startIso,
      endIso: req.endIso,
      attendees: req.attendees,
      requiredEquipment: [...req.requiredEquipment],
      status: 'confirmed'
    };
    this.indexBooking(competitor);
    this.emitEvent('BOOKING_CREATED', competitor);
    return competitor;
  }

  private throwIfServerErrorArmed(): void {
    if (this.config.forceNextServerError) {
      this.config = { ...this.config, forceNextServerError: false };
      throw new ApiError(500, 'SERVER_ERROR', 'Simulated server error. Please try again.');
    }
  }

  private emitEvent(type: BookingEventType, booking: Booking): void {
    const event: BookingLiveEvent = {
      eventId: `evt-${this.nextEventCounter++}`,
      sequence: ++this.sequence,
      type,
      booking,
      emittedAtIso: this.clock.now().toISOString()
    };
    this.liveEventsSubject.next(event);
  }

  private indexBooking(booking: Booking): void {
    this.bookingsById.set(booking.id, booking);
    const start = parseIsoTimestamp(booking.startIso);
    if (!start) {
      return;
    }
    const dateKey = getCairoParts(start).dateKey;
    let ids = this.bookingIdsByDate.get(dateKey);
    if (!ids) {
      ids = new Set<string>();
      this.bookingIdsByDate.set(dateKey, ids);
    }
    ids.add(booking.id);
  }

  private getBookingsForDateSync(dateKey: string): Booking[] {
    const ids = this.bookingIdsByDate.get(dateKey);
    if (!ids) {
      return [];
    }
    const result: Booking[] = [];
    for (const id of ids) {
      const booking = this.bookingsById.get(id);
      if (booking) {
        result.push(booking);
      }
    }
    return result;
  }

  private getAllBookingsSync(): Booking[] {
    return Array.from(this.bookingsById.values());
  }

  private ok<T>(status: number, data: T): ApiResponse<T> {
    return {
      status,
      data,
      timestampIso: this.clock.now().toISOString()
    };
  }

  private withNetworkDelay<T>(producer: () => T): Observable<T> {
    return defer(() => {
      const delayMs = this.config.delayMs;
      const run = (): Observable<T> => {
        try {
          return of(producer());
        } catch (err) {
          return throwError(() => err);
        }
      };
      return delayMs > 0 ? timer(delayMs).pipe(mergeMap(run)) : run();
    });
  }
}
