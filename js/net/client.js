// ============================================================
//  クライアント（各プレイヤーの画面側）
//  ルールは実行しない。ホストのスナップショットから「影の Game」を作って表示し、
//  自分の操作はインテントとして送りつつ、同じ検証関数で即座に予測表示する。
//  ホストがまだ処理していない操作（ack 以降）は、新しいスナップショットの上に再適用する。
// ============================================================
import { applyIntent } from '../intents.js';
import { shadowGame } from './proto.js';

export class Client {
  /**
   * @param o.cid, o.name, o.prior  自分の識別子・表示名・この端末で以前使った識別子
   * @param o.send  ホストへ送る関数
   * @param o.emit  画面へ通知する関数 (event, data)
   */
  constructor(o) {
    Object.assign(this, { cid: o.cid, name: o.name, prior: o.prior || [], send: o.send, emit: o.emit, isHost: !!o.isHost });
    this.lobby = null; this.hostCid = o.isHost ? o.cid : null; this.seat = -1; this.G = null; this.snap = null;
    this.n = 0; this.pending = []; this.deadline = 0; this.started = false; this.closed = false; this.helloTm = 0;
  }
  hello() {
    let tries = 0;
    const go = () => {
      if (this.closed || this.lobby || this.started) return;
      if (tries++ >= 5) { this.emit('reject', 'notfound'); return; }
      this.send({ t: 'hello', cid: this.cid, name: this.name, prior: this.prior });
      this.helloTm = setTimeout(go, 1600);
    };
    go();
  }
  receive(m) {
    if (this.closed || !m || typeof m !== 'object') return;
    if (m.t === 'hello' || m.t === 'intent' || m.t === 'bye') return; // 他クライアント宛ての通信
    if (this.hostCid && m.from !== this.hostCid) return;              // ホスト以外からの「ホストの通信」は無視
    switch (m.t) {
      case 'lobby':
        if (!this.hostCid) this.hostCid = m.host;
        if (m.host !== this.hostCid) return;
        this.lobby = m; clearTimeout(this.helloTm);
        if (!this.started) this.emit('lobby', m);
        return;
      case 'reject': clearTimeout(this.helloTm); this.emit('reject', m.reason); return;
      case 'start': {
        if (m.lobby) this.lobby = m.lobby;
        const s = (m.seats || []).find(x => x.cid === this.cid);
        if (!s) { if (this.lobby) this.emit('reject', 'started'); return; }
        this.seat = s.seat; this.started = true; clearTimeout(this.helloTm); this.emit('start', m);
        return;
      }
      case 'welcome':
        this.hostCid = m.from; this.lobby = m.lobby; this.seat = m.seat; this.started = true; clearTimeout(this.helloTm);
        this.pending = []; this.emit('start', m);
        return;
      case 'snap': return this.onSnap(m);
      case 'combat': if (this.started) this.emit('combat', m); return;
      case 'nack': this.emit('nack', m); return;
      case 'end': this.emit('end', m.reason || 'host'); return;
    }
  }
  onSnap(s) {
    if (!this.started || this.seat < 0) return;
    if (this.snap && s.v <= this.snap.v) return; // 古い・重複
    this.snap = s;
    if (s.phase === 'plan') this.deadline = performance.now() + s.planLeft;
    const ack = (s.acks && s.acks[this.seat]) || 0;
    this.pending = this.pending.filter(x => x.n > ack);
    const G = shadowGame(s, this.seat);
    for (const x of this.pending) if (x.it.t !== 'roll') applyIntent(G, G.me, x.it); // 未処理の自分の操作を再適用
    this.G = G;
    this.emit('snap', s);
  }
  /** 自分の操作：予測して即反映し、ホストへ送る。予測で不可なら送らない */
  act(it) {
    const G = this.G; if (!G || this.closed) return false;
    let r;
    if (it.t === 'roll') r = G.me.alive && G.me.gold >= G.me.rerollCost; // 抽選はホストだけが行う
    else r = applyIntent(G, G.me, it);
    if (!r || r === 'full') return r;
    const n = ++this.n;
    this.pending.push({ n, it });
    this.send({ t: 'intent', cid: this.cid, seat: this.seat, n, it });
    return r;
  }
  close() { this.closed = true; clearTimeout(this.helloTm); }
}
