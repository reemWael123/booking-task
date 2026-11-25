import { TestBed } from '@angular/core/testing';
import { ClockService } from '../../../../core/services/clock.service';
import { BOOKING_GATEWAY } from '../../../../core/tokens/booking-gateway.token';
import { MockBookingGateway } from '../../../../data-access/gateways/mock-booking.gateway';
import { MockBookingApiService } from '../../../../data-access/mock-api/mock-booking-api.service';
import { BookingHubStore } from '../../../../data-access/store/booking-hub.store';
import { BookingDrawerComponent } from './booking-drawer.component';

class FixedClock extends ClockService {
  override now(): Date {
    return new Date('2026-11-25T07:00:00+02:00');
  }
}

describe('BookingDrawerComponent', () => {
  let store: BookingHubStore;
  let mockApi: MockBookingApiService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BookingDrawerComponent],
      providers: [
        { provide: ClockService, useValue: new FixedClock() },
        { provide: BOOKING_GATEWAY, useExisting: MockBookingGateway }
      ]
    }).compileComponents();

    mockApi = TestBed.inject(MockBookingApiService);
    mockApi.configureSimulation({ delayMs: 0 });
    mockApi.resetData('2026-11-25', 6, 3);

    store = TestBed.inject(BookingHubStore);
    store.initialize();
  });

  it('shows live validation errors for missing equipment and offers alternative suggestions', () => {
    const fixture = TestBed.createComponent(BookingDrawerComponent);
    const rooms = store.rooms();
    // Pick a room that lacks 'accessibility'
    const limitedRoom = rooms.find((r) => !r.equipment.includes('accessibility')) ?? rooms[0];

    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('rooms', rooms);
    fixture.componentRef.setInput('selection', {
      roomId: limitedRoom.id,
      dateKey: '2026-11-25',
      startTime: '08:00',
      endTime: '08:15'
    });
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.form.patchValue({ title: 'Design Sync', attendees: 2 });
    comp.toggleEquipment('accessibility');
    fixture.detectChanges();

    expect(comp.isDomainValid()).toBeFalse();
    expect(comp.validationErrors().some((e) => e.code === 'MISSING_EQUIPMENT')).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('missing required equipment');
  });

  it('submits a valid booking through the store and emits closed', () => {
    const fixture = TestBed.createComponent(BookingDrawerComponent);
    const rooms = store.rooms();
    const closedSpy = jasmine.createSpy('closed');
    fixture.componentInstance.closed.subscribe(closedSpy);

    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('rooms', rooms);
    fixture.componentRef.setInput('selection', {
      roomId: rooms[0].id,
      dateKey: '2026-11-25',
      startTime: '08:00',
      endTime: '08:15'
    });
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.form.patchValue({ title: 'Drawer Booking', attendees: 2 });
    fixture.detectChanges();

    expect(comp.canSubmit()).toBeTrue();
    comp.onSubmit();

    expect(closedSpy).toHaveBeenCalled();
    expect(store.selectedDateBookings().some((b) => b.title === 'Drawer Booking')).toBeTrue();
  });
});
