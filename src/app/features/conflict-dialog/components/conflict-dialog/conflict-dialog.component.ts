import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';
import { ActiveConflictState, SuggestedSlot } from '../../../../core/models';
import { CairoTimePipe } from '../../../../shared/pipes/cairo-time.pipe';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';

@Component({
  selector: 'app-conflict-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CairoTimePipe, StatusBadgeComponent],
  templateUrl: './conflict-dialog.component.html',
  styleUrl: './conflict-dialog.component.scss'
})
export class ConflictDialogComponent {
  readonly conflict = input<ActiveConflictState | null>(null);
  readonly submitting = input<boolean>(false);

  readonly selectAlternative = output<SuggestedSlot>();
  readonly closeDialog = output<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.conflict()) {
      this.closeDialog.emit();
    }
  }
}
