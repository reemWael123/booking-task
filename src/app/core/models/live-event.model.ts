import { Booking } from './booking.model';

export type BookingEventType = 'BOOKING_CREATED' | 'BOOKING_CANCELLED' | 'BOOKING_UPDATED';

export interface BookingLiveEvent {
  readonly eventId: string;
  readonly sequence: number;
  readonly type: BookingEventType;
  readonly booking: Booking;
  readonly emittedAtIso: string;
}
