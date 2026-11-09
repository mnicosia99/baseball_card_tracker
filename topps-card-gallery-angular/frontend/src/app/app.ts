import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { Subject, catchError, debounceTime, of, switchMap } from 'rxjs';
import { takeUntilDestroyed as untilDestroyed } from '@angular/core/rxjs-interop';
import { CatalogApi, CatalogCard, CatalogFilters, CatalogMeta, CatalogResponse, CardSide, SortOrder } from './catalog-api';

const INITIAL_FILTERS: CatalogFilters = {
  search: '', year: null, team: '', setCode: '', rookieOnly: false, hallOnly: false,
  imagesOnly: false, ownership: 'either', sort: 'year-asc', page: 1, pageSize: 24
};

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  private readonly api = inject(CatalogApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reload$ = new Subject<void>();
  private readonly searchInput$ = new Subject<string>();

  readonly meta = signal<CatalogMeta | null>(null);
  readonly results = signal<CatalogResponse | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly filters = signal<CatalogFilters>({ ...INITIAL_FILTERS });
  readonly searchDraft = signal('');
  readonly filtersOpen = signal(false);
  readonly activeCard = signal<CatalogCard | null>(null);
  readonly activeSide = signal<CardSide>('front');
  readonly failedImages = signal<Record<string, boolean>>({});
  readonly savingOwnership = signal<Record<string, boolean>>({});

  readonly filteredSets = computed(() => {
    const year = this.filters().year;
    return (this.meta()?.sets ?? []).filter(set => year === null || set.year === year);
  });
  readonly shownFrom = computed(() => {
    const response = this.results();
    return response?.total ? (response.page - 1) * response.pageSize + 1 : 0;
  });
  readonly shownTo = computed(() => {
    const response = this.results();
    return response ? Math.min(response.page * response.pageSize, response.total) : 0;
  });
  readonly activeFilterCount = computed(() => {
    const f = this.filters();
    return [!!f.search, f.year !== null, !!f.team, !!f.setCode, f.rookieOnly, f.hallOnly, f.imagesOnly, f.ownership !== 'either'].filter(Boolean).length;
  });

  constructor() {
    this.reload$.pipe(
      switchMap(() => {
        this.loading.set(true);
        this.error.set('');
        return this.api.getCards(this.filters()).pipe(
          catchError(() => {
            this.error.set('Unable to load cards. Check that the API server is running.');
            return of<CatalogResponse>({ items: [], total: 0, page: 1, pageSize: 24, pageCount: 0 });
          })
        );
      }),
      untilDestroyed()
    ).subscribe(result => {
      this.results.set(result);
      this.loading.set(false);
    });

    this.searchInput$.pipe(debounceTime(280), untilDestroyed()).subscribe(search => {
      this.updateFilters({ search: search.trim() });
    });

    this.api.getMetadata().pipe(untilDestroyed()).subscribe({
      next: meta => this.meta.set(meta),
      error: () => this.error.set('Unable to reach the catalog API server.')
    });

    this.reload$.next();
  }

  inputSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchDraft.set(value);
    this.searchInput$.next(value);
  }

  inputYear(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.updateFilters({ year: value ? Number(value) : null, setCode: '' });
  }

  inputTeam(event: Event): void {
    this.updateFilters({ team: (event.target as HTMLSelectElement).value });
  }

  inputSet(event: Event): void {
    this.updateFilters({ setCode: (event.target as HTMLSelectElement).value });
  }

  inputSort(event: Event): void {
    this.updateFilters({ sort: (event.target as HTMLSelectElement).value as SortOrder });
  }

  inputPageSize(event: Event): void {
    this.updateFilters({ pageSize: Number((event.target as HTMLSelectElement).value) });
  }

  inputOwnership(event: Event): void {
    this.updateFilters({ ownership: (event.target as HTMLSelectElement).value as CatalogFilters['ownership'] });
  }

  setCardOwnership(card: CatalogCard, event: Event): void {
    const owns = (event.target as HTMLInputElement).checked;
    this.savingOwnership.update(current => ({ ...current, [card.key]: true }));
    this.api.updateOwnership(card.key, owns).pipe(untilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.patchCardOwnership(card.key, owns);
        this.savingOwnership.update(current => ({ ...current, [card.key]: false }));
        this.reload$.next();
      },
      error: () => {
        this.error.set('Unable to save card ownership. Check that the catalog file is writable.');
        this.savingOwnership.update(current => ({ ...current, [card.key]: false }));
      }
    });
  }

  toggleFlag(flag: 'rookieOnly' | 'hallOnly' | 'imagesOnly', event: Event): void {
    this.updateFilters({ [flag]: (event.target as HTMLInputElement).checked });
  }

  setYear(year: number | null): void {
    this.updateFilters({ year, setCode: '' });
  }

  clearFilters(): void {
    this.filters.set({ ...INITIAL_FILTERS });
    this.searchDraft.set('');
    this.reload$.next();
  }

  goToPage(page: number): void {
    const count = this.results()?.pageCount ?? 0;
    if (page < 1 || page > count) return;
    this.filters.update(current => ({ ...current, page }));
    this.reload$.next();
    window.scrollTo({ top: 250, behavior: 'smooth' });
  }

  openCard(card: CatalogCard): void {
    this.activeCard.set(card);
    this.activeSide.set('front');
  }

  closeCard(): void {
    this.activeCard.set(null);
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closeCard();
  }

  setSide(side: CardSide): void {
    this.activeSide.set(side);
  }

  markImageFailed(key: string, side: CardSide): void {
    this.failedImages.update(current => ({ ...current, [`${key}:${side}`]: true }));
  }

  pictureAvailable(card: CatalogCard, side: CardSide): boolean {
    const url = side === 'front' ? card.images.frontUrl : card.images.backUrl;
    return !!url && !this.failedImages()[`${card.key}:${side}`];
  }

  imageUrl(card: CatalogCard, side: CardSide): string {
    return (side === 'front' ? card.images.frontUrl : card.images.backUrl) ?? '';
  }

  isImageVerified(card: CatalogCard, side: CardSide): boolean {
    return side === 'front' ? card.images.frontVerified : card.images.backVerified;
  }

  label(card: CatalogCard): string {
    return card.playerName || card.cardTitle || `Unidentified card #${card.cardNumber ?? '?'}`;
  }

  formatNumber(value: number | undefined): string {
    return (value ?? 0).toLocaleString('en-US');
  }

  @HostListener('document:keydown.escape')
  closeOnEscape(): void {
    if (this.activeCard()) this.closeCard();
  }

  private updateFilters(partial: Partial<CatalogFilters>): void {
    this.filters.update(current => ({ ...current, ...partial, page: 1 }));
    this.reload$.next();
  }

  private patchCardOwnership(key: string, owns: boolean): void {
    this.results.update(response => response ? {
      ...response,
      items: response.items.map(card => card.key === key ? { ...card, owns } : card)
    } : response);
    this.activeCard.update(card => card?.key === key ? { ...card, owns } : card);
  }
}
