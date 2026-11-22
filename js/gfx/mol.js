// ============================================================
//  物質の立体モデル
//  分子は球棒モデル、金属は結晶格子（単位格子）、貴ガスは電子殻モデル、
//  イオン性の物質は陽イオン＋多原子イオン（または NaCl 型格子）として組み立てる。
//  配色は CPK 配色を基本に、金属は実物の色。
// ============================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 元素：[色, 表示半径]
const EL = {
  H: [0xdde2ea, .27], C: [0x3a3f48, .4], N: [0x3d6bff, .38], O: [0xff4336, .36], F: [0xd8f26a, .33], Cl: [0x4de06a, .46],
  Br: [0xa63a1e, .5], I: [0x7d33d6, .56], S: [0xffd23d, .46], Si: [0xc2a070, .46],
  Li: [0xcfd3da, .46], Na: [0xd3d7de, .5], K: [0xc8ccd6, .54], Cs: [0xdccb8c, .58], Ca: [0xe2e9ee, .56], Ba: [0xc9d9c9, .62], Mn: [0x9d42dc, .46],
  Zn: [0xa9bbd6, .46], Fe: [0x7d8794, .46], Cu: [0xdd7a40, .46], Al: [0xd8dde3, .46], Ag: [0xf0f3f6, .46], Pb: [0x6d7482, .5], Pt: [0xe6e6de, .46], Au: [0xffc12b, .46],
  P: [0xffa24a, .46], Mg: [0xd9dee6, .5], Cr: [0x9fb3c8, .46], Hg: [0xdfe6ee, .5],
  X: [0x3b352f, .5],
};
const BOND = 0x8b95a6, FRAME = 0x566070;
const T4 = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map(v => v.map(x => x / Math.sqrt(3)));
const A = (e, x, y, z) => ({ e, p: [x, y, z] });
const add = (p, d, k = 1) => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
const di = (a, b, h, o = 1) => ({ atoms: [A(a, -h, 0, 0), A(b, h, 0, 0)], bonds: [[0, 1, o]] });

// 中心原子 X に O が4つ正四面体（SO₄, MnO₄ など）。dbl: 二重結合にする番号、oh: H を付ける番号
function tetraOxo(x, c, L, dbl = [], oh = []) {
  const atoms = [A(x, ...c)], bonds = [];
  T4.forEach((d, i) => {
    atoms.push({ e: 'O', p: add(c, d, L) }); const oi = atoms.length - 1; bonds.push([0, oi, dbl.includes(i) ? 2 : 1]);
    if (oh.includes(i)) { atoms.push({ e: 'H', p: add(add(c, d, L + .55), [0, .55, 0]) }); bonds.push([oi, atoms.length - 1, 1]); }
  });
  return { atoms, bonds };
}
const join = (...ms) => { const atoms = [], bonds = []; for (const m of ms) { const o = atoms.length; atoms.push(...m.atoms); for (const b of m.bonds) bonds.push([b[0] + o, b[1] + o, b[2]]); } return { atoms, bonds }; };
const shift = (m, d) => ({ atoms: m.atoms.map(a => ({ e: a.e, p: add(a.p, d) })), bonds: m.bonds });

// ---- 結晶格子 ----
const CUBE_E = []; { const cs = []; for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) cs.push([x, y, z]); for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) { const d = cs[i].filter((v, k) => v !== cs[j][k]).length; if (d === 1) CUBE_E.push([i, j, 0]); } CUBE_E.cs = cs; }
function bcc(e) { // 体心立方格子：頂点8＋中心1（配位数8）
  const atoms = CUBE_E.cs.map(c => A(e, ...c)); atoms.push(A(e, 0, 0, 0));
  return { atoms, bonds: [...CUBE_E, ...CUBE_E.cs.map((_, i) => [8, i, 1])], metal: true };
}
function fcc(e) { // 面心立方格子：頂点8＋面心6（配位数12）
  const atoms = CUBE_E.cs.map(c => A(e, ...c)), bonds = [...CUBE_E];
  for (let k = 0; k < 3; k++) for (const s of [-1, 1]) {
    const p = [0, 0, 0]; p[k] = s; atoms.push(A(e, ...p)); const fi = atoms.length - 1;
    CUBE_E.cs.forEach((c, i) => { if (c[k] === s) bonds.push([fi, i, 0]); });
  }
  return { atoms, bonds, metal: true };
}
function hcp(e) { // 六方最密構造：上下の六角形（頂点6＋中心1）と中段の3原子
  const atoms = [], bonds = [], R = 1.15;
  for (const y of [-1, 1]) { const o = atoms.length; for (let i = 0; i < 6; i++) atoms.push(A(e, R * Math.cos(i * Math.PI / 3), y, R * Math.sin(i * Math.PI / 3))); atoms.push(A(e, 0, y, 0)); for (let i = 0; i < 6; i++) bonds.push([o + i, o + (i + 1) % 6, 0]); }
  for (let i = 0; i < 6; i++) bonds.push([i, i + 7, 0]);
  for (let i = 0; i < 3; i++) { const a = Math.PI / 6 + i * 2 * Math.PI / 3; atoms.push(A(e, .66 * Math.cos(a), 0, .66 * Math.sin(a))); }
  return { atoms, bonds, metal: true };
}
function rock(a, b) { // NaCl 型：陽イオンと陰イオンが交互に並ぶ
  const atoms = [], bonds = [], ix = (x, y, z) => (x + 1) * 9 + (y + 1) * 3 + (z + 1);
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) atoms.push(A((x + y + z) & 1 ? b : a, x, y, z));
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    if (x < 1) bonds.push([ix(x, y, z), ix(x + 1, y, z), 0]); if (y < 1) bonds.push([ix(x, y, z), ix(x, y + 1, z), 0]); if (z < 1) bonds.push([ix(x, y, z), ix(x, y, z + 1), 0]);
  }
  return { atoms, bonds, small: .62 };
}
const OH = (x, s) => ({ atoms: [A('O', x, 0, 0), A('H', x + s * .85, .4, 0)], bonds: [[0, 1, 1]] });
const HNO3 = () => ({ atoms: [A('N', 0, 0, 0), A('O', 1.2, .25, 0), A('O', -.65, 1.05, 0), A('O', -.7, -1, 0), A('H', -1.62, -.8, 0)], bonds: [[0, 1, 2], [0, 2, 1], [0, 3, 1], [3, 4, 1]] });

// ダイヤモンド型構造（C, Si）：各原子が正四面体の頂点方向に4本の共有結合
function diamond(e, L) {
  const atoms = [A(e, 0, 0, 0)], bonds = [];
  T4.forEach(d => { atoms.push({ e, p: d.map(x => x * L) }); const i = atoms.length - 1; bonds.push([0, i, 1]);
    T4.forEach(f => { if (f[0] * d[0] + f[1] * d[1] + f[2] * d[2] > .9) return; atoms.push({ e, p: add(atoms[i].p, f, -L) }); bonds.push([i, atoms.length - 1, 1]); }); });
  return { atoms, bonds, gem: true };
}
// ベンゼン環＋置換基。subs[i](環の炭素番号, 外向き単位ベクトル, atoms, bonds) で置換基を足す。指定のない位置は H
function benz(subs = {}) {
  const atoms = [], bonds = [];
  for (let i = 0; i < 6; i++) { const a = Math.PI / 2 - i * Math.PI / 3; atoms.push(A('C', 1.4 * Math.cos(a), 1.4 * Math.sin(a), 0)); }
  for (let i = 0; i < 6; i++) {
    bonds.push([i, (i + 1) % 6, 1]); const a = Math.PI / 2 - i * Math.PI / 3, d = [Math.cos(a), Math.sin(a), 0];
    if (subs[i]) subs[i](i, d, atoms, bonds); else { atoms.push({ e: 'H', p: add(atoms[i].p, d, 1.05) }); bonds.push([i, atoms.length - 1, 1]); }
  }
  return { atoms, bonds, ring: .86 };
}
const sOH = (i, d, at, bo) => { at.push({ e: 'O', p: add(at[i].p, d, 1.36) }); const o = at.length - 1; at.push({ e: 'H', p: add(add(at[i].p, d, 1.9), [d[1] * .75, -d[0] * .75, 0]) }); bo.push([i, o, 1], [o, o + 1, 1]); };
const sNH2 = (i, d, at, bo) => { at.push({ e: 'N', p: add(at[i].p, d, 1.4) }); const n = at.length - 1; for (const s of [1, -1]) { at.push({ e: 'H', p: add(add(at[i].p, d, 1.9), [d[1] * .85 * s, -d[0] * .85 * s, 0]) }); bo.push([n, at.length - 1, 1]); } bo.push([i, n, 1]); };
const sCOOH = (i, d, at, bo) => { const c = add(at[i].p, d, 1.5), n = [d[1], -d[0], 0]; at.push({ e: 'C', p: c }); const k = at.length - 1; at.push({ e: 'O', p: add(add(c, d, .65), n, 1.05) }, { e: 'O', p: add(add(c, d, .65), n, -1.05) }); bo.push([i, k, 1], [k, k + 1, 2], [k, k + 2, 1]); };
const bent = (c, o, w, h, ord = 2) => ({ atoms: [A(c, 0, h, 0), A(o, w, -h, 0), A(o, -w, -h, 0)], bonds: [[0, 1, ord], [0, 2, ord === 2 && c === 'N' ? 1 : ord]] });
const octa = (c, o, L) => ({ atoms: [A(c, 0, 0, 0), ...[[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(d => ({ e: o, p: d.map(x => x * L) }))], bonds: [1, 2, 3, 4, 5, 6].map(i => [0, i, 1]) });
const CO3 = x => ({ atoms: [A('C', x, 0, 0), ...[0, 1, 2].map(i => A('O', x + 1.28 * Math.cos(i * 2.094), 1.28 * Math.sin(i * 2.094), 0))], bonds: [[0, 1, 2], [0, 2, 1], [0, 3, 1]] });
const ion = (e, x, y = 0, z = 0) => ({ atoms: [A(e, x, y, z)], bonds: [] });

// ---- 各物質の構造 ----
const M = {
  H2: () => di('H', 'H', .48), O2: () => di('O', 'O', .62, 2), HCl: () => di('H', 'Cl', .66),
  F2: () => di('F', 'F', .72), Cl2: () => di('Cl', 'Cl', 1), Br2: () => di('Br', 'Br', 1.14), I2: () => di('I', 'I', 1.33),
  CH4: () => ({ atoms: [A('C', 0, 0, 0), ...T4.map(d => ({ e: 'H', p: d.map(x => x * 1.1) }))], bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]] }), // 正四面体 109.5°
  NH3: () => ({ atoms: [A('N', 0, .15, 0), A('H', .94, -.28, 0), A('H', -.47, -.28, .81), A('H', -.47, -.28, -.81)], bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1]], lone: [0, .78, 0] }), // 三角錐＋非共有電子対
  AcOH: () => ({ atoms: [A('C', -.75, 0, 0), A('C', .75, 0, 0), A('O', 1.35, 1.02, 0), A('O', 1.45, -1, 0), A('H', 2.36, -1, 0), A('H', -1.15, 1, 0), A('H', -1.15, -.5, .87), A('H', -1.15, -.5, -.87)],
    bonds: [[0, 1, 1], [1, 2, 2], [1, 3, 1], [3, 4, 1], [0, 5, 1], [0, 6, 1], [0, 7, 1]] }),
  H2O2: () => ({ atoms: [A('O', -.73, 0, 0), A('O', .73, 0, 0), A('H', -1.02, .78, .5), A('H', 1.02, .78, -.5)], bonds: [[0, 1, 1], [0, 2, 1], [1, 3, 1]] }), // ねじれた形
  EtOH: () => ({ atoms: [A('C', -1.2, 0, 0), A('C', 0, .5, 0), A('O', 1.2, -.2, 0), A('H', 1.9, .42, 0), A('H', 0, 1.15, .86), A('H', 0, 1.15, -.86), A('H', -1.3, -1.08, 0), A('H', -1.75, .4, .87), A('H', -1.75, .4, -.87)],
    bonds: [[0, 1, 1], [1, 2, 1], [2, 3, 1], [1, 4, 1], [1, 5, 1], [0, 6, 1], [0, 7, 1], [0, 8, 1]] }),
  HNO3,
  H2SO4: () => tetraOxo('S', [0, 0, 0], 1.48, [0, 1], [2, 3]),
  C6H6: () => { // 正六角形の平面分子。π電子の非局在化を内側の輪で示す
    const atoms = [], bonds = [];
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; atoms.push(A('C', 1.4 * Math.cos(a), 1.4 * Math.sin(a), 0)); }
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; atoms.push(A('H', 2.45 * Math.cos(a), 2.45 * Math.sin(a), 0)); bonds.push([i, (i + 1) % 6, 1], [i, i + 6, 1]); }
    return { atoms, bonds, ring: .86 };
  },
  NG: () => { // グリセリンの3つの OH が硝酸エステル −O−NO₂ になったもの
    const atoms = [A('C', -1.3, 0, 0), A('C', 0, .45, 0), A('C', 1.3, 0, 0)], bonds = [[0, 1, 1], [1, 2, 1]];
    const dirs = [[-.55, -.83, 0], [0, 1, 0], [.55, -.83, 0]];
    dirs.forEach((d, i) => {
      const c = atoms[i].p, o = atoms.length;
      atoms.push({ e: 'O', p: add(c, d, 1.3) }, { e: 'N', p: add(c, d, 2.45) }, { e: 'O', p: add(add(c, d, 3.0), [d[1] * .95, -d[0] * .95, 0]) }, { e: 'O', p: add(add(c, d, 3.0), [-d[1] * .95, d[0] * .95, 0]) });
      bonds.push([i, o, 1], [o, o + 1, 1], [o + 1, o + 2, 2], [o + 1, o + 3, 1]);
    });
    [[0, .9], [0, -.9], [1, .95], [2, .9], [2, -.9]].forEach(([i, z]) => { atoms.push({ e: 'H', p: add(atoms[i].p, [0, i === 1 ? -.35 : .35, z]) }); bonds.push([i, atoms.length - 1, 1]); });
    return { atoms, bonds };
  },
  Aqua: () => join(HNO3(), ...[0, 1, 2].map(i => { const a = Math.PI / 2 + i * 2 * Math.PI / 3; return shift(di('H', 'Cl', .66), [2.7 * Math.cos(a), 2.7 * Math.sin(a), 0]); })), // 濃硝酸1：濃塩酸3
  Nylon: () => { // −[NH−(CH₂)₆−NH−CO−(CH₂)₄−CO]− の主鎖をらせんにまとめた
    const seq = 'NCCCCCCNCCCCCC', atoms = [], bonds = [];
    [...seq].forEach((e, i) => { const a = i * .92, y = i * .3 - 1.95; atoms.push(A(e, 1.25 * Math.cos(a), y, 1.25 * Math.sin(a))); if (i) bonds.push([i - 1, i, 1]); });
    for (const i of [8, 13]) { const p = atoms[i].p; atoms.push(A('O', p[0] * 1.75, p[1] + .1, p[2] * 1.75)); bonds.push([i, atoms.length - 1, 2]); } // アミド結合の C=O
    for (const i of [0, 7]) { const p = atoms[i].p; atoms.push(A('H', p[0] * 1.6, p[1] - .15, p[2] * 1.6)); bonds.push([i, atoms.length - 1, 1]); }
    return { atoms, bonds };
  },
  CaCO3: () => join({ atoms: [A('Ca', -1.75, 0, 0)], bonds: [] }, { atoms: [A('C', .85, 0, 0), ...[0, 1, 2].map(i => A('O', .85 + 1.28 * Math.cos(i * 2.094), 1.28 * Math.sin(i * 2.094), 0))], bonds: [[0, 1, 2], [0, 2, 1], [0, 3, 1]] }), // CO₃²⁻ は正三角形
  AgCl: () => rock('Ag', 'Cl'),
  BaSO4: () => join({ atoms: [A('Ba', -2, 0, 0)], bonds: [] }, tetraOxo('S', [.9, 0, 0], 1.45, [0, 1])),
  KMnO4: () => join({ atoms: [A('K', -2, 0, 0)], bonds: [] }, tetraOxo('Mn', [.9, 0, 0], 1.55, [0, 1, 2])),
  NaOH: () => join({ atoms: [A('Na', -1.15, 0, 0)], bonds: [] }, OH(.9, 1)),
  CaOH2: () => join({ atoms: [A('Ca', 0, 0, 0)], bonds: [] }, OH(1.9, 1), OH(-1.9, -1)),
  Li: () => bcc('Li'), Na: () => bcc('Na'), K: () => bcc('K'), Cs: () => bcc('Cs'), Fe: () => bcc('Fe'),
  Cu: () => fcc('Cu'), Al: () => fcc('Al'), Ag: () => fcc('Ag'), Pb: () => fcc('Pb'), Pt: () => fcc('Pt'), Au: () => fcc('Au'),
  Zn: () => hcp('Zn'),
  Dia: () => { // ダイヤモンド：各炭素が正四面体の頂点方向に4本の共有結合
    const atoms = [A('C', 0, 0, 0)], bonds = [];
    T4.forEach(d => { atoms.push({ e: 'C', p: d.map(x => x * 1.54) }); const i = atoms.length - 1; bonds.push([0, i, 1]);
      T4.forEach(e => { if (e[0] * d[0] + e[1] * d[1] + e[2] * d[2] > .9) return; atoms.push({ e: 'C', p: add(atoms[i].p, e, -1.54) }); bonds.push([i, atoms.length - 1, 1]); }); });
    return { atoms, bonds, gem: true };
  },
  SiO2: () => { // SiO₄ 四面体が O を共有してつながる
    const atoms = [A('Si', 0, 0, 0)], bonds = [];
    T4.forEach(d => { atoms.push({ e: 'O', p: d.map(x => x * 1.3) }, { e: 'Si', p: d.map(x => x * 2.6) }); const o = atoms.length - 2; bonds.push([0, o, 1], [o, o + 1, 1]); });
    return { atoms, bonds, gem: true };
  },
  N2: () => di('N', 'N', .55, 3), CO: () => di('C', 'O', .56, 3), HF: () => di('H', 'F', .46),
  CO2: () => ({ atoms: [A('C', 0, 0, 0), A('O', 1.16, 0, 0), A('O', -1.16, 0, 0)], bonds: [[0, 1, 2], [0, 2, 2]] }), // 直線形
  SO2: () => bent('S', 'O', 1.24, .38), H2S: () => bent('S', 'H', .97, .45, 1), NO2: () => bent('N', 'O', 1.1, .35), O3: () => bent('O', 'O', 1.09, .35),
  Mg: () => hcp('Mg'), Ca: () => fcc('Ca'), Ba: () => bcc('Ba'), Cr: () => bcc('Cr'),
  S: () => { const atoms = [], bonds = []; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; atoms.push(A('S', 1.5 * Math.cos(a), i % 2 ? .45 : -.45, 1.5 * Math.sin(a))); bonds.push([i, (i + 1) % 8, 1]); } return { atoms, bonds }; }, // S₈ の王冠形
  NaCl: () => rock('Na', 'Cl'), CaO: () => rock('Ca', 'O'),
  C2H4: () => ({ atoms: [A('C', -.67, 0, 0), A('C', .67, 0, 0), A('H', -1.23, .93, 0), A('H', -1.23, -.93, 0), A('H', 1.23, .93, 0), A('H', 1.23, -.93, 0)], bonds: [[0, 1, 2], [0, 2, 1], [0, 3, 1], [1, 4, 1], [1, 5, 1]] }),
  C2H2: () => ({ atoms: [A('C', -.6, 0, 0), A('C', .6, 0, 0), A('H', -1.66, 0, 0), A('H', 1.66, 0, 0)], bonds: [[0, 1, 3], [0, 2, 1], [1, 3, 1]] }), // 直線形
  HCOOH: () => ({ atoms: [A('C', 0, 0, 0), A('O', .65, 1.02, 0), A('O', .75, -1.0, 0), A('H', 1.68, -.95, 0), A('H', -1.08, 0, 0)], bonds: [[0, 1, 2], [0, 2, 1], [2, 3, 1], [0, 4, 1]] }),
  AcH: () => ({ atoms: [A('C', -.75, 0, 0), A('C', .75, 0, 0), A('O', 1.4, 1.0, 0), A('H', 1.3, -.95, 0), A('H', -1.15, 1, 0), A('H', -1.15, -.5, .87), A('H', -1.15, -.5, -.87)], bonds: [[0, 1, 1], [1, 2, 2], [1, 3, 1], [0, 4, 1], [0, 5, 1], [0, 6, 1]] }),
  NaHCO3: () => { const c = CO3(.9); c.atoms.push(A('H', .9 + 1.28 * Math.cos(2.094) - .8, 1.28 * Math.sin(2.094) + .5, 0)); c.bonds.push([2, 4, 1]); return join(ion('Na', -1.75), c); },
  Na2CO3: () => join(ion('Na', -2.1, .8), ion('Na', -2.1, -.8), CO3(.7)),
  MnO2: () => octa('Mn', 'O', 1.6), // ルチル型構造では Mn のまわりを O が正八面体形に囲む
  Si: () => diamond('Si', 1.9), P4: () => ({ atoms: T4.map(d => ({ e: 'P', p: d.map(x => x * 1.35) })), bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1], [1, 2, 1], [1, 3, 1], [2, 3, 1]] }), // 正四面体形
  CuSO4: () => join(ion('Cu', -2), tetraOxo('S', [.9, 0, 0], 1.45, [0, 1])),
  PhOH: () => benz({ 0: sOH }), PhNH2: () => benz({ 0: sNH2 }), Sal: () => benz({ 0: sCOOH, 1: sOH }),
  EtOAc: () => ({ atoms: [A('C', -2.2, 0, 0), A('C', -.8, .5, 0), A('O', -.6, 1.7, 0), A('O', .3, -.4, 0), A('C', 1.65, .1, 0), A('C', 2.8, -.9, 0)], bonds: [[0, 1, 1], [1, 2, 2], [1, 3, 1], [3, 4, 1], [4, 5, 1]] }), // CH₃−CO−O−CH₂−CH₃（H は省略）
  K2Cr2O7: () => { const a = tetraOxo('Cr', [-1.35, 0, 0], 1.5, [1, 2]), b = tetraOxo('Cr', [1.35, 0, 0], 1.5, [1, 2]); return join(ion('K', 0, 2.6), ion('K', 0, -2.6), a, b, { atoms: [A('O', 0, .5, 0)], bonds: [] }); }, // 2つの四面体が O を共有
  Al2O3: () => ({ atoms: [A('Al', -1, 0, 0), A('Al', 1, 0, 0), A('O', 0, 1.1, 0), A('O', 0, -.6, .95), A('O', 0, -.6, -.95)], bonds: [[0, 2, 1], [1, 2, 1], [0, 3, 1], [1, 3, 1], [0, 4, 1], [1, 4, 1]], gem: true }),
  Glc: () => { // 六員環（C5個＋O1個）に −OH と −CH₂OH。H は省略
    const atoms = [], bonds = [];
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; atoms.push(A(i === 5 ? 'O' : 'C', 1.45 * Math.cos(a), i % 2 ? .28 : -.28, 1.45 * Math.sin(a))); bonds.push([i, (i + 1) % 6, 1]); }
    for (let i = 0; i < 4; i++) { const p = atoms[i].p; atoms.push(A('O', p[0] * 1.75, p[1] + (i % 2 ? .9 : -.9), p[2] * 1.75)); bonds.push([i, atoms.length - 1, 1]); }
    const p = atoms[4].p; atoms.push(A('C', p[0] * 1.9, p[1] + .6, p[2] * 1.9), A('O', p[0] * 2.6, p[1] + 1.5, p[2] * 2.6)); bonds.push([4, 10, 1], [10, 11, 1]);
    return { atoms, bonds };
  },
  PET: () => { const b = benz({ 0: sCOOH, 3: sCOOH }); const n = b.atoms.length; b.atoms.push(A('C', 0, 4.9, .3), A('C', 0, -4.9, .3)); b.bonds.push([n - 4, n, 1], [n - 1, n + 1, 1]); return b; }, // −CO−C₆H₄−CO−O−CH₂…
  Hg: () => ({ atoms: [[0, 0, 0, .8], [.9, .1, .3, .55], [-.8, -.2, .4, .5], [.2, .2, -.9, .5], [-.3, -.75, -.2, .42], [.5, -.6, .7, .38], [-.5, .8, -.3, .4]].map(([x, y, z, r]) => ({ e: 'Hg', p: [x, y, z], r })), bonds: [], metal: true }), // 液体の金属：丸い滴
  Rubber: () => { // シス形ポリイソプレン −[CH₂−C(CH₃)=CH−CH₂]ₙ−
    const atoms = [], bonds = [];
    for (let i = 0; i < 12; i++) { atoms.push(A('C', i * .95 - 5.2, i % 2 ? .45 : -.45, Math.sin(i * .8) * .6)); if (i) bonds.push([i - 1, i, i % 4 === 2 ? 2 : 1]); }
    for (const i of [1, 5, 9]) { atoms.push({ e: 'C', p: add(atoms[i].p, [0, 1.3, 0]) }); bonds.push([i, atoms.length - 1, 1]); }
    return { atoms, bonds };
  },
  DNA: () => { // 二重らせん：2本の糖−リン酸の鎖と、内側の塩基対
    const atoms = [], bonds = [], N = 9;
    for (let i = 0; i < N; i++) { const a = i * .7, y = i * .62 - 2.5;
      atoms.push(A('P', 1.5 * Math.cos(a), y, 1.5 * Math.sin(a)), A('P', -1.5 * Math.cos(a), y, -1.5 * Math.sin(a)), A(i % 2 ? 'N' : 'O', .5 * Math.cos(a), y, .5 * Math.sin(a)), A(i % 2 ? 'O' : 'N', -.5 * Math.cos(a), y, -.5 * Math.sin(a)));
      const o = i * 4; bonds.push([o, o + 2, 1], [o + 1, o + 3, 1], [o + 2, o + 3, 0]); if (i) bonds.push([o - 4, o, 1], [o - 3, o + 1, 1]); }
    return { atoms, bonds };
  },
  m_dust: () => ({ atoms: [[0, 0, 0], [.7, .3, .2], [-.6, .4, -.3], [.1, -.7, .4], [-.3, -.2, -.8], [.5, -.4, -.5], [-.5, .1, .7]].map((p, i) => ({ e: 'X', p, r: .45 + (i * 37 % 5) * .06 })), bonds: [] }),
  m_rust: () => ({ atoms: [A('Fe', -.95, 0, 0), A('Fe', .95, 0, 0), A('O', 0, 1.05, 0), A('O', 0, -.6, .9), A('O', 0, -.6, -.9)], bonds: [[0, 2, 1], [1, 2, 1], [0, 3, 1], [1, 3, 1], [0, 4, 1], [1, 4, 1]] }),
  m_rain: () => ({ atoms: [A('S', 0, .35, 0), A('O', 1.24, -.4, 0), A('O', -1.24, -.4, 0)], bonds: [[0, 1, 2], [0, 2, 2]] }), // SO₂ は折れ線形
  m_smog: () => ({ atoms: [A('N', 0, .35, 0), A('O', 1.1, -.35, 0), A('O', -1.1, -.35, 0)], bonds: [[0, 1, 2], [0, 2, 1]] }), // NO₂ は折れ線形
};
// 貴ガス：電子殻（K, L, M 殻の電子数）と放電管の発光色
const SHELL = { He: [[2], 0xffc78a], Ne: [[2, 8], 0xff5a2a], Ar: [[2, 8, 8], 0xa58bff] };

// ---- ジオメトリ生成 ----
const tmpC = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);
function paint(g, hex) {
  tmpC.setHex(hex); const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = tmpC.r; a[i * 3 + 1] = tmpC.g; a[i * 3 + 2] = tmpC.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
}
function stick(a, b, rad, hex, off) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), d = vb.clone().sub(va), len = d.length();
  const g = new THREE.CylinderGeometry(rad, rad, len, 8, 1, true);
  const m = new THREE.Matrix4().compose(va.clone().add(vb).multiplyScalar(.5).add(off || new THREE.Vector3()), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), new THREE.Vector3(1, 1, 1));
  return paint(g.applyMatrix4(m), hex);
}
const MAT = {};
function mats() {
  if (!MAT.mol) {
    MAT.mol = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .3, metalness: .05, envMapIntensity: 1 });
    MAT.metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .26, metalness: 1, envMapIntensity: 1.25 });
    MAT.gem = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: .05, metalness: 0, transmission: 0, clearcoat: 1, envMapIntensity: 2.2 });
    MAT.glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  }
  return MAT;
}
let CACHE = {}, STYLE = 'stick';
/** 表示様式：'stick' 球棒 / 'fill' 空間充填 / 'neon' 発光する線画 */
export function setMolStyle(st) { if (st === STYLE) return false; STYLE = st; for (const k in CACHE) { const g = CACHE[k]; if (g.solid) g.solid.dispose(); if (g.glow) g.glow.dispose(); } CACHE = {}; return true; }
function geoms(id) {
  if (CACHE[id]) return CACHE[id];
  const solid = [], glow = []; let kind = 'mol';
  if (SHELL[id]) { // 電子殻モデル
    const [sh, col] = SHELL[id], K = .94 / (.42 + (sh.length - 1) * .28); // 最外殻がモデルの外周に来るよう拡大
    glow.push(paint(new THREE.SphereGeometry(.2 * Math.min(K, 1.5), 16, 12), col));
    sh.forEach((n, k) => {
      const R = (.42 + k * .28) * K, q = new THREE.Quaternion().setFromEuler(new THREE.Euler(1.1 + k * .5, k * 1.1, k * .7)), mt = new THREE.Matrix4().makeRotationFromQuaternion(q);
      glow.push(paint(new THREE.TorusGeometry(R, .012, 6, 48).applyMatrix4(mt), col));
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + k; glow.push(paint(new THREE.SphereGeometry(.05, 8, 6).translate(R * Math.cos(a), R * Math.sin(a), 0).applyMatrix4(mt), 0xffffff)); }
    });
  } else {
    const s = (M[id] || M.m_dust)(); kind = s.metal ? 'metal' : s.gem ? 'gem' : 'mol';
    // 重心を原点に、外接半径を1に正規化
    const c = [0, 0, 0]; for (const a of s.atoms) for (let k = 0; k < 3; k++) c[k] += a.p[k] / s.atoms.length;
    const fill = STYLE === 'fill' && !s.metal && !s.small, neon = STYLE === 'neon';
    const rad = a => (a.r || EL[a.e][1]) * (s.small || 1) * (s.metal ? 1.05 : 1) * (fill ? 2.15 : neon ? .5 : 1);
    let R = 0; for (const a of s.atoms) { a.p = add(a.p, c, -1); R = Math.max(R, Math.hypot(...a.p) + rad(a)); }
    const k = 1 / R;
    for (const a of s.atoms) solid.push(paint(new THREE.SphereGeometry(Math.max(.085, rad(a) * k), 20, 14).translate(a.p[0] * k, a.p[1] * k, a.p[2] * k), EL[a.e][0]));
    for (const [i, j, o] of fill ? [] : s.bonds) {
      const pa = s.atoms[i].p.map(x => x * k), pb = s.atoms[j].p.map(x => x * k);
      if (o === 0) solid.push(stick(pa, pb, .018, FRAME));
      else if (o === 2) { const d = new THREE.Vector3(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]).normalize(); let n = new THREE.Vector3(0, 0, 1).cross(d); if (n.lengthSq() < .01) n = new THREE.Vector3(0, 1, 0).cross(d); n.normalize().multiplyScalar(.055); solid.push(stick(pa, pb, .036, BOND, n), stick(pa, pb, .036, BOND, n.clone().negate())); }
      else if (o === 3) { const d = new THREE.Vector3(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]).normalize(); let n = new THREE.Vector3(0, 0, 1).cross(d); if (n.lengthSq() < .01) n = new THREE.Vector3(0, 1, 0).cross(d); n.normalize().multiplyScalar(.075); solid.push(stick(pa, pb, .03, BOND), stick(pa, pb, .03, BOND, n), stick(pa, pb, .03, BOND, n.clone().negate())); }
      else solid.push(stick(pa, pb, s.metal ? .04 : .05, BOND));
    }
    if (s.ring) glow.push(paint(new THREE.TorusGeometry(s.ring * k, .02, 6, 40), 0x7df9d2));
    if (s.lone) glow.push(paint(new THREE.SphereGeometry(.09, 10, 8).scale(1, 1.5, 1).translate(...s.lone.map((x, i) => (x - c[i]) * k)), 0x7df9ff)); // 非共有電子対
  }
  if (STYLE === 'neon' && solid.length) { glow.push(...solid.splice(0)); }
  return (CACHE[id] = { solid: solid.length ? mergeGeometries(solid) : null, glow: glow.length ? mergeGeometries(glow) : null, kind });
}
/** 物質 id の立体モデル（外接半径1）。ジオメトリは共有するので何体作っても軽い */
export function buildModel(id) {
  const g = geoms(id), m = mats(), grp = new THREE.Group();
  if (g.solid) grp.add(new THREE.Mesh(g.solid, m[g.kind]));
  if (g.glow) grp.add(new THREE.Mesh(g.glow, m.glow));
  grp.userData.flat = id === 'C6H6' || id === 'CaCO3' || id === 'Aqua'; // 平面的な分子は正面を向け気味に回す
  return grp;
}
