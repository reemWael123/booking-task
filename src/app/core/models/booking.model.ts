import { EquipmentType } from './room.model';

export type BookingStatus = 'confirmed' | 'cancelled';

export interface Booking {
  readonly id: string;
  readonly roomId: string;
  readonly title: string;
  readonly userId: string;
  readonly userName: string;
  /** ISO-8601 timestamp with explicit UTC 'Z' or numeric offset (e.g. '+02:00', '+03:00'). */
  readonly startIso: string;
  /** ISO-8601 timestamp with explicit UTC 'Z' or numeric offset. */
  readonly endIso: string;
  readonly attendees: number;
  readonly requiredEquipment: readonly EquipmentType[];
  readonly status: BookingStatus;
  readonly recurrenceGroupId?: string;
  readonly optimistic?: boolean;
}

export interface BookingRequest {
  readonly roomId: string;
  readonly title: string;
  readonly userId: string;
  readonly userName: string;
  /** ISO-8601 timestamp with explicit UTC 'Z' or numeric offset. */
  readonly startIso: string;
  /** ISO-8601 timestamp with explicit UTC 'Z' or numeric offset. */
  readonly endIso: string;
  readonly attendees: number;
  readonly requiredEquipment: readonly EquipmentType[];
  /** Optional booking ID excluded from conflict/limit checks (e.g. optimistic self). */
  readonly excludeBookingId?: string;
}

export interface RecurringBookingRequest extends BookingRequest {
  /** Number of weekly occurrences, inclusive of the first booking (1 to 4). */
  readonly weeks: number;
}
