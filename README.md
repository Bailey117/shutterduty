# Shutter Duty (working title)

Proof of concept. You are the ring attendant at Brackwater Annex. Teams
coming home send an ID code, and some send a voice transmission too. You
check them against the paperwork on your desk and open the iris, or keep it
shut. The gate is the ring in `src/ring/` (view, dial timeline and sound,
first built for the Farpoint prototype) with an iris fitted across it.

The playable demo is one desk day, Papers, Please style:
- A fixed 1600x900 landscape scene scaled to the screen; phones held upright
  get a "turn sideways" note (Android also tries fullscreen landscape).
- A shift clock, 08:00 to 18:00, one game minute per real second. No
  per-arrival countdown. `?speed=N` runs it N times faster (testing aid).
- Draggable paperwork: standing orders, code sheet, roster, mission log,
  bulletins. Voice transcripts and citations print onto the desk.
- Inspect mode: pick two lines and they are compared (src/game/inspect.ts).
- Pay per correct call, citations (two warnings, then docked), and the
  evening ledger with the household (src/game/economy.ts).

The seven-day campaign and endless mode from the first prototype are still
in `src/game/` (with their tests) and will be rebuilt on the desk.

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
  `campaign.ts` (progress, lost teams, endless best; saved to localStorage).
- `src/ui/` rendering, the clock, keyboard (O / C) and sound cues.
- All randomness goes through `src/game/rng.ts`; a shift replays from its seed.

Rule definitions where the brief left room:
- Day 5: each transmission carries a separate authentication digit; a
  bulletin names the duress digit.
- Day 6: a forgery is one character off a listed code. A code with nothing
  close on the list falls under the day 1 rule instead, so the two never
  overlap. Listed codes are kept at least 3 characters apart.
- Day 7: recall and cancellation bulletins for a team; the latest time wins.
