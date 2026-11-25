import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ClockService } from './core/services/clock.service';
import { BOOKING_GATEWAY } from './core/tokens/booking-gateway.token';
import { MockBookingGateway } from './data-access/gateways/mock-booking.gateway';
import { MockBookingApiService } from './data-access/mock-api/mock-booking-api.service';
import { AppComponent } from './app.component';

class TestClock extends ClockService {
  override now(): Date {
    return new Date('2026-11-25T07:00:00+02:00');
  }
}

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        { provide: ClockService, useValue: new TestClock() },
        { provide: BOOKING_GATEWAY, useExisting: MockBookingGateway }
      ]
    }).compileComponents();

    const mockApi = TestBed.inject(MockBookingApiService);
    mockApi.configureSimulation({ delayMs: 0 });
    mockApi.resetData('2026-11-25', 6, 3);
  });

  it('creates the root application shell', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('has the Room Booking Hub title', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance.title).toBe('Room Booking Hub');
  });

  it('renders the dashboard shell with navigation and Cairo timezone indicator', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Room Booking Hub');
    expect(compiled.textContent).toContain('Africa/Cairo');
    expect(compiled.textContent).toContain('Day Timeline');
    expect(compiled.textContent).toContain('My Bookings');
  });
});
