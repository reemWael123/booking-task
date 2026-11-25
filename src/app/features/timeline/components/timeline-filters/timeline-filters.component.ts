import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { EquipmentType } from '../../../../core/models';
import { addCairoDays, getWorkingHoursForDateKey } from '../../../../domain';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';
import { ALL_EQUIPMENT_OPTIONS } from '../../../booking/components/booking-drawer/booking-drawer.component';

export interface TimelineFilterState {
  readonly floor: number | null;
  readonly minCapacity: number;
  readonly equipment: readonly EquipmentType[];
  readonly searchQuery: string;
}

@Component({
  selector: 'app-timeline-filters',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusBadgeComponent],
  templateUrl: './timeline-filters.component.html',
  styleUrl: './timeline-filters.component.scss'
})
export class TimelineFiltersComponent {
  readonly dateKey = input.required<string>();
  readonly todayDateKey = input.required<string>();
  readonly floors = input<readonly number[]>([]);
  readonly filterState = input.required<TimelineFilterState>();
  readonly matchingRoomsCount = input<number>(0);
  readonly totalRoomsCount = input<number>(0);
  readonly conflictRaceArmed = input<boolean>(false);
  readonly serverErrorArmed = input<boolean>(false);

  readonly dateChanged = output<string>();
  readonly filterChanged = output<TimelineFilterState>();
  readonly newBookingClicked = output<void>();
  readonly toggleConflictRace = output<void>();
  readonly toggleServerError = output<void>();
  readonly simulateLiveBurst = output<void>();

  readonly equipmentOptions = ALL_EQUIPMENT_OPTIONS;

  readonly workingHoursLabel = computed(() => {
    const hours = getWorkingHoursForDateKey(this.dateKey());
    if (!hours) {
      return { text: 'Saturday · Closed', tone: 'danger' as const };
    }
    if (hours.closeMinute === 13 * 60) {
      return { text: 'Friday · 08:00–13:00', tone: 'warning' as const };
    }
    return { text: 'Open · 08:00–18:00', tone: 'success' as const };
  });

  readonly hasActiveFilters = computed(() => {
    const f = this.filterState();
    return (
      f.floor !== null ||
      f.minCapacity > 1 ||
      f.equipment.length > 0 ||
      f.searchQuery.trim().length > 0
    );
  });

  stepDay(delta: number): void {
    this.dateChanged.emit(addCairoDays(this.dateKey(), delta));
  }

  onDateInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value) {
      this.dateChanged.emit(value);
    }
  }

  onFloorChange(event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    this.filterChanged.emit({
      ...this.filterState(),
      floor: raw === '' ? null : Number(raw)
    });
  }

  onCapacityChange(event: Event): void {
    const raw = Number((event.target as HTMLSelectElement).value);
    this.filterChanged.emit({
      ...this.filterState(),
      minCapacity: Number.isNaN(raw) ? 1 : raw
    });
  }

  onSearchInput(event: Event): void {
    const searchQuery = (event.target as HTMLInputElement).value;
    this.filterChanged.emit({
      ...this.filterState(),
      searchQuery
    });
  }

  toggleEquipment(eq: EquipmentType): void {
    const current = this.filterState().equipment;
    const next = current.includes(eq) ? current.filter((item) => item !== eq) : [...current, eq];
    this.filterChanged.emit({
      ...this.filterState(),
      equipment: next
    });
  }

  resetFilters(): void {
    this.filterChanged.emit({
      floor: null,
      minCapacity: 1,
      equipment: [],
      searchQuery: ''
    });
  }
}
