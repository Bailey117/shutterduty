/**
 * The campaign: seven days at the desk. Between days it carries the teams
 * lost so far, the household and its savings, the shift reports, and how
 * the story ended. Saved to storage after every night (storage is injected:
 * localStorage in the browser, a Map in tests). The endless best score is
 * kept alongside.
 *
 * - A shift that ends with the base overrun pays nothing, and the day must
 *   be worked again; the bills still come in that night.
 * - Fall more than DEBT_LIMIT into debt and the quartermaster evicts you:
 *   the campaign is over.
 */

import { type BillId, type Household, type Night, type Pay, night, shiftPay, startingHousehold } from './economy';
import { STORY_TEAM_ID } from './reference';
import { MAX_DAY } from './rules';
import { type ShiftReport, type ShiftState, report } from './shift';

export const SAVE_KEY = 'shutter-duty.save.v2';
/** Savings below this after a night: evicted, and the campaign ends. */
export const DEBT_LIMIT = -30;

/** What became of the story team on the last day. */
export type StoryEnding = 'home' | 'shut-out' | 'silent';

export interface Campaign {
  version: 2;
  seed: string;
  /** The next day to play (1-7). */
  day: number;
  status: 'active' | 'complete' | 'evicted';
  lost: string[];
  household: Household;
  reports: ShiftReport[];
  story: StoryEnding | null;
  endlessBest: { score: number; seed: string } | null;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function newCampaign(seed: string, endlessBest: Campaign['endlessBest'] = null): Campaign {
  return { version: 2, seed, day: 1, status: 'active', lost: [], household: startingHousehold(), reports: [], story: null, endlessBest };
}

/** Today's pay: nothing if the base was overrun. */
export function payFor(shift: ShiftState): Pay {
  const p = shiftPay(shift.results);
  return shift.status === 'overrun' ? { ...p, wages: 0, total: -p.fines } : p;
}

export interface DayEnd {
  campaign: Campaign;
  pay: Pay;
  night: Night;
}

/** Close a campaign day: pay, the chosen bills, the night, and on to the next day. */
export function endDay(c: Campaign, shift: ShiftState, chosen: readonly BillId[]): DayEnd {
  const pay = payFor(shift);
  const n = night(c.household, pay, chosen, c.day);
  const overrun = shift.status === 'overrun';
  const nextDay = overrun ? c.day : c.day + 1;
  let story = c.story;
  if (!overrun && c.day === MAX_DAY) {
    const r = shift.results.find((x) => x.arrival.story && x.arrival.teamId === STORY_TEAM_ID);
    story = !r ? 'silent' : r.outcome === 'admitted' ? 'home' : 'shut-out';
  }
  const status: Campaign['status'] = n.household.savings < DEBT_LIMIT ? 'evicted' : nextDay > MAX_DAY ? 'complete' : 'active';
  return {
    campaign: { ...c, day: Math.min(nextDay, MAX_DAY), status, lost: shift.lost, household: n.household, reports: [...c.reports, report(shift)].slice(-30), story },
    pay,
    night: n,
  };
}

/** Keep the best endless score. */
export function recordEndless(c: Campaign, shift: ShiftState): Campaign {
  const score = shift.results.filter((r) => r.correct).length;
  const best = c.endlessBest && c.endlessBest.score >= score ? c.endlessBest : { score, seed: shift.config.seed };
  return { ...c, endlessBest: best };
}

/** How it all turned out, a few lines for the last page. */
export function epilogue(c: Campaign): string[] {
  const lines: string[] = [];
  if (c.status === 'evicted') {
    lines.push('The quartermaster came for the key on the morning of the next shift. Someone else has the desk now.');
  } else {
    lines.push('Seven days on the iris. Primary has signed you on for another season.');
  }
  if (c.story === 'home') lines.push('The team that everyone gave up on walked down the ramp on the seventh day, because you opened the iris.');
  else if (c.story === 'shut-out') lines.push('The team that everyone gave up on called home on the seventh day. The iris stayed shut.');
  else if (c.story === 'silent') lines.push('Nobody ever heard from the team that went to KR-9 again.');
  const total = c.reports.reduce((n, r) => n + r.friendliesLost.length, 0);
  lines.push(total === 0 ? 'Every genuine team that called home got home.' : `${total} genuine team${total === 1 ? '' : 's'} called home and found the iris shut.`);
  for (const p of c.household.people) lines.push(p.condition === 'gone' ? `${p.name} did not see the end of the week.` : `${p.name} is ${p.condition === 'well' ? 'well' : p.condition}.`);
  return lines;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A reason the save is unusable, or null. */
export function checkSave(data: unknown): string | null {
  if (!isObj(data)) return 'not an object';
  if (data.version !== 2) return 'from an older version';
  if (typeof data.seed !== 'string') return 'bad seed';
  if (typeof data.day !== 'number' || data.day < 1 || data.day > MAX_DAY) return 'bad day';
  if (!['active', 'complete', 'evicted'].includes(data.status as string)) return 'bad status';
  if (!Array.isArray(data.lost) || !data.lost.every((x) => typeof x === 'string')) return 'bad lost list';
  const h = data.household;
  if (!isObj(h) || typeof h.savings !== 'number' || !Array.isArray(h.people)) return 'bad household';
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
