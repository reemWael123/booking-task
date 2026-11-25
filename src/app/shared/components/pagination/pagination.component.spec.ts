import { TestBed } from '@angular/core/testing';
import { PaginationComponent } from './pagination.component';

describe('PaginationComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PaginationComponent]
    }).compileComponents();
  });

  it('displays range text, page numbers, and enforces first/last page button boundaries', () => {
    const fixture = TestBed.createComponent(PaginationComponent);
    fixture.componentRef.setInput('currentPage', 1);
    fixture.componentRef.setInput('pageSize', 10);
    fixture.componentRef.setInput('totalItems', 60);
    fixture.componentRef.setInput('itemLabel', 'rooms');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Showing 1–10 of 60 rooms');

    const navBtns = Array.from(el.querySelectorAll('.page-btn--nav')) as HTMLButtonElement[];
    expect(navBtns[0].disabled).toBeTrue(); // Previous disabled on page 1
    expect(navBtns[1].disabled).toBeFalse(); // Next enabled

    const emitted: number[] = [];
    fixture.componentInstance.pageChange.subscribe((p) => emitted.push(p));

    // Clicking Next emits page 2
    navBtns[1].click();
    expect(emitted).toEqual([2]);

    // Last partial page boundary (24 items -> page 3 shows 21–24)
    fixture.componentRef.setInput('totalItems', 24);
    fixture.componentRef.setInput('currentPage', 3);
    fixture.componentRef.setInput('itemLabel', 'bookings');
    fixture.detectChanges();

    expect(el.textContent).toContain('Showing 21–24 of 24 bookings');
    expect(navBtns[0].disabled).toBeFalse(); // Previous enabled
    expect(navBtns[1].disabled).toBeTrue(); // Next disabled on last page
  });

  it('handles empty results and out-of-range page numbers cleanly', () => {
    const fixture = TestBed.createComponent(PaginationComponent);
    fixture.componentRef.setInput('currentPage', 5);
    fixture.componentRef.setInput('pageSize', 10);
    fixture.componentRef.setInput('totalItems', 0);
    fixture.componentRef.setInput('itemLabel', 'rooms');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Showing 0 of 0 rooms');
    const navBtns = Array.from(el.querySelectorAll('.page-btn--nav')) as HTMLButtonElement[];
    expect(navBtns[0].disabled).toBeTrue();
    expect(navBtns[1].disabled).toBeTrue();
    expect(el.querySelectorAll('.pagination__numbers .page-btn').length).toBe(0);
  });

  it('renders ellipsis tokens when total pages exceed 7', () => {
    const fixture = TestBed.createComponent(PaginationComponent);
    fixture.componentRef.setInput('currentPage', 5);
    fixture.componentRef.setInput('pageSize', 10);
    fixture.componentRef.setInput('totalItems', 100);
    fixture.componentRef.setInput('itemLabel', 'bookings');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Showing 41–50 of 100 bookings');
    expect(el.querySelectorAll('.page-ellipsis').length).toBe(2);
  });
});
