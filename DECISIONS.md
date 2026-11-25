# Architecture & Technical Decisions

This document records the core technical decisions made while building the Room Booking Hub, the alternatives considered, and why each approach was chosen.

---

## Decision 1: Pure TypeScript Domain Layer with Explicit `now: Date` Injection

### Decision
Place all business rules, timezone math, slot suggestion logic, recurring validation, and live-event ordering inside `src/app/domain/` as pure TypeScript functions with **zero `@angular/*` imports**, accepting `now: Date` as an explicit parameter instead of calling `new Date()`.

### Alternatives Considered
1. **Angular injectable validation services** reading `Date.now()` internally.
2. **Reactive Form custom validators** embedding business rules directly inside form controls.

### Rationale
- Framework-independent domain functions are trivial to unit-test deterministically across DST boundaries, past/present boundaries (`now - 1ms` vs `now`), Friday half-days, and Saturday closures without mocking globals or setting up `TestBed`.
- Both `BookingHubStore` (client-side live validation) and `MockBookingApiService` (server-side authoritative validation) reuse the exact same functions (`validateBooking`, `validateRecurringBooking`, `findConflicts`, `suggestSlots`), guaranteeing zero rule drift.

---

## Decision 2: DST-Safe `Africa/Cairo` Time Resolution Using Native `Intl.DateTimeFormat`

### Decision
Implement `src/app/domain/timezone/cairo-time.ts` using native `Intl.DateTimeFormat` (`timeZone: 'Africa/Cairo'`) with a 12-hour-window offset probe for wall-clock-to-UTC resolution, explicitly returning discriminated union states: `'exact'`, `'nonexistent'` (spring-forward gap), and `'ambiguous'` (fall-back overlap with `'earlier' | 'later' | 'reject'` disambiguation).

### Alternatives Considered
1. **Hardcoding `+02:00` / `+03:00` offsets** or assuming browser local time is Cairo.
2. **Adding third-party date libraries** (`luxon`, `date-fns-tz`, `dayjs` + timezone plugin).

### Rationale
- Hardcoded offsets fail during Egypt's DST transitions (last Friday of April spring-forward gap `00:00–00:59`, last Thursday of October fall-back overlap `23:00–23:59`) and break whenever a user's browser runs in another timezone.
- Native `Intl.DateTimeFormat` adds **0 kB** to the bundle, is SSR-safe, works identically in Node and Chrome, and lets us explicitly surface nonexistent and ambiguous Cairo wall-clock times rather than silently shifting them.
- Weekly recurring bookings advance calendar days in Cairo wall-clock time (`addCairoDays` + `resolveCairoDateKeyTime`) so a `10:00–11:00` meeting stays `10:00–11:00` Cairo time across both April and October DST shifts.

---

## Decision 3: Separated Optimistic Overlay + Sequenced Event Reducer

### Decision
Separate confirmed server state (`EventStreamState` managed by pure `ingestLiveEvent` / `reconcileFromSnapshot`) from in-flight optimistic mutations (`pendingCreatesSignal` and `pendingStatusOverridesSignal`), combining them only in the derived `mergedBookingsById` Signal.

### Alternatives Considered
1. **Mutating the confirmed bookings map directly** during optimistic create/cancel and saving full snapshots for rollback.
2. **Blindly applying incoming live events** to a single flat Signal array.

### Rationale
- Mutating confirmed state directly causes subtle race bugs when a live event arrives while an HTTP request is still in flight:
  - A `BOOKING_CREATED` live event arriving before the HTTP response resolves would create a duplicate entry.
  - A concurrent `BOOKING_UPDATED` live event arriving during an optimistic cancel would overwrite the optimistic cancellation, causing UI flicker.
  - Rolling back from a saved pre-request snapshot would clobber unrelated live updates that arrived during the request.
- Keeping optimistic overlays separate eliminates all three classes of bugs:
  - `mergedBookingsById` deduplicates `pendingCreates` against confirmed fingerprints `(roomId|userId|startIso|endIso)`.
  - `pendingStatusOverrides` shields in-flight cancels/restores from being overwritten by concurrent live events.
  - Rollback deletes only the failed `tempId` or status override, preserving every concurrent live update untouched.
- For missing sequence numbers, `ingestLiveEvent` buffers out-of-order future events, exposes `getSequenceGap`, and triggers authoritative snapshot recovery (`reconcileFromSnapshot`) after a 5-second timeout or buffer overflow (`>= 50` events), draining any buffered events newer than `snapshotSequence`.

---

## Decision 4: Swappable `BookingGateway` DI Abstraction & Date-Partitioned Store Caching

### Decision
Introduce `BookingGateway` behind an Angular `InjectionToken` (`BOOKING_GATEWAY`) and partition client fetches by Cairo date (`getBookingsByDate(dateKey)` returning `{ dateKey, bookings, sequence }`), caching loaded dates and sharing in-flight observables via `shareReplay(1)`.

### Alternatives Considered
1. **Injecting `MockBookingApiService` directly** into components and the store.
2. **Fetching all 30 days of bookings upfront** into a single client array.

### Rationale
- Depending on `BOOKING_GATEWAY` decouples UI and state management from the mock implementation; migrating to a real REST + WebSocket backend requires replacing only one provider registration in `app.config.ts`.
- Fetching and indexing per Cairo date prevents loading ~3,500+ bookings across 30 days on startup and avoids duplicate HTTP calls when switching back and forth between dates.

---

## Decision 5: Performance Strategy for 60 Rooms × 30 Days Without Custom Virtual Scrolling

### Decision
Render all 60 room rows using `ChangeDetectionStrategy.OnPush`, `@for (...; track ...)`, a shared constant `EMPTY_BOOKINGS` reference, and a lightweight 2-layer timeline row (10 hourly slot buttons + percentage-positioned overlay bars for active bookings only), deferring custom virtual scrolling unless profiling proves it necessary.

### Alternatives Considered
1. **Custom virtual scrolling container** synchronizing sticky time headers, horizontal scrolling, and dynamic row heights.
2. **Installing `@angular/cdk/scrolling`** (`cdk-virtual-scroll-viewport`).
3. **15-minute cell matrix** (40 buttons × 60 rooms = 2,400+ interactive cells).

### Rationale
- A 15-minute cell matrix creates excessive DOM nodes (2,400+ buttons) and complicates spanning multi-slot bookings cleanly.
- Custom virtual scrolling adds scroll-jank risk with sticky headers, keyboard navigation quirks, and SSR hydration complexity for a fixed 60-room list.
- Using 10 hourly slot cells + percentage-positioned booking bars keeps the entire 60-room timeline around ~750 lightweight DOM nodes, renders exact 15/30/45/60/90/120-minute bookings accurately, keeps the initial bundle small (`356 kB`), and ensures a live event for one room triggers change detection on only that single `OnPush` row. If room counts scaled to 500+, `@angular/cdk/scrolling` can be dropped into `TimelineGridComponent` without changing any child row or store code.

---

## Decision 6: Immediate Cancel + Server-Validated `restoreBooking` for 10-Second Undo

### Decision
Execute `cancelBooking` immediately (optimistically + server call), open a 10-second Undo banner, and implement Undo via an optimistic `restoreBooking` call that re-validates full availability and daily limits on the server.

### Alternatives Considered
1. **Delayed client-side commit** (holding the cancellation locally for 10 seconds before calling `cancelBooking`).

### Rationale
- Delayed commits lose cancellations if the user closes the tab within 10 seconds and keep the room artificially locked to other users during the Undo window.
- Immediate cancellation frees the room right away, tests true optimistic cancel rollback on 500 errors, and handles the realistic race condition where another user books the freed slot before Undo is clicked (returning `409 Conflict`, rolling back the optimistic restore, and opening the Conflict Dialog with 3 alternatives).
