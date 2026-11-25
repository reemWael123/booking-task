import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

import { routes } from './app.routes';
import { BOOKING_GATEWAY } from './core/tokens/booking-gateway.token';
import { MockBookingGateway } from './data-access/gateways/mock-booking.gateway';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    { provide: BOOKING_GATEWAY, useExisting: MockBookingGateway }
  ]
};
