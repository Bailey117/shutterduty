/**
 * Arrival generator. Every arrival starts as a valid one (a team that may
 * come home, its current code, a safe authentication digit, and sometimes a
 * truthful voice transmission) and is then changed in exactly one way to
 * break one rule, if it is meant to be hostile.
 *
 * The result is always checked with the rules engine: the arrival must break
 * exactly the intended rule (or none, if valid). If a draw happens to trip
 * another rule, it is thrown away and drawn again, so every arrival has one
 * clear right answer and one reason.
 */

import { CODE_CHARS, LEADER_FIRST, LEADER_LAST, RANKS, VOICE_LINES, WORLDS } from './data';
import { distinctCode } from './reference';
import { duressDigit, judge, latestRecall, missionFor, rulesById } from './rules';
import type { Rng } from './rng';
import type { Arrival, Clock, Intent, Reference, RuleId, Team, Voice } from './types';

/** Share of arrivals that send a voice transmission when voice rules are in force. */
export const VOICE_SHARE = 0.55;
const VOICE_INTENTS: readonly Intent[] = ['wrong-leader', 'wrong-headcount', 'wrong-origin'];

/** Teams that could genuinely be coming home today. */
function homecoming(ref: Reference): Team[] {
  return ref.roster.filter((t) => (t.status === 'offworld' || t.status === 'overdue') && latestRecall(ref, t.id)?.effect?.kind !== 'recall');
}

function currentCode(ref: Reference, teamId: string): string | undefined {
  return ref.codes.filter((c) => c.teamId === teamId && c.expires >= ref.date).at(0)?.code;
}

/** An authentication digit that is not today's duress digit. */
export function safeAuth(rng: Rng, ref: Reference): number {
  const d = duressDigit(ref);
  let n = rng.int(0, 9);
  while (n === d) n = rng.int(0, 9);
  return n;
}

function voiceRulesOn(ref: Reference): boolean {
  return ref.rules.some((r) => VOICE_INTENTS.includes(r));
}

function speak(rng: Rng, speaker: string, team: string, count: number, origin: string): Voice {
  const text = rng
    .pick(VOICE_LINES)
    .replace('{speaker}', speaker)
    .replace('{team}', team)
    .replace('{count}', String(count))
    .replace('{origin}', origin);
  return { speaker, headcount: count, origin, text };
}

/** A truthful voice for this team, from its mission log entry. */
function truthfulVoice(rng: Rng, ref: Reference, team: Team): Voice | undefined {
  const m = missionFor(ref, team.id);
  return m ? speak(rng, m.leader, team.name, m.size, m.destination) : undefined;
}

/** Someone else's name, a rank and name not in today's mission log. */
function impostor(rng: Rng, ref: Reference): string {
  const taken = new Set(ref.missions.map((m) => m.leader));
  for (;;) {
    const name = `${rng.pick(RANKS)} ${rng.pick(LEADER_FIRST)} ${rng.pick(LEADER_LAST)}`;
    if (!taken.has(name)) return name;
  }
}

/** Try to build an arrival with the given intent; undefined if today's sheet cannot produce one. */
function draft(rng: Rng, ref: Reference, intent: Intent, time: Clock): Arrival | undefined {
  const withVoice = voiceRulesOn(ref) && (VOICE_INTENTS.includes(intent) || rng.chance(VOICE_SHARE));
  const base = (team: Team): Arrival | undefined => {
    const code = currentCode(ref, team.id);
    if (!code) return undefined;
    const a: Arrival = { code, auth: safeAuth(rng, ref), teamId: team.id, date: ref.date, time, intent };
    if (withVoice) {
      const v = truthfulVoice(rng, ref, team);
      if (v) a.voice = v;
    }
    return a;
  };
  const pickBase = (pool: Team[]) => (pool.length ? base(rng.pick(pool)) : undefined);
  const out = homecoming(ref);
  const teamName = (id: string) => ref.roster.find((t) => t.id === id)!.name;
  switch (intent) {
    case 'valid':
      return pickBase(out);
    case 'unlisted': {
      const a = pickBase(out);
      if (!a) return undefined;
      // Sometimes another team's real code, sometimes a code nobody holds.
      const other = ref.codes.filter((c) => c.teamId !== a.teamId && c.expires >= ref.date);
      if (other.length && rng.chance(0.3)) return { ...a, code: rng.pick(other).code };
      return { ...a, code: distinctCode(rng, ref.codes.map((c) => c.code), 2) };
    }
    case 'expired': {
      const withOld = out.filter((t) => ref.codes.some((c) => c.teamId === t.id && c.expires < ref.date));
      const a = pickBase(withOld);
      if (!a) return undefined;
      return { ...a, code: rng.pick(ref.codes.filter((c) => c.teamId === a.teamId && c.expires < ref.date)).code };
    }
    case 'not-offworld':
      return pickBase(ref.roster.filter((t) => t.status === 'home'));
    case 'missing':
      return pickBase(ref.roster.filter((t) => t.status === 'missing'));
    case 'duress': {
      const a = pickBase(out);
      const d = duressDigit(ref);
      return a && d !== null ? { ...a, auth: d } : undefined;
    }
    case 'forged': {
      const a = pickBase(out);
      if (!a) return undefined;
      const pos = rng.pick([0, 1, 2, 4, 5, 6]);
      const chars = CODE_CHARS.replace(a.code[pos]!, '');
      const code = a.code.slice(0, pos) + chars[rng.int(0, chars.length - 1)] + a.code.slice(pos + 1);
      return { ...a, code };
    }
    case 'recalled': {
      const recalled = ref.roster.filter((t) => (t.status === 'offworld' || t.status === 'overdue') && latestRecall(ref, t.id)?.effect?.kind === 'recall');
      return pickBase(recalled);
    }
    case 'wrong-leader': {
      const a = pickBase(out);
      if (!a?.voice) return undefined;
      return { ...a, voice: speak(rng, impostor(rng, ref), teamName(a.teamId), a.voice.headcount, a.voice.origin) };
    }
    case 'wrong-headcount': {
      const a = pickBase(out);
      if (!a?.voice) return undefined;
      // Usually one extra: someone is coming through who did not go out.
      const n = a.voice.headcount + (rng.chance(0.75) ? 1 : -1);
      return { ...a, voice: speak(rng, a.voice.speaker, teamName(a.teamId), n, a.voice.origin) };
    }
    case 'wrong-origin': {
      const a = pickBase(out);
      if (!a?.voice) return undefined;
      const origin = rng.pick(WORLDS.filter((w) => w !== a.voice!.origin));
      return { ...a, voice: speak(rng, a.voice.speaker, teamName(a.teamId), a.voice.headcount, origin) };
    }
  }
}

/** The broken rules of an arrival, as ids. */
export function brokenRules(a: Arrival, ref: Reference): RuleId[] {
  return judge(a, ref).broken.map((b) => b.rule.id);
}

/** An arrival with exactly the intended outcome, or undefined if impossible today. */
export function makeArrival(rng: Rng, ref: Reference, intent: Intent, time: Clock): Arrival | undefined {
  for (let i = 0; i < 40; i++) {
    const a = draft(rng, ref, intent, time);
    if (!a) continue;
    const broken = brokenRules(a, ref);
    if (intent === 'valid' ? broken.length === 0 : broken.length === 1 && broken[0] === intent) return a;
  }
  return undefined;
}

/**
 * Choose what the next arrival will be. About 45% are genuine. Hostile ones
 * lean towards the newest rules, so each day teaches what is new.
 */
export function chooseIntent(rng: Rng, ref: Reference): Intent {
  if (rng.chance(0.45)) return 'valid';
  const rules = rulesById(ref.rules);
  const newest = Math.max(...rules.map((r) => r.day));
  const weights = rules.map((r) => (r.day === 0 ? 2 : r.day === newest ? 3 : 1));
  let roll = rng.next() * weights.reduce((a, b) => a + b, 0);
  for (const [i, r] of rules.entries()) {
    roll -= weights[i]!;
    if (roll < 0) return r.id;
  }
  return rules.at(-1)!.id;
}

/** Draw the next arrival: the chosen intent if possible, else another that today's sheet allows. */
export function nextArrival(rng: Rng, ref: Reference, time: Clock): Arrival | undefined {
  const first = chooseIntent(rng, ref);
  const fallback: Intent[] = ['valid', ...rng.shuffle(ref.rules)];
  for (const intent of [first, ...fallback]) {
    const a = makeArrival(rng, ref, intent, time);
    if (a) return a;
  }
  return undefined;
}
