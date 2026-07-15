import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Equip } from '../shared/skins.ts';

// Persisted wardrobe for reserved callsigns: what they equipped last, and
// lifetime kills for future milestone unlocks. The manager process is the
// only writer (rooms report over IPC); rooms read with an mtime cache.

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(import.meta.dirname, '../../data');
const FILE = path.join(DATA_DIR, 'skins.json');

export interface SavedSkins {
  equip?: Equip;
  kills: number;
}

type Store = Record<string, SavedSkins>;

let cache: Store = {};
let cachedMtime = -2;

function load(): Store {
  try {
    const mt = statSync(FILE).mtimeMs;
    if (mt !== cachedMtime) {
      cache = JSON.parse(readFileSync(FILE, 'utf8')) as Store;
      cachedMtime = mt;
    }
  } catch {
    cache = {};
    cachedMtime = -1;
  }
  return cache;
}

function save(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(cache, null, 1));
  try {
    cachedMtime = statSync(FILE).mtimeMs;
  } catch { /* next load() re-reads */ }
}

export function savedSkins(name: string): SavedSkins | undefined {
  return load()[name.trim().toLowerCase()];
}

// manager-side writers
export function storeEquip(nameLc: string, equip: Equip): void {
  const s = load();
  s[nameLc] = { ...(s[nameLc] ?? { kills: 0 }), equip };
  save();
}

export function addKills(nameLc: string, kills: number): void {
  if (kills <= 0) return;
  const s = load();
  s[nameLc] = { ...(s[nameLc] ?? { kills: 0 }), kills: (s[nameLc]?.kills ?? 0) + kills };
  save();
}
