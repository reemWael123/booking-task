import { TestBed } from '@angular/core/testing';
import { BookingLiveEvent } from '../../core/models';
import { ClockService } from '../../core/services/clock.service';
import { BOOKING_GATEWAY } from '../../core/tokens/booking-gateway.token';
import { MockBookingApiService } from '../mock-api/mock-booking-api.service';
import { BookingGateway } from './booking.gateway';
import { MockBookingGateway } from './mock-booking.gateway';

class FixedClockService extends ClockService {
  override now(): Date {
    return new Date('2026-11-25T07:00:00+02:00');
  }
}

describe('MockBookingGateway', () => {
  let gateway: BookingGateway;
  let mockApi: MockBookingApiService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ClockService, useValue: new FixedClockService() },
        { provide: BOOKING_GATEWAY, useExisting: MockBookingGateway }
      ]
    });

    gateway = TestBed.inject(BOOKING_GATEWAY);
    mockApi = TestBed.inject(MockBookingApiService);
    mockApi.configureSimulation({ delayMs: 0, forceNextConflict: false, forceNextServerError: false });
    mockApi.resetData('2026-11-25', 6, 3);
  });

  it('resolves via BOOKING_GATEWAY token and delegates CRUD + live events', () => {
    let roomId = '';
    gateway.getRooms().subscribe((res) => {
      expect(res.status).toBe(200);
      expect(res.data.length).toBe(6);
      roomId = res.data[0].id;
    });

    const receivedEvents: BookingLiveEvent[] = [];
    const sub = gateway.liveEvents$.subscribe((e) => receivedEvents.push(e));

    let createdId = '';
    gateway
      .createBooking({
        roomId,
        title: 'Gateway Test',
        userId: 'user-nadia',
        userName: 'Nadia Hassan',
        startIso: '2026-11-25T08:00:00+02:00',
        endIso: '2026-11-25T08:15:00+02:00',
        attendees: 2,
        requiredEquipment: []
      })
      .subscribe((res) => {
        expect(res.status).toBe(201);
        createdId = res.data.id;
      });

    expect(createdId).toBeTruthy();
    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].booking.id).toBe(createdId);

    gateway.cancelBooking(createdId).subscribe((res) => {
      expect(res.data.status).toBe('cancelled');
    });

    gateway.restoreBooking(createdId).subscribe((res) => {
      expect(res.data.status).toBe('confirmed');
    });

    sub.unsubscribe();
  });
});
