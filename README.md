# Shutter Duty (working title)

Proof of concept. You are the ring attendant at Brackwater Annex. Teams
coming home send an ID code, and some send a voice transmission too. You
check them against the paperwork on your desk and open the iris, or keep it
shut. The gate is the ring in `src/ring/` (view, dial timeline and sound,
first built for the Farpoint prototype) with an iris fitted across it.

The game is a seven-day campaign at the desk, Papers, Please style:
- A fixed 1600x900 landscape scene scaled to the screen; phones held upright
  get a "turn sideways" note (Android also tries fullscreen landscape).
- A shift clock, 08:00 to 18:00, one game minute per real second.
  `?speed=N` runs it N times faster (testing aid).
- One new idea a day (`activeRules` in src/game/rules.ts):
  1 valid codes, 2 expiry dates, 3 the roster (on base, missing),
  4 voice transmissions and the mission log (the leader), 5 headcount and
  origin, 6 duress digits and one-character forgeries, 7 recalls.
  Paperwork arrives on the desk as its rules do.
- Inspect mode: pick two lines and they are compared (src/game/inspect.ts).
- Pay per correct call, citations (two warnings, then docked); each evening
  the bills for the household (src/game/economy.ts). An overrun day pays
  nothing and must be worked again; too much debt and you are evicted.
- A story told only through the paperwork, ending on day 7.
- Endless mode: every rule, no closing time, a seed and a best score.
- Progress saves to localStorage every night (src/game/campaign.ts).

```
npm install
npm run dev
npm run typecheck
npm test
npm run build:artifact   # one self-contained page: dist/shutter-duty.html
```

- `src/game/` pure logic: `rules.ts` (the rules as data), `reference.ts`
  (the day's roster, codes and bulletins), `arrivals.ts` (arrivals built to
  be valid or to break exactly one rule, checked by the engine), `shift.ts`,
  `campaign.ts` (progress, household, story ending, endless best; saved to
  localStorage), `economy.ts` (pay and bills), `inspect.ts` (comparisons).
- `src/ring/` the gate: ring view, dial timeline, ring sound, glyphs.
- `src/ui/` the desk, the iris, the clock, keyboard (O / C / I) and sound cues.
- All randomness goes through `src/game/rng.ts`; a shift replays from its seed.

Rule definitions where the brief left room:
- Day 5: each transmission carries a separate authentication digit; a
  bulletin names the duress digit.
- Day 6: a forgery is one character off a listed code. A code with nothing
  close on the list falls under the day 1 rule instead, so the two never
  overlap. Listed codes are kept at least 3 characters apart.
- Day 7: recall and cancellation bulletins for a team; the latest time wins.
