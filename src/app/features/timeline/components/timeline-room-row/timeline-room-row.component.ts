import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Booking, Room } from '../../../../core/models';
import { formatTimeHHMM, getCairoParts, parseIsoTimestamp } from '../../../../domain';
import { DrawerSlotSelection } from '../../../booking/components/booking-drawer/booking-drawer.component';

export interface TimelineHourColumn {
  readonly startMin: number;
  readonly endMin: number;
  readonly label: string;
}

interface PositionedBookingBlock {
  readonly id: string;
  readonly title: string;
  readonly userName: string;
  readonly timeRange: string;
  readonly leftPercent: number;
  readonly widthPercent: number;
  readonly isOwn: boolean;
  readonly optimistic: boolean;
}

@Component({
  selector: 'app-timeline-room-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './timeline-room-row.component.html',
  styleUrl: './timeline-room-row.component.scss'
})
export class TimelineRoomRowComponent {
  readonly room = input.required<Room>();
  readonly dateKey = input.required<string>();
  readonly bookings = input<readonly Booking[]>([]);
  readonly currentUserId = input.required<string>();
  readonly openMinute = input<number>(480);
  readonly closeMinute = input<number>(1080);
  readonly hourColumns = input<readonly TimelineHourColumn[]>([]);

  readonly slotSelected = output<DrawerSlotSelection>();

  readonly bookingBlocks = computed<readonly PositionedBookingBlock[]>(() => {
    const open = this.openMinute();
    const close = this.closeMinute();
    const totalMinutes = close - open;
    if (totalMinutes <= 0) {
      return [];
    }

    const blocks: PositionedBookingBlock[] = [];
    for (const booking of this.bookings()) {
      if (booking.status === 'cancelled') {
        continue;
      }
      const start = parseIsoTimestamp(booking.startIso);
      const end = parseIsoTimestamp(booking.endIso);
      if (!start || !end) {
        continue;
      }

      const startCairo = getCairoParts(start);
      const endCairo = getCairoParts(end);
      const startMin = startCairo.hour * 60 + startCairo.minute;
      const endMin = endCairo.hour * 60 + endCairo.minute;

      const clampedStart = Math.max(open, startMin);
      const clampedEnd = Math.min(close, endMin);
      if (clampedEnd <= clampedStart) {
        continue;
      }

      blocks.push({
        id: booking.id,
        title: booking.title,
        userName: booking.userName,
        timeRange: `${formatTimeHHMM(startCairo.hour, startCairo.minute)}–${formatTimeHHMM(endCairo.hour, endCairo.minute)}`,
        leftPercent: ((clampedStart - open) / totalMinutes) * 100,
        widthPercent: ((clampedEnd - clampedStart) / totalMinutes) * 100,
        isOwn: booking.userId === this.currentUserId(),
        optimistic: booking.optimistic === true
      });
    }

    return blocks;
  });

  onSlotClick(col: TimelineHourColumn): void {
    const room = this.room();
    const startH = Math.floor(col.startMin / 60);
    const startM = col.startMin % 60;
    const endMin = Math.min(col.endMin, this.closeMinute());
    const endH = Math.floor(endMin / 60);
    const endM = endMin % 60;

    this.slotSelected.emit({
      roomId: room.id,
      dateKey: this.dateKey(),
      startTime: formatTimeHHMM(startH, startM),
      endTime: formatTimeHHMM(endH, endM)
    });
  }
}
