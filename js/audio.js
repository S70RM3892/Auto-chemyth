// ============================================================
//  サウンド（効果音＋BGM）。音声ファイルは使わず WebAudio で合成する。
//  ブラウザの自動再生制限のため、最初のタップ／キー操作で初めて鳴り始める。
// ============================================================
const KEY = 'autochemyth.sound';
export const snd = Object.assign({ sfx: true, music: true, vol: 0.7 }, load());
function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(snd)); } catch { /* 保存できなくても動作に支障なし */ } }

let ctx = null, master = null, sfxBus = null, musBus = null, echo = null, noiseBuf = null;
const last = {}; // 効果音ごとの直近の再生時刻（鳴らしすぎ防止）

function init() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 5; comp.connect(ctx.destination);
  master = ctx.createGain(); master.connect(comp);
  sfxBus = ctx.createGain(); sfxBus.connect(master);
  musBus = ctx.createGain(); musBus.connect(master);
  // BGM用のやわらかい残響（フィードバック付きディレイ）
  echo = ctx.createDelay(1); echo.delayTime.value = 0.375;
  const fb = ctx.createGain(); fb.gain.value = 0.34; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
  echo.connect(lp); lp.connect(fb); fb.connect(echo); lp.connect(musBus);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  applyVol();
  return true;
}
function applyVol() {
  if (!ctx) return;
  master.gain.value = snd.vol;
  sfxBus.gain.value = snd.sfx ? 0.9 : 0;
  musBus.gain.setTargetAtTime(snd.music ? 0.5 : 0, ctx.currentTime, 0.3);
}
/** 最初のユーザー操作で呼ぶ（何度呼んでもよい） */
export function unlock() {
  if (!init()) return;
  if (ctx.state === 'suspended') ctx.resume();
  if (snd.music) startMusic();
}
export function setSound(k, v) { snd[k] = v; save(); if (!ctx) return; applyVol(); if (k === 'music') { if (v) startMusic(); else stopMusic(); } }

// ---------- 合成の部品 ----------
// 1音：周波数 f0→f1 に滑らせ、アタック a・減衰 d の包絡で鳴らす
function tone(f0, o = {}) {
  const t = (o.at || ctx.currentTime) + (o.delay || 0), d = o.d || 0.12, v = o.v == null ? 0.2 : o.v;
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(f0, t);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + d);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + (o.a || 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  osc.connect(g); g.connect(o.bus || sfxBus); if (o.echo) g.connect(echo);
  osc.start(t); osc.stop(t + d + 0.03);
}
// ノイズ：フィルタ周波数 f0→f1
function noise(o = {}) {
  const t = (o.at || ctx.currentTime) + (o.delay || 0), d = o.d || 0.1, v = o.v == null ? 0.15 : o.v;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const fl = ctx.createBiquadFilter(); fl.type = o.type || 'bandpass'; fl.Q.value = o.q || 1; fl.frequency.setValueAtTime(o.f0 || 1000, t);
  if (o.f1) fl.frequency.exponentialRampToValueAtTime(o.f1, t + d);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + (o.a || 0.004)); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  src.connect(fl); fl.connect(g); g.connect(o.bus || sfxBus);
  src.start(t, Math.random() * 0.5); src.stop(t + d + 0.03);
}
const N = n => 440 * 2 ** ((n - 69) / 12); // MIDI番号→周波数
const arp = (notes, step, o = {}) => notes.forEach((n, i) => tone(N(n), Object.assign({}, o, { delay: (o.delay || 0) + i * step })));

// ---------- 効果音 ----------
// [最短間隔(秒), 再生関数]
const SFX = {
  click: [0.03, () => tone(700, { f1: 520, d: 0.05, v: 0.1, type: 'triangle' })],
  pick: [0.03, () => tone(420, { f1: 640, d: 0.06, v: 0.12 })],
  place: [0.03, () => { tone(190, { f1: 85, d: 0.11, v: 0.3 }); noise({ f0: 900, d: 0.04, v: 0.06 }); }],
  buy: [0.04, () => { tone(N(81), { d: 0.14, v: 0.16, type: 'triangle' }); tone(N(88), { d: 0.22, v: 0.14, type: 'triangle', delay: 0.06 }); }],
  sell: [0.04, () => { tone(N(88), { d: 0.09, v: 0.14, type: 'triangle' }); tone(N(81), { d: 0.16, v: 0.14, type: 'triangle', delay: 0.07 }); noise({ f0: 6000, d: 0.05, v: 0.04, type: 'highpass' }); }],
  roll: [0.05, () => { for (let i = 0; i < 4; i++) noise({ f0: 2500 + i * 700, d: 0.035, v: 0.09, delay: i * 0.035, q: 3 }); }],
  xp: [0.05, () => arp([72, 76, 79], 0.045, { d: 0.12, v: 0.12, type: 'triangle' })],
  levelup: [0.2, () => { arp([60, 64, 67, 72, 76], 0.07, { d: 0.3, v: 0.16, type: 'triangle' }); tone(N(84), { d: 0.6, v: 0.1, delay: 0.35 }); }],
  merge2: [0.1, () => { arp([76, 79, 83, 88], 0.055, { d: 0.25, v: 0.16, type: 'triangle' }); noise({ f0: 7000, d: 0.35, v: 0.05, type: 'highpass', delay: 0.1 }); }],
  merge3: [0.1, () => { arp([72, 76, 79, 84, 88, 91, 96], 0.05, { d: 0.35, v: 0.17, type: 'triangle' }); tone(N(60), { d: 0.7, v: 0.2 }); noise({ f0: 8000, d: 0.6, v: 0.06, type: 'highpass', delay: 0.15 }); }],
  equip: [0.05, () => { tone(2100, { d: 0.09, v: 0.08, type: 'square' }); tone(3150, { d: 0.14, v: 0.05, type: 'square', delay: 0.02 }); }],
  craft: [0.1, () => { tone(2100, { d: 0.08, v: 0.08, type: 'square' }); arp([79, 86, 91], 0.06, { d: 0.25, v: 0.14, type: 'triangle', delay: 0.05 }); }],
  error: [0.15, () => { tone(150, { d: 0.14, v: 0.14, type: 'square' }); tone(120, { d: 0.16, v: 0.12, type: 'square', delay: 0.09 }); }],
  lock: [0.05, () => tone(1200, { f1: 800, d: 0.05, v: 0.1, type: 'square' })],
  round: [0.3, () => { tone(N(76), { d: 0.9, v: 0.14 }); tone(N(83), { d: 1.1, v: 0.08, delay: 0.02 }); }],
  tick: [0.2, () => tone(1000, { d: 0.04, v: 0.1, type: 'square' })],
  fight: [0.5, () => { noise({ f0: 200, f1: 3000, d: 0.45, v: 0.16, q: 2 }); tone(70, { f1: 40, d: 0.5, v: 0.4, delay: 0.4 }); tone(N(57), { d: 0.5, v: 0.12, type: 'sawtooth', delay: 0.4 }); }],
  hit: [0.055, () => noise({ f0: 1400 + Math.random() * 1400, d: 0.045, v: 0.07, q: 2 })],
  shot: [0.055, () => tone(900 + Math.random() * 300, { f1: 500, d: 0.05, v: 0.045, type: 'triangle' })],
  crit: [0.08, () => { noise({ f0: 3200, d: 0.07, v: 0.13, q: 1 }); tone(240, { f1: 110, d: 0.09, v: 0.18 }); }],
  cast: [0.07, () => { tone(420, { f1: 1400, d: 0.2, v: 0.11 }); tone(630, { f1: 2100, d: 0.2, v: 0.05, type: 'triangle' }); }],
  boom: [0.12, () => { noise({ f0: 900, f1: 90, d: 0.4, v: 0.26, type: 'lowpass' }); tone(95, { f1: 38, d: 0.35, v: 0.3 }); }],
  heal: [0.15, () => arp([84, 88], 0.06, { d: 0.18, v: 0.07 })],
  shield: [0.15, () => tone(520, { f1: 780, d: 0.12, v: 0.06, type: 'triangle' })],
  stun: [0.15, () => tone(1500, { f1: 900, d: 0.12, v: 0.06, type: 'square' })],
  neutral: [0.15, () => { noise({ f0: 5000, d: 0.3, v: 0.12, type: 'highpass' }); arp([88, 93], 0.05, { d: 0.25, v: 0.12, type: 'triangle' }); }],
  death: [0.09, () => { tone(330, { f1: 70, d: 0.28, v: 0.14, type: 'triangle' }); noise({ f0: 500, d: 0.15, v: 0.06, type: 'lowpass' }); }],
  win: [1, () => { arp([67, 72, 76, 79], 0.1, { d: 0.35, v: 0.18, type: 'triangle' }); [72, 76, 79, 84].forEach(n => tone(N(n), { d: 1.1, v: 0.1, delay: 0.42 })); }],
  lose: [1, () => { arp([67, 63, 60, 55], 0.14, { d: 0.4, v: 0.16, type: 'triangle' }); tone(N(43), { d: 1, v: 0.2, delay: 0.5 }); }],
  draw: [1, () => arp([67, 65, 67], 0.14, { d: 0.35, v: 0.14, type: 'triangle' })],
  loot: [0.3, () => arp([84, 88, 91, 96], 0.05, { d: 0.14, v: 0.1, type: 'triangle', delay: 0.5 })],
  aug: [0.3, () => { [60, 67, 72, 76].forEach(n => tone(N(n), { d: 0.9, v: 0.1, type: 'triangle' })); noise({ f0: 6000, d: 0.5, v: 0.04, type: 'highpass' }); }],
  champion: [2, () => { arp([60, 64, 67, 72, 76, 79, 84], 0.09, { d: 0.4, v: 0.18, type: 'triangle' }); [72, 76, 79, 84, 88].forEach(n => tone(N(n), { d: 1.8, v: 0.1, delay: 0.7 })); }],
};
const BUZZ = { place: 8, buy: 10, sell: 10, merge2: [15, 40, 25], merge3: [20, 40, 20, 40, 40], error: [20, 40, 20], craft: 15, equip: 8 };

export function sfx(name) {
  const s = SFX[name]; if (!s) return;
  if (BUZZ[name] && snd.sfx && navigator.vibrate) { try { navigator.vibrate(BUZZ[name]); } catch { /* 非対応端末 */ } }
  if (!ctx || !snd.sfx || ctx.state !== 'running') return;
  const now = ctx.currentTime; if (now - (last[name] || -9) < s[0]) return; last[name] = now;
  s[1]();
}

// ---------- BGM（進行に合わせて編成が変わる自動演奏） ----------
// 1小節ごとのコード（ルートのMIDI番号と構成音）。Am9 → Fmaj7 → Cmaj7 → Em7 の循環
const CHORDS = [[45, [57, 60, 64, 71]], [41, [57, 60, 64, 65]], [48, [55, 59, 64, 67]], [40, [55, 59, 62, 67]]];
const SCALE = [69, 72, 74, 76, 79, 81, 84, 86]; // Aマイナー・ペンタトニック
let musTimer = 0, nextT = 0, step = 0, musMode = 'plan', seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const TEMPO = { title: 80, plan: 92, combat: 124 };

export function musicMode(m) { musMode = m; }
function startMusic() {
  if (!ctx || musTimer) return;
  nextT = ctx.currentTime + 0.1; step = 0;
  musTimer = setInterval(schedule, 120);
}
function stopMusic() { clearInterval(musTimer); musTimer = 0; }
function schedule() {
  if (!ctx || ctx.state !== 'running') return;
  if (nextT < ctx.currentTime) nextT = ctx.currentTime + 0.05; // タブ復帰時に溜まった分を捨てる
  while (nextT < ctx.currentTime + 0.4) { playStep(step, nextT); nextT += 60 / TEMPO[musMode] / 2; step++; }
}
function pad(n, t, d, v) {
  const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  o.type = 'sawtooth'; o2.type = 'sawtooth'; o.frequency.value = N(n); o2.frequency.value = N(n) * 1.006;
  f.type = 'lowpass'; f.frequency.value = musMode === 'combat' ? 1100 : 750; f.Q.value = 0.6;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + d * 0.35); g.gain.linearRampToValueAtTime(0.0001, t + d);
  o.connect(f); o2.connect(f); f.connect(g); g.connect(musBus);
  o.start(t); o2.start(t); o.stop(t + d + 0.05); o2.stop(t + d + 0.05);
}
function playStep(s, t) {
  const eighth = 60 / TEMPO[musMode] / 2, bar = Math.floor(s / 8), pos = s % 8, [root, ch] = CHORDS[bar % 4], cmb = musMode === 'combat';
  if (pos === 0) { // コードのパッドと低音
    for (const n of ch) pad(n, t, eighth * 8.4, 0.028);
    tone(N(root), { at: t, d: eighth * 7, v: 0.16, bus: musBus, a: 0.04 });
  }
  if (cmb) { // 戦闘：刻む低音とハイハット、速い分散和音
    if (pos % 2 === 0) tone(N(root + (pos === 4 ? 7 : 0)), { at: t, d: eighth * 0.9, v: 0.13, bus: musBus, type: 'triangle' });
    noise({ at: t, f0: 7000, d: 0.03, v: pos % 2 ? 0.018 : 0.035, type: 'highpass', bus: musBus });
    if (pos === 0 || pos === 5) tone(120, { at: t, f1: 45, d: 0.14, v: 0.22, bus: musBus });
    tone(N(ch[(pos * 3 + bar) % 4] + 12), { at: t, d: eighth * 0.8, v: 0.05, bus: musBus, type: 'triangle', echo: true });
  } else if (musMode === 'plan') { // 準備：まばらなガラスの旋律
    if (rnd() < (pos % 2 === 0 ? 0.42 : 0.16)) tone(N(SCALE[Math.floor(rnd() * SCALE.length)]), { at: t, d: eighth * 2.2, v: 0.07, bus: musBus, type: 'triangle', echo: true });
  } else if (pos === 0 || pos === 3 || pos === 6) { // タイトル：ゆっくりした分散和音
    tone(N(ch[(pos + bar) % 4] + 12), { at: t, d: eighth * 3, v: 0.06, bus: musBus, type: 'triangle', echo: true });
  }
}

// 最初の操作で音を有効化。タブが隠れたらBGMを止める
for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, { capture: true, passive: true });
document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend(); else ctx.resume(); });
