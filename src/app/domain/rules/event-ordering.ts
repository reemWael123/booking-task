import { Booking, BookingLiveEvent } from '../../core/models';

export interface EventStreamState {
  readonly lastAppliedSequence: number;
  readonly processedEventIds: ReadonlySet<string>;
  readonly bufferedBySequence: ReadonlyMap<number, BookingLiveEvent>;
  readonly bookingsById: ReadonlyMap<string, Booking>;
  readonly gapDetectedAtMs: number | null;
}

export type EventIngestOutcome = 'applied' | 'buffered' | 'duplicate' | 'stale';

export interface EventIngestResult {
  readonly state: EventStreamState;
  readonly outcome: EventIngestOutcome;
  readonly appliedEvents: readonly BookingLiveEvent[];
}

export interface SequenceGapInfo {
  readonly expectedSequence: number;
  readonly lowestBufferedSequence: number;
  readonly missingCount: number;
}

export function createEventStreamState(
  initialBookings: readonly Booking[] = [],
  initialSequence = 0
): EventStreamState {
  const bookingsById = new Map<string, Booking>();
  for (const booking of initialBookings) {
    bookingsById.set(booking.id, booking);
  }
  return {
    lastAppliedSequence: initialSequence,
    processedEventIds: new Set<string>(),
    bufferedBySequence: new Map<number, BookingLiveEvent>(),
    bookingsById,
    gapDetectedAtMs: null
  };
}

function applyBookingMutation(
  bookingsById: Map<string, Booking>,
  event: BookingLiveEvent
): void {
  switch (event.type) {
    case 'BOOKING_CREATED':
    case 'BOOKING_UPDATED':
      bookingsById.set(event.booking.id, { ...event.booking, optimistic: false });
      break;
    case 'BOOKING_CANCELLED':
      bookingsById.set(event.booking.id, {
        ...event.booking,
        status: 'cancelled',
        optimistic: false
      });
      break;
  }
}

/**
 * Processes an incoming live booking event with deduplication, strict sequence ordering,
 * out-of-order buffering, and sequence-gap tracking.
 */
export function ingestLiveEvent(
  state: EventStreamState,
  event: BookingLiveEvent,
  receivedAt: Date
): EventIngestResult {
  if (state.processedEventIds.has(event.eventId)) {
    return { state, outcome: 'duplicate', appliedEvents: [] };
  }

  const nextProcessedIds = new Set(state.processedEventIds);
  nextProcessedIds.add(event.eventId);

  // Stale event with a sequence already applied (or duplicate sequence already buffered)
  if (event.sequence <= state.lastAppliedSequence || state.bufferedBySequence.has(event.sequence)) {
    return {
      state: {
        ...state,
        processedEventIds: nextProcessedIds
      },
      outcome: 'stale',
      appliedEvents: []
    };
  }

  // Future event: sequence gap detected, buffer until missing sequence(s) arrive or resync runs
  if (event.sequence > state.lastAppliedSequence + 1) {
    const nextBuffer = new Map(state.bufferedBySequence);
    nextBuffer.set(event.sequence, event);
    return {
      state: {
        ...state,
        processedEventIds: nextProcessedIds,
        bufferedBySequence: nextBuffer,
        gapDetectedAtMs: state.gapDetectedAtMs ?? receivedAt.getTime()
      },
      outcome: 'buffered',
      appliedEvents: []
    };
  }

  // Exact next sequence: apply this event and drain any contiguous buffered events
  const nextBookings = new Map(state.bookingsById);
  const nextBuffer = new Map(state.bufferedBySequence);
  const appliedEvents: BookingLiveEvent[] = [];

  applyBookingMutation(nextBookings, event);
  appliedEvents.push(event);
  let nextSequence = event.sequence;

  while (nextBuffer.has(nextSequence + 1)) {
    const queued = nextBuffer.get(nextSequence + 1)!;
    nextBuffer.delete(nextSequence + 1);
    applyBookingMutation(nextBookings, queued);
    appliedEvents.push(queued);
    nextSequence = queued.sequence;
  }

  return {
    state: {
      lastAppliedSequence: nextSequence,
      processedEventIds: nextProcessedIds,
      bufferedBySequence: nextBuffer,
      bookingsById: nextBookings,
      gapDetectedAtMs: nextBuffer.size > 0 ? (state.gapDetectedAtMs ?? receivedAt.getTime()) : null
    },
    outcome: 'applied',
    appliedEvents
  };
}

/**
 * Returns details about the current missing sequence gap, or null when the stream is contiguous.
 */
export function getSequenceGap(state: EventStreamState): SequenceGapInfo | null {
  if (state.bufferedBySequence.size === 0) {
    return null;
  }

  let lowestBuffered = Infinity;
  for (const seq of state.bufferedBySequence.keys()) {
    if (seq < lowestBuffered) {
      lowestBuffered = seq;
    }
  }

  const expectedSequence = state.lastAppliedSequence + 1;
  return {
    expectedSequence,
    lowestBufferedSequence: lowestBuffered,
    missingCount: Math.max(0, lowestBuffered - expectedSequence)
  };
}

/**
 * Determines whether a persistent sequence gap requires an authoritative snapshot resync.
 */
export function needsSequenceResync(
  state: EventStreamState,
  now: Date,
  gapTimeoutMs = 5_000,
  maxBufferSize = 50
): boolean {
  if (state.bufferedBySequence.size === 0) {
    return false;
  }
  if (state.bufferedBySequence.size >= maxBufferSize) {
    return true;
  }
  if (state.gapDetectedAtMs === null) {
    return false;
  }
  return now.getTime() - state.gapDetectedAtMs >= gapTimeoutMs;
}

/**
 * Recovers from a missing sequence gap by replacing state with an authoritative snapshot
 * at `snapshotSequence`, dropping stale buffered events, and draining any newer contiguous events.
 */
export function reconcileFromSnapshot(
  state: EventStreamState,
  snapshotBookings: readonly Booking[],
  snapshotSequence: number,
  reconciledAt: Date
): EventStreamState {
  if (snapshotSequence < state.lastAppliedSequence) {
    return state;
  }

  const nextBookings = new Map<string, Booking>();
  for (const booking of snapshotBookings) {
    nextBookings.set(booking.id, { ...booking, optimistic: false });
  }

  const nextBuffer = new Map<number, BookingLiveEvent>();
  for (const [seq, bufferedEvent] of state.bufferedBySequence.entries()) {
    if (seq > snapshotSequence) {
      nextBuffer.set(seq, bufferedEvent);
    }
  }

  let nextSequence = Math.max(state.lastAppliedSequence, snapshotSequence);
  while (nextBuffer.has(nextSequence + 1)) {
    const queued = nextBuffer.get(nextSequence + 1)!;
    nextBuffer.delete(nextSequence + 1);
    applyBookingMutation(nextBookings, queued);
    nextSequence = queued.sequence;
  }

  return {
    lastAppliedSequence: nextSequence,
    processedEventIds: state.processedEventIds,
    bufferedBySequence: nextBuffer,
    bookingsById: nextBookings,
    gapDetectedAtMs: nextBuffer.size > 0 ? reconciledAt.getTime() : null
  };
}
