'use strict';

const PIECES = {
  w: { k:'♔', q:'♕', r:'♖', b:'♗', n:'♘', p:'♙' },
  b: { k:'♚', q:'♛', r:'♜', b:'♝', n:'♞', p:'♟' }
};

const VALUE = { p:1, n:3, b:3, r:5, q:9, k:100 };

const boardEl = document.getElementById('board');
const sideEl = document.getElementById('side');
const statusEl = document.getElementById('status');
const footerEl = document.getElementById('footer');
const modalEl = document.getElementById('modal');
const modalTitleEl = document.getElementById('modalTitle');
const modalTextEl = document.getElementById('modalText');
const modeEl = document.getElementById('mode');
const newGameBtn = document.getElementById('newGame');
const againBtn = document.getElementById('again');
const soundBtn = document.getElementById('sound');

let board = [];
let turn = 'w';
let selected = null;
let castling = null;
let enPassant = null;
let gameOver = false;
let soundOn = false;
let computerTimer = null;
let lastMove = null;
let animationBusy = false;
let boardFlipped = false;
let paused = false;
let history = [];
let clockSeconds = {w:600,b:600};
let clockTimer = null;
let dragState = null;
let touchMoved = false;
let timeControlSeconds = 600;
let smartMode = true;
let pieceSet = 'classic';
let aiDepth = 2;
let profile = {name:'TOMTOM PLAYER',avatar:'♞',xp:0,level:1,rating:1200,wins:0,losses:0,draws:0};
let online = {ws:null, room:null, color:null, connected:false, started:false, remote:false};
let moveLog = [];

function createInitialBoard() {
  return [
    ['br','bn','bb','bq','bk','bb','bn','br'],
    ['bp','bp','bp','bp','bp','bp','bp','bp'],
    [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null],
    ['wp','wp','wp','wp','wp','wp','wp','wp'],
    ['wr','wn','wb','wq','wk','wb','wn','wr']
  ];
}

function resetGame() {
  if (computerTimer) clearTimeout(computerTimer);
  stopClock();
  board = createInitialBoard();
  turn = 'w';
  selected = null;
  castling = { w:{k:true,q:true}, b:{k:true,q:true} };
  enPassant = null;
  lastMove = null;
  animationBusy = false;
  gameOver = false;
  paused = false;
  history = [];
  moveLog = [];
  clockSeconds = {w:timeControlSeconds,b:timeControlSeconds};
  hideModal();
  hidePause();
  render();
  updateMovePanel();
  updateClocks();
  updateStatus();
  startClock();
}

function color(piece) { return piece ? piece[0] : null; }
function type(piece) { return piece ? piece[1] : null; }
function inside(r,c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function other(col) { return col === 'w' ? 'b' : 'w'; }
function cloneBoard(b) { return b.map(row => row.slice()); }

function findKing(b, col) {
  for (let r=0;r<8;r++) for (let c=0;c<8;c++) {
    if (b[r][c] === col + 'k') return [r,c];
  }
  return null;
}

function squareAttacked(b, r, c, byColor) {
  const pawnRow = byColor === 'w' ? r + 1 : r - 1;
  for (const dc of [-1,1]) {
    const cc = c + dc;
    if (inside(pawnRow,cc) && b[pawnRow][cc] === byColor+'p') return true;
  }

  const knightOffsets = [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]];
  for (const [dr,dc] of knightOffsets) {
    const rr=r+dr, cc=c+dc;
    if (inside(rr,cc) && b[rr][cc] === byColor+'n') return true;
  }

  for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) {
    if (!dr && !dc) continue;
    const rr=r+dr, cc=c+dc;
    if (inside(rr,cc) && b[rr][cc] === byColor+'k') return true;
  }

  const diagonals = [[1,1],[1,-1],[-1,1],[-1,-1]];
  for (const [dr,dc] of diagonals) {
    let rr=r+dr, cc=c+dc;
    while (inside(rr,cc)) {
      const p=b[rr][cc];
      if (p) {
        if (color(p) === byColor && (type(p)==='b' || type(p)==='q')) return true;
        break;
      }
      rr+=dr; cc+=dc;
    }
  }

  const straights = [[1,0],[-1,0],[0,1],[0,-1]];
  for (const [dr,dc] of straights) {
    let rr=r+dr, cc=c+dc;
    while (inside(rr,cc)) {
      const p=b[rr][cc];
      if (p) {
        if (color(p) === byColor && (type(p)==='r' || type(p)==='q')) return true;
        break;
      }
      rr+=dr; cc+=dc;
    }
  }
  return false;
}

function inCheck(b, col) {
  const king = findKing(b,col);
  if (!king) return true;
  return squareAttacked(b, king[0], king[1], other(col));
}

function applyMoveToBoard(b, move) {
  const x = cloneBoard(b);
  const p = x[move.fr][move.fc];
  x[move.fr][move.fc] = null;
  x[move.tr][move.tc] = p;

  if (move.enPassant) x[move.fr][move.tc] = null;

  if (move.castle === 'k') {
    x[move.tr][5] = x[move.tr][7];
    x[move.tr][7] = null;
  } else if (move.castle === 'q') {
    x[move.tr][3] = x[move.tr][0];
    x[move.tr][0] = null;
  }

  if (type(p) === 'p' && (move.tr === 0 || move.tr === 7)) {
    x[move.tr][move.tc] = color(p) + 'q';
  }
  return x;
}

function canCastle(col, side) {
  const row = col === 'w' ? 7 : 0;
  const king = board[row][4];
  if (king !== col+'k' || inCheck(board,col)) return false;

  if (side === 'k') {
    if (!castling[col].k || board[row][7] !== col+'r') return false;
    if (board[row][5] || board[row][6]) return false;
    if (squareAttacked(board,row,5,other(col))) return false;
    if (squareAttacked(board,row,6,other(col))) return false;
    return true;
  }

  if (!castling[col].q || board[row][0] !== col+'r') return false;
  if (board[row][1] || board[row][2] || board[row][3]) return false;
  if (squareAttacked(board,row,3,other(col))) return false;
  if (squareAttacked(board,row,2,other(col))) return false;
  return true;
}

function pseudoMoves(r,c) {
  const p = board[r][c];
  if (!p) return [];

  const col = color(p), t = type(p);
  const moves = [];

  const add = (tr,tc,extra={}) => {
    if (!inside(tr,tc)) return;
    if (!board[tr][tc] || color(board[tr][tc]) !== col) {
      moves.push({fr:r,fc:c,tr,tc,...extra});
    }
  };

  if (t === 'p') {
    const d = col === 'w' ? -1 : 1;
    const start = col === 'w' ? 6 : 1;

    if (inside(r+d,c) && !board[r+d][c]) {
      moves.push({fr:r,fc:c,tr:r+d,tc:c});
      if (r === start && !board[r+2*d][c]) {
        moves.push({fr:r,fc:c,tr:r+2*d,tc:c,doublePawn:true});
      }
    }

    for (const dc of [-1,1]) {
      const tr=r+d, tc=c+dc;
      if (!inside(tr,tc)) continue;
      if (board[tr][tc] && color(board[tr][tc]) !== col) {
        moves.push({fr:r,fc:c,tr,tc});
      } else if (enPassant && enPassant[0]===tr && enPassant[1]===tc) {
        moves.push({fr:r,fc:c,tr,tc,enPassant:true});
      }
    }
  } else if (t === 'n') {
    [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]
      .forEach(([dr,dc]) => add(r+dr,c+dc));
  } else if (t === 'b' || t === 'r' || t === 'q') {
    const dirs=[];
    if (t==='b' || t==='q') dirs.push([1,1],[1,-1],[-1,1],[-1,-1]);
    if (t==='r' || t==='q') dirs.push([1,0],[-1,0],[0,1],[0,-1]);

    for (const [dr,dc] of dirs) {
      let rr=r+dr, cc=c+dc;
      while (inside(rr,cc)) {
        if (!board[rr][cc]) {
          moves.push({fr:r,fc:c,tr:rr,tc:cc});
        } else {
          if (color(board[rr][cc]) !== col) {
            moves.push({fr:r,fc:c,tr:rr,tc:cc});
          }
          break;
        }
        rr+=dr; cc+=dc;
      }
    }
  } else if (t === 'k') {
    for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) {
      if (dr || dc) add(r+dr,c+dc);
    }
    if (r === (col==='w'?7:0) && c === 4) {
      if (canCastle(col,'k')) moves.push({fr:r,fc:c,tr:r,tc:6,castle:'k'});
      if (canCastle(col,'q')) moves.push({fr:r,fc:c,tr:r,tc:2,castle:'q'});
    }
  }

  return moves;
}

function legalMoves(r,c) {
  const p = board[r][c];
  if (!p || color(p) !== turn) return [];

  return pseudoMoves(r,c).filter(move => {
    const next = applyMoveToBoard(board,move);
    return !inCheck(next,turn);
  });
}

function allLegalMoves(col) {
  const oldTurn=turn;
  turn=col;
  const result=[];
  for (let r=0;r<8;r++) for (let c=0;c<8;c++) {
    if (color(board[r][c]) === col) result.push(...legalMoves(r,c));
  }
  turn=oldTurn;
  return result;
}

function updateCastlingRights(fr,fc,tr,tc,p) {
  const col=color(p);

  if (type(p)==='k') {
    castling[col].k=false;
    castling[col].q=false;
  }

  if (type(p)==='r') {
    if (col==='w' && fr===7 && fc===0) castling.w.q=false;
    if (col==='w' && fr===7 && fc===7) castling.w.k=false;
    if (col==='b' && fr===0 && fc===0) castling.b.q=false;
    if (col==='b' && fr===0 && fc===7) castling.b.k=false;
  }

  // Capturing a rook on its original square also removes that side's right.
  if (tr===7 && tc===0) castling.w.q=false;
  if (tr===7 && tc===7) castling.w.k=false;
  if (tr===0 && tc===0) castling.b.q=false;
  if (tr===0 && tc===7) castling.b.k=false;
}

async function makeMove(move, fromRemote=false) {
  if (animationBusy || gameOver || paused) return;
  if (online.connected && !fromRemote && online.started && turn !== online.color) return;

  const p=board[move.fr][move.fc];
  const captured=board[move.tr][move.tc];
  const snapshot={
    board:cloneBoard(board),
    turn,castling:JSON.parse(JSON.stringify(castling)),
    enPassant:enPassant ? [...enPassant] : null,
    clockSeconds:{...clockSeconds},
    lastMove:lastMove ? {...lastMove}:null
  };
  history.push(snapshot);

  updateCastlingRights(move.fr,move.fc,move.tr,move.tc,p);
  board = applyMoveToBoard(board,move);
  enPassant = move.doublePawn ? [(move.fr+move.tr)/2,move.fc] : null;
  selected=null;
  lastMove={fr:move.fr,fc:move.fc,tr:move.tr,tc:move.tc};
  moveLog.push({fr:move.fr,fc:move.fc,tr:move.tr,tc:move.tc,color:color(p),captured:captured||null});

  animationBusy=true;
  const fromSquare=boardEl.children[move.fr*8+move.fc];
  const toSquare=boardEl.children[move.tr*8+move.tc];
  const movingPiece=fromSquare?.querySelector('.piece');
  if (movingPiece) movingPiece.classList.add('moving');
  if (captured && toSquare) toSquare.querySelector('.piece')?.classList.add('captured');

  playTone(captured ? 'capture' : 'move');
  await new Promise(resolve=>setTimeout(resolve,340));
  animationBusy=false;

  turn=other(turn);
  render();
  updateStatus();
  startClock();

  if (online.connected && !fromRemote) sendOnline({type:'move', room:online.room, color:online.color, move});

  if (!gameOver && !online.connected && modeEl.value === 'computer' && turn === 'b' && smartMode) {
    computerTimer=setTimeout(computerMove,420);
  }
}

function computerMove() {
  if (gameOver || turn !== 'b' || paused) return;
  const moves=allLegalMoves('b');
  if(!moves.length){updateStatus();return;}
  let bestMove=moves[0],bestScore=-Infinity;
  for(const m of moves){
    const next=applyMoveToBoard(board,m);
    let score=evaluatePosition(next);
    if(inCheck(next,'w'))score+=7;
    if(board[m.tr][m.tc])score+=VALUE[type(board[m.tr][m.tc])]*9;
    if(aiDepth>1){
      const reply=minimax(next,aiDepth-1,false);
      score+=reply*0.75;
    }
    score+=Math.random()*0.08;
    if(score>bestScore){bestScore=score;bestMove=m}
  }
  makeMove(bestMove);
}

function updateStatus() {
  const moves=allLegalMoves(turn);
  const check=inCheck(board,turn);

  sideEl.textContent=turn==='w' ? 'نوبت سفید' : 'نوبت سیاه';

  if (!moves.length) {
    gameOver=true;
    if (check) {
      statusEl.textContent='کیش‌ومات!';
      modalTitleEl.textContent='کیش‌ومات';
      modalTextEl.textContent=turn==='w' ? 'سیاه برنده شد.' : 'سفید برنده شد.';
      awardResult('loss');
    } else {
      statusEl.textContent='پات؛ بازی مساوی شد.';
      modalTitleEl.textContent='مساوی';
      modalTextEl.textContent='حرکت قانونی باقی نمانده است.';
      awardResult('draw');
    }
    setTimeout(showModal,180);
    return;
  }

  statusEl.classList.toggle('alert', check);
  if(check) playTone('check');
  statusEl.textContent=check ? 'کیش! باید شاه را نجات دهید.' : 'یک مهره را انتخاب کنید.';
}

function render() {
  boardEl.replaceChildren();
  const rows=[0,1,2,3,4,5,6,7];
  const cols=[0,1,2,3,4,5,6,7];
  if(boardFlipped){rows.reverse();cols.reverse();}

  for (const r of rows) for (const c of cols) {
    const square=document.createElement('div');
    square.className='square '+((r+c)%2 ? 'dark':'light');
    square.dataset.r=r; square.dataset.c=c;

    if (selected && selected[0]===r && selected[1]===c) square.classList.add('selected');

    if (lastMove && ((lastMove.fr===r&&lastMove.fc===c)||(lastMove.tr===r&&lastMove.tc===c))) {
      square.classList.add(lastMove.tr===r&&lastMove.tc===c?'last-to':'last-from');
    }

    const kingPiece=board[r][c];
    if (kingPiece && kingPiece===turn+'k' && inCheck(board,turn)) square.classList.add('check');

    if (selected) {
      const moves=legalMoves(selected[0],selected[1]);
      const move=moves.find(m=>m.tr===r&&m.tc===c);
      if(move) square.classList.add(board[r][c]?'capture':'move');
    }

    const p=board[r][c];
    if(p){
      const piece=document.createElement('div');
      piece.className='piece '+(color(p)==='w'?'white':'black')+' '+pieceSet;
      piece.textContent=PIECES[color(p)][type(p)];
      piece.draggable=false;
      piece.dataset.r=r; piece.dataset.c=c;
      square.appendChild(piece);
      bindDrag(piece,r,c);
    }
    square.addEventListener('pointerdown',e=>beginPointer(e,r,c));
    square.addEventListener('click',()=>handleSquareClick(r,c));
    boardEl.appendChild(square);
  }

  whitePlayer.classList.toggle('active',turn==='w');
  blackPlayer.classList.toggle('active',turn==='b');
  updateMovePanel();
}


function squareName(r,c){ return 'abcdefgh'[c] + (8-r); }
function updateMovePanel(){
  const countEl=document.getElementById('moveCount');
  const listEl=document.getElementById('moveList');
  const wm=document.getElementById('whiteMoveCount');
  const bm=document.getElementById('blackMoveCount');
  if(!listEl) return;
  if(countEl) countEl.textContent=moveLog.length;
  if(wm) wm.textContent=moveLog.filter(m=>m.color==='w').length;
  if(bm) bm.textContent=moveLog.filter(m=>m.color==='b').length;
  if(!moveLog.length){ listEl.innerHTML='<div class="empty-moves">هنوز حرکتی انجام نشده</div>'; return; }
  listEl.innerHTML=moveLog.map((m,i)=>{
    const label=(i%2===0 ? ((i>>1)+1)+'. ' : '') + squareName(m.fr,m.fc)+' → '+squareName(m.tr,m.tc) + (m.captured?' ×':'');
    return `<div class="move-row ${m.color==='w'?'white-move':'black-move'}"><span>${label}</span><small>${m.captured?'گرفتن':'حرکت'}</small></div>`;
  }).join('');
  listEl.scrollTop=listEl.scrollHeight;
}

function handleSquareClick(r,c) {
  if (gameOver || animationBusy || paused) return;
  if (selected) {
    const moves=legalMoves(selected[0],selected[1]);
    const move=moves.find(m=>m.tr===r&&m.tc===c);
    if(move){ makeMove(move); return; }
    if(board[r][c] && color(board[r][c])===turn){selected=[r,c];render();return;}
    selected=null;render();return;
  }
  if(board[r][c] && color(board[r][c])===turn){selected=[r,c];render();}
}

function beginPointer(e,r,c){
  if(gameOver||animationBusy||paused) return;
  if(!board[r][c] || color(board[r][c])!==turn) return;
  dragState={r,c,id:e.pointerId,startX:e.clientX,startY:e.clientY,dragging:false};
  const el=e.currentTarget;
  try{el.setPointerCapture(e.pointerId)}catch(_){}
  el.addEventListener('pointermove',pointerMove);
  el.addEventListener('pointerup',pointerUp,{once:true});
  el.addEventListener('pointercancel',pointerCancel,{once:true});
}

function pointerMove(e){
  if(!dragState) return;
  const dx=e.clientX-dragState.startX,dy=e.clientY-dragState.startY;
  if(!dragState.dragging && Math.hypot(dx,dy)<7) return;
  dragState.dragging=true;
  const ghost=document.getElementById('dragGhost');
  const p=board[dragState.r][dragState.c];
  ghost.textContent=PIECES[color(p)][type(p)];
  ghost.className='drag-ghost show '+(color(p)==='w'?'white':'black');
  ghost.style.left=(e.clientX-36)+'px';ghost.style.top=(e.clientY-42)+'px';
  selected=[dragState.r,dragState.c];render();
}

function pointerUp(e){
  if(!dragState)return;
  const state=dragState;dragState=null;
  document.getElementById('dragGhost').className='drag-ghost';
  if(!state.dragging)return;
  const el=document.elementFromPoint(e.clientX,e.clientY)?.closest('.square');
  if(!el)return;
  const r=Number(el.dataset.r),c=Number(el.dataset.c);
  const moves=legalMoves(state.r,state.c);
  const move=moves.find(m=>m.tr===r&&m.tc===c);
  if(move) makeMove(move); else {selected=null;render();}
}
function pointerCancel(){dragState=null;document.getElementById('dragGhost').className='drag-ghost';}
function bindDrag(piece,r,c){
  // Pointer events on the square handle the actual drag; this keeps touch reliable.
}

function playTone(kind='move') {
  if (!soundOn) return;
  try{
    const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)return;
    const ctx=new AudioCtx(),gain=ctx.createGain(),osc=ctx.createOscillator();
    const freq=kind==='capture'?190:(kind==='check'?520:330);
    osc.frequency.value=freq;osc.type=kind==='capture'?'triangle':'sine';
    gain.gain.value=.045;osc.connect(gain);gain.connect(ctx.destination);
    osc.start();osc.stop(ctx.currentTime+(kind==='capture'?.11:.07));
  }catch(_){}
}

function formatTime(s){
  s=Math.max(0,Math.ceil(s));
  return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
}
function updateClocks(){
  whiteClock.textContent=formatTime(clockSeconds.w);
  blackClock.textContent=formatTime(clockSeconds.b);
  whiteClock.style.color=clockSeconds.w<=10&&turn==='w'?'#ff8b8b':'';
  blackClock.style.color=clockSeconds.b<=10&&turn==='b'?'#ff8b8b':'';
}
function startClock(){
  stopClock();
  if(gameOver||paused)return;
  clockTimer=setInterval(()=>{
    clockSeconds[turn]-=1;updateClocks();
    if(clockSeconds[turn]<=0){
      clockSeconds[turn]=0;gameOver=true;stopClock();
      modalTitleEl.textContent='زمان تمام شد';
      modalTextEl.textContent=turn==='w'?'زمان سفید تمام شد؛ سیاه برنده شد.':'زمان سیاه تمام شد؛ سفید برنده شد.';
      awardResult('loss');
      showModal();
    }
  },1000);
}
function stopClock(){if(clockTimer){clearInterval(clockTimer);clockTimer=null;}}
function undoMove(){
  if(animationBusy||!history.length||gameOver)return;
  const s=history.pop();
  board=s.board;turn=s.turn;castling=s.castling;enPassant=s.enPassant;
  if(moveLog.length) moveLog.pop();
  clockSeconds=s.clockSeconds;lastMove=s.lastMove;selected=null;gameOver=false;
  hideModal();render();updateClocks();updateStatus();
}
function togglePause(){
  if(gameOver)return;
  paused=!paused;
  if(paused){stopClock();pauseOverlay.classList.add('show')}
  else {hidePause();startClock()}
}
function hidePause(){pauseOverlay.classList.remove('show')}
function hideSettings(){settingsPanel.classList.remove('show');settingsPanel.setAttribute('aria-hidden','true')}

function showModal() {
  modalEl.classList.add('show');
  modalEl.setAttribute('aria-hidden','false');
}

function hideModal() {
  modalEl.classList.remove('show');
  modalEl.setAttribute('aria-hidden','true');
}


function loadProfile(){
  try{
    const saved=JSON.parse(localStorage.getItem('tomtom_profile')||'null');
    if(saved)profile={...profile,...saved};
  }catch(_){}
}
function saveProfileData(){
  try{localStorage.setItem('tomtom_profile',JSON.stringify(profile));}catch(_){}
  profileName.textContent=profile.name;
  profileAvatar.textContent=profile.avatar;
  level.textContent=profile.level;
  xp.textContent=profile.xp;
  rating.textContent=profile.rating;
  wins.textContent=profile.wins;losses.textContent=profile.losses;draws.textContent=profile.draws;
}
function awardResult(result){
  if(result==='win'){profile.wins++;profile.rating+=12;profile.xp+=35}
  else if(result==='loss'){profile.losses++;profile.rating=Math.max(100,profile.rating-10);profile.xp+=8}
  else {profile.draws++;profile.xp+=18}
  while(profile.xp>=100){profile.xp-=100;profile.level++}
  saveProfileData();
  if (typeof window.tomtomSyncResult === 'function') window.tomtomSyncResult(result);
}

function minimax(boardState, depth, maximizing, alpha=-Infinity, beta=Infinity){
  if(depth<=0)return evaluatePosition(boardState);
  const old=board; board=boardState;
  const col=maximizing?'b':'w';
  const moves=allLegalMoves(col);
  board=old;
  if(!moves.length)return maximizing ? -100000 : 100000;
  let best=maximizing?-Infinity:Infinity;
  for(const m of moves){
    const next=applyMoveToBoard(boardState,m);
    const value=minimax(next,depth-1,!maximizing,alpha,beta);
    if(maximizing){best=Math.max(best,value);alpha=Math.max(alpha,value)}
    else{best=Math.min(best,value);beta=Math.min(beta,value)}
    if(beta<=alpha)break;
  }
  return best;
}
function evaluatePosition(b){
  let score=0;
  const center=[[3,3],[3,4],[4,3],[4,4]];
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){
    const p=b[r][c];if(!p)continue;
    let v=VALUE[type(p)];
    if(type(p)==='p')v+= (color(p)==='b'?r:7-r)*0.08;
    if(center.some(x=>x[0]===r&&x[1]===c))v+=0.18;
    score += color(p)==='b'?v:-v;
  }
  return score;
}


// ===== REAL ONLINE MULTIPLAYER =====
function getConfiguredServer(){return localStorage.getItem('tomtom_server_url')||''}
function setServerUrlFromInput(){
  const el=document.getElementById('serverUrlInput');
  if(!el)return;
  const v=el.value.trim().replace(/\/$/,'');
  if(v)localStorage.setItem('tomtom_server_url',v); else localStorage.removeItem('tomtom_server_url');
}
function testConfiguredServer(){
  const base=getConfiguredServer();
  const target=base||location.origin;
  const url=target.replace(/\/$/,'')+'/health';
  fetch(url,{cache:'no-store'}).then(r=>r.json()).then(d=>{roomMessage.textContent='✅ سرور آنلاین است: '+(d.service||'TOMTOM CHESS')}).catch(()=>{roomMessage.textContent='❌ سرور در دسترس نیست. آدرس و HTTPS را بررسی کنید.'});
}
function wsUrl(){
  const configured=localStorage.getItem('tomtom_server_url')||'';
  if(configured){
    let base=configured.trim().replace(/\/$/,'');
    base=base.replace(/^http:\/\//,'ws://').replace(/^https:\/\//,'wss://');
    if(!/^wss?:\/\//.test(base)) base=(location.protocol==='https:'?'wss://':'ws://')+base;
    return base;
  }
  const proto=location.protocol==='https:'?'wss':'ws';
  return `${proto}://${location.host}`;
}
function setOnlineUI(text, connected=false){
  if(onlineState) onlineState.textContent=text;
  if(onlineDot) onlineDot.classList.toggle('connected',connected);
}
function sendOnline(payload){
  if(online.ws && online.ws.readyState===WebSocket.OPEN) online.ws.send(JSON.stringify(payload));
}
function connectOnline(){
  if(online.ws && (online.ws.readyState===WebSocket.OPEN || online.ws.readyState===WebSocket.CONNECTING)) return online.ws;
  if(location.protocol==='file:'){
    setOnlineUI('سرور اجرا نشده است',false);
    roomMessage.textContent='برای آنلاین واقعی پروژه را با «npm install» و سپس «npm start» اجرا کنید.';
    return null;
  }
  const ws=new WebSocket(wsUrl()); online.ws=ws;
  setOnlineUI('در حال اتصال…',false);
  ws.onopen=()=>{online.connected=true;setOnlineUI('متصل به سرور',true)};
  ws.onclose=()=>{online.connected=false;online.started=false;setOnlineUI('اتصال قطع شد',false);roomMessage.textContent='اتصال به سرور قطع شد.'};
  ws.onerror=()=>{setOnlineUI('خطا در اتصال',false)};
  ws.onmessage=(event)=>{
    let msg; try{msg=JSON.parse(event.data)}catch{return}
    if(msg.type==='match_waiting'){ roomMessage.textContent='⏳ منتظر حریف تصادفی…'; roomMessage.classList.add('match-wait'); }
    if(msg.type==='match_found'){ online.room=msg.room; online.color=msg.color; modeEl.value='human'; roomCode.value=msg.room; roomMessage.textContent='⚡ حریف پیدا شد؛ بازی آماده است.'; roomMessage.classList.remove('match-wait'); }
    if(msg.type==='room_created' || msg.type==='room_joined'){
      online.room=msg.room; online.color=msg.color; roomCode.value=msg.room;
      modeEl.value='human'; blackLabel.textContent=msg.color==='w'?'WAITING…':'ONLINE';
      roomMessage.textContent=msg.color==='w'?'اتاق ساخته شد؛ کد را برای حریف بفرست.':'وارد اتاق شدی؛ بازی آماده است.';
    }
    if(msg.type==='room_state'){
      online.started=!!msg.started;
      const me=msg.players.find(p=>p.color===online.color); const opp=msg.players.find(p=>p.color!==online.color);
      blackLabel.textContent=online.started?(opp?.name||'ONLINE'):'WAITING…';
      if(online.started){ roomMessage.textContent='اتصال دو بازیکن برقرار شد؛ بازی شروع شد.'; resetGame(); }
      else roomMessage.textContent='منتظر بازیکن دوم…';
      if(online.color==='b') boardFlipped=true; render();
    }
    if(msg.type==='remote_move'){
      if(msg.color===online.color) return;
      makeMove(msg.move,true);
    }
    if(msg.type==='new_game') resetGame();
    if(msg.type==='resigned'){
      gameOver=true; stopClock(); modalTitleEl.textContent='تسلیم'; modalTextEl.textContent=msg.color===online.color?'حریف تسلیم شد؛ شما برنده شدید.':'حریف برنده شد.'; showModal();
    }
    if(msg.type==='opponent_left'){ online.started=false; blackLabel.textContent='OFFLINE'; roomMessage.textContent='حریف از اتاق خارج شد.'; }
    if(msg.type==='error') roomMessage.textContent=msg.message||'خطای آنلاین';
  };
  return ws;
}
const serverUrlInput=document.getElementById('serverUrlInput');
const saveServerUrl=document.getElementById('saveServerUrl');
const testServer=document.getElementById('testServer');
if(serverUrlInput){serverUrlInput.value=getConfiguredServer();}
if(saveServerUrl)saveServerUrl.addEventListener('click',()=>{setServerUrlFromInput();setOnlineUI('آدرس سرور ذخیره شد',false);roomMessage.textContent='آدرس سرور ذخیره شد. حالا «تست اتصال» یا «ساخت اتاق» را بزن.';});
if(testServer)testServer.addEventListener('click',()=>{setServerUrlFromInput();testConfiguredServer()});

function createOnlineRoom(){
  roomCode.value=Math.random().toString(36).slice(2,8).toUpperCase();
  const ws=connectOnline(); if(!ws)return;
  const send=()=>sendOnline({type:'create_room',room:roomCode.value,name:profile.name});
  if(ws.readyState===WebSocket.OPEN) send(); else ws.addEventListener('open',send,{once:true});
}
function joinOnlineRoom(){
  const id=roomCode.value.trim().toUpperCase();
  if(!id){roomMessage.textContent='کد اتاق را وارد کنید.';return}
  const ws=connectOnline(); if(!ws)return;
  const send=()=>sendOnline({type:'join_room',room:id,name:profile.name});
  if(ws.readyState===WebSocket.OPEN) send(); else ws.addEventListener('open',send,{once:true});
}
function resetOnline(){ online.started=false; online.room=null; online.color=null; }

// ===== PRO CONTROLS =====
const whitePlayer=document.getElementById('whitePlayer');
const blackPlayer=document.getElementById('blackPlayer');
const whiteClock=document.getElementById('whiteClock');
const blackClock=document.getElementById('blackClock');
const undoBtn=document.getElementById('undoBtn');
const flipBtn=document.getElementById('flipBtn');
const pauseBtn=document.getElementById('pauseBtn');
const pauseOverlay=document.getElementById('pauseOverlay');
const resumeBtn=document.getElementById('resumeBtn');
const settingsBtn=document.getElementById('settingsBtn');
const settingsPanel=document.getElementById('settings');
const closeSettings=document.getElementById('closeSettings');
const saveSettings=document.getElementById('saveSettings');
const timeControl=document.getElementById('timeControl');
const theme=document.getElementById('theme');
const smartModeEl=document.getElementById('smartMode');
const blackLabel=document.getElementById('blackLabel');

function openSettings(){
  settingsPanel.classList.add('show');
  settingsPanel.setAttribute('aria-hidden','false');
}
settingsBtn.addEventListener('click',openSettings);
closeSettings.addEventListener('click',hideSettings);
saveSettings.addEventListener('click',()=>{
  timeControlSeconds=Number(timeControl.value);
  smartMode=smartModeEl.checked;
  pieceSet=pieceSetEl.value;
  aiDepth=smartMode?2:1;
  document.body.classList.remove('theme-midnight','theme-emerald');
  if(theme.value==='midnight')document.body.classList.add('theme-midnight');
  if(theme.value==='emerald')document.body.classList.add('theme-emerald');
  hideSettings();resetGame();
});

newGameBtn.addEventListener('click',()=>{resetGame(); if(online.connected) sendOnline({type:'new_game',room:online.room})});
againBtn.addEventListener('click',()=>{resetGame(); if(online.connected) sendOnline({type:'new_game',room:online.room})});
closeModal.addEventListener('click',hideModal);
modeEl.addEventListener('change',()=>{
  blackLabel.textContent=modeEl.value==='computer'?'TOMTOM AI':'PLAYER 2';
  resetGame();
});
soundBtn.addEventListener('click',()=>{
  soundOn=!soundOn;
  soundBtn.textContent=soundOn?'🔊':'🔇';
  footerEl.textContent=`TOMTOM CHESS PRO • صدا ${soundOn?'روشن':'خاموش'} است.`;
  if(soundOn)playTone();
});
undoBtn.addEventListener('click',()=>{
  // In computer mode undo the human+AI pair where possible.
  undoMove();
  if(modeEl.value==='computer' && turn==='b' && history.length)undoMove();
});
flipBtn.addEventListener('click',()=>{boardFlipped=!boardFlipped;render()});
pauseBtn.addEventListener('click',togglePause);
resumeBtn.addEventListener('click',()=>{paused=false;hidePause();startClock()});

// Splash
setTimeout(()=>document.getElementById('splash').classList.add('hide'),1050);


const profileBtn=document.getElementById('profileBtn'),profilePanel=document.getElementById('profilePanel');
const closeProfile=document.getElementById('closeProfile'),saveProfile=document.getElementById('saveProfile');
const playerName=document.getElementById('playerName'),avatarSelect=document.getElementById('avatarSelect');
const profileName=document.getElementById('profileName'),profileAvatar=document.getElementById('profileAvatar');
const level=document.getElementById('level'),xp=document.getElementById('xp'),rating=document.getElementById('rating');
const wins=document.getElementById('wins'),losses=document.getElementById('losses'),draws=document.getElementById('draws');
const onlineBtn=document.getElementById('onlineBtn'),onlinePanel=document.getElementById('onlinePanel');
const closeOnline=document.getElementById('closeOnline'),copyRoom=document.getElementById('copyRoom'),hostRoom=document.getElementById('hostRoom'),joinRoom=document.getElementById('joinRoom');
const onlineState=document.getElementById('onlineState'),onlineDot=document.getElementById('onlineDot');
const roomCode=document.getElementById('roomCode'),roomMessage=document.getElementById('roomMessage');
const pieceSetEl=document.getElementById('pieceSet');

function showPanel(p){p.classList.add('show');p.setAttribute('aria-hidden','false')}
function hidePanel(p){p.classList.remove('show');p.setAttribute('aria-hidden','true')}
profileBtn.addEventListener('click',()=>{playerName.value=profile.name;avatarSelect.value=profile.avatar;showPanel(profilePanel)});
closeProfile.addEventListener('click',()=>hidePanel(profilePanel));
saveProfile.addEventListener('click',()=>{
  profile.name=playerName.value.trim()||'TOMTOM PLAYER';
  profile.avatar=avatarSelect.value;saveProfileData();hidePanel(profilePanel);
});
onlineBtn.addEventListener('click',()=>{showPanel(onlinePanel); connectOnline()});
closeOnline.addEventListener('click',()=>hidePanel(onlinePanel));
hostRoom.addEventListener('click',createOnlineRoom);
joinRoom.addEventListener('click',joinOnlineRoom);
copyRoom.addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(roomCode.value);roomMessage.textContent='کد اتاق کپی شد.'}
  catch(_){roomMessage.textContent='کد اتاق: '+roomCode.value}
});

pieceSetEl.addEventListener('change',()=>{pieceSet=pieceSetEl.value;render()});

// Start
blackLabel.textContent='PLAYER 2';
