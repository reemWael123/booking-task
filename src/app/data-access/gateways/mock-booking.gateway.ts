import { inject, Injectable } from '@angular/core';
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
import { MockBookingApiService } from '../mock-api/mock-booking-api.service';
import { BookingGateway } from './booking.gateway';

@Injectable({ providedIn: 'root' })
export class MockBookingGateway implements BookingGateway {
  private readonly mockApi = inject(MockBookingApiService);

  readonly liveEvents$: Observable<BookingLiveEvent> = this.mockApi.liveEvents$;

  getRooms(): Observable<ApiResponse<readonly Room[]>> {
    return this.mockApi.getRooms();
  }

  getBookingsByDate(dateKey: string): Observable<ApiResponse<BookingsSnapshot>> {
    return this.mockApi.getBookingsByDate(dateKey);
  }

  getUserBookings(userId: string): Observable<ApiResponse<readonly Booking[]>> {
    return this.mockApi.getUserBookings(userId);
  }

  createBooking(request: BookingRequest): Observable<ApiResponse<Booking>> {
    return this.mockApi.createBooking(request);
  }

  createRecurringBooking(
    request: RecurringBookingRequest
  ): Observable<ApiResponse<readonly Booking[]>> {
    return this.mockApi.createRecurringBooking(request);
  }

  cancelBooking(bookingId: string): Observable<ApiResponse<Booking>> {
    return this.mockApi.cancelBooking(bookingId);
  }

  restoreBooking(bookingId: string): Observable<ApiResponse<Booking>> {
    return this.mockApi.restoreBooking(bookingId);
  }
}
