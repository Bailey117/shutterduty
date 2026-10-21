/**
 * A shift at the desk: arrivals one at a time, each judged by the rules in
 * force, with consequences. Pure state in, state out. The screen runs the
 * clock (setClock), brings arrivals in when it is ready (callNext) and makes
 * the calls (decide).
 *
 * - Campaign: one day's rules; the shift runs 08:00 to 18:00.
 * - Endless: every rule, no closing time; it runs until the base is overrun.
 * - Admitting a hostile damages the base. The third ends the shift.
 * - Refusing a friendly loses that team: it is off the roster for the rest
 *   of the campaign.
 */

import { brokenRules, nextArrival, safeAuth } from './arrivals';
import { SHIFT_START } from './data';
import { STORY_TEAM_ID, buildReference, campaignTeams } from './reference';
import { MAX_DAY, judge } from './rules';
import { Rng, deriveSeed } from './rng';
import type { Arrival, Reference, RuleId } from './types';

export type Mode = 'campaign' | 'endless';
export type Decision = 'open' | 'close';

export interface ShiftConfig {
  mode: Mode;
  seed: string;
  /** Campaign day 1-7 (endless runs on every rule). */
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
}

export interface ShiftState {
  config: ShiftConfig;
  ref: Reference;
  current: Arrival | null;
  results: CallResult[];
  hostilesAdmitted: number;
  /** Teams lost so far, including this shift's. */
  lost: string[];
  status: 'running' | 'complete' | 'overrun';
  rngState: number;
  /** Minutes after midnight on the base clock. */
  clock: number;
  /** Whether today's story arrival has come. */
  storyDone: boolean;
  /** Every team's callsign, including any lost today (for reports). */
  names: Record<string, string>;
}

export const HOSTILE_LIMIT = 3;

/** End of a campaign shift, in minutes after midnight (18:00). */
export const SHIFT_END = 18 * 60;

/** The story's arrival comes after this time (12:00). */
export const STORY_AFTER = 12 * 60;

const clockText = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function startShift(config: ShiftConfig): ShiftState {
  const endless = config.mode === 'endless';
  const day = endless ? MAX_DAY : config.day;
  const sheetSeed = endless ? `endless:${config.seed}` : config.seed;
  const ref = buildReference(sheetSeed, day, { lost: config.lost, story: !endless });
  return {
    config: { ...config, day },
    ref,
    current: null,
    results: [],
    hostilesAdmitted: 0,
    lost: [...config.lost],
    status: 'running',
    rngState: new Rng(deriveSeed(sheetSeed, `shift-${day}`)).getState(),
    clock: SHIFT_START,
    storyDone: false,
    names: Object.fromEntries(campaignTeams(sheetSeed).map((t) => [t.id, t.name])),
  };
}

/** Bring in the next arrival at the current clock, or end the shift. */
export function callNext(state: ShiftState): ShiftState {
  if (state.current || state.status !== 'running') return state;
  if (state.hostilesAdmitted >= HOSTILE_LIMIT) return { ...state, status: 'overrun' };
  if (state.config.mode === 'campaign' && state.clock >= SHIFT_END) return { ...state, status: 'complete' };
  const rng = Rng.fromState(state.rngState);
  const ref = liveRef(state);
  const time = clockText(state.clock);
  const story = state.config.mode === 'campaign' && !state.storyDone && state.clock >= STORY_AFTER ? storyArrival(ref, time, rng) : undefined;
  const arrival = story ?? nextArrival(rng, ref, time);
  if (!arrival) return { ...state, status: 'complete' };
  return { ...state, ref, current: arrival, rngState: rng.getState(), storyDone: state.storyDone || !!story };
}

/** The reference as it stands now (teams lost this shift are struck off). */
function liveRef(state: ShiftState): Reference {
  const lost = new Set(state.lost);
  return {
    ...state.ref,
    roster: state.ref.roster.filter((t) => !lost.has(t.id)),
    codes: state.ref.codes.filter((c) => !lost.has(c.teamId)),
    missions: state.ref.missions.filter((m) => !lost.has(m.teamId)),
  };
}

/**
 * The story's arrival for today, if there is one. It goes through the same
 * check as any other: if it would not have exactly its intended reason, it
 * is skipped.
 */
function storyArrival(ref: Reference, time: string, rng: Rng): Arrival | undefined {
  const team = ref.roster.find((t) => t.id === STORY_TEAM_ID);
  const code = (id: string) => ref.codes.find((c) => c.teamId === id && c.expires >= ref.date)?.code;
  const auth = safeAuth(rng, ref);
  let a: Arrival | undefined;
  if (ref.day === 5 && team && code(team.id)) {
    a = { code: code(team.id)!, auth, teamId: team.id, date: ref.date, time, intent: 'missing', story: `${team.name}'s code. A voice on the line says it is them, and asks you to open the iris.` };
  } else if (ref.day === 6) {
    // Someone using a withdrawn code series, claiming to be a team that is really out there.
    const claimant = ref.roster.find((t) => t.id !== STORY_TEAM_ID && t.status === 'offworld');
    if (claimant) a = { code: 'Q4M-7TA', auth, teamId: claimant.id, date: ref.date, time, intent: 'unlisted', story: `A Q-series code, sent as ${claimant.name}. There should not be any left.` };
  } else if (ref.day === 7 && team && code(team.id)) {
    a = { code: code(team.id)!, auth, teamId: team.id, date: ref.date, time, intent: 'valid', story: `${team.name}, home at last, if you let them in.` };
  }
  if (!a) return undefined;
  const broken = brokenRules(a, ref);
  return (a.intent === 'valid' ? broken.length === 0 : broken.length === 1 && broken[0] === a.intent) ? a : undefined;
}

/** Move the clock on (minutes after midnight). It never runs backwards; a campaign shift stops at 18:00. */
export function setClock(state: ShiftState, minutes: number): ShiftState {
  const cap = state.config.mode === 'campaign' ? SHIFT_END : Infinity;
  return minutes > state.clock ? { ...state, clock: Math.min(minutes, cap) } : state;
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
  };
  const hostiles = state.hostilesAdmitted + (result.outcome === 'hostile-admitted' ? 1 : 0);
  return {
    state: {
      ...state,
      results: [...state.results, result],
      hostilesAdmitted: hostiles,
      lost: result.outcome === 'friendly-lost' ? [...state.lost, a.teamId] : state.lost,
      current: null,
      status: hostiles >= HOSTILE_LIMIT ? 'overrun' : state.status,
    },
    result,
  };
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
}

export function report(state: ShiftState): ShiftReport {
  const correct = state.results.filter((r) => r.correct).length;
  const lost = state.results.filter((r) => r.outcome === 'friendly-lost').map((r) => state.names[r.arrival.teamId] ?? r.arrival.teamId);
  return {
    mode: state.config.mode,
    day: state.config.day,
    seed: state.config.seed,
    calls: state.results.length,
    correct,
    friendliesLost: lost,
    hostilesAdmitted: state.hostilesAdmitted,
    overrun: state.status === 'overrun',
  };
}
