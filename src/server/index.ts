import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { serveStatic } from './static.ts';
import { deleteName, isReserved, reserveName } from './names.ts';
import { addKills, storeEquip } from './skinstore.ts';
import type { Equip } from '../shared/skins.ts';

// Lobby / room manager. Each game room runs in its own forked process (one
// core each); this process serves the client, exposes the server browser at
// /servers, transparently proxies WebSocket upgrades to the chosen room, and
// auto-sizes the fleet: there is always one untouched room with 8 bots, one
// with 4 and one empty. A human joining any of them "uses it up", so a fresh
// one of that tier is spawned.

const port = Number(process.env.PORT) || 8090;
const TIERS = [8, 4, 0];
const MAX_ROOMS = 12;
const EMPTY_TTL_MS = 30_000;      // surplus human-free rooms linger this long

const HEROES = [
  'Ripley', 'McClane', 'Sarah Connor', 'Furiosa', 'Indiana', 'Trinity',
  'Maximus', 'Leia', 'Aragorn', 'Rocky', 'Kirk', 'Wolverine', 'Katniss',
  'MacGyver', 'Xena', 'Neo', 'Marty McFly', 'Han Solo', 'Hermione', 'Blade',
];

interface RoomStatus {
  ghosts: number;          // disconnected players whose round score is held here
  humans: number;
  bots: number;
  players: number;
  max: number;
  map: string;
  roundSecs: number;
  full: boolean;
}

interface Room {
  id: string;
  name: string;
  botTarget: number;
  proc: ChildProcess;
  port: number;            // 0 until the child reports ready
  status: RoomStatus | null;
  emptySince: number;      // when humans last dropped to 0; 0 while occupied
}

const rooms = new Map<string, Room>();
let nextRoomId = 1;

function pickName(): string {
  const used = new Set([...rooms.values()].map((r) => r.name));
  const free = HEROES.filter((h) => !used.has(h));
  const pool = free.length > 0 ? free : HEROES;
  return pool[Math.floor(Math.random() * pool.length)];
}

function spawnRoom(botTarget: number): Room {
  const id = String(nextRoomId++);
  const name = pickName();
  const proc = fork(path.resolve(import.meta.dirname, 'room.ts'), [], {
    env: { ...process.env, SERVER_NAME: name, BOTS: String(botTarget), PORT: '' },
  });
  const room: Room = { id, name, botTarget, proc, port: 0, status: null, emptySince: Date.now() };
  proc.on('message', (msg: { t?: string; port?: number; name?: string; equip?: Equip; kills?: number } & Partial<RoomStatus>) => {
    if (msg.t === 'ready' && msg.port) room.port = msg.port;
    else if (msg.t === 'equip' && msg.name && msg.equip) storeEquip(msg.name, msg.equip);
    else if (msg.t === 'progress' && msg.name) addKills(msg.name, msg.kills ?? 0);
    else if (msg.t === 'status') {
      room.status = msg as unknown as RoomStatus;
      if (room.status.humans > 0) room.emptySince = 0;
      else if (room.emptySince === 0) room.emptySince = Date.now();
    }
  });
  proc.on('exit', (code) => {
    rooms.delete(id);
    console.log(`[fleet] room ${name} exited (${code ?? 'signal'}) — ${rooms.size} rooms`);
  });
  rooms.set(id, room);
  console.log(`[fleet] spawned room ${name} (#${id}, ${botTarget} bots) — ${rooms.size} rooms`);
  return room;
}

// ranking for the browser: humans are worth 10, bots 1, a full room sinks
function points(r: Room): number {
  const s = r.status;
  if (!s) return -1;
  if (s.full) return -1000;
  return s.humans * 10 + s.bots;
}

function ranked(): Room[] {
  return [...rooms.values()].filter((r) => r.port > 0).sort((a, b) => points(b) - points(a));
}

// the standing fleet rule: one untouched room per tier, nothing wasteful
function autosize(): void {
  for (const tier of TIERS) {
    const fresh = [...rooms.values()].some((r) =>
      r.botTarget === tier && (r.status?.humans ?? 0) === 0 && !r.proc.killed);
    if (!fresh && rooms.size < MAX_ROOMS) spawnRoom(tier);
  }
  // retire surplus human-free rooms. The keeper is the one holding ghost
  // scores (players who dropped mid-round and may come back for them) —
  // the freshly spawned untouched duplicate is the one that dies.
  const now = Date.now();
  for (const tier of TIERS) {
    const empties = [...rooms.values()]
      .filter((r) => r.botTarget === tier && (r.status?.humans ?? 0) === 0)
      .sort((a, b) =>
        (b.status?.ghosts ?? 0) - (a.status?.ghosts ?? 0) || Number(a.id) - Number(b.id));
    for (const extra of empties.slice(1)) {
      if (rooms.size <= TIERS.length) break;
      if (extra.emptySince && now - extra.emptySince > EMPTY_TTL_MS) {
        console.log(`[fleet] retiring surplus room ${extra.name} (${extra.status?.ghosts ?? 0} ghosts)`);
        extra.proc.kill();
      }
    }
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c: Buffer) => {
      body += c.toString();
      if (body.length > 2048) reject(new Error('too large'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const json = (res: http.ServerResponse, code: number, data: unknown): void => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};

async function handleNames(req: http.IncomingMessage, res: http.ServerResponse, url: string): Promise<void> {
  let body: { name?: string; password?: string };
  try {
    body = JSON.parse(await readBody(req)) as typeof body;
  } catch {
    json(res, 400, { error: 'bad request' });
    return;
  }
  const name = (body.name ?? '').trim().slice(0, 16);
  if (!name) {
    json(res, 400, { error: 'name required' });
    return;
  }
  if (url === '/names/reserve') {
    const pw = reserveName(name);
    if (pw) json(res, 200, { ok: true, password: pw });
    else json(res, 409, { error: 'name is already reserved' });
    return;
  }
  if (url === '/names/delete') {
    if (deleteName(name, body.password ?? '')) json(res, 200, { ok: true });
    else json(res, 403, { error: isReserved(name) ? 'wrong password' : 'name is not reserved' });
    return;
  }
  json(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  if (url.startsWith('/names/') && req.method === 'POST') {
    void handleNames(req, res, url);
    return;
  }
  if (url === '/servers') {
    const list = ranked().map((r) => ({
      id: r.id,
      name: r.name,
      players: r.status?.humans ?? 0,
      bots: r.status?.bots ?? 0,
      max: r.status?.max ?? 32,
      map: r.status?.map ?? '…',
      roundSecs: r.status?.roundSecs ?? 0,
      full: r.status?.full ?? false,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ servers: list }));
    return;
  }
  void serveStatic(req, res);
});

// transparent WS proxy: replay the client's upgrade to the chosen room's
// loopback port and splice the sockets — the room does the real handshake
server.on('upgrade', (req, socket, head) => {
  const wanted = new URL(req.url ?? '/', 'http://x').searchParams.get('s');
  const room = (wanted ? rooms.get(wanted) : undefined) ?? ranked().find((r) => !r.status?.full);
  if (!room || room.port === 0) {
    socket.destroy();
    return;
  }
  const up = net.connect(room.port, '127.0.0.1', () => {
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    }
    raw += '\r\n';
    up.write(raw);
    if (head.length > 0) up.write(head);
    socket.pipe(up);
    up.pipe(socket);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
  up.on('close', () => socket.destroy());
  socket.on('close', () => up.destroy());
});

autosize();
setInterval(autosize, 2000);

server.listen(port, () => {
  console.log(`[webfps] lobby listening on http://localhost:${port} (rooms fork on demand)`);
});
