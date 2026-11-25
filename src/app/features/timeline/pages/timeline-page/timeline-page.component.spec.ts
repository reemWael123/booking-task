import { TestBed } from '@angular/core/testing';
import { ClockService } from '../../../../core/services/clock.service';
import { BOOKING_GATEWAY } from '../../../../core/tokens/booking-gateway.token';
import { MockBookingGateway } from '../../../../data-access/gateways/mock-booking.gateway';
import { MockBookingApiService } from '../../../../data-access/mock-api/mock-booking-api.service';
import { BookingHubStore } from '../../../../data-access/store/booking-hub.store';
import { TimelinePageComponent } from './timeline-page.component';

class FixedClock extends ClockService {
  override now(): Date {
    return new Date('2026-11-25T07:00:00+02:00');
  }
}

describe('TimelinePageComponent', () => {
  let store: BookingHubStore;
  let mockApi: MockBookingApiService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TimelinePageComponent],
      providers: [
        { provide: ClockService, useValue: new FixedClock() },
        { provide: BOOKING_GATEWAY, useExisting: MockBookingGateway }
      ]
    }).compileComponents();

    mockApi = TestBed.inject(MockBookingApiService);
    mockApi.configureSimulation({ delayMs: 0 });
    mockApi.resetData('2026-11-25', 14, 5);

    store = TestBed.inject(BookingHubStore);
    store.initialize();
  });

  it('renders rooms, filters by floor/capacity/equipment, and shows empty state when none match', () => {
    const fixture = TestBed.createComponent(TimelinePageComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    expect(comp.filteredRooms().length).toBe(14);

    // Filter to Floor 2 only (rooms 13 & 14 -> 2 rooms)
    comp.onFilterChanged({ floor: 2, minCapacity: 1, equipment: [], searchQuery: '' });
    fixture.detectChanges();
    expect(comp.filteredRooms().length).toBe(2);

    // Impossible search query triggers empty state
    comp.onFilterChanged({ floor: null, minCapacity: 1, equipment: [], searchQuery: 'NonExistentRoomXYZ' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No rooms match your filters');
  });

  it('shows Saturday closed notice and Friday half-day columns (08:00–13:00)', () => {
    const fixture = TestBed.createComponent(TimelinePageComponent);
    const comp = fixture.componentInstance;

    // 2026-11-28 is Saturday
    comp.onDateChanged('2026-11-28');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Office Closed on Saturday');

    // 2026-11-27 is Friday -> 5 hourly columns (08:00..12:00)
    comp.onDateChanged('2026-11-27');
    fixture.detectChanges();
    const hourLabels = fixture.nativeElement.querySelectorAll('.hour-label');
    expect(hourLabels.length).toBe(5);
  });

  it('opens the Booking Drawer prefilled when clicking an available room slot', () => {
    const fixture = TestBed.createComponent(TimelinePageComponent);
    fixture.detectChanges();

    const firstSlotBtn = fixture.nativeElement.querySelector('.slot-cell') as HTMLButtonElement;
    expect(firstSlotBtn).toBeTruthy();
    firstSlotBtn.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.drawerOpen()).toBeTrue();
    expect(fixture.nativeElement.querySelector('#booking-drawer-title')?.textContent).toContain(
      'Reserve Meeting Room'
    );
  });
});
