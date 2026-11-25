import { Booking, EquipmentType, Room } from '../../core/models';
import { DEFAULT_CURRENT_USER } from '../../core/services/user-context.service';
import {
  addCairoDays,
  formatCairoOffsetIso,
  getWorkingHoursForDateKey,
  resolveCairoDateKeyTime
} from '../../domain';

const ROOM_NAME_PREFIXES = [
  'Nile',
  'Zamalek',
  'Maadi',
  'Heliopolis',
  'Alexandria',
  'Luxor',
  'Aswan',
  'Giza',
  'Karnak',
  'Delta',
  'Sinai',
  'Fayoum'
] as const;

const ROOM_NAME_SUFFIXES = [
  'Boardroom',
  'Studio',
  'Huddle',
  'Suite',
  'Lab'
] as const;

const CAPACITIES = [4, 6, 8, 10, 12, 16, 20, 24] as const;

const EQUIPMENT_PRESETS: readonly (readonly EquipmentType[])[] = [
  ['whiteboard'],
  ['whiteboard', 'tv-screen'],
  ['whiteboard', 'projector', 'conference-phone'],
  ['whiteboard', 'tv-screen', 'video-conferencing'],
  ['projector', 'whiteboard', 'video-conferencing', 'conference-phone'],
  ['projector', 'whiteboard', 'video-conferencing', 'tv-screen', 'accessibility']
];

const COLLEAGUES = [
  { id: 'user-omar', name: 'Omar Tarek' },
  { id: 'user-salma', name: 'Salma El-Sayed' },
  { id: 'user-karim', name: 'Karim Mansour' },
  { id: 'user-yasmine', name: 'Yasmine Adel' },
  { id: 'user-hany', name: 'Hany Mostafa' },
  { id: 'user-dina', name: 'Dina Farouk' },
  { id: 'user-tarek', name: 'Tarek Nabil' },
  { id: 'user-mariam', name: 'Mariam Sherif' }
] as const;

const MEETING_TITLES = [
  'Sprint Planning',
  'Architecture Review',
  'Design Critique',
  'Client Discovery',
  'Security Sync',
  'Quarterly Roadmap',
  'API Contract Review',
  'Incident Retro',
  'Data Pipeline Standup',
  'Hiring Debrief',
  'Product Demo',
  'Engineering All-Hands'
] as const;

/**
 * Deterministic mulberry32 PRNG so seeded rooms and bookings are identical across runs.
 */
function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSeededRooms(count = 60, seed = 20261125): readonly Room[] {
  const rng = createSeededRng(seed);
  const rooms: Room[] = [];
  const roomsPerFloor = 12;

  for (let i = 0; i < count; i++) {
    const floor = Math.floor(i / roomsPerFloor) + 1;
    const roomNum = floor * 100 + ((i % roomsPerFloor) + 1);
    const prefix = ROOM_NAME_PREFIXES[i % ROOM_NAME_PREFIXES.length];
    const suffix = ROOM_NAME_SUFFIXES[(floor - 1) % ROOM_NAME_SUFFIXES.length];
    const capacity = CAPACITIES[Math.floor(rng() * CAPACITIES.length)];
    const equipment = EQUIPMENT_PRESETS[Math.floor(rng() * EQUIPMENT_PRESETS.length)];

    rooms.push({
      id: `room-${roomNum}`,
      name: `${roomNum} ${prefix} ${suffix}`,
      floor,
      capacity,
      equipment: [...equipment]
    });
  }

  return rooms;
}

export interface SeedDataset {
  readonly rooms: readonly Room[];
  readonly bookings: readonly Booking[];
}

/**
 * Generates deterministic seeded dataset (default: 60 rooms × 30 Cairo days).
 * Every seeded booking obeys Cairo working hours, Saturday closure, Friday half-day,
 * room capacity/equipment, and the 15-minute buffer rule.
 */
export function generateSeedDataset(
  anchorDateKey: string,
  roomCount = 60,
  dayCount = 30,
  seed = 20261125
): SeedDataset {
  const rooms = generateSeededRooms(roomCount, seed);
  const rng = createSeededRng(seed + 7919);
  const bookings: Booking[] = [];
  let seq = 1;

  // Non-overlapping slot templates with >= 15-minute buffers between them
  const weekdaySlots: readonly (readonly [number, number, number, number])[] = [
    [8, 30, 9, 30],
    [10, 0, 11, 0],
    [11, 30, 12, 30],
    [13, 0, 14, 30],
    [15, 0, 16, 0],
    [16, 30, 17, 30]
  ];
  const fridaySlots: readonly (readonly [number, number, number, number])[] = [
    [8, 30, 9, 30],
    [10, 0, 11, 0],
    [11, 30, 12, 30]
  ];

  // Track active user bookings per day to stay within the 3/day cap
  const userDailyCount = new Map<string, number>();

  for (let dayOffset = 0; dayOffset < dayCount; dayOffset++) {
    const dateKey = addCairoDays(anchorDateKey, dayOffset);
    const hours = getWorkingHoursForDateKey(dateKey);
    if (!hours) {
      continue; // Saturday is closed
    }

    const isFriday = hours.closeMinute === 13 * 60;
    const templates = isFriday ? fridaySlots : weekdaySlots;

    // Seed 1 confirmed booking for the default current user on anchor day & next open day
    if ((dayOffset === 0 || dayOffset === 1) && rooms.length > 0) {
      const targetRoom = rooms[dayOffset % rooms.length];
      const slot = templates[1]; // 10:00–11:00
      const startRes = resolveCairoDateKeyTime(dateKey, slot[0], slot[1], 'earlier');
      const endRes = resolveCairoDateKeyTime(dateKey, slot[2], slot[3], 'earlier');
      if (startRes.date && endRes.date) {
        const userDayKey = `${DEFAULT_CURRENT_USER.id}|${dateKey}`;
        userDailyCount.set(userDayKey, (userDailyCount.get(userDayKey) ?? 0) + 1);
        bookings.push({
          id: `bk-seed-${seq++}`,
          roomId: targetRoom.id,
          title: dayOffset === 0 ? 'Platform Architecture Sync' : 'Frontend Performance Review',
          userId: DEFAULT_CURRENT_USER.id,
          userName: DEFAULT_CURRENT_USER.name,
          startIso: formatCairoOffsetIso(startRes.date),
          endIso: formatCairoOffsetIso(endRes.date),
          attendees: Math.min(4, targetRoom.capacity),
          requiredEquipment: targetRoom.equipment.slice(0, 1),
          status: 'confirmed'
        });
      }
    }

    for (let rIdx = 0; rIdx < rooms.length; rIdx++) {
      const room = rooms[rIdx];
      for (let sIdx = 0; sIdx < templates.length; sIdx++) {
        // Avoid colliding with the current user's deterministic anchor-day bookings
        if ((dayOffset === 0 || dayOffset === 1) && rIdx === dayOffset % rooms.length && sIdx === 1) {
          continue;
        }

        // Roughly ~38% occupancy across rooms & slots -> ~3,000+ realistic bookings over 30 days
        if (rng() > 0.38) {
          continue;
        }

        const colleague = COLLEAGUES[Math.floor(rng() * COLLEAGUES.length)];
        const userDayKey = `${colleague.id}|${dateKey}`;
        const existingCount = userDailyCount.get(userDayKey) ?? 0;
        if (existingCount >= 3) {
          continue;
        }

        const [sh, sm, eh, em] = templates[sIdx];
        const startRes = resolveCairoDateKeyTime(dateKey, sh, sm, 'earlier');
        const endRes = resolveCairoDateKeyTime(dateKey, eh, em, 'earlier');
        if (!startRes.date || !endRes.date) {
          continue;
        }

        const isCancelled = rng() < 0.08;
        if (!isCancelled) {
          userDailyCount.set(userDayKey, existingCount + 1);
        }

        const title = MEETING_TITLES[Math.floor(rng() * MEETING_TITLES.length)];
        const attendees = Math.max(2, Math.min(room.capacity, 2 + Math.floor(rng() * room.capacity)));

        bookings.push({
          id: `bk-seed-${seq++}`,
          roomId: room.id,
          title,
          userId: colleague.id,
          userName: colleague.name,
          startIso: formatCairoOffsetIso(startRes.date),
          endIso: formatCairoOffsetIso(endRes.date),
          attendees,
          requiredEquipment: room.equipment.slice(0, 1),
          status: isCancelled ? 'cancelled' : 'confirmed'
        });
      }
    }
  }

  return { rooms, bookings };
}
