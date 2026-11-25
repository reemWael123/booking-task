import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SuggestedSlot } from '../../../core/models';
import { BookingHubStore } from '../../../data-access/store/booking-hub.store';
import { ConflictDialogComponent } from '../../../features/conflict-dialog/components/conflict-dialog/conflict-dialog.component';
import { StatusBadgeComponent } from '../status-badge/status-badge.component';
import { UndoBannerComponent } from '../undo-banner/undo-banner.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    StatusBadgeComponent,
    UndoBannerComponent,
    ConflictDialogComponent
  ],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss'
})
export class AppShellComponent {
  readonly store = inject(BookingHubStore);
  readonly sidebarOpen = signal<boolean>(false);

  toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  onUndoRequested(): void {
    this.store.undoLastCancellation().subscribe({ error: () => undefined });
  }

  onSelectConflictAlternative(slot: SuggestedSlot): void {
    const conflict = this.store.activeConflict();
    if (!conflict) {
      return;
    }
    this.store.confirmSuggestedSlot(slot, conflict.request).subscribe({ error: () => undefined });
  }

  onManualResync(): void {
    this.store.resyncActiveDate().subscribe({ error: () => undefined });
  }
}
