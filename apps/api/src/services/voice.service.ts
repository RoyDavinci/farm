import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query, Database } from '../database/client.js';
import type { AppDeps } from '../types/deps.js';
import type { RequestInput } from '../lib/http.js';
import { ensure } from '../lib/errors.js';
import { audit } from './audit.service.js';
import { notify } from './communications.service.js';
export const voiceSignalInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('offer'),
    payload: z.object({ type: z.literal('offer'), sdp: z.string().min(1).max(60000) }),
  }),
  z.object({
    kind: z.literal('answer'),
    payload: z.object({ type: z.literal('answer'), sdp: z.string().min(1).max(60000) }),
  }),
  z.object({
    kind: z.literal('ice'),
    payload: z.object({
      candidate: z.string().max(2000),
      sdpMid: z.string().max(100).nullable().optional(),
      sdpMLineIndex: z.number().int().min(0).max(100).nullable().optional(),
      usernameFragment: z.string().max(200).nullable().optional(),
    }),
  }),
]);
async function conversation(q: Query, id: string, u: any) {
  const [c] = await q.query(
    "SELECT c.* FROM conversations c JOIN users a ON a.id=c.buyer_id JOIN users b ON b.id=c.seller_id WHERE c.id=$1 AND (c.buyer_id=$2 OR c.seller_id=$2) AND a.status='ACTIVE' AND b.status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_id=c.buyer_id AND blocked_id=c.seller_id) OR (blocker_id=c.seller_id AND blocked_id=c.buyer_id))",
    [id, u.id],
  );
  ensure(c, 404, 'NOT_FOUND', 'Calling is unavailable for this conversation.');
  return c;
}
export async function expireVoiceCalls(db: Database) {
  await db.query(
    "UPDATE voice_calls SET status='ENDED' WHERE status IN ('RINGING','ACCEPTED') AND expires_at<=now()",
  );
  await db.query(
    "DELETE FROM voice_calls WHERE status IN ('ENDED','DECLINED') AND expires_at<now()-interval '5 minutes'",
  );
}
/** A candidate line that would reveal a participant's own network address (host/srflx/prflx). */
const directCandidate = (line: string) => /\btyp (host|srflx|prflx)\b/.test(line);
/** A relay candidate's raddr/rport is the sender's own public address: blank it. */
const maskRelated = (candidate: string) =>
  candidate.replace(/ raddr \S+ rport \d+/, ' raddr 0.0.0.0 rport 0');
/** Keeps only relay candidates in a session description, with their related address masked. */
export const relayOnlySdp = (sdp: string) =>
  sdp
    .split(/\r?\n/)
    .filter((line) => !(line.startsWith('a=candidate:') && directCandidate(line)))
    .map((line) => (line.startsWith('a=candidate:') ? maskRelated(line) : line))
    .join('\r\n');

export function createVoiceService({ db, config }: AppDeps) {
  // Calls always go through the TURN relay so neither participant learns the other's IP address
  // (and so approximate location). Direct peer-to-peer calls are allowed only in demo mode.
  const relayConfigured = () => !!(config.voiceTurnUrl && config.voiceTurnSecret);
  const relayOnly = () => relayConfigured() || !config.demo;
  const enabled = () => config.demo || (config.voiceEnabled && relayConfigured());
  async function settings(u: any) {
    const iceServers: any[] = [];
    if (config.voiceStunUrl)
      iceServers.push({ urls: config.voiceStunUrl.split(',').filter(Boolean) });
    if (config.voiceTurnUrl && config.voiceTurnSecret) {
      const username = `${Math.floor(Date.now() / 1000) + 3600}:${u.id}`;
      iceServers.push({
        urls: config.voiceTurnUrl.split(',').filter(Boolean),
        username,
        credential: createHmac('sha1', config.voiceTurnSecret).update(username).digest('base64'),
      });
    }
    return {
      enabled: enabled(),
      ice_servers: relayOnly() ? iceServers.filter((s) => s.credential) : iceServers,
      ice_transport_policy: relayOnly() ? ('relay' as const) : ('all' as const),
      relay_configured: relayConfigured(),
      notice: relayConfigured()
        ? 'Calls go through a secure relay, so your number and network address stay private. Calls are not recorded.'
        : 'Demo calling preview: calls connect directly and may reveal network addresses. Calls are not recorded.',
    };
  }
  async function active(u: any, i: RequestInput) {
    await conversation(db, i.params.id, u);
    return (
      (
        await db.query(
          "SELECT id,caller_id,callee_id,status,expires_at FROM voice_calls WHERE conversation_id=$1 AND status IN ('RINGING','ACCEPTED') AND expires_at>now() ORDER BY created_at DESC LIMIT 1",
          [i.params.id],
        )
      )[0] || null
    );
  }
  async function start(q: Query, u: any, i: RequestInput) {
    ensure(enabled(), 503, 'CALLS_DISABLED', 'Voice calling is not enabled.');
    await conversation(q, i.params.id, u);
    const [c] = await q.query('SELECT * FROM conversations WHERE id=$1 FOR UPDATE', [i.params.id]);
    await q.query(
      "UPDATE voice_calls SET status='ENDED' WHERE conversation_id=$1 AND expires_at<=now() AND status IN ('RINGING','ACCEPTED')",
      [c.id],
    );
    const id = randomUUID(),
      callee = c.buyer_id === u.id ? c.seller_id : c.buyer_id;
    await q.query(
      'INSERT INTO voice_calls(id,conversation_id,caller_id,callee_id) VALUES($1,$2,$3,$4)',
      [id, c.id, u.id, callee],
    );
    await audit(q, u.id, 'voice.start', id);
    await notify(
      q,
      callee,
      'message',
      'Incoming voice call',
      'Open your conversation to accept or decline.',
    );
    return { id };
  }
  async function member(q: Query, u: any, id: string, lock = false) {
    const [c] = await q.query(`SELECT * FROM voice_calls WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [
      id,
    ]);
    ensure(c && [c.caller_id, c.callee_id].includes(u.id), 404, 'NOT_FOUND', 'Call not found.');
    await conversation(q, c.conversation_id, u);
    return c;
  }
  async function action(q: Query, u: any, i: RequestInput) {
    const { action } = z.object({ action: z.enum(['accept', 'decline', 'end']) }).parse(i.body),
      c = await member(q, u, i.params.id, true);
    ensure(
      ['RINGING', 'ACCEPTED'].includes(c.status) && new Date(c.expires_at).getTime() > Date.now(),
      409,
      'CALL_ENDED',
      'This call has ended.',
    );
    if (action === 'accept')
      ensure(
        c.callee_id === u.id && c.status === 'RINGING',
        403,
        'FORBIDDEN',
        'Only the invited participant can accept.',
      );
    if (action === 'decline')
      ensure(c.callee_id === u.id, 403, 'FORBIDDEN', 'Only the invited participant can decline.');
    await q.query(
      "UPDATE voice_calls SET status=$1,expires_at=CASE WHEN $1='ACCEPTED' THEN now()+interval '30 minutes' ELSE now() END WHERE id=$2",
      [action === 'accept' ? 'ACCEPTED' : action === 'decline' ? 'DECLINED' : 'ENDED', c.id],
    );
    if (action !== 'accept') await q.query('DELETE FROM voice_signals WHERE call_id=$1', [c.id]);
    await audit(q, u.id, `voice.${action}`, c.id);
    return { ok: true };
  }
  async function signals(u: any, i: RequestInput) {
    const c = await member(db, u, i.params.id);
    if (
      !['RINGING', 'ACCEPTED'].includes(c.status) ||
      new Date(c.expires_at).getTime() <= Date.now()
    )
      return { status: 'ENDED', signals: [] };
    return {
      status: c.status,
      signals: await db.query(
        'SELECT id,kind,payload FROM voice_signals WHERE call_id=$1 AND sender_id<>$2 ORDER BY created_at,id LIMIT 250',
        [c.id, u.id],
      ),
    };
  }
  async function signal(q: Query, u: any, i: RequestInput) {
    const d = voiceSignalInput.parse(i.body),
      c = await member(q, u, i.params.id, true);
    ensure(
      ['RINGING', 'ACCEPTED'].includes(c.status) && new Date(c.expires_at).getTime() > Date.now(),
      409,
      'CALL_ENDED',
      'Call expired.',
    );
    ensure(
      d.kind === 'ice' ||
        (d.kind === 'offer'
          ? c.caller_id === u.id
          : c.callee_id === u.id && c.status === 'ACCEPTED'),
      403,
      'FORBIDDEN',
      'Only the appropriate call participant may send this signal.',
    );
    const [count] = await q.query('SELECT COUNT(*)::int AS n FROM voice_signals WHERE call_id=$1', [
      c.id,
    ]);
    ensure(
      count.n < 250,
      429,
      'SIGNAL_LIMIT',
      'Call connection limit reached. Start another call.',
    );
    if (d.kind !== 'ice') {
      const [old] = await q.query('SELECT id FROM voice_signals WHERE call_id=$1 AND kind=$2', [
        c.id,
        d.kind,
      ]);
      ensure(!old, 409, 'SIGNAL_EXISTS', 'This call already has that session description.');
    }
    // Enforced here too, so a modified client cannot leak its peer-visible address.
    if (relayOnly()) {
      if (d.kind === 'ice') {
        if (directCandidate(d.payload.candidate)) return { ok: true };
        d.payload.candidate = maskRelated(d.payload.candidate);
      }
      if (d.kind !== 'ice') d.payload.sdp = relayOnlySdp(d.payload.sdp);
    }
    await q.query(
      'INSERT INTO voice_signals(id,call_id,sender_id,kind,payload) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), c.id, u.id, d.kind, JSON.stringify(d.payload)],
    );
    return { ok: true };
  }
  return { settings, active, start, action, signals, signal };
}
