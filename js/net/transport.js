// ============================================================
//  通信路（トランスポート）
//  共通インターフェース:
//    send(msg)          … ルームの全員（自分以外）へ
//    sendTo(cid, msg)   … 特定の1人へ（同報し、受信側で宛先を絞る）
//    onMessage(fn)      … fn(msg)
//    onPresence(fn)     … fn({ joined, left, members })  members: [{cid,name,host}]
//    members()          … 現在の在室者
//    close()
//  実装は2つ:
//    supabase … Supabase Realtime の Broadcast + Presence（本番）
//    local    … 同じブラウザ内の BroadcastChannel（?net=local。自動テスト用）
// ============================================================
import { SUPABASE_URL, SUPABASE_KEY, SUPABASE_LIB, CHANNEL_PREFIX } from './config.js';

const EVENT = 'm';
const MAX_BYTES = 60000; // Broadcast のペイロード上限（無料枠 256KB）より十分小さく保つ

function base(self) {
  const hm = new Set(), hp = new Set();
  let mem = new Map(); // cid -> meta
  const t = {
    self,
    onMessage(fn) { hm.add(fn); return () => hm.delete(fn); },
    onPresence(fn) { hp.add(fn); return () => hp.delete(fn); },
    members() { return [...mem.values()]; },
    _recv(msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.to && msg.to !== self.cid) return;
      for (const f of hm) f(msg);
    },
    // 在室者の一覧を丸ごと受け取り、差分を通知する
    _setMembers(list) {
      const next = new Map();
      for (const m of list) if (m && typeof m.cid === 'string' && m.cid !== self.cid && !next.has(m.cid)) next.set(m.cid, m);
      const joined = [...next.values()].filter(m => !mem.has(m.cid)), left = [...mem.values()].filter(m => !next.has(m.cid));
      mem = next;
      if (joined.length || left.length) for (const f of hp) f({ joined, left, members: t.members() });
    },
    _size(msg) { const s = JSON.stringify(msg); if (s.length > MAX_BYTES) console.warn('[net] large message', msg.t, s.length); return s; },
  };
  return t;
}

// ---------- 同一ブラウザ内（BroadcastChannel） ----------
function openLocal(code, self) {
  const t = base(self), bc = new BroadcastChannel(CHANNEL_PREFIX + code), seen = new Map();
  const beat = () => bc.postMessage(JSON.stringify({ __p: 'hb', meta: self }));
  const sweep = () => {
    const now = Date.now();
    for (const [cid, x] of seen) if (now - x.at > 3500) seen.delete(cid);
    t._setMembers([...seen.values()].map(x => x.meta));
  };
  bc.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.__p === 'hb') { const isNew = !seen.has(m.meta.cid); seen.set(m.meta.cid, { meta: m.meta, at: Date.now() }); if (isNew) { sweep(); beat(); } return; }
    if (m.__p === 'bye') { seen.delete(m.cid); sweep(); return; }
    setTimeout(() => t._recv(m), 0);
  };
  const hb = setInterval(beat, 1000), sw = setInterval(sweep, 1000);
  const bye = () => { try { bc.postMessage(JSON.stringify({ __p: 'bye', cid: self.cid })); } catch { /* closed */ } };
  addEventListener('pagehide', bye);
  beat();
  Object.assign(t, {
    kind: 'local',
    send(msg) { bc.postMessage(t._size(msg)); },
    sendTo(cid, msg) { bc.postMessage(t._size(Object.assign({}, msg, { to: cid }))); },
    track(meta) { Object.assign(self, meta); beat(); },
    close() { clearInterval(hb); clearInterval(sw); bye(); removeEventListener('pagehide', bye); bc.close(); },
  });
  return Promise.resolve(t);
}

// ---------- Supabase Realtime（Broadcast + Presence） ----------
let libP = null;
async function openSupabase(code, self) {
  libP ||= import(SUPABASE_LIB);
  let lib;
  try { lib = await libP; } catch (e) { libP = null; throw new Error('通信ライブラリを読み込めませんでした'); }
  const sb = lib.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const t = base(self);
  const ch = sb.channel(CHANNEL_PREFIX + code, { config: { broadcast: { self: false, ack: false }, presence: { key: self.cid } } });
  ch.on('broadcast', { event: EVENT }, ({ payload }) => t._recv(payload));
  ch.on('presence', { event: 'sync' }, () => {
    const st = ch.presenceState();
    t._setMembers(Object.values(st).map(arr => arr && arr[arr.length - 1]).filter(Boolean));
  });
  await new Promise((res, rej) => {
    let done = false;
    const to = setTimeout(() => { if (!done) { done = true; rej(new Error('サーバーに接続できませんでした')); } }, 12000);
    ch.subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        try { await ch.track(Object.assign({}, self)); } catch { /* 再試行は再接続時に任せる */ }
        if (!done) { done = true; clearTimeout(to); res(); }
      } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') && !done) {
        done = true; clearTimeout(to); rej(new Error('サーバーに接続できませんでした'));
      }
    });
  });
  const send = msg => { t._size(msg); return ch.send({ type: 'broadcast', event: EVENT, payload: msg }); };
  Object.assign(t, {
    kind: 'supabase',
    send,
    sendTo(cid, msg) { return send(Object.assign({}, msg, { to: cid })); },
    track(meta) { Object.assign(self, meta); return ch.track(Object.assign({}, self)); },
    async close() { try { await ch.untrack(); } catch { /* */ } try { await sb.removeChannel(ch); } catch { /* */ } },
  });
  return t;
}

export function transportKind() {
  return new URLSearchParams(location.search).get('net') === 'local' ? 'local' : 'supabase';
}
/** @param self {cid, name, host} */
export async function openTransport(code, self, kind = transportKind()) {
  const t = await (kind === 'local' ? openLocal(code, self) : openSupabase(code, self));
  t.code = code;
  return t;
}
