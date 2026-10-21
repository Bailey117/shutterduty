/**
 * The desk: one landscape scene, 1600x900 units, scaled to fit the screen.
 * The gate room is through the window at the top; the paperwork lives on the
 * desk below and can be dragged about; the terminal shows each ID code, the
 * printer feeds out voice transcripts and citations, and the console on the
 * right holds the iris lever, the refuse switch and the inspection lamp.
 *
 * The game modules decide everything; this file only shows it and runs the
 * shift clock (one game minute per real second, 08:00 to 18:00).
 */

import { FAMILIES, type GlyphId } from '../ring/glyphs';
import { BASE_NAME, DAY_NOTES, SUPERVISOR } from '../game/data';
import { type Campaign, type KeyValueStorage, endDay as closeDay, epilogue, load, newCampaign, recordEndless, save } from '../game/campaign';
import { type BillId, CITATION_FINE, FREE_CITATIONS, HOSTILE_FINE, WAGE, bills } from '../game/economy';
import { compare } from '../game/inspect';
import { MAX_DAY, newRules, rulesById } from '../game/rules';
import { Rng, deriveSeed } from '../game/rng';
import { type CallResult, HOSTILE_LIMIT, type Mode, SHIFT_END, type ShiftState, callNext, decide, setClock, startShift } from '../game/shift';
import type { Arrival, Reference, TeamStatus, Voice } from '../game/types';
import { h } from './dom';
import { Gate } from './gate';
import { cue, setSound, soundOn } from './sound';

const W = 1600;
const H = 900;
/** Testing aid: ?speed=N runs the shift clock and the waits N times faster. */
const SPEED = Math.max(1, Number(new URLSearchParams(location.search).get('speed')) || 1);
/** Real milliseconds per game minute. */
const MINUTE_MS = 1000 / SPEED;
const DESK_TOP = 420;
/** Left edge of the control console (papers slide under it, never over). */
const CONSOLE_LEFT = 1278;

const STATUS_LABEL: Record<TeamStatus, string> = { offworld: 'Off-world', overdue: 'Overdue', home: 'On base', missing: 'Missing' };
const clockText = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const freshSeed = () => `shift-${Date.now().toString(36)}`;

const storage: KeyValueStorage = {
  getItem: (k) => localStorage.getItem(k),
  setItem: (k, v) => localStorage.setItem(k, v),
  removeItem: (k) => localStorage.removeItem(k),
};

/** The address an arrival dials in from: one glyph from each family (cosmetic). */
function originOf(a: Arrival): GlyphId[] {
  const rng = new Rng(deriveSeed(a.code, `${a.date} ${a.time}`));
  return rng.shuffle(FAMILIES.map((f) => rng.pick(f.glyphs as readonly GlyphId[])));
}

type Phase = 'title' | 'briefing' | 'idle' | 'incoming' | 'deciding' | 'feedback' | 'evening';

export function startApp(root: HTMLElement) {
  // ---------------------------------------------------------------------------
  // Stage and scaling
  // ---------------------------------------------------------------------------
  const stage = h('div', { class: 'stage' });
  const viewport = h('div', { class: 'viewport' }, stage);
  const rotate = h('div', { class: 'rotate-note' }, h('div', { class: 'phone-icon' }), h('p', {}, 'Turn your device sideways.'), h('p', { class: 'small' }, 'Shutter Duty is played in landscape.'));
  root.replaceChildren(viewport, rotate);
  let scale = 1;
  const fit = () => {
    scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };
  window.addEventListener('resize', fit);
  fit();
  // The scene never scrolls: focusing or clicking a half-hidden paper must not shift it.
  const pin = () => {
    if (viewport.scrollTop || viewport.scrollLeft) viewport.scrollTo(0, 0);
    if (stage.scrollTop || stage.scrollLeft) stage.scrollTo(0, 0);
  };
  viewport.addEventListener('scroll', pin);
  stage.addEventListener('scroll', pin);
  const toStage = (clientX: number, clientY: number) => {
    const r = stage.getBoundingClientRect();
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
  };

  // ---------------------------------------------------------------------------
  // The room
  // ---------------------------------------------------------------------------
  const gate = new Gate();
  const clockFace = h('div', { class: 'clock-digits' }, '08:00');
  const dayPlate = h('div', { class: 'plate' }, BASE_NAME.toUpperCase());
  const dateLine = h('div', { class: 'clock-date' }, '');
  const lamps = Array.from({ length: HOSTILE_LIMIT }, () => h('span', { class: 'lamp' }));
  const alarmLight = h('div', { class: 'alarm-light' });
  const crt = h('div', { class: 'crt-screen' });
  const voiceLamp = h('span', { class: 'voice-lamp' });
  const lever = h('button', { class: 'lever', 'aria-label': 'Open the iris (O)', title: 'Open the iris (O)' }, h('span', { class: 'lever-slot' }), h('span', { class: 'lever-arm' }, h('span', { class: 'lever-knob' })));
  const refuse = h('button', { class: 'refuse', 'aria-label': 'Refuse: keep the iris shut (C)', title: 'Keep the iris shut (C)' }, h('span', { class: 'refuse-cap' }, 'REFUSE'));
  const inspectBtn = h('button', { class: 'inspect-btn', 'aria-pressed': 'false', title: 'Inspect (I): pick two lines to compare' }, h('span', { class: 'inspect-glass' }), 'INSPECT');
  const soundBtn = h('button', { class: 'sound-btn' }, soundOn() ? 'SOUND ON' : 'SOUND OFF');
  const docsLayer = h('div', { class: 'docs' });
  const lineSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  lineSvg.setAttribute('class', 'inspect-lines');
  lineSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const finding = h('div', { class: 'finding', role: 'status', 'aria-live': 'polite' });
  const modal = h('div', { class: 'modal' });

  stage.append(
    h('div', { class: 'wall' }),
    h('div', { class: 'wall-clock' }, dayPlate, clockFace, dateLine),
    h('div', { class: 'poster' }, h('div', { class: 'poster-top' }, 'CHECK'), h('div', { class: 'poster-mid' }, 'EVERY'), h('div', { class: 'poster-top' }, 'CODE'), h('div', { class: 'poster-small' }, 'One wrong opening is one too many.')),
    h('div', { class: 'integrity' }, h('div', { class: 'plate' }, 'BASE INTEGRITY'), h('div', { class: 'lamps' }, lamps)),
    h('div', { class: 'drawing' }, drawing(), h('span', {}, 'for the iris man')),
    h('div', { class: 'window' }, h('div', { class: 'gate-room' }, h('div', { class: 'ramp' }), h('div', { class: 'gate-holder' }, gate.el), alarmLight), h('div', { class: 'glass' })),
    h('div', { class: 'desk' }, h('div', { class: 'desk-edge' })),
    h('div', { class: 'lamp-light' }),
    h('div', { class: 'terminal' }, h('div', { class: 'crt' }, crt, h('div', { class: 'crt-glare' })), h('div', { class: 'terminal-label' }, 'RING CONTROL 2')),
    h('div', { class: 'printer' }, h('div', { class: 'printer-slot' }), h('div', { class: 'terminal-label' }, 'PRINTER')),
    h('div', { class: 'console' },
      h('div', { class: 'grille' }, h('div', { class: 'grille-holes' }), h('div', { class: 'voice-row' }, voiceLamp, 'VOICE')),
      h('div', { class: 'console-row' }, h('div', { class: 'lever-wrap' }, lever, h('div', { class: 'console-label' }, 'IRIS')), h('div', { class: 'refuse-wrap' }, refuse, h('div', { class: 'console-label' }, 'KEEP SHUT'))),
      inspectBtn,
      soundBtn,
    ),
    docsLayer,
    lineSvg,
    finding,
    modal,
  );

  soundBtn.addEventListener('click', () => {
    setSound(!soundOn());
    soundBtn.textContent = soundOn() ? 'SOUND ON' : 'SOUND OFF';
  });

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let phase: Phase = 'title';
  let notice = '';
  const loaded = load(storage);
  let campaign: Campaign = loaded.kind === 'ok' ? loaded.campaign : newCampaign(freshSeed());
  if (loaded.kind === 'corrupt') notice = `Your saved campaign could not be read (${loaded.reason}). A new one has been started.`;
  let mode: Mode = 'campaign';
  let shift: ShiftState = startShift({ mode: 'campaign', seed: campaign.seed, day: campaign.day, lost: campaign.lost });
  let minutes = shift.clock;
  let gaps = new Rng(deriveSeed(campaign.seed, 'gaps'));
  let tick: ReturnType<typeof setInterval> | undefined;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let z = 10;
  let slip: HTMLElement | null = null;
  const citations: HTMLElement[] = [];

  // ---------------------------------------------------------------------------
  // Documents
  // ---------------------------------------------------------------------------
  function doc(cls: string, x: number, y: number, ...content: (Node | string | null)[]): HTMLElement {
    const d = h('div', { class: `doc ${cls}`, style: `left:${x}px;top:${y}px;z-index:${++z}` }, ...content);
    d.addEventListener('pointerdown', (e) => {
      if (inspecting && (e.target as HTMLElement).closest('[data-field]')) return;
      e.preventDefault();
      d.style.zIndex = String(++z);
      const start = toStage(e.clientX, e.clientY);
      const ox = d.offsetLeft;
      const oy = d.offsetTop;
      cue('paper');
      d.classList.add('lifted');
      d.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const p = toStage(ev.clientX, ev.clientY);
        // Papers stay on the desk: they can hang off the left edge, but not go behind the console.
        const nx = Math.max(-d.offsetWidth * 0.4, Math.min(CONSOLE_LEFT - d.offsetWidth * 0.5, ox + p.x - start.x));
        const ny = Math.max(DESK_TOP - 60, Math.min(H - 60, oy + p.y - start.y));
        d.style.left = `${nx}px`;
        d.style.top = `${ny}px`;
        if (inspecting) drawLine();
      };
      const up = () => {
        d.classList.remove('lifted');
        d.removeEventListener('pointermove', move);
        d.removeEventListener('pointerup', up);
        d.removeEventListener('pointercancel', up);
      };
      d.addEventListener('pointermove', move);
      d.addEventListener('pointerup', up);
      d.addEventListener('pointercancel', up);
    });
    docsLayer.append(d);
    return d;
  }

  const f = (id: string, text: string, cls = '') => h('span', { class: `field ${cls}`, 'data-field': id }, text);

  /** Today's paperwork: only what today's orders need comes to the desk. */
  function layOutPaperwork(ref: Reference) {
    docsLayer.replaceChildren();
    const team = (id: string) => ref.roster.find((t) => t.id === id)?.name ?? id;
    const has = (...ids: string[]) => ids.some((id) => ref.rules.includes(id as never));
    const fresh = new Set(mode === 'campaign' ? newRules(ref.day).map((r) => r.id) : []);
    const expiry = has('expired');
    const roster = has('not-offworld', 'missing');
    const missions = has('wrong-leader', 'wrong-headcount', 'wrong-origin');
    doc('orders', 352, 452,
      h('div', { class: 'doc-title' }, 'Standing orders'),
      h('div', { class: 'doc-sub' }, mode === 'campaign' ? `Day ${ref.day} · ${ref.date}` : `Endless · ${ref.date}`),
      h('ol', {}, rulesById(ref.rules).map((r) => h('li', { class: fresh.has(r.id) ? 'new' : '' }, h('strong', {}, r.title), fresh.has(r.id) ? h('span', { class: 'new-tag' }, 'NEW') : null, ' ', r.briefing))),
    );
    doc('codes clipboard', 600, 438,
      h('div', { class: 'clip' }),
      h('div', { class: 'doc-title' }, 'Valid ID codes'),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Team'), expiry ? h('th', {}, 'Expires') : null)),
        h('tbody', {}, [...ref.codes].sort((a, b) => team(a.teamId).localeCompare(team(b.teamId))).map((c) =>
          h('tr', {}, h('td', {}, f(`codes.${c.code}.code`, c.code, 'mono')), h('td', {}, f(`codes.${c.code}.team`, team(c.teamId))), expiry ? h('td', {}, f(`codes.${c.code}.expires`, c.expires, 'mono')) : null),
        )),
      ),
    );
    if (roster) {
      doc('roster card', 860, 470,
        h('div', { class: 'doc-title' }, 'Team roster'),
        h('table', {}, h('tbody', {}, ref.roster.map((t) =>
          h('tr', { class: `st-${t.status}` }, h('td', {}, t.name), h('td', {}, f(`roster.${t.id}.status`, STATUS_LABEL[t.status])), h('td', { class: 'remark' }, t.remark ?? '')),
        ))),
      );
    }
    if (missions) {
      doc('missions binder', 950, 440,
        h('div', { class: 'rings' }, h('span', {}), h('span', {}), h('span', {})),
        h('div', { class: 'doc-title' }, 'Mission log'),
        h('div', { class: 'entries' }, ref.missions.map((m) =>
          h('div', { class: 'entry' },
            h('div', { class: 'entry-head' }, team(m.teamId).toUpperCase(), ' · ', f(`missions.${m.teamId}.destination`, m.destination, 'mono'), ' · party of ', f(`missions.${m.teamId}.size`, String(m.size))),
            h('div', {}, f(`missions.${m.teamId}.leader`, m.leader), h('span', { class: 'since' }, ` · out ${m.departed.slice(5)}`)),
          ),
        )),
      );
    }
    doc('bulletins memo', roster ? 1000 : 900, roster ? 690 : 480,
      h('div', { class: 'doc-title' }, 'Bulletins'),
      h('ul', {}, ref.bulletins.map((b) => {
        // The duress digit can be inspected against the terminal's auth digit.
        if (b.effect?.kind === 'duress') {
          const d = String(b.effect.digit);
          const i = b.text.indexOf(d);
          return h('li', { class: 'effect' }, h('span', { class: 'mono' }, b.time), ' ', b.text.slice(0, i), f('bulletin.duress', d), b.text.slice(i + d.length));
        }
        return h('li', { class: b.effect ? 'effect' : '' }, h('span', { class: 'mono' }, b.time), ' ', b.text);
      })),
    );
  }

  /** The printer feeds a slip out onto the desk. */
  function printSlip(cls: string, ...content: (Node | string | null)[]): HTMLElement {
    cue('print');
    const s = doc(`slip ${cls} printing`, 60, 640, ...content);
    setTimeout(() => s.classList.remove('printing'), 900);
    return s;
  }

  /** Mark the speaker, headcount and origin inside the transcript, so they can be inspected. */
  function transcript(v: Voice): Node[] {
    const marks: { text: string; id: string }[] = [
      { text: v.speaker, id: 'voice.speaker' },
      { text: v.origin, id: 'voice.origin' },
    ];
    let parts: (string | Node)[] = [v.text];
    for (const m of marks) {
      parts = parts.flatMap<string | Node>((p) => {
        if (typeof p !== 'string') return [p];
        const i = p.indexOf(m.text);
        return i < 0 ? [p] : [p.slice(0, i), f(m.id, m.text), p.slice(i + m.text.length)];
      });
    }
    // The headcount: a number standing on its own (not part of a world name like TL-4).
    parts = parts.flatMap<string | Node>((p) => {
      if (typeof p !== 'string') return [p];
      const m = new RegExp(`(^|[^-\\w])(${v.headcount})(?!\\w)`).exec(p);
      if (!m) return [p];
      const at = m.index + m[1]!.length;
      return [p.slice(0, at), f('voice.headcount', String(v.headcount)), p.slice(at + m[2]!.length)];
    });
    return parts.map((p) => (typeof p === 'string' ? document.createTextNode(p) : p));
  }

  // ---------------------------------------------------------------------------
  // The terminal
  // ---------------------------------------------------------------------------
  function screen(...lines: (Node | string)[][]) {
    crt.replaceChildren(...lines.map((l) => h('div', { class: 'crt-line' }, ...l)));
  }
  const idleScreen = () => screen([`${BASE_NAME.toUpperCase()}`], ['RING CONTROL 2'], [''], ['STATUS  NO SIGNAL'], ['', h('span', { class: 'cursor' }, '█')]);

  function showTransmission(a: Arrival) {
    const team = shift.ref.roster.find((t) => t.id === a.teamId)?.name ?? '???';
    screen(
      ['>> INCOMING TRANSMISSION'],
      [''],
      ['ID CODE  ', f('tx.code', a.code, 'crt-big')],
      ['TEAM     ', f('tx.team', team.toUpperCase())],
      ['SENT     ', f('tx.date', a.date), ` ${a.time}`],
      ...(shift.ref.rules.includes('duress') ? [['AUTH     ', f('tx.auth', String(a.auth))]] : []),
      ['VOICE    ', a.voice ? 'RECEIVED > PRINTER' : 'NONE'],
      [''],
      ['AWAITING DECISION ', h('span', { class: 'cursor' }, '█')],
    );
  }

  // ---------------------------------------------------------------------------
  // Inspection
  // ---------------------------------------------------------------------------
  let inspecting = false;
  let picked: HTMLElement | null = null;
  let pair: [HTMLElement, HTMLElement] | null = null;

  function setInspect(on: boolean) {
    inspecting = on;
    stage.classList.toggle('inspecting', on);
    inspectBtn.setAttribute('aria-pressed', String(on));
    picked?.classList.remove('picked');
    picked = null;
    clearFinding();
    if (on) showFinding('Pick two lines to compare.', 'hint');
    cue('click');
  }

  function clearFinding() {
    pair?.forEach((e) => e.classList.remove('picked'));
    pair = null;
    lineSvg.replaceChildren();
    finding.className = 'finding';
    finding.textContent = '';
  }

  function showFinding(text: string, kind: string) {
    finding.className = `finding show ${kind}`;
    finding.textContent = text;
  }

  function centre(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    return toStage(r.left + r.width / 2, r.top + r.height / 2);
  }

  function drawLine() {
    lineSvg.replaceChildren();
    if (!pair) return;
    const [a, b] = pair.map(centre) as [{ x: number; y: number }, { x: number; y: number }];
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    for (const [k, v] of Object.entries({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })) ln.setAttribute(k, String(v));
    lineSvg.append(ln);
  }

  stage.addEventListener('click', (e) => {
    if (!inspecting) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-field]');
    if (!el) return;
    cue('click');
    if (pair) clearFinding();
    if (!picked) {
      picked = el;
      el.classList.add('picked');
      showFinding('Now pick something to compare it with.', 'hint');
      return;
    }
    const first = picked;
    picked = null;
    pair = [first, el];
    el.classList.add('picked');
    drawLine();
    if (!shift.current) {
      showFinding('Nothing on the line to check yet.', 'unrelated');
      return;
    }
    const res = compare(first.dataset.field!, el.dataset.field!, shift.current, shift.ref);
    showFinding(res.result === 'mismatch' ? `DISCREPANCY. ${res.text}` : res.text, res.result);
    if (res.result === 'mismatch') cue('wrong');
  });

  inspectBtn.addEventListener('click', () => setInspect(!inspecting));

  // ---------------------------------------------------------------------------
  // The shift
  // ---------------------------------------------------------------------------
  function startDay() {
    gaps = new Rng(deriveSeed(shift.config.seed, `gaps-${mode}-${shift.config.day}`));
    minutes = shift.clock;
    lamps.forEach((l) => l.classList.remove('on'));
    citations.length = 0;
    layOutPaperwork(shift.ref);
    dateLine.textContent = shift.ref.date;
    dayPlate.textContent = mode === 'campaign' ? `DAY ${shift.config.day} OF ${MAX_DAY}` : 'ENDLESS';
    clockFace.textContent = clockText(minutes);
    clockFace.classList.remove('late');
    idleScreen();
    closeModal();
    clearInterval(tick);
    tick = setInterval(() => {
      if (phase === 'title' || phase === 'briefing' || phase === 'evening') return;
      minutes = mode === 'campaign' ? Math.min(SHIFT_END, minutes + 1) : minutes + 1;
      shift = setClock(shift, minutes);
      clockFace.textContent = clockText(minutes);
      clockFace.classList.toggle('late', mode === 'campaign' && minutes >= SHIFT_END - 30);
    }, MINUTE_MS);
    waitForNext(3);
  }

  function waitForNext(seconds?: number) {
    phase = 'idle';
    setControls(false);
    idleScreen();
    voiceLamp.classList.remove('on');
    clearTimeout(pending);
    pending = setTimeout(() => {
      if (mode === 'campaign' && minutes >= SHIFT_END) return endDay();
      shift = callNext(setClock(shift, minutes));
      if (!shift.current) return endDay();
      incoming(shift.current);
    }, ((seconds ?? gaps.int(5, 12)) * 1000) / SPEED);
  }

  function incoming(a: Arrival) {
    phase = 'incoming';
    screen(['>> INCOMING WORMHOLE'], [''], ['LOCKING...']);
    void gate.incoming(originOf(a), () => {
      showTransmission(a);
      phase = 'deciding';
      setControls(true);
      if (a.voice) {
        cue('radio');
        voiceLamp.classList.add('on');
        const v = a.voice;
        setTimeout(() => {
          if (shift.current !== a) return;
          slip = printSlip('transcript', h('div', { class: 'slip-head' }, `VOICE · ${a.time}`), h('p', {}, ...transcript(v)));
        }, 700);
      }
    });
  }

  function setControls(on: boolean) {
    lever.disabled = !on;
    refuse.disabled = !on;
  }

  function call(decision: 'open' | 'close') {
    if (phase !== 'deciding' || !shift.current) return;
    phase = 'feedback';
    setControls(false);
    if (inspecting) setInspect(false);
    const a = shift.current;
    const name = shift.ref.roster.find((t) => t.id === a.teamId)?.name ?? '???';
    const out = decide(shift, decision);
    shift = out.state;
    const r = out.result;
    if (decision === 'open') {
      lever.classList.add('pulled');
      cue('lever');
      setTimeout(() => {
        cue('open');
        void gate.openIris();
      }, 250);
    } else {
      refuse.classList.add('pressed');
      cue('clank');
    }
    setTimeout(() => {
      if (r.outcome === 'hostile-admitted') {
        cue('alarm');
        gate.flash('bad');
        alarmLight.classList.add('on');
        lamps[shift.hostilesAdmitted - 1]?.classList.add('on');
        screen(['!! HOSTILE CONTACT !!'], [''], ['SECURITY TO THE GATE ROOM']);
      } else if (decision === 'open') {
        screen([`IRIS OPEN`], [''], [`TEAM ${name.toUpperCase()} ADMITTED`]);
      } else {
        if (r.outcome === 'friendly-lost') gate.impact();
        screen(['CONNECTION REFUSED'], [''], ['IRIS HELD SHUT']);
      }
      if (!r.correct) setTimeout(() => citation(r, name), 900);
    }, decision === 'open' ? 900 : 300);
    setTimeout(async () => {
      lever.classList.remove('pulled');
      refuse.classList.remove('pressed');
      alarmLight.classList.remove('on');
      if (decision === 'open') {
        cue('close');
        await gate.closeIris();
      }
      cue('collapse');
      await gate.collapse();
      slip?.remove();
      slip = null;
      if (shift.status === 'overrun') return endDay();
      waitForNext();
    }, 4200);
  }

  function citation(r: CallResult, name: string) {
    const n = citations.length + 1;
    const what = r.outcome === 'hostile-admitted' ? `Opened the iris for a hostile claiming to be ${name}.` : `Kept the iris shut on ${name}, a genuine team. They are lost.`;
    const why = r.reason ?? 'Everything about them checked out.';
    // Matches shiftPay: the first two citations are warnings; a breach is always docked.
    const breach = r.outcome === 'hostile-admitted' ? ` ${HOSTILE_FINE} chits docked for the breach.` : '';
    const warn = n <= FREE_CITATIONS ? `Warning ${n} of ${FREE_CITATIONS}.${breach || ' No penalty.'}` : `${CITATION_FINE} chits docked.${breach}`;
    citations.push(printSlip('citation', h('div', { class: 'slip-head' }, `CITATION · ${r.arrival.time}`), h('p', {}, what), h('p', { class: 'why' }, why), h('p', { class: 'warn' }, warn)));
  }

  lever.addEventListener('click', () => call('open'));
  refuse.addEventListener('click', () => call('close'));
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === 'o') call('open');
    else if (k === 'c') call('close');
    else if (k === 'i' && (phase === 'deciding' || phase === 'idle' || phase === 'incoming')) setInspect(!inspecting);
    else if (k === 'escape' && inspecting) setInspect(false);
  });

  // ---------------------------------------------------------------------------
  // Paper screens: title, briefing, evening
  // ---------------------------------------------------------------------------
  function openModal(...content: (Node | null)[]) {
    modal.replaceChildren(h('div', { class: 'modal-paper' }, ...content));
    modal.classList.add('show');
  }
  function closeModal() {
    modal.classList.remove('show');
    modal.replaceChildren();
  }

  function title() {
    phase = 'title';
    idleScreen();
    docsLayer.replaceChildren();
    const over = campaign.status !== 'active';
    const started = campaign.day > 1 || campaign.reports.length > 0;
    const seedInput = h('input', { class: 'seed-input', placeholder: 'any word', maxlength: 30, 'aria-label': 'Endless seed' }) as HTMLInputElement;
    let armed = false;
    const fresh = h('button', { class: 'paper-btn quiet' }, started ? 'New campaign' : 'Start');
    fresh.addEventListener('click', () => {
      if (started && !over && !armed) {
        armed = true;
        fresh.textContent = 'Click again: lose this campaign';
        return;
      }
      campaign = newCampaign(freshSeed(), campaign.endlessBest);
      save(storage, campaign);
      briefing('campaign');
    });
    openModal(
      h('div', { class: 'stamp-title' }, 'SHUTTER DUTY'),
      h('p', { class: 'typed' }, `${BASE_NAME}. Second ring site of the Survey. You are the ring attendant on the day shift.`),
      h('p', { class: 'typed' }, 'Teams coming home send an ID code, and sometimes a voice. Check them against the paperwork. Open the iris for your own people. Keep it shut on everyone else.'),
      notice ? h('p', { class: 'typed warn' }, notice) : null,
      over ? h('p', { class: 'typed' }, campaign.status === 'complete' ? 'Your seven days are done.' : 'You were evicted. The campaign is over.') : null,
      h('div', { class: 'modal-buttons' },
        !over && started ? h('button', { class: 'paper-btn', onclick: () => briefing('campaign') }, `Continue: day ${campaign.day}`) : null,
        over ? h('button', { class: 'paper-btn', onclick: () => finale() }, 'Read how it ended') : null,
        !started && !over ? null : fresh,
        !started && !over ? h('button', { class: 'paper-btn', onclick: () => briefing('campaign') }, 'Report for duty') : null,
      ),
      h('div', { class: 'endless-row' },
        h('strong', {}, 'Endless shift. '),
        'Every order at once, no closing time, until the base is overrun. ',
        campaign.endlessBest ? h('span', {}, `Best: ${campaign.endlessBest.score} correct (seed "${campaign.endlessBest.seed}"). `) : null,
        h('label', {}, 'Seed ', seedInput),
        h('button', { class: 'paper-btn small', onclick: () => briefing('endless', seedInput.value.trim() || freshSeed()) }, 'Start endless'),
      ),
    );
  }

  function briefing(m: Mode, endlessSeed?: string) {
    phase = 'briefing';
    tryLandscape();
    mode = m;
    shift = m === 'campaign'
      ? startShift({ mode: 'campaign', seed: campaign.seed, day: campaign.day, lost: campaign.lost })
      : startShift({ mode: 'endless', seed: endlessSeed ?? freshSeed(), day: MAX_DAY, lost: [] });
    const ref = shift.ref;
    const fresh = m === 'campaign' ? newRules(ref.day) : [];
    openModal(
      h('div', { class: 'memo-head' }, m === 'campaign' ? `MEMO · DAY ${ref.day} OF ${MAX_DAY} · ${ref.date}` : `ENDLESS SHIFT · SEED "${shift.config.seed}"`),
      m === 'campaign' ? h('p', { class: 'typed note' }, DAY_NOTES[ref.day] ?? '', h('span', { class: 'signed' }, ` ${SUPERVISOR}`)) : h('p', { class: 'typed' }, 'Every order is in force. The shift does not end at 18:00: it ends when the base is overrun. Score: correct calls.'),
      fresh.length ? h('div', { class: 'new-orders' }, h('div', { class: 'new-head' }, 'New today'), fresh.map((r) => h('p', {}, h('strong', {}, `${r.title}. `), r.briefing))) : null,
      ref.day === 1 && m === 'campaign'
        ? h('ul', { class: 'typed how' },
            h('li', {}, `The shift runs 08:00 to 18:00. Each correct call earns ${WAGE} chits. Mistakes earn citations: two warnings, then ${CITATION_FINE} chits docked each; opening for a hostile always costs ${HOSTILE_FINE}.`),
            h('li', {}, 'The terminal shows each ID code. Drag the paperwork about to check it.'),
            h('li', {}, 'INSPECT (or I): pick two lines and they are compared for you.'),
            h('li', {}, 'Pull the IRIS lever (O) to let them through. KEEP SHUT (C) to refuse.'),
          )
        : null,
      h('div', { class: 'modal-buttons' }, h('button', { class: 'paper-btn', onclick: startDay }, 'Begin the shift'), h('button', { class: 'paper-btn quiet', onclick: title }, 'Back')),
    );
  }

  function endDay() {
    phase = 'evening';
    clearTimeout(pending);
    clearInterval(tick);
    setControls(false);
    if (inspecting) setInspect(false);
    if (mode === 'endless') return endEndless();
    const overrun = shift.status === 'overrun';
    const household = campaign.household;
    const list = bills(household, campaign.day);
    const chosen = new Set<BillId>(list.filter((b) => !b.required).map((b) => b.id));
    // A dry run of the night for the ledger total.
    const preview = () => closeDay(campaign, shift, [...chosen]);
    const pay = preview().pay;
    const totalLine = h('div', { class: 'ledger-total' });
    const refresh = () => {
      const left = preview().night.household.savings;
      totalLine.textContent = `Left over: ${left} chits`;
      totalLine.classList.toggle('neg', left < 0);
    };
    openModal(
      h('div', { class: 'memo-head' }, overrun ? `RELIEVED OF DUTY · DAY ${campaign.day}` : `END OF SHIFT · DAY ${campaign.day} · ${clockText(Math.min(minutes, SHIFT_END))}`),
      overrun ? h('p', { class: 'typed warn' }, `${HOSTILE_LIMIT} hostiles came through your gate. Security has taken over the desk. No pay today, and you will work this day again.`) : null,
      h('table', { class: 'ledger' },
        h('tbody', {},
          h('tr', {}, h('td', {}, `Correct calls (${pay.correct} × ${WAGE})`), h('td', {}, `+${pay.wages}`)),
          h('tr', {}, h('td', {}, `Citations: ${pay.citations}`), h('td', {}, pay.fines ? `−${pay.fines}` : '0')),
          h('tr', {}, h('td', {}, 'Savings'), h('td', {}, String(household.savings))),
          list.map((b) => {
            const box = h('input', { type: 'checkbox', checked: true, disabled: b.required }) as HTMLInputElement;
            box.addEventListener('change', () => {
              if (box.checked) chosen.add(b.id);
              else chosen.delete(b.id);
              refresh();
            });
            return h('tr', { class: 'bill' }, h('td', {}, h('label', {}, box, ` ${b.label}${b.required ? ' (due)' : ''}`)), h('td', {}, `−${b.cost}`));
          }),
        ),
      ),
      totalLine,
      h('div', { class: 'household' }, household.people.map((p) => h('div', { class: `person ${p.condition}` }, h('strong', {}, p.name), ` ${p.relation}: `, p.condition))),
      h('div', { class: 'modal-buttons' }, h('button', {
        class: 'paper-btn',
        onclick: () => {
          const end = closeDay(campaign, shift, [...chosen]);
          campaign = end.campaign;
          save(storage, campaign);
          morning(end.night.morning);
        },
      }, 'Go home')),
    );
    refresh();
  }

  function morning(lines: string[]) {
    const over = campaign.status !== 'active';
    openModal(
      h('div', { class: 'memo-head' }, 'NEXT MORNING'),
      lines.length ? h('ul', { class: 'typed' }, lines.map((l) => h('li', {}, l))) : h('p', { class: 'typed' }, 'A quiet night. Everyone slept.'),
      h('p', { class: 'typed' }, `Savings: ${campaign.household.savings} chits.`),
      h('div', { class: 'modal-buttons' },
        over ? h('button', { class: 'paper-btn', onclick: finale }, 'Turn the page') : h('button', { class: 'paper-btn', onclick: () => briefing('campaign') }, `To work: day ${campaign.day}`),
        h('button', { class: 'paper-btn quiet', onclick: title }, 'Title page'),
      ),
    );
  }

  function finale() {
    openModal(
      h('div', { class: 'memo-head' }, campaign.status === 'evicted' ? 'EVICTED' : 'SEVEN DAYS ON THE IRIS'),
      h('ul', { class: 'typed' }, epilogue(campaign).map((l) => h('li', {}, l))),
      h('div', { class: 'modal-buttons' }, h('button', { class: 'paper-btn', onclick: title }, 'Title page')),
    );
  }

  function endEndless() {
    campaign = recordEndless(campaign, shift);
    save(storage, campaign);
    const score = shift.results.filter((r) => r.correct).length;
    openModal(
      h('div', { class: 'memo-head' }, 'ENDLESS SHIFT OVER'),
      h('p', { class: 'typed' }, `The base was overrun at ${clockText(minutes)}, after ${shift.results.length} arrivals.`),
      h('p', { class: 'typed' }, `Correct calls: ${score}. Best: ${campaign.endlessBest?.score ?? score} (seed "${campaign.endlessBest?.seed ?? shift.config.seed}").`),
      h('div', { class: 'modal-buttons' },
        h('button', { class: 'paper-btn', onclick: () => briefing('endless', shift.config.seed) }, 'Same seed again'),
        h('button', { class: 'paper-btn quiet', onclick: title }, 'Title page'),
      ),
    );
  }

  /** On phones, ask for fullscreen landscape (works on Android; iPhones show the rotate note instead). */
  function tryLandscape() {
    if (!window.matchMedia?.('(pointer: coarse)').matches) return;
    const el = document.documentElement;
    const orientation = window.screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    el.requestFullscreen?.()
      .then(() => orientation.lock?.('landscape'))
      .catch(() => {
        /* not allowed here: the rotate note covers it */
      });
  }

  setControls(false);
  title();
}

/** A child's crayon drawing of the gate, taped to the wall. */
function drawing(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 80');
  svg.setAttribute('class', 'drawing-art');
  svg.innerHTML = `
    <circle cx="50" cy="38" r="26" fill="none" stroke="#3a6fd8" stroke-width="5" stroke-linecap="round" stroke-dasharray="14 3 18 2 22 4"/>
    <circle cx="50" cy="38" r="17" fill="#7ec4ff" opacity="0.7"/>
    <path d="M12 74 L88 74" stroke="#4f9a4a" stroke-width="4" stroke-linecap="round"/>
    <path d="M20 74 l0 -10 m-4 4 l4 -4 l4 4 M80 74 l0 -12 m-5 5 l5 -5 l5 5" stroke="#d8603a" stroke-width="3" fill="none" stroke-linecap="round"/>
    <circle cx="86" cy="10" r="6" fill="#f5c542"/>`;
  return svg;
}
