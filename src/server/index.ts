import http from 'node:http';
import { WebSocketServer } from 'ws';
import { GameRoom } from './game.ts';
import { serveStatic } from './static.ts';

const port = Number(process.env.PORT) || 8090;

const server = http.createServer((req, res) => {
  void serveStatic(req, res);
});

const room = new GameRoom();
room.start();

// 1 KiB is plenty for any legitimate client message
const wss = new WebSocketServer({ server, maxPayload: 1024 });
wss.on('connection', (ws, req) => room.addConnection(ws, req));

server.listen(port, () => {
  console.log(`[webfps] game server listening on http://localhost:${port}`);
});
