import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ClockService } from '../../../core/services/clock.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { BOOKING_GATEWAY } from '../../../core/tokens/booking-gateway.token';
import { MockBookingGateway } from '../../../data-access/gateways/mock-booking.gateway';
import { MockBookingApiService } from '../../../data-access/mock-api/mock-booking-api.service';
import { BookingHubStore } from '../../../data-access/store/booking-hub.store';
import { AppShellComponent } from './app-shell.component';

class FixedClock extends ClockService {
  override now(): Date {
    return new Date('2026-11-25T07:00:00+02:00');
  }
}

describe('AppShellComponent (Switch User & Undo 409 Race Flow)', () => {
  let store: BookingHubStore;
  let mockApi: MockBookingApiService;
  let userContext: UserContextService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [
        provideRouter([]),
        { provide: ClockService, useValue: new FixedClock() },
        { provide: BOOKING_GATEWAY, useExisting: MockBookingGateway }
      ]
    }).compileComponents();

    mockApi = TestBed.inject(MockBookingApiService);
    mockApi.configureSimulation({ delayMs: 0, forceNextConflict: false, forceNextServerError: false });
    mockApi.resetData('2026-11-25', 6, 3);

    userContext = TestBed.inject(UserContextService);
    store = TestBed.inject(BookingHubStore);
    store.initialize();
  });

  it('switches the active demo user from the sidebar dropdown and loads that user context', () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('#demo-user-switch') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.options.length).toBe(2);
    expect(userContext.currentUser().id).toBe('user-nadia');

    select.value = 'user-omar';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(userContext.currentUser().id).toBe('user-omar');
    expect(fixture.nativeElement.querySelector('.user-card__name')?.textContent).toContain(
      'Omar Tarek'
    );
  });

  it('opens the Conflict Dialog with 3 alternatives when Undo hits a simulated 409 race', fakeAsync(() => {
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    const activeBooking = store.currentUserBookings().find((b) => b.status === 'confirmed')!;
    expect(activeBooking).toBeDefined();

    // Cancel booking -> Undo banner renders in shell
    store.cancelBooking(activeBooking.id).subscribe();
    fixture.detectChanges();
    const undoBtn = fixture.nativeElement.querySelector('.toast__undo-btn') as HTMLButtonElement;
    expect(undoBtn).toBeTruthy();

    // Arm Simulate Next 409 Race and click Undo
    mockApi.configureSimulation({ forceNextConflict: true, conflictCompetitorName: 'Karim Mansour' });
    undoBtn.click();
    fixture.detectChanges();

    // Original booking stays cancelled and Conflict Dialog renders competing user + 3 alternatives
    expect(store.mergedBookingsById().get(activeBooking.id)?.status).toBe('cancelled');
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Karim Mansour');
    expect(dialog.querySelectorAll('.alt-item').length).toBe(3);

    tick(0);
  }));
});
