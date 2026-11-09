import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export type VerificationFlag = boolean | null;
export type CardSide = 'front' | 'back';
export type SortOrder = 'year-asc' | 'year-desc' | 'player-asc' | 'number-asc';

export interface CatalogCard {
  key: string;
  year: number;
  setName: string;
  setCode: string;
  cardNumber: string | null;
  catalogNumber: string | null;
  playerName: string | null;
  cardTitle: string | null;
  cardType: string;
  team: string | null;
  variationLabel: string | null;
  variationFamily: string | null;
  variationAttributes: Record<string, unknown>;
  variationCount: number;
  isRookie: VerificationFlag;
  isHallOfFame: VerificationFlag;
  owns: boolean;
  images: {
    frontUrl: string | null;
    backUrl: string | null;
    frontVerified: boolean;
    backVerified: boolean;
    frontSourcePage: string | null;
    backSourcePage: string | null;
  };
  sourcePage: string | null;
  identityStatus: string;
  variationStatus: string;
  references: string[];
}

export interface CatalogFilters {
  search: string;
  year: number | null;
  team: string;
  setCode: string;
  rookieOnly: boolean;
  hallOnly: boolean;
  imagesOnly: boolean;
  ownership: 'owned' | 'not-owned' | 'either';
  sort: SortOrder;
  page: number;
  pageSize: number;
}

export interface CatalogResponse {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  items: CatalogCard[];
}

export interface SetOption {
  year: number;
  code: string;
  name: string;
}

export interface CatalogMeta {
  years: number[];
  teams: string[];
  sets: SetOption[];
  counts: { total: number; identified: number; withFrontScan: number; rookieVerified: number; hallVerified: number };
  mode: 'demo' | 'arangodb' | 'cardsight';
  generatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class CatalogApi {
  private readonly http = inject(HttpClient);

  getMetadata(): Observable<CatalogMeta> {
    return this.http.get<CatalogMeta>('/api/meta');
  }

  getCards(filters: CatalogFilters): Observable<CatalogResponse> {
    let params = new HttpParams()
      .set('page', filters.page)
      .set('pageSize', filters.pageSize)
      .set('sort', filters.sort);
    if (filters.search) params = params.set('search', filters.search);
    if (filters.year !== null) params = params.set('year', filters.year);
    if (filters.team) params = params.set('team', filters.team);
    if (filters.setCode) params = params.set('set', filters.setCode);
    if (filters.rookieOnly) params = params.set('rookie', 'true');
    if (filters.hallOnly) params = params.set('hof', 'true');
    if (filters.imagesOnly) params = params.set('images', 'true');
    if (filters.ownership !== 'either') params = params.set('ownership', filters.ownership);
    return this.http.get<CatalogResponse>('/api/cards', { params });
  }

  updateOwnership(key: string, owns: boolean): Observable<{ key: string; owns: boolean }> {
    return this.http.patch<{ key: string; owns: boolean }>(`/api/cards/${encodeURIComponent(key)}/ownership`, { owns });
  }
}
