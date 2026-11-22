// ============================================================
//  通信プロトコル：ゲーム状態のスナップショット化と復元
//  ホストの Game → JSON（全員に同報）→ クライアントの「影のGame」
// ============================================================
import { Game } from '../game.js';
import { AUGS } from '../data.js';

const AUG = Object.fromEntries(AUGS.map(a => [a.id, a]));
const unitOut = u => (u ? (u.c != null ? { uid: u.uid, id: u.id, star: u.star, items: u.items, c: u.c, r: u.r } : { uid: u.uid, id: u.id, star: u.star, items: u.items }) : null);
const PKEYS = ['id', 'name', 'bot', 'human', 'away', 'ready', 'hp', 'gold', 'level', 'xp', 'items', 'shop', 'lock', 'streak', 'alive', 'augs', 'mods',
  'intCap', 'rerollCost', 'extraSlot', 'dmgCut', 'place', 'opp', 'lastResult', 'lastIncome'];

/** ホスト側：Game → 送信用オブジェクト */
export function snapshot(G, extra = {}) {
  return Object.assign({
    stage: G.stage, round: G.round, phase: G.phase, over: G.over, diff: G.opts.diff, set: G.set,
    players: G.players.map(p => {
      const o = {}; for (const k of PKEYS) o[k] = p[k];
      o.board = p.board.map(unitOut); o.bench = p.bench.map(unitOut);
      o.pendingAug = p.pendingAug ? p.pendingAug.map(a => a.id) : null;
      return o;
    }),
    fights: G.fights.map(f => [f.a.id, f.b ? f.b.id : -1, f.ghost ? 1 : 0, f.pve ? 1 : 0]),
  }, extra);
}

/** クライアント側：スナップショット → 表示・予測用の影の Game（ルールのメソッドはそのまま使える） */
export function shadowGame(s, seat) {
  const G = Object.create(Game.prototype);
  G.opts = { diff: s.diff, timer: true, online: true, seats: null };
  G.set = s.set || [];
  G.pool = new Proxy({}, { get: () => 0, set: () => true }); // 共有プールはホストだけが持つ
  G.stage = s.stage; G.round = s.round; G.phase = s.phase; G.over = s.over; G.battle = null; G.log = [];
  G.players = s.players.map(o => {
    const p = Object.assign({}, o);
    p.board = o.board.map(u => Object.assign({}, u, { items: u.items.slice() }));
    p.bench = o.bench.map(u => (u ? Object.assign({}, u, { items: u.items.slice() }) : null));
    p.items = o.items.slice(); p.shop = o.shop.slice(); p.augs = o.augs.slice(); p.mods = Object.assign({}, o.mods); p.fav = [];
    p.pendingAug = o.pendingAug ? o.pendingAug.map(id => AUG[id]).filter(Boolean) : null;
    return p;
  });
  G.fights = s.fights.map(([a, b, g, pve]) => ({ a: G.players[a], b: b >= 0 ? G.players[b] : null, ghost: !!g, pve: !!pve }));
  G.me = G.players[seat] || G.players[0];
  G.place = G.me.place;
  // 予測で生まれたユニットは負のIDにする（ホストのIDと衝突させない。ホストは負のIDを受け付けない）
  G.addUnit = function (p, id, star) { const u = Game.prototype.addUnit.call(this, p, id, star); if (u && u.uid > 0) u.uid = -u.uid; return u; };
  return G;
}

// ---------- ルームコード・名前 ----------
export const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 0/O, 1/I/L を除いた紛らわしくない文字
export const CODE_LEN = 5;
export function newCode() {
  const a = new Uint32Array(CODE_LEN); crypto.getRandomValues(a);
  return [...a].map(x => CODE_ABC[x % CODE_ABC.length]).join('');
}
export function normCode(s) {
  const c = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === CODE_LEN && [...c].every(ch => CODE_ABC.includes(ch)) ? c : null;
}
export const NAME_MAX = 12;
/** 表示名の正規化：制御文字を除き、前後の空白を削り、最大12文字 */
export function cleanName(s) {
  return [...String(s || '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim()].slice(0, NAME_MAX).join('');
}
export function newId() {
  const a = new Uint8Array(9); crypto.getRandomValues(a);
  return [...a].map(x => x.toString(36).padStart(2, '0')).join('').slice(0, 14);
}
