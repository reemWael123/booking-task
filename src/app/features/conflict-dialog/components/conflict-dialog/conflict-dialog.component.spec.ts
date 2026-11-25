import { TestBed } from '@angular/core/testing';
import { ActiveConflictState, SuggestedSlot } from '../../../../core/models';
import { ConflictDialogComponent } from './conflict-dialog.component';

describe('ConflictDialogComponent', () => {
  const sampleConflict: ActiveConflictState = {
    message: 'This slot was just reserved by Karim Mansour.',
    request: {
      roomId: 'room-101',
      title: 'My Sync',
      userId: 'user-nadia',
      userName: 'Nadia Hassan',
      startIso: '2026-11-25T10:00:00+02:00',
      endIso: '2026-11-25T11:00:00+02:00',
      attendees: 4,
      requiredEquipment: []
    },
    conflictingBooking: {
      id: 'bk-race-1',
      roomId: 'room-101',
      title: 'Urgent Escalation',
      userId: 'user-karim',
      userName: 'Karim Mansour',
      startIso: '2026-11-25T10:00:00+02:00',
      endIso: '2026-11-25T11:00:00+02:00',
      attendees: 4,
      requiredEquipment: [],
      status: 'confirmed'
    },
    alternatives: [
      {
        slot: {
          roomId: 'room-101',
          roomName: '101 Nile Boardroom',
          startIso: '2026-11-25T11:15:00+02:00',
          endIso: '2026-11-25T12:15:00+02:00',
          dateKey: '2026-11-25',
          startLocal: '11:15',
          endLocal: '12:15'
        },
        validation: {
          valid: false,
          errors: [
            {
              code: 'DAILY_LIMIT_EXCEEDED',
              message: 'You can hold at most 3 active bookings per day.'
            }
          ],
          conflicts: []
        },
        allowed: false
      },
      {
        slot: {
          roomId: 'room-102',
          roomName: '102 Zamalek Boardroom',
          startIso: '2026-11-26T09:00:00+02:00',
          endIso: '2026-11-26T10:00:00+02:00',
          dateKey: '2026-11-26',
          startLocal: '09:00',
          endLocal: '10:00'
        },
        validation: { valid: true, errors: [], conflicts: [] },
        allowed: true
      },
      {
        slot: {
          roomId: 'room-103',
          roomName: '103 Maadi Boardroom',
          startIso: '2026-11-26T10:00:00+02:00',
          endIso: '2026-11-26T11:00:00+02:00',
          dateKey: '2026-11-26',
          startLocal: '10:00',
          endLocal: '11:00'
        },
        validation: { valid: true, errors: [], conflicts: [] },
        allowed: true
      }
    ]
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConflictDialogComponent]
    }).compileComponents();
  });

  it('displays the conflicting owner, disables daily-limit-blocked slots, and emits allowed selection', () => {
    const fixture = TestBed.createComponent(ConflictDialogComponent);
    fixture.componentRef.setInput('conflict', sampleConflict);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Karim Mansour');
    expect(el.textContent).toContain('Urgent Escalation');
    expect(el.textContent).toContain('You can hold at most 3 active bookings per day.');

    const buttons = Array.from(el.querySelectorAll('.alt-item__btn')) as HTMLButtonElement[];
    expect(buttons.length).toBe(3);
    expect(buttons[0].disabled).toBeTrue();
    expect(buttons[1].disabled).toBeFalse();

    let selected: SuggestedSlot | undefined;
    fixture.componentInstance.selectAlternative.subscribe((slot) => (selected = slot));
    buttons[1].click();
    expect(selected?.roomId).toBe('room-102');
  });
});
