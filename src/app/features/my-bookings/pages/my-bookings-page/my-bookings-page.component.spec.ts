import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ClockService } from '../../../../core/services/clock.service';
import { DEFAULT_CURRENT_USER } from '../../../../core/services/user-context.service';
import { BOOKING_GATEWAY } from '../../../../core/tokens/booking-gateway.token';
import { MockBookingGateway } from '../../../../data-access/gateways/mock-booking.gateway';
import { MockBookingApiService } from '../../../../data-access/mock-api/mock-booking-api.service';
import { BookingHubStore } from '../../../../data-access/store/booking-hub.store';
import { addCairoDays, getWorkingHoursForDateKey } from '../../../../domain';
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

  it('paginates bookings at 10 per page, resets on filter change, and clamps last page on cancel', fakeAsync(() => {
    const rooms = store.rooms();
    // Seed starts with 2 active bookings for DEFAULT_CURRENT_USER; create 9 more across open weekdays = 11 total
    let createdCount = 0;
    for (let dayOffset = 2; createdCount < 9; dayOffset++) {
      const dateKey = addCairoDays('2026-11-25', dayOffset);
      if (!getWorkingHoursForDateKey(dateKey)) {
        continue; // Skip Saturdays
      }
      store
        .createBooking({
          roomId: rooms[createdCount % rooms.length].id,
          title: `Paginated Booking #${createdCount + 1}`,
          userId: DEFAULT_CURRENT_USER.id,
          userName: DEFAULT_CURRENT_USER.name,
          startIso: `${dateKey}T08:00:00+02:00`,
          endIso: `${dateKey}T08:15:00+02:00`,
          attendees: 2,
          requiredEquipment: []
        })
        .subscribe();
      createdCount++;
    }

    const fixture = TestBed.createComponent(MyBookingsPageComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    expect(comp.filteredItems().length).toBe(11);
    expect(comp.paginatedItems().length).toBe(10);
    expect(el.querySelectorAll('.booking-card').length).toBe(10);
    expect(el.textContent).toContain('Showing 1–10 of 11 bookings');

    // Navigate to page 2 -> shows the 11th booking
    const nextBtn = el.querySelectorAll('.page-btn--nav')[1] as HTMLButtonElement;
    nextBtn.click();
    fixture.detectChanges();

    expect(comp.effectivePage()).toBe(2);
    expect(comp.paginatedItems().length).toBe(1);
    expect(el.querySelectorAll('.booking-card').length).toBe(1);
    expect(el.textContent).toContain('Showing 11–11 of 11 bookings');

    // Cancelling the sole item on page 2 clamps back to page 1 (10 active items left)
    const cancelBtn = el.querySelector('.btn-danger') as HTMLButtonElement;
    cancelBtn.click();
    fixture.detectChanges();

    expect(comp.filteredItems().length).toBe(10);
    expect(comp.effectivePage()).toBe(1);
    expect(el.textContent).toContain('Showing 1–10 of 10 bookings');

    // Switching to Cancelled tab resets to page 1 and shows the 1 cancelled booking
    comp.setFilter('cancelled');
    fixture.detectChanges();
    expect(comp.effectivePage()).toBe(1);
    expect(el.textContent).toContain('Showing 1–1 of 1 bookings');

    // Switching to All tab shows all 11 bookings starting at page 1
    comp.onPageChanged(2); // out of bounds for cancelled -> stays 1
    comp.setFilter('all');
    fixture.detectChanges();
    expect(comp.effectivePage()).toBe(1);
    expect(comp.filteredItems().length).toBe(11);
    expect(el.textContent).toContain('Showing 1–10 of 11 bookings');

    store.dismissUndo();
    tick(0);
  }));
});
