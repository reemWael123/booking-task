import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

export type PaginationToken =
  | { readonly kind: 'page'; readonly page: number; readonly key: string }
  | { readonly kind: 'ellipsis'; readonly key: string };

@Component({
  selector: 'app-pagination',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pagination.component.html',
  styleUrl: './pagination.component.scss'
})
export class PaginationComponent {
  readonly currentPage = input.required<number>();
  readonly pageSize = input<number>(10);
  readonly totalItems = input.required<number>();
  readonly itemLabel = input<string>('items');

  readonly pageChange = output<number>();

  readonly totalPages = computed(() => {
    const size = Math.max(1, this.pageSize());
    return Math.max(1, Math.ceil(this.totalItems() / size));
  });

  readonly safePage = computed(() => {
    return Math.min(Math.max(1, this.currentPage()), this.totalPages());
  });

  readonly rangeText = computed(() => {
    const total = this.totalItems();
    const label = this.itemLabel();
    if (total === 0) {
      return `Showing 0 of 0 ${label}`;
    }
    const size = Math.max(1, this.pageSize());
    const start = (this.safePage() - 1) * size + 1;
    const end = Math.min(this.safePage() * size, total);
    return `Showing ${start}–${end} of ${total} ${label}`;
  });

  readonly canGoPrevious = computed(() => this.totalItems() > 0 && this.safePage() > 1);
  readonly canGoNext = computed(() => this.totalItems() > 0 && this.safePage() < this.totalPages());

  readonly pageTokens = computed<readonly PaginationToken[]>(() => {
    if (this.totalItems() === 0) {
      return [];
    }

    const total = this.totalPages();
    const current = this.safePage();

    if (total <= 7) {
      const all: PaginationToken[] = [];
      for (let p = 1; p <= total; p++) {
        all.push({ kind: 'page', page: p, key: `p-${p}` });
      }
      return all;
    }

    const tokens: PaginationToken[] = [{ kind: 'page', page: 1, key: 'p-1' }];
    const windowStart = Math.max(2, current - 1);
    const windowEnd = Math.min(total - 1, current + 1);

    if (windowStart > 2) {
      tokens.push({ kind: 'ellipsis', key: 'ellipsis-left' });
    }
    for (let p = windowStart; p <= windowEnd; p++) {
      tokens.push({ kind: 'page', page: p, key: `p-${p}` });
    }
    if (windowEnd < total - 1) {
      tokens.push({ kind: 'ellipsis', key: 'ellipsis-right' });
    }
    tokens.push({ kind: 'page', page: total, key: `p-${total}` });
    return tokens;
  });

  goToPage(page: number): void {
    const clamped = Math.min(Math.max(1, page), this.totalPages());
    if (clamped !== this.safePage()) {
      this.pageChange.emit(clamped);
    }
  }

  previous(): void {
    if (this.canGoPrevious()) {
      this.goToPage(this.safePage() - 1);
    }
  }

  next(): void {
    if (this.canGoNext()) {
      this.goToPage(this.safePage() + 1);
    }
  }
}
