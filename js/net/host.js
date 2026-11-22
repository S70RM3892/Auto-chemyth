// ============================================================
//  ホスト（ルーム作成者）の権威サーバー
//  唯一の本物の Game を持ち、各クライアントのインテントを
//  その席の状態に対して検証して適用し、スナップショットを配る。
// ============================================================
import { Game, DIFFS } from '../game.js';
import { applyIntent } from '../intents.js';
import { snapshot, cleanName } from './proto.js';

const SNAP_GAP = 350;       // リモートへのスナップショットは最短 350ms 間隔に間引く（≒最大3通/秒）
const COMBAT_MARGIN = 2600; // 最長戦闘(×1) + 演出の余白
const RESULT_TIME = 2800;   // 判定表示 → 次ラウンド
const MAX_PLAYERS = 8;

export class HostRoom {
  /**
   * @param t     トランスポート
   * @param self  {cid, name}
   * @param local ホスト自身の画面（クライアント）へ渡す関数
   */
  constructor(t, self, local) {
    this.t = t; this.self = self; this.local = local;
    this.state = 'lobby'; this.code = t.code; this.diff = 'normal';
    this.members = [{ cid: self.cid, name: self.name }];
    this.G = null; this.seatOf = new Map(); this.acks = []; this.ver = 0;
    this.planEnd = 0; this.timer = 0; this.snapTm = 0; this.lastSnapAt = 0; this.lastCombat = null;
    this.rejected = []; // 検証で弾いたインテント（テスト・デバッグ用）
    t.onMessage(m => this.receive(m));
    t.onPresence(ev => this.presence(ev));
  }

  // ---------- 送信 ----------
  bcast(msg) { msg.from = this.self.cid; this.t.send(msg); this.local(msg); }
  to(cid, msg) { msg.from = this.self.cid; if (cid === this.self.cid) this.local(msg); else this.t.sendTo(cid, msg); }
  lobbyMsg() { return { t: 'lobby', code: this.code, host: this.self.cid, members: this.members.map(m => ({ cid: m.cid, name: m.name })), diff: this.diff, state: this.state }; }
  pushLobby() { this.bcast(this.lobbyMsg()); }

  // ---------- 受信 ----------
  receive(m, fromLocal = false) {
    if (!m || typeof m !== 'object' || typeof m.cid !== 'string') return;
    if (fromLocal !== (m.cid === this.self.cid)) return; // 他人がホストを名乗る／ホストの名を騙る通信は無視
    if (m.t === 'hello') return this.hello(m);
    if (m.t === 'bye') return this.leave(m.cid);
    if (m.t === 'intent') return this.intent(m);
  }
  hello(m) {
    const cid = m.cid, name = this.uniqueName(cleanName(m.name) || 'ゲスト', cid);
    if (this.state === 'lobby') {
      const ex = this.members.find(x => x.cid === cid);
      if (ex) ex.name = name;
      else if (this.members.length >= MAX_PLAYERS) return this.to(cid, { t: 'reject', reason: 'full' });
      else this.members.push({ cid, name });
      return this.pushLobby();
    }
    if (this.state !== 'game') return this.to(cid, { t: 'reject', reason: 'ended' });
    // 進行中：同じ端末（cid か、この端末で以前使った cid）の席なら復帰させる
    const prior = Array.isArray(m.prior) ? m.prior.filter(x => typeof x === 'string').slice(0, 16) : [];
    let seat = this.seatOf.get(cid), old = cid;
    if (seat == null) for (const c of prior) {
      const s = this.seatOf.get(c);
      if (s != null && this.G.players[s].away) { seat = s; old = c; break; }
    }
    if (seat == null) return this.to(cid, { t: 'reject', reason: 'started' });
    this.seatOf.delete(old); this.seatOf.set(cid, seat);
    const p = this.G.players[seat];
    if (p.away) this.G.resume(p);
    this.to(cid, { t: 'welcome', seat, lobby: this.lobbyMsg() });
    this.to(cid, this.snapMsg());
    if (this.G.phase === 'combat' && this.lastCombat) this.to(cid, Object.assign({}, this.lastCombat));
    this.dirty();
  }
  uniqueName(n, cid) {
    const used = new Set(this.members.filter(x => x.cid !== cid).map(x => x.name));
    if (!used.has(n)) return n;
    for (let i = 2; ; i++) { const s = [...n].slice(0, 10).join('') + i; if (!used.has(s)) return s; }
  }
  presence({ left }) {
    for (const m of left) this.leave(m.cid);
  }
  leave(cid) {
    if (cid === this.self.cid) return;
    if (this.state === 'lobby') {
      const n = this.members.length;
      this.members = this.members.filter(x => x.cid !== cid);
      if (this.members.length !== n) this.pushLobby();
      return;
    }
    if (this.state !== 'game') return;
    const seat = this.seatOf.get(cid); if (seat == null) return;
    const p = this.G.players[seat];
    if (!p.away) { p.away = true; p.ready = false; this.dirty(); this.checkReady(); }
  }

  setDiff(d) { if (this.state === 'lobby' && DIFFS[d]) { this.diff = d; this.pushLobby(); } }

  // ---------- ゲーム ----------
  start() {
    if (this.state !== 'lobby' || this.members.length < 2) return false;
    const seats = this.members.slice(0, MAX_PLAYERS);
    this.G = new Game({ diff: this.diff, online: true, seats: seats.map(m => ({ name: m.name })) });
    seats.forEach((m, i) => this.seatOf.set(m.cid, i));
    this.acks = new Array(8).fill(0);
    this.state = 'game';
    window.__G = this.G;
    this.bcast({ t: 'start', seats: seats.map((m, i) => ({ cid: m.cid, seat: i })), lobby: this.lobbyMsg() });
    this.beginPlan();
    return true;
  }
  beginPlan() {
    const ms = this.G.planTime() * 1000;
    this.planEnd = Date.now() + ms;
    clearTimeout(this.timer); this.timer = setTimeout(() => this.endPlan(), ms);
    this.snapNow();
  }
  intent(m) {
    if (this.state !== 'game') return;
    const seat = this.seatOf.get(m.cid);
    const why = seat == null ? 'seat' : (m.seat != null && m.seat !== seat) ? 'forged' : null;
    const p = seat != null ? this.G.players[seat] : null;
    if (why || !p || p.away) { this.reject(m, why || 'away'); return; }
    if (Number.isInteger(m.n)) this.acks[seat] = Math.max(this.acks[seat], m.n);
    const r = applyIntent(this.G, p, m.it);
    if (!r) this.reject(m, 'invalid');
    this.dirty();
    if (m.it && m.it.t === 'ready') this.checkReady();
  }
  reject(m, why) {
    this.rejected.push({ cid: m.cid, seat: m.seat, it: m.it, why, at: this.G ? this.G.label : '' });
    if (this.rejected.length > 100) this.rejected.shift();
    this.to(m.cid, { t: 'nack', n: m.n, why });
  }
  activeHumans() { return this.G.players.filter(p => p.human && p.alive && !p.away); }
  checkReady() {
    if (!this.G || this.G.phase !== 'plan') return;
    const hs = this.activeHumans();
    if (hs.length && hs.every(p => p.ready)) this.endPlan();
  }
  endPlan() {
    const G = this.G; if (!G || G.phase !== 'plan') return;
    clearTimeout(this.timer);
    for (const p of G.alive()) if (!p.bot && p.pendingAug) G.chooseAug(Math.floor(Math.random() * p.pendingAug.length), p); // 未選択なら自動で選ぶ
    G.startCombat();
    let dur = 0;
    const fights = G.fights.map(f => {
      const b = f.battle; dur = Math.max(dur, b.t);
      return { a: f.a.id, b: f.b ? f.b.id : -1, ghost: f.ghost ? 1 : 0, pve: f.pve ? 1 : 0, A: f.A, B: f.B, seed: f.seed,
        res: { w: b.winner, t: +b.t.toFixed(2), surv: b.units.filter(u => u.alive).map(u => [u.uid, Math.round(u.hp)]) } };
    });
    // 全員の戦闘を1通にまとめて同報する（Broadcast は同報なので、宛先別に送ると配信数が人数倍になる）
    this.lastCombat = { t: 'combat', label: G.label, fights, dur: +dur.toFixed(2) };
    this.bcast(this.lastCombat);
    this.snapNow();
    this.timer = setTimeout(() => this.finish(), dur * 1000 + COMBAT_MARGIN);
  }
  finish() {
    const G = this.G; if (!G || G.phase !== 'combat') return;
    G.finishCombat();
    // 人間が全員脱落したら、残りのライバル同士は即座に決着させて最終順位を確定する
    for (let n = 0; !G.over && !G.players.some(p => p.human && p.alive) && n < 300; n++) { G.nextRound(); G.startCombat(); G.finishCombat(); }
    this.lastCombat = null;
    this.snapNow();
    if (G.over) { this.state = 'over'; return; }
    this.timer = setTimeout(() => { if (this.state !== 'game') return; G.nextRound(); this.beginPlan(); }, RESULT_TIME);
  }

  // ---------- スナップショット ----------
  snapMsg() {
    return snapshot(this.G, { t: 'snap', v: ++this.ver, label: this.G.label, planLeft: this.G.phase === 'plan' ? Math.max(0, this.planEnd - Date.now()) : 0,
      acks: this.acks.slice(), from: this.self.cid });
  }
  // ホスト自身の画面にはすぐ、リモートには間引いて送る
  dirty() {
    if (!this.G) return;
    this.local(this.snapMsg());
    if (this.snapTm) return;
    this.snapTm = setTimeout(() => this.flush(), Math.max(60, this.lastSnapAt + SNAP_GAP - Date.now()));
  }
  flush() { clearTimeout(this.snapTm); this.snapTm = 0; this.lastSnapAt = Date.now(); this.t.send(this.snapMsg()); }
  snapNow() { this.local(this.snapMsg()); this.flush(); }

  close() {
    clearTimeout(this.timer); clearTimeout(this.snapTm);
    this.state = 'closed';
    try { this.t.send({ t: 'end', reason: 'host', from: this.self.cid }); } catch { /* */ }
  }
}
