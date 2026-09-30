'use strict';
const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const WebSocket=require('ws');
const PORT=Number(process.env.PORT||8080),ROOT=__dirname,DB_FILE=path.join(ROOT,'tomtom-data.json');
const rooms=new Map(), queue=[];
let db={users:{},games:[]};
try{if(fs.existsSync(DB_FILE)) db={...db,...JSON.parse(fs.readFileSync(DB_FILE,'utf8'))};}catch(e){console.error('DB load:',e.message)}
function persist(){try{fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2))}catch(e){console.error('DB save:',e.message)}}
function hash(s){return crypto.createHash('sha256').update(String(s)).digest('hex')}
function token(){return crypto.randomBytes(24).toString('hex')}
function code(){return crypto.randomBytes(3).toString('hex').toUpperCase()}
function send(ws,data){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data))}
function broadcast(room,data,except){for(const p of room.players)if(p.ws!==except)send(p.ws,data)}
function safeUser(u){return {username:u.username,name:u.name,rating:u.rating,wins:u.wins,losses:u.losses,draws:u.draws,level:u.level,xp:u.xp}}
function snapshot(room){return {type:'room_state',room:room.code,players:room.players.map(p=>({color:p.color,name:p.name||'PLAYER',username:p.username||''})),started:room.players.length===2}}
function leave(ws){
 for(const [id,room] of rooms){const i=room.players.findIndex(p=>p.ws===ws);if(i<0)continue;room.players.splice(i,1);broadcast(room,{type:'opponent_left'});if(room.players.length===0)rooms.delete(id);else broadcast(room,snapshot(room));break}
 const qi=queue.indexOf(ws);if(qi>=0)queue.splice(qi,1);
}
function authenticate(msg){const u=db.users[msg.username];return u&&u.token===msg.token?u:null}
function httpJson(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(obj))}
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type'});return res.end()}
 if(url.pathname.startsWith('/api/')){
  let body='';req.on('data',c=>body+=c);req.on('end',()=>{
   let msg={};try{msg=body?JSON.parse(body):{}}catch{return httpJson(res,400,{error:'JSON نامعتبر'})}
   if(req.method==='POST'&&url.pathname==='/api/register'){
    const username=String(msg.username||'').trim().toLowerCase();const password=String(msg.password||'');const name=String(msg.name||username).trim().slice(0,24);
    if(!/^[a-z0-9_]{3,20}$/.test(username)||password.length<4)return httpJson(res,400,{error:'نام کاربری ۳ تا ۲۰ حرف انگلیسی/عدد و رمز حداقل ۴ کاراکتر باشد.'});
    if(db.users[username])return httpJson(res,409,{error:'این نام کاربری قبلاً ثبت شده است.'});
    const u={username,name,password:hash(password),token:token(),rating:1200,wins:0,losses:0,draws:0,level:1,xp:0};db.users[username]=u;persist();return httpJson(res,200,{user:safeUser(u),token:u.token});
   }
   if(req.method==='POST'&&url.pathname==='/api/login'){
    const username=String(msg.username||'').trim().toLowerCase(),u=db.users[username];
    if(!u||u.password!==hash(String(msg.password||'')))return httpJson(res,401,{error:'نام کاربری یا رمز عبور اشتباه است.'});
    u.token=token();persist();return httpJson(res,200,{user:safeUser(u),token:u.token});
   }
   if(req.method==='GET'&&url.pathname==='/api/leaderboard'){
    const list=Object.values(db.users).sort((a,b)=>b.rating-a.rating).slice(0,50).map((u,i)=>({rank:i+1,...safeUser(u)}));return httpJson(res,200,{players:list});
   }
   if(req.method==='GET'&&url.pathname==='/api/games'){
    const u=authenticate({username:url.searchParams.get('username'),token:url.searchParams.get('token')});if(!u)return httpJson(res,401,{error:'نیاز به ورود دارید.'});
    return httpJson(res,200,{games:db.games.filter(g=>g.players.includes(u.username)).slice(-50).reverse()});
   }
   if(req.method==='POST'&&url.pathname==='/api/game'){
    const u=authenticate(msg);if(!u)return httpJson(res,401,{error:'نیاز به ورود دارید.'});
    const g=msg.game||{};db.games.push({id:crypto.randomUUID(),players:Array.isArray(g.players)?g.players.slice(0,2):[u.username],result:g.result||'draw',moves:Array.isArray(g.moves)?g.moves.slice(0,500):[],createdAt:new Date().toISOString()});if(db.games.length>1000)db.games=db.games.slice(-1000);persist();return httpJson(res,200,{ok:true});
   }
   if(req.method==='POST'&&url.pathname==='/api/result'){
    const u=authenticate(msg);if(!u)return httpJson(res,401,{error:'نیاز به ورود دارید.'});
    const result=msg.result==='win'||msg.result==='loss'||msg.result==='draw'?msg.result:'draw';
    if(result==='win'){u.wins++;u.rating+=12;u.xp+=35}else if(result==='loss'){u.losses++;u.rating=Math.max(100,u.rating-10);u.xp+=8}else{u.draws++;u.xp+=18}
    while(u.xp>=100){u.xp-=100;u.level++}persist();return httpJson(res,200,{user:safeUser(u)});
   }
   return httpJson(res,404,{error:'Not found'});
  });return;
 }
 let reqPath=decodeURIComponent(url.pathname);if(reqPath==='/')reqPath='/index.html';const safe=path.normalize(reqPath).replace(/^([.][.][\\/])+/,''),file=path.join(ROOT,safe);
 if(!file.startsWith(ROOT)){res.writeHead(403);return res.end('Forbidden')}
 fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found')}const ext=path.extname(file);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-store'});res.end(data)})
});
const wss=new WebSocket.Server({server});
wss.on('connection',ws=>{
 ws.on('message',raw=>{let msg;try{msg=JSON.parse(raw.toString())}catch{return}
  if(msg.type==='matchmake'){
   if(queue.includes(ws))return;if(queue.length){const other=queue.shift();const id=code();const room={code:id,players:[]};const a={ws:other,color:'w',name:other.name||'PLAYER',username:other.username||''},b={ws,color:'b',name:ws.name||'PLAYER',username:ws.username||''};room.players.push(a,b);rooms.set(id,room);other.room=id;other.color='w';ws.room=id;ws.color='b';send(other,{type:'match_found',room:id,color:'w'});send(ws,{type:'match_found',room:id,color:'b'});broadcast(room,snapshot(room));
   }else{queue.push(ws);send(ws,{type:'match_waiting'});return}
  }
  if(msg.type==='create_room'){
   let id=String(msg.room||'').trim().toUpperCase()||code();while(rooms.has(id))id=code();const room={code:id,players:[],lastMove:null};const p={ws,color:'w',name:String(msg.name||'PLAYER 1').slice(0,24),username:String(msg.username||'')};room.players.push(p);rooms.set(id,room);ws.room=id;ws.color='w';ws.name=p.name;ws.username=p.username;send(ws,{type:'room_created',room:id,color:'w'});send(ws,snapshot(room));return
  }
  if(msg.type==='join_room'){
   const id=String(msg.room||'').trim().toUpperCase(),room=rooms.get(id);if(!room)return send(ws,{type:'error',message:'اتاق پیدا نشد.'});if(room.players.length>=2)return send(ws,{type:'error',message:'این اتاق پر است.'});const p={ws,color:'b',name:String(msg.name||'PLAYER 2').slice(0,24),username:String(msg.username||'')};room.players.push(p);ws.room=id;ws.color='b';ws.name=p.name;ws.username=p.username;send(ws,{type:'room_joined',room:id,color:'b'});broadcast(room,snapshot(room));return
  }
  const room=rooms.get(ws.room);if(!room)return;
  if(msg.type==='move'){if(msg.color!==ws.color)return send(ws,{type:'error',message:'بازیکن نامعتبر.'});room.lastMove=msg.move;broadcast(room,{type:'remote_move',move:msg.move,color:ws.color},ws)}
  else if(msg.type==='new_game'){room.lastMove=null;broadcast(room,{type:'new_game'},ws)}
  else if(msg.type==='resign'){broadcast(room,{type:'resigned',color:ws.color},ws)}
  else if(msg.type==='ping')send(ws,{type:'pong'})
 });ws.on('close',()=>leave(ws));
});
server.listen(PORT,()=>console.log(`TOMTOM CHESS server: http://localhost:${PORT}`));
