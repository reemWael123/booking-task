import { Pipe, PipeTransform } from '@angular/core';
import { formatTimeHHMM, getCairoParts, parseIsoTimestamp } from '../../domain';

export type CairoTimeFormat = 'time' | 'date' | 'datetime';

@Pipe({
  name: 'cairoTime',
  standalone: true,
  pure: true
})
export class CairoTimePipe implements PipeTransform {
  transform(iso: string | null | undefined, format: CairoTimeFormat = 'time'): string {
    if (!iso) {
      return '';
    }
    const parsed = parseIsoTimestamp(iso);
    if (!parsed) {
      return iso;
    }
    const parts = getCairoParts(parsed);
    const time = formatTimeHHMM(parts.hour, parts.minute);

    switch (format) {
      case 'date':
        return parts.dateKey;
      case 'datetime':
        return `${parts.dateKey} · ${time}`;
      case 'time':
      default:
        return time;
    }
  }
}
