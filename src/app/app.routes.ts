import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'timeline'
  },
  {
    path: 'timeline',
    loadChildren: () =>
      import('./features/timeline/timeline.routes').then((m) => m.TIMELINE_ROUTES)
  },
  {
    path: 'my-bookings',
    loadChildren: () =>
      import('./features/my-bookings/my-bookings.routes').then((m) => m.MY_BOOKINGS_ROUTES)
  },
  {
    path: '**',
    redirectTo: 'timeline'
  }
];
