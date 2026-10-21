/**
 * Pay and home. The attendant is paid per correct call; mistakes bring
 * citations (the first two in a shift are warnings, after that each one
 * docks pay). Each night the bills come in, and whatever is not paid for
 * shows up in the household the next morning.
 *
 * The household: your sister Nell and her daughter Pim, who you took in
 * after the evacuation of the old site, and Corran from the next block,
 * whom you promised to look after.
 */

import type { CallResult } from './shift';

export const WAGE = 5;
export const FREE_CITATIONS = 2;
export const CITATION_FINE = 5;
/** Admitting a hostile is docked on top of the citation. */
export const HOSTILE_FINE = 10;

export interface Pay {
  correct: number;
  wages: number;
  citations: number;
  fines: number;
  total: number;
}

export function shiftPay(results: readonly CallResult[]): Pay {
  const correct = results.filter((r) => r.correct).length;
  const citations = results.filter((r) => !r.correct).length;
  const hostile = results.filter((r) => r.outcome === 'hostile-admitted').length;
  const fines = Math.max(0, citations - FREE_CITATIONS) * CITATION_FINE + hostile * HOSTILE_FINE;
  const wages = correct * WAGE;
  return { correct, wages, citations, fines, total: wages - fines };
}

export type Condition = 'well' | 'hungry' | 'cold' | 'sick' | 'gone';

export interface Person {
  name: string;
  /** How they relate to you, for the evening screen. */
  relation: string;
  condition: Condition;
}

export interface Household {
  savings: number;
  people: Person[];
}

export type BillId = 'rent' | 'food' | 'heat' | 'medicine' | 'gift' | 'coat';

export interface Bill {
  id: BillId;
  label: string;
  cost: number;
  /** Rent cannot be skipped. */
  required: boolean;
}

export function startingHousehold(): Household {
  return {
    savings: 12,
    people: [
      { name: 'Nell', relation: 'your sister', condition: 'well' },
      { name: 'Pim', relation: 'her daughter', condition: 'sick' },
      { name: 'Corran', relation: 'from the next block', condition: 'hungry' },
    ],
  };
}

/**
 * One-off costs on particular evenings. Nothing bad happens if they are
 * skipped, except to how the household feels about you.
 */
export const EXTRAS: Record<number, { bill: Bill; who: string; yes: string; no: string }> = {
  3: { bill: { id: 'gift', label: "Pim's birthday present", cost: 8, required: false }, who: 'Pim', yes: 'Pim will not put the present down.', no: 'Pim says she does not mind about the present. She minds.' },
  5: { bill: { id: 'coat', label: 'A winter coat for Corran', cost: 10, required: false }, who: 'Corran', yes: 'Corran wears the coat indoors, to show you.', no: 'Corran has started wearing two jumpers.' },
};

/** Tonight's bills. Medicine only appears when someone is sick; some evenings bring an extra. */
export function bills(h: Household, day = 0): Bill[] {
  const list: Bill[] = [
    { id: 'rent', label: 'Quarters', cost: 20, required: true },
    { id: 'food', label: 'Rations', cost: 10, required: false },
    { id: 'heat', label: 'Heating', cost: 6, required: false },
  ];
  if (h.people.some((p) => p.condition === 'sick')) list.push({ id: 'medicine', label: 'Medicine', cost: 12, required: false });
  const extra = EXTRAS[day];
  if (extra && h.people.some((p) => p.name === extra.who && p.condition !== 'gone')) list.push(extra.bill);
  return list;
}

export interface Night {
  household: Household;
  /** What the morning brings, one line per person who changed. */
  morning: string[];
}

/**
 * Pay the chosen bills (rent always) and see the morning. Unpaid food makes
 * the well hungry; unpaid heat makes the hungry ill; medicine cures one.
 * Someone already sick who gets neither medicine nor heat is gone by morning.
 */
export function night(h: Household, pay: Pay, chosen: readonly BillId[], day = 0): Night {
  const due = bills(h, day).filter((b) => b.required || chosen.includes(b.id));
  const cost = due.reduce((n, b) => n + b.cost, 0);
  const paid = new Set(due.map((b) => b.id));
  const savings = h.savings + pay.total - cost;
  const morning: string[] = [];
  const people = h.people.map((p): Person => {
    if (p.condition === 'gone') return p;
    let c: Condition = p.condition;
    if (c === 'sick') {
      if (paid.has('medicine')) c = 'well';
      else if (!paid.has('heat')) c = 'gone';
    } else if (!paid.has('food')) c = c === 'well' ? 'hungry' : 'sick';
    else if (!paid.has('heat') && c === 'hungry') c = 'cold';
    else if (paid.has('food') && (c === 'hungry' || c === 'cold')) c = 'well';
    if (c !== p.condition) morning.push(MORNING[c](p.name));
    return { ...p, condition: c };
  });
  const extra = EXTRAS[day];
  if (extra && bills(h, day).some((b) => b.id === extra.bill.id)) morning.push(paid.has(extra.bill.id) ? extra.yes : extra.no);
  if (savings < 0) morning.push('You are in debt to the quartermaster. That will not be allowed to go on.');
  return { household: { savings, people }, morning };
}

const MORNING: Record<Condition, (n: string) => string> = {
  well: (n) => `${n} is doing better.`,
  hungry: (n) => `${n} is hungry.`,
  cold: (n) => `${n} is cold and will not stop shivering.`,
  sick: (n) => `${n} is ill.`,
  gone: (n) => `${n} did not wake up.`,
};
