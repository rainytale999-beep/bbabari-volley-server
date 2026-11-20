'use strict';
/* ===== 빱알이 배구 — 게임 서버 =====
   하는 일: (1) index.html·assets 제공  (2) 방 관리  (3) 경기 계산(초당 60번)  (4) 접속자에게 화면 상태 전송
   실행: npm install  →  npm start   (기본 포트 8080, 환경변수 PORT 로 변경) */
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const Core = require('./core.js'), R = require('./room.js');

const PORT = +process.env.PORT || 8080, ROOT = path.join(__dirname, '..');
const MAX_ROOMS = 40, DT = Core.DT;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.txt': 'text/plain; charset=utf-8' };

const server = http.createServer((req, res) => {
  let u = '/';
  try { u = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { }
  if (u === '/') u = '/index.html';
  if (u === '/rooms') { // 열린 방 목록(방 찾기)
    const list = [];
    for (const room of rooms.values()) { const cfg = room.cfg, own = cfg.slots.find(s => s.kind === 'human' && s.id === cfg.owner), humans = cfg.slots.filter(s => s.kind === 'human').length; list.push({ code: room.code, title: cfg.title || '', host: own ? own.name : '?', n: cfg.n, humans, max: cfg.n * 2, state: room.S ? (room.over ? 'result' : 'game') : 'lobby' }); }
    list.sort((a, b) => (a.state === 'lobby' ? 0 : 1) - (b.state === 'lobby' ? 0 : 1));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); return res.end(JSON.stringify(list.slice(0, 40)));
  }
  if (u === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok rooms=' + rooms.size); }
  const hello = () => { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('빱알이 배구 게임 서버 실행 중 (방 ' + rooms.size + '개)'); };
  if (ROOT === path.sep || /^[A-Za-z]:\\$/.test(ROOT)) { if (u === '/index.html') return hello(); res.writeHead(404); return res.end('not found'); } // 서버만 따로 올린 경우(폴더 맨 위): 파일은 제공하지 않는다
  const file = path.normalize(path.join(ROOT, u));
  if ((u !== '/index.html' && !u.startsWith('/assets/')) || !file.startsWith(ROOT + path.sep)) { res.writeHead(404); return res.end('not found'); }
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
  room.acc = 0; room.stepN = 0; room.evOut = []; room.over = false;
  for (const ws of room.clients.values()) { ws.inp = 0; ws.latch = 0; send(ws, { t: 'start', meta: room.meta, you: slotOf(room, ws.id) }); }
  bc(room, pub(room));
}
function toLobby(room) { room.S = null; room.over = false; bc(room, { t: 'lobby' }); bc(room, pub(room)); }

function onHello(ws, m) {
  if (ws.room) return;
  const name = cleanName(m.name);
  let room;
  if (m.create) {
    if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'err', m: '서버에 방이 가득 찼어요. 잠시 뒤에 다시 시도해 주세요.' });
    let code; do { code = R.newCode(); } while (rooms.has(code));
    room = { code, cfg: R.mkRoom(3), clients: new Map(), S: null, meta: null, acc: 0, stepN: 0, evOut: [], over: false, overAt: 0 };
    room.cfg.title = cleanTitle(m.title);
    room.cfg.owner = ws.id; R.layoutRoom(room.cfg, [{ id: ws.id, name, ch: R.randCh([]) }]);
    rooms.set(code, room);
  } else {
    room = rooms.get(String(m.code || '').trim().toUpperCase());
    if (!room) return send(ws, { t: 'err', m: '그런 방이 없어요. 코드를 다시 확인해 주세요.' });
    const idx = R.joinSlot(room.cfg);
    if (idx < 0) return send(ws, { t: 'full' });
    const jch = room.S ? room.S.players[idx].ch : R.randCh(R.fixedCh(room.cfg, R.teamOf(room.cfg, idx), idx)); // 경기 중 난입이면 그 자리 캐릭터를 이어받고, 로비면 팀에서 안 쓰는 캐릭터로
    room.cfg.slots[idx] = { kind: 'human', id: ws.id, name, ch: jch };
    if (room.S) { const p = room.S.players[idx]; p.bot = false; p.name = name; p.inp = 0; room.meta = R.metaOf(room.cfg, room.S.stage); bc(room, { t: 'meta', meta: room.meta }); }
    bc(room, { t: 'toast', m: name + ' 님이 들어왔어요' });
  }
  ws.room = room; ws.name = name; room.clients.set(ws.id, ws);
  send(ws, { t: 'you', id: ws.id, code: room.code });
  bc(room, pub(room));
  if (room.S) { send(ws, { t: 'start', meta: room.meta, you: slotOf(room, ws.id) }); if (room.over) send(ws, { t: 'result', stats: room.S.players.map(p => p.stats) }); }
}
function onLeave(ws) {
  const room = ws.room; if (!room) return; ws.room = null;
  room.clients.delete(ws.id);
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
  if (m.t === 'ping') { send(ws, { t: 'pong', c: +m.c || 0 }); return; }
  if (m.t === 'in') { ws.inp = (m.k | 0) & 127; ws.latch |= ws.inp; }
  else if (m.t === 'ch' || m.t === 'move' || m.t === 'set') {
    if (room.S) return;
    const err = R.roomApply(room.cfg, ws.id, m, owner);
    if (err) { if (err !== 'bad') send(ws, { t: 'toast', m: err }); return; }
    bc(room, pub(room));
  }
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

/* 경기 계산 루프: 방마다 초당 60스텝, 2스텝마다 상태 전송 */
let last = now();
setInterval(() => {
  const t = now(), dt = Math.min(0.1, (t - last) / 1000); last = t;
  for (const room of rooms.values()) {
    const S = room.S; if (!S) continue;
    room.acc += dt; let guard = 0;
    while (room.acc >= DT && guard++ < 6) {
      room.acc -= DT;
      for (const ws of room.clients.values()) { const i = slotOf(room, ws.id); if (i >= 0 && S.players[i] && !S.players[i].bot) S.players[i].inp = ws.inp | ws.latch; ws.latch = 0; }
      try { Core.step(S); } catch (e) { console.error('step error', e); toLobby(room); break; }
      for (const e of S.ev) room.evOut.push(e); S.ev.length = 0;
      if ((++room.stepN & 1) === 0) { bc(room, { t: 's', s: R.pack(S, room.evOut) }); room.evOut = []; }
      if (S.phase === 'over' && S.phaseT > 1.6 && !room.over) { room.over = true; room.overAt = t; bc(room, { t: 'result', stats: S.players.map(p => p.stats) }); bc(room, pub(room)); }
    }
    if (room.acc > DT * 6) room.acc = 0;
    if (room.S && room.over && t - room.overAt > 90000) toLobby(room); // 결과 화면에서 1분 30초 지나면 자동으로 로비
  }
}, 8);
setInterval(() => { const t = now(); for (const ws of wss.clients) { ws.cnt = 0; if (t - ws.last > 15000) ws.terminate(); } }, 1000);

server.listen(PORT, () => console.log('빱알이 배구 서버 실행 중 → http://localhost:' + PORT));
