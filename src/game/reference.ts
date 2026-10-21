/**
 * The day's reference sheet: roster, valid code list and bulletins. Built
 * from the campaign seed and the day, so a day can be replayed exactly.
 *
 * Each sheet is built so every rule in force can actually come up: there is
 * always a team on base (day 3+), a missing team (day 4+), expired codes
 * (day 2+), a duress digit (day 5+) and a recall tangle (day 7+).
 */

import { CALLSIGNS, CODE_CHARS, FLAVOUR_BULLETINS, LEADER_FIRST, LEADER_LAST, RANKS, START_DATE, STORY, STORY_WORLD, TEAMS_PER_CAMPAIGN, WORLDS } from './data';
import { activeRules, hamming } from './rules';
import { Rng, deriveSeed } from './rng';
import type { Bulletin, CodeEntry, IsoDate, Mission, Reference, RuleId, Team, TeamStatus } from './types';

export interface TeamSeed {
  id: string;
  name: string;
}

/** The story team is always the campaign's first team. */
export const STORY_TEAM_ID = 't1';

/** The campaign's teams; the first is the story team. */
export function campaignTeams(seed: string): TeamSeed[] {
  const rng = new Rng(deriveSeed(seed, 'teams'));
  return rng.sample(CALLSIGNS, TEAMS_PER_CAMPAIGN).map((name, i) => ({ id: `t${i + 1}`, name }));
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayDate(day: number): IsoDate {
  return addDays(START_DATE, day - 1);
}

/** A random code like "K4R-27M". */
export function randomCode(rng: Rng): string {
  const c = () => CODE_CHARS[rng.int(0, CODE_CHARS.length - 1)]!;
  return `${c()}${c()}${c()}-${c()}${c()}${c()}`;
}

/** A code at least `minDistance` characters away from every code in `taken`. */
export function distinctCode(rng: Rng, taken: readonly string[], minDistance = 3): string {
  for (let i = 0; i < 500; i++) {
    const code = randomCode(rng);
    if (taken.every((t) => hamming(t, code) >= minDistance)) return code;
  }
  throw new Error('Could not find a distinct code');
}

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export interface SheetOptions {
  /** Teams lost in earlier shifts: off the roster and the code list. */
  lost?: readonly string[];
  /** Tell the story (campaign) or not (endless). */
  story?: boolean;
  /** Rules in force, if not the campaign day's. */
  rules?: RuleId[];
}

/**
 * Each team's leader and the world it was sent to, fixed for the whole
 * campaign so the paperwork stays consistent from day to day.
 */
export function teamProfiles(seed: string): Map<string, { leader: string; destination: string; size: number }> {
  const rng = new Rng(deriveSeed(seed, 'profiles'));
  const firsts = rng.shuffle(LEADER_FIRST);
  const lasts = rng.shuffle(LEADER_LAST);
  const worlds = rng.shuffle(WORLDS.filter((w) => w !== STORY_WORLD));
  const out = new Map<string, { leader: string; destination: string; size: number }>();
  campaignTeams(seed).forEach((t, i) => {
    out.set(t.id, {
      leader: `${rng.pick(RANKS)} ${firsts[i % firsts.length]} ${lasts[i % lasts.length]}`,
      destination: t.id === STORY_TEAM_ID ? STORY_WORLD : worlds[i % worlds.length]!,
      size: rng.int(3, 6),
    });
  });
  return out;
}

export function buildReference(seed: string, day: number, opts: SheetOptions = {}): Reference {
  const rng = new Rng(deriveSeed(seed, `sheet-${day}`));
  const lost = new Set(opts.lost ?? []);
  const date = dayDate(day);
  const all = campaignTeams(seed);
  const storyTeam = all[0]!;
  const beat = opts.story !== false ? STORY[day] : undefined;
  const teams = all.filter((t) => !lost.has(t.id));
  const tellStory = !!beat && teams.includes(storyTeam);

  // Statuses: the story team follows the script; the rest are mostly out.
  const others = rng.shuffle(teams.filter((t) => !tellStory || t !== storyTeam));
  const status = new Map<string, TeamStatus>();
  const remark = new Map<string, string>();
  if (tellStory) {
    status.set(storyTeam.id, beat.status);
    if (beat.remark) remark.set(storyTeam.id, beat.remark);
  }
  let i = 0;
  // Required statuses first, so the day's rules have something to bite on.
  if (day >= 3 && others[i]) status.set(others[i++]!.id, 'home');
  if (day >= 3 && others[i]) status.set(others[i++]!.id, 'home');
  const needMissing = day >= 4 && ![...status.values()].includes('missing');
  if (needMissing && others[i]) {
    status.set(others[i]!.id, 'missing');
    remark.set(others[i]!.id, 'No contact since last cycle');
    i++;
  }
  for (; i < others.length; i++) {
    const t = others[i]!;
    const roll = rng.next();
    status.set(t.id, roll < 0.65 ? 'offworld' : roll < 0.85 ? 'home' : 'overdue');
    if (status.get(t.id) === 'overdue') remark.set(t.id, 'Overdue a few hours');
  }
  const roster: Team[] = teams.map((t) => ({ id: t.id, name: t.name, status: status.get(t.id)!, ...(remark.has(t.id) ? { remark: remark.get(t.id) } : {}) }));

  // Codes: every team has a current code; from day 2 some also hold an expired one.
  const codes: CodeEntry[] = [];
  const taken: string[] = [];
  for (const t of roster) {
    const code = distinctCode(rng, taken);
    taken.push(code);
    codes.push({ code, teamId: t.id, expires: day >= 2 ? addDays(date, rng.int(1, 30)) : addDays(date, 90) });
  }
  if (day >= 2) {
    const out = roster.filter((t) => t.status === 'offworld' || t.status === 'overdue');
    const withOld = rng.shuffle(out).slice(0, Math.max(2, Math.ceil(out.length / 2)));
    for (const t of withOld) {
      const code = distinctCode(rng, taken);
      taken.push(code);
      codes.push({ code, teamId: t.id, expires: addDays(date, -rng.int(1, 40)) });
    }
  }
  const sortedCodes = rng.shuffle(codes);

  // Bulletins: flavour, the story, the duress digit, and recall tangles.
  const bulletins: Bulletin[] = [];
  const used = new Set<number>();
  const minute = () => {
    let m = 0;
    do m = 6 * 60 + rng.int(0, 115);
    while (used.has(m));
    used.add(m);
    return m;
  };
  bulletins.push({ time: clock(minute()), text: rng.pick(FLAVOUR_BULLETINS) });
  if (tellStory) {
    for (const b of beat.bulletins) {
      const text = b.text.replaceAll('{team}', storyTeam.name);
      bulletins.push({ time: b.time, text, ...(b.effect ? { effect: { kind: b.effect, teamId: storyTeam.id } } : {}) });
      used.add(Number(b.time.slice(0, 2)) * 60 + Number(b.time.slice(3)));
    }
  }
  if (day >= 5) {
    const digit = rng.int(0, 9);
    bulletins.push({ time: clock(minute()), text: `Today's duress digit is ${digit}. A transmission authenticated with ${digit} means the team is under duress.`, effect: { kind: 'duress', digit } });
  }
  if (day >= 7) {
    const out = roster.filter((t) => (t.status === 'offworld' || t.status === 'overdue') && !(tellStory && t.id === storyTeam.id));
    const [recalled, cleared] = rng.shuffle(out);
    // One team ends up recalled (cancel, then a newer recall)...
    if (recalled) {
      const [a, b] = [minute(), minute()].sort((x, y) => x - y);
      bulletins.push({ time: clock(a!), text: `Recall on ${recalled.name} lifted.`, effect: { kind: 'cancel-recall', teamId: recalled.id } });
      bulletins.push({ time: clock(b!), text: `Recall order: ${recalled.name} is not to be admitted.`, effect: { kind: 'recall', teamId: recalled.id } });
    }
    // ...and one ends up cleared (recall, then a newer cancellation).
    if (cleared) {
      const [a, b] = [minute(), minute()].sort((x, y) => x - y);
      bulletins.push({ time: clock(a!), text: `Recall order: ${cleared.name} is not to be admitted.`, effect: { kind: 'recall', teamId: cleared.id } });
      bulletins.push({ time: clock(b!), text: `Recall on ${cleared.name} cancelled. Admit as normal.`, effect: { kind: 'cancel-recall', teamId: cleared.id } });
    }
  }
  // Shown in the order they came in, like a log: the newest is at the bottom.
  bulletins.sort((x, y) => (x.time < y.time ? -1 : 1));

  // Mission log: every team that is out there (or was, and is now missing).
  const profiles = teamProfiles(seed);
  const missions: Mission[] = roster
    .filter((t) => t.status !== 'home')
    .map((t) => {
      const p = profiles.get(t.id)!;
      return { teamId: t.id, leader: p.leader, size: p.size, destination: p.destination, departed: addDays(date, -rng.int(2, 18)) };
    });
  const rules = opts.rules ?? activeRules(day).map((r) => r.id);
  return { day, date, rules, roster, codes: sortedCodes, bulletins, missions };
}
