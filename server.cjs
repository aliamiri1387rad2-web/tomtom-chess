'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 10000);
const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const rooms = new Map();
const matchmaking = [];
const VERSION = 'S3';
const DB_FILE = path.join(ROOT, 'tomtom-data.json');
let db = { users: {}, games: [] };
try { if (fs.existsSync(DB_FILE)) db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch (_) {}
function persist(){ try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch (_) {} }
function hash(v){ return crypto.createHash('sha256').update(String(v)).digest('hex'); }
function token(){ return crypto.randomBytes(24).toString('hex'); }
function leagueFor(rating){ const r=Number(rating)||0; if(r<800)return {key:'bronze',name:'برنز',min:0,max:799}; if(r<1000)return {key:'silver',name:'نقره‌ای',min:800,max:999}; if(r<1200)return {key:'gold',name:'طلایی',min:1000,max:1199}; if(r<1400)return {key:'platinum',name:'پلاتینیوم',min:1200,max:1399}; if(r<1600)return {key:'diamond',name:'الماس',min:1400,max:1599}; if(r<1800)return {key:'master',name:'مستر',min:1600,max:1799}; if(r<2000)return {key:'grandmaster',name:'گرندمستر',min:1800,max:1999}; return {key:'champion',name:'قهرمان',min:2000,max:null}; }
function ratingGain(rating){const k=leagueFor(rating).key;return ({bronze:15,silver:12,gold:10,platinum:8,diamond:6,master:5,grandmaster:4,champion:3})[k]||3}
function ratingLoss(rating){const k=leagueFor(rating).key;return ({bronze:6,silver:7,gold:8,platinum:9,diamond:10,master:11,grandmaster:12,champion:13})[k]||8}
function safeUser(u){ return { username:u.username, name:u.name, rating:u.rating, wins:u.wins, losses:u.losses, draws:u.draws, level:u.level, xp:u.xp, league:leagueFor(u.rating) }; }
function auth(body){ const u=db.users[String(body.username||'').toLowerCase()]; return u && u.token===body.token ? u : null; }

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}
function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function roomCode() { return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function validCode(s) { return /^[A-Z0-9]{3,8}$/.test(s); }
function cleanName(s, fallback) { return String(s || fallback).trim().slice(0, 24) || fallback; }
function removeQueue(ws) {
  for (let i = matchmaking.length - 1; i >= 0; i--) if (matchmaking[i] === ws) matchmaking.splice(i, 1);
  ws.__matchReqId = null;
}
function roomOf(ws) { return ws.room ? rooms.get(ws.room) : null; }
function broadcast(room, data, except) {
  for (const player of room.players) if (player.ws !== except) send(player.ws, data);
}
function state(room) {
  return {
    type: 'room_state',
    room: room.code,
    started: !!room.started,
    players: room.players.map(p => ({ color: p.color, name: p.name, username: p.username }))
  };
}
function leaveRoom(ws, notify) {
  const id = ws.room;
  if (!id) return;
  const room = rooms.get(id);
  ws.room = null; ws.color = null;
  if (!room) return;
  room.players = room.players.filter(p => p.ws !== ws);
  if (room.players.length < 2) room.started = false;
  if (!room.players.length) rooms.delete(id);
  else {
    if (notify) broadcast(room, { type: 'opponent_left' });
    broadcast(room, state(room));
  }
}
function joinRoom(ws, id, name, username, reqId) {
  const room = rooms.get(id);
  if (!room) return send(ws, { type: 'error', reqId, message: 'اتاق پیدا نشد یا صاحب اتاق آفلاین شده است.' });
  if (room.players.length >= 2) return send(ws, { type: 'error', reqId, message: 'این اتاق پر است.' });
  leaveRoom(ws, false);
  const player = { ws, color: 'b', name: cleanName(name, 'PLAYER 2'), username: String(username || '').slice(0, 32) };
  room.players.push(player);
  ws.room = id; ws.color = player.color; ws.name = player.name; ws.username = player.username;
  send(ws, { type: 'room_joined', reqId, room: id, color: player.color });
  broadcast(room, state(room));
}
function createRoom(ws, id, name, username, reqId) {
  removeQueue(ws); leaveRoom(ws, false);
  if (!id) { do { id = roomCode(); } while (rooms.has(id)); }
  if (!validCode(id)) return send(ws, { type: 'error', reqId, message: 'کد اتاق باید ۳ تا ۸ حرف انگلیسی یا عدد باشد.' });
  if (rooms.has(id)) return send(ws, { type: 'error', reqId, message: 'این کد اتاق قبلاً استفاده شده است.' });
  const room = { code: id, players: [], lastMove: null, started: false };
  const player = { ws, color: 'w', name: cleanName(name, 'PLAYER 1'), username: String(username || '').slice(0, 32) };
  room.players.push(player); rooms.set(id, room);
  ws.room = id; ws.color = player.color; ws.name = player.name; ws.username = player.username;
  send(ws, { type: 'room_created', reqId, room: id, color: player.color });
  send(ws, state(room));
}
function findOpponent(ws){
  let bestIndex=-1, bestDiff=Infinity;
  const rating=Number(ws.__rating)||1200;
  for(let i=0;i<matchmaking.length;i++){
    const other=matchmaking[i];
    if(!other||other===ws||other.readyState!==WebSocket.OPEN||other.room)continue;
    const diff=Math.abs((Number(other.__rating)||1200)-rating);
    if(diff<bestDiff){bestDiff=diff;bestIndex=i;}
  }
  if(bestIndex<0)return null;
  const other=matchmaking.splice(bestIndex,1)[0];
  other.__matchReqId=null;
  return other;
}
function matchmake(ws, reqId, msg) {
  removeQueue(ws); leaveRoom(ws, false);
  ws.name = cleanName(msg.name, 'PLAYER');
  ws.username = String(msg.username || '').slice(0, 32);
  ws.__rating = Math.max(0, Number(msg.rating)||1200);
  const other = findOpponent(ws);
  if (!other) {
    ws.__matchReqId = reqId;
    matchmaking.push(ws);
    return send(ws, { type: 'match_waiting', reqId });
  }
  const id = roomCode();
  const room = { code: id, players: [
    { ws: other, color: 'w', name: other.name, username: other.username },
    { ws, color: 'b', name: ws.name, username: ws.username }
  ], lastMove: null, started: true };
  rooms.set(id, room);
  other.room = id; other.color = 'w';
  ws.room = id; ws.color = 'b';
  send(other, { type: 'match_found', reqId: other.__matchReqId, room: id, color: 'w' });
  send(ws, { type: 'match_found', reqId, room: id, color: 'b' });
  broadcast(room, state(room));
  other.__matchReqId = null;
  ws.__matchReqId = null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { ok: true, service: 'TOMTOM CHESS', version: VERSION, websocket: true, websocketPath: '/ws', time: new Date().toISOString() });
  }
  if (url.pathname.startsWith('/api/')) {
    let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
      let msg={}; try{msg=body?JSON.parse(body):{}}catch(_){return json(res,400,{error:'JSON نامعتبر'})}
      if(req.method==='POST' && url.pathname==='/api/register'){
        const username=String(msg.username||'').trim().toLowerCase(), password=String(msg.password||''), name=cleanName(msg.name,username);
        if(!/^[a-z0-9_]{3,20}$/.test(username)||password.length<4)return json(res,400,{error:'نام کاربری ۳ تا ۲۰ حرف انگلیسی/عدد و رمز حداقل ۴ کاراکتر باشد.'});
        if(db.users[username])return json(res,409,{error:'این نام کاربری قبلاً ثبت شده است.'});
        const u={username,name,password:hash(password),token:token(),rating:1200,wins:0,losses:0,draws:0,level:1,xp:0};db.users[username]=u;persist();return json(res,200,{user:safeUser(u),token:u.token});
      }
      if(req.method==='POST' && url.pathname==='/api/login'){
        const username=String(msg.username||'').trim().toLowerCase(),u=db.users[username];
        if(!u||u.password!==hash(msg.password||''))return json(res,401,{error:'نام کاربری یا رمز عبور اشتباه است.'});
        u.token=token();persist();return json(res,200,{user:safeUser(u),token:u.token});
      }
      if(req.method==='GET' && url.pathname==='/api/leaderboard'){
        const players=Object.values(db.users).sort((a,b)=>b.rating-a.rating).slice(0,50).map((u,i)=>({rank:i+1,...safeUser(u)}));return json(res,200,{players});
      }
      if(req.method==='GET' && url.pathname==='/api/games'){
        const u=auth({username:url.searchParams.get('username'),token:url.searchParams.get('token')});if(!u)return json(res,401,{error:'نیاز به ورود دارید.'});
        return json(res,200,{games:db.games.filter(g=>g.players.includes(u.username)).slice(-50).reverse()});
      }
      if(req.method==='POST' && url.pathname==='/api/result'){
        const u=auth(msg);if(!u)return json(res,401,{error:'نیاز به ورود دارید.'});
        const result=['win','loss','draw'].includes(msg.result)?msg.result:'draw';
        if(result==='win'){u.wins++;u.rating+=ratingGain(u.rating);u.xp+=35}else if(result==='loss'){u.losses++;u.rating=Math.max(0,u.rating-ratingLoss(u.rating));u.xp+=8}else{u.draws++;u.xp+=18}
        while(u.xp>=100){u.xp-=100;u.level++}persist();return json(res,200,{user:safeUser(u)});
      }
      if(req.method==='POST' && url.pathname==='/api/game'){
        const u=auth(msg);if(!u)return json(res,401,{error:'نیاز به ورود دارید.'});
        const g=msg.game||{};db.games.push({id:crypto.randomUUID(),players:Array.isArray(g.players)?g.players.slice(0,2):[u.username],result:g.result||'draw',moves:Array.isArray(g.moves)?g.moves.slice(0,500):[],createdAt:new Date().toISOString()});if(db.games.length>1000)db.games=db.games.slice(-1000);persist();return json(res,200,{ok:true});
      }
      return json(res,404,{error:'Not found'});
    }); return;
  }
  let filePath = decodeURIComponent(url.pathname);
  if (filePath === '/') filePath = '/index.html';
  const roots = [DIST, ROOT];
  for (const base of roots) {
    const candidate = path.resolve(base, ' .'.trim() + filePath);
    if (candidate.startsWith(path.resolve(base)) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const ext = path.extname(candidate);
      const type = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.mp3':'audio/mpeg'}[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      return fs.createReadStream(candidate).pipe(res);
    }
  }
  return res.writeHead(404).end('Not found');
});

const wss = new WebSocket.Server({ server, path: '/ws' });
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { try { ws.terminate(); } catch (_) {} continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

wss.on('connection', ws => {
  ws.isAlive = true; ws.room = null; ws.color = null; ws.name = 'PLAYER'; ws.username = ''; ws.__matchReqId = null; ws.__rating = 1200;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => {});
  // Informational only. The client never requires this message before sending a request.
  send(ws, { type: 'connected', serverVersion: VERSION });
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch (_) { return send(ws, { type: 'error', message: 'پیام نامعتبر است.' }); }
    const reqId = msg.reqId || null;
    if (msg.type === 'ping') return send(ws, { type: 'pong', reqId });
    if (msg.type === 'matchmake') return matchmake(ws, reqId, msg);
    if (msg.type === 'cancel_matchmake') { removeQueue(ws); return send(ws, { type: 'match_cancelled', reqId }); }
    if (msg.type === 'leave_room') { removeQueue(ws); leaveRoom(ws, true); return send(ws, { type: 'left_room', reqId }); }
    if (msg.type === 'create_room') return createRoom(ws, String(msg.room || '').trim().toUpperCase(), msg.name, msg.username, reqId);
    if (msg.type === 'join_room') return joinRoom(ws, String(msg.room || '').trim().toUpperCase(), msg.name, msg.username, reqId);
    if (msg.type === 'start_game') {
      const room = roomOf(ws);
      if (!room) return send(ws, { type: 'error', reqId, message: 'ابتدا وارد اتاق شوید.' });
      if (room.players.length < 2) return send(ws, { type: 'error', reqId, message: 'برای شروع باید هر دو بازیکن وارد اتاق باشند.' });
      room.started = true; room.lastMove = null;
      broadcast(room, { type: 'game_started', room: room.code });
      return send(ws, { type: 'game_started', reqId, room: room.code });
    }
    const room = roomOf(ws);
    if (!room) return send(ws, { type: 'error', reqId, message: 'ابتدا یک اتاق بسازید یا وارد اتاق شوید.' });
    if (msg.type === 'move') {
      if (msg.color !== ws.color) return send(ws, { type: 'error', reqId, message: 'نوبت یا بازیکن نامعتبر است.' });
      room.lastMove = msg.move || null;
      return broadcast(room, { type: 'remote_move', move: room.lastMove, color: ws.color }, ws);
    }
    if (msg.type === 'new_game') { room.lastMove = null; room.started = true; return broadcast(room, { type: 'new_game' }, ws); }
    if (msg.type === 'resign') return broadcast(room, { type: 'resigned', color: ws.color }, ws);
    if (msg.type === 'chat') {
      const text = String(msg.text || '').trim().slice(0, 180); if (!text) return;
      return broadcast(room, { type: 'chat', text, name: ws.name, color: ws.color, at: Date.now() });
    }
  });
  ws.on('close', () => { removeQueue(ws); leaveRoom(ws, true); });
});

server.listen(PORT, '0.0.0.0', () => console.log(`TOMTOM CHESS ${VERSION} listening on ${PORT}`));
