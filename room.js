/* ===== 방(로비) 규칙·스냅샷 직렬화 — 브라우저와 서버가 같이 쓴다 ===== */
const RC = (typeof module !== 'undefined' && module.exports && typeof Core === 'undefined') ? require('./core.js') : Core;
const ACTS = ['idle', 'bump', 'spike', 'super', 'block', 'dive', 'charge'], STK = ['down', 'stun', 'hop', 'sleep', 'frozen', 'wrap', 'puppet', 'float', 'sad', 'flat'];

function randCh(used) { const all = RC.CHARS.map((c, i) => i), free = all.filter(i => !used.includes(i)), pool = free.length ? free : all; return pool[Math.floor(Math.random() * pool.length)]; }
function mkRoom(n) { return { n, stage: 'random', target: 7, diff: 'normal', ctrl: 'normal', items: true, owner: '', slots: [] }; }
function layoutRoom(room, humans) { // 사람을 양 팀에 번갈아 앉히고 나머지는 PC
  const n = room.n, slots = new Array(n * 2).fill(null);
  humans.forEach((h, i) => { const team = i % 2, k = i >> 1; if (k < n) slots[team * n + k] = { kind: 'human', id: h.id, name: h.name, ch: h.ch }; });
  const used = slots.filter(Boolean).map(s => s.ch);
  for (let i = 0; i < slots.length; i++) if (!slots[i]) { const ch = randCh(used); used.push(ch); slots[i] = { kind: 'bot', id: '', name: RC.CHARS[ch].name, ch, auto: true }; }
  room.slots = slots; fixTeams(room);
}
/* 한 팀 안에서는 같은 캐릭터를 쓸 수 없다. PC(auto)는 경기 시작 때 남은 캐릭터 중에서 무작위로 고른다 */
function teamOf(room, i) { return i < room.n ? 0 : 1; }
function fixedCh(room, T, except) { const out = []; room.slots.forEach((s, i) => { if (s && i !== except && teamOf(room, i) === T && (s.kind === 'human' || !s.auto)) out.push(s.ch); }); return out; } // 그 팀에서 이미 정해진 캐릭터(사람 + 방장이 직접 정한 PC)
function fixTeams(room) {
  room.slots.forEach((s, i) => { if (s.kind !== 'human') return; const T = teamOf(room, i); if (room.slots.some((q, j) => j < i && teamOf(room, j) === T && q.kind === 'human' && q.ch === s.ch)) s.ch = randCh(fixedCh(room, T, i)); });
  room.slots.forEach(s => { if (s.kind === 'bot') s.auto = true; });
}
function rollBots(room) { for (const T of [0, 1]) { const used = fixedCh(room, T, -1); room.slots.forEach((s, i) => { if (s.kind === 'bot' && s.auto && teamOf(room, i) === T) { s.ch = randCh(used); s.name = RC.CHARS[s.ch].name; used.push(s.ch); } }); } }
function humansOf(room) { return room.slots.filter(s => s.kind === 'human'); }
function sideCount(room, T) { let c = 0; for (let i = 0; i < room.n; i++) if (room.slots[T * room.n + i].kind === 'human') c++; return c; }
function joinSlot(room) { // 새로 들어온 사람이 앉을 PC 자리(인원이 적은 팀 우선). 없으면 -1
  const bi = room.slots.findIndex((s, i) => s.kind === 'bot' && sideCount(room, i < room.n ? 0 : 1) <= sideCount(room, i < room.n ? 1 : 0));
  return bi >= 0 ? bi : room.slots.findIndex(s => s.kind === 'bot');
}
function roomApply(room, id, op, owner) { // 로비 조작 한 건. 문제가 있으면 안내 문구, 없으면 null
  const si = room.slots.findIndex(s => s.kind === 'human' && s.id === id);
  if (!op || typeof op !== 'object') return 'bad';
  if (op.t === 'ch') {
    const tgt = si; if (tgt < 0) return 'bad'; // 사람만 자기 캐릭터를 고른다. PC(AI)는 항상 시작할 때 무작위
    const sl = room.slots[tgt], T = teamOf(room, tgt);
    const ch = op.ch | 0; if (!(ch >= 0 && ch < RC.CHARS.length) || ch !== op.ch) return 'bad';
    if (room.slots.some((q, j) => j !== tgt && teamOf(room, j) === T && q.kind === 'human' && q.ch === ch)) return '같은 팀의 다른 사람이 이미 고른 캐릭터예요';
    sl.ch = ch; return null;
  }
  if (op.t === 'move') {
    if (si < 0 || !Number.isInteger(op.slot) || !room.slots[op.slot] || room.slots[op.slot].kind !== 'bot') return 'bad';
    const T2 = teamOf(room, op.slot), me = room.slots[si];
    if (T2 !== teamOf(room, si) && room.slots.some((q, j) => j !== op.slot && teamOf(room, j) === T2 && q.kind === 'human' && q.ch === me.ch)) return '그 팀에 같은 캐릭터를 고른 사람이 있어요. 캐릭터를 먼저 바꿔 주세요';
    const tmp = room.slots[op.slot]; room.slots[op.slot] = me; room.slots[si] = tmp; fixTeams(room); return null;
  }
  if (op.t === 'set') {
    if (!owner) return '방장만 바꿀 수 있어요';
    const k = op.k, v = op.v;
    if (k === 'n') { if (![1, 2, 3].includes(v)) return 'bad'; const hs = humansOf(room); if (hs.length > v * 2) return '지금 인원으로는 그 모드를 할 수 없어요'; room.n = v; layoutRoom(room, hs); return null; }
    if (k === 'stage') { if (v !== 'random' && !RC.STAGES.some(s => s.id === v)) return 'bad'; room.stage = v; return null; }
    if (k === 'diff') { if (!RC.DIFFS[v]) return 'bad'; room.diff = v; return null; }
    if (k === 'ctrl') { if (!RC.CTRLS[v]) return 'bad'; room.ctrl = v; return null; }
    if (k === 'target') { if (![5, 7, 11, 15].includes(v)) return 'bad'; room.target = v; return null; }
    if (k === 'items') { room.items = !!v; return null; }
  }
  return 'bad';
}
function pickStage(room) { return room.stage === 'random' ? RC.STAGES[Math.floor(Math.random() * RC.STAGES.length)].id : room.stage; }
function gameCfg(room, stage) { rollBots(room); return { stage, target: room.target, diff: room.diff, ctrl: room.ctrl || 'normal', items: room.items, slots: room.slots.map(s => ({ ch: s.ch, name: s.name, bot: s.kind === 'bot' })) }; }
function metaOf(room, stage) { return { n: room.n, stage, target: room.target, diff: room.diff, ctrl: room.ctrl || 'normal', names: room.slots.map(s => s.name), chs: room.slots.map(s => s.ch), bots: room.slots.map(s => s.kind === 'bot') }; }
function newCode() { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }

/* 경기 상태 → 전송용 스냅샷 */
function pack(S, evs) {
  const r = Math.round, f1 = v => +v.toFixed(1), f2 = v => +v.toFixed(2), b = S.ball, u = S.ufo;
  return { k: S.tick + (S.freezeT > 0 ? 0.5 : 0), ph: S.phase, pt: f2(S.phaseT), sc: S.score, sv: S.server, st: S.serveTeam, po: S.pointTeam, wn: S.winner, w: S.wind, ice: [f1(S.ice[0]), f1(S.ice[1])], rh: S.rallyHits,
    cut: S.cut ? [S.cut.p, f2(S.cut.t)] : 0,
    b: [r(b.x), r(b.y), r(b.z), r(b.vx), r(b.vy), r(b.vz), f2(b.rot), b.lastTeam, b.touches, (b.power ? 1 : 0) | (b.cap ? 2 : 0) | (b.held ? 4 : 0) | (b.out ? 8 : 0), b.sup || 0, f1(b.fuse), f1(b.float), f1(b.home), b.noP],
    dc: S.decoys.map(d => [r(d.x), r(d.y), r(d.z), f2(d.rot)]),
    u: u ? [r(u.x), r(u.y), r(u.z), u.st, f2(u.t), u.team, f2(u.dur)] : 0,
    p: S.players.map(p => [r(p.x), r(p.y), r(p.z), r(p.vx), r(p.vy), r(p.vz), p.gnd ? 1 : 0, ACTS.indexOf(p.act), f2(p.actT), f2(p.chg), r(p.hp), r(p.gauge), (p.ko ? 1 : 0) | (p.big > 0 ? 2 : 0) | (p.mini > 0 ? 4 : 0) | (p.fast > 0 ? 8 : 0) | (p.soot > 0 ? 16 : 0), r(p.diveX * 9), ...STK.map(k => f1(p.st[k]))]),
    it: S.items.map(i => [i.id, i.type, r(i.x), r(i.y), r(i.z), f1(i.t)]), pl: S.peels.map(q => [r(q.x), r(q.z)]), ev: evs };
}

/* 작은 이진 묶음: 숫자를 글자로 적지 않고 1~3바이트로 담는다(작은 정수 1바이트, 그 밖의 정수·소수 한두 자리 3바이트).
   내용물 구조를 몰라도 되는 범용 방식이라 pack 이 바뀌어도 그대로 쓴다. */
const TE = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null, TD = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
let ENC_BUF = new Uint8Array(4096), ENC_DV = new DataView(ENC_BUF.buffer);
function enc(v) {
  let buf = ENC_BUF, dv = ENC_DV, n = 0;
  const need = k => { if (n + k > buf.length) { const b2 = new Uint8Array(Math.max(buf.length * 2, n + k)); b2.set(buf); buf = ENC_BUF = b2; dv = ENC_DV = new DataView(buf.buffer); } };
  const i16 = (tag, x) => { need(3); buf[n++] = tag; dv.setInt16(n, x, true); n += 2; };
  const w = x => {
    if (typeof x === 'number') {
      if (Number.isInteger(x)) { if (x >= 0 && x < 128) { need(1); buf[n++] = x; } else if (x < 0 && x >= -32) { need(1); buf[n++] = 0x80 + (-x - 1); } else if (x >= -32768 && x < 32768) i16(0xA0, x); else { need(9); buf[n++] = 0xA4; dv.setFloat64(n, x, true); n += 8; } }
      else { const a = Math.round(x * 10), b = Math.round(x * 100); if (Math.abs(x * 10 - a) < 1e-6 && a >= -32768 && a < 32768) i16(0xA2, a); else if (Math.abs(x * 100 - b) < 1e-6 && b >= -32768 && b < 32768) i16(0xA3, b); else if (x === x && Math.abs(x) < 1e30) { need(9); buf[n++] = 0xA4; dv.setFloat64(n, x, true); n += 8; } else { need(1); buf[n++] = 0xA5; } }
    } else if (x === null || x === undefined) { need(1); buf[n++] = 0xA5; }
    else if (x === true || x === false) { need(1); buf[n++] = x ? 0xA6 : 0xA7; }
    else if (typeof x === 'string') { const s = TE.encode(x); need(3 + s.length); buf[n++] = 0xB0; dv.setUint16(n, s.length, true); n += 2; buf.set(s, n); n += s.length; }
    else if (Array.isArray(x)) { if (x.length < 32) { need(1); buf[n++] = 0xC0 + x.length; } else { need(3); buf[n++] = 0xE0; dv.setUint16(n, x.length, true); n += 2; } for (const q of x) w(q); }
    else { const ks = Object.keys(x); need(2); buf[n++] = 0xE1; buf[n++] = ks.length; for (const k of ks) { const s = TE.encode(k); need(1 + s.length); buf[n++] = s.length; buf.set(s, n); n += s.length; w(x[k]); } }
  };
  w(v); return buf.slice(0, n); // 재사용 버퍼에서 필요한 만큼만 복사해 돌려준다
}
function dec(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); let n = 0;
  const r = () => { const t = buf[n++];
    if (t < 0x80) return t; if (t < 0xA0) return -(t - 0x80) - 1;
    if (t === 0xA0) { const v = dv.getInt16(n, true); n += 2; return v; }
    if (t === 0xA2) { const v = dv.getInt16(n, true) / 10; n += 2; return v; }
    if (t === 0xA3) { const v = dv.getInt16(n, true) / 100; n += 2; return v; }
    if (t === 0xA4) { const v = dv.getFloat64(n, true); n += 8; return v; }
    if (t === 0xA5) return null; if (t === 0xA6) return true; if (t === 0xA7) return false;
    if (t === 0xB0) { const l = dv.getUint16(n, true); n += 2; const s = TD.decode(buf.subarray(n, n + l)); n += l; return s; }
    if (t >= 0xC0 && t < 0xE0) { const a = new Array(t - 0xC0); for (let i = 0; i < a.length; i++) a[i] = r(); return a; }
    if (t === 0xE0) { const l = dv.getUint16(n, true); n += 2; const a = new Array(l); for (let i = 0; i < l; i++) a[i] = r(); return a; }
    if (t === 0xE1) { const c = buf[n++], o = {}; for (let i = 0; i < c; i++) { const l = buf[n++], k = TD.decode(buf.subarray(n, n + l)); n += l; o[k] = r(); } return o; }
    throw new Error('dec');
  };
  return r();
}

const RoomLib = { enc, dec, teamOf, fixedCh, fixTeams, rollBots, ACTS, STK, randCh, mkRoom, layoutRoom, humansOf, sideCount, joinSlot, roomApply, pickStage, gameCfg, metaOf, newCode, pack };
if (typeof module !== 'undefined' && module.exports && RC !== (typeof Core === 'undefined' ? null : Core)) module.exports = RoomLib;
