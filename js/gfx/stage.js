// ============================================================
//  3Dステージ（近未来の研究室と反応台）
//  盤面・駒・戦闘演出を WebGL で描く。操作の当たり判定やHPバーは
//  ui.js 側のDOMが担当し、ここは project() で画面座標を教えるだけ。
// ============================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildModel } from './mol.js';

const S3 = Math.sqrt(3) / 2, COLS = 7, ROWS = 8;
/** 盤面座標（列, 行）→ ワールド座標 [x, z]。六角の幅を1とする */
export const cellWorld = (c, r) => [c + (r & 1 ? .5 : 0) - 3.25, (r - 3.5) * S3];
const COST = [0x8a7466, 0xa9b4c6, 0x3fe07f, 0x4a9bff, 0xc070ff, 0xffc23d];
const ALLY = 0x39d9ff, ENEMY = 0xff3d6e, MODEL_Y = .92;
const V = new THREE.Vector3();

function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
// 下が濃く上に消える縦グラデーション（ホログラムの光柱用）
const beamTex = () => canvasTex(4, 64, (g, w, h) => { const l = g.createLinearGradient(0, h, 0, 0); l.addColorStop(0, '#fff'); l.addColorStop(.25, '#777'); l.addColorStop(1, '#000'); g.fillStyle = l; g.fillRect(0, 0, w, h); });
const dotTex = () => canvasTex(64, 64, (g) => { const l = g.createRadialGradient(32, 32, 0, 32, 32, 32); l.addColorStop(0, '#fff'); l.addColorStop(.3, '#ffffffaa'); l.addColorStop(1, '#fff0'); g.fillStyle = l; g.fillRect(0, 0, 64, 64); });

export class Stage {
  constructor(host) {
    this.ok = false; this.host = host;
    { const c = document.createElement('canvas'); if (!(c.getContext('webgl2') || c.getContext('webgl'))) return; } // WebGL 非対応なら平面表示へ
    try {
      this.r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch { return; }
    if (!this.r.getContext()) return;
    this.ok = true;
    const r = this.r; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = .95;
    r.domElement.id = 'gl'; host.prepend(r.domElement);
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x05080e); this.scene.fog = new THREE.FogExp2(0x05080e, .028);
    const pm = new THREE.PMREMGenerator(r); this.env = pm.fromScene(new RoomEnvironment(), .04).texture; this.scene.environment = this.env; this.scene.environmentIntensity = .42;
    this.cam = new THREE.PerspectiveCamera(32, 1, .1, 120);
    this.units = new Map(); this.fx = []; this.t = 0; this.W = 1; this.H = 1; this.low = false; this.slow = 0;
    this.beamTex = beamTex(); this.dotTex = dotTex();
    this.lab(); this.table(); this.particles();
    this.comp = new EffectComposer(r); this.comp.addPass(new RenderPass(this.scene, this.cam));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .5, .5, .88); this.comp.addPass(this.bloom); this.comp.addPass(new OutputPass());
    this.clock = new THREE.Clock(); this.frame = this.frame.bind(this); requestAnimationFrame(this.frame);
  }

  // ---------- 研究室 ----------
  lab() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x8fb8ff, 0x0a0d14, .55));
    const key = new THREE.DirectionalLight(0xffffff, 1.15); key.position.set(-3, 9, 6); s.add(key);
    const a = new THREE.PointLight(ALLY, 26, 14, 1.8); a.position.set(0, 3.2, 4.2); s.add(a);
    const e = new THREE.PointLight(ENEMY, 22, 14, 1.8); e.position.set(0, 3.2, -4.4); s.add(e);
    // 床：発光グリッド
    const grid = canvasTex(256, 256, (g, w) => { g.fillStyle = '#04070c'; g.fillRect(0, 0, w, w); g.strokeStyle = '#19486a'; g.lineWidth = 2; g.strokeRect(0, 0, w, w); g.strokeStyle = '#0d2437'; g.lineWidth = 1; g.strokeRect(w / 2, 0, w, w); g.strokeRect(0, w / 2, w, w); });
    grid.wrapS = grid.wrapT = THREE.RepeatWrapping; grid.repeat.set(40, 40); grid.anisotropy = 4;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshBasicMaterial({ map: grid })); floor.rotation.x = -Math.PI / 2; floor.position.y = -1.6; s.add(floor);
    // 床の誘導灯リング（反応台を囲む）
    for (const [R, col, op] of [[6.6, 0x39d9ff, .55], [8.4, 0x1c7fa6, .35], [11, 0x123a52, .5]]) { const rg = new THREE.Mesh(new THREE.RingGeometry(R, R + .06, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, toneMapped: false })); rg.position.y = -1.58; s.add(rg); }
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, tk = new THREE.Mesh(new THREE.BoxGeometry(.05, .01, .5), new THREE.MeshBasicMaterial({ color: 0x39d9ff, transparent: true, opacity: .5, toneMapped: false })); tk.position.set(Math.cos(a) * 7.5, -1.58, Math.sin(a) * 7.5); tk.rotation.y = -a + Math.PI / 2; s.add(tk); }
    // 奥の壁のホロディスプレイ（周期表・波形・構造式）
    const wall = canvasTex(1024, 512, (g, w, h) => {
      g.fillStyle = '#060b13'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#123247'; g.lineWidth = 2; for (let x = 0; x <= w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      // 周期表のシルエット
      const cw = 22, ox = 300, oy = 120, rows = [[0, 17], [0, 1, 12, 13, 14, 15, 16, 17], [0, 1, 12, 13, 14, 15, 16, 17]];
      for (let rr = 0; rr < 6; rr++) { const cols = rows[rr] || [...Array(18).keys()]; for (const c of cols) { g.fillStyle = c < 2 ? '#ff8a5c' : c > 11 ? (c === 17 ? '#7fd8ff' : '#6ff7d2') : '#e6b657'; g.globalAlpha = .28 + ((rr * 7 + c * 3) % 5) * .1; g.fillRect(ox + c * (cw + 3), oy + rr * (cw + 3), cw, cw); } }
      g.globalAlpha = 1; g.fillStyle = '#6ff7d2'; g.font = '700 30px ui-monospace, monospace'; g.fillText('ELEMENTAL BOARD // REACTION FIELD 07', 300, 86);
      g.font = '18px ui-monospace, monospace'; g.fillStyle = '#4aa3c7';
      ['PV = nRT', 'ΔG = ΔH − TΔS', 'K = [C]^c[D]^d / [A]^a[B]^b', 'pH = −log[H⁺]', 'E = E° − (RT/nF) ln Q'].forEach((t, i) => g.fillText(t, 36, 150 + i * 44));
      g.strokeStyle = '#ffb000'; g.lineWidth = 2; g.beginPath(); for (let x = 0; x < 250; x++) { const y = 400 - 70 * Math.exp(-((x - 120) ** 2) / 1800) - 12 * Math.sin(x / 9); x ? g.lineTo(770 + x, y) : g.moveTo(770 + x, y); } g.stroke();
      g.strokeStyle = '#39d9ff'; g.beginPath(); for (let x = 0; x < 250; x++) { const y = 200 + 40 * Math.sin(x / 14) * Math.exp(-x / 160); x ? g.lineTo(770 + x, y) : g.moveTo(770 + x, y); } g.stroke();
      g.fillStyle = '#4aa3c7'; g.fillText('ACTIVATION ENERGY', 770, 440); g.fillText('SPECTRUM', 770, 130);
    });
    const wm = new THREE.Mesh(new THREE.PlaneGeometry(26, 13), new THREE.MeshBasicMaterial({ map: wall, fog: true })); wm.position.set(0, 4.6, -11); s.add(wm);
    // 同じ表示を台の奥の床にも投影する（見下ろし視点で画面上部に見える）
    const fp = new THREE.Mesh(new THREE.PlaneGeometry(15, 7.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: wall, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); fp.position.set(0, -1.57, -8.6); s.add(fp);
    // （天井の照明は見下ろしカメラと盤面の間に入って視界を遮るので置かない）
    // 培養槽（左右奥のガラス円筒）
    this.tubes = [];
    [[-5.6, -5.4, 0x39ffb0], [5.6, -5.4, 0xffb000], [-7.4, -8.2, 0xc070ff], [7.4, -8.2, 0x39d9ff]].forEach(([x, z, col]) => {
      const g = new THREE.Group(); g.position.set(x, -1.6, z); g.scale.setScalar(.62);
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(.75, .75, 5.2, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: .14, roughness: .05, metalness: .2, side: THREE.DoubleSide, depthWrite: false })); glass.position.y = 2.9;
      const liq = new THREE.Mesh(new THREE.CylinderGeometry(.62, .62, 3.6, 20), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .32, toneMapped: false })); liq.position.y = 2.2;
      const cap = new THREE.MeshStandardMaterial({ color: 0x141c26, roughness: .35, metalness: .9 });
      const b = new THREE.Mesh(new THREE.CylinderGeometry(.95, 1.05, .5, 24), cap); b.position.y = .25; const t = new THREE.Mesh(new THREE.CylinderGeometry(.9, .9, .35, 24), cap); t.position.y = 5.6;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.96, .03, 6, 32), new THREE.MeshBasicMaterial({ color: col, toneMapped: false })); ring.rotation.x = Math.PI / 2; ring.position.y = .52;
      g.add(liq, glass, b, t, ring); s.add(g); this.tubes.push({ x, z, col });
    });
  }

  // ---------- 反応台 ----------
  table() {
    const s = this.scene, metal = new THREE.MeshStandardMaterial({ color: 0x0d131c, roughness: .32, metalness: .9 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(8.9, .5, 8.2), metal); slab.position.y = -.31; s.add(slab);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.4, 1.2, 6), metal); leg.position.y = -1.1; s.add(leg);
    // 台の縁の発光ライン
    const edge = (w, d, col, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, .03, d), new THREE.MeshBasicMaterial({ color: col, toneMapped: false })); m.position.y = y; return m; };
    const e1 = edge(8.9, .04, ALLY, -.05); e1.position.z = 4.1; const e2 = edge(8.9, .04, ENEMY, -.05); e2.position.z = -4.1; s.add(e1, e2);
    const seam = edge(8.2, .05, 0xffd58a, -.045); s.add(seam);
    // 六角タイル（ガラス）と発光する縁
    const tileG = new THREE.CylinderGeometry(.552, .552, .1, 6), n = COLS * ROWS, m4 = new THREE.Matrix4(), col = new THREE.Color();
    this.tiles = new THREE.InstancedMesh(tileG, new THREE.MeshStandardMaterial({ roughness: .4, metalness: .45, envMapIntensity: .55 }), n);
    const rimG = new THREE.RingGeometry(.47, .525, 6); rimG.rotateX(-Math.PI / 2); rimG.rotateY(Math.PI / 6);
    this.rims = new THREE.InstancedMesh(rimG, new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: .55 }), n);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c, [x, z] = cellWorld(c, r), me = r >= 4;
      m4.makeTranslation(x, -.06, z); this.tiles.setMatrixAt(i, m4); this.tiles.setColorAt(i, col.setHex(me ? 0x0a2638 : 0x2e0f1c));
      m4.makeTranslation(x, .001, z); this.rims.setMatrixAt(i, m4); this.rims.setColorAt(i, col.setHex(me ? 0x1c7fa6 : 0x9c2348));
    }
    s.add(this.tiles, this.rims);
    this.hl = new THREE.Mesh(new THREE.CircleGeometry(.5, 6).rotateX(-Math.PI / 2).rotateY(Math.PI / 6), new THREE.MeshBasicMaterial({ color: 0x6ff7d2, transparent: true, opacity: .5, toneMapped: false, depthWrite: false }));
    this.hl.position.y = .012; this.hl.visible = false; s.add(this.hl);
  }
  /** ドラッグ中に指しているマスを光らせる（c が null で消す） */
  hover(c, r) { if (!this.ok) return; if (c == null) { this.hl.visible = false; return; } const [x, z] = cellWorld(c, r); this.hl.position.set(x, .012, z); this.hl.visible = true; }

  // ---------- 粒子 ----------
  particles() {
    const N = this.pN = 700, g = new THREE.BufferGeometry();
    this.pp = new Float32Array(N * 3); this.pc = new Float32Array(N * 3); this.pv = new Float32Array(N * 3); this.pl = new Float32Array(N); this.pm = new Float32Array(N); this.pi = 0;
    for (let i = 0; i < N; i++) this.pp[i * 3 + 1] = -99;
    g.setAttribute('position', new THREE.BufferAttribute(this.pp, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.pc, 3));
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ size: .16, map: this.dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.pts.frustumCulled = false; this.scene.add(this.pts); this.pcol = new THREE.Color();
    // 室内を漂う塵（常時）
    const dn = 160, dg = new THREE.BufferGeometry(), dp = new Float32Array(dn * 3); for (let i = 0; i < dn; i++) { dp[i * 3] = (Math.random() - .5) * 22; dp[i * 3 + 1] = Math.random() * 7; dp[i * 3 + 2] = (Math.random() - .5) * 20 - 2; }
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: .05, map: this.dotTex, color: 0x7fc8ff, transparent: true, opacity: .5, depthWrite: false, blending: THREE.AdditiveBlending })); this.scene.add(this.dust);
  }
  spark(x, y, z, hex, vx, vy, vz, life) {
    const i = this.pi = (this.pi + 1) % this.pN, c = this.pcol.setHex(hex);
    this.pp.set([x, y, z], i * 3); this.pv.set([vx, vy, vz], i * 3); this.pc.set([c.r, c.g, c.b], i * 3); this.pl[i] = this.pm[i] = life;
  }
  burst(x, y, z, hex, n = 14, sp = 2.2) { if (!this.ok) return; if (this.low) n = Math.ceil(n / 2); for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, b = Math.random() * 3.14 - 1.2, v = sp * (.4 + Math.random() * .7); this.spark(x, y, z, hex, Math.cos(a) * Math.cos(b) * v, Math.sin(b) * v + .8, Math.sin(a) * Math.cos(b) * v, .45 + Math.random() * .4); } }

  // ---------- 駒 ----------
  mkUnit(d) {
    const g = new THREE.Group(), cc = COST[d.cost] || COST[0], tc = d.team ? ENEMY : ALLY;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(.4, .44, .1, 6), new THREE.MeshStandardMaterial({ color: 0x10161f, roughness: .3, metalness: .95 })); base.position.y = .05;
    const ring = new THREE.Mesh(new THREE.RingGeometry(.27, .34, 6).rotateX(-Math.PI / 2).rotateY(Math.PI / 6), new THREE.MeshBasicMaterial({ color: cc, toneMapped: false })); ring.position.y = .103;
    const tr = new THREE.Mesh(new THREE.RingGeometry(.45, .5, 6).rotateX(-Math.PI / 2).rotateY(Math.PI / 6), new THREE.MeshBasicMaterial({ color: tc, toneMapped: false, transparent: true, opacity: .95 })); tr.position.y = .02;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(.36, .3, 1.7, 20, 1, true), new THREE.MeshBasicMaterial({ color: d.aura || tc, map: this.beamTex, transparent: true, opacity: .16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide, toneMapped: false })); beam.position.y = .95;
    const holder = new THREE.Group(); holder.position.y = MODEL_Y; const model = buildModel(d.id); model.scale.setScalar(.54 + (d.star - 1) * .07); holder.add(model);
    if (model.userData.flat) model.rotation.x = -.35;
    g.add(base, ring, tr, beam, holder);
    // ★の数だけ土台の周りを回る光点
    const orbs = []; for (let i = 1; i < d.star; i++) { const o = new THREE.Mesh(new THREE.SphereGeometry(.05, 8, 6), new THREE.MeshBasicMaterial({ color: d.star >= 3 ? 0x7df9ff : 0xffd166, toneMapped: false })); g.add(o); orbs.push(o); }
    g.scale.setScalar(.01);
    return { g, holder, model, beam, orbs, d, ph: Math.random() * 6.28, born: 0, lunge: null, hit: 0, cast: 0, dying: 0, spin: model.userData.flat ? .35 : .7 };
  }
  /** 盤上の駒を同期する。list: [{key,id,team,cost,star,aura,x,z,stun,dead}] */
  setUnits(list) {
    if (!this.ok) return;
    const seen = new Set();
    for (const d of list) {
      seen.add(d.key); let u = this.units.get(d.key);
      if (u && (u.d.id !== d.id || u.d.star !== d.star || u.d.team !== d.team)) { this.scene.remove(u.g); u = null; }
      if (!u) { u = this.mkUnit(d); this.units.set(d.key, u); this.scene.add(u.g); if (d.dead) { u.g.visible = false; u.dying = 9; } else if (d.pop) this.burst(d.x, MODEL_Y, d.z, COST[d.cost] || 0xffffff, 16, 1.8); }
      u.x = d.x; u.z = d.z; u.stun = d.stun;
    }
    for (const [k, u] of this.units) if (!seen.has(k)) { this.scene.remove(u.g); this.units.delete(k); }
  }
  pos(key) { const u = this.units.get(key); return u ? [u.x, MODEL_Y, u.z] : null; }

  // ---------- 戦闘演出 ----------
  attack(key, tkey, ranged, hex) {
    if (!this.ok) return; const a = this.units.get(key), b = this.units.get(tkey); if (!a || !b) return;
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
    if (ranged) this.shot([a.x, MODEL_Y, a.z], [b.x, MODEL_Y, b.z], hex, .16); else a.lunge = { dx: dx / L, dz: dz / L, t: 0 };
  }
  shot(a, b, hex, life) {
    const m = new THREE.Mesh(this.shotG || (this.shotG = new THREE.SphereGeometry(.07, 8, 6)), new THREE.MeshBasicMaterial({ color: hex, toneMapped: false }));
    this.scene.add(m); this.fx.push({ m, k: 'shot', a, b, t: 0, life, hex });
  }
  hitFx(key, crit) { if (!this.ok) return; const u = this.units.get(key); if (!u) return; u.hit = .16; if (crit) this.burst(u.x, MODEL_Y, u.z, 0xffd9a0, 8, 2.6); }
  castFx(key) { if (!this.ok) return; const u = this.units.get(key); if (!u) return; u.cast = .45; this.ringFx(u.x, u.z, .7, u.d.aura || 0x7df9ff, .4); this.burst(u.x, MODEL_Y + .2, u.z, u.d.aura || 0x7df9ff, 10, 1.6); }
  ringFx(x, z, rad, hex, life = .55) {
    if (!this.ok) return;
    const m = new THREE.Mesh(this.ringG || (this.ringG = new THREE.RingGeometry(.86, 1, 40).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    m.position.set(x, .06, z); this.scene.add(m); this.fx.push({ m, k: 'ring', rad, t: 0, life });
  }
  beamFx(a, b, hex) {
    if (!this.ok || !a || !b) return;
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), d = vb.clone().sub(va), L = d.length(); if (L < .01) return;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, L, 6, 1, true), new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    m.position.copy(va).add(vb).multiplyScalar(.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); this.scene.add(m); this.fx.push({ m, k: 'beam', t: 0, life: .32, own: true });
    this.burst(b[0], b[1], b[2], hex, 6, 1.5);
  }
  healFx(key) { if (!this.ok) return; const u = this.units.get(key); if (!u) return; for (let i = 0; i < 7; i++) this.spark(u.x + (Math.random() - .5) * .5, .3 + Math.random() * .5, u.z + (Math.random() - .5) * .5, 0x6dff9c, 0, 1.2 + Math.random(), 0, .7); }
  kill(key) { if (!this.ok) return; const u = this.units.get(key); if (!u || u.dying) return; u.dying = .001; this.burst(u.x, MODEL_Y, u.z, u.d.team ? ENEMY : ALLY, 22, 2.6); this.ringFx(u.x, u.z, .6, u.d.team ? ENEMY : ALLY, .35); }

  // ---------- カメラと座標変換 ----------
  resize(W, H) {
    if (!this.ok || W < 2 || H < 2) return;
    this.W = W; this.H = H; const narrow = W < 620;
    this.pr = Math.min(window.devicePixelRatio || 1, this.low ? 1 : narrow ? 1.75 : 2);
    this.r.setPixelRatio(this.pr); this.r.setSize(W, H, false); this.comp.setPixelRatio(this.pr); this.comp.setSize(W, H);
    const cam = this.cam; cam.aspect = W / H;
    // 画面が縦長なほど真上寄りから見下ろす（盤面を大きく使う）
    const asp = H / W, el = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(46 + (asp - .55) * 26, 46, 64));
    cam.fov = narrow ? 30 : 32;
    const tgt = new THREE.Vector3(0, .25, .12), dir = new THREE.Vector3(0, Math.sin(el), Math.cos(el));
    const pts = []; for (const x of [-3.85, 3.85]) for (const z of [-3.62, 3.62]) pts.push([x, 0, z]); pts.push([-3.4, 1.95, -3.2], [3.4, 1.95, -3.2], [0, 0, 3.75]);
    const mx = narrow ? .012 : .03, top = .03, bot = .025;
    const fits = dist => {
      cam.position.copy(tgt).addScaledVector(dir, dist); cam.lookAt(tgt); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      for (const p of pts) { V.set(...p).project(cam); if (Math.abs(V.x) > 1 - mx * 2 || V.y > 1 - top * 2 || V.y < -1 + bot * 2) return false; }
      return true;
    };
    let lo = 4, hi = 60; for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    fits(hi);
    // 盤面を枠の下寄せにして、空いた上側に研究室の奥を見せる
    V.set(0, 0, 3.75).project(cam); const slack = (V.y - (-1 + bot * 2)) / 2 * H; if (slack > 2) { cam.setViewOffset(W, H, 0, -slack, W, H); } else cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }
  /** ワールド座標 → ホスト要素内のピクセル座標 */
  project(x, y, z) { V.set(x, y, z).project(this.cam); return [(V.x + 1) / 2 * this.W, (1 - V.y) / 2 * this.H]; }
  /** (x,z) にある六角1マスの画面上の幅と高さ */
  cellSize(x, z) { const a = this.project(x - .5, 0, z), b = this.project(x + .5, 0, z), c = this.project(x, 0, z - .577), d = this.project(x, 0, z + .577); return [b[0] - a[0], d[1] - c[1]]; }

  // ---------- 毎フレーム ----------
  frame() {
    requestAnimationFrame(this.frame);
    if (!this.ok || document.hidden || this.paused) return;
    const dt = Math.min(.1, this.clock.getDelta()), t = this.t += dt;
    for (const u of this.units.values()) {
      const g = u.g; let ox = 0, oz = 0;
      if (u.dying) { u.dying += dt; const k = Math.max(0, 1 - u.dying / .45); g.scale.setScalar(k); g.position.y = -(1 - k) * .3; if (k <= 0) g.visible = false; }
      else { u.born = Math.min(1, u.born + dt * 4); const k = u.born; g.scale.setScalar(k * (2 - k)); }
      if (u.lunge) { u.lunge.t += dt; const k = Math.sin(Math.min(1, u.lunge.t / .2) * Math.PI) * .32; ox = u.lunge.dx * k; oz = u.lunge.dz * k; if (u.lunge.t > .2) u.lunge = null; }
      g.position.x = u.x + ox; g.position.z = u.z + oz;
      u.holder.position.y = MODEL_Y + Math.sin(t * 1.7 + u.ph) * .045;
      u.model.rotation.y += dt * (u.stun ? .05 : u.spin + (u.cast > 0 ? 9 : 0));
      let sc = 1; if (u.hit > 0) { u.hit -= dt; sc += Math.sin(u.hit * 40) * .1; } if (u.cast > 0) { u.cast -= dt; sc += Math.sin((.45 - u.cast) / .45 * Math.PI) * .32; }
      u.holder.scale.setScalar(sc);
      u.beam.material.opacity = (u.stun ? .06 : .15) + Math.sin(t * 3 + u.ph) * .03 + (u.cast > 0 ? .35 : 0);
      u.orbs.forEach((o, i) => { const a = t * 1.8 + i * Math.PI * 2 / u.orbs.length; o.position.set(Math.cos(a) * .47, .16, Math.sin(a) * .47); });
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]; f.t += dt; const k = Math.min(1, f.t / f.life);
      if (f.k === 'shot') { f.m.position.set(f.a[0] + (f.b[0] - f.a[0]) * k, f.a[1] + (f.b[1] - f.a[1]) * k + Math.sin(k * Math.PI) * .25, f.a[2] + (f.b[2] - f.a[2]) * k); if (!this.low) this.spark(f.m.position.x, f.m.position.y, f.m.position.z, f.hex, 0, 0, 0, .18); }
      else if (f.k === 'ring') { const s = .2 + (f.rad + .1) * k; f.m.scale.set(s, 1, s); f.m.material.opacity = .9 * (1 - k); }
      else f.m.material.opacity = 1 - k;
      if (k >= 1) { this.scene.remove(f.m); f.m.material.dispose(); if (f.own) f.m.geometry.dispose(); this.fx.splice(i, 1); }
    }
    // 粒子
    const N = this.pN; for (let i = 0; i < N; i++) { if (this.pl[i] <= 0) continue; this.pl[i] -= dt; const j = i * 3; if (this.pl[i] <= 0) { this.pp[j + 1] = -99; continue; } this.pv[j + 1] -= 3.2 * dt; this.pp[j] += this.pv[j] * dt; this.pp[j + 1] += this.pv[j + 1] * dt; this.pp[j + 2] += this.pv[j + 2] * dt; }
    this.pts.geometry.attributes.position.needsUpdate = true; this.pts.geometry.attributes.color.needsUpdate = true;
    // 培養槽の泡
    if (!this.low && Math.random() < .5) { const tb = this.tubes[(Math.random() * 4) | 0]; this.spark(tb.x + (Math.random() - .5) * .5, -1.2 + Math.random() * .6, tb.z + (Math.random() - .5) * .5, tb.col, 0, 2.6, 0, .8); }
    this.dust.rotation.y = t * .01;
    this.rims.material.opacity = .5 + Math.sin(t * 1.3) * .08;
    if (this.low) this.r.render(this.scene, this.cam); else this.comp.render(dt);
    // 重い端末では自動で画質を落とす（ブルームを切り、解像度を下げる）
    if (!this.low) { this.slow = dt > .034 ? this.slow + dt : Math.max(0, this.slow - dt * .5); if (this.slow > 2.5) { this.low = true; this.resize(this.W, this.H); } }
  }

  // ---------- 肖像（DOM のカードやベンチ用の静止画） ----------
  // 画面とは別の描画先に1体ずつ描いて画像化する。起動を止めないよう ui.js が少しずつ呼ぶ
  portrait(id, size = 224) {
    if (!this.ok) return '';
    let P = this.P;
    if (!P) {
      const sc = new THREE.Scene(); sc.environment = this.env; sc.environmentIntensity = .75;
      sc.add(new THREE.HemisphereLight(0xcfe6ff, 0x1a2230, .9)); const k = new THREE.DirectionalLight(0xffffff, 1.7); k.position.set(-2, 4, 5); sc.add(k);
      const rim = new THREE.DirectionalLight(0x6ff7d2, 1.3); rim.position.set(3, 1, -4); sc.add(rim);
      const cam = new THREE.OrthographicCamera(-1.12, 1.12, 1.12, -1.12, .1, 20); cam.position.set(0, .35, 6); cam.lookAt(0, 0, 0);
      const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4, colorSpace: THREE.SRGBColorSpace });
      const cv = document.createElement('canvas'); cv.width = cv.height = size;
      P = this.P = { sc, cam, rt, cv, g: cv.getContext('2d'), buf: new Uint8Array(size * size * 4), img: null };
      P.img = P.g.createImageData(size, size);
    }
    const r = this.r, m = buildModel(id); m.rotation.set(m.userData.flat ? -.2 : .32, m.userData.flat ? .25 : .65, 0); P.sc.add(m);
    const tm = r.toneMapping; r.toneMapping = THREE.NoToneMapping;
    r.setRenderTarget(P.rt); r.setClearColor(0x000000, 0); r.clear(); r.render(P.sc, P.cam);
    r.readRenderTargetPixels(P.rt, 0, 0, size, size, P.buf); r.setRenderTarget(null); r.toneMapping = tm; P.sc.remove(m);
    // WebGL は下から上、乗算済みアルファ → 上下を反転し、通常のアルファに戻す
    const d = P.img.data, b = P.buf, row = size * 4;
    for (let y = 0; y < size; y++) { const so = (size - 1 - y) * row, dof = y * row; for (let x = 0; x < row; x += 4) { const a = b[so + x + 3]; if (a) { const k = 255 / a; d[dof + x] = Math.min(255, b[so + x] * k); d[dof + x + 1] = Math.min(255, b[so + x + 1] * k); d[dof + x + 2] = Math.min(255, b[so + x + 2] * k); } else d[dof + x] = d[dof + x + 1] = d[dof + x + 2] = 0; d[dof + x + 3] = a; } }
    P.g.putImageData(P.img, 0, 0);
    return P.cv.toDataURL('image/webp', .9);
  }
}
