import { Booking, BookingRequest } from './booking.model';
import { SuggestedSlot, ValidationResult } from './validation.model';

export interface ApiResponse<T> {
  readonly status: number;
  readonly data: T;
  readonly timestampIso: string;
}

export interface BookingsSnapshot {
  readonly dateKey: string;
  readonly bookings: readonly Booking[];
  readonly sequence: number;
}

export interface ConflictErrorPayload {
  readonly message: string;
  readonly conflictingBooking: Booking;
  readonly alternatives: readonly SuggestedSlot[];
}

export type ApiErrorCode = 'CONFLICT' | 'VALIDATION_ERROR' | 'NOT_FOUND' | 'SERVER_ERROR';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly conflict?: ConflictErrorPayload
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface MockSimulationConfig {
  /** Simulated network latency in ms. Defaults to 180ms; set 0 in unit tests. */
  readonly delayMs: number;
  /** When true, the next createBooking call triggers a realistic 409 race conflict. */
  readonly forceNextConflict: boolean;
  /** Competitor name used when simulating a 409 race conflict. */
  readonly conflictCompetitorName: string;
  /** When true, the next mutation fails with HTTP 500 Server Error. */
  readonly forceNextServerError: boolean;
}

export interface ValidatedSuggestedSlot {
  readonly slot: SuggestedSlot;
  readonly validation: ValidationResult;
  readonly allowed: boolean;
}

export interface ActiveConflictState {
  readonly request: BookingRequest;
  readonly conflictingBooking: Booking;
  readonly alternatives: readonly ValidatedSuggestedSlot[];
  readonly message: string;
}

export interface UndoCancelAction {
  readonly bookingId: string;
  readonly bookingTitle: string;
  readonly expiresAtMs: number;
}
