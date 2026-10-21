/**
 * Campaign progress and the endless high score, saved to storage between
 * shifts (storage is injected: localStorage in the browser, a Map in tests).
 *
 * A shift that ends with the base overrun must be replayed; any other shift
 * moves the campaign to the next day. Teams lost along the way stay lost.
 */

import { MAX_DAY } from './rules';
import type { ShiftReport, ShiftState } from './shift';
import { report } from './shift';

export const SAVE_KEY = 'shutter-duty.save.v1';

export interface Campaign {
  version: 1;
  seed: string;
  /** The next day to play; MAX_DAY + 1 when the campaign is finished. */
  day: number;
  lost: string[];
  reports: ShiftReport[];
  endlessBest: { score: number; seed: string } | null;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function newCampaign(seed: string, endlessBest: Campaign['endlessBest'] = null): Campaign {
  return { version: 1, seed, day: 1, lost: [], reports: [], endlessBest };
}

export function isFinished(c: Campaign): boolean {
  return c.day > MAX_DAY;
}

/** Record a finished shift and move the campaign on. */
export function recordShift(c: Campaign, shift: ShiftState): Campaign {
  const r = report(shift);
  if (shift.config.mode === 'endless') {
    const best = c.endlessBest && c.endlessBest.score >= r.correct ? c.endlessBest : { score: r.correct, seed: shift.config.seed };
    return { ...c, endlessBest: best, reports: [...c.reports, r].slice(-30) };
  }
  return {
    ...c,
    day: r.overrun ? c.day : c.day + 1,
    lost: shift.lost,
    reports: [...c.reports, r].slice(-30),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A reason the save is unusable, or null. */
export function checkSave(data: unknown): string | null {
  if (!isObj(data)) return 'not an object';
  if (data.version !== 1) return 'unknown version';
  if (typeof data.seed !== 'string') return 'bad seed';
  if (typeof data.day !== 'number' || data.day < 1 || data.day > MAX_DAY + 1) return 'bad day';
  if (!Array.isArray(data.lost) || !data.lost.every((x) => typeof x === 'string')) return 'bad lost list';
  if (!Array.isArray(data.reports)) return 'bad reports';
  if (data.endlessBest !== null && !(isObj(data.endlessBest) && typeof data.endlessBest.score === 'number')) return 'bad high score';
  return null;
}

export function save(storage: KeyValueStorage, c: Campaign): boolean {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(c));
    return true;
  } catch {
    return false;
  }
}

export type LoadResult = { kind: 'none' } | { kind: 'ok'; campaign: Campaign } | { kind: 'corrupt'; reason: string };

export function load(storage: KeyValueStorage): LoadResult {
  let text: string | null;
  try {
    text = storage.getItem(SAVE_KEY);
  } catch {
    return { kind: 'none' };
  }
  if (text === null) return { kind: 'none' };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { kind: 'corrupt', reason: 'not valid JSON' };
  }
  const problem = checkSave(data);
  return problem ? { kind: 'corrupt', reason: problem } : { kind: 'ok', campaign: data as Campaign };
}
