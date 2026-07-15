// Player skin registry: every visual component of a soldier is picked
// independently. Shared by client (rendering, picker) and server
// (validation, bot outfits). Easter-egg skins stay locked to their names;
// future skins can gate on lifetime kills via `milestoneKills`.

export type SkinComponent = 'torso' | 'helmet' | 'legs' | 'pack' | 'gun';

export interface Equip {
  torso: string;
  helmet: string;
  legs: string;
  pack: string;
}

export interface SkinDef {
  id: string;
  kind: SkinComponent;
  name: string;
  // base camo index (0..11), or a special paint the renderer understands
  paint: number | 'pink' | 'silver' | 'gold' | 'floral' | string;
  lockedTo?: string[];       // case-insensitive name substrings that may wear it
  milestoneKills?: number;   // future: lifetime kills required to unlock
}

const CAMO_NAMES = [
  'WOODLAND', 'DESERT', 'NIGHT OPS', 'URBAN', 'JUNGLE', 'ARID',
  'TAIGA', 'ASH', 'BRUSH', 'DUSK', 'STEPPE', 'MARSH',
];

// parametric recolors — [hue, sat, light] fed to the camo generator
export const RECOLOR_PAINTS: Record<string, [number, number, number]> = {
  ember: [18, 65, 34],
  frost: [205, 45, 52],
  jade: [150, 55, 30],
  royal: [268, 50, 36],
};

function camoSet(kind: SkinComponent, prefix: string): SkinDef[] {
  const out: SkinDef[] = CAMO_NAMES.map((name, i) => ({
    id: `${prefix}${i}`, kind, name, paint: i,
  }));
  for (const [key] of Object.entries(RECOLOR_PAINTS)) {
    out.push({ id: `${prefix}_${key}`, kind, name: key.toUpperCase(), paint: key });
  }
  return out;
}

const LOCK_SILVER = ['mutant', 'smock', 'mk47'];
const LOCK_PINK = ['darken'];

export const SKINS: SkinDef[] = [
  ...camoSet('torso', 't'),
  { id: 'tp', kind: 'torso', name: 'HOT PINK', paint: 'pink', lockedTo: LOCK_PINK },
  { id: 'ts', kind: 'torso', name: 'CHROME', paint: 'silver', lockedTo: LOCK_SILVER },
  ...camoSet('legs', 'l'),
  { id: 'lp', kind: 'legs', name: 'HOT PINK', paint: 'pink', lockedTo: LOCK_PINK },
  { id: 'ls', kind: 'legs', name: 'CHROME', paint: 'silver', lockedTo: LOCK_SILVER },
  ...camoSet('pack', 'p'),
  { id: 'pp', kind: 'pack', name: 'HOT PINK', paint: 'pink', lockedTo: LOCK_PINK },
  ...camoSet('helmet', 'h'),
  { id: 'hg', kind: 'helmet', name: 'GOLD', paint: 'gold', lockedTo: ['tankarama'] },
  { id: 'hf', kind: 'helmet', name: 'FLORAL HAT', paint: 'floral', lockedTo: ['tedgey'] },
  { id: 'hs', kind: 'helmet', name: 'CHROME', paint: 'silver', lockedTo: LOCK_SILVER },
];

const BY_ID = new Map(SKINS.map((s) => [s.id, s]));

export function skinById(id: string): SkinDef | undefined {
  return BY_ID.get(id);
}

export function skinAllowed(def: SkinDef, playerName: string, lifetimeKills = 0): boolean {
  if (def.lockedTo && !def.lockedTo.some((t) => playerName.toLowerCase().includes(t))) return false;
  if (def.milestoneKills && lifetimeKills < def.milestoneKills) return false;
  return true;
}

export function skinsFor(kind: SkinComponent, playerName: string, lifetimeKills = 0): SkinDef[] {
  return SKINS.filter((s) => s.kind === kind && skinAllowed(s, playerName, lifetimeKills));
}

// the outfit a name wears when it never picked anything — the historical
// name-hash camo, plus the easter-egg pieces those names always wore
export function defaultEquip(name: string): Equip {
  const lower = name.toLowerCase();
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const camo = h % 12;
  const eq: Equip = { torso: `t${camo}`, helmet: `h${camo}`, legs: `l${camo}`, pack: `p${camo}` };
  if (LOCK_PINK.some((t) => lower.includes(t))) {
    eq.torso = 'tp'; eq.legs = 'lp'; eq.pack = 'pp';
  }
  if (LOCK_SILVER.some((t) => lower.includes(t))) {
    eq.torso = 'ts'; eq.legs = 'ls'; eq.helmet = 'hs';
  }
  if (lower.includes('tankarama')) eq.helmet = 'hg';
  if (lower.includes('tedgey')) eq.helmet = 'hf';
  return eq;
}

// sanitize an equip request: unknown, wrong-kind, or locked picks fall back
export function validateEquip(raw: unknown, playerName: string, lifetimeKills = 0): Equip {
  const def = defaultEquip(playerName);
  if (typeof raw !== 'object' || raw === null) return def;
  const r = raw as Record<string, unknown>;
  const pick = (field: keyof Equip, kind: SkinComponent): string => {
    const id = r[field];
    if (typeof id !== 'string') return def[field];
    const s = BY_ID.get(id);
    return s && s.kind === kind && skinAllowed(s, playerName, lifetimeKills) ? id : def[field];
  };
  return {
    torso: pick('torso', 'torso'),
    helmet: pick('helmet', 'helmet'),
    legs: pick('legs', 'legs'),
    pack: pick('pack', 'pack'),
  };
}
