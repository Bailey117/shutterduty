/**
 * The rules engine. Rules are records in a list: each has the day it comes
 * into force, the text the player is given, and a check that returns why an
 * arrival breaks it (or null). Nothing else in the game branches on rules;
 * judging an arrival is "run every active rule".
 *
 * The rules are written to be disjoint: an arrival built to break one rule
 * never trips another (tests/rules.test.ts proves this for generated
 * arrivals). In particular a code that is not on the list is either
 * "unlisted" (nothing like it on the list) or "forged" (one character away
 * from a real code), never both.
 */

import type { Arrival, CodeEntry, Mission, Reference, RuleId } from './types';

export interface Rule {
  id: RuleId;
  day: number;
  title: string;
  /** The order as the player reads it on the day it arrives. */
  briefing: string;
  /** Why the arrival breaks this rule, or null if it does not. */
  check(a: Arrival, ref: Reference): string | null;
  /**
   * The two fields on the desk that show whether this rule is broken, for
   * inspection (see inspect.ts). Null when the rule does not apply.
   */
  evidence(a: Arrival, ref: Reference): [string, string] | null;
}

/** The listed entry for this exact code and team, if any. */
export function entryFor(a: Arrival, ref: Reference): CodeEntry | undefined {
  return ref.codes.find((c) => c.code === a.code && c.teamId === a.teamId);
}

/** Number of positions at which two equal-length codes differ. */
export function hamming(x: string, y: string): number {
  if (x.length !== y.length) return Infinity;
  let d = 0;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) d++;
  return d;
}

/** A listed code exactly one character away from `code`, if any. */
export function nearMiss(code: string, ref: Reference): CodeEntry | undefined {
  return ref.codes.find((c) => hamming(c.code, code) === 1);
}

function teamName(ref: Reference, id: string): string {
  return ref.roster.find((t) => t.id === id)?.name ?? id;
}

/** The newest recall or cancellation bulletin about a team (newest wins). */
export function latestRecall(ref: Reference, teamId: string) {
  const relevant = ref.bulletins.filter((b) => (b.effect?.kind === 'recall' || b.effect?.kind === 'cancel-recall') && b.effect.teamId === teamId);
  return relevant.sort((x, y) => (x.time < y.time ? -1 : 1)).at(-1);
}

export function missionFor(ref: Reference, teamId: string): Mission | undefined {
  return ref.missions.find((m) => m.teamId === teamId);
}

/** The team's code that is still in date, if any. */
export function currentCodeOf(ref: Reference, teamId: string): CodeEntry | undefined {
  return ref.codes.find((c) => c.teamId === teamId && c.expires >= ref.date);
}

export function duressDigit(ref: Reference): number | null {
  const b = ref.bulletins.find((x) => x.effect?.kind === 'duress');
  return b?.effect?.kind === 'duress' ? b.effect.digit : null;
}

export const RULES: readonly Rule[] = [
  {
    id: 'unlisted',
    day: 1,
    title: 'Valid codes only',
    briefing: 'Open the iris only for an ID code on today\'s valid list, issued to the team that sends it.',
    evidence: (a, ref) => { const c = currentCodeOf(ref, a.teamId); return c ? ['tx.code', `codes.${c.code}.code`] : ['tx.code', 'tx.team']; },
    check(a, ref) {
      if (entryFor(a, ref) || nearMiss(a.code, ref)) return null;
      const other = ref.codes.find((c) => c.code === a.code);
      if (other) return `${a.code} is issued to ${teamName(ref, other.teamId)}, not ${teamName(ref, a.teamId)}.`;
      return `${a.code} is not on the valid list.`;
    },
  },
  {
    id: 'expired',
    day: 2,
    title: 'Codes expire',
    briefing: 'Codes now carry an expiry date. A code past its date on the day it is sent is no good.',
    evidence: (a, ref) => (entryFor(a, ref) ? ['tx.date', `codes.${a.code}.expires`] : null),
    check(a, ref) {
      const e = entryFor(a, ref);
      return e && e.expires < a.date ? `${a.code} expired on ${e.expires}; the transmission is dated ${a.date}.` : null;
    },
  },
  {
    id: 'not-offworld',
    day: 3,
    title: 'Check the roster',
    briefing: 'Only teams the roster lists as off-world can be coming home. A team on base is not out there.',
    evidence: (a) => ['tx.team', `roster.${a.teamId}.status`],
    check(a, ref) {
      const t = ref.roster.find((x) => x.id === a.teamId);
      if (!t) return `${teamName(ref, a.teamId)} is not on today's roster.`;
      return t.status === 'home' ? `The roster has ${t.name} on base, not off-world.` : null;
    },
  },
  {
    id: 'missing',
    day: 4,
    title: 'Missing teams',
    briefing: 'Teams posted missing are refused, even with a valid code. Whoever is using their code, it may not be them.',
    evidence: (a) => ['tx.team', `roster.${a.teamId}.status`],
    check(a, ref) {
      const t = ref.roster.find((x) => x.id === a.teamId);
      return t?.status === 'missing' ? `${t.name} is posted missing. Their code cannot be trusted.` : null;
    },
  },
  {
    id: 'duress',
    day: 5,
    title: 'Duress digit',
    briefing: 'Every transmission now ends with an authentication digit. If it matches today\'s duress digit (see bulletins), the team is compromised: refuse.',
    evidence: () => ['tx.auth', 'bulletin.duress'],
    check(a, ref) {
      const d = duressDigit(ref);
      return d !== null && a.auth === d ? `Authentication digit ${a.auth} is today's duress signal.` : null;
    },
  },
  {
    id: 'forged',
    day: 6,
    title: 'Forged codes',
    briefing: 'Forgeries are circulating: codes one character off a real one. Check every character.',
    evidence: (a, ref) => { const c = nearMiss(a.code, ref); return c ? ['tx.code', `codes.${c.code}.code`] : null; },
    check(a, ref) {
      if (entryFor(a, ref)) return null;
      const real = nearMiss(a.code, ref);
      return real ? `${a.code} is a forgery: one character off ${real.code}.` : null;
    },
  },
  {
    id: 'recalled',
    day: 7,
    title: 'Recalls',
    briefing: 'Command can recall a team, and cancel the recall. Bulletins can conflict: the newest one about a team is the one that counts.',
    evidence: () => null,
    check(a, ref) {
      const b = latestRecall(ref, a.teamId);
      return b?.effect?.kind === 'recall' ? `The newest bulletin about ${teamName(ref, a.teamId)} (${b.time}) is a recall order.` : null;
    },
  },
];

/**
 * Rules about voice transmissions, checked against the mission log. They
 * only apply when a voice comes with the code and the team has a mission
 * on file (a team with no mission is caught by the roster rule instead).
 */
export const VOICE_RULES: readonly Rule[] = [
  {
    id: 'wrong-leader',
    day: 0,
    title: 'Who is speaking',
    briefing: 'A voice transmission comes from the team leader. The speaker must be the leader in the mission log.',
    evidence: (a, ref) => (a.voice && missionFor(ref, a.teamId) ? ['voice.speaker', `missions.${a.teamId}.leader`] : null),
    check(a, ref) {
      const m = missionFor(ref, a.teamId);
      return a.voice && m && a.voice.speaker !== m.leader ? `The speaker gave the name ${a.voice.speaker}; the mission log has ${m.leader} leading ${teamName(ref, a.teamId)}.` : null;
    },
  },
  {
    id: 'wrong-headcount',
    day: 0,
    title: 'Headcount',
    briefing: 'The number coming home must match the number that went out, as logged.',
    evidence: (a, ref) => (a.voice && missionFor(ref, a.teamId) ? ['voice.headcount', `missions.${a.teamId}.size`] : null),
    check(a, ref) {
      const m = missionFor(ref, a.teamId);
      return a.voice && m && a.voice.headcount !== m.size ? `They say ${a.voice.headcount} coming through; ${m.size} went out.` : null;
    },
  },
  {
    id: 'wrong-origin',
    day: 0,
    title: 'Where from',
    briefing: 'A team can only be calling from the world the mission log sent it to.',
    evidence: (a, ref) => (a.voice && missionFor(ref, a.teamId) ? ['voice.origin', `missions.${a.teamId}.destination`] : null),
    check(a, ref) {
      const m = missionFor(ref, a.teamId);
      return a.voice && m && a.voice.origin !== m.destination ? `They say they are calling from ${a.voice.origin}; ${teamName(ref, a.teamId)} was sent to ${m.destination}.` : null;
    },
  },
];

export const ALL_RULES: readonly Rule[] = [...RULES, ...VOICE_RULES];

export const MAX_DAY = RULES.length;

export function activeRules(day: number): Rule[] {
  return RULES.filter((r) => r.day <= day);
}

export function rulesById(ids: readonly RuleId[]): Rule[] {
  return ALL_RULES.filter((r) => ids.includes(r.id));
}

export interface Verdict {
  /** The right call. */
  open: boolean;
  /** Every active rule the arrival breaks, with the reason. */
  broken: { rule: Rule; reason: string }[];
}

/** Judge an arrival against the rules in force on the reference's day. */
export function judge(a: Arrival, ref: Reference): Verdict {
  const broken: Verdict['broken'] = [];
  for (const rule of rulesById(ref.rules)) {
    const reason = rule.check(a, ref);
    if (reason) broken.push({ rule, reason });
  }
  return { open: broken.length === 0, broken };
}
