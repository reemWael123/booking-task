import { InjectionToken } from '@angular/core';
import { BookingGateway } from '../../data-access/gateways/booking.gateway';

export const BOOKING_GATEWAY = new InjectionToken<BookingGateway>('BOOKING_GATEWAY');
