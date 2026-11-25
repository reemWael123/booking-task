import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  HostListener,
  inject,
  input,
  output
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { startWith } from 'rxjs/operators';
import {
  BookingRequest,
  EquipmentType,
  RecurringBookingRequest,
  Room,
  SuggestedSlot,
  ValidatedSuggestedSlot
} from '../../../../core/models';
import { BookingHubStore } from '../../../../data-access/store/booking-hub.store';
import {
  addCairoDays,
  formatCairoOffsetIso,
  formatTimeHHMM,
  resolveCairoDateKeyTime
} from '../../../../domain';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';

export interface DrawerSlotSelection {
  readonly roomId: string;
  readonly dateKey: string;
  readonly startTime: string;
  readonly endTime: string;
}

export const ALL_EQUIPMENT_OPTIONS: readonly { readonly value: EquipmentType; readonly label: string }[] = [
  { value: 'projector', label: 'Projector' },
  { value: 'whiteboard', label: 'Whiteboard' },
  { value: 'video-conferencing', label: 'Video Conf.' },
  { value: 'tv-screen', label: 'TV Screen' },
  { value: 'conference-phone', label: 'Conf. Phone' },
  { value: 'accessibility', label: 'Accessible' }
];

function buildTimeOptions(startHour: number, endHour: number): readonly string[] {
  const options: string[] = [];
  for (let m = startHour * 60; m <= endHour * 60; m += 15) {
    options.push(formatTimeHHMM(Math.floor(m / 60), m % 60));
  }
  return options;
}

function parseHHMM(value: string): { hour: number; minute: number } | null {
  const parts = value.split(':');
  if (parts.length !== 2) {
    return null;
  }
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return { hour, minute };
}

@Component({
  selector: 'app-booking-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, StatusBadgeComponent],
  templateUrl: './booking-drawer.component.html',
  styleUrl: './booking-drawer.component.scss'
})
export class BookingDrawerComponent {
  private readonly fb = inject(FormBuilder);
  readonly store = inject(BookingHubStore);

  readonly open = input<boolean>(false);
  readonly rooms = input<readonly Room[]>([]);
  readonly selection = input<DrawerSlotSelection | null>(null);

  readonly closed = output<void>();

  readonly equipmentOptions = ALL_EQUIPMENT_OPTIONS;
  readonly startTimeOptions = buildTimeOptions(7, 18);
  readonly endTimeOptions = buildTimeOptions(8, 19);

  readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    roomId: ['', [Validators.required]],
    dateKey: ['', [Validators.required]],
    startTime: ['09:00', [Validators.required]],
    endTime: ['10:00', [Validators.required]],
    attendees: [4, [Validators.required, Validators.min(1)]],
    requiredEquipment: this.fb.nonNullable.control<EquipmentType[]>([]),
    recurring: [false],
    weeks: [2, [Validators.min(2), Validators.max(4)]]
  });

  private readonly formValue = toSignal(
    this.form.valueChanges.pipe(startWith(this.form.getRawValue())),
    { initialValue: this.form.getRawValue() }
  );

  readonly selectedRoom = computed<Room | undefined>(() => {
    const roomId = this.formValue().roomId;
    return this.rooms().find((r) => r.id === roomId);
  });

  readonly candidateRequest = computed<BookingRequest | null>(() => {
    const val = this.formValue();
    if (!val.roomId || !val.dateKey || !val.startTime || !val.endTime) {
      return null;
    }
    const startParsed = parseHHMM(val.startTime);
    const endParsed = parseHHMM(val.endTime);
    if (!startParsed || !endParsed) {
      return null;
    }

    const startRes = resolveCairoDateKeyTime(val.dateKey, startParsed.hour, startParsed.minute, 'earlier');
    const endRes = resolveCairoDateKeyTime(val.dateKey, endParsed.hour, endParsed.minute, 'earlier');
    if (!startRes.date || !endRes.date) {
      return null;
    }

    const user = this.store.currentUser();
    return {
      roomId: val.roomId,
      title: val.title ?? '',
      userId: user.id,
      userName: user.name,
      startIso: formatCairoOffsetIso(startRes.date),
      endIso: formatCairoOffsetIso(endRes.date),
      attendees: Number(val.attendees ?? 1),
      requiredEquipment: val.requiredEquipment ?? []
    };
  });

  readonly singleValidation = computed(() => {
    const req = this.candidateRequest();
    if (!req) {
      return null;
    }
    return this.store.validateBookingRequest(req);
  });

  readonly recurringValidation = computed(() => {
    const val = this.formValue();
    const req = this.candidateRequest();
    if (!val.recurring || !req) {
      return null;
    }
    const recReq: RecurringBookingRequest = {
      ...req,
      weeks: Number(val.weeks ?? 2)
    };
    return this.store.validateRecurringRequest(recReq);
  });

  readonly validationErrors = computed(() => {
    if (this.formValue().recurring) {
      return this.recurringValidation()?.errors ?? [];
    }
    return this.singleValidation()?.errors ?? [];
  });

  readonly isDomainValid = computed(() => {
    if (this.formValue().recurring) {
      return this.recurringValidation()?.valid ?? false;
    }
    return this.singleValidation()?.valid ?? false;
  });

  readonly suggestedSlots = computed<readonly ValidatedSuggestedSlot[]>(() => {
    const req = this.candidateRequest();
    if (!req || this.isDomainValid()) {
      return [];
    }
    return this.store.getValidatedSuggestions(req, 3);
  });

  readonly canSubmit = computed(() => {
    const titleLen = (this.formValue().title ?? '').trim().length;
    return titleLen >= 2 && this.isDomainValid() && !this.store.submitting();
  });

  constructor() {
    effect(() => {
      const sel = this.selection();
      const isOpen = this.open();
      if (!isOpen || !sel) {
        return;
      }
      this.form.reset({
        title: '',
        roomId: sel.roomId,
        dateKey: sel.dateKey,
        startTime: sel.startTime,
        endTime: sel.endTime,
        attendees: 4,
        requiredEquipment: [],
        recurring: false,
        weeks: 2
      });
    });

    effect(() => {
      if (!this.open()) {
        return;
      }
      const val = this.formValue();
      const dateKey = val.dateKey;
      if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        return;
      }
      const totalWeeks = val.recurring ? Math.min(4, Math.max(1, Number(val.weeks ?? 2))) : 1;
      for (let weekIndex = 0; weekIndex < totalWeeks; weekIndex++) {
        const occDateKey = weekIndex === 0 ? dateKey : addCairoDays(dateKey, weekIndex * 7);
        this.store.loadDateBookings(occDateKey).subscribe({ error: () => undefined });
      }
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) {
      this.closed.emit();
    }
  }

  isEquipmentSelected(eq: EquipmentType): boolean {
    return this.form.controls.requiredEquipment.value.includes(eq);
  }

  toggleEquipment(eq: EquipmentType): void {
    const current = this.form.controls.requiredEquipment.value;
    const next = current.includes(eq) ? current.filter((item) => item !== eq) : [...current, eq];
    this.form.controls.requiredEquipment.setValue(next);
  }

  applySuggestion(slot: SuggestedSlot): void {
    this.form.patchValue({
      roomId: slot.roomId,
      dateKey: slot.dateKey,
      startTime: slot.startLocal,
      endTime: slot.endLocal
    });
    if (slot.dateKey !== this.store.selectedDateKey()) {
      this.store.selectDate(slot.dateKey);
    }
  }

  onSubmit(): void {
    this.form.markAllAsTouched();
    const req = this.candidateRequest();
    if (!req || !this.canSubmit()) {
      return;
    }

    const isRecurring = this.form.controls.recurring.value;
    if (isRecurring) {
      const recReq: RecurringBookingRequest = {
        ...req,
        weeks: Number(this.form.controls.weeks.value)
      };
      this.store.createRecurringBooking(recReq).subscribe({
        next: () => this.closed.emit(),
        error: () => {
          if (this.store.activeConflict()) {
            this.closed.emit();
          }
        }
      });
      return;
    }

    this.store.createBooking(req).subscribe({
      next: () => this.closed.emit(),
      error: () => {
        if (this.store.activeConflict()) {
          this.closed.emit();
        }
      }
    });
  }
}
