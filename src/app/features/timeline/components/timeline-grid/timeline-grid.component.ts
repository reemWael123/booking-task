import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Booking, Room } from '../../../../core/models';
import { formatTimeHHMM, getWorkingHoursForDateKey } from '../../../../domain';
import { DrawerSlotSelection } from '../../../booking/components/booking-drawer/booking-drawer.component';
import {
  TimelineHourColumn,
  TimelineRoomRowComponent
} from '../timeline-room-row/timeline-room-row.component';

const EMPTY_BOOKINGS: readonly Booking[] = [];

@Component({
  selector: 'app-timeline-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TimelineRoomRowComponent],
  templateUrl: './timeline-grid.component.html',
  styleUrl: './timeline-grid.component.scss'
})
export class TimelineGridComponent {
  readonly rooms = input<readonly Room[]>([]);
  readonly dateKey = input.required<string>();
  readonly bookingsByRoom = input<ReadonlyMap<string, readonly Booking[]>>(new Map());
  readonly currentUserId = input.required<string>();
  readonly loading = input<boolean>(false);

  readonly slotSelected = output<DrawerSlotSelection>();

  readonly workingHours = computed(() => getWorkingHoursForDateKey(this.dateKey()));

  readonly hourColumns = computed<readonly TimelineHourColumn[]>(() => {
    const hours = this.workingHours();
    if (!hours) {
      return [];
    }
    const cols: TimelineHourColumn[] = [];
    for (let m = hours.openMinute; m < hours.closeMinute; m += 60) {
      cols.push({
        startMin: m,
        endMin: Math.min(m + 60, hours.closeMinute),
        label: formatTimeHHMM(Math.floor(m / 60), m % 60)
      });
    }
    return cols;
  });

  readonly emptyBookings = EMPTY_BOOKINGS;
}
