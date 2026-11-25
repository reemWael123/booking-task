import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ClockService } from '../../../../core/services/clock.service';
import { MockBookingApiService } from '../../../../data-access/mock-api/mock-booking-api.service';
import { BookingHubStore } from '../../../../data-access/store/booking-hub.store';
import { getCairoParts } from '../../../../domain';
import {
  BookingDrawerComponent,
  DrawerSlotSelection
} from '../../../booking/components/booking-drawer/booking-drawer.component';
import {
  TimelineFiltersComponent,
  TimelineFilterState
} from '../../components/timeline-filters/timeline-filters.component';
import { TimelineGridComponent } from '../../components/timeline-grid/timeline-grid.component';

@Component({
  selector: 'app-timeline-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TimelineFiltersComponent, TimelineGridComponent, BookingDrawerComponent],
  templateUrl: './timeline-page.component.html',
  styleUrl: './timeline-page.component.scss'
})
export class TimelinePageComponent {
  readonly store = inject(BookingHubStore);
  private readonly clock = inject(ClockService);
  private readonly mockApi = inject(MockBookingApiService);

  readonly todayDateKey = getCairoParts(this.clock.now()).dateKey;

  readonly filterState = signal<TimelineFilterState>({
    floor: null,
    minCapacity: 1,
    equipment: [],
    searchQuery: ''
  });

  readonly drawerOpen = signal<boolean>(false);
  readonly drawerSelection = signal<DrawerSlotSelection | null>(null);
  readonly conflictRaceArmed = computed(() => this.mockApi.simulationConfig().forceNextConflict);
  readonly serverErrorArmed = computed(() => this.mockApi.simulationConfig().forceNextServerError);

  readonly floors = computed<readonly number[]>(() => {
    const unique = new Set<number>();
    for (const room of this.store.rooms()) {
      unique.add(room.floor);
    }
    return Array.from(unique).sort((a, b) => a - b);
  });

  readonly filteredRooms = computed(() => {
    const f = this.filterState();
    const query = f.searchQuery.trim().toLowerCase();

    return this.store.rooms().filter((room) => {
      if (f.floor !== null && room.floor !== f.floor) {
        return false;
      }
      if (room.capacity < f.minCapacity) {
        return false;
      }
      if (f.equipment.length > 0 && !f.equipment.every((eq) => room.equipment.includes(eq))) {
        return false;
      }
      if (query && !room.name.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
  });

  onDateChanged(dateKey: string): void {
    this.store.selectDate(dateKey);
  }

  onFilterChanged(next: TimelineFilterState): void {
    this.filterState.set(next);
  }

  onSlotSelected(selection: DrawerSlotSelection): void {
    this.drawerSelection.set(selection);
    this.drawerOpen.set(true);
  }

  onNewBookingClicked(): void {
    const firstRoom = this.filteredRooms()[0] ?? this.store.rooms()[0];
    if (!firstRoom) {
      return;
    }
    this.drawerSelection.set({
      roomId: firstRoom.id,
      dateKey: this.store.selectedDateKey(),
      startTime: '09:00',
      endTime: '10:00'
    });
    this.drawerOpen.set(true);
  }

  onDrawerClosed(): void {
    this.drawerOpen.set(false);
  }

  onToggleConflictRace(): void {
    this.mockApi.configureSimulation({ forceNextConflict: !this.conflictRaceArmed() });
  }

  onToggleServerError(): void {
    this.mockApi.configureSimulation({ forceNextServerError: !this.serverErrorArmed() });
  }

  onSimulateLiveBurst(): void {
    this.mockApi.simulateLiveEventBurst(this.store.selectedDateKey());
  }
}
