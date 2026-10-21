/**
 * The 24 glyphs of the ring network. Identity and names only; the SVG
 * artwork lives in src/ring/glyphArt.ts.
 */

export const GLYPH_IDS = [
  'cairn', 'weir', 'spindle', 'lantern', 'crest', 'thorn',
  'hollow', 'tide', 'loom', 'keel', 'gyre', 'fork',
  'mantle', 'shard', 'bloom', 'tether', 'beacon', 'ridge',
  'span', 'seed', 'hearth', 'knot', 'step', 'vane',
] as const;

export type GlyphId = (typeof GLYPH_IDS)[number];

export const GLYPH_COUNT = GLYPH_IDS.length;

const GLYPH_SET: ReadonlySet<string> = new Set(GLYPH_IDS);

export function isGlyphId(value: string): value is GlyphId {
  return GLYPH_SET.has(value);
}

export function glyphName(id: GlyphId): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * Address grammar: the 24 glyphs form six families of four. Every ordinary
 * address uses exactly one glyph from each family, in any order. The 7-glyph
 * final address uses one from each family plus one more, so exactly one
 * family appears twice.
 */
export const FAMILIES = [
  { id: 'stone', name: 'Stone', glyphs: ['cairn', 'ridge', 'step', 'shard'] },
  { id: 'water', name: 'Water', glyphs: ['weir', 'tide', 'keel', 'span'] },
  { id: 'growth', name: 'Growth', glyphs: ['seed', 'bloom', 'fork', 'thorn'] },
  { id: 'sky', name: 'Sky', glyphs: ['crest', 'beacon', 'gyre', 'vane'] },
  { id: 'hearth', name: 'Hearth', glyphs: ['hearth', 'lantern', 'mantle', 'hollow'] },
  { id: 'weave', name: 'Weave', glyphs: ['loom', 'knot', 'tether', 'spindle'] },
] as const satisfies readonly { id: string; name: string; glyphs: readonly GlyphId[] }[];

export type FamilyId = (typeof FAMILIES)[number]['id'];

const FAMILY_OF = new Map<GlyphId, FamilyId>(FAMILIES.flatMap((f) => f.glyphs.map((g) => [g as GlyphId, f.id] as const)));

export function familyOf(g: GlyphId): FamilyId {
  return FAMILY_OF.get(g)!;
}
