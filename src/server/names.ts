import { createHash, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Host-wide reserved callsigns. The manager process writes reservations via
// its HTTP endpoints; every room process re-reads the file (mtime-cached) to
// enforce them at join time. Passwords are 8 lowercase letters/digits and
// only their salted hashes are stored.

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(import.meta.dirname, '../../data');
const FILE = path.join(DATA_DIR, 'names.json');

type Book = Record<string, { hash: string; created: number }>;

let cache: Book = {};
let cachedMtime = -2;

function load(): Book {
  try {
    const mt = statSync(FILE).mtimeMs;
    if (mt !== cachedMtime) {
      cache = JSON.parse(readFileSync(FILE, 'utf8')) as Book;
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

function hashPw(name: string, pw: string): string {
  return createHash('sha256').update(`${name.trim().toLowerCase()}:${pw}`).digest('hex');
}

// a name is usable when it is unreserved, or the caller holds its password
export function nameUsable(name: string, pw?: string): boolean {
  const entry = load()[name.trim().toLowerCase()];
  if (!entry) return true;
  return typeof pw === 'string' && hashPw(name, pw) === entry.hash;
}

export function isReserved(name: string): boolean {
  return !!load()[name.trim().toLowerCase()];
}

// returns the fresh password, or null if the name is already taken
export function reserveName(name: string): string | null {
  const lc = name.trim().toLowerCase();
  if (!lc || load()[lc]) return null;
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let pw = '';
  for (let i = 0; i < 8; i++) pw += alphabet[randomInt(alphabet.length)];
  cache[lc] = { hash: hashPw(name, pw), created: Date.now() };
  save();
  return pw;
}

// frees the name for anyone to reserve again; password required
export function deleteName(name: string, pw: string): boolean {
  const lc = name.trim().toLowerCase();
  const entry = load()[lc];
  if (!entry || hashPw(name, pw) !== entry.hash) return false;
  delete cache[lc];
  save();
  return true;
}
