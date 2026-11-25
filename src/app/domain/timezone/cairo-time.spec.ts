import {
  addCairoDays,
  formatCairoOffsetIso,
  getCairoParts,
  parseIsoTimestamp,
  resolveCairoDateKeyTime,
  resolveCairoLocalDateTime
} from './cairo-time';

describe('Cairo Timezone Utilities (Africa/Cairo)', () => {
  describe('parseIsoTimestamp', () => {
    it('parses UTC Z, +02:00, +03:00, and fractional second timestamps to exact instants', () => {
      const utc = parseIsoTimestamp('2026-11-25T08:00:00Z');
      const winterCairo = parseIsoTimestamp('2026-11-25T10:00:00+02:00');
      const withMillis = parseIsoTimestamp('2026-11-25T10:00:00.000+02:00');
      const summerCairo = parseIsoTimestamp('2026-07-15T10:00:00+03:00');
      const summerUtc = parseIsoTimestamp('2026-07-15T07:00:00Z');

      expect(utc).not.toBeNull();
      expect(winterCairo).not.toBeNull();
      expect(withMillis).not.toBeNull();
      expect(utc!.getTime()).toBe(winterCairo!.getTime());
      expect(utc!.getTime()).toBe(withMillis!.getTime());
      expect(summerCairo!.getTime()).toBe(summerUtc!.getTime());
    });

    it('rejects offset-less timestamps, invalid calendar dates, and invalid offsets', () => {
      expect(parseIsoTimestamp('2026-11-25T10:00:00')).toBeNull();
      expect(parseIsoTimestamp('2026-02-30T10:00:00Z')).toBeNull();
      expect(parseIsoTimestamp('2026-11-25T24:00:00Z')).toBeNull();
      expect(parseIsoTimestamp('2026-11-25T10:60:00Z')).toBeNull();
      expect(parseIsoTimestamp('2026-11-25T10:00:00+25:00')).toBeNull();
      expect(parseIsoTimestamp('not-a-date')).toBeNull();
    });
  });

  describe('getCairoParts', () => {
    it('computes winter (+02:00) and summer DST (+03:00) offsets dynamically without hardcoding', () => {
      const winter = getCairoParts(new Date('2026-11-25T08:00:00Z'));
      expect(winter.dateKey).toBe('2026-11-25');
      expect(winter.hour).toBe(10);
      expect(winter.minute).toBe(0);
      expect(winter.offsetMinutes).toBe(120);
      expect(winter.dayOfWeek).toBe(3); // Wednesday

      const summer = getCairoParts(new Date('2026-07-15T08:00:00Z'));
      expect(summer.dateKey).toBe('2026-07-15');
      expect(summer.hour).toBe(11);
      expect(summer.minute).toBe(0);
      expect(summer.offsetMinutes).toBe(180);
      expect(summer.dayOfWeek).toBe(3); // Wednesday
    });

    it('handles Cairo date rollover when UTC is still on the previous day', () => {
      const instant = new Date('2026-11-25T22:30:00Z');
      const parts = getCairoParts(instant);
      expect(parts.dateKey).toBe('2026-11-26');
      expect(parts.hour).toBe(0);
      expect(parts.minute).toBe(30);
      expect(parts.dayOfWeek).toBe(4); // Thursday
    });
  });

  describe('Cairo DST edge cases (nonexistent & ambiguous local times)', () => {
    it('detects nonexistent local times during Egypt spring-forward gap (2026-04-24 00:00–00:59)', () => {
      // Last Friday of April 2026: clocks jump from 2026-04-23 23:59 (+02:00) to 2026-04-24 01:00 (+03:00)
      const beforeGap = resolveCairoLocalDateTime(2026, 4, 23, 23, 59);
      expect(beforeGap.status).toBe('exact');
      expect(beforeGap.date?.toISOString()).toBe('2026-04-23T21:59:00.000Z');

      const gapStart = resolveCairoLocalDateTime(2026, 4, 24, 0, 0);
      expect(gapStart.status).toBe('nonexistent');
      expect(gapStart.date).toBeNull();

      const gapMid = resolveCairoLocalDateTime(2026, 4, 24, 0, 30);
      expect(gapMid.status).toBe('nonexistent');
      expect(gapMid.date).toBeNull();

      const gapEnd = resolveCairoLocalDateTime(2026, 4, 24, 0, 59);
      expect(gapEnd.status).toBe('nonexistent');
      expect(gapEnd.date).toBeNull();

      const afterGap = resolveCairoLocalDateTime(2026, 4, 24, 1, 0);
      expect(afterGap.status).toBe('exact');
      expect(afterGap.date?.toISOString()).toBe('2026-04-23T22:00:00.000Z');
    });

    it('detects ambiguous local times during Egypt fall-back overlap (2026-10-29 23:00–23:59)', () => {
      // Last Thursday of October 2026: 23:00–23:59 occurs twice (+03:00 then +02:00)
      const earlierRes = resolveCairoLocalDateTime(2026, 10, 29, 23, 30, 'earlier');
      expect(earlierRes.status).toBe('ambiguous');
      if (earlierRes.status === 'ambiguous') {
        expect(earlierRes.earlier.toISOString()).toBe('2026-10-29T20:30:00.000Z');
        expect(earlierRes.later.toISOString()).toBe('2026-10-29T21:30:00.000Z');
        expect(earlierRes.date?.toISOString()).toBe('2026-10-29T20:30:00.000Z');
      }

      const laterRes = resolveCairoLocalDateTime(2026, 10, 29, 23, 30, 'later');
      expect(laterRes.status).toBe('ambiguous');
      expect(laterRes.date?.toISOString()).toBe('2026-10-29T21:30:00.000Z');

      const rejectRes = resolveCairoLocalDateTime(2026, 10, 29, 23, 30, 'reject');
      expect(rejectRes.status).toBe('ambiguous');
      expect(rejectRes.date).toBeNull();

      // Boundary: 22:59 is exact (+03:00) and 00:00 on Oct 30 is exact (+02:00)
      const beforeOverlap = resolveCairoDateKeyTime('2026-10-29', 22, 59);
      expect(beforeOverlap.status).toBe('exact');
      expect(beforeOverlap.date?.toISOString()).toBe('2026-10-29T19:59:00.000Z');

      const afterOverlap = resolveCairoDateKeyTime('2026-10-30', 0, 0);
      expect(afterOverlap.status).toBe('exact');
      expect(afterOverlap.date?.toISOString()).toBe('2026-10-29T22:00:00.000Z');
    });

    it('formats Cairo ISO strings with the active seasonal offset', () => {
      expect(formatCairoOffsetIso(new Date('2026-04-23T08:00:00Z'))).toBe('2026-04-23T10:00:00+02:00');
      expect(formatCairoOffsetIso(new Date('2026-04-24T07:00:00Z'))).toBe('2026-04-24T10:00:00+03:00');
    });

    it('adds Cairo calendar days cleanly across month and DST boundaries', () => {
      expect(addCairoDays('2026-04-23', 1)).toBe('2026-04-24');
      expect(addCairoDays('2026-04-23', 7)).toBe('2026-04-30');
      expect(addCairoDays('2026-10-29', 3)).toBe('2026-11-01');
    });
  });
});
