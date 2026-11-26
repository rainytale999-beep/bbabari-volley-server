/* ===== 방(로비) 규칙·스냅샷 직렬화 — 브라우저와 서버가 같이 쓴다 ===== */
const RC = (typeof module !== 'undefined' && module.exports && typeof Core === 'undefined') ? require('./core.js') : Core;
const ACTS = ['idle', 'bump', 'spike', 'super', 'block', 'dive', 'charge'], STK = ['down', 'stun', 'hop', 'sleep', 'frozen', 'wrap', 'puppet', 'float', 'sad', 'flat', 'giant', 'half', 'boost', 'shrink', 'tub', 'rev'];

function randCh(used) { const all = RC.CHARS.map((c, i) => i), free = all.filter(i => !used.includes(i)), pool = free.length ? free : all; return pool[Math.floor(Math.random() * pool.length)]; }
function mkRoom(n) { return { n, stage: 'random', target: 10, diff: 'normal', ctrl: 'normal', items: true, chal: '', boss: '', owner: '', slots: [] }; }
function layoutRoom(room, humans) { // 사람을 양 팀에 번갈아 앉히고 나머지는 PC
  const n = room.n, slots = new Array(n * 2).fill(null);
  humans.forEach((h, i) => { const team = room.boss ? 0 : i % 2, k = room.boss ? i : i >> 1; /* v1.28 보스전: 사람은 모두 우리 팀 */ if (k < n) slots[team * n + k] = { kind: 'human', id: h.id, name: h.name, ch: h.ch, rnd: !!h.rnd }; if (h.doped) { slots[team * n + k].doped = true; slots[team * n + k].dope = h.dope || 0; } });
  const used = slots.filter(Boolean).map(s => s.ch);
  for (let i = 0; i < slots.length; i++) if (!slots[i]) { const ch = randCh(used); used.push(ch); slots[i] = { kind: 'bot', id: '', name: RC.CHARS[ch].name, ch, auto: true }; }
  room.slots = slots; fixTeams(room);
}
/* 한 팀 안에서는 같은 캐릭터를 쓸 수 없다. PC(auto)는 경기 시작 때 남은 캐릭터 중에서 무작위로 고른다 */
function teamOf(room, i) { return i < room.n ? 0 : 1; }
function fixedCh(room, T, except) { const out = []; room.slots.forEach((s, i) => { if (s && i !== except && teamOf(room, i) === T && ((s.kind === 'human' && !s.rnd) || (s.kind !== 'human' && !s.auto))) out.push(s.ch); }); return out; } // 그 팀에서 이미 정해진 캐릭터(사람 + 방장이 직접 정한 PC)
function fixTeams(room) {
  room.slots.forEach((s, i) => { if (s.kind !== 'human' || s.rnd) return; const T = teamOf(room, i); if (room.slots.some((q, j) => j < i && teamOf(room, j) === T && q.kind === 'human' && !q.rnd && q.ch === s.ch)) s.ch = randCh(fixedCh(room, T, i)); });
  room.slots.forEach(s => { if (s.kind === 'bot') s.auto = true; });
}
/* v0.63 같은 방에서 한 번 쓴 캐릭터는 그 사람이 다시 못 쓴다(room.used: 사람 id → 쓴 캐릭터 번호들). 15종을 다 쓰면 처음부터 다시 */
function usedBy(room, id) { return (room.used && room.used[id]) || []; }
function markUsed(room) { room.used = room.used || {}; const live = {}; for (const s of room.slots) if (s.kind === 'human') { live[s.id] = [s.ch]; } /* v1.32 바로 전 판에 쓴 캐릭터만 못 고른다(그 다음 판엔 다시 가능). 전: 쓴 캐릭터가 계속 쌓였다 */ for (const id in room.used) if (!live[id]) live[id] = room.used[id]; room.used = live; }
function afterGame(room) { for (let i = 0; i < room.slots.length; i++) { const s = room.slots[i]; delete s.doped; delete s.dope; /* 도핑은 한 경기만 */ if (s.kind === 'human' && !s.rnd && usedBy(room, s.id).includes(s.ch)) s.ch = randCh(fixedCh(room, teamOf(room, i), i).concat(usedBy(room, s.id))); } } // 로비로 돌아오면 방금 쓴 캐릭터 대신 안 쓴 캐릭터로 바꿔 둔다
function rollRoles(room) { // v0.98 PC는 팀에 비어 있는 역할을 맡는다(2대2: 스파이커·세터, 3대3: 스파이커·세터·리베로)
  for (const T of [0, 1]) { const idx = room.slots.map((s, i) => i).filter(i => teamOf(room, i) === T), pool = room.n >= 3 ? ['spiker', 'setter', 'libero'] : ['spiker', 'setter'];
    const taken = idx.filter(i => room.slots[i].kind === 'human').map(i => room.slots[i].role || 'all');
    for (const i of idx) { const s = room.slots[i]; if (s.kind !== 'bot') continue; if (room.n < 2) { s.role = 'all'; continue; } const r = pool.find(k => !taken.includes(k)); s.role = r || 'all'; if (r) taken.push(r); } }
}
function rollBots(room) { rollRoles(room); for (const T of [0, 1]) { const used = fixedCh(room, T, -1); room.slots.forEach((s, i) => { if (teamOf(room, i) !== T) return; if (s.kind === 'human' && s.rnd) { const mine = usedBy(room, s.id), ex = used.concat(mine); s.ch = randCh(ex.length >= RC.CHARS.length ? mine : ex); used.push(s.ch); } else if (s.kind === 'bot' && s.auto) { s.ch = randCh(used); s.name = RC.CHARS[s.ch].name; used.push(s.ch); } }); } } // 랜덤을 고른 사람도 시작할 때 정해진다
function humansOf(room) { return room.slots.filter(s => s.kind === 'human'); }
function sideCount(room, T) { let c = 0; for (let i = 0; i < room.n; i++) if (room.slots[T * room.n + i].kind === 'human') c++; return c; }
function joinSlot(room) { // 새로 들어온 사람이 앉을 PC 자리(인원이 적은 팀 우선). 없으면 -1
  if (room.boss) return room.slots.findIndex((s, i) => i < room.n && s.kind === 'bot'); // v1.28 보스전은 우리 팀 자리만
  const bi = room.slots.findIndex((s, i) => s.kind === 'bot' && sideCount(room, i < room.n ? 0 : 1) <= sideCount(room, i < room.n ? 1 : 0));
  return bi >= 0 ? bi : room.slots.findIndex(s => s.kind === 'bot');
}
function roomApply(room, id, op, owner) { // 로비 조작 한 건. 문제가 있으면 안내 문구, 없으면 null
  const si = room.slots.findIndex(s => s.kind === 'human' && s.id === id);
  if (!op || typeof op !== 'object') return 'bad';
  if (op.t === 'ch') {
    const tgt = si; if (tgt < 0) return 'bad'; // 사람만 자기 캐릭터를 고른다. PC(AI)는 항상 시작할 때 무작위
    const sl = room.slots[tgt], T = teamOf(room, tgt);
    if (op.ch === -1) { sl.rnd = true; return null; } // 🎲 랜덤: 경기를 시작할 때 정한다
    const ch = op.ch | 0; if (!(ch >= 0 && ch < RC.CHARS.length) || ch !== op.ch) return 'bad';
    if (room.slots.some((q, j) => j !== tgt && teamOf(room, j) === T && q.kind === 'human' && !q.rnd && q.ch === ch)) return '같은 팀의 다른 사람이 이미 고른 캐릭터예요';
    if (usedBy(room, sl.id).includes(ch)) return '이 방에서 이미 쓴 캐릭터예요. 다른 캐릭터를 골라 주세요';
    sl.ch = ch; sl.rnd = false; return null;
  }
  if (op.t === 'role') { if (si < 0 || !RC.ROLES[op.r]) return 'bad'; room.slots[si].role = op.r; return null; } // v0.95 역할
  if (op.t === 'dope') { // v0.64 도핑: 자기 자리에서 경기 전 한 번만
    if (si < 0) return 'bad'; const sl = room.slots[si]; if (sl.doped) return '도핑은 경기 전에 한 번만 할 수 있어요'; sl.doped = true; sl.dope = RC.rollDope(); return null;
  }
  if (op.t === 'move') {
    if (si < 0 || !Number.isInteger(op.slot) || !room.slots[op.slot] || room.slots[op.slot].kind !== 'bot') return 'bad';
    const T2 = teamOf(room, op.slot), me = room.slots[si]; if (room.boss && T2 !== 0) return 'bad';
    if (T2 !== teamOf(room, si) && room.slots.some((q, j) => j !== op.slot && teamOf(room, j) === T2 && q.kind === 'human' && q.ch === me.ch)) return '그 팀에 같은 캐릭터를 고른 사람이 있어요. 캐릭터를 먼저 바꿔 주세요';
    const tmp = room.slots[op.slot]; room.slots[op.slot] = me; room.slots[si] = tmp; fixTeams(room); return null;
  }
  if (op.t === 'set') {
    if (!owner) return '방장만 바꿀 수 있어요';
    const k = op.k, v = op.v;
    if (k === 'n') { if (room.boss) return '보스전은 3명이 한 팀이에요'; if (![1, 2, 3].includes(v)) return 'bad'; if (v !== 1) room.chal = ''; const hs = humansOf(room); if (hs.length > v * 2) return '지금 인원으로는 그 모드를 할 수 없어요'; room.n = v; layoutRoom(room, hs); return null; }
    if (k === 'stage') { if (v !== 'random' && !RC.STAGES.some(s => s.id === v)) return 'bad'; room.stage = v; return null; }
    if (k === 'diff') { if (!RC.DIFFS[v]) return 'bad'; room.diff = v; return null; }
    if (k === 'ctrl') { if (!RC.CTRLS[v]) return 'bad'; room.ctrl = v; return null; }
    if (k === 'target') { if (![10, 14, 20].includes(v)) return 'bad'; room.target = v; return null; }
    if (k === 'items') { room.items = !!v; return null; }
    if (k === 'shuffle') { // v1.40 랜덤으로 팀 섞기: 사람을 양 팀에 고르게(번갈아) 나누고 자리도 무작위로. 같은 팀에 같은 캐릭터가 겹치지 않는 배치를 고른다
      if (room.boss) return '보스전에서는 팀을 섞을 수 없어요'; const hs = room.slots.filter(q => q.kind === 'human'), bots = room.slots.filter(q => q.kind !== 'human');
      if (hs.length < 2) return '2명 이상 있을 때 섞을 수 있어요';
      const n = room.n, tk = sl => [0, 1].map(T => sl.slice(T * n, T * n + n).filter(q => q.kind === 'human').map(q => q.id).sort().join(',')).join('/'), before = tk(room.slots), mix = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
      let pick = null, fall = null;
      for (let a = 0; a < 40 && !pick; a++) {
        const h = mix(hs.slice()), first = Math.random() < 0.5 ? 0 : 1, slots = new Array(n * 2).fill(null), free = [mix([...Array(n).keys()]), mix([...Array(n).keys()])];
        h.forEach((q, i) => { const T = (first + i) % 2; slots[T * n + free[T].shift()] = q; });
        const bb = mix(bots.slice()); for (let i = 0; i < slots.length; i++) if (!slots[i]) slots[i] = bb.shift();
        const clash = [0, 1].some(T => { const cs = slots.slice(T * n, T * n + n).filter(q => q.kind === 'human' && !q.rnd).map(q => q.ch); return new Set(cs).size !== cs.length; });
        if (!clash) { fall = fall || slots; if (tk(slots) !== before) pick = slots; }
        else if (!fall && a === 39) fall = slots;
      }
      room.slots = pick || fall || room.slots; fixTeams(room); room.shuf = (room.shuf | 0) + 1; return null;
    }
    if (k === 'boss') { if (v !== '' && !(RC.BOSSES && RC.BOSSES[v])) return 'bad'; const hs = humansOf(room); if (v && hs.length > 3) return '보스전은 3명까지 할 수 있어요'; room.boss = v; if (v) { room.chal = ''; room.n = 3; } layoutRoom(room, hs); return null; } // v1.28 보스전
    if (k === 'chal') { if (room.boss && v) return '보스전에서는 도전과제를 할 수 없어요'; if (v !== '' && !RC.CHAL[v]) return 'bad'; if (v && humansOf(room).length > 1) return '도전 모드는 혼자 할 때만 돼요'; room.chal = v; if (v && room.n !== 1) { room.n = 1; layoutRoom(room, humansOf(room)); } return null; } // v0.95
  }
  return 'bad';
}
function pickStage(room) { return room.stage === 'random' ? RC.STAGES[Math.floor(Math.random() * RC.STAGES.length)].id : room.stage; }
function gameCfg(room, stage) { rollBots(room); markUsed(room); return { boss: room.boss || '', chal: room.chal || '', stage, target: room.target, diff: room.diff, /* v1.85 랠리 도전도 고른 난이도의 PC */ ctrl: room.ctrl || 'normal', items: room.items, slots: room.slots.map(s => ({ role: s.role || 'all', ch: s.ch, name: s.name, bot: s.kind === 'bot', dope: s.kind === 'human' && s.doped ? s.dope || 0 : 0, doped: s.kind === 'human' && !!s.doped })) }; }
function metaOf(room, stage) { return { boss: room.boss || '', n: room.n, stage, target: room.target, diff: room.diff, ctrl: room.ctrl || 'normal', names: room.slots.map(s => s.name), chs: room.slots.map(s => s.ch), roles: room.slots.map(s => room.n === 1 ? 'all' : s.role || 'all'), bots: room.slots.map(s => s.kind === 'bot'), dopes: room.slots.map(s => s.kind === 'human' && s.doped ? s.dope || 0 : 0) }; }
function newCode() { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }

/* 경기 상태 → 전송용 스냅샷 */
function pack(S, evs, acks) { // acks(v0.60): 자리마다 [받은 입력 번호, 그 입력으로 돈 횟수] — 화면이 내 캐릭터를 먼저 계산할 때 맞춰 보는 기준
  const r = Math.round, f1 = v => +v.toFixed(1), f2 = v => +v.toFixed(2), b = S.ball, u = S.ufo;
  return { k: S.tick + (S.freezeT > 0 ? 0.5 : 0), sw: S.swap | 0, ph: S.phase, pt: f2(S.phaseT), sc: S.score, sv: S.server, st: S.serveTeam, po: S.pointTeam, wn: S.winner, w: S.wind, ice: [f1(S.ice[0]), f1(S.ice[1])], rh: S.rallyHits,
    cut: S.cut ? [S.cut.p, f2(S.cut.t), S.cut.vs != null ? S.cut.vs : -1, S.cut.res != null ? S.cut.res : -1] : 0,
    b: [r(b.x), r(b.y), r(b.z), r(b.vx), r(b.vy), r(b.vz), f2(b.rot), b.lastTeam, b.touches, (b.power ? 1 : 0) | (b.cap ? 2 : 0) | (b.held ? 4 : 0) | (b.out ? 8 : 0) | (b.ultra ? 16 : 0) | (b.gold ? 32 : 0), b.sup || 0, f1(b.fuse), f1(b.float), f1(b.home), b.noP, f2(b.prs || 0)],
    dc: S.decoys.map(d => [r(d.x), r(d.y), r(d.z), f2(d.rot)]),
    u: u ? [r(u.x), r(u.y), r(u.z), u.st, f2(u.t), u.team, f2(u.dur)] : 0,
    db: S.dbl ? [S.dbl.on, S.dbl.used[0], S.dbl.used[1]] : 0,
    sh: S.shoe ? [r(S.shoe.x), r(S.shoe.y), r(S.shoe.z), f1(S.shoe.rot), S.shoe.by] : 0,
    gs: S.guest ? [S.guest.k, r(S.guest.x), r(S.guest.z), S.guest.dir, S.guest.st] : 0,
    rf: S.ref ? [S.ref.team, S.ref.n, S.ref.st, f1(S.ref.t)] : 0,
    nl: S.netLive ? [S.netLive.team, f1(S.netLive.t), Math.round(S.netLive.dx), S.netLive.mode] : 0, bs: S.basin ? [S.basin.team, f1(S.basin.t)] : 0, eg: +S.env.g.toFixed(2), tf: S.thornF ? [S.thornF.team, ...S.thornF.pts.flat().map(r)] : 0, mm: S.mom ? [r(S.mom.x), r(S.mom.z), S.mom.st, f2(S.mom.t), S.mom.team] : 0,
    sm: S.steams.map(q => [r(q.x), r(q.z), f1(q.t), r(q.r)]), pg: S.pig ? [r(S.pig.x), r(S.pig.y), r(S.pig.z), S.pig.st, S.pig.dir] : 0, pz: S.pots.map(q => [r(q.x), r(q.z), f2(q.t)]), /* v0.63 전에는 이름이 pt 라서 위의 pt(단계 시간)를 덮어썼다 → 온라인에서 단계 시간이 깨져 있었음 */
    p: S.players.map(p => [r(p.x), r(p.y), r(p.z), r(p.vx), r(p.vy), r(p.vz), p.gnd ? 1 : 0, ACTS.indexOf(p.act), f2(p.actT), f2(p.chg), r(p.hp), r(p.gauge), (p.ko ? 1 : 0) | (p.big > 0 ? 2 : 0) | (p.mini > 0 ? 4 : 0) | (p.fast > 0 ? 8 : 0) | (p.soot > 0 ? 16 : 0) | (p.toss ? 32 : 0) | (p.aimOn ? 64 | ((p.aimX + 1) << 7) | ((p.aimZ + 1) << 9) : 0) | (p.supBan ? 2048 : 0) | (p.tis > 0 ? 4096 : 0) | (Math.min(7, p.supN | 0) << 13) | (Math.min(7, p.supCap || 7) << 16) | ((p.item ? RC.ITEMS.findIndex(i => i.id === p.item) + 1 : 0) << 19) | (p.ck > 1 ? 1 << 22 : 0), r(p.diveX * 9), ...STK.map(k => f1(p.st[k]))]),
    ak: [S.slowT > 0 ? 1 : 0, ...S.players.map((p, i) => p.bot ? 0 : [acks && acks[i] ? acks[i][0] : 0, acks && acks[i] ? acks[i][1] : 255, r((p.ck || 1) * 100), r((p.mom || 0) * 100), f1(p.st.moon || 0), f1(p.st.wet2 || 0), ...(p.act === 'dive' ? [r((p.diveX || 0) * 100), r((p.diveZ || 0) * 100), r(Math.max(0, (p.diveLen || 0) - Math.hypot(p.x - (p.diveX0 || 0), p.z - (p.diveZ0 || 0))))] : [])])],
    it: S.items.map(i => [i.id, i.type, r(i.x), r(i.y), r(i.z), f1(i.t)]), pl: S.peels.map(q => [r(q.x), r(q.z)]), bo: S.boss ? packBoss(S, r, f1, f2) : 0, ev: evs };
}

const BOSS_STS = ['idle', 'move', 'toss', 'wind', 'spike', 'block', 'charge', 'flinch', 'groggy', 'cast', 'summon', 'tf', 'roar', 'shield', 'sweep', 'taunt', 'dead'], BOSS_EVS = ['tf', 'seize', 'orb', 'rage', 'doom'];
function packBoss(S, r, f1, f2) { // v1.28 보스 상태 → 숫자 배열
  const B = S.boss, fl = (B.imm ? 1 : 0) | (B.exh ? 2 : 0) | (B.dead ? 4 : 0) | (B.hold && B.hold.cw ? 8 : 0);
  return [r(B.hp), B.hpMax, B.hearts, B.heartsMax, B.ph, BOSS_STS.indexOf(B.st), f1(B.stT), r(B.x), r(B.z), f1(B.clock), B.limit, f1(B.groggy), fl,
    B.charge ? [f1(B.charge.t), B.charge.need, B.charge.got] : 0, B.shield ? [B.shield.col, B.shield.hp] : 0, B.orbs ? [f1(B.orbT), ...B.orbs.flatMap(o => [r(o.x), r(o.y), r(o.z), o.dead ? 1 : 0])] : 0,
    f1(B.cage), f1(B.dark), B.sweep ? [r(B.sweep.x), f2(B.sweep.warn)] : 0, B.hold ? [f2(B.hold.t0), f2(B.hold.t)] : 0, B.ev ? [BOSS_EVS.indexOf(B.ev.k), f2(B.ev.t), B.ev.dur] : 0,
    B.marks.flatMap(m => [r(m.x), r(m.z)]), B.fakes.flatMap(q => [r(q.x), r(q.y), r(q.z)]), B.rats.flatMap(q => [r(q.x), r(q.z), (q.k ? 1 : 0) | (q.dead ? 2 : 0) | (q.vx > 0 ? 4 : 0)]), f1(B.ratT), B.rage ? Math.max(0.1, f1(B.rage.t)) : 0, /* v1.37 끝나기 직전 0으로 반올림돼 발악이 꺼져 보이던 것 */ S.players.map(p => p.bcol | 0), B.id, (B.mets || []).flatMap(m => [r(m.x), r(m.z), f2(m.t)])];
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

const RoomLib = { BOSS_STS, BOSS_EVS, packBoss, usedBy, markUsed, afterGame, enc, dec, teamOf, fixedCh, fixTeams, rollBots, ACTS, STK, randCh, mkRoom, layoutRoom, humansOf, sideCount, joinSlot, roomApply, pickStage, gameCfg, metaOf, newCode, pack };
if (typeof module !== 'undefined' && module.exports && RC !== (typeof Core === 'undefined' ? null : Core)) module.exports = RoomLib;
