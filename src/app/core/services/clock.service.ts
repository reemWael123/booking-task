import { Injectable } from '@angular/core';

/**
 * Injectable clock abstraction so time-dependent store and API logic
 * can be tested deterministically without relying on global wall-clock time.
 */
@Injectable({ providedIn: 'root' })
export class ClockService {
  now(): Date {
    return new Date();
  }
}
