import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  PLATFORM_ID,
  signal
} from '@angular/core';
import { UndoCancelAction } from '../../../core/models';
import { ClockService } from '../../../core/services/clock.service';

@Component({
  selector: 'app-undo-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './undo-banner.component.html',
  styleUrl: './undo-banner.component.scss'
})
export class UndoBannerComponent {
  private readonly clock = inject(ClockService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  readonly undoAction = input<UndoCancelAction | null>(null);
  readonly errorMessage = input<string | null>(null);

  readonly undoRequested = output<void>();
  readonly dismissUndo = output<void>();
  readonly dismissError = output<void>();

  readonly remainingSeconds = signal<number>(0);

  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      const action = this.undoAction();
      this.stopTimer();

      if (!action) {
        this.remainingSeconds.set(0);
        return;
      }

      this.updateRemaining(action.expiresAtMs);

      if (isPlatformBrowser(this.platformId)) {
        this.intervalId = setInterval(() => {
          this.updateRemaining(action.expiresAtMs);
        }, 250);
      }
    });

    this.destroyRef.onDestroy(() => this.stopTimer());
  }

  private updateRemaining(expiresAtMs: number): void {
    const diffMs = Math.max(0, expiresAtMs - this.clock.now().getTime());
    this.remainingSeconds.set(Math.ceil(diffMs / 1000));
    if (diffMs === 0) {
      this.stopTimer();
    }
  }

  private stopTimer(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
