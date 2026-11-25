import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, of, throwError } from 'rxjs';
import { catchError, finalize, map, shareReplay, tap } from 'rxjs/operators';
import {
  ActiveConflictState,
  ApiError,
  Booking,
  BookingLiveEvent,
  BookingRequest,
  BookingStatus,
  BookingsSnapshot,
  RecurringBookingRequest,
  RecurringValidationResult,
  Room,
  SuggestedSlot,
  UndoCancelAction,
  ValidatedSuggestedSlot,
  ValidationResult
} from '../../core/models';
import { ClockService } from '../../core/services/clock.service';
import { UserContextService } from '../../core/services/user-context.service';
import { BOOKING_GATEWAY } from '../../core/tokens/booking-gateway.token';
import {
  createEventStreamState,
  EventStreamState,
  getCairoParts,
  getSequenceGap,
  ingestLiveEvent,
  needsSequenceResync,
  parseIsoTimestamp,
  reconcileFromSnapshot,
  suggestSlots,
  validateBooking,
  validateRecurringBooking
} from '../../domain';

const UNDO_WINDOW_MS = 10_000;
const GAP_RESYNC_TIMEOUT_MS = 5_000;

function bookingFingerprint(b: {
  roomId: string;
  userId: string;
  startIso: string;
  endIso: string;
}): string {
  return `${b.roomId}|${b.userId}|${b.startIso}|${b.endIso}`;
}

@Injectable({ providedIn: 'root' })
export class BookingHubStore {
  private readonly gateway = inject(BOOKING_GATEWAY);
  private readonly clock = inject(ClockService);
  private readonly userContext = inject(UserContextService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly roomsSignal = signal<readonly Room[]>([]);
  private readonly selectedDateKeySignal = signal<string>(getCairoParts(this.clock.now()).dateKey);
  private readonly eventStreamSignal = signal<EventStreamState>(createEventStreamState());

  // Optimistic overlays kept separate from confirmed server state so live events
  // never overwrite or duplicate in-flight optimistic changes.
  private readonly pendingCreatesSignal = signal<ReadonlyMap<string, Booking>>(new Map());
  private readonly pendingStatusOverridesSignal = signal<ReadonlyMap<string, BookingStatus>>(
    new Map()
  );

  private readonly loadingRoomsSignal = signal<boolean>(false);
  private readonly loadingDateSignal = signal<boolean>(false);
  private readonly submittingSignal = signal<boolean>(false);
  private readonly errorMessageSignal = signal<string | null>(null);
  private readonly activeConflictSignal = signal<ActiveConflictState | null>(null);
  private readonly undoActionSignal = signal<UndoCancelAction | null>(null);

  private readonly loadedDateKeys = new Set<string>();
  private readonly inFlightDateLoads = new Map<string, Observable<BookingsSnapshot>>();
  private initialized = false;
  private optimisticCounter = 1;
  private undoTimerId: ReturnType<typeof setTimeout> | null = null;
  private gapResyncTimerId: ReturnType<typeof setTimeout> | null = null;

  readonly rooms = this.roomsSignal.asReadonly();
  readonly selectedDateKey = this.selectedDateKeySignal.asReadonly();
  readonly loadingRooms = this.loadingRoomsSignal.asReadonly();
  readonly loadingDate = this.loadingDateSignal.asReadonly();
  readonly submitting = this.submittingSignal.asReadonly();
  readonly errorMessage = this.errorMessageSignal.asReadonly();
  readonly activeConflict = this.activeConflictSignal.asReadonly();
  readonly undoAction = this.undoActionSignal.asReadonly();
  readonly currentUser = this.userContext.currentUser;

  readonly roomsById = computed<ReadonlyMap<string, Room>>(() => {
    const mapById = new Map<string, Room>();
    for (const room of this.roomsSignal()) {
      mapById.set(room.id, room);
    }
    return mapById;
  });

  readonly mergedBookingsById = computed<ReadonlyMap<string, Booking>>(() => {
    const confirmed = this.eventStreamSignal().bookingsById;
    const statusOverrides = this.pendingStatusOverridesSignal();
    const pendingCreates = this.pendingCreatesSignal();

    const merged = new Map<string, Booking>();
    const confirmedFingerprints = new Set<string>();

    for (const [id, booking] of confirmed.entries()) {
      const overrideStatus = statusOverrides.get(id);
      const effective: Booking =
        overrideStatus !== undefined
          ? { ...booking, status: overrideStatus, optimistic: true }
          : booking;
      merged.set(id, effective);

      if (effective.status !== 'cancelled') {
        confirmedFingerprints.add(bookingFingerprint(effective));
      }
    }

    // Suppress any optimistic create already confirmed via live event to prevent duplicates
    for (const [tempId, optBooking] of pendingCreates.entries()) {
      if (!confirmedFingerprints.has(bookingFingerprint(optBooking))) {
        merged.set(tempId, optBooking);
      }
    }

    return merged;
  });

  readonly bookingsByDateKey = computed<ReadonlyMap<string, readonly Booking[]>>(() => {
    const grouped = new Map<string, Booking[]>();
    for (const booking of this.mergedBookingsById().values()) {
      const start = parseIsoTimestamp(booking.startIso);
      if (!start) {
        continue;
      }
      const dateKey = getCairoParts(start).dateKey;
      const list = grouped.get(dateKey);
      if (list) {
        list.push(booking);
      } else {
        grouped.set(dateKey, [booking]);
      }
    }
    return grouped;
  });

  readonly selectedDateBookings = computed<readonly Booking[]>(() => {
    return this.bookingsByDateKey().get(this.selectedDateKeySignal()) ?? [];
  });

  readonly selectedDateBookingsByRoom = computed<ReadonlyMap<string, readonly Booking[]>>(() => {
    const byRoom = new Map<string, Booking[]>();
    for (const booking of this.selectedDateBookings()) {
      const list = byRoom.get(booking.roomId);
      if (list) {
        list.push(booking);
      } else {
        byRoom.set(booking.roomId, [booking]);
      }
    }
    return byRoom;
  });

  readonly currentUserBookings = computed<readonly Booking[]>(() => {
    const userId = this.currentUser().id;
    const result: Booking[] = [];
    for (const booking of this.mergedBookingsById().values()) {
      if (booking.userId === userId) {
        result.push(booking);
      }
    }
    result.sort((a, b) => a.startIso.localeCompare(b.startIso));
    return result;
  });

  readonly sequenceGap = computed(() => getSequenceGap(this.eventStreamSignal()));

  readonly liveStreamStatus = computed(() => {
    const state = this.eventStreamSignal();
    return {
      lastAppliedSequence: state.lastAppliedSequence,
      bufferedCount: state.bufferedBySequence.size,
      hasGap: state.bufferedBySequence.size > 0
    };
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.clearUndoTimer();
      this.clearGapResyncTimer();
    });
  }

  /**
   * Loads rooms, selected day bookings, and current user bookings once,
   * and connects to the live booking event stream.
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    this.gateway.liveEvents$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => this.handleIncomingLiveEvent(event));

    this.loadRooms().subscribe();
    this.loadDateBookings(this.selectedDateKeySignal()).subscribe();
    this.loadCurrentUserBookings().subscribe();
  }

  loadRooms(): Observable<readonly Room[]> {
    if (this.roomsSignal().length > 0) {
      return of(this.roomsSignal());
    }
    this.loadingRoomsSignal.set(true);
    return this.gateway.getRooms().pipe(
      map((res) => res.data),
      tap((rooms) => this.roomsSignal.set(rooms)),
      catchError((err: unknown) => {
        this.errorMessageSignal.set(this.extractErrorMessage(err));
        return of([] as readonly Room[]);
      }),
      finalize(() => this.loadingRoomsSignal.set(false))
    );
  }

  selectDate(dateKey: string): void {
    this.selectedDateKeySignal.set(dateKey);
    if (!this.loadedDateKeys.has(dateKey)) {
      this.loadDateBookings(dateKey).subscribe();
    }
  }

  loadDateBookings(dateKey: string, forceRefresh = false): Observable<BookingsSnapshot> {
    if (!forceRefresh && this.loadedDateKeys.has(dateKey)) {
      return of({
        dateKey,
        bookings: this.bookingsByDateKey().get(dateKey) ?? [],
        sequence: this.eventStreamSignal().lastAppliedSequence
      });
    }

    const existingReq = this.inFlightDateLoads.get(dateKey);
    if (existingReq && !forceRefresh) {
      return existingReq;
    }

    this.loadingDateSignal.set(true);
    const req$ = this.gateway.getBookingsByDate(dateKey).pipe(
      map((res) => res.data),
      tap((snapshot) => {
        this.loadedDateKeys.add(dateKey);
        this.mergeDateSnapshot(snapshot);
      }),
      catchError((err: unknown) => {
        this.errorMessageSignal.set(this.extractErrorMessage(err));
        return throwError(() => err);
      }),
      finalize(() => {
        this.inFlightDateLoads.delete(dateKey);
        if (this.inFlightDateLoads.size === 0) {
          this.loadingDateSignal.set(false);
        }
      }),
      shareReplay(1)
    );

    this.inFlightDateLoads.set(dateKey, req$);
    return req$;
  }

  loadCurrentUserBookings(): Observable<readonly Booking[]> {
    const userId = this.currentUser().id;
    return this.gateway.getUserBookings(userId).pipe(
      map((res) => res.data),
      tap((bookings) => this.upsertConfirmedBookings(bookings)),
      catchError((err: unknown) => {
        this.errorMessageSignal.set(this.extractErrorMessage(err));
        return of([] as readonly Booking[]);
      })
    );
  }

  validateBookingRequest(req: BookingRequest): ValidationResult {
    const room = this.roomsById().get(req.roomId);
    if (!room) {
      return {
        valid: false,
        errors: [{ code: 'INVALID_TIMESTAMP', message: 'Selected room does not exist.' }],
        conflicts: []
      };
    }

    const start = parseIsoTimestamp(req.startIso);
    const dateKey = start ? getCairoParts(start).dateKey : this.selectedDateKeySignal();
    const dayBookings = [...(this.bookingsByDateKey().get(dateKey) ?? [])];
    const userBookings = [...this.currentUserBookings()];

    return validateBooking(req, room, dayBookings, userBookings, this.clock.now());
  }

  validateRecurringRequest(req: RecurringBookingRequest): RecurringValidationResult {
    const room = this.roomsById().get(req.roomId);
    if (!room) {
      return {
        valid: false,
        allOrNothingFailed: true,
        occurrences: [],
        errors: [{ code: 'INVALID_TIMESTAMP', message: 'Selected room does not exist.' }]
      };
    }

    const allKnown = Array.from(this.mergedBookingsById().values());
    const userBookings = [...this.currentUserBookings()];
    return validateRecurringBooking(req, room, allKnown, userBookings, this.clock.now());
  }

  /**
   * Validates a suggested slot against ALL business rules including the current user's
   * maximum 3 active bookings per day limit.
   */
  validateSuggestedSlot(slot: SuggestedSlot, baseRequest: BookingRequest): ValidationResult {
    const candidateReq: BookingRequest = {
      ...baseRequest,
      roomId: slot.roomId,
      startIso: slot.startIso,
      endIso: slot.endIso
    };
    return this.validateBookingRequest(candidateReq);
  }

  getValidatedSuggestions(req: BookingRequest, limit = 3): readonly ValidatedSuggestedSlot[] {
    const allKnown = Array.from(this.mergedBookingsById().values());
    const rawSlots = suggestSlots(req, [...this.roomsSignal()], allKnown, this.clock.now(), limit);
    return rawSlots.map((slot) => {
      const validation = this.validateSuggestedSlot(slot, req);
      return {
        slot,
        validation,
        allowed: validation.valid
      };
    });
  }

  createBooking(req: BookingRequest): Observable<Booking> {
    this.errorMessageSignal.set(null);

    const validation = this.validateBookingRequest(req);
    if (!validation.valid) {
      const message = validation.errors[0].message;
      this.errorMessageSignal.set(message);
      return throwError(() => new ApiError(400, 'VALIDATION_ERROR', message));
    }

    const tempId = `opt-${this.optimisticCounter++}`;
    const optimisticBooking: Booking = {
      id: tempId,
      roomId: req.roomId,
      title: req.title.trim(),
      userId: req.userId,
      userName: req.userName,
      startIso: req.startIso,
      endIso: req.endIso,
      attendees: req.attendees,
      requiredEquipment: [...req.requiredEquipment],
      status: 'confirmed',
      optimistic: true
    };

    this.addPendingCreate(optimisticBooking);
    this.submittingSignal.set(true);

    return this.gateway.createBooking(req).pipe(
      map((res) => res.data),
      tap((confirmed) => {
        this.removePendingCreate(tempId);
        this.upsertConfirmedBookings([confirmed]);
      }),
      catchError((err: unknown) => {
        // Exact rollback of only the failed optimistic booking
        this.removePendingCreate(tempId);
        this.handleMutationError(err, req);
        return throwError(() => err);
      }),
      finalize(() => this.submittingSignal.set(false))
    );
  }

  /**
   * Validates the chosen alternative slot against the current user's daily limit
   * before confirming it with the gateway.
   */
  confirmSuggestedSlot(slot: SuggestedSlot, baseRequest: BookingRequest): Observable<Booking> {
    const validation = this.validateSuggestedSlot(slot, baseRequest);
    if (!validation.valid) {
      const message = validation.errors[0].message;
      this.errorMessageSignal.set(message);
      return throwError(() => new ApiError(400, 'VALIDATION_ERROR', message));
    }

    this.activeConflictSignal.set(null);
    return this.createBooking({
      ...baseRequest,
      roomId: slot.roomId,
      startIso: slot.startIso,
      endIso: slot.endIso
    });
  }

  createRecurringBooking(req: RecurringBookingRequest): Observable<readonly Booking[]> {
    this.errorMessageSignal.set(null);

    const validation = this.validateRecurringRequest(req);
    if (!validation.valid) {
      const message = validation.errors[0]?.message ?? 'Recurring booking validation failed.';
      this.errorMessageSignal.set(message);
      return throwError(() => new ApiError(400, 'VALIDATION_ERROR', message));
    }

    const tempIds: string[] = [];
    for (const occ of validation.occurrences) {
      if (!occ.startIso || !occ.endIso) {
        continue;
      }
      const tempId = `opt-${this.optimisticCounter++}`;
      tempIds.push(tempId);
      this.addPendingCreate({
        id: tempId,
        roomId: req.roomId,
        title: req.title.trim(),
        userId: req.userId,
        userName: req.userName,
        startIso: occ.startIso,
        endIso: occ.endIso,
        attendees: req.attendees,
        requiredEquipment: [...req.requiredEquipment],
        status: 'confirmed',
        optimistic: true
      });
    }

    this.submittingSignal.set(true);

    return this.gateway.createRecurringBooking(req).pipe(
      map((res) => res.data),
      tap((createdList) => {
        for (const id of tempIds) {
          this.removePendingCreate(id);
        }
        this.upsertConfirmedBookings(createdList);
      }),
      catchError((err: unknown) => {
        // Atomic rollback of every optimistic recurring occurrence
        for (const id of tempIds) {
          this.removePendingCreate(id);
        }
        this.handleMutationError(err, req);
        return throwError(() => err);
      }),
      finalize(() => this.submittingSignal.set(false))
    );
  }

  cancelBooking(bookingId: string): Observable<Booking> {
    this.errorMessageSignal.set(null);
    const existing = this.mergedBookingsById().get(bookingId);
    if (!existing) {
      return throwError(() => new ApiError(404, 'NOT_FOUND', `Booking ${bookingId} not found.`));
    }

    this.setPendingStatusOverride(bookingId, 'cancelled');

    return this.gateway.cancelBooking(bookingId).pipe(
      map((res) => res.data),
      tap((cancelled) => {
        this.clearPendingStatusOverride(bookingId);
        this.upsertConfirmedBookings([cancelled]);
        this.startUndoWindow(cancelled);
      }),
      catchError((err: unknown) => {
        // Rollback optimistic cancellation
        this.clearPendingStatusOverride(bookingId);
        this.errorMessageSignal.set(this.extractErrorMessage(err));
        return throwError(() => err);
      })
    );
  }

  undoLastCancellation(): Observable<Booking | null> {
    const action = this.undoActionSignal();
    if (!action) {
      return of(null);
    }

    if (this.clock.now().getTime() > action.expiresAtMs) {
      this.dismissUndo();
      return of(null);
    }

    const bookingId = action.bookingId;
    this.dismissUndo();
    this.setPendingStatusOverride(bookingId, 'confirmed');

    return this.gateway.restoreBooking(bookingId).pipe(
      map((res) => res.data),
      tap((restored) => {
        this.clearPendingStatusOverride(bookingId);
        this.upsertConfirmedBookings([restored]);
      }),
      catchError((err: unknown) => {
        this.clearPendingStatusOverride(bookingId);
        const target = this.mergedBookingsById().get(bookingId);
        if (target) {
          this.handleMutationError(err, {
            roomId: target.roomId,
            title: target.title,
            userId: target.userId,
            userName: target.userName,
            startIso: target.startIso,
            endIso: target.endIso,
            attendees: target.attendees,
            requiredEquipment: target.requiredEquipment
          });
        } else {
          this.errorMessageSignal.set(this.extractErrorMessage(err));
        }
        return throwError(() => err);
      })
    );
  }

  dismissConflict(): void {
    this.activeConflictSignal.set(null);
  }

  dismissUndo(): void {
    this.clearUndoTimer();
    this.undoActionSignal.set(null);
  }

  clearError(): void {
    this.errorMessageSignal.set(null);
  }

  /**
   * Forces a snapshot reconciliation for the selected date (used on persistent sequence gaps).
   */
  resyncActiveDate(): Observable<BookingsSnapshot> {
    this.clearGapResyncTimer();
    return this.loadDateBookings(this.selectedDateKeySignal(), true);
  }

  private handleIncomingLiveEvent(event: BookingLiveEvent): void {
    const now = this.clock.now();
    const result = ingestLiveEvent(this.eventStreamSignal(), event, now);
    if (result.state !== this.eventStreamSignal()) {
      this.eventStreamSignal.set(result.state);
    }

    if (result.state.bufferedBySequence.size === 0) {
      this.clearGapResyncTimer();
      return;
    }

    if (needsSequenceResync(result.state, now, GAP_RESYNC_TIMEOUT_MS)) {
      this.resyncActiveDate().subscribe({ error: () => undefined });
      return;
    }

    if (this.gapResyncTimerId === null) {
      this.gapResyncTimerId = setTimeout(() => {
        this.gapResyncTimerId = null;
        if (needsSequenceResync(this.eventStreamSignal(), this.clock.now(), GAP_RESYNC_TIMEOUT_MS)) {
          this.resyncActiveDate().subscribe({ error: () => undefined });
        }
      }, GAP_RESYNC_TIMEOUT_MS);
    }
  }

  private mergeDateSnapshot(snapshot: BookingsSnapshot): void {
    const current = this.eventStreamSignal();
    const combined: Booking[] = [];

    // Preserve cached bookings belonging to OTHER dates while replacing snapshot.dateKey authoritatively
    for (const booking of current.bookingsById.values()) {
      const start = parseIsoTimestamp(booking.startIso);
      const bDateKey = start ? getCairoParts(start).dateKey : null;
      if (bDateKey !== snapshot.dateKey) {
        combined.push(booking);
      }
    }
    combined.push(...snapshot.bookings);

    if (snapshot.sequence >= current.lastAppliedSequence) {
      this.eventStreamSignal.set(
        reconcileFromSnapshot(current, combined, snapshot.sequence, this.clock.now())
      );
    } else {
      // Snapshot is older than our live sequence; merge missing bookings without regressing sequence
      const nextBookings = new Map(current.bookingsById);
      for (const booking of snapshot.bookings) {
        if (!nextBookings.has(booking.id)) {
          nextBookings.set(booking.id, { ...booking, optimistic: false });
        }
      }
      this.eventStreamSignal.set({ ...current, bookingsById: nextBookings });
    }
  }

  private upsertConfirmedBookings(bookings: readonly Booking[]): void {
    if (bookings.length === 0) {
      return;
    }
    const current = this.eventStreamSignal();
    const nextBookings = new Map(current.bookingsById);
    for (const booking of bookings) {
      nextBookings.set(booking.id, { ...booking, optimistic: false });
    }
    this.eventStreamSignal.set({ ...current, bookingsById: nextBookings });
  }

  private handleMutationError(err: unknown, request: BookingRequest): void {
    if (err instanceof ApiError && err.status === 409 && err.conflict) {
      // Ensure the conflicting booking is reflected in confirmed state immediately
      this.upsertConfirmedBookings([err.conflict.conflictingBooking]);

      // Validate every returned alternative against the current user's daily booking limit
      const validatedAlternatives: ValidatedSuggestedSlot[] = err.conflict.alternatives.map(
        (slot) => {
          const validation = this.validateSuggestedSlot(slot, request);
          return {
            slot,
            validation,
            allowed: validation.valid
          };
        }
      );

      this.activeConflictSignal.set({
        request,
        conflictingBooking: err.conflict.conflictingBooking,
        alternatives: validatedAlternatives,
        message: err.conflict.message
      });
      return;
    }

    this.errorMessageSignal.set(this.extractErrorMessage(err));
  }

  private addPendingCreate(booking: Booking): void {
    const next = new Map(this.pendingCreatesSignal());
    next.set(booking.id, booking);
    this.pendingCreatesSignal.set(next);
  }

  private removePendingCreate(tempId: string): void {
    const current = this.pendingCreatesSignal();
    if (!current.has(tempId)) {
      return;
    }
    const next = new Map(current);
    next.delete(tempId);
    this.pendingCreatesSignal.set(next);
  }

  private setPendingStatusOverride(bookingId: string, status: BookingStatus): void {
    const next = new Map(this.pendingStatusOverridesSignal());
    next.set(bookingId, status);
    this.pendingStatusOverridesSignal.set(next);
  }

  private clearPendingStatusOverride(bookingId: string): void {
    const current = this.pendingStatusOverridesSignal();
    if (!current.has(bookingId)) {
      return;
    }
    const next = new Map(current);
    next.delete(bookingId);
    this.pendingStatusOverridesSignal.set(next);
  }

  private startUndoWindow(booking: Booking): void {
    this.clearUndoTimer();
    const expiresAtMs = this.clock.now().getTime() + UNDO_WINDOW_MS;
    this.undoActionSignal.set({
      bookingId: booking.id,
      bookingTitle: booking.title,
      expiresAtMs
    });

    this.undoTimerId = setTimeout(() => {
      this.undoTimerId = null;
      this.undoActionSignal.set(null);
    }, UNDO_WINDOW_MS);
  }

  private clearUndoTimer(): void {
    if (this.undoTimerId !== null) {
      clearTimeout(this.undoTimerId);
      this.undoTimerId = null;
    }
  }

  private clearGapResyncTimer(): void {
    if (this.gapResyncTimerId !== null) {
      clearTimeout(this.gapResyncTimerId);
      this.gapResyncTimerId = null;
    }
  }

  private extractErrorMessage(err: unknown): string {
    if (err instanceof Error && err.message) {
      return err.message;
    }
    return 'An unexpected error occurred while communicating with the booking service.';
  }
}
