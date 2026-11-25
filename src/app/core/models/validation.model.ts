import { Booking } from './booking.model';

export type ValidationErrorCode =
  | 'INVALID_TIMESTAMP'
  | 'INVALID_TIME_RANGE'
  | 'IN_THE_PAST'
  | 'MAX_DURATION_EXCEEDED'
  | 'DAY_CLOSED'
  | 'OUTSIDE_WORKING_HOURS'
  | 'CROSSES_MIDNIGHT'
  | 'CROSSES_CLOSING_TIME'
  | 'CAPACITY_EXCEEDED'
  | 'INVALID_ATTENDEES'
  | 'MISSING_EQUIPMENT'
  | 'ROOM_CONFLICT'
  | 'BUFFER_VIOLATION'
  | 'DAILY_LIMIT_EXCEEDED'
  | 'INVALID_RECURRENCE_WEEKS'
  | 'NONEXISTENT_LOCAL_TIME';

export interface ValidationIssue {
  readonly code: ValidationErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number | readonly string[]>>;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationIssue[];
  readonly conflicts: readonly Booking[];
}

export interface SuggestedSlot {
  readonly roomId: string;
  readonly roomName: string;
  readonly startIso: string;
  readonly endIso: string;
  readonly dateKey: string;
  readonly startLocal: string;
  readonly endLocal: string;
}

export interface RecurringOccurrenceValidation {
  readonly weekIndex: number;
  readonly dateKey: string;
  readonly startIso: string | null;
  readonly endIso: string | null;
  readonly result: ValidationResult;
}

export interface RecurringValidationResult {
  readonly valid: boolean;
  readonly allOrNothingFailed: boolean;
  readonly occurrences: readonly RecurringOccurrenceValidation[];
  readonly errors: readonly ValidationIssue[];
}
