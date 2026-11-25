import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ClockService } from '../../../../core/services/clock.service';
import { BOOKING_GATEWAY } from '../../../../core/tokens/booking-gateway.token';
import { MockBookingGateway } from '../../../../data-access/gateways/mock-booking.gateway';
import { MockBookingApiService } from '../../../../data-access/mock-api/mock-booking-api.service';
import { BookingHubStore } from '../../../../data-access/store/booking-hub.store';
import { UndoBannerComponent } from '../../../../shared/components/undo-banner/undo-banner.component';
import { MyBookingsPageComponent } from './my-bookings-page.component';

class StepClock extends ClockService {
  current = new Date('2026-11-25T07:00:00+02:00');
  override now(): Date {
    return new Date(this.current.getTime());
  }
  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

describe('MyBookingsPageComponent & UndoBannerComponent', () => {
  let store: BookingHubStore;
  let mockApi: MockBookingApiService;
  let clock: StepClock;

  beforeEach(async () => {
    clock = new StepClock();
    await TestBed.configureTestingModule({
      imports: [MyBookingsPageComponent, UndoBannerComponent],
      providers: [
        provideRouter([]),
        { provide: ClockService, useValue: clock },
        { provide: BOOKING_GATEWAY, useExisting: MockBookingGateway }
      ]
    }).compileComponents();

    mockApi = TestBed.inject(MockBookingApiService);
    mockApi.configureSimulation({ delayMs: 0 });
    mockApi.resetData('2026-11-25', 6, 3);

    store = TestBed.inject(BookingHubStore);
    store.initialize();
  });

  it('lists active user bookings and triggers 10-second Undo when cancelled', fakeAsync(() => {
    const fixture = TestBed.createComponent(MyBookingsPageComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.todayActiveCount()).toBe(1);
    const cancelBtn = fixture.nativeElement.querySelector('.btn-danger') as HTMLButtonElement;
    expect(cancelBtn).toBeTruthy();

    cancelBtn.click();
    fixture.detectChanges();

    expect(store.undoAction()).not.toBeNull();
    expect(fixture.componentInstance.todayActiveCount()).toBe(0);

    // Clean up 10s store timer
    store.dismissUndo();
    tick(0);
  }));

  it('displays a live 10-second countdown in UndoBannerComponent and emits undoRequested', fakeAsync(() => {
    const bannerFixture = TestBed.createComponent(UndoBannerComponent);
    const expiresAtMs = clock.now().getTime() + 10_000;
    bannerFixture.componentRef.setInput('undoAction', {
      bookingId: 'bk-1',
      bookingTitle: 'Platform Architecture Sync',
      expiresAtMs
    });
    bannerFixture.detectChanges();

    expect(bannerFixture.nativeElement.textContent).toContain('Undo (10s)');

    clock.advanceMs(3000);
    tick(3000);
    bannerFixture.detectChanges();
    expect(bannerFixture.nativeElement.textContent).toContain('Undo (7s)');

    const undoSpy = jasmine.createSpy('undoRequested');
    bannerFixture.componentInstance.undoRequested.subscribe(undoSpy);
    const undoBtn = bannerFixture.nativeElement.querySelector('.toast__undo-btn') as HTMLButtonElement;
    undoBtn.click();
    expect(undoSpy).toHaveBeenCalled();

    // Stop interval cleanly
    bannerFixture.componentRef.setInput('undoAction', null);
    bannerFixture.detectChanges();
  }));
});
