# Room Booking Hub

Production-quality Angular 19 Standalone application for managing office meeting room reservations in **`Africa/Cairo`** local time. Built with strict TypeScript, pure framework-independent domain rules, an injectable Gateway abstraction, a deterministic local Mock API (60 rooms × 30 days), optimistic UI updates with rollback, live event deduplication/ordering, and SSR/prerendering support.

---

## Quick Start

### Prerequisites
- Node.js 18+ (tested with Angular CLI `19.2.27` and TypeScript `5.7.3`)
- npm 9+
- Chrome / Chromium (for Karma headless unit tests)

### Install & Run
```bash
npm install
npm start          # Dev server at http://localhost:4200
```

### Run Tests & Production SSR Build
```bash
# Single-run headless test suite (68 unit & component tests)
npx ng test --watch=false --browsers=ChromeHeadless

# Production browser + SSR server + static prerender build
npm run build

# Serve the built SSR server locally
npm run serve:ssr:bookingtask
```

---

## Architecture

The codebase enforces strict separation of concerns across five layers and **zero inline templates or styles** (every Angular component uses separate `.component.ts`, `.component.html`, and `.component.scss` files).

```text
src/
  styles.scss                  # Global base styles
  styles/                      # SCSS design tokens & mixins
  app/
    core/
      models/                  # Pure TypeScript domain/API/event interfaces
      services/                # ClockService, UserContextService
      tokens/                  # BOOKING_GATEWAY InjectionToken
    domain/                    # Pure TypeScript — ZERO @angular/* imports
      timezone/                # Africa/Cairo DST-safe Intl resolver & ISO parser
      rules/                   # working-hours, validateBooking, findConflicts,
                               # validateRecurringBooking, suggestSlots, event-ordering
    data-access/
      gateways/                # BookingGateway interface + MockBookingGateway
      mock-api/                # Deterministic 60×30 seeder + MockBookingApiService
      store/                   # Signal-based BookingHubStore (caching, optimistic overlay,
                               # rollback, 10s Undo, sequence gap recovery)
    shared/
      components/              # AppShell, StatusBadge, UndoBanner (10s countdown)
      pipes/                   # Pure CairoTimePipe
    features/
      timeline/                # Lazy-loaded /timeline (filters, grid, room rows)
      booking/                 # BookingDrawer (Reactive Forms, live validation, suggestions)
      conflict-dialog/         # ConflictDialog (409 owner + 3 validated alternatives)
      my-bookings/             # Lazy-loaded /my-bookings (list, cancel, 10s Undo)
```

---

## Implemented Features

### A. Day Timeline (`/timeline`, lazy-loaded)
- Displays all **60 rooms** across 5 floors against Cairo working hours (`08:00–18:00` Sun–Thu, `08:00–13:00` Fri, closed Saturday).
- Date picker with prev/next/today controls and automatic working-hours badge.
- Real-time filtering by **floor**, **minimum capacity**, **required equipment**, and **room search**.
- Visually distinguishes available slots, own bookings, colleague bookings, and in-flight optimistic bookings.
- Live updates apply incrementally without refreshing the entire timeline or flickering.

### B. Booking Drawer
- Opens prefilled when clicking any available timeline slot or `+ New Booking`.
- Built with Angular **Reactive Forms** (`title`, `room`, `date`, `start`, `end`, `attendees`, `equipment`, weekly recurrence toggle `2–4 weeks`).
- **Live domain validation** on every form change, including per-week all-or-nothing occurrence status for recurring requests.
- Displays up to 3 **alternative suggested slots** (validated against the user's 3/day cap) when the selected slot is invalid or unavailable.

### C. My Bookings (`/my-bookings`, lazy-loaded)
- Lists current user's bookings with `Active`, `Cancelled`, and `All` filter tabs plus today's active booking quota (`X / 3 active`).
- One-click cancellation opens a global **10-second Undo countdown banner** that persists across route navigation.
- Clicking **Undo** restores the booking via `restoreBooking`; if another user reserved the slot in the meantime, the optimistic restore rolls back cleanly and opens the Conflict Dialog.

### D. Conflict Dialog (HTTP `409 Conflict`)
- Triggered automatically whenever `createBooking`, `createRecurringBooking`, or `restoreBooking` returns `409 Conflict`.
- Rolls back the optimistic change, displays who booked the conflicting slot, and lists the **next 3 available alternatives** (disabling any alternative that would exceed the user's 3/day limit).

---

## Business Rules (`Africa/Cairo`)

All rules live in pure TypeScript under `src/app/domain/` and receive `now: Date` explicitly:

- **Timezone**: `Africa/Cairo` using `Intl.DateTimeFormat` (never assumes browser timezone, never hardcodes `+02:00`/`+03:00`, parses ISO `Z` and `±HH:MM`, explicitly detects DST spring-forward nonexistent times and fall-back ambiguous times).
- **Working Hours**:
  - Sunday–Thursday: `08:00–18:00`
  - Friday: `08:00–13:00`
  - Saturday: Closed
- **Duration & Boundaries**: Maximum 2 hours (`120` min); no past bookings; no crossing closing time or Cairo midnight.
- **Buffer & Availability**: Minimum **15-minute buffer** between active bookings in the same room; cancelled bookings never block availability or daily limits.
- **Room Fit**: `attendees <= room.capacity` and all `requiredEquipment` must be present in the room.
- **User Quota**: Maximum **3 active bookings per user per Cairo day** (enforced in domain validation, store suggestion confirmation, and Mock API).
- **Weekly Recurrence**: 1–4 weekly occurrences with **all-or-nothing** semantics, preserving Cairo local wall-clock time across DST transitions.

---

## Mock API & Simulation Lab

`MockBookingApiService` seeds **60 rooms × 30 days** deterministically via a fixed-seed mulberry32 PRNG (`src/app/data-access/mock-api/seed-data.ts`).

The Timeline toolbar includes a **Mock API Lab** plus a sidebar **Switch User (Demo)** dropdown to verify resilience flows interactively:
- **Simulate Next 409 Race**: Arms a one-shot server race where the next `createBooking`, `createRecurringBooking`, or `restoreBooking` (Undo) commits a competing booking by `Karim Mansour`, broadcasts its live `BOOKING_CREATED` event, and returns `409 Conflict` with 3 alternatives.
- **Simulate Next 500 Error**: Arms a one-shot server failure to verify exact optimistic rollback and error toast display.
- **Emit Out-of-Order Live Burst**: Emits sequence `N+2`, duplicate `N+2`, then `N+1` to demonstrate deduplication and ordered draining.
- **Switch User (Demo)**: Switches between `Nadia Hassan` and `Omar Tarek` to manually test multi-user slot conflicts during the 10-second Undo window.

---

## Performance Considerations (60 Rooms × 30 Days × Live Events)

1. **Date-Partitioned Fetching & Caching**: `BookingHubStore` fetches only the selected Cairo date via `getBookingsByDate(dateKey)`, caches loaded dates (`loadedDateKeys`), and shares in-flight requests (`inFlightDateLoads`) — avoiding loading or scanning 30 days of data when rendering a single day.
2. **Indexed Signal Projections**: `mergedBookingsById` → `bookingsByDateKey` → `selectedDateBookingsByRoom` indexes active day bookings by room once per mutation.
3. **Scoped `OnPush` Rendering**: Every component uses `ChangeDetectionStrategy.OnPush`, `@for (...; track ...)`, and a shared `EMPTY_BOOKINGS` reference so a live event for one room updates only that room's row.
4. **Low DOM Footprint Without Premature Virtualization**: Each room row uses an hourly slot grid (10 buttons on weekdays, 5 on Friday) with percentage-positioned booking overlay bars (~750 lightweight DOM nodes for all 60 rooms) while displaying exact 15/30/45/60/90/120-minute durations.
5. **Lazy-Loaded Feature Chunks**: `/timeline` and `/my-bookings` load on demand, keeping the initial browser bundle at `356 kB` (`101 kB` transfer), well under the `500 kB` budget.

---

## Known Limitations

1. **`suggestSlots` signature scope**: To preserve the exact required 5-argument domain signature `suggestSlots(req, rooms, existing, now, limit)`, `suggestSlots` checks room availability, capacity, equipment, working hours, and buffers, while user daily-limit (`3/day`) filtering is applied at the store layer (`validateSuggestedSlot` / `confirmSuggestedSlot`).
2. **Unbounded `processedEventIds` in memory**: `EventStreamState.processedEventIds` retains processed event IDs for the duration of a browser session. A long-running kiosk session would benefit from pruning IDs older than a sliding sequence window.
3. **Runtime ICU tzdata dependency**: `Africa/Cairo` DST accuracy depends on the browser/Node ICU timezone database if Egyptian DST legislation changes in future years.
4. **Demo-only controls**: The sidebar **Switch User (Demo)** dropdown and **Mock API Lab** controls exist for local verification and should be removed or gated behind a dev flag before production deployment.
5. **No persistence across page reload**: Because the Mock API runs in memory, refreshing the browser resets data back to the deterministic seed.

---

## Migrating to a Real Backend & WebSocket/SSE Stream

Because the UI and `BookingHubStore` depend solely on the `BOOKING_GATEWAY` token (`BookingGateway` interface):

1. Create `HttpBookingGateway implements BookingGateway` using Angular `HttpClient` for REST endpoints (`GET /rooms`, `GET /bookings?date=YYYY-MM-DD`, `GET /users/:id/bookings`, `POST /bookings`, `POST /bookings/recurring`, `POST /bookings/:id/cancel`, `POST /bookings/:id/restore`).
2. Expose `liveEvents$: Observable<BookingLiveEvent>` from a WebSocket or `EventSource` (SSE) stream with reconnect backoff, emitting `{ eventId, sequence, type, booking, emittedAtIso }`.
3. Map backend `409 Conflict` HTTP error bodies into `ApiError(409, 'CONFLICT', message, conflictPayload)`.
4. Swap a single provider line in [app.config.ts](file:///c:/Users/reem.w/Desktop/booking%20task/bookingtask/src/app/app.config.ts):
   ```ts
   { provide: BOOKING_GATEWAY, useExisting: HttpBookingGateway }
   ```
   Zero changes are required in `domain/`, `BookingHubStore`, or any UI component.
