# AI Usage & Correction Log

This document records concrete instances during development where an initial AI-generated proposal or implementation was incomplete, overengineered, or subtlely incorrect, and how it was identified and corrected.

---

## Example 1: Hardcoded Cairo Offset (`+02:00`) in Mock API Live Event Simulation

### Initial Suggestion
When implementing `MockBookingApiService.simulateLiveEventBurst(dateKey)` to generate a demo live-event burst, the initial code constructed booking timestamps by string interpolation with a hardcoded Cairo winter offset:

```ts
startIso: `${dateKey}T14:00:00+02:00`,
endIso: `${dateKey}T14:45:00+02:00`,
```

### Why It Was Incorrect
This violated the timezone requirement (*never hardcode Cairo's UTC offset*). On any date during Egypt's summer Daylight Saving Time (`+03:00`, late April through late October), `14:00:00+02:00` actually resolves to `15:00` Cairo local time instead of `14:00`, causing the simulated booking block to appear shifted by one hour on the timeline.

### How It Was Corrected
Replaced string interpolation with the pure domain Cairo wall-clock resolver:

```ts
const startRes = resolveCairoDateKeyTime(dateKey, 14, 0, 'earlier');
const endRes = resolveCairoDateKeyTime(dateKey, 14, 45, 'earlier');
startIso: formatCairoOffsetIso(startRes.date),
endIso: formatCairoOffsetIso(endRes.date),
```

This dynamically outputs `+02:00` in winter and `+03:00` during summer DST.

---

## Example 2: Overengineered Custom Virtual Scrolling Proposal for 60 Rooms

### Initial Suggestion
In the initial Phase 2 architecture proposal, the plan called for building a custom fixed-row-height virtual scrolling container inside `TimelineGridComponent` to manage visible row slicing for 60 rooms.

### Why It Was Overengineered
For 60 rooms, a custom virtual scroll implementation introduces non-trivial complexity around sticky column/time headers, horizontal scrolling synchronization, keyboard focus retention, and SSR hydration — without first proving a real rendering bottleneck.

### How It Was Corrected
Following review, removed custom virtual scrolling and designed `TimelineRoomRowComponent` with:
- `ChangeDetectionStrategy.OnPush` + `@for (...; track ...)`
- A shared constant `EMPTY_BOOKINGS` input fallback (preventing fresh `[]` allocations from triggering unnecessary child checks)
- A lightweight 10-column hourly grid with percentage-positioned overlay bars for active bookings (~750 lightweight DOM nodes across all 60 rooms).

This keeps rendering fast and simple while leaving a clean extension point to adopt `@angular/cdk/scrolling` only if room counts grow an order of magnitude larger.

---

## Example 3: Incomplete UI & Store Test Coverage for Flow 5 (Undo 409 Race) and Gap Recovery

### Initial Suggestion
In Phase 5–8:
1. `BookingHubStore.undoLastCancellation()` and `MockBookingApiService.restoreBooking()` both supported `409 Conflict` when another user took a cancelled slot during the 10-second Undo window, **but** the initial `booking-hub.store.spec.ts` only tested the happy-path Undo and expiry (relying on `mock-booking-api.service.spec.ts` for the `409` restore check), and the UI's `Simulate Next 409 Race` toggle only triggered on `createBooking`, not `restoreBooking`.
2. The initial store sequence-gap test verified that `getBookingsByDate` was triggered after the 5-second timeout, but did not return a higher-sequence snapshot to verify end-to-end gap clearing, stale booking removal, and draining of newer buffered events inside the store.

### How It Was Corrected
1. Added two dedicated end-to-end store tests in [booking-hub.store.spec.ts](file:///c:/Users/reem.w/Desktop/booking%20task/bookingtask/src/app/data-access/store/booking-hub.store.spec.ts):
   - **Undo Conflict Rollback Test**: creates → cancels → another user books the slot → `undoLastCancellation()` optimistically restores, receives `409`, rolls back to `'cancelled'`, populates `activeConflict()` with the competing booking + 3 alternatives, and leaves zero duplicates.
   - **End-to-End Sequence Gap Recovery Test**: emits out-of-order events (`+3`, `+4` with `+2` missing), advances fake clock 5 seconds, returns an authoritative snapshot at `+3`, and asserts the gap clears, stale bookings are removed, and buffered `+4` drains cleanly.
2. Wired `forceNextConflict` into `MockBookingApiService.restoreBooking` and added a compact **Switch User (Demo)** dropdown in `AppShellComponent` with dedicated component tests in [app-shell.component.spec.ts](file:///c:/Users/reem.w/Desktop/booking%20task/bookingtask/src/app/shared/components/app-shell/app-shell.component.spec.ts).

---

## Example 4: Component Style Budget Exceeded on `BookingDrawerComponent`

### Initial Suggestion
The initial `booking-drawer.component.scss` compiled to `4.13 kB`, exceeding Angular's `4.00 kB` `anyComponentStyle` production warning budget by 126 bytes.

### How It Was Corrected
Consolidated shared banner and button rules in [booking-drawer.component.scss](file:///c:/Users/reem.w/Desktop/booking%20task/bookingtask/src/app/features/booking/components/booking-drawer/booking-drawer.component.scss) without losing visual styling, bringing the production SSR build down to **0 warnings**.
