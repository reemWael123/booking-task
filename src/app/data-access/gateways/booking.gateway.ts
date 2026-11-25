import { Observable } from 'rxjs';
import {
  ApiResponse,
  Booking,
  BookingLiveEvent,
  BookingRequest,
  BookingsSnapshot,
  RecurringBookingRequest,
  Room
} from '../../core/models';

/**
 * Backend-agnostic data gateway abstraction.
 * Swap MockBookingGateway for an HttpClient-backed implementation
 * without changing domain rules, the store, or UI components.
 */
export interface BookingGateway {
  readonly liveEvents$: Observable<BookingLiveEvent>;
  getRooms(): Observable<ApiResponse<readonly Room[]>>;
  getBookingsByDate(dateKey: string): Observable<ApiResponse<BookingsSnapshot>>;
  getUserBookings(userId: string): Observable<ApiResponse<readonly Booking[]>>;
  createBooking(request: BookingRequest): Observable<ApiResponse<Booking>>;
  createRecurringBooking(request: RecurringBookingRequest): Observable<ApiResponse<readonly Booking[]>>;
  cancelBooking(bookingId: string): Observable<ApiResponse<Booking>>;
  restoreBooking(bookingId: string): Observable<ApiResponse<Booking>>;
}
