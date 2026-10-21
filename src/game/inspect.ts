/**
 * Inspection. Every checkable line on the desk has a field id. Picking two
 * fields compares them and says, in plain words, whether they agree. It
 * reports facts only; the decision is still the player's.
 *
 * Field ids:
 *   tx.code, tx.team, tx.date, tx.auth                  the ID transmission
 *   voice.speaker, voice.headcount, voice.origin        the voice transcript
 *   codes.<code>.code | .team | .expires                a line on the code sheet
 *   roster.<teamId>.status                              a line on the roster
 *   missions.<teamId>.leader | .size | .destination     a mission log entry
 *   bulletin.duress                                     today's duress digit
 */

import { duressDigit, missionFor } from './rules';
import type { Arrival, Reference, TeamStatus } from './types';

type Kind = 'code' | 'team' | 'date' | 'expiry' | 'auth' | 'person' | 'count' | 'world' | 'status';

export interface Field {
  id: string;
  kind: Kind;
  value: string;
  /** Team the field belongs to, where that matters. */
  teamId?: string;
}

export type Finding = { result: 'match' | 'mismatch' | 'unrelated'; text: string };

/** Look a field up on today's desk; undefined if it is not there. */
export function field(id: string, a: Arrival, ref: Reference): Field | undefined {
  const [doc, key, prop] = id.split('.');
  switch (doc) {
    case 'tx':
      if (key === 'code') return { id, kind: 'code', value: a.code };
      if (key === 'team') return { id, kind: 'team', value: a.teamId };
      if (key === 'date') return { id, kind: 'date', value: a.date };
      if (key === 'auth') return { id, kind: 'auth', value: String(a.auth) };
      return undefined;
    case 'voice':
      if (!a.voice) return undefined;
      if (key === 'speaker') return { id, kind: 'person', value: a.voice.speaker };
      if (key === 'headcount') return { id, kind: 'count', value: String(a.voice.headcount) };
      if (key === 'origin') return { id, kind: 'world', value: a.voice.origin };
      return undefined;
    case 'codes': {
      const c = ref.codes.find((x) => x.code === key);
      if (!c) return undefined;
      if (prop === 'code') return { id, kind: 'code', value: c.code, teamId: c.teamId };
      if (prop === 'team') return { id, kind: 'team', value: c.teamId };
      if (prop === 'expires') return { id, kind: 'expiry', value: c.expires, teamId: c.teamId };
      return undefined;
    }
    case 'roster': {
      const t = ref.roster.find((x) => x.id === key);
      return t && prop === 'status' ? { id, kind: 'status', value: t.status, teamId: t.id } : undefined;
    }
    case 'missions': {
      const m = key ? missionFor(ref, key) : undefined;
      if (!m) return undefined;
      if (prop === 'leader') return { id, kind: 'person', value: m.leader, teamId: m.teamId };
      if (prop === 'size') return { id, kind: 'count', value: String(m.size), teamId: m.teamId };
      if (prop === 'destination') return { id, kind: 'world', value: m.destination, teamId: m.teamId };
      return undefined;
    }
    case 'bulletin': {
      const d = duressDigit(ref);
      return key === 'duress' && d !== null ? { id, kind: 'auth', value: String(d) } : undefined;
    }
  }
  return undefined;
}

const STATUS_WORDS: Record<TeamStatus, string> = { offworld: 'off-world', overdue: 'off-world (overdue)', home: 'on base', missing: 'posted missing' };

/** Compare two fields on the desk. */
export function compare(idA: string, idB: string, a: Arrival, ref: Reference): Finding {
  const x = field(idA, a, ref);
  const y = field(idB, a, ref);
  if (!x || !y || idA === idB) return { result: 'unrelated', text: 'Nothing to compare there.' };
  const name = (id: string) => ref.roster.find((t) => t.id === id)?.name ?? 'an unknown team';
  const pair = (k1: Kind, k2: Kind) => (x.kind === k1 && y.kind === k2 ? [x, y] : y.kind === k1 && x.kind === k2 ? [y, x] : null);

  const dated = pair('date', 'expiry');
  if (dated) {
    const [d, e] = dated as [Field, Field];
    return d.value > e.value
      ? { result: 'mismatch', text: `Expired: that code ran out on ${e.value}, before this transmission (${d.value}).` }
      : { result: 'match', text: `In date: that code is good until ${e.value}.` };
  }
  const roster = pair('team', 'status');
  if (roster) {
    const [t, s] = roster as [Field, Field];
    if (t.value !== s.teamId) return { result: 'unrelated', text: `That roster line is for ${name(s.teamId!)}, not ${name(t.value)}.` };
    const ok = s.value === 'offworld' || s.value === 'overdue';
    return { result: ok ? 'match' : 'mismatch', text: `The roster has ${name(t.value)} ${STATUS_WORDS[s.value as TeamStatus]}.` };
  }
  if (x.kind !== y.kind) return { result: 'unrelated', text: 'Those two have nothing to do with each other.' };

  const shown = (f: Field) => (f.kind === 'team' ? name(f.value) : f.value);
  if (x.value === y.value) return { result: 'match', text: `They match: ${shown(x)}.` };
  const whose = x.kind === 'code' && (x.teamId ?? y.teamId) ? ` (that line is ${name((x.teamId ?? y.teamId)!)}'s)` : '';
  return { result: 'mismatch', text: `They do not match: ${shown(x)} and ${shown(y)}${whose}.` };
}
