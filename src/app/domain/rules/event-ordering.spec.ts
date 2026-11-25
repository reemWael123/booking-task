import { Booking, BookingLiveEvent } from '../../core/models';
import {
  createEventStreamState,
  getSequenceGap,
  ingestLiveEvent,
  needsSequenceResync,
  reconcileFromSnapshot
} from './event-ordering';

describe('Live Event Ordering & Sequence Gap Recovery', () => {
  const T0 = new Date('2026-11-25T10:00:00Z');

  function makeBooking(id: string, title = 'Sync', status: 'confirmed' | 'cancelled' = 'confirmed'): Booking {
    return {
      id,
      roomId: 'room-101',
      title,
      userId: 'user-1',
      userName: 'Salma Ali',
      startIso: '2026-11-25T10:00:00+02:00',
      endIso: '2026-11-25T11:00:00+02:00',
      attendees: 4,
      requiredEquipment: [],
      status
    };
  }

  function makeEvent(
    eventId: string,
    sequence: number,
    type: BookingLiveEvent['type'],
    booking: Booking
  ): BookingLiveEvent {
    return {
      eventId,
      sequence,
      type,
      booking,
      emittedAtIso: T0.toISOString()
    };
  }

  it('applies sequential events in order and ignores duplicate event IDs', () => {
    const initial = createEventStreamState([], 0);
    const e1 = makeEvent('evt-1', 1, 'BOOKING_CREATED', makeBooking('b1', 'Kickoff'));

    const first = ingestLiveEvent(initial, e1, T0);
    expect(first.outcome).toBe('applied');
    expect(first.state.lastAppliedSequence).toBe(1);
    expect(first.state.bookingsById.get('b1')?.title).toBe('Kickoff');

    const dup = ingestLiveEvent(first.state, e1, T0);
    expect(dup.outcome).toBe('duplicate');
    expect(dup.appliedEvents.length).toBe(0);
    expect(dup.state).toBe(first.state);
  });

  it('ignores stale events with older sequence numbers so newer state is never regressed', () => {
    const s0 = createEventStreamState([], 0);
    const e1 = makeEvent('evt-1', 1, 'BOOKING_CREATED', makeBooking('b1', 'Initial'));
    const e2 = makeEvent('evt-2', 2, 'BOOKING_CANCELLED', makeBooking('b1', 'Initial', 'cancelled'));
    const lateOldEvent = makeEvent('evt-old-retry', 1, 'BOOKING_CREATED', makeBooking('b1', 'Resurrected'));

    const s1 = ingestLiveEvent(s0, e1, T0).state;
    const s2 = ingestLiveEvent(s1, e2, T0).state;
    const s3 = ingestLiveEvent(s2, lateOldEvent, T0);

    expect(s3.outcome).toBe('stale');
    expect(s3.state.lastAppliedSequence).toBe(2);
    expect(s3.state.bookingsById.get('b1')?.status).toBe('cancelled');
  });

  it('buffers out-of-order future events and drains them strictly in order once missing sequence arrives', () => {
    const s0 = createEventStreamState([], 0);
    const e1 = makeEvent('evt-1', 1, 'BOOKING_CREATED', makeBooking('b1', 'V1'));
    const e2 = makeEvent('evt-2', 2, 'BOOKING_UPDATED', makeBooking('b1', 'V2'));
    const e3 = makeEvent('evt-3', 3, 'BOOKING_CANCELLED', makeBooking('b1', 'V2', 'cancelled'));

    // Arrive out of order: 3, then 2, then 1
    const r3 = ingestLiveEvent(s0, e3, T0);
    expect(r3.outcome).toBe('buffered');
    expect(r3.state.lastAppliedSequence).toBe(0);
    expect(r3.state.bookingsById.size).toBe(0);
    expect(getSequenceGap(r3.state)).toEqual({
      expectedSequence: 1,
      lowestBufferedSequence: 3,
      missingCount: 2
    });

    const r2 = ingestLiveEvent(r3.state, e2, new Date(T0.getTime() + 500));
    expect(r2.outcome).toBe('buffered');
    expect(getSequenceGap(r2.state)).toEqual({
      expectedSequence: 1,
      lowestBufferedSequence: 2,
      missingCount: 1
    });

    const r1 = ingestLiveEvent(r2.state, e1, new Date(T0.getTime() + 1000));
    expect(r1.outcome).toBe('applied');
    expect(r1.appliedEvents.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(r1.state.lastAppliedSequence).toBe(3);
    expect(r1.state.bufferedBySequence.size).toBe(0);
    expect(getSequenceGap(r1.state)).toBeNull();
    // Final state reflects seq 3 (cancelled), not seq 1
    expect(r1.state.bookingsById.get('b1')?.status).toBe('cancelled');
  });

  it('detects persistent sequence gaps and recovers cleanly via snapshot reconciliation', () => {
    const s0 = createEventStreamState([], 10);
    // Sequence 11 is permanently lost; 12 and 14 arrive
    const e12 = makeEvent('evt-12', 12, 'BOOKING_CREATED', makeBooking('b12', 'From Seq 12'));
    const e13 = makeEvent('evt-13', 13, 'BOOKING_CREATED', makeBooking('b13', 'From Seq 13'));

    const s1 = ingestLiveEvent(s0, e12, T0).state;
    const s2 = ingestLiveEvent(s1, e13, new Date(T0.getTime() + 1000)).state;

    expect(needsSequenceResync(s2, new Date(T0.getTime() + 4999), 5000)).toBeFalse();
    expect(needsSequenceResync(s2, new Date(T0.getTime() + 5000), 5000)).toBeTrue();

    // Snapshot fetched at sequence 12 includes missing seq 11 + seq 12; buffered seq 13 should drain!
    const snapshotBookings = [
      makeBooking('b11', 'Recovered Seq 11'),
      makeBooking('b12', 'From Seq 12')
    ];
    const recovered = reconcileFromSnapshot(
      s2,
      snapshotBookings,
      12,
      new Date(T0.getTime() + 5100)
    );

    expect(recovered.lastAppliedSequence).toBe(13);
    expect(recovered.bufferedBySequence.size).toBe(0);
    expect(getSequenceGap(recovered)).toBeNull();
    expect(recovered.bookingsById.has('b11')).toBeTrue();
    expect(recovered.bookingsById.has('b12')).toBeTrue();
    expect(recovered.bookingsById.has('b13')).toBeTrue();
  });

  it('triggers immediate resync when buffered events reach maxBufferSize and rejects stale snapshots', () => {
    let state = createEventStreamState([], 0);
    // Buffer sequences 2, 3, 4 with maxBufferSize = 3
    for (const seq of [2, 3, 4]) {
      state = ingestLiveEvent(
        state,
        makeEvent(`evt-${seq}`, seq, 'BOOKING_CREATED', makeBooking(`b${seq}`)),
        T0
      ).state;
    }

    expect(needsSequenceResync(state, T0, 5000, 3)).toBeTrue();

    // Advance stream to seq 5 and verify stale snapshot at seq 3 is ignored
    const advanced = createEventStreamState([makeBooking('b5', 'Current')], 5);
    const afterStaleSnap = reconcileFromSnapshot(advanced, [makeBooking('old', 'Old')], 3, T0);
    expect(afterStaleSnap).toBe(advanced);
    expect(afterStaleSnap.bookingsById.has('b5')).toBeTrue();
    expect(afterStaleSnap.bookingsById.has('old')).toBeFalse();
  });
});
