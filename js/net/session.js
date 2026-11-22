// ============================================================
//  オンライン対戦の接続まとめ役
//  ルーム作成（ホスト）／参加（ゲスト）を行い、トランスポート・ホスト・クライアントを配線する。
// ============================================================
import { openTransport, transportKind } from './transport.js';
import { HostRoom } from './host.js';
import { Client } from './client.js';
import { newCode, newId, cleanName } from './proto.js';

const later = f => setTimeout(f, 0);
const wait = ms => new Promise(r => setTimeout(r, ms));
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できなくても遊べる */ } },
};

/** タブごとの識別子（再読み込みでも同じ）と、この端末がそのルームで以前使った識別子 */
function identity(code) {
  let cid = null;
  try { cid = sessionStorage.getItem('ac_cid'); } catch { /* */ }
  if (!cid) { cid = newId(); try { sessionStorage.setItem('ac_cid', cid); } catch { /* */ } }
  const rooms = ls.get('ac_rooms', {});
  const prior = (rooms[code] || []).filter(c => c !== cid);
  rooms[code] = [cid, ...prior].slice(0, 8);
  const keys = Object.keys(rooms); if (keys.length > 12) delete rooms[keys[0]];
  ls.set('ac_rooms', rooms);
  return { cid, prior };
}
export const savedName = () => ls.get('ac_name', '');
export const saveName = n => ls.set('ac_name', n);

export class Session {
  constructor(code, emit) { this.code = code; this.emit = emit; this.t = null; this.host = null; this.client = null; this.replays = []; this.kind = transportKind(); }
  get seat() { return this.client ? this.client.seat : -1; }
  get cid() { return this.client ? this.client.cid : null; }
  get isHost() { return !!this.host; }

  /** ルームを作る（ホスト） */
  static async create(name, emit) {
    for (let k = 0; k < 3; k++) {
      const s = new Session(newCode(), emit);
      if (await s.open(name, true)) return s;
    }
    throw new Error('ルームを作れませんでした');
  }
  /** コードで参加する（ゲスト） */
  static async join(code, name, emit) {
    const s = new Session(code, emit);
    await s.open(name, false);
    return s;
  }
  async open(name, asHost) {
    const { cid, prior } = identity(this.code);
    name = cleanName(name) || 'ゲスト';
    const self = { cid, name, host: asHost };
    this.t = await openTransport(this.code, self, this.kind);
    if (asHost) {
      await wait(900); // 同じコードのホストがすでにいないか確認
      if (this.t.members().some(m => m.host)) { await this.t.close(); return false; }
      this.client = new Client({ cid, name, prior, isHost: true, emit: this.emit, send: m => later(() => this.host && this.host.receive(m, true)) });
      this.host = new HostRoom(this.t, { cid, name }, m => { const c = JSON.parse(JSON.stringify(m)); later(() => this.client && this.client.receive(c)); });
      this.host.pushLobby();
    } else {
      this.client = new Client({ cid, name, prior, emit: this.emit, send: m => this.t.send(m) });
      this.t.onMessage(m => this.client.receive(m));
      this.t.onPresence(({ left }) => {
        const h = this.client.hostCid;
        if (h && left.some(m => m.cid === h)) this.emit('end', 'host-left');
      });
      this.client.hello();
    }
    return true;
  }
  act(it) { return this.client.act(it); }
  async leave() {
    if (this.host) this.host.close();
    else if (this.client && this.t) { try { this.t.send({ t: 'bye', cid: this.client.cid }); } catch { /* */ } }
    if (this.client) this.client.close();
    const t = this.t; this.t = null; this.host = null;
    if (t) await t.close();
  }
}
