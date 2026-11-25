import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { BookingHubStore } from './data-access/store/booking-hub.store';
import { AppShellComponent } from './shared/components/app-shell/app-shell.component';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppShellComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  private readonly store = inject(BookingHubStore);
  readonly title = 'Room Booking Hub';

  ngOnInit(): void {
    this.store.initialize();
  }
}
