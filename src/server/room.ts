import http from 'node:http';
import { WebSocketServer } from 'ws';
import { setTickRate } from '../shared/constants.ts';

// One game room in its own process, so rooms scale across CPU cores. The
// manager (index.ts) forks this with SERVER_NAME / BOTS env, proxies player
// sockets to our loopback port, and reads the status heartbeats over IPC.

if (process.env.TICK) setTickRate(Number(process.env.TICK));

const { GameRoom } = await import('./game.ts');
const { TUNE } = await import('../shared/tuning.ts');

TUNE.minPlayers = Math.max(0, Number(process.env.BOTS ?? TUNE.minPlayers));

const room = new GameRoom();
room.start();

const server = http.createServer((_req, res) => {
  res.writeHead(404).end();
});
const wss = new WebSocketServer({ server, maxPayload: 1024 });
wss.on('connection', (ws, req) => room.addConnection(ws, req));

server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  process.send?.({ t: 'ready', port });
  console.log(`[room] ${process.env.SERVER_NAME ?? 'room'} listening on 127.0.0.1:${port}`);
});

setInterval(() => {
  process.send?.({ t: 'status', ...room.status() });
}, 1000);
