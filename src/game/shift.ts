/**
 * A shift: arrivals one at a time, each judged by the rules in force, with
 * consequences. Pure state in, state out; the UI owns the clock and calls
 * `decide` (or `decide(.., 'timeout')` when the countdown runs out).
 *
 * - Admitting a hostile damages the base. The third ends the shift.
 * - Refusing a friendly loses that team: it is off the roster for the rest
 *   of the campaign.
 */

import { brokenRules, nextArrival, safeAuth } from './arrivals';
import { SHIFT_START } from './data';
import { STORY_TEAM_ID, buildReference } from './reference';
import { judge } from './rules';
import { Rng, deriveSeed } from './rng';
import type { Arrival, Reference, RuleId } from './types';

/**
 * 'campaign' and 'endless' run a fixed or open-ended number of arrivals on a
 * per-arrival countdown. 'desk' is the slower desk day: no countdown, a
 * shift clock from 08:00 to 18:00 that the screen advances in real time, and
 * arrivals keep coming until the shift ends.
 */
export type Mode = 'campaign' | 'endless' | 'desk';
export type Decision = 'open' | 'close' | 'timeout';

export interface ShiftConfig {
  mode: Mode;
  seed: string;
  /** Campaign day 1-7 (endless runs on day 7 rules). */
  day: number;
  /** Teams lost before this shift. */
  lost: string[];
}

export interface CallResult {
  arrival: Arrival;
  decision: Decision;
  correct: boolean;
  /** What happened, in a few words. */
  outcome: 'admitted' | 'refused' | 'hostile-admitted' | 'friendly-lost';
  /** The rule that made it hostile, and why (null when genuine). */
  rule: RuleId | null;
  reason: string | null;
  /** Seconds allowed for this call. */
  limit: number;
}

export interface ShiftState {
  config: ShiftConfig;
  ref: Reference;
  /** Arrivals in this shift (endless: unlimited). */
  total: number | null;
  current: Arrival | null;
  results: CallResult[];
  hostilesAdmitted: number;
  /** Teams lost so far, including this shift's. */
  lost: string[];
  status: 'running' | 'complete' | 'overrun';
  rngState: number;
  /** Minutes after midnight on the base clock. */
  clock: number;
}

export const HOSTILE_LIMIT = 3;

/** End of a desk shift, in minutes after midnight (18:00). */
export const SHIFT_END = 18 * 60;

/** The desk day: a day-3 sheet (roster, expiry dates) plus the voice checks. */
export const DESK_SHEET_DAY = 3;
export const DESK_RULES: RuleId[] = ['unlisted', 'expired', 'not-offworld', 'wrong-leader', 'wrong-headcount', 'wrong-origin'];

/** Arrivals per campaign shift: 4 on day 1 up to 10 on day 7. */
export function shiftLength(day: number): number {
  return Math.min(10, 3 + day);
}

/** Seconds to decide: 10 on day 1, half a second less each day. Endless speeds up as it goes. */
export function timeLimit(state: Pick<ShiftState, 'config' | 'results'>): number {
  if (state.config.mode === 'desk') return 0;
  if (state.config.mode === 'campaign') return 10 - 0.5 * (state.config.day - 1);
  return Math.max(4, 9 - 0.25 * Math.floor(state.results.length / 3));
}

const clockText = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function startShift(config: ShiftConfig): ShiftState {
  const day = config.mode === 'endless' ? 7 : config.mode === 'desk' ? DESK_SHEET_DAY : config.day;
  const sheetSeed = config.mode === 'endless' ? `endless:${config.seed}` : config.mode === 'desk' ? `desk:${config.seed}` : config.seed;
  const ref = buildReference(sheetSeed, day, { lost: config.lost, story: config.mode === 'campaign', ...(config.mode === 'desk' ? { rules: DESK_RULES } : {}) });
  const state: ShiftState = {
    config: { ...config, day },
    ref,
    total: config.mode === 'campaign' ? shiftLength(day) : null,
    current: null,
    results: [],
    hostilesAdmitted: 0,
    lost: [...config.lost],
    status: 'running',
    rngState: new Rng(deriveSeed(sheetSeed, `shift-${day}`)).getState(),
    clock: SHIFT_START,
  };
  // The desk brings its first arrival in when the screen is ready (callNext).
  return config.mode === 'desk' ? state : advance(state);
}

/** Desk mode: bring in the next arrival at the current clock, or end the shift. */
export function callNext(state: ShiftState): ShiftState {
  return state.current ? state : advance(state);
}

/** The reference as it stands now (teams lost this shift are struck off). */
function liveRef(state: ShiftState): Reference {
  const lost = new Set(state.lost);
  return { ...state.ref, roster: state.ref.roster.filter((t) => !lost.has(t.id)), codes: state.ref.codes.filter((c) => !lost.has(c.teamId)) };
}

/** Bring in the next arrival, or end the shift. */
function advance(state: ShiftState): ShiftState {
  if (state.status !== 'running') return state;
  if (state.hostilesAdmitted >= HOSTILE_LIMIT) return { ...state, current: null, status: 'overrun' };
  if (state.total !== null && state.results.length >= state.total) return { ...state, current: null, status: 'complete' };
  if (state.config.mode === 'desk' && state.clock >= SHIFT_END) return { ...state, current: null, status: 'complete' };
  const rng = Rng.fromState(state.rngState);
  // The desk's clock is run by the screen; the others jump between arrivals.
  const clock = state.config.mode === 'desk' ? state.clock : state.clock + rng.int(6, 38);
  const ref = liveRef(state);
  const story = state.config.mode === 'campaign' ? storyArrival(state, ref, clockText(clock), rng) : undefined;
  const arrival = story ?? nextArrival(rng, ref, clockText(clock));
  if (!arrival) return { ...state, current: null, status: 'complete' };
  return { ...state, ref, current: arrival, clock, rngState: rng.getState() };
}

/**
 * The story's arrival comes halfway through the shift, if today has one. It
 * goes through the same check as any other: if it would not have exactly its
 * intended reason, it is skipped.
 */
function storyArrival(state: ShiftState, ref: Reference, time: string, rng: Rng): Arrival | undefined {
  if (state.results.length !== Math.floor((state.total ?? 0) / 2)) return undefined;
  const team = ref.roster.find((t) => t.id === STORY_TEAM_ID);
  const code = (id: string) => ref.codes.find((c) => c.teamId === id && c.expires >= ref.date)?.code;
  const auth = safeAuth(rng, ref);
  let a: Arrival | undefined;
  if (state.ref.day === 5 && team && code(team.id)) {
    a = { code: code(team.id)!, auth, teamId: team.id, date: ref.date, time, intent: 'missing', story: `${team.name}'s code. A voice on the line says it is them, and asks you to open the iris.` };
  } else if (state.ref.day === 6) {
    // Someone using a withdrawn code series, claiming to be a team that is really out there.
    const claimant = ref.roster.find((t) => t.id !== STORY_TEAM_ID && t.status === 'offworld');
    if (claimant) a = { code: 'Q4M-7TA', auth, teamId: claimant.id, date: ref.date, time, intent: 'unlisted', story: `A Q-series code, sent as ${claimant.name}. There should not be any left.` };
  } else if (state.ref.day === 7 && team && code(team.id)) {
    a = { code: code(team.id)!, auth, teamId: team.id, date: ref.date, time, intent: 'valid', story: `${team.name}, home at last, if you let them in.` };
  }
  if (!a) return undefined;
  const broken = brokenRules(a, ref);
  return (a.intent === 'valid' ? broken.length === 0 : broken.length === 1 && broken[0] === a.intent) ? a : undefined;
}

/** Move the desk clock on (minutes after midnight). It never runs backwards. */
export function setClock(state: ShiftState, minutes: number): ShiftState {
  return minutes > state.clock ? { ...state, clock: Math.min(minutes, SHIFT_END) } : state;
}

/** Make the call on the current arrival. */
export function decide(state: ShiftState, decision: Decision): { state: ShiftState; result: CallResult } {
  const a = state.current;
  if (!a || state.status !== 'running') throw new Error('No arrival to decide on');
  const verdict = judge(a, state.ref);
  const opened = decision === 'open';
  const first = verdict.broken[0];
  const result: CallResult = {
    arrival: a,
    decision,
    correct: opened === verdict.open,
    outcome: verdict.open ? (opened ? 'admitted' : 'friendly-lost') : opened ? 'hostile-admitted' : 'refused',
    rule: first?.rule.id ?? null,
    reason: first?.reason ?? null,
    limit: timeLimit(state),
  };
  const next: ShiftState = {
    ...state,
    results: [...state.results, result],
    hostilesAdmitted: state.hostilesAdmitted + (result.outcome === 'hostile-admitted' ? 1 : 0),
    lost: result.outcome === 'friendly-lost' ? [...state.lost, a.teamId] : state.lost,
    current: null,
  };
  // The desk waits for the screen to call the next arrival; the others roll straight on.
  if (state.config.mode === 'desk') {
    const over = next.hostilesAdmitted >= HOSTILE_LIMIT;
    return { state: over ? { ...next, status: 'overrun' } : next, result };
  }
  return { state: advance(next), result };
}

export interface ShiftReport {
  mode: Mode;
  day: number;
  seed: string;
  calls: number;
  correct: number;
  friendliesLost: string[];
  hostilesAdmitted: number;
  overrun: boolean;
  rating: string;
}

export function report(state: ShiftState): ShiftReport {
  const correct = state.results.filter((r) => r.correct).length;
  const calls = state.results.length;
  const lostNames = state.results.filter((r) => r.outcome === 'friendly-lost').map((r) => state.ref.roster.find((t) => t.id === r.arrival.teamId)?.name ?? r.arrival.teamId);
  const overrun = state.status === 'overrun';
  const acc = calls ? correct / calls : 0;
  const rating = overrun
    ? 'Relieved of duty'
    : acc === 1
      ? 'Commended'
      : acc >= 0.8 && state.hostilesAdmitted === 0
        ? 'Satisfactory'
        : acc >= 0.6
          ? 'Under review'
          : 'Reprimanded';
  return { mode: state.config.mode, day: state.config.day, seed: state.config.seed, calls, correct, friendliesLost: lostNames, hostilesAdmitted: state.hostilesAdmitted, overrun, rating };
}
