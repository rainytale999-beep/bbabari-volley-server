'use strict';
/* ===== 빱알이 배구 — 코어(2.5D 물리·규칙·AI). 브라우저/노드 공용 =====
   좌표: x = 코트 길이 방향(네트가 x=640), z = 깊이(0 안쪽 ~ ZD 바깥쪽/카메라 쪽), y = 화면 높이(GY가 바닥) */
const W = 1280, H = 720, GY = 620, NETH = 178, NETW = 14, BR = 26, NETTOP = GY - NETH;
// 코트 크기는 팀 인원에 따라 달라진다(사람이 많을수록 넓어서 빈 곳이 생긴다). CW = 코트 전체 길이, ZD = 깊이, XS = 1:1 대비 길이 배율
const COURTS = { 1: [1280, 340], 2: [1500, 410], 3: [1720, 470] };
const SRV = 695; // 서브 자리: 끝선 뒤(코트 밖). 네트로부터의 거리(1:1 기준)
const SERVE_OUT_P = 0.25; // 게이지를 가득 채운 강서브가 끝선 밖으로 나가 버릴 확률
const STA = { rest: 1.6, idle: 1, run: 2, walk: 0.7, serve: 2 }; // 체력 회복(랠리 사이·가만히)과 소모(달리기·걷기) 초당 양, 서브 때 회복량
const DIRECT_MISS = 0.3; // 다이렉트(상대가 넘긴 공을 바로 스파이크)가 헛스윙이 되는 확률
const MOVE_K = 1; // 걷기·달리기 속도 배율(v0.32 0.92 → v0.34 다시 1: 체력이 떨어지면 저절로 느려지므로)
const BALL_K = 0.9; // 스파이크·강서브처럼 곧게 날아가는 공의 속도 배율(v0.34 10% 느리게)
const DIVE_LEN = 150; // 슬라이딩 리시브 최대 거리(1:1 기준). 세네 ×1.25, 눈밭·빙판 ×1.3
let CW = 1280, NETX = 640, ZD = 340, XS = 1, VW = 1460; // VW = 화면에 보이는 폭(코트 + 양쪽 끝선 뒤 여유)
function useCourt(n) { const c = COURTS[n] || COURTS[1]; CW = c[0]; NETX = CW / 2; ZD = c[1]; XS = CW / 1280; VW = CW + 180 * XS; }
const GB = 1300, GP = 2300, DT = 1 / 60; // GB 공 중력(v0.34: 1400 → 1300, 띄운 공이 조금 천천히)
const K = { L: 1, R: 2, U: 4, D: 8, A: 16, S: 32, X: 64 };

const CHARS = [
  { id: 'bbabjji', name: '빱찌', title: '치즈 도둑 아이돌', spd: 4, jmp: 4, pow: 3, tec: 4, gut: 2, type: 'instant', sup: 'ufo',
    supName: '빱알이 우주선 호출', supDesc: '빱알이 우주선이 날아와 공을 납치한다. 상대 코트 위에서 "어디 떨굴까~" 하고 약 올리다가 냅다 수직 투하. 깔리면 납작해진다. 돌아가는 길에 상대 통장(필살 게이지)도 털어 간다.',
    pasName: '바둥바둥', pasDesc: '넘어져도 금방 일어난다. 넘어진 채 바둥거리는 발에 공이 맞으면 그게 또 리시브가 된다.' },
  { id: 'goseum', name: '고슴도치', title: '빱알이 대장', spd: 3, jmp: 3, pow: 5, tec: 2, gut: 4, type: 'spike', sup: 'thorn',
    supName: '엉덩이 추적 가시공', supDesc: '공에 가시와 성난 눈썹이 돋아나 가장 가까운 상대의 엉덩이를 끝까지 쫓아간다. 찔리면 "앗 따가!" 하며 엉덩이를 잡고 폴짝폴짝.',
    pasName: '대장의 가시 장벽', pasDesc: '블로킹 범위가 넓고, 막은 공이 더 세게 튕겨 나간다.' },
  { id: 'barcode', name: '바코드', title: '걸어다니는 계산대', spd: 3, jmp: 3, pow: 3, tec: 5, gut: 3, type: 'spike', sup: 'bogo',
    supName: '삑! 2+1 행사', supDesc: '공이 세 개로 늘어난다. 진짜는 하나, 나머지 둘은 사은품 두루마리 휴지. 휴지를 받은 사람은 민망해서 굳는다. "행사 종료되었습니다."',
    pasName: '정밀 스캔', pasDesc: '토스와 리시브가 빗나가지 않는다. 우리 코트 낙하 지점에는 "여기!" 가격표까지 붙는다.' },
  { id: 'sene', name: '세네', title: '안테나 서너 개', spd: 5, jmp: 3, pow: 2, tec: 4, gut: 2, type: 'instant', sup: 'puppet',
    supName: '리모컨 해킹', supDesc: '안테나로 상대 전원을 해킹한다. 상대는 세네가 움직이는 대로 거울처럼 따라 움직일 수밖에 없다. 세네가 점프하면 다 같이 점프한다.',
    pasName: '더듬이 감지', pasDesc: '다이빙 리시브 거리가 길다.' },
  { id: 'dalgareum', name: '달가름', title: '문워크 장인', spd: 3, jmp: 5, pow: 4, tec: 2, gut: 2, type: 'instant', sup: 'float',
    supName: '달나라 관광', supDesc: '달을 반으로 쩍 갈라 상대 코트의 중력을 꺼 버린다. 상대 전원이 둥실 떠올라 허우적대고, 끝나면 엉덩방아를 찧는다.',
    pasName: '저중력 체질', pasDesc: '점프가 높고 체공 시간이 길다.' },
  { id: 'jiae', name: '지애수이시보', title: '리본 체조 국가대표(자칭)', spd: 4, jmp: 3, pow: 2, tec: 4, gut: 3, type: 'instant', sup: 'wrap',
    supName: '돌돌말이 김밥', supDesc: '리본으로 공 근처의 상대 둘을 김밥처럼 돌돌 만다. 말린 상대는 통통 튀는 것 말고는 아무것도 못 한다. (1:1이면 한 줄)',
    pasName: '리본 리치', pasDesc: '리시브·토스가 닿는 범위가 넓다.' },
  { id: 'bami', name: '밤이도', title: '밤송이 헬멧', spd: 2, jmp: 2, pow: 4, tec: 3, gut: 5, type: 'spike', sup: 'hot',
    supName: '군밤 폭탄 돌리기', supDesc: '공이 심지 달린 군밤 폭탄이 된다. 4초 뒤 터지는데, 터질 때 공이 있는 쪽 코트 전원이 새까맣게 그을려 날아간다. 우리 쪽으로 돌아오면 우리가 터진다.',
    pasName: '밤송이 헤딩', pasDesc: '강한 공을 머리로 맞아도 안 넘어진다. 오히려 머리로 받는 게 더 정확하다.' },
  { id: 'mandu', name: '만두의코고는소리', title: '자면서 배구하는 만두', spd: 2, jmp: 3, pow: 5, tec: 3, gut: 4, type: 'instant', sup: 'snore',
    supName: '드르렁 자장가', supDesc: '코 고는 소리로 상대 전원을 재운다. 공에 맞으면 콧물 풍선이 터지며 깬다. 문제는 본인도 잠깐 잔다는 것.',
    pasName: '낮잠 충전', pasDesc: '가만히 서 있으면 필살 게이지가 저절로 찬다.' },
  { id: 'iseu', name: '이스', title: '머리 위의 각얼음', spd: 4, jmp: 4, pow: 3, tec: 3, gut: 3, type: 'spike', sup: 'ice',
    supName: '꽁꽁 스파이크', supDesc: '얼음공 발사. 받은 사람은 얼음 동상이 되어 컬링 스톤처럼 미끄러져 가고, 상대 코트 바닥은 빙판이 된다.',
    pasName: '쿨한 성격', pasDesc: '스턴·넘어짐 같은 상태 이상이 절반만 지속된다.' },
];
const STAGES = [
  { id: 'beach', name: '백사장', g: 1, desc: '기본 코트. 모래가 푹신해서 다이빙 후 금방 일어난다.' },
  { id: 'gym', name: '실내경기장', g: 1, ceil: 34, desc: '천장이 있다. 공이 천장과 벽에 팅팅 튕긴다.' },
  { id: 'planet', name: '외계의 별', g: 0.74, desc: '치즈별은 저중력. 높이 뛰고 공도 천천히 떨어진다.' },
  { id: 'river', name: '강변', g: 1, windy: 1, desc: '강바람이 분다. 서브 때마다 풍향이 바뀌니 풍향계를 볼 것.' },
  { id: 'snow', name: '눈마을', g: 1, slip: 1, desc: '눈밭이라 미끄럽다. 멈출 때 주르륵 밀리고 다이빙이 멀리 나간다.' },
  { id: 'market', name: '야시장', g: 1, fest: 1, desc: '축제의 밤. 아이템이 훨씬 자주 나온다.' },
];
const ITEMS = [
  { id: 'cheese', name: '치즈', desc: '팀 전원 필살 게이지 +40' },
  { id: 'big', name: '거대화 우유', desc: '팀 전원이 커진다' },
  { id: 'fast', name: '번개 신발', desc: '팀 전원 이동 속도 증가' },
  { id: 'mini', name: '꼬꼬마 버섯', desc: '상대 전원이 작아진다' },
  { id: 'banana', name: '바나나', desc: '상대 코트에 바나나 껍질 투척' },
  { id: 'balloon', name: '풍선공', desc: '공이 둥실둥실 느려진다' },
  { id: 'heal', name: '체력 도시락', desc: '팀 전원 체력 회복' },
];
const DIFFS = {
  easy:   { name: '쉬움',   react: 0.42, err: 48, block: 0,    dive: 0.15, perf: 0,    two: 0,    sup: 0.4, chg: 0,   miss: 0.5 },
  normal: { name: '보통',   react: 0.27, err: 24, block: 0.2,  dive: 0.45, perf: 0.08, two: 0.12, sup: 0.8, chg: 0.5, miss: 0.3 },
  hard:   { name: '어려움', react: 0.15, err: 9,  block: 0.38,  dive: 0.8,  perf: 0.25, two: 0.3,  sup: 1,   chg: 1,   miss: 0.12 },
};
// 팀 인원별 기본 위치 [네트로부터 거리, 깊이 비율]
const CTRLS = { // 조작 난이도
  easy: { name: '쉬움', desc: '깊이 자동 맞춤 강하게 · 판정 넉넉 · 꾹 누르고 있으면 알아서 스파이크 · 버튼 안내', zk: 0.55, reach: 1.14, assist: 1.3, perf: 0.15, auto: true, buf: 0.22 },
  normal: { name: '보통', desc: '깊이 자동 맞춤 · 버튼 안내. 스파이크 타이밍은 직접 맞춘다', zk: 0.63, reach: 1.05, assist: 1.12, perf: 0.1, auto: false, buf: 0.18 }, // v0.23: 조금 쉽게(전: zk 0.68, reach 1, assist 1, perf 0.075, buf 0.16)
  pro: { name: '수동', desc: '도움 없음. 앞뒤 위치와 타이밍을 전부 직접 맞춘다(버튼 안내도 꺼짐)', zk: 1, reach: 1, assist: 0, perf: 0.075, auto: false, buf: 0 },
};
function supHow(ch) { return CHARS[ch].type === 'instant' ? 'D를 누르면 바로 발동' : '점프해서 공 가까이에서 D'; }
function ctl(S, p) { return CTRLS[S.ctrl] || CTRLS.normal; } // 판정(거리·깊이)은 PC와 사람이 같다. 자동 맞춤·자동 스파이크 같은 도움만 사람 전용
const HOMES = { 1: [[330, 0.5]], 2: [[170, 0.34], [440, 0.66]], 3: [[150, 0.5], [430, 0.24], [430, 0.76]] };

function rnd(a, b) { return a + Math.random() * (b - a); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function fdir(p) { return p.team === 0 ? 1 : -1; }
function netD(team, d) { return team === 0 ? NETX - d * XS : NETX + d * XS; } // 거리는 1:1 코트 기준으로 적고, 코트가 넓으면 같이 늘어난다
function oppD(team, d) { return team === 0 ? NETX + d * XS : NETX - d * XS; }
function sideOf(x) { return x < NETX ? 0 : 1; }
function psc(p) { return (p.big > 0 ? 1.4 : 1) * (p.mini > 0 ? 0.62 : 1); }
function busy(p) { const s = p.st; return s.down > 0 || s.stun > 0 || s.hop > 0 || s.sleep > 0 || s.frozen > 0; }
function cool(p) { return CHARS[p.ch].id === 'iseu' ? 0.5 : 1; }
function gutMul(p) { return (1.3 - CHARS[p.ch].gut * 0.1) * cool(p); }
function fat(p) { return 0.78 + 0.22 * clamp(p.hp, 0, 100) / 100; } // 체력이 떨어질수록 능력치가 내려간다(체력 0이면 78%)
function tire(p, amt) { if (p.ko || p.hp <= 10) return; p.hp = Math.max(10, p.hp - amt * (1.15 - CHARS[p.ch].gut * 0.06)); } // 움직이고 치는 데 드는 체력. 근성이 높으면 덜 지친다. 이것만으로는 10 아래로 안 내려간다
function pSpeed(S, p) {
  const c = CHARS[p.ch], s = p.st;
  return (262 + c.spd * 32) * MOVE_K * (p.fast > 0 ? 1.4 : 1) * (s.sad > 0 ? 0.62 : 1) * (s.wrap > 0 ? 0.3 : 1) * (p.mini > 0 ? 1.08 : 1) * (p.big > 0 ? 0.92 : 1) * fat(p);
}
function pGrav(S, p) { return GP * S.env.g * (CHARS[p.ch].id === 'dalgareum' ? 0.84 : 1); }
function jumpV(p) { return (800 + CHARS[p.ch].jmp * 38) * (0.9 + 0.1 * clamp(p.hp, 0, 100) / 100); }
function jumpH(S, p) { const v = jumpV(p); return v * v / (2 * pGrav(S, p)); }
function ballG(S, b) { return GB * S.env.g * (b.float > 0 ? 0.5 : 1); }
function heat(S) { return clamp((S.rallyHits - 14) * 0.03, 0, 0.6); } // 랠리가 길어지면 공이 점점 빨라진다
function ev(S, k, x, y, z, a, b) { S.ev.push([S.evId++, k, Math.round(x || 0), Math.round(y || 0), Math.round(z || 0), a === undefined ? 0 : a, b === undefined ? 0 : b]); }
function d3(ax, ay, az, bx, by, bz) { return Math.hypot(ax - bx, ay - by, az - bz); }

function mkPlayer(i, cfg, n) {
  const team = i < n ? 0 : 1, slot = i % n, h = HOMES[n][slot];
  return { i, team, slot, ch: cfg.ch, name: cfg.name, bot: !!cfg.bot, x: netD(team, h[0]), y: GY, z: h[1] * ZD, vx: 0, vy: 0, vz: 0, gnd: true,
    act: 'idle', actT: 0, hitDone: false, diveX: 1, diveZ: 0, inReach: 0, chg: 0, chgHold: 0, pw: 1,
    st: { down: 0, stun: 0, hop: 0, sleep: 0, frozen: 0, wrap: 0, puppet: 0, float: 0, sad: 0, flat: 0 }, pupBy: -1, fell: false, bufA: 0, jumpHold: false, bounce: 0, bowled: false, sky: false, prevIn: 0,
    big: 0, mini: 0, fast: 0, soot: 0, gauge: 0, hp: 100, ko: false, hitCd: 0, inp: 0, prev: 0, perfect: false,
    stats: { spk: 0, rcv: 0, blk: 0, fall: 0, pts: 0, sup: 0 }, ai: { serveAt: 0 } };
}

function newGame(cfg) {
  const st = STAGES.find(s => s.id === cfg.stage) || STAGES[0];
  const n = cfg.slots.length >> 1; useCourt(n);
  const S = { n, tick: 0, time: 0, phase: 'serve', phaseT: 0, stage: st.id, env: { g: st.g, ceil: st.ceil || 0, sand: st.id === 'beach', windy: !!st.windy, slip: !!st.slip, fest: !!st.fest },
    wind: 0, score: [0, 0], target: cfg.target || 7, diff: cfg.diff || 'normal', ctrl: CTRLS[cfg.ctrl] ? cfg.ctrl : 'normal', itemsOn: cfg.items !== false,
    serveTeam: Math.random() < 0.5 ? 0 : 1, serveIdx: [0, 0], server: 0, pointTeam: -1,
    ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rot: 0, lastTeam: -1, lastP: -1, touches: 0, noP: -1, power: false, sup: null, supTeam: -1, cap: false, held: true, teamCd: 0, float: 0, home: 0, fuse: 0, serial: 0, chain: 0, nice: 0, quick: false },
    decoys: [], ufo: null, players: [], items: [], peels: [], ice: [0, 0], itemT: rnd(6, 10) * (st.fest ? 0.4 : 1), itemId: 1,
    freezeT: 0, stopT: 0, slowT: 0, slowN: 0, cut: null, ev: [], evId: 1, teamAI: [{ serial: -1, chaser: -1 }, { serial: -1, chaser: -1 }], winner: -1, rallyHits: 0, pred: null };
  for (let i = 0; i < n * 2; i++) S.players.push(mkPlayer(i, cfg.slots[i], n));
  startServe(S);
  return S;
}

function home(S, p) {
  if (S.phase === 'serve' && S.server === p.i) return [netD(p.team, SRV), ZD / 2];
  const h = HOMES[S.n][p.slot]; return [netD(p.team, h[0]), h[1] * ZD];
}

function startServe(S) {
  S.phase = 'serve'; S.phaseT = 0; S.rallyHits = 0;
  const team = S.serveTeam;
  S.server = team * S.n + (S.serveIdx[team] % S.n);
  for (const p of S.players) {
    for (const k in p.st) p.st[k] = 0; p.act = 'idle'; p.actT = 0; p.chg = 0; p.fell = false; p.bufA = 0; p.jumpHold = false; p.bounce = 0; p.sky = false; p.atSrv = false; p.ai.serveAt = rnd(1.5, 2.3);
    if (p.ko) { p.ko = false; p.hp = Math.max(p.hp, 55); } p.hp = Math.min(100, p.hp + STA.serve);
  }
  if (!S.tick) { const sp = S.players[S.server]; sp.x = netD(team, SRV); sp.z = ZD / 2; sp.atSrv = true; } // 경기 첫 서브
  const b = S.ball;
  b.vx = b.vy = b.vz = 0; b.lastTeam = -1; b.lastP = -1; b.noP = -1; b.touches = 0; b.power = false; b.sup = null; b.supTeam = -1; b.cap = false; b.held = true; b.float = 0; b.home = 0; b.fuse = 0; b.teamCd = 0; b.chain = 0; b.nice = 0; b.quick = false; b.serial++;
  S.decoys = []; S.ufo = null; S.ice[0] = S.ice[1] = 0; S.items.length = 0;
  S.wind = S.env.windy ? Math.round(rnd(-1, 1) * 230) : 0;
  ev(S, 'ready', NETX, 300, ZD / 2, team);
  const a = S.score[0], c = S.score[1], t = S.target, mp = x => x >= t - 1 && x > Math.min(a, c) && (x + 1 >= t + 5 || x + 1 - Math.min(a, c) >= 2);
  if (mp(a) || mp(c)) ev(S, 'txt', NETX, 250, ZD / 2, '매치 포인트!', 3);
}

/* ---------- 공 궤적 계산 ---------- */
function cz(z) { return clamp(z, 24, ZD - 24); }
function lob(S, b, tx, tz, ty, apexY) {
  const g = ballG(S, b);
  apexY = Math.min(apexY, b.y - 30, ty - 30);
  const up = Math.sqrt(2 * g * (b.y - apexY)), T = up / g + Math.sqrt(2 * (ty - apexY) / g);
  b.vy = -up; b.vx = (tx - b.x) / T; b.vz = (cz(tz) - b.z) / T;
}
function lobOver(S, b, team, d, tz, e, apexY) { // 네트를 반드시 넘기는 로브
  const tx = oppD(team, clamp(d + e, 70, 590)), g = ballG(S, b);
  for (let i = 0; i < 14; i++) {
    lob(S, b, tx, tz, GY - BR, apexY);
    const tn = (NETX - b.x) / (b.vx || 1e-6), yn = b.y + b.vy * tn + 0.5 * g * tn * tn;
    if (tn <= 0 || yn < NETTOP - BR - 16) return;
    apexY -= 45;
  }
}
function drive(S, b, tx, tz, ty, speed) {
  tz = cz(tz);
  const g = ballG(S, b), dx = tx - b.x, dy = ty - b.y, dz = tz - b.z;
  let T = Math.hypot(dx, dy, dz) / (speed * BALL_K);
  for (let i = 0; i < 40; i++) {
    const vx = dx / T, vy = (dy - 0.5 * g * T * T) / T;
    let ok = true;
    if ((b.x - NETX) * (tx - NETX) < 0) {
      for (const nx of [NETX - NETW / 2 - 4, NETX + NETW / 2 + 4]) {
        const tn = (nx - b.x) / vx, yn = b.y + vy * tn + 0.5 * g * tn * tn;
        if (yn > NETTOP - BR - 10) ok = false;
      }
    }
    if (ok) { b.vx = vx; b.vy = vy; b.vz = dz / T; return T; }
    T *= 1.1;
  }
  lob(S, b, tx, tz, ty, NETTOP - 120); return 1;
}
function ballStep(S, q, dt, real) {
  if (!q.nog) {
    const g = GB * S.env.g * (q.float > 0 ? 0.5 : 1);
    q.vy += g * dt; q.vx += S.wind * dt * (q.float > 0 ? 1.6 : 1);
  }
  q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
  if (!q.out) { // 끝선 밖으로 나가는 서브는 벽에 튕기지 않는다
    if (q.x < BR && q.vx <= 0) { q.x = BR; q.vx = Math.abs(q.vx) * 0.75; if (real) ev(S, 'wall', q.x, q.y, q.z); }
    if (q.x > CW - BR && q.vx >= 0) { q.x = CW - BR; q.vx = -Math.abs(q.vx) * 0.75; if (real) ev(S, 'wall', q.x, q.y, q.z); }
  }
  if (q.z < 6) { q.z = 6; q.vz = Math.abs(q.vz) * 0.7; if (real) ev(S, 'wall', q.x, q.y, q.z); }
  if (q.z > ZD - 6) { q.z = ZD - 6; q.vz = -Math.abs(q.vz) * 0.7; if (real) ev(S, 'wall', q.x, q.y, q.z); }
  if (S.env.ceil && q.y < S.env.ceil + BR) { q.y = S.env.ceil + BR; q.vy = Math.abs(q.vy) * 0.8; if (real) ev(S, 'wall', q.x, q.y, q.z); }
  const hw = NETW / 2;
  if (q.y > NETTOP - BR && Math.abs(q.x - NETX) < hw + BR) {
    const cx = clamp(q.x, NETX - hw, NETX + hw), cy = Math.max(q.y, NETTOP);
    let dx = q.x - cx, dy = q.y - cy, d = Math.hypot(dx, dy);
    if (d < BR) {
      if (d < 0.01) { dx = q.vx < 0 ? 1 : -1; dy = 0; d = 1; }
      const nx = dx / d, ny = dy / d;
      q.x = cx + nx * BR; q.y = cy + ny * BR;
      const vn = q.vx * nx + q.vy * ny;
      if (vn < 0) { q.vx -= 1.55 * vn * nx; q.vy -= 1.55 * vn * ny; if (real && Math.abs(vn) > 120) ev(S, 'net', q.x, q.y, q.z); }
      if (real && Math.abs(q.vx) < 25 && ny < -0.8) q.vx += (Math.random() < 0.5 ? -1 : 1) * 60;
    }
  }
}
function predict(S) {
  useCourt(S.n);
  const b = S.ball, out = { pts: [], land: null };
  if (b.held) return out;
  const q = { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, float: b.float, out: b.out };
  let t = 0;
  if (b.cap) {
    const u = S.ufo; if (!u || u.st > 1) return out;
    t = u.st === 0 ? (0.55 - u.t) + u.dur : Math.max(0, u.dur - u.t);
    q.x = u.st === 1 ? u.x : oppD(u.team, 330); q.z = u.st === 1 ? u.z : ZD / 2; q.y = 237; q.vx = q.vz = 0; q.vy = 1300;
  }
  for (let i = 0; i < 360; i++) {
    ballStep(S, q, DT, false); t += DT;
    out.pts.push({ x: q.x, y: q.y, z: q.z, vy: q.vy, t });
    if (q.y + BR >= GY) { out.land = { x: q.x, z: q.z, t }; break; }
  }
  return out;
}

/* ---------- 체력·게이지·득점 ---------- */
const GAUGE_K = 0.45; // 필살기 게이지가 차는 속도(전체 배율)
function addGauge(p, v) { p.gauge = clamp(p.gauge + v * GAUGE_K, 0, 100); }
function hurt(S, p, d) {
  if (p.ko) return;
  p.hp -= d * (1.25 - CHARS[p.ch].gut * 0.08);
  if (p.hp <= 0) {
    p.hp = 0; p.ko = true; p.st.down = Math.max(p.st.down, 3.3 * cool(p)); p.act = 'idle'; p.chg = 0; p.stats.fall++;
    p.vy = -1950 * Math.sqrt(S.env.g); p.gnd = false; p.vx = clamp(p.vx * 0.4, -150, 150); p.sky = true; p.bounce = 1;
    ev(S, 'ko', p.x, p.y - 60, p.z, p.i); ev(S, 'txt', p.x, p.y - 170, p.z, '기절!!', 3);
  }
}
function noTouch(V, p) { // 파티(2:2·3:3): 방금 공을 친 사람은 연달아 못 친다(토스→스파이크, 토스→토스 혼자 하기 금지). 동료가 전부 기절·얼음·잠·김밥 상태일 때만 봐준다
  const b = V.ball; if (V.n < 2 || b.noP !== p.i || b.lastTeam !== p.team) return false;
  for (const q of V.players) if (q.i !== p.i && q.team === p.team && !(q.ko || q.st.frozen > 0 || q.st.sleep > 0 || q.st.wrap > 0)) return true;
  return false;
}
function touch(S, p, kind) {
  const b = S.ball;
  if (kind === 'block' || b.lastTeam !== p.team) { b.chain = 0; b.nice = 0; }
  if (kind === 'bump') b.chain++; else { b.chain = 0; b.nice = 0; }
  b.quick = false;
  if (kind === 'block') { b.lastTeam = p.team; b.touches = 0; }
  else if (b.lastTeam === p.team) b.touches++; else { b.lastTeam = p.team; b.touches = 1; }
  b.full = false; b.out = false; b.lastP = p.i; b.noP = kind === 'bump' || kind === 'spike' ? p.i : -1; b.serial++; b.teamCd = 0.2; p.hitCd = 0.3; p.hitDone = true; S.rallyHits++; // 블로킹·몸에 맞은 공은 같은 사람이 이어서 쳐도 된다
  if (b.touches > 3) { ev(S, 'txt', b.x, b.y - 40, b.z, '포 히트! (4번 터치)', 2); point(S, 1 - p.team, -1); return false; }
  return true;
}
function point(S, team, scorer) {
  if (S.phase !== 'rally') return;
  S.score[team]++; S.phase = 'point'; S.phaseT = 0; S.pointTeam = team;
  if (scorer >= 0) S.players[scorer].stats.pts++;
  for (const p of S.players) { addGauge(p, p.team === team ? 10 : 14); if (p.team === team && p.gnd && !busy(p)) { p.vy = -rnd(330, 470); p.gnd = false; p.act = 'idle'; p.chg = 0; } }
  if (S.serveTeam !== team) { S.serveTeam = team; S.serveIdx[team]++; }
  const t = S.target, a = S.score[0], c = S.score[1], cap = t + 5;
  if ((Math.max(a, c) >= t && Math.abs(a - c) >= 2) || Math.max(a, c) >= cap) S.winner = a > c ? 0 : 1;
  ev(S, 'point', S.ball.x, GY, S.ball.z, team, S.winner >= 0 ? 1 : 0);
  if (S.winner >= 0) S.slowT = 1.0; // 마지막 한 점은 느리게
}
function knock(S, p, dur, dir) {
  const c = CHARS[p.ch];
  p.st.down = Math.max(p.st.down, dur * gutMul(p) * (c.id === 'bbabjji' ? 0.6 : 1));
  p.vx = dir * rnd(300, 400); p.vz = rnd(-90, 90); p.vy = -rnd(450, 540); p.gnd = false; p.act = 'idle'; p.chg = 0; p.stats.fall++; addGauge(p, 10); p.bounce = 1; p.bowled = false; p.st.flat = 0;
}
function popBall(S, p, spread, lo, hi) {
  const b = S.ball;
  let tx = p.x + rnd(-spread, spread);
  tx = p.team === 0 ? clamp(tx, 60, NETX - 60) : clamp(tx, NETX + 60, CW - 60);
  lob(S, b, tx, p.z + rnd(-spread, spread) * 0.6, GY - 200, GY - rnd(lo, hi)); b.power = false; b.home = 0;
}
/* 필살기 공을 받았을 때. true면 여기서 처리 끝 */
function supReceive(S, p, perfect) {
  const b = S.ball, k = b.sup;
  if (!k) return false;
  if (k === 'hot') { ev(S, 'txt', p.x, p.y - 150, p.z, '앗 뜨거!', 3); hurt(S, p, 3); return false; }
  if (b.supTeam === p.team) return false;
  if (k === 'bogo') { b.sup = null; return false; }
  if (perfect) { b.sup = null; b.home = 0; addGauge(p, 20); ev(S, 'txt', p.x, p.y - 150, p.z, '슈퍼 리시브!!', 1); return false; }
  const dir = b.vx >= 0 ? 1 : -1;
  if (!touch(S, p, 'body')) return true;
  const gm = gutMul(p); S.stopT = 0.14; ev(S, 'hit', b.x, b.y, b.z, 3, p.i);
  if (k === 'ufo') { knock(S, p, 1.6, dir); p.vy = -200; hurt(S, p, 32); ev(S, 'bonk', p.x, p.y - 60, p.z, '납작…', 3); popBall(S, p, 130, 380, 480); }
  else if (k === 'thorn') { p.st.hop = 1.8 * gm; hurt(S, p, 26); ev(S, 'bonk', p.x, p.y - 60, p.z, '앗 따가! 엉덩이!', 3); popBall(S, p, 170, 300, 430); }
  else if (k === 'ice') { p.st.frozen = 2.0 * gm; p.act = 'idle'; p.vx = dir * 330; hurt(S, p, 18); ev(S, 'freeze', p.x, p.y - 60, p.z, '꽁꽁!', 3); popBall(S, p, 110, 340, 420); }
  b.sup = null;
  return true;
}

function dirKeys(p, inp) { // fwd = 상대 코트 쪽, back = 우리 코트 뒤쪽, far = 화면 안쪽(↑), near = 화면 바깥쪽(↓)
  const f = fdir(p);
  return { fwd: !!(inp & (f > 0 ? K.R : K.L)), back: !!(inp & (f > 0 ? K.L : K.R)), far: !!(inp & K.U), near: !!(inp & K.D) };
}
function laneZ(p, d, straight) { return d.far ? ZD * 0.18 : d.near ? ZD * 0.82 : straight; }

function hitBump(S, p, viaDive) {
  const b = S.ball, c = CHARS[p.ch];
  const perfect = p.perfect && !viaDive;
  if (supReceive(S, p, perfect)) return;
  const d = dirKeys(p, viaDive ? 0 : p.inp);
  const vin = Math.hypot(b.vx, b.vy, b.vz) * (b.power ? 1 : 0.55);
  const wasOpp = b.lastTeam !== p.team, air = !p.gnd && !viaDive;
  if (!touch(S, p, 'bump')) return;
  if (perfect) b.nice++;
  const n = b.touches, skill = (430 + c.tec * 130) * fat(p);
  let err = c.id === 'barcode' ? 0 : (6 - c.tec) * 7, stag = false;
  if (perfect) err = 0;
  else if (viaDive) err = 95;
  else if (vin > skill * 1.22) { err = 300; stag = true; }
  else if (vin > skill * 0.92) err = 95;
  const e = rnd(-err, err), ez = rnd(-err, err) * 0.5, T = p.team;
  if (air) { // 공중 A = 페인트(살짝 넘기기)
    lobOver(S, b, T, d.fwd ? 330 : 115, laneZ(p, d, p.z) + ez, e * 0.5, Math.min(b.y - 36, NETTOP - 64));
    ev(S, 'txt', p.x, p.y - 150, p.z, '페인트~', 0);
  } else if (n >= 3) {
    if (d.fwd) lobOver(S, b, T, 540, laneZ(p, d, p.z) + ez, e, GY - 400);
    else if (d.back) lobOver(S, b, T, 150, laneZ(p, d, p.z) + ez, e, NETTOP - 100);
    else lobOver(S, b, T, 390, laneZ(p, d, p.z) + ez, e, GY - 390);
  } else {
    const tz = laneZ(p, d, (p.z + ZD / 2) / 2) + ez;
    if (d.fwd) { lob(S, b, netD(T, 80) + e, tz, GY - 240, GY - 350); b.quick = true; }
    else if (d.back) lob(S, b, netD(T, 400) + e, tz, GY - 240, GY - 440);
    else lob(S, b, netD(T, 165) + e, tz, GY - 240, GY - (stag ? rnd(250, 360) : 450));
  }
  b.power = false; b.home = 0;
  if (wasOpp) p.stats.rcv++; tire(p, perfect ? 0.6 : 1.2);
  addGauge(p, perfect ? 12 : 6);
  if (stag) { p.st.stun = 0.8 * gutMul(p); hurt(S, p, 10); ev(S, 'bump', b.x, b.y, b.z, 2); ev(S, 'txt', p.x, p.y - 150, p.z, '어질어질…', 2); }
  else if (viaDive) { ev(S, 'bump', b.x, b.y, b.z, 1); ev(S, 'txt', p.x, p.y - 110, p.z, viaDive === 'body' ? '몸으로 받기!' : '몸 날려 받기!', 0); }
  else if (perfect) { S.stopT = 0.045; ev(S, 'hit', b.x, b.y, b.z, 1, p.i); ev(S, 'bump', b.x, b.y, b.z, 3); ev(S, 'txt', p.x, p.y - 150, p.z, wasOpp ? '나이스 리시브!' : '나이스 토스!', 1); }
  else ev(S, 'bump', b.x, b.y, b.z, 0);
}
function spikeAim(p, inp) { // 방향키로 고른 스파이크 목표(오차 없이). 화면의 조준 표시에도 쓴다
  const d = dirKeys(p, inp), dist = d.fwd ? 525 : d.back ? 185 : 350;
  return { x: clamp(oppD(p.team, dist), 50, CW - 50), z: cz(laneZ(p, d, p.z)) };
}
function spikeTarget(S, p, d) {
  const T = p.team, c = CHARS[p.ch], e = rnd(-1, 1) * (20 + (6 - c.tec) * 12), ez = rnd(-1, 1) * (12 + (6 - c.tec) * 8);
  const dist = d.fwd ? 525 : d.back ? 185 : 350;
  return { x: clamp(oppD(T, dist) + e, 50, CW - 50), z: cz(laneZ(p, d, p.z) + ez) };
}
function hitSpike(S, p) {
  const b = S.ball, c = CHARS[p.ch];
  if (supReceive(S, p, false)) return;
  const d = dirKeys(p, p.inp);
  const mineB = b.lastTeam === p.team, chain = mineB ? b.chain : 0, nice = mineB ? b.nice : 0, quick = mineB && b.quick, air = !p.gnd;
  const direct = !mineB && b.lastTeam >= 0, back = air && Math.abs(p.x - NETX) > 290 * XS;
  if (!touch(S, p, 'spike')) return;
  let tag = null, mul = 1, bonus = 0;
  if (air && chain >= 2 && nice >= 1 && p.pw >= 1.12) { tag = '3단 콤보!'; mul = 1.12; bonus = 10; } // 나이스 리시브/토스가 끼고, 충분히 모아 쳐야 한다
  else if (air && quick) { tag = '속공!'; mul = 1.1; bonus = 6; }
  else if (air && direct) { tag = '다이렉트!'; mul = 1.04; bonus = 6; }
  else if (back) { tag = '백어택!'; mul = 1.05; bonus = 7; }
  const tg = spikeTarget(S, p, d), full = p.pw >= 1.26; b.full = !p.gnd && full;
  const sp = (900 + c.pow * 85) * fat(p) * p.pw * (p.gnd ? 0.62 : 1) * (p.big > 0 ? 1.1 : 1) * (p.mini > 0 ? 0.85 : 1) * (1 + heat(S)) * mul;
  b.home = 0;
  drive(S, b, tg.x, tg.z, GY - BR, sp); b.power = !p.gnd && p.pw > 0.9;
  ev(S, 'spike', b.x, b.y, b.z, full ? 1 : 0, p.i);
  if (full) { ev(S, 'txt', p.x, p.y - 170, p.z, '풀파워!!', 1); hurt(S, p, 4); }
  if (tag) { ev(S, 'txt', p.x, p.y - (full ? 232 : 180), p.z, tag, 1, 1); addGauge(p, bonus); }
  S.stopT = air ? (full ? 0.11 : tag ? 0.085 : 0.04) : 0.02; ev(S, 'hit', b.x, b.y, b.z, full ? 3 : tag ? 2 : air ? 1 : 0, p.i);
  p.stats.spk++; addGauge(p, full ? 14 : 9); tire(p, full ? 4.5 : 2.5);
}
function hitBlock(S, p) {
  const b = S.ball, c = CHARS[p.ch], f = fdir(p);
  if (b.sup && b.sup !== 'hot' && b.supTeam !== p.team && b.sup !== 'bogo') { supReceive(S, p, false); return; }
  const hitter = S.players[b.lastP], hp = hitter ? CHARS[hitter.ch].pow : 3;
  const wasPower = b.power, wasFull = b.full;
  if (!touch(S, p, 'block')) return;
  const boss = c.id === 'goseum';
  if (wasPower && !boss && ((hp - c.pow >= 2 && Math.random() < 0.5) || (wasFull && Math.random() < 0.4))) { // 파워 차이가 크거나 풀파워면 손을 뚫는다
    b.vx *= 0.45; b.vy = -420; b.power = false; ev(S, 'block', b.x, b.y, b.z, 0); ev(S, 'txt', p.x, p.y - 190, p.z, '블록 아웃!', 2);
  } else {
    b.vx = f * (Math.abs(b.vx) * (boss ? 0.75 : 0.5) + 190); b.vy = wasPower ? (boss ? 380 : 240) : -160; b.vz *= 0.4; b.power = false;
    ev(S, 'block', b.x, b.y, b.z, 1); ev(S, 'txt', p.x, p.y - 190, p.z, boss ? '가시 장벽!' : '블로킹!', 1);
  }
  p.stats.blk++; addGauge(p, 14); tire(p, 2); S.stopT = 0.09; ev(S, 'hit', b.x, b.y, b.z, 2, p.i);
}
function hitBody(S, p) {
  const b = S.ball, c = CHARS[p.ch], s = p.st;
  if (s.sleep > 0) { s.sleep = 0; ev(S, 'txt', p.x, p.y - 150, p.z, '헉! 깼다', 0); }
  if (supReceive(S, p, false)) return;
  const v = Math.hypot(b.vx, b.vy, b.vz), strong = b.power && v > 600 + c.gut * 70;
  const dir = b.vx >= 0 ? 1 : -1, T = p.team;
  if (!touch(S, p, 'body')) return;
  p.hitCd = 0.36; b.home = 0;
  if (s.down > 0 && c.id === 'bbabjji' && !p.ko) { lob(S, b, netD(T, 200) + rnd(-50, 50), p.z + rnd(-40, 40), GY - 240, GY - 430); b.power = false; ev(S, 'bump', b.x, b.y, b.z, 1); ev(S, 'txt', p.x, p.y - 90, p.z, '바둥바둥 리시브!', 1); return; }
  if (strong && c.id === 'bami' && s.down <= 0) { lob(S, b, netD(T, 170) + rnd(-25, 25), (p.z + ZD / 2) / 2, GY - 240, GY - 450); b.power = false; ev(S, 'bump', b.x, b.y, b.z, 3); ev(S, 'txt', p.x, p.y - 150, p.z, '밤송이 헤딩!', 1); p.stats.rcv++; return; }
  if (strong && s.down <= 0 && s.frozen <= 0) {
    S.stopT = 0.13; ev(S, 'hit', b.x, b.y, b.z, 3, p.i);
    if (v > 1150 && s.float <= 0) { // 풀파워에 정통으로 맞으면 하늘로 날아간다
      knock(S, p, 2.3, dir); p.vx *= 0.4; p.vy = -1950 * Math.sqrt(S.env.g); p.sky = true; hurt(S, p, 28); popBall(S, p, 280, 150, 330);
      ev(S, 'bonk', p.x, p.y - 60, p.z, '저 멀리~', 3); ev(S, 'fly', p.x, p.y - 60, p.z, p.i); S.stopT = 0.17; S.slowT = 0.4; return;
    }
    if (p.gnd && b.vy > 560 && b.y < p.y - 70 * psc(p) && Math.random() < 0.5) { // 위에서 내리꽂힌 공: 납작해진다
      s.flat = 1.25 * gutMul(p); s.stun = Math.max(s.stun, s.flat); p.act = 'idle'; p.chg = 0; p.vx = p.vz = 0; p.stats.fall++; addGauge(p, 10); hurt(S, p, 22); popBall(S, p, 240, 170, 330);
      ev(S, 'bonk', p.x, p.y - 40, p.z, '납작…', 3); return;
    }
    knock(S, p, 1.3, dir); hurt(S, p, 24); popBall(S, p, 280, 150, 330);
    ev(S, 'bonk', p.x, p.y - 60, p.z, ['퍽!', '안면 리시브!', '으악!', '철푸덕', '뿌엥!', '눈앞에 별이…'][Math.floor(Math.random() * 6)], 3); return;
  }
  if (s.down > 0 && p.gnd && Math.random() < 0.7) ev(S, 'txt', p.x, p.y - 80, p.z, ['꾸엑!', '아야!', '밟지 마!', '나 여기 있어…'][Math.floor(Math.random() * 4)], 0);
  b.vy = -rnd(400, 540); b.vx = clamp((b.x - p.x) * 5, -230, 230) + rnd(-40, 40); b.vz = clamp((b.z - p.z) * 4, -160, 160) + rnd(-30, 30); b.power = false;
  ev(S, 'boing', b.x, b.y, b.z);
}

/* ---------- 필살기 ---------- */
function cutIn(S, p) { tire(p, 4); S.freezeT = 0.8; S.cut = { p: p.i, t: 0 }; ev(S, 'cut', p.x, p.y, p.z, p.i); p.gauge = 0; p.stats.sup++; }
function instantSuper(S, p) {
  const c = CHARS[p.ch], opp = S.players.filter(q => q.team !== p.team), b = S.ball;
  if (c.sup === 'ufo') {
    if (b.cap || b.held || S.ufo) return;
    cutIn(S, p);
    b.cap = true; b.vx = b.vy = b.vz = 0; b.home = 0; b.lastTeam = p.team; b.lastP = p.i; b.noP = -1; b.touches = 0; b.power = false; b.serial++;
    if (b.sup !== 'hot') b.sup = null;
    S.ufo = { team: p.team, by: p.i, st: 0, t: 0, sx: netD(p.team, 560), sy: -90, sz: ZD / 2, x: netD(p.team, 560), y: -90, z: ZD / 2, bx: 0, by2: 0, bz: 0, dur: rnd(1.7, 2.5), w: rnd(3.6, 4.6), ph: rnd(0, 6.28), w2: rnd(2.2, 3.4), ph2: rnd(0, 6.28) };
    ev(S, 'ufo', b.x, b.y, b.z, p.team);
    return;
  }
  cutIn(S, p);
  if (c.sup === 'puppet') { for (const q of opp) { q.st.puppet = 3.0 * cool(q); q.pupBy = p.i; q.act = 'idle'; q.chg = 0; ev(S, 'jam', q.x, q.y - 100, q.z); } }
  else if (c.sup === 'float') { for (const q of opp) { q.st.float = 3.0 * cool(q); q.act = 'idle'; q.chg = 0; if (q.gnd) { q.gnd = false; q.vy = -200; } } ev(S, 'float', oppD(p.team, 300), GY - 200, ZD / 2, p.team); }
  else if (c.sup === 'wrap') {
    opp.sort((a, q) => Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(q.x - b.x, q.z - b.z));
    for (const q of opp.slice(0, 2)) { q.st.wrap = 2.7 * cool(q); q.act = 'idle'; q.chg = 0; ev(S, 'wrap', q.x, q.y - 50, q.z); }
  } else if (c.sup === 'snore') {
    for (const q of opp) { q.st.sleep = 2.3 * gutMul(q); q.act = 'idle'; q.chg = 0; ev(S, 'zzz', q.x, q.y - 100, q.z); }
    p.st.sleep = 0.9; ev(S, 'zzz', p.x, p.y - 100, p.z); ev(S, 'txt', p.x, p.y - 160, p.z, '…본인도 잠듦', 0);
  }
}
function hitSuper(S, p) {
  const b = S.ball, c = CHARS[p.ch], T = p.team;
  if (supReceive(S, p, true)) return;
  const d = dirKeys(p, p.inp);
  if (!touch(S, p, 'spike')) return;
  cutIn(S, p);
  const tg = spikeTarget(S, p, d), sp = (900 + c.pow * 85) * 1.2;
  b.sup = c.sup; b.supTeam = T; b.power = true; b.float = 0; b.home = 0; p.stats.spk++;
  if (c.sup === 'thorn') { drive(S, b, tg.x, tg.z, GY - 200, sp * 0.7); b.home = 2.6; b.power = false; }
  else if (c.sup === 'hot') { drive(S, b, tg.x, tg.z, GY - BR, sp * 0.9); b.fuse = 4.0; }
  else if (c.sup === 'ice') { drive(S, b, tg.x, tg.z, GY - BR, sp); S.ice[1 - T] = 6.5; ev(S, 'freeze', oppD(T, 300), GY - 20, ZD / 2, '빙판 주의!', 3); }
  else if (c.sup === 'bogo') {
    const ds = [[150, 0.25], [345, 0.75], [535, 0.4]].sort(() => Math.random() - 0.5);
    S.decoys = [];
    for (let i = 0; i < 2; i++) { const q = { x: b.x, y: b.y, z: b.z, vx: 0, vy: 0, vz: 0, rot: 0, float: 0 }; drive(S, q, oppD(T, ds[i][0]), ds[i][1] * ZD, GY - BR, sp * rnd(0.9, 1)); S.decoys.push(q); }
    drive(S, b, oppD(T, ds[2][0]), ds[2][1] * ZD, GY - BR, sp * 0.95);
  }
  ev(S, 'spike', b.x, b.y, b.z, 2, p.i); S.stopT = 0.15; ev(S, 'hit', b.x, b.y, b.z, 3, p.i);
}
function explode(S) {
  const b = S.ball, side = sideOf(b.x);
  ev(S, 'boom', b.x, b.y, b.z, side);
  for (const q of S.players) if (q.team === side) { knock(S, q, 1.5, q.x > b.x ? 1 : -1); q.soot = 8; hurt(S, q, 28); }
  ev(S, 'txt', b.x, b.y - 60, b.z, '펑!!', 3);
  b.sup = null; b.fuse = 0; b.power = false; b.touches = 0; b.noP = -1; b.serial++;
  if (S.phase === 'rally') { b.vy = -940; b.vx = rnd(-170, 170); b.vz = rnd(-90, 90); }
}
function trySuper(S, p) {
  const c = CHARS[p.ch];
  if (c.type === 'instant') { if (S.phase === 'rally') instantSuper(S, p); return; }
  p.act = 'super'; p.actT = 0; p.hitDone = false; p.perfect = false; p.chg = 0;
}

/* ---------- 서브 ---------- */
function doServe(S, p, power, inp, chg) {
  const b = S.ball, c = CHARS[p.ch], d = dirKeys(p, inp), T = p.team, f = fdir(p);
  b.held = false; b.lastTeam = T; b.lastP = p.i; b.noP = p.i; b.touches = 0; b.serial++; b.teamCd = 0.3; p.hitCd = 0.4; b.out = false; tire(p, power ? 2 : 0.5);
  const dist = d.fwd ? 520 : d.back ? 190 : 350, e = rnd(-1, 1) * (6 - c.tec) * 10, tz = laneZ(p, d, p.z) + rnd(-1, 1) * (6 - c.tec) * 8;
  b.z = p.z;
  if (power) {
    b.x = p.x + f * 22; b.y = p.y - 215; p.vy = -560; p.gnd = false;
    drive(S, b, oppD(T, dist) + e, tz, GY - BR, (900 + c.pow * 85) * fat(p) * (0.58 + 0.36 * chg)); b.power = chg > 0.5;
    if (chg >= 0.97 && Math.random() < SERVE_OUT_P) { b.out = true; drive(S, b, oppD(T, 640 + rnd(35, 80)), tz, GY - BR, (900 + c.pow * 85) * fat(p) * (0.58 + 0.36 * chg)); } // 너무 세게 때려 끝선 밖으로
    p.act = 'spike'; p.actT = 0.05; p.hitDone = true; ev(S, 'spike', b.x, b.y, b.z, chg >= 0.97 ? 1 : 0, p.i); S.stopT = chg >= 0.97 ? 0.1 : 0.04; ev(S, 'hit', b.x, b.y, b.z, chg >= 0.97 ? 3 : 1, p.i);
  } else { b.x = p.x + f * 26; b.y = p.y - 78; lob(S, b, oppD(T, dist) + e, tz, GY - BR, GY - 480); p.act = 'bump'; p.actT = 0.05; p.hitDone = true; ev(S, 'bump', b.x, b.y, b.z, 0); }
  p.chg = 0;
  S.phase = 'rally'; S.phaseT = 0; ev(S, 'serve', b.x, b.y, b.z);
}

/* ---------- 선수 ---------- */
function ballNear(S, p, mul) {
  const b = S.ball, s = psc(p), f = fdir(p);
  if (b.held || b.cap) return false;
  const ck = ctl(S, p), reach = 96 * s * (CHARS[p.ch].id === 'jiae' ? 1.22 : 1) * mul * ck.reach;
  return Math.hypot(b.x - p.x - f * 10 * s, b.y - p.y + 56 * s, (b.z - p.z) * ck.zk) < reach; // 2.5D라 깊이를 맞추기 어렵다 → 깊이 차이는 덜 따진다
}
function stepPlayer(S, p) {
  const c = CHARS[p.ch], s = p.st;
  const wasFloat = s.float > 0;
  for (const k in s) if (s[k] > 0) s[k] = Math.max(0, s[k] - DT);
  if (p.big > 0) p.big -= DT; if (p.mini > 0) p.mini -= DT; if (p.fast > 0) p.fast -= DT; if (p.soot > 0) p.soot -= DT; if (p.hitCd > 0) p.hitCd -= DT;
  if (p.ko && s.down <= 0) { p.ko = false; p.hp = 55; ev(S, 'txt', p.x, p.y - 150, p.z, '부활!', 1); }
  if (!p.ko) { const mv = Math.hypot(p.vx, p.vz); if (S.phase !== 'rally') p.hp = Math.min(100, p.hp + STA.rest * DT); else if (p.gnd && mv < 40 && p.act === 'idle') p.hp = Math.min(100, p.hp + STA.idle * DT); else if (p.gnd) tire(p, (mv > pSpeed(S, p) * 0.6 ? STA.run : STA.walk) * DT); if (p.hp < 30 && !p.tiredMsg) { p.tiredMsg = 1; ev(S, 'txt', p.x, p.y - 150, p.z, '헉헉…', 0); } else if (p.hp > 45) p.tiredMsg = 0; }
  let inp = p.inp;
  const raw = p.inp & ~p.prevIn; p.prevIn = p.inp;
  if (!p.bot && raw && (s.down > 0 || s.stun > 0 || s.frozen > 0 || s.sleep > 0)) { // 연타로 빨리 일어나기
    const k = p.ko ? 0.035 : 0.07; for (const n of ['down', 'stun', 'frozen', 'sleep', 'flat']) if (s[n] > 0) s[n] = Math.max(0, s[n] - k);
    ev(S, 'wig', p.x, p.y - 50, p.z, p.i);
  }
  if (s.flat <= 0 && p.wasFlat && p.gnd) { p.vy = -330; p.gnd = false; ev(S, 'txt', p.x, p.y - 120, p.z, '뿅!', 1); }
  p.wasFlat = s.flat > 0;
  if (s.puppet > 0) { // 해킹당함: 조종자의 입력을 좌우 반전해서 따라 한다(점프만 허용)
    const src = S.players[p.pupBy]; const si = src ? src.inp : 0;
    inp = ((si & 1) << 1) | ((si & 2) >> 1) | (si & (K.U | K.D)) | (p.gnd ? (si & K.S) : 0);
  }
  const serving = S.phase === 'serve' && S.server === p.i;
  if (serving && !p.atSrv) { const hx0 = netD(p.team, SRV); if (Math.abs(p.x - hx0) < 12) p.atSrv = true; else if (S.phaseT > 3.5) { p.x = hx0; p.vx = 0; p.atSrv = true; } }
  const toSrv = serving && !p.atSrv, inc = busy(p), reset = S.phase === 'serve' && (S.phaseT < 0.9 || toSrv);
  let mx = 0, mz = 0;
  const spd = pSpeed(S, p) * (p.act === 'charge' && p.gnd ? 0.6 : 1) * (toSrv ? 1.7 : 1), ice = S.ice[p.team] > 0;
  if (reset) { const h = home(S, p); mx = Math.abs(h[0] - p.x) < 10 ? 0 : (h[0] > p.x ? 1 : -1); mz = Math.abs(h[1] - p.z) < 10 ? 0 : (h[1] > p.z ? 1 : -1); inp = 0; }
  else if (!inc && p.act !== 'dive') { mx = ((inp & K.R) ? 1 : 0) - ((inp & K.L) ? 1 : 0); mz = ((inp & K.D) ? 1 : 0) - ((inp & K.U) ? 1 : 0); }
  if (serving && !reset) { const hx = netD(p.team, SRV); if ((p.x - hx) * mx > 0 && Math.abs(p.x - hx) > 28 * XS) mx = 0; }
  const ck = ctl(S, p);
  // 스파이크 조준: S로 뛰어 힘을 모으는(또는 휘두르는) 동안에는 공을 칠 자리로 저절로 날아가고, 방향키는 때릴 곳(상대 코트)만 고른다
  const aimAir = !p.bot && ck.assist > 0 && !p.gnd && (p.act === 'charge' || p.act === 'spike' || (p.jumpHold && p.act === 'idle')) && !serving && !inc && !reset && s.puppet <= 0 && s.wrap <= 0 && s.float <= 0;
  if (aimAir) {
    mx = mz = 0; const b = S.ball;
    if (S.phase === 'rally' && !b.held && !b.cap && !noTouch(S, p) && (sideOf(b.x) === p.team || Math.abs(b.x - NETX) < 90 * XS) && Math.abs(b.x - p.x) < 320 * XS) {
      const sc = psc(p), tx = b.x + b.vx * 0.1 - fdir(p) * 16 * sc, tz = b.z + b.vz * 0.1;
      mx = clamp((tx - p.x) / 30, -1, 1); mz = clamp((tz - p.z) / 24, -1, 1);
    }
  }
  if (mx && mz && !aimAir) { mx *= 0.7071; mz *= 0.7071; }
  if (!aimAir && !p.bot && ck.assist > 0 && !inc && !reset && !serving && p.act !== 'dive' && S.phase === 'rally' && s.puppet <= 0 && s.wrap <= 0 && !(inp & (K.U | K.D)) && !noTouch(S, p)) { // 깊이 자동 맞춤
    const b = S.ball, L = S.pred && S.pred.land; let tz = null;
    if (!b.held && !b.cap) {
      if (!p.gnd && Math.abs(b.x - p.x) < 190) tz = b.z;
      else if (p.gnd && L && sideOf(L.x) === p.team && Math.abs(L.x - p.x) < 230) tz = L.z;
    }
    if (tz !== null && Math.abs(tz - p.z) > 5) mz = clamp((tz - p.z) / 36, -1, 1) * Math.min(1, (p.gnd ? 0.62 : 0.8) * ck.assist);
  }
  if (p.act === 'dive') { // 정해진 거리(diveLen)만큼만 미끄러진다
    if (p.actT < 0.26) { const v = 600 + (c.id === 'sene' ? 190 : 0); p.vx = p.diveX * v; p.vz = p.diveZ * v; }
    else { const fr = (ice ? 600 : S.env.slip ? 1300 : 2600) * DT, v = Math.hypot(p.vx, p.vz); if (v > fr) { p.vx *= (v - fr) / v; p.vz *= (v - fr) / v; } else p.vx = p.vz = 0; }
    const rem = (p.diveLen || 0) - Math.hypot(p.x - p.diveX0, p.z - p.diveZ0), v = Math.hypot(p.vx, p.vz);
    if (rem <= 0) p.vx = p.vz = 0; else if (v * DT > rem) { p.vx *= rem / DT / v; p.vz *= rem / DT / v; }
  } else {
    const k = (reset ? 1.6 : 1) * (s.float > 0 ? 0.3 : 1) * (aimAir ? 1.3 : 1);
    const acc = (p.gnd ? (ice ? 620 : (inc ? 1700 : (S.env.slip ? 1500 : 4600))) : (inc ? 0 : 2200)) * DT;
    p.vx += clamp(mx * spd * k - p.vx, -acc, acc); p.vz += clamp(mz * spd * k - p.vz, -acc, acc);
  }
  const edge = inp & ~p.prev; p.prev = inp; if (edge & K.A) p.aT = S.time;
  const noCtl = inc || reset || s.wrap > 0 || s.puppet > 0;
  let jumped = false;
  if (!inc && !reset && p.gnd && p.act !== 'dive' && s.float <= 0 && !serving) {
    if (s.wrap > 0) { if (mx || mz || (edge & K.S)) { p.vy = -290; p.gnd = false; } }
    else if ((edge & K.S) && p.act !== 'charge') { p.vy = -jumpV(p); p.gnd = false; jumped = true; tire(p, 1.5); p.jumpHold = !p.bot; ev(S, 'jump', p.x, GY, p.z); }
  }
  if (s.hop > 0 && p.gnd) { p.vy = -400; p.gnd = false; p.vx = rnd(-120, 120); p.vz = rnd(-90, 90); }
  if (s.float > 0) { // 무중력: 둥실 떠오른다
    p.gnd = false;
    const want = p.y > GY - 235 ? -190 : 34 * Math.sin(S.time * 5 + p.i * 2);
    p.vy += (want - p.vy) * 0.12;
  } else if (!p.gnd) p.vy += pGrav(S, p) * DT;
  const px0 = p.x;
  p.y += p.vy * DT; p.x += p.vx * DT; p.z += p.vz * DT;
  if (p.y >= GY) {
    if (!p.gnd && s.down > 0 && p.bounce > 0 && p.vy > 260) { // 통! 하고 한 번 튕긴다
      p.bounce--; p.y = GY - 1;
      if (p.sky) { p.sky = false; p.vy = -520; ev(S, 'crash', p.x, GY, p.z, p.i); }
      else { p.vy = -p.vy * 0.42; p.vx *= 0.6; p.vz *= 0.6; ev(S, 'land', p.x, GY, p.z); }
    } else if (!p.gnd) {
      p.gnd = true; p.sky = false; if (p.vy > 500) ev(S, 'land', p.x, GY, p.z);
      if (p.act === 'spike' || p.act === 'block' || p.act === 'super' || p.act === 'charge' || p.act === 'bump') { p.act = 'idle'; p.chg = 0; }
      if (p.fell) { p.fell = false; p.st.stun = Math.max(p.st.stun, 0.55 * cool(p)); hurt(S, p, 8); ev(S, 'bonk', p.x, p.y - 30, p.z, '쿵! 엉덩방아', 3); }
    }
    p.y = GY; p.vy = 0;
  }
  if (wasFloat && s.float <= 0 && !p.gnd) p.fell = true;
  const m = 24 * psc(p);
  const slap = !p.gnd && s.down > 0 && Math.abs(p.vx) > 200 && p.y > NETTOP - 20 ? -0.4 * p.vx : 0, x0 = p.x;
  const out = 85 * XS; // 서브하는 선수만 끝선 뒤로 나갈 수 있다. 밖에 있던 선수는 안쪽으로만 움직인다
  if (p.team === 0) { const lo = serving ? -out : Math.min(m, px0); if (p.x < lo) { p.x = lo; p.vx = 0; } if (p.x > NETX - NETW / 2 - m) { p.x = NETX - NETW / 2 - m; p.vx = 0; } }
  else { const hi = serving ? CW + out : Math.max(CW - m, px0); if (p.x > hi) { p.x = hi; p.vx = 0; } if (p.x < NETX + NETW / 2 + m) { p.x = NETX + NETW / 2 + m; p.vx = 0; } }
  if (slap && p.x !== x0) { p.vx = slap; if (Math.abs(p.x - NETX) < 80) ev(S, 'bonk', p.x, p.y - 60, p.z, '네트에 찰싹!', 3); }
  if (p.z < 14) { p.z = 14; p.vz = 0; } if (p.z > ZD - 14) { p.z = ZD - 14; p.vz = 0; }
  if (p.gnd && !inc && Math.hypot(p.vx, p.vz) > 90) for (const q of S.peels) if (q.t > 0 && Math.hypot(q.x - p.x, q.z - p.z) < 30) {
    q.t = 0; p.st.down = 1.15 * gutMul(p); const v = Math.hypot(p.vx, p.vz); p.vx = p.vx / v * 420; p.vz = p.vz / v * 420; p.vy = -330; p.gnd = false; p.act = 'idle'; p.chg = 0; p.stats.fall++; hurt(S, p, 10); ev(S, 'slip', p.x, GY, p.z, '미끄덩~', 3);
  }
  if (c.id === 'mandu' && p.gnd && Math.hypot(p.vx, p.vz) < 12 && S.phase === 'rally' && !inc) addGauge(p, 4.5 * DT);
  p.inReach = ballNear(S, p, 1) ? p.inReach + DT : 0;
  // ----- 액션 -----
  if (noCtl && p.act === 'charge') { p.act = 'idle'; p.chg = 0; }
  const canAct = !noCtl && !jumped && (p.act === 'idle' || p.act === 'charge' || (p.act !== 'dive' && p.actT > 0.2));
  if (canAct && (S.phase === 'rally' || serving)) {
    const pf = p.bot ? Math.random() < DIFFS[S.diff].perf : p.inReach <= ck.perf;
    const b = S.ball;
    let press = edge;
    if (p.bufA > 0) { press |= K.A; p.bufA = 0; }
    if (p.jumpHold) { if (!(inp & K.S) || p.gnd) p.jumpHold = false; else if (p.vy > -jumpV(p) * 0.8) { p.jumpHold = false; if (p.act === 'idle') press |= K.S; } } // S를 누른 채 뛰면 그대로 힘을 모은다
    if ((edge & K.X) && p.gauge >= 100 && !serving) trySuper(S, p);
    else if (press & K.A) {
      if (serving) doServe(S, p, false, inp, 0);
      else if (p.gnd && (mx || mz) && !ballNear(S, p, 1.25)) {
        const v = Math.hypot(mx, mz), maxD = DIVE_LEN * (c.id === 'sene' ? 1.25 : 1) * (S.env.slip || S.ice[p.team] > 0 ? 1.3 : 1);
        tire(p, 2); p.act = 'dive'; p.actT = 0; p.hitDone = false; p.diveX = mx / v; p.diveZ = mz / v; p.diveX0 = p.x; p.diveZ0 = p.z; p.diveLen = maxD; p.chg = 0;
        const L = S.pred && S.pred.land; // 쉬움·보통: 공이 떨어질 곳으로 저절로 향하고, 그 자리를 지나치지 않는다
        if (!p.bot && ck.assist > 0 && L && !b.held && !b.cap && sideOf(L.x) === p.team) {
          const dx = L.x - p.x, dz = L.z - p.z, dd = Math.hypot(dx, dz);
          if (dd > 1) { p.diveX = dx / dd; p.diveZ = dz / dd; p.diveLen = Math.min(maxD, Math.max(0, dd - 30)); }
        }
        hurt(S, p, 3); ev(S, 'dive', p.x, GY, p.z);
      }
      else { p.act = 'bump'; p.actT = 0; p.hitDone = false; p.perfect = pf; p.chg = 0; }
    } else if ((press & K.S) && p.act !== 'charge' && (serving || !p.gnd)) {
      const blk = !serving && Math.abs(p.x - NETX) < 135 && !b.held && !b.cap && b.lastTeam >= 0 && b.lastTeam !== p.team && sideOf(b.x) !== p.team;
      if (blk) { p.act = 'block'; p.actT = 0; p.hitDone = false; }
      else { p.act = 'charge'; p.actT = 0; p.chg = 0; p.chgHold = 0; }
    }
  }
  else if (!noCtl && !p.bot && ck.buf > 0 && (edge & K.A) && (p.act === 'bump' || p.act === 'spike')) p.bufA = ck.buf; // 조금 일찍 눌러도 받아 준다
  if (p.bufA > 0) p.bufA -= DT;
  if (p.act === 'charge') { // 파워게이지: 누르고 있으면 차고, 떼면 때린다
    let hold = inp & K.S;
    if (hold && ck.auto && !serving && !p.bot && !noTouch(S, p)) { // 쉬움: 공이 닿을 거리에 오면 알아서 때린다
      const b = S.ball, sc = psc(p), ds = b.held || b.cap ? 9999 : Math.hypot(b.x - p.x - fdir(p) * 16 * sc, b.y - p.y + 80 * sc, (b.z - p.z) * ck.zk);
      if (ds < 94 * sc * ck.reach && !(b.lastTeam === p.team && b.teamCd > 0) && (p.chg >= 0.5 || ds > p.sDist)) { hold = 0; p.chg = Math.min(p.chg, 0.5); } // 자동으로 나간 스파이크는 풀파워·콤보가 되지 않는다
      p.sDist = ds;
    }
    if (hold) {
      if (p.chg < 1) { p.chg = Math.min(1, p.chg + DT / (serving ? 0.7 : 0.42)); if (p.chg >= 1) ev(S, 'full', p.x, p.y - 70, p.z, p.i); }
      else { p.chgHold += DT; if (p.chgHold > 0.9) { p.chg = 0.3; p.chgHold = 0; ev(S, 'txt', p.x, p.y - 150, p.z, '힘 빠짐…', 2); } }
    } else if (serving) doServe(S, p, true, inp, p.chg);
    else { p.pw = 0.76 + 0.52 * p.chg; p.act = 'spike'; p.actT = 0; p.hitDone = false; }
  } else if (p.act !== 'idle') {
    p.actT += DT;
    const dur = p.act === 'bump' ? 0.32 : p.act === 'spike' ? 0.36 : p.act === 'super' ? 0.55 : p.act === 'dive' ? (S.env.sand ? 0.62 : 0.82) : 9;
    if (p.actT >= dur) { if (p.act === 'spike' && !p.hitDone && !S.ball.held && !S.ball.cap && S.phase === 'rally' && d3(S.ball.x, S.ball.y, S.ball.z, p.x, p.y - 80, p.z) < 230) ev(S, 'txt', p.x, p.y - 150, p.z, '헛스윙~', 0); p.act = 'idle'; p.actT = 0; }
  }
}

function contacts(S) {
  const b = S.ball;
  if (b.held || b.cap || S.phase !== 'rally') return;
  const np = S.players.length;
  for (let oi = 0; oi < np; oi++) {
    const p = S.players[S.tick & 1 ? oi : np - 1 - oi]; if (S.phase !== 'rally' || b.cap) return;
    if (p.hitCd > 0) continue;
    if (b.lastTeam === p.team && b.teamCd > 0) continue;
    const ck = ctl(S, p), s = psc(p), f = fdir(p), c = CHARS[p.ch], rm = (c.id === 'jiae' ? 1.22 : 1) * ck.reach;
    const dist = (x, y, z) => Math.hypot(b.x - x, b.y - y, (b.z - z) * ck.zk), bodyD = d3(b.x, b.y, b.z, p.x, p.y - 46 * s, p.z);
    if (!busy(p)) {
      const dbl = noTouch(S, p), no = () => { p.hitDone = true; if (p.dblS !== b.serial) { p.dblS = b.serial; ev(S, 'txt', p.x, p.y - 150, p.z, '연속 터치!', 0); } };
      if (p.act === 'bump' && p.actT <= 0.24 && !p.hitDone && dist(p.x + f * 10 * s, p.y - 56 * s, p.z) < 96 * s * rm) { if (dbl) no(); else hitBump(S, p, false); continue; }
      if (p.act === 'spike' && p.actT <= 0.22 && !p.hitDone && dist(p.x + f * 16 * s, p.y - 80 * s, p.z) < 100 * s * ck.reach) { if (dbl) no(); else if (!p.gnd && b.lastTeam >= 0 && b.lastTeam !== p.team && Math.random() < DIRECT_MISS) { p.hitDone = true; ev(S, 'txt', p.x, p.y - 150, p.z, '헛스윙~', 0); } else hitSpike(S, p); continue; }
      if (p.act === 'super' && p.actT <= 0.42 && !p.hitDone && dist(p.x + f * 12 * s, p.y - 72 * s, p.z) < 128 * s) { if (dbl) no(); else hitSuper(S, p); continue; }
      if (p.act === 'block' && b.lastTeam !== p.team && dist(p.x + f * 22 * s, p.y - 112 * s, p.z) < (c.id === 'goseum' ? 48 : 32) * s + BR) { hitBlock(S, p); continue; }
      if (p.act === 'dive' && p.actT < 0.4 && !p.hitDone && dist(p.x + p.diveX * 30, p.y - 26, p.z + p.diveZ * 30) < 74 * s * rm) { if (dbl) no(); else hitBump(S, p, true); continue; }
    }
    // 몸에 맞기: 상대가 친 공만(우리 팀 공은 통과)
    if (b.lastTeam !== p.team && bodyD < 34 * s + BR) { // 서브를 A로 받으려다 타이밍만 어긋나 몸에 맞으면(쉬움·보통의 사람) 넘어지지 않고 몸으로 받아 낸다(공은 조금 엉뚱하게 뜬다)
      if (S.rallyHits === 0 && !p.bot && ck.assist > 0 && p.gnd && !busy(p) && !b.sup && !b.out && p.act !== 'dive' && ((p.inp & K.A) || S.time - (p.aT || -9) < 0.6)) hitBump(S, p, 'body');
      else hitBody(S, p);
    }
  }
}

/* ---------- 아이템 ---------- */
function applyItem(S, it, team) {
  const mine = S.players.filter(p => p.team === team), opp = S.players.filter(p => p.team !== team);
  const nm = ITEMS.find(i => i.id === it.type).name;
  ev(S, 'item', it.x, it.y, it.z, it.type, team); ev(S, 'txt', it.x, it.y - 40, it.z, nm + '!', team === 0 ? 4 : 5);
  if (it.type === 'cheese') for (const p of mine) addGauge(p, 40);
  else if (it.type === 'big') for (const p of mine) { p.big = 7; p.mini = 0; }
  else if (it.type === 'fast') for (const p of mine) p.fast = 7;
  else if (it.type === 'mini') for (const p of opp) { p.mini = 7; p.big = 0; }
  else if (it.type === 'banana') for (let i = 0; i < 3; i++) S.peels.push({ x: oppD(team, rnd(70, 560)), z: rnd(30, ZD - 30), t: 14 });
  else if (it.type === 'balloon') S.ball.float = 5;
  else if (it.type === 'heal') for (const p of mine) if (!p.ko) p.hp = Math.min(100, p.hp + 45);
}
function stepItems(S) {
  const b = S.ball;
  for (const q of S.peels) q.t -= DT; S.peels = S.peels.filter(q => q.t > 0);
  if (b.float > 0) b.float -= DT;
  if (!S.itemsOn || S.phase !== 'rally') return;
  S.itemT -= DT;
  if (S.itemT <= 0 && S.items.length < (S.env.fest ? 3 : 2)) {
    S.itemT = rnd(13, 19) * (S.env.fest ? 0.45 : 1); // 다음 아이템까지(초). v0.34: 7~12 → 13~19
    const it = { id: S.itemId++, type: ITEMS[Math.floor(Math.random() * ITEMS.length)].id, x: rnd(190, CW - 190), y: rnd(170, 340), z: rnd(60, ZD - 60), t: 16 }; // 떠 있는 시간(초)
    S.items.push(it); ev(S, 'spawn', it.x, it.y, it.z);
  }
  for (const it of S.items) {
    it.t -= DT;
    if (!b.cap && !b.held && b.lastTeam >= 0 && d3(b.x, b.y, b.z, it.x, it.y, it.z) < BR + 40) { it.t = 0; applyItem(S, it, b.lastTeam); }
  }
  S.items = S.items.filter(it => it.t > 0);
}

/* ---------- 봇 AI ---------- */
function intercept(S, p, pr, mode) {
  const s = psc(p), pts = pr.pts;
  if (!pts.length) return null;
  if (mode === 'spike') {
    const hy = GY - (jumpH(S, p) * 0.8 + 86 * s);
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i];
      if (q.vy > 0 && q.y >= hy) {
        if (q.y > hy + 34 || sideOf(q.x) !== p.team || Math.abs(q.x - NETX) < 34) return null;
        return { x: q.x, y: q.y, z: q.z, t: q.t, mode };
      }
    }
    return null;
  }
  const hy = GY - 112 * s;
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i];
    if ((q.vy > 0 && q.y >= hy) || i === pts.length - 1) {
      if (sideOf(q.x) !== p.team) return null;
      return { x: q.x, y: q.y, z: q.z, t: q.t, mode: 'bump' };
    }
  }
  return null;
}
function aiTeam(S, team, pr) {
  const b = S.ball, D = DIFFS[S.diff], Tm = S.teamAI[team];
  Tm.bz = Tm.bz == null ? b.z : Tm.bz + (b.z - Tm.bz) * Math.min(1, DT * 3.5); // 블로커가 보는 공 깊이(약 0.3초 늦게 따라감)
  const mine = S.players.filter(p => p.team === team), opp = S.players.filter(p => p.team !== team);
  const n = b.lastTeam === team ? b.touches : 0;
  if (Tm.serial !== b.serial) {
    Tm.serial = b.serial; Tm.chaser = -1; Tm.roll = Math.random(); Tm.roll2 = Math.random(); Tm.err = rnd(-D.err, D.err); Tm.errZ = rnd(-D.err, D.err);
    Tm.miss = b.power && Math.random() < D.miss * (1 + heat(S));
    Tm.wake = S.time + (b.lastTeam === team ? 0.04 : D.react * rnd(0.7, 1.3)); Tm.tac = Math.random(); Tm.tacZ = Math.random();
  }
  const able = p => !(busy(p) || p.st.wrap > 0 || p.st.puppet > 0 || p.st.float > 0 || p.act === 'dive');
  const homing = b.home > 0 && b.supTeam !== team;
  const dxz = (p, x, z) => Math.hypot(p.x - x, p.z - z);
  let best = null, bestCost = 1e9, bestIt = null;
  if (S.phase === 'rally' && !homing && n < 3) for (const p of mine) {
    if (!able(p) || noTouch(S, p)) continue;
    let it = null;
    if (n >= 2 || (n === 1 && Tm.roll < D.two)) it = intercept(S, p, pr, 'spike');
    if (!it) it = intercept(S, p, pr, 'bump');
    if (!it) continue;
    const dd = dxz(p, it.x, it.z);
    let cost = dd / pSpeed(S, p) - it.t;
    if (cost < -0.5) cost = -0.5 + dd / 2000;
    if (p.i === b.lastP && S.n > 1) cost += 0.18;
    if (p.i === Tm.chaser) cost -= 0.12;
    if (!p.bot) cost -= n === 0 ? (dd < 250 ? 0.4 : 0) : it.mode === 'spike' ? 0.3 : 0; // 사람 가까이 오는 첫 공과 마지막 공격은 사람에게 맡긴다
    if (cost < bestCost) { bestCost = cost; best = p; bestIt = it; }
  }
  Tm.chaser = best ? best.i : -1;
  const awake = S.time >= Tm.wake;
  const oppAttack = b.lastTeam === 1 - team && !b.held && !b.cap && sideOf(b.x) !== team;
  let front = null; for (const p of mine) if (p.bot && able(p) && (!front || Math.abs(p.x - NETX) < Math.abs(front.x - NETX)) && p !== best) front = p;
  let prey = null; if (homing) for (const p of mine) if (!p.ko && (!prey || d3(p.x, p.y, p.z, b.x, b.y, b.z) < d3(prey.x, prey.y, prey.z, b.x, b.y, b.z))) prey = p;
  for (const p of mine) {
    if (!p.bot) continue;
    let inp = 0; const f = fdir(p), s = psc(p), c = CHARS[p.ch];
    const go = (tx, tz, dz) => { if (p.x < tx - dz) inp |= K.R; else if (p.x > tx + dz) inp |= K.L; if (p.z < tz - dz) inp |= K.D; else if (p.z > tz + dz) inp |= K.U; };
    const press = k => { if (!(p.prev & k)) inp |= k; };
    const fwdK = f > 0 ? K.R : K.L, backK = f > 0 ? K.L : K.R, h = home(S, p);
    if (S.phase === 'serve') {
      if (S.server === p.i) {
        if (p.ai.svSerial !== b.serial) { p.ai.svSerial = b.serial; p.ai.sv = { pow: Math.random() < 0.6, hold: rnd(0.25, 0.7) * (0.4 + D.chg * 0.6), dir: Math.random(), dz: Math.random() }; }
        const sv = p.ai.sv;
        if (S.phaseT > p.ai.serveAt) {
          if (sv.dir < 0.3) inp |= fwdK; else if (sv.dir < 0.55) inp |= backK;
          if (sv.dz < 0.33) inp |= K.U; else if (sv.dz < 0.66) inp |= K.D;
          if (!sv.pow) inp |= K.A; else if (S.phaseT < p.ai.serveAt + sv.hold) inp |= K.S;
        }
      } else go(h[0], h[1], 12);
    } else if (S.phase === 'rally') {
      if (c.type === 'instant' && p.gauge >= 100 && able(p) && Tm.roll2 < D.sup && pr.land) {
        if (c.sup === 'ufo') { if (sideOf(pr.land.x) === team && pr.land.t < 0.75 && !b.cap) inp |= K.X; }
        else if (b.lastTeam === team && sideOf(pr.land.x) !== team && pr.land.t > 0.25 && pr.land.t < 1.1) inp |= K.X;
      }
      const human = best && !best.bot;
      let chase = awake && best === p;
      if (awake && human && best !== p && able(p)) {
        const it = intercept(S, p, pr, 'bump');
        if (it && it.t < 0.26 && dxz(best, bestIt.x, bestIt.z) > 130 && dxz(p, it.x, it.z) < 240 && !noTouch(S, p)) chase = true; // 사람이 끝내 안 움직이면 막판에 뛰어들어 본다(늦어서 자주 놓친다)
      }
      if (homing) { // 가시공에 쫓기는 중
        if (p === prey) { go(b.x > p.x ? 0 : CW, b.z > p.z ? 0 : ZD, 5); if (ballNear(S, p, 0.9)) { inp &= ~15; inp |= K.A; } }
        else go(h[0], h[1], 14);
      } else if (chase) {
        const it = best === p ? bestIt : intercept(S, p, pr, 'bump');
        if (it && it.mode === 'spike') {
          const tx = it.x - f * 28 * s + Tm.err * 0.5, tz = it.z + Tm.errZ * 0.4;
          go(tx, tz, 10);
          const tj = jumpV(p) / pGrav(S, p) * 0.8;
          const inR = !p.gnd && d3(b.x, b.y, b.z, p.x + f * 16 * s, p.y - 80 * s, p.z) < 100 * s * 0.86;
          if (p.gnd) { if (it.t <= tj + 0.02 && dxz(p, tx, tz) < 55) { inp &= ~K.S; press(K.S); } }
          else if (p.gauge >= 100 && c.type === 'spike' && Tm.roll2 < D.sup && inR && p.act !== 'spike') { inp &= ~15; inp |= K.X; }
          else if (p.act === 'charge') { if (!inR) inp |= K.S; }
          else if (p.act === 'idle' && (inR || (D.chg > 0 && p.vy > -jumpV(p) * (0.2 + D.chg * 0.75)))) press(K.S);
          if (inR || p.act === 'spike') { // 코스 선택
            inp &= ~15;
            let px = Tm.tac < 0.45 ? 0 : Tm.tac < 0.75 ? 1 : 2, pz = Tm.tacZ < 0.4 ? 0 : Tm.tacZ < 0.7 ? 1 : 2;
            if (S.diff === 'hard') {
              let bd = -1;
              for (let ix = 0; ix < 3; ix++) for (let iz = 0; iz < 3; iz++) {
                const x = oppD(team, [350, 525, 185][ix]), z = [p.z, ZD * 0.18, ZD * 0.82][iz];
                let m = 1e9; for (const q of opp) if (!busy(q)) m = Math.min(m, Math.hypot(q.x - x, q.z - z));
                if (m > bd) { bd = m; px = ix; pz = iz; }
              }
            }
            if (px === 1) inp |= fwdK; else if (px === 2) inp |= backK;
            if (pz === 1) inp |= K.U; else if (pz === 2) inp |= K.D;
          }
        } else if (it) {
          const tx = it.x - f * 8 + Tm.err, tz = it.z + Tm.errZ * 0.6;
          go(tx, tz, 9);
          const dd = dxz(p, tx, tz);
          if (Tm.miss && n === 0) { /* 타이밍을 놓쳤다 → 몸으로 받게 됨 */ }
          else if (ballNear(S, p, 0.84)) {
            inp &= ~15; inp |= K.A;
            if (b.sup === 'hot' && n < 2) { if (p.gnd) { inp &= ~K.A; press(K.S); } } // 폭탄은 뛰어서 바로 넘긴다
            else if (n === 1) {
              const hm = mine.find(q => !q.bot && q !== p && !busy(q));
              if (hm) { const d = Math.abs(hm.x - NETX); if (d < 125) inp |= fwdK; else if (d > 300) inp |= backK; if (hm.z < p.z - 70) inp |= K.U; else if (hm.z > p.z + 70) inp |= K.D; }
              else { if (Tm.tac < 0.25) inp |= fwdK; else if (Tm.tac > 0.8) inp |= backK; if (Tm.tacZ < 0.2) inp |= K.U; else if (Tm.tacZ > 0.8) inp |= K.D; }
            } else if (n >= 2) { if (Tm.tac < 0.35) inp |= fwdK; else if (Tm.tac > 0.8) inp |= backK; if (Tm.tacZ < 0.33) inp |= K.U; else if (Tm.tacZ > 0.66) inp |= K.D; }
          } else if (p.gnd && it.t < 0.42 && dd > pSpeed(S, p) * it.t + 36 && dd < DIVE_LEN + 40 && b.y > GY - 300 && Tm.roll < D.dive) {
            inp &= ~15; inp |= K.A; if (Math.abs(tx - p.x) > 20) inp |= tx > p.x ? K.R : K.L; if (Math.abs(tz - p.z) > 20) inp |= tz > p.z ? K.D : K.U;
          }
        } else go(h[0], h[1], 14);
      } else {
        let hx = h[0], hz = h[1];
        if (p === front && oppAttack && D.block > 0 && Tm.roll < D.block) {
          hx = netD(team, 58); hz = (Tm.bz != null ? Tm.bz : b.z) + Tm.errZ * 1.8 + (Tm.roll2 - 0.5) * 60; // 공 깊이를 조금 늦게, 오차를 두고 따라간다(코스를 비틀면 피할 수 있게)
          const atk = opp.find(q => !q.gnd && Math.abs(q.x - NETX) < 260 && d3(b.x, b.y, b.z, q.x, q.y - 80, q.z) < 190);
          go(hx, hz, 12);
          if (atk && p.gnd && dxz(p, hx, hz) < 70) { inp &= ~K.S; press(K.S); }
          if (!p.gnd && p.vy < 200 && p.act === 'idle' && d3(b.x, b.y, b.z, p.x, p.y - 110, p.z) < 300) press(K.S);
        } else {
          if (human && best !== p && bestIt && dxz({ x: hx, z: hz }, bestIt.x, bestIt.z) < 90) hx = bestIt.x - f * 110;
          go(hx, hz, 14);
        }
      }
    }
    if (p.prev & K.A) inp &= ~K.A; if (p.prev & K.X) inp &= ~K.X;
    p.inp = inp;
  }
}

/* ---------- 메인 스텝 ---------- */
function stepUfo(S) {
  const u = S.ufo, b = S.ball; u.t += DT;
  const sm = k => k * k * (3 - 2 * k);
  if (u.st === 0) {
    const k = sm(Math.min(1, u.t / 0.55));
    u.x = u.sx + (b.x - u.sx) * k; u.y = u.sy + (b.y - 64 - u.sy) * k; u.z = u.sz + (b.z - u.sz) * k;
    if (u.t >= 0.55) { u.st = 1; u.t = 0; u.bx = u.x; u.by2 = u.y; u.bz = u.z; }
  } else if (u.st === 1) {
    const sway = oppD(u.team, 330) + Math.sin(u.ph + u.t * u.w) * 232 * XS, swz = ZD / 2 + Math.sin(u.ph2 + u.t * u.w2) * ZD * 0.36, ky = sm(Math.min(1, u.t / 0.55));
    u.x = u.bx + (sway - u.bx) * ky; u.y = u.by2 + (175 - u.by2) * ky; u.z = u.bz + (swz - u.bz) * ky;
    b.x = u.x; b.y = u.y + 62; b.z = u.z; b.vx = b.vy = b.vz = 0;
    if (u.t >= u.dur) {
      b.cap = false; b.vy = 1300; b.power = true; b.serial++; b.teamCd = 0;
      if (b.sup !== 'hot') { b.sup = 'ufo'; b.supTeam = u.team; }
      u.st = 2; u.t = 0; ev(S, 'ufodrop', b.x, b.y, b.z, u.team);
      const me = S.players[u.by]; let got = 0;
      for (const q of S.players) if (q.team !== u.team) { const v = Math.min(25, q.gauge); q.gauge -= v; got += v; q.st.sad = 2.2; ev(S, 'coin', q.x, q.y - 60, q.z, u.by); if (v > 0) ev(S, 'txt', q.x, q.y - 150, q.z, '텅장…', 2); }
      if (me) addGauge(me, got);
    }
  } else { u.y -= 520 * DT; u.x += (u.team === 0 ? 1 : -1) * 260 * DT; if (u.t > 1.3) S.ufo = null; }
}
function step(S) {
  useCourt(S.n);
  if (S.freezeT > 0) { S.freezeT -= DT; if (S.cut) S.cut.t += DT; if (S.freezeT <= 0) S.cut = null; return; }
  if (S.stopT > 0) { S.stopT -= DT; return; }
  if (S.slowT > 0) { S.slowT -= DT; S.slowN = (S.slowN + 1) % 3; if (S.slowN) return; }
  S.tick++; S.time += DT; S.phaseT += DT;
  const b = S.ball;
  S.pred = predict(S);
  if (S.phase !== 'over') { aiTeam(S, 0, S.pred); aiTeam(S, 1, S.pred); } else for (const p of S.players) if (p.bot) p.inp = 0;
  if (b.out && S.phase === 'rally') for (const p of S.players) if (p.bot && p.team !== b.lastTeam) p.inp = 0; // PC는 나가는 서브를 건드리지 않고 지켜본다
  for (const p of S.players) stepPlayer(S, p);
  for (const p of S.players) if (p.st.down > 0 && !p.gnd && !p.bowled && !p.sky && Math.hypot(p.vx, p.vz) > 150 && p.y > GY - 150) // 날아가다 동료와 쾅
    for (const q of S.players) if (q !== p && q.team === p.team && q.gnd && !busy(q) && Math.hypot(q.x - p.x, q.z - p.z) < 58) {
      p.bowled = true; knock(S, q, 0.75, p.vx >= 0 ? 1 : -1); q.vx *= 0.75; q.vy = -330; hurt(S, q, 5); ev(S, 'bonk', q.x, q.y - 60, q.z, '우당탕!', 3); break;
    }
  if (S.ice[0] > 0) S.ice[0] -= DT; if (S.ice[1] > 0) S.ice[1] -= DT;
  if (b.teamCd > 0) b.teamCd -= DT;
  if (S.ufo && (S.phase === 'rally' || S.ufo.st === 2)) stepUfo(S);
  if (S.phase === 'serve') {
    const p = S.players[S.server], f = fdir(p);
    if (b.held) { b.x = p.x + f * 30; b.y = p.y - 62; b.z = p.z; b.rot = 0; }
    if (S.phaseT > 6.5 && b.held) doServe(S, p, false, 0, 0);
  } else if (S.phase === 'rally') {
    if (b.sup === 'hot' && !b.cap) { b.fuse -= DT; if (b.fuse <= 0) explode(S); }
    for (let k = 0; k < 2 && S.phase === 'rally'; k++) {
      if (!b.cap) {
        if (b.home > 0) { // 추적 가시공
          b.home -= DT / 2;
          let q = null; for (const o of S.players) if (o.team !== b.supTeam && !o.ko && (!q || d3(o.x, o.y, o.z, b.x, b.y, b.z) < d3(q.x, q.y, q.z, b.x, b.y, b.z))) q = o;
          if (q) {
            let tx = q.x, ty = q.y - 34 * psc(q), tz = q.z;
            if (sideOf(b.x) === b.supTeam && b.y > NETTOP - 80) { tx = oppD(b.supTeam, 40); ty = NETTOP - 120; }
            const d = d3(tx, ty, tz, b.x, b.y, b.z) || 1, k2 = Math.min(1, 7 * DT / 2);
            b.vx += ((tx - b.x) / d * 600 - b.vx) * k2; b.vy += ((ty - b.y) / d * 600 - b.vy) * k2; b.vz += ((tz - b.z) / d * 600 - b.vz) * k2;
          }
          b.nog = true; ballStep(S, b, DT / 2, true); b.nog = false;
          if (b.home <= 0) ev(S, 'txt', b.x, b.y - 40, b.z, '(가시공이 지쳤다)', 0);
        } else ballStep(S, b, DT / 2, true);
        b.rot += b.vx * DT / 2 / BR;
        if (b.y + BR >= GY) {
          b.y = GY - BR;
          if (b.out) { // 서브 아웃: 받는 쪽 점수
            ev(S, 'ground', b.x, GY, b.z, 0, 0); ev(S, 'txt', clamp(b.x, 200, CW - 200), 260, b.z, '서브 아웃!', 2, 1);
            point(S, 1 - b.lastTeam, -1); b.vy = -Math.abs(b.vy) * 0.5; b.vx *= 0.6; b.vz *= 0.6; break;
          }
          const side = sideOf(b.x), scorer = b.lastTeam === 1 - side ? b.lastP : -1;
          ev(S, 'ground', b.x, GY, b.z, b.sup || 0, b.power || b.sup ? 1 : 0); if (b.power || b.sup) S.stopT = 0.07;
          if (S.rallyHits === 0 && scorer >= 0) { ev(S, 'txt', NETX, 250, ZD / 2, '서브 에이스!', 1, 1); addGauge(S.players[scorer], 12); }
          const hot = b.sup === 'hot';
          point(S, 1 - side, scorer); b.vy = -Math.abs(b.vy) * 0.5; b.vx *= 0.6; b.vz *= 0.6; b.home = 0;
          if (hot) explode(S);
          break;
        }
        contacts(S);
      }
      for (const d of S.decoys) {
        ballStep(S, d, DT / 2, false); d.rot += d.vx * DT / 2 / BR;
        let gone = d.y + BR >= GY;
        for (const q of S.players) if (!gone && q.team !== b.supTeam && d3(d.x, d.y, d.z, q.x, q.y - 50 * psc(q), q.z) < 46 * psc(q) + BR) { gone = true; q.st.stun = 1.0 * gutMul(q); hurt(S, q, 6); ev(S, 'txt', q.x, q.y - 150, q.z, '사은품 휴지였다…', 2); }
        if (gone) { ev(S, 'poof', d.x, d.y, d.z, '행사 종료', 0); d.dead = true; }
      }
      if (S.decoys.length) S.decoys = S.decoys.filter(d => !d.dead);
    }
    stepItems(S);
  } else if (S.phase === 'point') {
    if (b.cap) { b.cap = false; if (S.ufo) S.ufo.st = 2; }
    b.vy += ballG(S, b) * DT; b.x += b.vx * DT; b.y += b.vy * DT; b.z = clamp(b.z + b.vz * DT, 6, ZD - 6); b.rot += b.vx * DT / BR;
    if (b.y + BR > GY) { b.y = GY - BR; b.vy = -Math.abs(b.vy) * 0.5; b.vx *= 0.8; b.vz *= 0.8; if (Math.abs(b.vy) < 60) b.vy = 0; }
    if (b.x < BR || b.x > CW - BR) { b.vx *= -0.6; b.x = clamp(b.x, BR, CW - BR); }
    S.decoys = [];
    for (const q of S.peels) q.t -= DT;
    if (S.phaseT > 1.9) { if (S.winner >= 0) { S.phase = 'over'; S.phaseT = 0; ev(S, 'over', NETX, 300, ZD / 2, S.winner); } else startServe(S); }
  }
}

/* ---------- 미리보기(로비의 '필살기 미리보기')용 ---------- */
function drill(S, i) { // i번 선수가 받아 올린 공이 네트 앞에 떠 있는 상태에서 랠리를 시작한다
  const p = S.players[i], b = S.ball, T = p.team; useCourt(S.n);
  S.phase = 'rally'; S.phaseT = 0;
  p.x = netD(T, 330); p.z = ZD / 2; p.hitCd = 0.25;
  b.held = false; b.lastTeam = T; b.lastP = i; b.noP = -1; b.touches = 1; b.serial++; b.teamCd = 0;
  b.x = p.x + fdir(p) * 20; b.y = p.y - 90; b.z = p.z; b.vz = 0;
  lob(S, b, netD(T, 140), ZD / 2, GY - BR, GY - 560);
}
function forceSup(S, i) { const p = S.players[i]; if (p.gauge >= 100 && S.phase === 'rally' && !S.cut && !p.ko) trySuper(S, p); } // 조건을 따지지 않고 지금 필살기를 쓴다

const Core = { spikeAim, drill, forceSup, noTouch, CTRLS, COURTS, useCourt, court: () => ({ CW, NETX, ZD, XS, VW }), W, H, GY, NETH, NETW, BR, NETTOP, DT, K, CHARS, STAGES, ITEMS, DIFFS, HOMES, newGame, step, predict, psc, fdir, busy, jumpH, netD, oppD, sideOf, clamp, rnd, heat };
if (typeof module !== 'undefined') module.exports = Core;
