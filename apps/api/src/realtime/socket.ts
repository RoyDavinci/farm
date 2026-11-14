import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { Config } from '../config/index.js';
import type { Database } from '../database/client.js';
import { tokenHash } from '../services/auth.service.js';
/** WebSocket hub: authenticated clients receive "sync" nudges when their data changes. */
export function attachRealtime(server: Server, db: Database, c: Config) {
  const hub = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 4096,
    verifyClient(info: { origin: string }) {
      return !info.origin || c.origins.includes(info.origin);
    },
  });
  const clients = new Map<
    WebSocket,
    { token: string; user: string; signature: string; checking: boolean }
  >();
  hub.on('connection', (socket) => {
    const timeout = setTimeout(() => socket.close(4401, 'Authentication required'), 5000);
    timeout.unref();
    socket.on('error', () => {});
    socket.on('message', async (raw) => {
      try {
        if (clients.has(socket)) {
          socket.close(4400, 'Already authenticated');
          return;
        }
        const data = JSON.parse(raw.toString());
        if (
          data.type !== 'authenticate' ||
          typeof data.token !== 'string' ||
          data.token.length !== 64
        ) {
          socket.close(4401, 'Authentication required');
          return;
        }
        const hashed = tokenHash(data.token);
        const [user] = await db.query(
          "SELECT u.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.status='ACTIVE'",
          [hashed],
        );
        if (!user) {
          socket.close(4401, 'Session expired');
          return;
        }
        clearTimeout(timeout);
        clients.set(socket, { token: hashed, user: user.id, signature: '', checking: false });
        socket.send(JSON.stringify({ type: 'ready' }));
      } catch {
        socket.close(4400, 'Invalid message');
      }
    });
    socket.on('close', () => {
      clearTimeout(timeout);
      clients.delete(socket);
    });
  });
  const interval = setInterval(() => {
    for (const [socket, client] of clients) {
      if (client.checking || socket.readyState !== WebSocket.OPEN) continue;
      client.checking = true;
      void (async () => {
        const [valid] = await db.query(
          "SELECT s.user_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.status='ACTIVE'",
          [client.token],
        );
        if (!valid) {
          socket.close(4401, 'Session expired');
          return;
        }
        const [n] = await db.query(
          'SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE read_at IS NULL)::int AS unread FROM notifications WHERE user_id=$1',
          [client.user],
        );
        const [m] = await db.query(
          'SELECT COUNT(m.id)::int AS total,MAX(c.buyer_read_at) AS buyer_read,MAX(c.seller_read_at) AS seller_read FROM conversations c LEFT JOIN messages m ON m.conversation_id=c.id WHERE c.buyer_id=$1 OR c.seller_id=$1',
          [client.user],
        );
        const [s] = await db.query('SELECT status FROM sellers WHERE user_id=$1', [client.user]);
        const signature = JSON.stringify([n, m, s]);
        if (signature !== client.signature) {
          client.signature = signature;
          socket.send(JSON.stringify({ type: 'sync' }));
        }
      })()
        .catch(() => {
          socket.close(1011, 'Please reconnect');
        })
        .finally(() => {
          client.checking = false;
        });
    }
  }, 2000);
  interval.unref();
  return () => {
    clearInterval(interval);
    for (const socket of clients.keys()) socket.close(1001, 'Server restarting');
    hub.close();
  };
}
