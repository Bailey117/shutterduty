/**
 * Content. All names are original to this game.
 *
 * The base is Brackwater Annex, the second ring site of an organisation that
 * calls itself the Survey. The main site is only ever "Primary".
 */

export const BASE_NAME = 'Brackwater Annex';

/** Team callsigns. A campaign draws its teams from these. */
export const CALLSIGNS = [
  'Ashgrove', 'Marrow', 'Fennick', 'Corvel', 'Tallis', 'Quillon', 'Harrowgate', 'Vesper',
  'Oakhollow', 'Saltmarsh', 'Larkspur', 'Wendle', 'Copperfield', 'Dunlin', 'Rookhaven', 'Sable',
] as const;

export const TEAMS_PER_CAMPAIGN = 10;

/** Characters used in ID codes: no 0/O, 1/I, 5/S, 2/Z, 8/B lookalikes. */
export const CODE_CHARS = 'ACDEFHJKLMNPRTVWXY34679';

/** First day of the campaign. Day N is this date plus N-1 days. */
export const START_DATE = '2231-06-12';

/** Shift start, in minutes after midnight (08:00). */
export const SHIFT_START = 8 * 60;

export const FLAVOUR_BULLETINS = [
  'Ring diagnostics nominal. Report any flicker in the outer band.',
  'Primary reminds all sites: iris tests at the start of every shift.',
  'Canteen closed 12:00-13:00 for decontamination.',
  'Medical asks returning teams to report for screening within the hour.',
  'Power draw on the ring is up 4% this week. Engineering is aware.',
  'Archive requests all transmissions logged verbatim. No corrections.',
  'Night watch reports a short incoming signal at 03:12. No code was sent.',
];

/**
 * The story, told only through the paperwork. It follows the campaign's
 * first team (the "story team"): overdue, then missing, then a voice on the
 * ring using their code, then a code series that should not exist, then a
 * tangle of orders about whether they are alive.
 *
 * {team} is the story team's callsign.
 */
export interface StoryBeat {
  status: 'offworld' | 'overdue' | 'missing';
  remark?: string;
  bulletins: { time: string; text: string; effect?: 'recall' | 'cancel-recall' }[];
  /** An arrival from the story team (or about it) this day. */
  arrival?: 'team-calls' | 'dead-series' | 'team-returns';
}

export const STORY: Record<number, StoryBeat> = {
  1: { status: 'offworld', remark: 'Due back today', bulletins: [{ time: '06:30', text: 'Team {team} is due home today on the survey of site KR-9.' }] },
  2: { status: 'overdue', remark: 'Overdue 1 day', bulletins: [{ time: '06:15', text: 'Team {team} has not reported in. Their code stays on the list for now.' }] },
  3: { status: 'overdue', remark: 'Overdue 2 days', bulletins: [{ time: '06:20', text: 'Still nothing from {team}. A relay at KR-9 picked up the ring opening at their end, twice, with no transmission.' }] },
  4: { status: 'missing', remark: 'Posted missing', bulletins: [{ time: '06:05', text: 'Team {team} is posted missing. Do not open for their code until further notice.' }] },
  5: {
    status: 'missing',
    remark: 'Posted missing',
    bulletins: [{ time: '06:10', text: 'If {team}\'s code comes through, refuse and log it. Do not answer on voice.' }],
    arrival: 'team-calls',
  },
  6: {
    status: 'missing',
    remark: 'Posted missing',
    bulletins: [{ time: '06:25', text: 'The Q-series of codes was withdrawn before this base opened. Nobody should hold one. Log any you see.' }],
    arrival: 'dead-series',
  },
  7: {
    status: 'overdue',
    remark: 'Located, returning',
    bulletins: [
      { time: '06:02', text: 'Recall order: {team} is to be refused on sight.', effect: 'recall' },
      { time: '07:48', text: 'Primary overrides the 06:02 order. {team} has been found alive at KR-9. Admit them on a valid code.', effect: 'cancel-recall' },
    ],
    arrival: 'team-returns',
  },
};

/** Ranks and names for team leaders (mission logs, voice transmissions). */
export const RANKS = ['Lt.', 'Capt.', 'Sgt.', 'Dr.', 'Maj.'] as const;
export const LEADER_FIRST = ['Mara', 'Tobias', 'Ines', 'Callum', 'Hedda', 'Ravi', 'Oona', 'Kasimir', 'Lidia', 'Emeric', 'Saoirse', 'Joachim', 'Petra', 'Yusuf', 'Wilhelmina', 'Anders'] as const;
export const LEADER_LAST = ['Venn', 'Oduya', 'Halloran', 'Strand', 'Keszler', 'Mbatha', 'Rourke', 'Lindgren', 'Abara', 'Coulter', 'Vasquez', 'Thibault', 'Ndiaye', 'Pell', 'Marchetti', 'Ojukwu'] as const;

/** World designations a mission can be sent to. */
export const WORLDS = ['KR-9', 'TL-4', 'VO-2', 'MN-7', 'ES-3', 'HD-6', 'RW-1', 'PX-8', 'CA-5', 'DU-9', 'LY-2', 'SB-4'] as const;

/** The story team's mission (it matches the bulletins). */
export const STORY_WORLD = 'KR-9';

/**
 * Voice transmission templates. {speaker}, {team}, {count}, {origin}.
 * They read like a tired radio call, not a form.
 */
export const VOICE_LINES = [
  'Brackwater, this is {speaker}, {team} lead. {count} of us coming home from {origin}. Requesting the iris.',
  'Annex, {team} calling. {speaker} speaking. We are {count} strong, out of {origin}, and we would very much like to come home.',
  '{speaker} for {team}. Dialled in from {origin}, {count} souls. Open up when you are ready, Brackwater.',
  'Brackwater Annex, {team}, {count} to come through. This is {speaker}. Origin {origin}. Over.',
];
