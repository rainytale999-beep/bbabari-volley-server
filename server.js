'use strict';
/* ===== 빱알이 배구 — 게임 서버 =====
   하는 일: (1) index.html·assets 제공  (2) 방 관리  (3) 경기 계산(초당 60번)  (4) 접속자에게 화면 상태 전송
   실행: npm install  →  npm start   (기본 포트 8080, 환경변수 PORT 로 변경) */
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const Core = require('./core.js'), R = require('./room.js');

const SERVER_VER = '1.04'; // 첫 화면 글자에 표시(배포가 반영됐는지 확인용)
const PORT = +process.env.PORT || 8080, ROOT = path.join(__dirname, '..');
const MAX_ROOMS = 40, MAX_SPECS = 10, DT = Core.DT;
const MIME = { '.woff2': 'font/woff2', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.txt': 'text/plain; charset=utf-8' };

const server = http.createServer((req, res) => {
  let u = '/';
  try { u = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { }
  if (u === '/') u = '/index.html';
  if (u === '/rooms') { // 열린 방 목록(방 찾기)
    const list = [];
    for (const room of rooms.values()) { const cfg = room.cfg, own = cfg.slots.find(s => s.kind === 'human' && s.id === cfg.owner), humans = cfg.slots.filter(s => s.kind === 'human').length; list.push({ code: room.code, lock: !!room.pw, title: cfg.title || '', host: own ? own.name : '?', n: cfg.n, humans, max: cfg.n * 2, specs: (cfg.specs || []).length, state: room.S ? (room.over ? 'result' : 'game') : 'lobby' }); }
    list.sort((a, b) => (a.state === 'lobby' ? 0 : 1) - (b.state === 'lobby' ? 0 : 1));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); return res.end(JSON.stringify(list.slice(0, 40)));
  }
  if (u === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end('ok rooms=' + rooms.size + ' (경기 중 ' + [...rooms.values()].filter(r => r.S && !r.over).length + ') | 최근 10초: CPU ' + cpuPct.toFixed(1) + '%, 40ms 넘게 밀린 횟수 ' + stallShown + ' | 최근 2초 최대 밀림 ' + Math.round(gapMax) + 'ms | 서버 v' + SERVER_VER); } // 진단용
  const hello = () => { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('빱알이 배구 게임 서버 v' + SERVER_VER + ' 실행 중 (방 ' + rooms.size + '개)'); };
  if (ROOT === path.sep || /^[A-Za-z]:\\$/.test(ROOT)) { if (u === '/index.html') return hello(); res.writeHead(404); return res.end('not found'); } // 서버만 따로 올린 경우(폴더 맨 위): 파일은 제공하지 않는다
  const file = path.normalize(path.join(ROOT, u));
  if ((u !== '/index.html' && !u.startsWith('/assets/') && !u.startsWith('/fonts/')) || !file.startsWith(ROOT + path.sep)) { res.writeHead(404); return res.end('not found'); }
  fs.readFile(file, (err, buf) => {
    if (err) { if (u === '/index.html') return hello(); res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': u === '/index.html' || u === '/assets/manifest.js' ? 'no-cache' : 'public, max-age=2592000' }); // 그림·소리는 30일 저장(주소 뒤 ?v= 가 바뀌면 새로 받는다)
    res.end(buf);
  });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });
const rooms = new Map();
let nextId = 1;
const now = () => Number(process.hrtime.bigint() / 1000000n);
function send(ws, m) { if (ws.readyState === 1) ws.send(JSON.stringify(m)); }
function bc(room, m) { const s = JSON.stringify(m); for (const ws of room.clients.values()) if (ws.readyState === 1) ws.send(s); }
function pub(room) { return { t: 'room', room: room.cfg, state: room.S ? (room.over ? 'result' : 'game') : 'lobby' }; }
function slotOf(room, id) { return room.cfg.slots.findIndex(s => s.kind === 'human' && s.id === id); }
function cleanTitle(v) { return String(v == null ? '' : v).replace(/[<>&"'\u0000-\u001f]/g, '').trim().slice(0, 20) || '빱찌의 지구침공!!'; }
function cleanName(v) { return String(v == null ? '' : v).replace(/[<>&"'\u0000-\u001f]/g, '').trim().slice(0, 10) || '손님'; }

function startMatch(room) {
  const stage = R.pickStage(room.cfg);
  room.S = Core.newGame(R.gameCfg(room.cfg, stage)); room.meta = R.metaOf(room.cfg, stage);
  room.acc = 0; room.stepN = 0; room.evOut = []; room.over = false; room.swapUsed = new Set(); // v0.97 경기 중 PC와 교체는 사람마다 경기당 1번
  for (const ws of room.clients.values()) { ws.inp = 0; ws.latch = 0; send(ws, { t: 'start', meta: room.meta, you: slotOf(room, ws.id) }); }
  bc(room, pub(room));
}
function toLobby(room) { room.S = null; room.over = false; R.afterGame(room.cfg); bc(room, { t: 'lobby' }); bc(room, pub(room)); }

function onHello(ws, m) {
  if (ws.room) return;
  const name = cleanName(m.name);
  let room;
  if (m.create) {
    if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'err', m: '서버에 방이 가득 찼어요. 잠시 뒤에 다시 시도해 주세요.' });
    let code; do { code = R.newCode(); } while (rooms.has(code));
    room = { code, cfg: R.mkRoom(3), clients: new Map(), S: null, meta: null, acc: 0, stepN: 0, evOut: [], over: false, overAt: 0 };
    room.cfg.title = cleanTitle(m.title); room.pw = String(m.pw == null ? '' : m.pw).slice(0, 12); room.cfg.lock = !!room.pw; // 비밀번호는 서버만 갖고 있고, 방 정보에는 잠김 여부만 싣는다
    room.cfg.owner = ws.id; R.layoutRoom(room.cfg, [{ id: ws.id, name, ch: R.randCh([]) }]);
    rooms.set(code, room);
  } else {
    room = rooms.get(String(m.code || '').trim().toUpperCase());
    if (!room) return send(ws, { t: 'err', m: '그런 방이 없어요. 코드를 다시 확인해 주세요.' });
    if (room.pw && String(m.pw == null ? '' : m.pw) !== room.pw) return send(ws, { t: 'needpw', code: room.code, bad: m.pw != null && m.pw !== '' });
    const specs = room.cfg.specs || (room.cfg.specs = []);
    const idx = room.S || m.spec ? -1 : R.joinSlot(room.cfg); // v0.97 경기 중인 방·빈자리 없는 방은 관전으로 들어온다
    if (idx < 0) { if (specs.length >= MAX_SPECS) return send(ws, { t: 'full' }); specs.push({ id: ws.id, name }); bc(room, { t: 'toast', m: name + ' 님이 관전하러 왔어요' }); }
    else { room.cfg.slots[idx] = { kind: 'human', id: ws.id, name, ch: R.randCh(R.fixedCh(room.cfg, R.teamOf(room.cfg, idx), idx)) }; bc(room, { t: 'toast', m: name + ' 님이 들어왔어요' }); }
  }
  ws.room = room; ws.name = name; room.clients.set(ws.id, ws);
  ws.bin = m.bin === 2 ? 2 : m.bin === 1 ? 1 : 0; // 0 글자, 1 이진 묶음, 2 이진 묶음 + 항목 이름 생략
  ws.hz = m.hz === 60 ? 60 : 30; // 화면 상태를 받는 빈도. 새 화면은 초당 60번, 예전 화면은 30번
  send(ws, { t: 'you', id: ws.id, code: room.code, hz: ws.hz, pk: ws.bin === 2 ? PK : undefined });
  bc(room, pub(room));
  if (room.S) { send(ws, { t: 'start', meta: room.meta, you: slotOf(room, ws.id) }); if (room.over) send(ws, { t: 'result', stats: room.S.players.map(p => p.stats) }); }
}
function onLeave(ws) {
  const room = ws.room; if (!room) return; ws.room = null;
  room.clients.delete(ws.id);
  if (room.cfg.specs) room.cfg.specs = room.cfg.specs.filter(s => s.id !== ws.id);
  const i = slotOf(room, ws.id);
  if (i >= 0) {
    const s = room.cfg.slots[i]; room.cfg.slots[i] = { kind: 'bot', id: '', name: Core.CHARS[s.ch].name, ch: s.ch, auto: true };
    if (room.S) { const p = room.S.players[i]; p.bot = true; p.name = Core.CHARS[s.ch].name; room.meta = R.metaOf(room.cfg, room.S.stage); bc(room, { t: 'meta', meta: room.meta }); }
  }
  if (!room.clients.size) { rooms.delete(room.code); return; }
  bc(room, { t: 'toast', m: ws.name + ' 님이 나갔어요 (PC가 대신합니다)' });
  if (room.cfg.owner === ws.id) { const nx = room.clients.values().next().value; room.cfg.owner = nx.id; bc(room, { t: 'toast', m: nx.name + ' 님이 방장이 됐어요' }); }
  bc(room, pub(room));
}
function onMsg(ws, m) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'hello') return onHello(ws, m);
  const room = ws.room; if (!room) return;
  const owner = room.cfg.owner === ws.id;
  if (m.t === 'ping') { send(ws, { t: 'pong', c: +m.c || 0, g: Math.round(gapMax) }); return; } // g: 최근 2초 동안 서버 계산이 가장 길게 밀린 시간(ms)
  if (m.t === 'in') { ws.inp = (m.k | 0) & 255; ws.latch |= ws.inp; if (m.q != null) { ws.seq = (m.q | 0) & 255; ws.seqN = 0; } if (m.l != null) ws.lag = Math.max(0, Math.min(12, m.l | 0)); } // l(v0.61): 그 사람 화면의 공이 몇 틱 전 것인지 // q(v0.60): 입력 번호
  else if (m.t === 'ch' || m.t === 'move' || m.t === 'set' || m.t === 'dope' || m.t === 'role') {
    if (room.S) return;
    const err = R.roomApply(room.cfg, ws.id, m, owner);
    if (err) { if (err !== 'bad') send(ws, { t: 'toast', m: err }); return; }
    bc(room, pub(room));
  }
  else if (m.t === 'spec') { // v0.97 로비에서 선수 → 관전
    if (room.S) return; const i = slotOf(room, ws.id); if (i < 0) return; const specs = room.cfg.specs || (room.cfg.specs = []); if (specs.length >= MAX_SPECS) return send(ws, { t: 'toast', m: '관전 자리가 가득 찼어요' });
    const s = room.cfg.slots[i]; room.cfg.slots[i] = { kind: 'bot', id: '', name: Core.CHARS[s.ch].name, ch: s.ch, auto: true }; specs.push({ id: ws.id, name: ws.name }); bc(room, pub(room));
  }
  else if (m.t === 'play') { // v0.97 관전 → 선수(로비에서는 언제든, 경기 중에는 PC 자리와 교체 1번)
    if (slotOf(room, ws.id) >= 0) return; const specs = room.cfg.specs || []; if (!specs.some(s => s.id === ws.id)) return;
    const cfg = room.cfg, team = m.team === 0 || m.team === 1 ? m.team : -1, pick = () => { if (team >= 0) { for (let i = team * cfg.n; i < (team + 1) * cfg.n; i++) if (cfg.slots[i].kind === 'bot') return i; return -1; } return R.joinSlot(cfg); };
    if (room.S && room.over) return;
    if (room.S && room.swapUsed && room.swapUsed.has(ws.id)) return send(ws, { t: 'toast', m: '경기 중 참여는 한 번만 할 수 있어요' });
    const idx = pick(); if (idx < 0) return send(ws, { t: 'toast', m: team >= 0 ? '그 팀에는 PC 자리가 없어요' : '빈자리가 없어요' });
    cfg.specs = specs.filter(s => s.id !== ws.id);
    if (room.S) { room.swapUsed.add(ws.id); const p = room.S.players[idx]; cfg.slots[idx] = { kind: 'human', id: ws.id, name: ws.name, ch: p.ch }; p.bot = false; p.name = ws.name; p.inp = 0; room.meta = R.metaOf(cfg, room.S.stage); bc(room, { t: 'meta', meta: room.meta }); send(ws, { t: 'seat', you: idx }); bc(room, { t: 'toast', m: ws.name + ' 님이 PC 대신 들어왔어요' }); }
    else cfg.slots[idx] = { kind: 'human', id: ws.id, name: ws.name, ch: R.randCh(R.fixedCh(cfg, R.teamOf(cfg, idx), idx)) };
    bc(room, pub(room));
  }
  else if (m.t === 'dbl') { const i = slotOf(room, ws.id); if (i >= 0 && room.S) Core.askDouble(room.S, i); } // v0.95 묻고 떠블로 가
  else if (m.t === 'emo') { const t = now(); if (t - (ws.emoAt || 0) < 500) return; ws.emoAt = t; const k = m.k | 0; if (k < 0 || k > 7) return; const i = slotOf(room, ws.id); if (i >= 0) bc(room, { t: 'emo', i, k }); }
  else if (m.t === 'chat') { const t = now(); if (t - (ws.chatAt || 0) < 700) return; ws.chatAt = t; const s = String(m.s == null ? '' : m.s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 40); if (!s) return; bc(room, { t: 'chat', i: slotOf(room, ws.id), name: ws.name, s }); }
  else if (m.t === 'start') { if (owner && !room.S) startMatch(room); }
  else if (m.t === 'lobby') { if (owner && room.S && room.over) toLobby(room); }
}

wss.on('connection', ws => {
  ws.id = 'p' + (nextId++) + Math.random().toString(36).slice(2, 6); ws.room = null; ws.inp = 0; ws.latch = 0; ws.last = now(); ws.cnt = 0;
  ws.on('message', (raw, isBin) => {
    ws.last = now(); if (isBin || ++ws.cnt > 200) return ws.terminate(); // 초당 200건 넘으면 끊는다
    let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    try { onMsg(ws, m); } catch (e) { console.error('msg error', e); }
  });
  ws.on('close', () => onLeave(ws));
  ws.on('error', () => { });
});

const PK = Object.keys(R.pack(Core.newGame({ stage: 'beach', target: 7, diff: 'normal', items: true, slots: [{ ch: 0, name: 'a', bot: true }, { ch: 1, name: 'b', bot: true }] }), [])); // 화면 상태의 항목 이름(순서 고정)
/* 경기 계산 루프: 방마다 초당 60스텝. 상태 전송은 접속자마다 초당 60번 또는 30번 */
let last = now(), gapMax = 0, gapCur = 0, gapAt = last, planned = 0, stallN = 0, stallShown = 0, cpuLast = process.cpuUsage(), cpuAt = last, cpuPct = 0;
function tick() {
  const t = now(), gap = t - last, dt = Math.min(0.1, gap / 1000), lateBy = gap - planned; last = t; // lateBy: 깨어나기로 한 시각보다 늦은 정도 = 서버가 밀린 시간
  if (lateBy > gapCur) gapCur = lateBy; if (lateBy > 40) stallN++;
  if (t - gapAt > 2000) { gapMax = gapCur; gapCur = 0; gapAt = t; }
  if (t - cpuAt > 10000) { const u = process.cpuUsage(cpuLast); cpuPct = (u.user + u.system) / 1000 / (t - cpuAt) * 100; cpuLast = process.cpuUsage(); cpuAt = t; stallShown = stallN; stallN = 0; }
  for (const room of rooms.values()) {
    const S = room.S; if (!S) continue;
    room.acc += dt; let guard = 0;
    while (room.acc >= DT && guard++ < 6) {
      room.acc -= DT;
      for (const ws of room.clients.values()) { const i = slotOf(room, ws.id); if (i >= 0 && S.players[i] && !S.players[i].bot) { S.players[i].inp = ws.inp | ws.latch; S.players[i].lagT = ws.lag | 0; } ws.latch = 0; }
      try { Core.step(S); } catch (e) { console.error('step error', e); toLobby(room); break; }
      const acks = []; for (const ws of room.clients.values()) { const i = slotOf(room, ws.id); if (ws.seq != null) { ws.seqN = Math.min(255, (ws.seqN | 0) + 1); if (i >= 0) acks[i] = [ws.seq, ws.seqN]; } } // v0.60 이 입력으로 몇 번 돌았는지 알려 준다
      const evs = S.ev.slice(); for (const e of evs) room.evOut.push(e); S.ev.length = 0;
      const even = (++room.stepN & 1) === 0, out = {}; let pf = null, ps = null; // 같은 내용은 한 번만 만들어 여러 명에게 보낸다
      for (const ws of room.clients.values()) { if (ws.readyState !== 1) continue; const fastC = ws.hz === 60; if (!fastC && !even) continue;
        const key = (fastC ? 'f' : 's') + ws.bin;
        if (!out[key]) { const p = fastC ? (pf || (pf = R.pack(S, evs, acks))) : (ps || (ps = R.pack(S, room.evOut, acks))); out[key] = ws.bin === 2 ? R.enc(PK.map(k => p[k])) : ws.bin ? R.enc(p) : JSON.stringify({ t: 's', s: p }); }
        ws.send(out[key]); }
      if (even) room.evOut = [];
      if (S.phase === 'over' && S.phaseT > 1.6 && !room.over) { room.over = true; room.overAt = t; bc(room, { t: 'result', stats: S.players.map(p => p.stats) }); bc(room, pub(room)); }
    }
    if (room.acc > DT * 6) room.acc = 0;
    if (room.S && room.over && t - room.overAt > 90000) toLobby(room); // 결과 화면에서 1분 30초 지나면 자동으로 로비
  }
  let wait = 50; for (const room of rooms.values()) if (room.S) { const w = (DT - room.acc) * 1000; if (w < wait) wait = w; }
  planned = Math.max(1, Math.ceil(wait)); setTimeout(tick, planned);
}
tick();
setInterval(() => { const t = now(); for (const ws of wss.clients) { ws.cnt = 0; if (t - ws.last > 15000) ws.terminate(); } }, 1000);

server.listen(PORT, () => console.log('빱알이 배구 서버 실행 중 → http://localhost:' + PORT));
