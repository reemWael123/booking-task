import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Booking } from '../../../../core/models';
import { ClockService } from '../../../../core/services/clock.service';
import { BookingHubStore } from '../../../../data-access/store/booking-hub.store';
import { getCairoParts, MAX_DAILY_BOOKINGS_PER_USER, parseIsoTimestamp } from '../../../../domain';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';
import { PaginationComponent } from '../../../../shared/components/pagination/pagination.component';
import { CairoTimePipe } from '../../../../shared/pipes/cairo-time.pipe';

export type MyBookingsFilter = 'active' | 'cancelled' | 'all';

interface BookingListItem {
  readonly booking: Booking;
  readonly roomName: string;
  readonly floorLabel: string;
}

@Component({
  selector: 'app-my-bookings-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusBadgeComponent, PaginationComponent, CairoTimePipe],
  templateUrl: './my-bookings-page.component.html',
  styleUrl: './my-bookings-page.component.scss'
})
export class MyBookingsPageComponent {
  readonly store = inject(BookingHubStore);
  private readonly clock = inject(ClockService);

  readonly maxDailyBookings = MAX_DAILY_BOOKINGS_PER_USER;
  readonly pageSize = 10;
  readonly activeFilter = signal<MyBookingsFilter>('active');
  readonly currentPage = signal<number>(1);

  readonly todayDateKey = getCairoParts(this.clock.now()).dateKey;

  readonly todayActiveCount = computed(() => {
    let count = 0;
    for (const booking of this.store.currentUserBookings()) {
      if (booking.status === 'cancelled') {
        continue;
      }
      const start = parseIsoTimestamp(booking.startIso);
      if (start && getCairoParts(start).dateKey === this.todayDateKey) {
        count++;
      }
    }
    return count;
  });

  readonly filteredItems = computed<readonly BookingListItem[]>(() => {
    const filter = this.activeFilter();
    const roomsById = this.store.roomsById();
    const items: BookingListItem[] = [];

    for (const booking of this.store.currentUserBookings()) {
      if (filter === 'active' && booking.status === 'cancelled') {
        continue;
      }
      if (filter === 'cancelled' && booking.status !== 'cancelled') {
        continue;
      }
      const room = roomsById.get(booking.roomId);
      items.push({
        booking,
        roomName: room ? room.name : booking.roomId,
        floorLabel: room ? `Floor ${room.floor}` : ''
      });
    }
    return items;
  });

  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredItems().length / this.pageSize))
  );

  readonly effectivePage = computed(() => Math.min(this.currentPage(), this.totalPages()));

  readonly paginatedItems = computed<readonly BookingListItem[]>(() => {
    const start = (this.effectivePage() - 1) * this.pageSize;
    return this.filteredItems().slice(start, start + this.pageSize);
  });

  setFilter(filter: MyBookingsFilter): void {
    this.activeFilter.set(filter);
    this.currentPage.set(1);
  }

  onPageChanged(page: number): void {
    const clamped = Math.min(Math.max(1, page), this.totalPages());
    this.currentPage.set(clamped);
  }

  onCancelBooking(bookingId: string): void {
    this.store.cancelBooking(bookingId).subscribe({ error: () => undefined });
  }
}
