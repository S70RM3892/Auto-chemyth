// ============================================================
//  化身（物質の擬人化）フィギュア：手続き的インラインSVG
//  - 共通の頭・体・目のパーツ ＋ 物質ごとのモチーフ
//  - 色は実際の物質の色、シルエットは状態・分類から決める
//  - すべて1枚のSVGスプライト(<symbol>)にまとめ、<use> で参照する
// ============================================================

const LN = '#10142a'; // 輪郭線
const SW = 2.2;
const st = (w = SW, c = LN) => `stroke="${c}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
const P = (d, fill, x = '') => `<path d="${d}" fill="${fill}" ${x.includes('stroke=') ? '' : st()} ${x}/>`;
const C = (cx, cy, r, fill, x = '') => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${x.includes('stroke=') ? '' : st()} ${x}/>`;
const E = (cx, cy, rx, ry, fill, x = '') => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" ${x.includes('stroke=') ? '' : st()} ${x}/>`;
const L = (d, col, w = 2.5, x = '') => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${x}/>`;
const NS = 'stroke="none"';
const mir = d => d.replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g, (_, x, y) => `${+(100 - x).toFixed(2)} ${y}`);
// 4方向のきらめき
const spark = (x, y, r, col) => P(`M${x} ${y - r} Q${x + r * .18} ${y - r * .18} ${x + r} ${y} Q${x + r * .18} ${y + r * .18} ${x} ${y + r} Q${x - r * .18} ${y + r * .18} ${x - r} ${y} Q${x - r * .18} ${y - r * .18} ${x} ${y - r}Z`, col, `stroke="${LN}" stroke-width="1"`);
const bubble = (x, y, r, col = '#ffffff') => C(x, y, r, 'none', `stroke="${col}" stroke-width="1.6" opacity=".85"`) + C(x - r * .35, y - r * .35, r * .28, col, `${NS} opacity=".9"`);
const flameD = (x, y, w, h) => `M${x} ${y} C${x - w} ${y - h * .35} ${x - w * .4} ${y - h * .7} ${x} ${y - h} C${x + w * .15} ${y - h * .6} ${x + w * .9} ${y - h * .5} ${x + w * .7} ${y - h * .2} C${x + w * .6} ${y - h * .05} ${x + w * .3} ${y} ${x} ${y}Z`;

// ---------- 共通パーツ ----------
const HEADS = {
  round: [g => C(50, 44, 20, g), 46],
  small: [g => C(50, 46, 18, g), 48],
  drop: [g => P('M50 15 C57 26 70 33 70 47 A20 20 0 0 1 30 47 C30 33 43 26 50 15Z', g), 50],
  block: [g => `<rect x="30" y="25" width="40" height="38" rx="8" fill="${g}" ${st()}/>`, 46],
  gem: [g => P('M37 24 L63 24 L72 37 L50 66 L28 37Z', g) + L('M28 37 L72 37 M37 24 L44 37 L50 24 L56 37 L63 24 M44 37 L50 66 L56 37', '#ffffffaa', 1.2), 44],
  quartz: [g => P('M50 13 L66 25 L67 58 L50 67 L33 58 L34 25Z', g) + L('M50 13 L50 67 M34 25 L50 33 L66 25', '#ffffff99', 1.2), 46],
  blob: [g => P('M30 46 C26 30 40 22 50 24 C62 20 76 30 72 44 C76 56 66 66 50 64 C36 68 24 58 30 46Z', g), 46],
};
const BODIES = {
  robe: g => P('M22 101 C22 80 33 64 50 64 C67 64 78 80 78 101Z', g),
  armor: g => P('M22 101 C22 80 33 64 50 64 C67 64 78 80 78 101Z', g) + P('M17 82 L27 66 L41 70 L37 86Z', g) + P(mir('M17 82 L27 66 L41 70 L37 86Z'), g) + L('M41 76 L50 85 L59 76', LN, 1.6),
  wisp: g => P('M37 58 C29 70 36 82 48 86 C58 89 60 95 54 101 L64 101 C74 94 72 82 62 76 C57 72 63 66 63 58Z', g),
  drop: g => P('M24 101 C24 84 35 68 50 68 C65 68 76 84 76 101Z', g) + E(50, 99, 30, 4, '#ffffff22', NS),
  block: g => `<rect x="25" y="64" width="50" height="40" rx="5" fill="${g}" ${st()}/>` + L('M25 78 H75 M25 90 H75', '#00000033', 2),
  gem: g => P('M26 101 L33 70 L50 63 L67 70 L74 101Z', g) + L('M33 70 L42 101 M67 70 L58 101 M50 63 L50 101', '#ffffff66', 1.2),
  mound: g => P('M18 101 C20 84 34 68 50 68 C66 68 80 84 82 101Z', g),
  none: () => '',
};
const EYES = {
  round: (y, c, dx = 7.5) => [-1, 1].map(s => E(50 + s * dx, y, 3.4, 4.3, LN, NS) + C(50 + s * dx, y + 1, 2.2, c, NS) + C(50 + s * dx - 1.2, y - 1.6, 1.3, '#fff', NS)).join(''),
  sharp: (y, c, dx = 7.5) => [-1, 1].map(s => P(`M${50 + s * (dx - 4)} ${y - 1.5} L${50 + s * (dx + 4)} ${y - 3.5} L${50 + s * (dx + 3)} ${y + 2.5} L${50 + s * (dx - 3)} ${y + 2.5}Z`, LN, NS) + C(50 + s * dx, y, 1.7, c, NS)).join(''),
  calm: (y, c, dx = 7.5) => [-1, 1].map(s => L(`M${50 + s * dx - 3.6} ${y} Q${50 + s * dx} ${y + 3.4} ${50 + s * dx + 3.6} ${y}`, LN, 2.2)).join(''),
  glow: (y, c, dx = 7.5) => [-1, 1].map(s => E(50 + s * dx, y, 3.4, 4, c, `stroke="${LN}" stroke-width="1.3"`) + C(50 + s * dx, y - 1, 1.4, '#fff', NS)).join(''),
  dot: (y, c, dx = 7) => [-1, 1].map(s => C(50 + s * dx, y, 2.6, LN, NS) + C(50 + s * dx - .8, y - .9, .8, '#fff', NS)).join(''),
  angry: (y, c, dx = 7) => [-1, 1].map(s => C(50 + s * dx, y + 1, 2.8, c, `stroke="${LN}" stroke-width="1.2"`) + L(`M${50 + s * (dx + 5)} ${y - 5} L${50 + s * (dx - 3)} ${y - 2}`, LN, 2.2)).join(''),
  wide: (y, c, dx = 7.5) => [-1, 1].map(s => C(50 + s * dx, y, 4.2, '#fff', `stroke="${LN}" stroke-width="1.4"`) + C(50 + s * dx, y + .6, 2, c, NS)).join(''),
};
const MOUTH = {
  smile: y => L(`M46 ${y} Q50 ${y + 3.5} 54 ${y}`, LN, 1.8),
  flat: y => L(`M47 ${y + 1} L53 ${y + 1}`, LN, 1.8),
  o: y => E(50, y + 1.5, 1.8, 2.2, LN, NS),
  grin: y => P(`M44.5 ${y} Q50 ${y + 6} 55.5 ${y}Z`, '#fff', `stroke="${LN}" stroke-width="1.5"`),
  smirk: y => L(`M46 ${y + 1.5} Q51 ${y + 2.5} 54.5 ${y - .5}`, LN, 1.8),
  fang: y => L(`M45 ${y} Q50 ${y + 3} 55 ${y}`, LN, 1.8) + P(`M47.5 ${y + 1.1} L48.6 ${y + 3.6} L49.7 ${y + 1.6}Z`, '#fff', `stroke="${LN}" stroke-width=".8"`),
  frown: y => L(`M46 ${y + 2.5} Q50 ${y - .5} 54 ${y + 2.5}`, LN, 1.8),
  none: () => '',
};

// ---------- 物質ごとの設定 ----------
// c: [ハイライト, 基本色, 影], body, head, eye, ec(瞳), mouth, op(透明度), back/hair/front: SVG, aura: 背景の発光色
const F = {};
const def = (id, o) => { F[id] = o; };

// ===== コスト1 =====
def('H2', { // 無色の気体：淡い透明体。頭上にH–Hの二原子。爆鳴気の火花
  c: ['#ffffff', '#e3f3ff', '#a9cbe6'], body: 'wisp', head: 'small', eye: 'round', ec: '#3b82d6', mouth: 'smile', op: .82, aura: '#bfe6ff',
  hair: L('M38 22 L62 12', LN, 6) + L('M38 22 L62 12', '#e9f6ff', 3) + C(37, 23, 7, '#f4fbff') + C(63, 12, 7, '#f4fbff') + C(35, 21, 2, '#fff', NS) + C(61, 10, 2, '#fff', NS),
  front: spark(77, 40, 7, '#fff27a') + spark(23, 62, 4, '#fff27a'),
});
def('O2', { // 無色の気体：O=O の二重結合を双子のまげに。燃焼を助ける
  c: ['#ffffff', '#dff7ff', '#8fc3da'], body: 'wisp', head: 'round', eye: 'round', ec: '#ff7a1a', mouth: 'o', op: .85, aura: '#ffd0a0',
  back: C(30, 26, 9, '#e9fbff') + C(70, 26, 9, '#e9fbff') + C(30, 26, 3.5, 'none', `stroke="#ff9f1c" stroke-width="2"`) + C(70, 26, 3.5, 'none', `stroke="#ff9f1c" stroke-width="2"`),
  hair: L('M38 21 Q50 15 62 21', LN, 2) + L('M38 26 Q50 20 62 26', LN, 2),
  front: P(flameD(78, 66, 7, 16), '#ff9f1c') + P(flameD(78, 64, 3.5, 9), '#ffe27a', NS),
});
def('CH4', { // 無色の気体・有機：正四面体
  c: ['#ffffff', '#e6fff0', '#a3d9b7'], body: 'wisp', head: 'round', eye: 'calm', ec: '#2a8f55', mouth: 'smile', op: .85, aura: '#59d98c',
  back: L('M50 3 L30 27 L70 27Z M50 3 L54 31 M30 27 L54 31 L70 27', '#2fa463', 3) + L('M30 27 L70 27', '#2fa46399', 3, 'stroke-dasharray="3 3"'),
  hair: C(50, 4, 4.5, '#fff') + C(28, 27, 4.5, '#fff') + C(72, 27, 4.5, '#fff'),
  front: C(54, 31, 3.2, '#3a3a3a', `stroke="${LN}" stroke-width="1"`),
});
def('Zn', { // 青みがかった銀白色の金属。トタンの亜鉛めっき盾（スパングル模様）
  c: ['#f1f6fa', '#b7c3cc', '#6e7f8c'], body: 'armor', head: 'round', eye: 'round', ec: '#4f6d86', mouth: 'flat',
  hair: P('M29 42 C29 24 40 19 50 19 C60 19 71 24 71 42 L64 36 L50 33 L36 36Z', '#8fa2b0') + L('M50 19 L50 33', '#dfe8ef', 2),
  front: P('M66 66 L82 72 L82 86 L66 96 L52 86 L52 72Z', '#c9d4dc') + L('M58 74 L66 84 L76 75 M66 84 L66 94 M56 85 L62 80', '#8aa0b0', 1.4) + L('M60 72 L64 70', '#ffffff', 1.6),
});
def('Fe', { // 灰色の金属。不動態の被膜＝重装の兜と面頬
  c: ['#c3c8ce', '#80878f', '#454b53'], body: 'armor', head: 'round', eye: 'none', mouth: 'none', aura: '#ff9b4a',
  hair: P('M28 48 C27 26 39 18 50 18 C61 18 73 26 72 48 L72 54 L28 54Z', '#6a7179') + `<rect x="33" y="41" width="34" height="8" rx="3" fill="#1a1d22" ${st(1.4)}/>` + L('M37 45 H63', '#ff9b4a', 3) + L('M50 18 L50 38', '#9aa1a9', 3) + C(31, 52, 1.6, '#c8ccd2', NS) + C(69, 52, 1.6, '#c8ccd2', NS),
  front: C(22, 76, 1.6, '#c8ccd2', NS) + C(78, 76, 1.6, '#c8ccd2', NS) + C(30, 70, 1.6, '#c8ccd2', NS) + C(70, 70, 1.6, '#c8ccd2', NS),
});
def('I2', { // 黒紫色の固体（金属光沢の鱗片）。昇華して紫の蒸気
  c: ['#8a6aa8', '#3a2450', '#170c22'], body: 'gem', head: 'round', eye: 'glow', ec: '#c58bff', mouth: 'flat', aura: '#9b5de5',
  back: L('M24 40 C14 30 26 22 20 10', '#b57bff', 4, 'opacity=".75"') + L('M78 38 C88 28 74 20 82 8', '#b57bff', 4, 'opacity=".75"') + L('M62 14 C68 8 60 4 64 0', '#c9a0ff', 3, 'opacity=".6"'),
  hair: P('M30 40 L28 26 L38 32 L40 18 L48 28 L54 16 L58 28 L66 20 L66 32 L73 28 L70 40Z', '#2a1838') + L('M40 22 L44 30 M56 20 L57 28', '#a98bc4', 1.2),
});
def('NH3', { // 無色の気体・塩基：三角錐と非共有電子対
  c: ['#ffffff', '#e7ecff', '#a9b5e6'], body: 'wisp', head: 'round', eye: 'round', ec: '#3d5bd9', mouth: 'smile', op: .85, aura: '#5b8cff',
  hair: P('M50 6 L30 30 L56 34Z', '#9fb4ff') + P('M50 6 L56 34 L70 29Z', '#6d86e8') + C(50, 6, 4, '#4361ee') + C(30, 30, 3.2, '#fff') + C(70, 29, 3.2, '#fff') + C(56, 34, 3.2, '#fff'),
  back: C(45, 1, 1.9, '#4361ee', NS) + C(55, 1, 1.9, '#4361ee', NS),
});
def('AcOH', { // 無色の液体・有機酸：カルボキシ基の髪飾り。氷酢酸の雪片
  c: ['#ffffff', '#fbf3e6', '#d6c2a4'], body: 'drop', head: 'drop', eye: 'round', ec: '#d9485f', mouth: 'smirk', op: .9, aura: '#ff5d73',
  back: L('M66 36 L78 28 L86 36 M78 28 L78 16', '#3a3a3a', 3) + L('M81 29 L81 17', '#3a3a3a', 2) + C(86, 37, 4.2, '#ff5d73') + C(79.5, 14, 4.2, '#ff5d73') + C(66, 36, 3.2, '#3a3a3a', `stroke="${LN}" stroke-width="1"`),
  front: L('M24 32 L32 40 M32 32 L24 40 M22 36 H34 M28 30 V42', '#9ad8ff', 1.8),
});
def('CaCO3', { // 白色の固体（石灰石・大理石・貝殻）：鍾乳石の前髪、貝殻の紋章
  c: ['#ffffff', '#eeeae2', '#bdb5a6'], body: 'block', head: 'block', eye: 'calm', ec: '#7a6a55', mouth: 'smile',
  hair: P('M28 24 H72 V32 L68 32 L66 40 L63 32 L58 32 L56 44 L53 32 L47 32 L45 40 L42 32 L37 32 L35 42 L32 32 L28 32Z', '#d8d2c6'),
  front: P('M40 92 C40 80 60 80 60 92 Z', '#f5ece0') + L('M50 82 L50 92 M45 84 L47 92 M55 84 L53 92', '#b8a890', 1.2),
});
def('Ar', { // 無色の気体（放電で青紫色に発光）：閉殻のオクテット・リング
  c: ['#ffffff', '#e7defc', '#ab97df'], body: 'wisp', head: 'round', eye: 'glow', ec: '#b48cff', mouth: 'flat', op: .85, aura: '#9a7dff',
  back: E(50, 44, 34, 11, 'none', `stroke="#b48cff" stroke-width="2.4" transform="rotate(-18 50 44)"`),
  front: (() => { let s = ''; for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, x = 50 + 34 * Math.cos(a), y = 44 + 11 * Math.sin(a), r = -18 * Math.PI / 180; const X = 50 + (x - 50) * Math.cos(r) - (y - 44) * Math.sin(r), Y = 44 + (x - 50) * Math.sin(r) + (y - 44) * Math.cos(r); if (Math.sin(a) > -0.3) s += C(X.toFixed(1), Y.toFixed(1), 2.6, '#efe6ff', `stroke="#6c4fd0" stroke-width="1.2"`); } return s; })(),
});
def('Li', { // 銀白色の軽金属。炎色反応＝赤の炎髪。リチウムイオン電池の紋章
  c: ['#f3f5f8', '#c3c9d2', '#7d8693'], body: 'armor', head: 'small', eye: 'round', ec: '#e0213b', mouth: 'smile', aura: '#ff2a3d',
  hair: P('M31 44 C26 30 34 20 40 26 C40 14 50 8 52 20 C56 10 68 14 64 26 C72 24 74 36 69 44 C64 34 56 32 50 33 C42 32 35 36 31 44Z', '#ff2a3d') + P('M40 32 C40 24 46 20 48 26 C52 20 58 22 58 30 C54 28 46 28 40 32Z', '#ffb0a0', NS),
  front: `<rect x="41" y="74" width="18" height="11" rx="2" fill="#2d3545" ${st(1.4)}/><rect x="59" y="77" width="3" height="5" fill="#2d3545"/>` + `<rect x="43.5" y="76.5" width="4" height="6" fill="#6dff9c"/><rect x="48.5" y="76.5" width="4" height="6" fill="#6dff9c"/><rect x="53.5" y="76.5" width="3" height="6" fill="#6dff9c55"/>`,
});

// ===== コスト2 =====
def('Na', { // 銀白色の軟らかい金属。炎色反応＝黄色の炎髪。水と激しく反応
  c: ['#f4f6f9', '#c6ccd4', '#7f8894'], body: 'armor', head: 'round', eye: 'round', ec: '#e0a800', mouth: 'grin', aura: '#ffd60a',
  hair: P('M29 44 C22 28 32 16 38 24 C36 10 48 4 50 16 C54 4 66 8 62 22 C70 16 78 30 71 44 C66 34 58 31 50 32 C42 31 34 34 29 44Z', '#ffd60a') + P('M40 28 C40 20 46 16 48 22 C52 16 58 18 58 26 C54 25 46 25 40 28Z', '#fff7b0', NS),
  front: P('M16 72 C14 66 18 62 20 58 C22 62 26 66 24 72 C24 77 16 77 16 72Z', '#6fc3ff') + P(mir('M16 72 C14 66 18 62 20 58 C22 62 26 66 24 72 C24 77 16 77 16 72Z'), '#6fc3ff') + P('M10 88 C9 85 11 83 12 81 C13 83 15 85 14 88 A2 2 0 0 1 10 88Z', '#6fc3ff', `stroke="${LN}" stroke-width="1"`),
});
def('Br2', { // 赤褐色の液体（常温で液体の非金属単体）。赤褐色の蒸気
  c: ['#e0754a', '#a0361a', '#4e1206'], body: 'drop', head: 'drop', eye: 'glow', ec: '#ffb347', mouth: 'smirk', aura: '#c0583a',
  back: L('M22 46 C12 36 24 28 16 16', '#c0583a', 5, 'opacity=".7"') + L('M80 46 C90 36 78 26 86 14', '#c0583a', 5, 'opacity=".7"'),
  hair: P('M34 34 C40 30 44 34 46 40 C48 34 54 30 60 36 C64 32 68 34 69 40 C66 38 62 40 62 46 C60 42 56 42 54 46 C52 42 46 44 44 50 C42 44 36 42 31 42 C31 38 32 36 34 34Z', '#7a240c', NS),
  front: P('M32 62 C31 66 33 68 34 70 C35 68 37 66 36 62Z', '#a0361a', `stroke="${LN}" stroke-width="1.2"`) + P('M64 64 C63 68 65 71 66 73 C67 71 69 68 68 64Z', '#a0361a', `stroke="${LN}" stroke-width="1.2"`),
});
def('HCl', { // 無色の刺激臭の気体（湿った空気中で白煙）。金属を溶かしH₂の泡
  c: ['#ffffff', '#f0f4f8', '#b9c3cf'], body: 'wisp', head: 'round', eye: 'sharp', ec: '#ff5d73', mouth: 'fang', op: .88, aura: '#ff5d73',
  hair: P('M26 46 C18 34 26 20 36 22 C38 12 52 10 56 18 C64 10 78 18 74 30 C84 34 80 48 74 48 C72 38 64 32 50 32 C38 32 30 38 26 46Z', '#f7f9fb') + L('M30 42 C36 34 44 32 50 32 C58 32 66 36 70 42', '#ff5d73', 2.4),
  front: bubble(80, 72, 4.5) + bubble(86, 60, 3) + bubble(20, 70, 3.5),
});
def('Cu', { // 赤みのある金属光沢（銅色）。電気伝導：コイルと電流
  c: ['#ffc39a', '#c4693a', '#6e2e12'], body: 'armor', head: 'round', eye: 'round', ec: '#1a7f7a', mouth: 'smile', aura: '#ff9d5c',
  hair: P('M29 44 C27 26 38 18 50 18 C62 18 73 26 71 44 C66 34 58 28 48 30 C42 34 36 38 29 44Z', '#a5512a') + L('M44 22 C48 26 54 26 58 22', '#ffd0b0', 1.6),
  front: [0, 1, 2, 3].map(i => E(80 - i * .5, 70 + i * 6, 7, 3.2, 'none', `stroke="#e8935f" stroke-width="2.4"`)).join('') + P('M86 50 L80 60 L85 60 L78 70', 'none', `stroke="#fff27a" stroke-width="2.2" fill="none"`),
});
def('Al', { // 銀白色の軽金属：アルミ箔のマント（しわ）。テルミットの火花
  c: ['#ffffff', '#d7dce2', '#8f99a5'], body: 'armor', head: 'round', eye: 'round', ec: '#5c7a99', mouth: 'smile',
  back: P('M14 78 L18 58 L24 64 L26 46 L34 54 L38 36 L50 46 L62 36 L66 54 L74 46 L76 64 L82 58 L86 78Z', '#e8ecf0') + L('M18 58 L24 70 M26 46 L32 64 M38 36 L42 56 M62 36 L58 56 M74 46 L68 64 M82 58 L76 70', '#aab3bd', 1.2),
  hair: P('M30 40 C30 26 40 20 50 20 C60 20 70 26 70 40 C64 34 56 31 50 33 C44 31 36 34 30 40Z', '#b7c0ca'),
  front: spark(22, 90, 5, '#ffb703') + spark(80, 92, 4, '#ffb703'),
});
def('AgCl', { // 白色沈殿（感光性：光で黒変）
  c: ['#ffffff', '#eceff3', '#b6bcc6'], body: 'block', head: 'block', eye: 'round', ec: '#55606e', mouth: 'o',
  hair: P('M30 33 L30 30 C30 27 33 25 36 25 L64 25 C67 25 70 27 70 30 L70 33 C64 36 58 31 52 35 C46 31 40 37 30 33Z', '#59606d', `stroke="${LN}" stroke-width="1.5"`) + C(40, 28, 1.6, '#2a2e36', NS) + C(56, 29, 1.4, '#2a2e36', NS),
  back: L('M84 6 L72 18 M92 16 L78 24 M76 2 L68 14', '#fff27a', 2.2),
  front: C(36, 84, 2, '#7a808b', NS) + C(62, 92, 1.6, '#7a808b', NS),
});
def('H2O2', { // ごく淡い青色の液体：H–O–O–H のペルオキシ結合の額飾り。分解でO₂の泡
  c: ['#ffffff', '#d8ecff', '#8fb6de'], body: 'drop', head: 'drop', eye: 'round', ec: '#2f6fd6', mouth: 'smile', op: .9, aura: '#8fc9ff',
  hair: L('M22 34 L37 26 M37 26 L63 26 M63 26 L78 34', LN, 2.4) + C(37, 26, 6, '#ff6b6b') + C(63, 26, 6, '#ff6b6b') + C(21, 35, 3.8, '#fff') + C(79, 35, 3.8, '#fff') + L('M43 26 L57 26', '#fff', 1.2),
  front: bubble(80, 66, 4) + bubble(84, 54, 2.6) + bubble(18, 64, 3),
});
def('EtOH', { // 無色の液体・有機：淡い青色の炎で燃える。発酵＝ブドウの髪飾り
  c: ['#ffffff', '#f2f7ec', '#b9c9ad'], body: 'drop', head: 'drop', eye: 'calm', ec: '#59d98c', mouth: 'smile', op: .9, aura: '#6fb3ff',
  back: P(flameD(50, 20, 7, 20), '#7fb8ff', 'opacity=".9"') + P(flameD(50, 19, 3.5, 11), '#e0f0ff', `${NS}`),
  front: C(28, 34, 3, '#8e5bd6', `stroke="${LN}" stroke-width="1"`) + C(33, 34, 3, '#8e5bd6', `stroke="${LN}" stroke-width="1"`) + C(30.5, 38.5, 3, '#8e5bd6', `stroke="${LN}" stroke-width="1"`) + L('M31 30 L33 26', '#3fb96b', 1.6),
});
def('Ne', { // 無色の気体（放電で赤橙色に発光）：ネオン管の髪
  c: ['#ffffff', '#ffe5d8', '#e0a58a'], body: 'wisp', head: 'round', eye: 'glow', ec: '#ff5a1f', mouth: 'smile', op: .85, aura: '#ff5a1f',
  hair: L('M28 46 C20 30 34 14 44 22 C48 26 44 32 50 32 C56 32 52 22 58 18 C68 12 82 26 72 44', '#ff5a1f', 6) + L('M28 46 C20 30 34 14 44 22 C48 26 44 32 50 32 C56 32 52 22 58 18 C68 12 82 26 72 44', '#ffd3b8', 2),
  front: L('M78 60 L86 52 L86 68 L94 60', '#ff5a1f', 4) + L('M78 60 L86 52 L86 68 L94 60', '#ffd3b8', 1.4),
});
def('CaOH2', { // 白色の粉末（消石灰）。石灰水はCO₂で白濁
  c: ['#ffffff', '#f2f2ee', '#c2c4c0'], body: 'mound', head: 'round', eye: 'calm', ec: '#3d5bd9', mouth: 'o', aura: '#5b8cff',
  back: C(30, 28, 11, '#f7f7f4') + C(50, 20, 12, '#f7f7f4') + C(70, 28, 11, '#f7f7f4') + C(22, 44, 7, '#f7f7f4') + C(78, 44, 7, '#f7f7f4'),
  hair: P('M31 40 C30 32 36 28 42 30 C44 26 56 26 58 30 C64 28 70 32 69 40 C64 36 56 35 50 36 C44 35 36 36 31 40Z', '#ffffff', NS) + C(14, 22, 2.4, '#f2f2ee', 'opacity=".9"') + C(86, 18, 2, '#f2f2ee', 'opacity=".9"'),
  front: `<rect x="70" y="58" width="12" height="32" rx="6" fill="#e8f4ff66" ${st(1.4)}/>` + `<rect x="71.6" y="72" width="8.8" height="16.5" rx="4.4" fill="#f4f4f4" ${NS}/>` + C(76, 66, 1.5, '#fff', NS) + C(74, 62, 1, '#fff', NS) + L('M36 76 L42 72 L48 76 L54 72 L60 76', '#5b8cff', 2.6),
});

// ===== コスト3 =====
def('K', { // 銀白色の金属。炎色反応＝赤紫の炎髪（Naより激しい）
  c: ['#f1f3f7', '#bfc5cf', '#767f8c'], body: 'armor', head: 'round', eye: 'sharp', ec: '#c77dff', mouth: 'fang', aura: '#c77dff',
  hair: P('M28 46 C18 30 26 14 34 22 C30 6 44 0 46 14 C50 -2 62 2 60 16 C66 4 80 10 72 24 C82 24 82 40 72 46 C66 34 58 30 50 31 C42 30 34 34 28 46Z', '#b55dff') + P('M38 28 C36 18 42 12 45 20 C50 12 56 14 56 24 C60 20 64 24 62 30 C54 27 46 26 38 28Z', '#efd2ff', NS),
  front: spark(16, 62, 5, '#e0b0ff') + spark(86, 70, 4, '#e0b0ff'),
});
def('Cl2', { // 黄緑色・刺激臭の有毒な気体：渦巻くガスの角
  c: ['#f3ffc0', '#c2e05a', '#6f8f1e'], body: 'wisp', head: 'round', eye: 'sharp', ec: '#2a3a05', mouth: 'smirk', op: .92, aura: '#b6e34a',
  back: L('M30 32 C14 26 12 10 26 8 C34 8 34 18 28 18', '#b6e34a', 6) + L('M70 32 C86 26 88 10 74 8 C66 8 66 18 72 18', '#b6e34a', 6) + L('M20 70 C8 74 8 88 18 90', '#b6e34a', 5, 'opacity=".8"') + L('M80 72 C92 76 92 90 82 92', '#b6e34a', 5, 'opacity=".8"'),
  hair: P('M30 42 C30 28 40 22 50 22 C60 22 70 28 70 42 C64 36 58 34 54 38 C50 34 44 34 40 38 C36 36 32 38 30 42Z', '#9cc23a'),
});
def('HNO3', { // 無色の液体だが光で分解しNO₂で黄色み。褐色びんに保存。赤褐色のNO₂
  c: ['#e9b878', '#9a5a1c', '#4a2508'], body: 'none', head: 'none', eye: 'round', ec: '#ffd166', mouth: 'smirk', aura: '#ffd166', eyeY: 55,
  back: L('M50 14 C44 6 56 2 50 -6', '#c0583a', 5, 'opacity=".8"') + L('M60 16 C66 8 58 2 64 -4', '#c0583a', 4, 'opacity=".6"'),
  hair: P('M38 30 L38 40 C24 46 22 56 22 66 L22 100 L78 100 L78 66 C78 56 76 46 62 40 L62 30Z', 'url(#HNO3_b)', 'opacity=".95"') + `<rect x="36" y="16" width="28" height="15" rx="4" fill="#3a2a20" ${st()}/>` + L('M30 54 C28 62 28 80 30 92', '#ffffff66', 3) + `<rect x="30" y="74" width="40" height="18" rx="2" fill="#f4ead6" ${st(1.4)}/>` + `<text x="50" y="87.5" font-size="11" font-weight="900" text-anchor="middle" fill="#4a2508" font-family="sans-serif">HNO₃</text>`,
});
def('NaOH', { // 白色の固体（粒状）・潮解性でぬれた光沢。油脂をけん化しセッケンの泡
  c: ['#ffffff', '#f1f4f8', '#b7c0cc'], body: 'robe', head: 'round', eye: 'round', ec: '#2f5bd3', mouth: 'smile', aura: '#5b8cff',
  hair: P('M30 42 C28 26 40 20 50 20 C60 20 72 26 70 42 C62 30 50 30 44 36 C40 32 34 36 30 42Z', '#e6ebf2') + P('M62 24 C64 28 64 30 62 32 C60 30 60 28 62 24Z', '#bfe3ff', `stroke="${LN}" stroke-width="1"`),
  back: E(16, 50, 5, 3.5, '#f5f7fa') + E(84, 44, 5, 3.5, '#f5f7fa') + E(22, 26, 4.5, 3, '#f5f7fa'),
  front: L('M28 72 Q50 82 72 72', '#5b8cff', 4) + bubble(82, 80, 6, '#c3e6ff') + bubble(18, 86, 4, '#ffd6f0'),
});
def('Ag', { // 銀白色で最も光沢・伝導性が高い金属：銀鏡
  c: ['#ffffff', '#dde2e8', '#8e98a4'], body: 'armor', head: 'round', eye: 'sharp', ec: '#6c8aa8', mouth: 'smirk', aura: '#e6f0ff',
  hair: P('M28 46 C24 24 40 16 52 18 C66 18 76 30 72 46 C70 36 62 28 54 30 C46 28 40 32 36 40 C34 38 30 40 28 46Z', '#c8d0da') + L('M40 24 C46 20 56 20 62 24', '#fff', 1.6),
  front: E(74, 78, 10, 12, '#eef4ff') + E(74, 78, 7, 9, 'url(#Ag_a)', `stroke="${LN}" stroke-width="1"`) + L('M70 72 L76 70 M69 78 L79 74', '#fff', 1.8) + L('M74 90 L74 100', LN, 4),
});
def('BaSO4', { // 白色沈殿・酸にも溶けない。X線造影剤：背後にX線フィルム
  c: ['#ffffff', '#ebeef2', '#b0b6c0'], body: 'block', head: 'block', eye: 'calm', ec: '#55606e', mouth: 'flat',
  back: `<rect x="12" y="8" width="76" height="60" rx="4" fill="#132238" ${st()}/>` + L('M50 14 V62 M36 24 Q50 30 64 24 M33 32 Q50 38 67 32 M32 40 Q50 46 68 40 M34 48 Q50 54 66 48', '#cfe6ff', 2.2, 'opacity=".75"'),
  hair: `<rect x="28" y="23" width="44" height="9" rx="3" fill="#d6dbe2" ${st(1.6)}/>`,
  front: `<rect x="19" y="74" width="12" height="20" rx="2" fill="#dfe3e9" ${st(1.4)}/><rect x="69" y="74" width="12" height="20" rx="2" fill="#dfe3e9" ${st(1.4)}/>`,
});
def('C6H6', { // 無色の液体・有機：正六角形の環（共鳴）
  c: ['#ffffff', '#eefcf3', '#aed6bd'], body: 'drop', head: 'round', eye: 'round', ec: '#1f8a4c', mouth: 'smile', op: .92, aura: '#59d98c',
  back: P('M50 12 L77.7 28 L77.7 60 L50 76 L22.3 60 L22.3 28Z', 'none', `stroke="#2fa463" stroke-width="3.2"`) + L('M27 31 L50 18 M73 57 L73 31 M27 57 L50 70', '#2fa463', 2.2, 'opacity=".9"'),
  front: [[50, 12], [77.7, 28], [77.7, 60], [50, 76], [22.3, 60], [22.3, 28]].map(([x, y]) => C(x, y, 3, '#eafff1', `stroke="#1f6b3d" stroke-width="1.2"`)).join(''),
});
def('He', { // 無色の気体（放電で淡い黄〜桃色）。空気より軽い：風船。沸点最低の極低温
  c: ['#ffffff', '#fff0e2', '#e7c2a6'], body: 'wisp', head: 'small', eye: 'glow', ec: '#ffb88a', mouth: 'o', op: .88, aura: '#ffc9a3',
  back: L('M72 50 Q78 34 76 26', LN, 1.4) + P('M76 4 C88 4 90 18 82 24 L78 27 L74 27 L70 24 C62 18 64 4 76 4Z', '#ffc9a3') + L('M71 10 C72 7 75 6 77 6', '#fff', 1.8),
  front: L('M20 46 L28 46 M24 42 L24 50 M21 43 L27 49 M27 43 L21 49', '#cfefff', 1.6) + L('M22 70 L28 70 M25 67 L25 73', '#cfefff', 1.4),
});
def('Pb', { // 青みがかった灰色の重い金属。鉛蓄電池の極板（Pb / PbO₂）
  c: ['#b3bac6', '#6f7888', '#383e4a'], body: 'armor', head: 'round', eye: 'calm', ec: '#55606e', mouth: 'flat',
  back: `<rect x="8" y="36" width="22" height="34" rx="2" fill="#5c6474" ${st()}/><rect x="70" y="36" width="22" height="34" rx="2" fill="#6b4a3a" ${st()}/>` + L('M8 47 H30 M8 58 H30 M15 36 V70 M23 36 V70', '#2a2f3a', 1.3) + L('M70 47 H92 M70 58 H92 M77 36 V70 M85 36 V70', '#3a2418', 1.3) + `<rect x="15" y="28" width="8" height="8" fill="#2b2f38" ${st(1.2)}/><rect x="77" y="28" width="8" height="8" fill="#c0392b" ${st(1.2)}/>` + L('M16 22 H22', '#dfe4ea', 2) + L('M78 22 H84 M81 19 V25', '#ff8a7a', 2),
  hair: P('M29 42 C29 26 40 20 50 20 C60 20 71 26 71 42 L66 36 L58 33 L50 35 L42 33 L34 36Z', '#5a6272'),
});

// ===== コスト4 =====
def('F2', { // 淡黄色の気体。電気陰性度最大：鋭い棘のガスと電子をつかむ爪
  c: ['#ffffff', '#f7f8b4', '#c4c46a'], body: 'wisp', head: 'round', eye: 'sharp', ec: '#9aa000', mouth: 'smirk', op: .92, aura: '#f6f7a6',
  hair: P('M27 46 L18 30 L32 34 L28 14 L42 26 L50 6 L58 26 L72 14 L68 34 L82 30 L73 46 C66 36 58 32 50 33 C42 32 34 36 27 46Z', '#eef08a'),
  front: P('M74 70 L84 62 L82 70 L90 66 L84 76 L76 78Z', '#eef08a') + C(91, 58, 3, '#7df9ff', `stroke="${LN}" stroke-width="1"`) + `<text x="91" y="53" font-size="6" text-anchor="middle" fill="#7df9ff" font-weight="900" font-family="sans-serif">e⁻</text>`,
});
def('H2SO4', { // 無色で粘性の大きい油状の液体。脱水作用：砂糖を黒い炭素の柱に
  c: ['#ffffff', '#eef0f4', '#a9b0bd'], body: 'drop', head: 'drop', eye: 'sharp', ec: '#ff5d73', mouth: 'flat', op: .93, aura: '#ff5d73',
  back: P('M10 100 L12 60 L8 50 L14 40 L11 28 L18 18 L24 30 L22 44 L26 56 L22 70 L24 100Z', '#1c1c1f') + P(mir('M10 100 L12 60 L8 50 L14 40 L11 28 L18 18 L24 30 L22 44 L26 56 L22 70 L24 100Z'), '#1c1c1f') + C(16, 36, 1.6, '#5a5a60', NS) + C(84, 46, 1.6, '#5a5a60', NS) + C(18, 62, 1.4, '#5a5a60', NS),
  front: P('M30 60 C28 70 32 76 34 82 C36 76 38 70 36 60Z', '#eef0f4', `stroke="${LN}" stroke-width="1.4"`) + P('M64 62 C62 70 65 74 66 78 C67 74 70 70 68 62Z', '#eef0f4', `stroke="${LN}" stroke-width="1.4"`),
});
def('KMnO4', { // 黒紫色の結晶（金属光沢）。水溶液は赤紫色：針状結晶の冠と赤紫の雫
  c: ['#d04d9e', '#7b1660', '#2e0624'], body: 'gem', head: 'round', eye: 'glow', ec: '#ff6ec7', mouth: 'smirk', aura: '#c1125b',
  hair: P('M30 40 L28 12 L36 30 L40 4 L46 28 L52 0 L56 28 L62 6 L64 30 L72 14 L70 40 C62 34 56 32 50 33 C44 32 36 34 30 40Z', '#3d0a30') + L('M40 8 L44 26 M52 4 L54 26 M62 10 L62 28', '#c66aa8', 1.2),
  front: P('M22 76 C20 82 22 86 25 88 C28 86 30 82 28 76 L25 68Z', '#c1125b', `stroke="${LN}" stroke-width="1.3"`) + P('M74 80 C72 86 74 90 77 92 C80 90 82 86 80 80 L77 72Z', '#c1125b', `stroke="${LN}" stroke-width="1.3"`),
});
def('NG', { // 淡黄色の油状液体（硝酸エステル）：火のついた導火線
  c: ['#fffdf0', '#f6edb4', '#c9b964'], body: 'drop', head: 'drop', eye: 'wide', ec: '#c0392b', mouth: 'o', op: .95, aura: '#ff3d00',
  back: L('M50 16 C54 8 62 10 64 4 C66 0 72 0 74 4', '#5a4630', 2.6) + spark(76, 4, 7, '#ffcf3d') + C(76, 4, 2.4, '#ff3d00', NS),
  front: `<rect x="34" y="78" width="32" height="12" rx="2" fill="#d8402a" ${st(1.5)}/>` + L('M40 78 V90 M60 78 V90', '#7a1a10', 1.4) + L('M46 84 H54', '#ffe9a8', 2),
});
def('Pt', { // 灰白色の貴金属：触媒の白金網
  c: ['#ffffff', '#d3d2cc', '#8a8a84'], body: 'armor', head: 'round', eye: 'calm', ec: '#8a8a84', mouth: 'smile', aura: '#e6d9a8',
  back: C(50, 40, 33, '#2a2a3a55', `stroke="#d9d6c8" stroke-width="2.6"`) + L('M30 14 V66 M40 9 V71 M50 7 V73 M60 9 V71 M70 14 V66 M24 22 H76 M19 32 H81 M17 42 H83 M19 52 H81 M24 62 H76', '#d9d6c8', 1.2, 'opacity=".9"'),
  hair: P('M29 44 C26 26 38 18 50 18 C62 18 74 26 71 44 C66 36 60 32 54 33 L50 28 L46 33 C40 32 34 36 29 44Z', '#bdbcb4'),
  front: spark(16, 18, 4.5, '#ffe9a8') + spark(86, 20, 3.5, '#ffe9a8'),
});
def('SiO2', { // 無色透明の石英（水晶）：六角柱の結晶
  c: ['#ffffff', '#eef6ff', '#a9c2dc'], body: 'gem', head: 'quartz', eye: 'calm', ec: '#6f8fb0', mouth: 'smile', op: .9, aura: '#cfe6ff',
  back: P('M14 72 L18 50 L24 46 L28 52 L26 76Z', '#e8f3ff') + P('M76 76 L74 46 L80 38 L86 44 L86 72Z', '#e8f3ff') + P('M22 60 L22 36 L27 32 L32 36 L30 62Z', '#f4f9ff'),
  front: L('M80 40 L80 70 M24 48 L22 72', '#ffffff', 1.2),
});

// ===== コスト5 =====
def('Au', { // 金色の金属。展性・延性が最大：舞う金箔と冠
  c: ['#fff4b8', '#f0bf2a', '#8a5a00'], body: 'armor', head: 'round', eye: 'calm', ec: '#8a5a00', mouth: 'smile', aura: '#ffd700',
  hair: P('M29 44 C26 26 38 18 50 18 C62 18 74 26 71 44 C66 34 58 30 50 31 C42 30 34 34 29 44Z', '#d9a514') + P('M34 22 L36 8 L43 16 L50 4 L57 16 L64 8 L66 22Z', '#ffd700') + C(50, 12, 2.4, '#ff3b5c', `stroke="${LN}" stroke-width="1"`),
  front: P('M12 40 L20 36 L22 44 L14 47Z', '#ffe066', `stroke="${LN}" stroke-width="1.2"`) + P('M80 56 L89 54 L88 62 L80 63Z', '#ffe066', `stroke="${LN}" stroke-width="1.2"`) + P('M84 20 L90 16 L92 22 L86 25Z', '#ffe066', `stroke="${LN}" stroke-width="1.2"`),
});
def('Dia', { // 無色透明の共有結合の結晶：ブリリアントカットの宝石
  c: ['#ffffff', '#e2fbff', '#8fd3e6'], body: 'gem', head: 'gem', eye: 'glow', ec: '#7df9ff', mouth: 'smile', aura: '#9ff3ff',
  hair: '',
  front: spark(16, 22, 7, '#ffffff') + spark(84, 30, 5, '#ffffff') + spark(80, 86, 4, '#d8fbff') + spark(20, 80, 3.5, '#d8fbff'),
});
def('Aqua', { // 王水（濃硝酸:濃塩酸=1:3）。橙黄色：泡立つフラスコが金を溶かす
  c: ['#ffe08a', '#f39c12', '#a0520a'], body: 'none', head: 'none', eye: 'sharp', ec: '#7a2a00', mouth: 'fang', aura: '#ffb000', eyeY: 52,
  back: L('M46 18 C40 10 50 4 44 -4', '#ffb000', 4, 'opacity=".7"') + L('M56 16 C62 8 54 2 60 -6', '#ff8c00', 3.5, 'opacity=".6"'),
  hair: P('M42 16 L58 16 L58 40 C74 46 84 58 84 72 C84 90 68 100 50 100 C32 100 16 90 16 72 C16 58 26 46 42 40Z', '#e4eef8d0') + P('M17 62 C28 58 40 66 50 62 C60 58 72 66 83 62 C84 66 84 70 84 72 C84 90 68 100 50 100 C32 100 16 90 16 72 C16 68 16 66 17 62Z', 'url(#Aqua_b)', NS) + P('M42 16 L58 16 L58 40 C74 46 84 58 84 72 C84 90 68 100 50 100 C32 100 16 90 16 72 C16 58 26 46 42 40Z', 'none') + `<rect x="39" y="12" width="22" height="6" rx="2" fill="#dfe8f2" ${st(1.6)}/>` + L('M24 54 C21 60 21 70 24 78', '#ffffff99', 2.6) + bubble(40, 50, 3, '#fff6d0') + bubble(60, 46, 2.4, '#fff6d0') + bubble(68, 58, 2.8, '#fff6d0'),
  front: P('M62 76 L69 72 L76 76 L74 82 L64 82Z', '#ffd700', `stroke="${LN}" stroke-width="1.4"`) + L('M66 82 C66 85 68 86 68 88', '#ffd700', 1.6) + C(72, 70, 1.3, '#ffe066', NS) + C(60, 72, 1, '#ffe066', NS),
});
def('Nylon', { // 白色の合成繊維（ポリアミド）：糸の髪と糸巻き
  c: ['#ffffff', '#f6f3ec', '#c9c2b2'], body: 'robe', head: 'round', eye: 'calm', ec: '#9a8f7a', mouth: 'smile', aura: '#ffffff',
  back: L('M30 32 C14 40 12 60 20 80 C24 90 16 96 12 100', '#efeadf', 3) + L('M33 28 C18 38 18 60 26 78 C30 88 24 96 22 100', '#efeadf', 2) + L('M70 32 C86 40 88 60 80 80 C76 90 84 96 88 100', '#efeadf', 3) + L('M67 28 C82 38 82 60 74 78 C70 88 76 96 78 100', '#efeadf', 2),
  hair: P('M29 44 C26 24 40 18 50 18 C60 18 74 24 71 44 C68 34 62 28 56 30 C54 26 46 26 44 30 C38 28 32 34 29 44Z', '#ffffff') + L('M36 26 C40 22 46 21 50 22 M54 22 C58 21 62 22 66 26', '#c9c2b2', 1.2),
  front: `<rect x="40" y="76" width="20" height="4" rx="1" fill="#b08a5a" ${st(1.2)}/><rect x="42" y="80" width="16" height="10" fill="#ffffff" ${st(1.2)}/><rect x="40" y="90" width="20" height="4" rx="1" fill="#b08a5a" ${st(1.2)}/>` + L('M42 83 H58 M42 86.5 H58', '#c9c2b2', 1) + L('M58 84 C66 82 70 76 76 74', '#ffffff', 1.6),
});
def('Cs', { // 金色を帯びた銀白色の金属。炎色反応＝青紫の炎冠
  c: ['#fff6d8', '#e2cd8a', '#8f7a3e'], body: 'armor', head: 'round', eye: 'sharp', ec: '#5a4cff', mouth: 'smirk', aura: '#6a5cff',
  hair: P('M27 46 C16 28 24 10 34 18 C32 2 44 -4 47 10 C50 -6 62 -2 60 12 C68 -2 82 6 74 20 C84 22 84 40 73 46 C66 34 58 30 50 31 C42 30 34 34 27 46Z', '#5b4dff') + P('M36 30 C34 18 42 10 46 18 C50 8 58 10 58 22 C62 16 68 22 64 30 C56 27 44 26 36 30Z', '#cfc8ff', NS) + P('M18 70 L30 62 L36 72Z', '#e2cd8a') + P(mir('M18 70 L30 62 L36 72Z'), '#e2cd8a'),
  front: spark(14, 48, 5, '#a99cff') + spark(88, 52, 5, '#a99cff'),
});

// ===== PvE の敵 =====
def('m_dust', {
  c: ['#a89c8a', '#6e6556', '#3b352c'], body: 'none', head: 'blob', eye: 'angry', ec: '#ffd166', mouth: 'frown',
  back: P('M22 60 L14 54 L24 52 L18 40 L28 44 L26 30 L36 36 L40 22 L46 32 L54 20 L58 32 L68 22 L68 36 L80 32 L74 44 L86 46 L76 54 L84 62 L72 62 L74 74 L62 68 L56 80 L50 70 L42 80 L38 68 L26 74 L28 62Z', '#5a5246'),
  front: C(22, 84, 3, '#6e6556') + C(76, 86, 2.4, '#6e6556') + C(64, 94, 1.8, '#6e6556'),
});
def('m_rust', {
  c: ['#d8794a', '#9b3f1c', '#4e1a08'], body: 'block', head: 'blob', eye: 'angry', ec: '#ffb347', mouth: 'frown',
  hair: P('M34 30 L40 24 L46 30 L52 22 L58 30 L66 26 L66 34 L56 34 L50 30 L42 34Z', '#7a2e12') + L('M38 58 L44 52 L42 46 M62 56 L58 50', '#4e1a08', 1.4),
  front: P('M28 72 L34 68 L38 74 L32 78Z', '#c45a2a', `stroke="${LN}" stroke-width="1.2"`) + P('M62 84 L70 80 L72 88 L64 90Z', '#c45a2a', `stroke="${LN}" stroke-width="1.2"`),
});
def('m_rain', {
  c: ['#c8cdd6', '#8a92a0', '#4a505c'], body: 'none', head: 'none', eye: 'angry', ec: '#e6f06a', mouth: 'frown', eyeY: 44,
  hair: P('M22 56 C10 56 10 38 24 38 C24 24 40 18 50 26 C58 14 78 18 78 34 C92 34 92 56 78 56Z', 'url(#m_rain_a)'),
  front: [[28, 70], [44, 78], [60, 70], [74, 80], [36, 90], [56, 92]].map(([x, y]) => P(`M${x} ${y - 7} C${x + 3} ${y - 2} ${x + 4} ${y + 1} ${x} ${y + 3} C${x - 4} ${y + 1} ${x - 3} ${y - 2} ${x} ${y - 7}Z`, '#d9f06a', `stroke="${LN}" stroke-width="1.2"`)).join(''),
});
def('m_smog', {
  c: ['#e8a86a', '#a0582a', '#4e2410'], body: 'none', head: 'none', eye: 'angry', ec: '#ff3b3b', mouth: 'fang', eyeY: 50, aura: '#ff7a3d',
  back: C(78, 14, 10, '#ffcf3d', 'opacity=".75"'),
  hair: P('M10 70 C-2 66 2 48 16 50 C12 34 28 26 38 34 C42 18 62 16 66 30 C76 22 94 30 88 46 C100 50 98 70 86 70 C88 84 70 90 62 82 C56 92 40 92 36 82 C26 90 8 84 10 70Z', 'url(#m_smog_a)') + L('M22 64 C30 60 40 66 50 62 C60 58 70 64 80 60', '#4e241066', 2),
  front: L('M8 92 C24 86 40 96 56 90 C72 84 84 94 96 88', '#a0582a', 4, 'opacity=".7"'),
});

// ---------- 組み立て ----------
const grads = [];
function build(id) {
  const o = F[id]; if (!o) return '';
  const [l, m, d] = o.c, A = `url(#${id}_a)`, Bg = `url(#${id}_b)`;
  grads.push(`<radialGradient id="${id}_a" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="${l}"/><stop offset=".55" stop-color="${m}"/><stop offset="1" stop-color="${d}"/></radialGradient>`,
    `<linearGradient id="${id}_b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${m}"/><stop offset="1" stop-color="${d}"/></linearGradient>`);
  const head = o.head === 'none' ? null : HEADS[o.head || 'round'];
  const ey = o.eyeY || (head ? head[1] : 46);
  const body = (BODIES[o.body || 'robe'] || BODIES.robe)(Bg);
  const shell = body + (head ? head[0](A) : '');
  const face = (o.eye && o.eye !== 'none' ? EYES[o.eye](ey, o.ec || LN) : '') + (o.mouth ? MOUTH[o.mouth](ey + 8) : '') +
    (o.eye && o.eye !== 'none' && !id.startsWith('m_') ? E(50 - 13, ey + 5.5, 3, 1.6, '#ff7a8a55', NS) + E(50 + 13, ey + 5.5, 3, 1.6, '#ff7a8a55', NS) : '');
  return `<symbol id="fig-${id}" viewBox="0 0 100 100">` + (o.back || '') + (o.op ? `<g opacity="${o.op}">${shell}</g>` : shell) +
    (head ? C(43, 35, 4.5, '#ffffff', `${NS} opacity=".35"`) : '') + (o.hair || '') + face + (o.front || '') + '</symbol>';
}

let SPRITE = null;
export function spriteMarkup() {
  if (SPRITE) return SPRITE;
  grads.length = 0;
  const syms = Object.keys(F).map(build).join('');
  SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" id="figSprite" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"><defs>${grads.join('')}${syms}</defs></svg>`;
  return SPRITE;
}
/** スプライトを document に一度だけ挿入する */
export function installFigures(doc = document) {
  if (doc.getElementById('figSprite')) return;
  doc.body.insertAdjacentHTML('afterbegin', spriteMarkup());
}
/** ユニットIDの化身SVG（<use>参照） */
export function figure(id, cls = 'fig', vb = '0 0 100 100') {
  return `<svg class="${cls}" viewBox="${vb}" aria-hidden="true"><use href="#fig-${F[id] ? id : 'm_dust'}"/></svg>`;
}
/** 背景発光色（情報パネルなどで使用） */
export const auraOf = id => (F[id] && F[id].aura) || '#7d8bb8';
export const FIGURE_IDS = Object.keys(F);

// ---------- シナジー（族・性質）アイコン ----------
const I = (b, fill) => `<svg class="ti" viewBox="0 0 24 24" aria-hidden="true" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${b}</svg>`;
const arrowsIn = [0, 90, 180, 270].map(a => `<g transform="rotate(${a} 12 12)"><path d="M12 2.5V8"/><path d="M9.5 5.8 12 8.3 14.5 5.8"/></g>`).join('');
const arrowsOut = [45, 135, 225, 315].map(a => `<g transform="rotate(${a} 12 12)"><path d="M12 8V2.8"/><path d="M9.5 5.2 12 2.7 14.5 5.2"/></g>`).join('');
const octet = r => [...Array(8)].map((_, i) => { const a = i * Math.PI / 4 + Math.PI / 8; return `<circle cx="${(12 + r * Math.cos(a)).toFixed(2)}" cy="${(12 + r * Math.sin(a)).toFixed(2)}" r="1.6" fill="currentColor" stroke="none"/>`; }).join('');
export const TRAIT_ICON = {
  alkali: I('<path d="M12 2.5c1.2 4 6.5 6.2 6.5 11.5a6.5 6.5 0 0 1-13 0c0-3.2 1.8-4.7 3-6.7.2 2.3 1.3 3.4 2.4 3.6-.6-3.2.1-5.8 1.1-8.4z" fill="currentColor" stroke="none"/>'),
  halogen: I('<circle cx="8" cy="13" r="5"/><circle cx="16" cy="13" r="5"/><path d="M17 3.5h5" stroke-width="2.4"/>'),
  noble: I('<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>' + octet(8.6)),
  trans: I('<g fill="currentColor" stroke="none"><ellipse cx="7.5" cy="7.5" rx="2.6" ry="4.4" transform="rotate(-45 7.5 7.5)"/><ellipse cx="16.5" cy="16.5" rx="2.6" ry="4.4" transform="rotate(-45 16.5 16.5)"/><ellipse cx="16.5" cy="7.5" rx="2.6" ry="4.4" transform="rotate(45 16.5 7.5)"/><ellipse cx="7.5" cy="16.5" rx="2.6" ry="4.4" transform="rotate(45 7.5 16.5)"/></g>'),
  amph: I('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/><path d="M5.5 12h3M15.5 12h3M17 10.5v3" stroke-width="1.6"/>'),
  metal: I('<path d="M3 18 6.5 9h11L21 18z" fill="currentColor" fill-opacity=".35"/><path d="M6.5 9 9 12.5h6L17.5 9M9 12.5 8 18M15 12.5l1 5.5"/>'),
  acid: I('<path d="M12 2.5c3 4.6 6.5 8 6.5 12a6.5 6.5 0 0 1-13 0c0-4 3.5-7.4 6.5-12z" fill="currentColor" stroke="none"/><path d="M9 14.5a3 3 0 0 0 3 3" stroke="#0b1020" stroke-width="1.8"/>'),
  base: I('<circle cx="9" cy="14" r="5.5"/><circle cx="17" cy="8" r="3.6"/><circle cx="18" cy="17.5" r="2.4"/><path d="M6.5 12.5a3 3 0 0 1 2.2-1.8" stroke-width="1.5"/>'),
  organic: I('<path d="M2.5 15.5 7 9l5 6.5L17 9l4.5 6.5"/><circle cx="7" cy="9" r="1.9" fill="currentColor"/><circle cx="12" cy="15.5" r="1.9" fill="currentColor"/><circle cx="17" cy="9" r="1.9" fill="currentColor"/>'),
  oxid: I('<circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/>' + arrowsIn),
  reduc: I('<circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/>' + arrowsOut),
  precip: I('<path d="M5 3v15a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V3"/><path d="M5.5 15h13v3.2a2.5 2.5 0 0 1-2.5 2.5H8a2.5 2.5 0 0 1-2.5-2.5z" fill="currentColor"/><path d="M12 5v6M9.6 8.8 12 11.2l2.4-2.4"/>'),
  gas: I('<path d="M7 21c-2-3 2-5 0-8s2-5 0-8M12 20c-2-3 2-5 0-8s2-5 0-8M17 21c-2-3 2-5 0-8s2-5 0-8"/>'),
  coval: I('<path d="M3.5 9 7.5 3.5h9L20.5 9 12 21z" fill="currentColor" fill-opacity=".3"/><path d="M3.5 9h17M9 9l3 12 3-12M7.5 3.5 9 9l3-5.5L15 9l1.5-5.5"/>'),
};
