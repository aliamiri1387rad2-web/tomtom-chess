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
const homeScreen = document.getElementById('homeScreen');
const gameScreen = document.getElementById('gameScreen');
const homeRatingEl = document.getElementById('homeRating');

function closeAllPanels(){
  document.querySelectorAll('.settings.show').forEach(el=>{el.classList.remove('show');el.setAttribute('aria-hidden','true')});
}
function showHome(){
  closeAllPanels();
  document.body.classList.add('home-mode');
  document.body.classList.remove('game-mode');
  if (homeScreen) homeScreen.setAttribute('aria-hidden','false');
  if (gameScreen) gameScreen.setAttribute('aria-hidden','true');
}
function showGameScreen(){
  closeAllPanels();
  document.body.classList.remove('home-mode');
  document.body.classList.add('game-mode');
  if (homeScreen) homeScreen.setAttribute('aria-hidden','true');
  if (gameScreen) gameScreen.setAttribute('aria-hidden','false');
  requestAnimationFrame(()=>{ if(board && board.length===8) render(); updateClocks(); });
}
function openHomePanel(panel){
  // Home panels belong to the home screen. Never switch to the chess game
  // just because the user opened Online/Profile/Ranking/Settings.
  closeAllPanels();
  document.body.classList.add('home-mode');
  document.body.classList.remove('game-mode');
  if (homeScreen) homeScreen.setAttribute('aria-hidden','false');
  if (gameScreen) gameScreen.setAttribute('aria-hidden','true');
  if (panel===profilePanel){ playerName.value=profile.name; avatarSelect.value=profile.avatar; }
  // Show the requested panel first; network work must never delay the UI.
  if (panel) showPanel(panel);
  if (panel===onlinePanel && typeof connectOnline==='function') setTimeout(()=>connectOnline(),0);
}

// Android/browser back navigation for this single-page app.
// Game -> Home, Panel -> Home, while the Home screen itself may leave the page.
let tomtomNavReady=false;
function navState(){ return window.history.state?.tomtom || null; }
function goHomeFromGame(){
  if(navState()==='game'){ window.history.back(); return; }
  showHome();
}
function openHomePanelNav(panel){
  const key=panel===onlinePanel?'online':panel===profilePanel?'profile':panel===rankPanel?'rank':'settings';
  window.history.pushState({tomtom:key},'',location.href);
  openHomePanel(panel);
}
function enterGameNav(){
  window.history.pushState({tomtom:'game'},'',location.href);
  showGameScreen();
}
window.addEventListener('popstate',()=>{
  const st=navState();
  if(st==='game'){ showGameScreen(); }
  else if(st==='online'){ openHomePanel(onlinePanel); }
  else if(st==='profile'){ openHomePanel(profilePanel); }
  else if(st==='rank'){ openHomePanel(rankPanel); }
  else if(st==='settings'){ openHomePanel(settingsPanel); }
  else { showHome(); }
});

let board = [];
let turn = 'w';
let selected = null;
let castling = null;
let enPassant = null;
let gameOver = false;
let soundOn = true;
let musicOn = true;
let audioUnlocked = false;
let masterVolume = 0.70;
let computerTimer = null;
let computerThinking = false;
let lastMove = null;
let animationBusy = false;
let boardFlipped = false;
let paused = false;
let moveHistory = [];
let clockSeconds = {w:600,b:600};
let clockTimer = null;
let timeControlSeconds = 600;
let smartMode = true;
let pieceSet = 'classic';
let aiLevel = 'medium';
const AI_CONFIG = {
  weak:{maxDepth:1,timeMs:80,random:0.55},
  medium:{maxDepth:2,timeMs:220,random:0.18},
  strong:{maxDepth:3,timeMs:650,random:0.06},
  'very-strong':{maxDepth:4,timeMs:1500,random:0.015},
  king:{maxDepth:5,timeMs:3500,random:0}
};
let profile = {name:'TOMTOM PLAYER',avatar:'♞',xp:0,level:1,rating:1200,wins:0,losses:0,draws:0};
let online = {ws:null, room:null, color:null, connected:false, started:false, remote:false};
let moveLog = [];
let halfmoveClock = 0;
let repetitionCounts = {};
let gameResultAwarded = false;

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
  computerTimer = null;
  computerThinking = false;
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
  moveHistory = [];
  moveLog = [];
  halfmoveClock = 0;
  repetitionCounts = {};
  gameResultAwarded = false;
  repetitionCounts[positionKey()] = 1;
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

function positionKey() {
  const boardKey=board.map(row=>row.join('')).join('/');
  const rights=(castling.w.k?'K':'')+(castling.w.q?'Q':'')+(castling.b.k?'k':'')+(castling.b.q?'q':'')||'-';
  const ep=enPassant ? enPassant.join(',') : '-';
  return `${boardKey}|${turn}|${rights}|${ep}`;
}

function isInsufficientMaterial() {
  const pieces=[];
  for(let r=0;r<8;r++) for(let c=0;c<8;c++) {
    const p=board[r][c];
    if(p && type(p)!=='k') pieces.push({p,r,c});
  }
  if(!pieces.length) return true;
  if(pieces.some(x=>['p','q','r'].includes(type(x.p)))) return false;
  if(pieces.length===1 && ['b','n'].includes(type(pieces[0].p))) return true;
  if(pieces.length===2 && pieces.every(x=>type(x.p)==='b') && color(pieces[0].p)!==color(pieces[1].p)) {
    return ((pieces[0].r+pieces[0].c)%2)===((pieces[1].r+pieces[1].c)%2);
  }
  return false;
}

function finishDraw(title,text) {
  if(gameOver) return;
  gameOver=true;
  statusEl.textContent=text;
  modalTitleEl.textContent=title;
  modalTextEl.textContent=text;
  playTone('draw');
  if(!gameResultAwarded){ gameResultAwarded=true; awardResult('draw'); }
  setTimeout(showModal,180);
}

async function makeMove(move, fromRemote=false, fromAI=false) {
  if (animationBusy || gameOver || paused) return;
  // AI is strictly Black in offline computer mode. Reject any accidental AI move that is not Black.
  if (fromAI && (online.connected || modeEl.value !== 'computer' || turn !== 'b' || color(board[move.fr][move.fc]) !== 'b' || (board[move.tr][move.tc] && color(board[move.tr][move.tc]) === 'b'))) return;
  if (online.connected && !fromRemote && online.started && turn !== online.color) return;
  // In offline AI mode the human is always White; Black moves only through the AI.
  if (!online.connected && modeEl.value === 'computer' && turn === 'b' && !fromAI) return;

  const p=board[move.fr][move.fc];
  const captured=board[move.tr][move.tc];
  const snapshot={
    board:cloneBoard(board),
    turn,castling:JSON.parse(JSON.stringify(castling)),
    enPassant:enPassant ? [...enPassant] : null,
    clockSeconds:{...clockSeconds},
    lastMove:lastMove ? {...lastMove}:null,
    halfmoveClock,
    repetitionCounts:{...repetitionCounts}
  };
  moveHistory.push(snapshot);

  updateCastlingRights(move.fr,move.fc,move.tr,move.tc,p);
  board = applyMoveToBoard(board,move);
  enPassant = move.doublePawn ? [(move.fr+move.tr)/2,move.fc] : null;
  selected=null;
  lastMove={fr:move.fr,fc:move.fc,tr:move.tr,tc:move.tc};
  moveLog.push({fr:move.fr,fc:move.fc,tr:move.tr,tc:move.tc,color:color(p),captured:captured||null});

  // V22: tap-to-move only. Do not animate/rebuild the board before the move;
  // this keeps the board geometry stable and prevents the visual "double/jump" effect.
  animationBusy=true;
  playTone(captured ? 'capture' : (move.castle ? 'castle' : (move.promotion ? 'promote' : 'move')));
  animationBusy=false;

  halfmoveClock = (type(p)==='p' || captured) ? 0 : halfmoveClock + 1;
  turn=other(turn);
  const key=positionKey();
  repetitionCounts[key]=(repetitionCounts[key]||0)+1;
  render();
  updateStatus();
  startClock();

  if (online.connected && !fromRemote) sendOnline({type:'move', room:online.room, color:online.color, move});

  if (!gameOver && !online.connected && modeEl.value === 'computer' && turn === 'b' && smartMode) {
    if (computerTimer) clearTimeout(computerTimer);
    computerTimer=setTimeout(()=>{ computerTimer=null; computerMove(); },420);
  }
}

function aiApplyMove(move){
  const snapshot={
    board:board,
    turn:turn,
    castling:JSON.parse(JSON.stringify(castling)),
    enPassant:enPassant ? [...enPassant] : null
  };
  const p=board[move.fr][move.fc];
  updateCastlingRights(move.fr,move.fc,move.tr,move.tc,p);
  board=applyMoveToBoard(board,move);
  enPassant=move.doublePawn ? [(move.fr+move.tr)/2,move.fc] : null;
  turn=other(turn);
  return snapshot;
}

function aiRestore(snapshot){
  board=snapshot.board;
  turn=snapshot.turn;
  castling=snapshot.castling;
  enPassant=snapshot.enPassant;
}

const AI_PST={
  p:[0,0,0,0,0,0,0,0, 5,8,8,-5,-5,8,8,5, 1,2,3,6,6,3,2,1, 0,0,0,12,12,0,0,0, 1,1,2,15,15,2,1,1, 2,3,6,8,8,6,3,2, 5,5,5,-8,-8,5,5,5, 0,0,0,0,0,0,0,0],
  n:[-5,-4,-3,-3,-3,-3,-4,-5, -4,-2,0,1,1,0,-2,-4, -3,1,3,4,4,3,1,-3, -3,1,4,5,5,4,1,-3, -3,1,4,5,5,4,1,-3, -3,1,3,4,4,3,1,-3, -4,-2,0,1,1,0,-2,-4, -5,-4,-3,-3,-3,-3,-4,-5],
  b:[-3,-2,-2,-2,-2,-2,-2,-3, -2,2,0,0,0,0,2,-2, -2,4,5,2,2,5,4,-2, -2,2,5,6,6,5,2,-2, -2,4,5,6,6,5,4,-2, -2,2,5,2,2,5,2,-2, -2,0,0,0,0,0,0,-2, -3,-2,-2,-2,-2,-2,-2,-3],
  r:[0,0,2,4,4,2,0,0, 0,0,2,4,4,2,0,0, 0,0,2,4,4,2,0,0, 1,1,2,5,5,2,1,1, 1,1,2,5,5,2,1,1, 0,0,2,4,4,2,0,0, 0,0,2,4,4,2,0,0, 0,0,2,4,4,2,0,0],
  q:[-2,-1,-1,0,0,-1,-1,-2, -1,0,1,2,2,1,0,-1, -1,1,2,3,3,2,1,-1, 0,0,2,3,3,2,0,0, -1,1,2,3,3,2,1,-1, -1,0,1,2,2,1,0,-1, -2,-1,-1,0,0,-1,-1,-2, -2,-1,-1,0,0,-1,-1,-2],
  k:[-4,-5,-5,-6,-6,-5,-5,-4, -4,-5,-5,-6,-6,-5,-5,-4, -4,-5,-5,-6,-6,-5,-5,-4, -4,-5,-5,-6,-6,-5,-5,-4, -2,-3,-3,-4,-4,-3,-3,-2, 2,2,0,0,0,0,2,2, 4,5,3,1,1,3,5,4, 4,5,3,1,1,3,5,4]
};

function aiEvaluate(){
  let score=0, whiteMaterial=0, blackMaterial=0, whiteBishops=0, blackBishops=0;
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    const p=board[r][c]; if(!p) continue;
    const col=color(p), t=type(p), base=VALUE[t]*100;
    const idx=col==='b' ? r*8+c : (7-r)*8+c;
    const pst=(AI_PST[t]||[])[idx]||0;
    const v=base+pst;
    if(col==='b'){score+=v;blackMaterial+=base;if(t==='b')blackBishops++;}
    else {score-=v;whiteMaterial+=base;if(t==='b')whiteBishops++;}
  }
  if(blackBishops>=2) score+=28;
  if(whiteBishops>=2) score-=28;

  // Passed-pawn and pawn-island pressure.
  for(let c=0;c<8;c++){
    let wp=0,bp=0;
    for(let r=0;r<8;r++){if(board[r][c]==='wp')wp++;if(board[r][c]==='bp')bp++;}
    if(bp>1) score-=8*(bp-1); // black doubled pawns
    if(wp>1) score+=8*(wp-1);
  }

  // Mobility and king safety are intentionally modest so material remains stable.
  const oldTurn=turn;
  const bm=allLegalMoves('b').length;
  const wm=allLegalMoves('w').length;
  turn=oldTurn;
  score += (bm-wm)*3;
  if(inCheck(board,'w')) score+=35;
  if(inCheck(board,'b')) score-=35;
  if(whiteMaterial+blackMaterial<900) score*=0.92;
  return score;
}

function aiMoveScore(m){
  const p=board[m.fr][m.fc], captured=m.enPassant ? 'p' : board[m.tr][m.tc];
  let s=0;
  if(captured) s += VALUE[type(captured)]*1000 - VALUE[type(p)]*20;
  if(m.promotion) s+=900;
  if(m.castle) s+=60;
  const center=3.5-Math.abs(3.5-m.tr)+3.5-Math.abs(3.5-m.tc);
  s+=center*8;
  return s;
}

function aiOrderedMoves(col){
  return allLegalMoves(col).sort((a,b)=>aiMoveScore(b)-aiMoveScore(a));
}

function aiSearch(depth, alpha, beta, deadline, maximizing){
  if(performance.now()>deadline) throw new Error('AI_TIMEOUT');
  const moves=aiOrderedMoves(turn);
  if(!moves.length){
    if(inCheck(board,turn)) return turn==='b' ? -100000-depth : 100000+depth;
    return 0;
  }
  if(depth<=0) return aiEvaluate();

  if(maximizing){
    let best=-Infinity;
    for(const m of moves){
      const snap=aiApplyMove(m);
      let v;
      try {
        v=aiSearch(depth-1,alpha,beta,deadline,turn==='b');
      } finally {
        aiRestore(snap);
      }
      if(v>best)best=v;
      if(best>alpha)alpha=best;
      if(alpha>=beta)break;
    }
    return best;
  } else {
    let best=Infinity;
    for(const m of moves){
      const snap=aiApplyMove(m);
      let v;
      try {
        v=aiSearch(depth-1,alpha,beta,deadline,turn==='b');
      } finally {
        aiRestore(snap);
      }
      if(v<best)best=v;
      if(best<beta)beta=best;
      if(alpha>=beta)break;
    }
    return best;
  }
}

function chooseAIMove(){
  const cfg=AI_CONFIG[aiLevel]||AI_CONFIG.medium;
  const root=aiOrderedMoves('b');
  if(!root.length)return null;
  if(cfg.maxDepth<=1){
    root.sort((a,b)=>aiMoveScore(b)-aiMoveScore(a));
    const pool=root.slice(0,Math.min(4,root.length));
    return pool[Math.floor(Math.random()*pool.length)]||root[0];
  }

  const deadline=performance.now()+cfg.timeMs;
  let best=root[0];
  try{
    for(let depth=1;depth<=cfg.maxDepth;depth++){
      let depthBest=best, depthScore=-Infinity;
      const candidates=aiOrderedMoves('b');
      for(const m of candidates){
        if(performance.now()>deadline)throw new Error('AI_TIMEOUT');
        const snap=aiApplyMove(m);
        let score;
        try {
          score=aiSearch(depth-1,-Infinity,Infinity,deadline,false);
        } finally {
          aiRestore(snap);
        }
        if(score>depthScore){depthScore=score;depthBest=m;}
      }
      best=depthBest;
    }
  }catch(e){
    if(e.message!=='AI_TIMEOUT') throw e;
  }
  return best;
}

function computerMove(){
  if(computerThinking) return;
  if(gameOver || turn!=='b' || paused || online.connected || modeEl.value!=='computer' || !smartMode) return;

  computerThinking=true;
  try {
    const move=chooseAIMove();
    // The search must never leave the real board in a search position.
    // Re-check everything against the current board before allowing the AI to move.
    if(gameOver || turn!=='b' || paused || online.connected || modeEl.value!=='computer' || !smartMode || !move) return;
    if(color(board[move.fr][move.fc])!=='b') return;
    if(board[move.tr][move.tc] && color(board[move.tr][move.tc])==='b') return;
    const legal=allLegalMoves('b').some(m=>m.fr===move.fr && m.fc===move.fc && m.tr===move.tr && m.tc===move.tc && !!m.castle===!!move.castle && !!m.enPassant===!!move.enPassant);
    if(!legal) return;
    makeMove(move,false,true);
  } finally {
    computerThinking=false;
  }
}

function updateStatus() {
  if(gameOver) return;
  const moves=allLegalMoves(turn);
  const check=inCheck(board,turn);

  sideEl.textContent=turn==='w' ? 'نوبت سفید' : 'نوبت سیاه';

  if (!moves.length) {
    gameOver=true;
    if (check) {
      statusEl.textContent='کیش‌ومات!';
      modalTitleEl.textContent='کیش‌ومات';
      modalTextEl.textContent=turn==='w' ? 'سیاه برنده شد.' : 'سفید برنده شد.';
      playTone('win');
      if(!gameResultAwarded){ gameResultAwarded=true; awardResult('loss'); }
    } else {
      statusEl.textContent='پات؛ بازی مساوی شد.';
      modalTitleEl.textContent='مساوی';
      modalTextEl.textContent='حرکت قانونی باقی نمانده است.';
      playTone('draw');
      if(!gameResultAwarded){ gameResultAwarded=true; awardResult('draw'); }
    }
    setTimeout(showModal,180);
    return;
  }

  if((repetitionCounts[positionKey()]||0)>=3){ finishDraw('سه‌بار تکرار','بازی مساوی شد؛ وضعیت سه بار تکرار شده است.'); return; }
  if(halfmoveClock>=100){ finishDraw('قانون ۵۰ حرکت','بازی مساوی شد؛ ۵۰ حرکت بدون گرفتن مهره یا حرکت سرباز انجام شد.'); return; }
  if(isInsufficientMaterial()){ finishDraw('مهره کافی نیست','بازی مساوی شد؛ مهره کافی برای کیش‌ومات وجود ندارد.'); return; }

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
    }
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

function showLegalHintsDirect(r,c){
  const moves=legalMoves(r,c);
  const byTarget=new Map(moves.map(m=>[m.tr+':'+m.tc,m]));
  boardEl.querySelectorAll('.square').forEach(sq=>{
    const rr=Number(sq.dataset.r),cc=Number(sq.dataset.c);
    const m=byTarget.get(rr+':'+cc);
    sq.classList.toggle('move',!!m && !board[rr][cc]);
    sq.classList.toggle('capture',!!m && !!board[rr][cc]);
  });
}

function refreshSelectionUI(){
  const squares=boardEl.querySelectorAll('.square');
  const targetMoves=selected ? legalMoves(selected[0],selected[1]) : [];
  const byTarget=new Map(targetMoves.map(m=>[m.tr+':'+m.tc,m]));
  squares.forEach(square=>{
    const r=Number(square.dataset.r), c=Number(square.dataset.c);
    square.classList.toggle('selected',!!selected && selected[0]===r && selected[1]===c);
    const move=byTarget.get(r+':'+c);
    square.classList.toggle('move',!!move && !board[r][c]);
    square.classList.toggle('capture',!!move && !!board[r][c]);
  });
}

// V22: the original/simple chess interaction — tap a piece, then tap a destination.
// Dragging is intentionally disabled. Legal-move dots remain visible and clickable.
function handleSquareClick(r,c) {
  if (gameOver || animationBusy || paused) return;
  // Offline AI mode: the player controls White only. Never let a tap play Black.
  if (!online.connected && modeEl.value === 'computer' && turn !== 'w') return;
  if (online.connected && online.started && turn !== online.color) return;

  if (selected) {
    const moves=legalMoves(selected[0],selected[1]);
    const move=moves.find(m=>m.tr===r && m.tc===c);
    if (move) { makeMove(move); return; }
    if (board[r][c] && color(board[r][c])===turn) {
      selected=[r,c];
      refreshSelectionUI();
      playTone('pick');
      return;
    }
    selected=null;
    refreshSelectionUI();
    return;
  }

  if (board[r][c] && color(board[r][c])===turn) {
    selected=[r,c];
    refreshSelectionUI();
    playTone('pick');
  }
}

// No pointer-drag handlers in V22. Keeping the board as a click/tap target avoids
// Android gesture conflicts and prevents the board from being rebuilt while selecting.
function bindDrag(){ /* intentionally disabled in V22 */ }

// ===== CORE UI / PROFILE / CLOCK SAFETY =====
const splashEl=document.getElementById('splash');
const settingsPanel=document.getElementById('settings');
const profilePanel=document.getElementById('profilePanel');
const onlinePanel=document.getElementById('onlinePanel');
const rankPanel=document.getElementById('rankPanel');
const playerName=document.getElementById('playerName');
const avatarSelect=document.getElementById('avatarSelect');
const whitePlayer=document.getElementById('whitePlayer');
const blackPlayer=document.getElementById('blackPlayer');
const blackLabel=document.getElementById('blackLabel');

function loadProfile(){
  try{
    const raw=localStorage.getItem('tomtom_profile');
    if(raw){ profile={...profile,...JSON.parse(raw)}; }
  }catch(_){ }
}
function saveProfileData(){
  try{localStorage.setItem('tomtom_profile',JSON.stringify(profile));}catch(_){ }
  const pn=document.getElementById('profileName'), pa=document.getElementById('profileAvatar');
  const rating=document.getElementById('rating'), xp=document.getElementById('xp'), level=document.getElementById('level');
  if(pn)pn.textContent=profile.name;
  if(pa)pa.textContent=profile.avatar;
  if(rating)rating.textContent=profile.rating;
  if(xp)xp.textContent=profile.xp;
  if(level)level.textContent=profile.level;
  for(const [id,val] of [['wins',profile.wins],['losses',profile.losses],['draws',profile.draws]]){const el=document.getElementById(id);if(el)el.textContent=val}
}
function awardResult(result){
  if(result==='win'){profile.wins++;profile.rating+=10;profile.xp+=25}
  else if(result==='loss'){profile.losses++;profile.rating=Math.max(0,profile.rating-8);profile.xp+=8}
  else {profile.draws++;profile.xp+=12}
  while(profile.xp>=100){profile.xp-=100;profile.level++}
  saveProfileData();
  if(typeof window.tomtomSyncResult==='function') window.tomtomSyncResult(result);
}
function updateClocks(){
  const f=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  const w=document.getElementById('whiteClock'),b=document.getElementById('blackClock');
  if(w)w.textContent=f(clockSeconds.w);if(b)b.textContent=f(clockSeconds.b);
}
function stopClock(){if(clockTimer){clearInterval(clockTimer);clockTimer=null}}
function startClock(){stopClock();if(gameOver||paused)return;clockTimer=setInterval(()=>{if(gameOver||paused){stopClock();return}clockSeconds[turn]--;updateClocks();if(clockSeconds[turn]<=0){clockSeconds[turn]=0;gameOver=true;stopClock();const winner=other(turn);statusEl.textContent=winner==='w'?'زمان تمام شد؛ سفید برنده شد.':'زمان تمام شد؛ سیاه برنده شد.';modalTitleEl.textContent='زمان تمام شد';modalTextEl.textContent=winner==='w'?'سفید برنده شد.':'سیاه برنده شد.';if(!gameResultAwarded){gameResultAwarded=true;awardResult(winner==='w'?'win':'loss');}setTimeout(showModal,100)}} ,1000)}
function showModal(){if(modalEl){modalEl.classList.add('show');modalEl.setAttribute('aria-hidden','false')}}
function hideModal(){if(modalEl){modalEl.classList.remove('show');modalEl.setAttribute('aria-hidden','true')}}
function hidePause(){const e=document.getElementById('pauseOverlay');if(e){e.classList.remove('show');e.setAttribute('aria-hidden','true')}}
function hideSettings(){document.querySelectorAll('.settings.show').forEach(e=>{e.classList.remove('show');e.setAttribute('aria-hidden','true')})}
function showPanel(panel){closeAllPanels();if(panel){panel.classList.add('show');panel.setAttribute('aria-hidden','false')}}
function ensureAudio(){try{if(!window._audioCtx)window._audioCtx=new (window.AudioContext||window.webkitAudioContext)();if(window._audioCtx.state==='suspended'){const r=window._audioCtx.resume();if(r&&r.catch)r.catch(()=>{})}return window._audioCtx}catch(_){return null}}
function playTone(kind){
  if(!soundOn)return;
  try{
    const ctx=ensureAudio(); if(!ctx)return;
    const now=ctx.currentTime, vol=Math.max(.05,Math.min(1,masterVolume));
    const presets={
      pick:{dur:.045,gain:.16,freq:2100,q:3},
      move:{dur:.085,gain:.34,freq:850,q:1.7},
      capture:{dur:.16,gain:.52,freq:520,q:1.2},
      castle:{dur:.10,gain:.30,freq:700,q:1.5},
      promote:{dur:.12,gain:.34,freq:1250,q:2},
      check:{dur:.12,gain:.40,freq:1450,q:3},
      win:{dur:.12,gain:.38,freq:950,q:1.8},
      draw:{dur:.12,gain:.30,freq:500,q:1.5}
    }[kind]||{dur:.08,gain:.3,freq:850,q:1.5};
    const hit=(delay,scale=1)=>{
      const n=Math.max(1,Math.floor(ctx.sampleRate*presets.dur));
      const buf=ctx.createBuffer(1,n,ctx.sampleRate), data=buf.getChannelData(0);
      for(let i=0;i<n;i++){
        const t=i/ctx.sampleRate, env=Math.exp(-t*(32+presets.q*7));
        data[i]=(Math.random()*2-1)*env;
      }
      const src=ctx.createBufferSource(), filter=ctx.createBiquadFilter(), g=ctx.createGain();
      src.buffer=buf; filter.type='bandpass'; filter.frequency.value=presets.freq; filter.Q.value=presets.q;
      g.gain.setValueAtTime(.0001,now+delay);
      g.gain.exponentialRampToValueAtTime(Math.max(.0001,presets.gain*scale*vol),now+delay+.004);
      g.gain.exponentialRampToValueAtTime(.0001,now+delay+presets.dur);
      src.connect(filter); filter.connect(g); g.connect(ctx.destination); src.start(now+delay); src.stop(now+delay+presets.dur+.01);
    };
    hit(0,1);
    if(kind==='capture')hit(.045,.72);
    if(kind==='castle')hit(.12,.78);
    if(kind==='promote')hit(.14,.65);
    if(kind==='win'){hit(.16,.8);hit(.32,.65)}
  }catch(_){}
}
function unlockAudio(){if(audioUnlocked)return;audioUnlocked=true;try{const ctx=ensureAudio();if(ctx){const o=ctx.createOscillator(),g=ctx.createGain();g.gain.setValueAtTime(0.0001,ctx.currentTime);o.connect(g);g.connect(ctx.destination);o.start();o.stop(ctx.currentTime+0.02)}}catch(_){};if(musicOn)setMusic(true);}


function applyAudioSettings(){
  const musicEl=document.getElementById('musicEnabled'), volEl=document.getElementById('masterVolume'), volOut=document.getElementById('masterVolumeValue');
  if(musicEl) musicEl.checked=false;
  if(volEl) volEl.value=Math.round(masterVolume*100);
  if(volOut) volOut.value=Math.round(masterVolume*100)+'٪';
}
function loadAudioSettings(){
  try{
    const raw=JSON.parse(localStorage.getItem('tomtom_audio')||'null');
    if(raw){
      soundOn=raw.soundOn!==false;
      masterVolume=Math.max(0,Math.min(1,Number(raw.volume)||.7));
    }
  }catch(_){ soundOn=true; }
  musicOn=false;
  applyAudioSettings();
  if(soundBtn) soundBtn.textContent=soundOn?'🔊':'🔇';
}
function saveAudioSettings(){
  try{localStorage.setItem('tomtom_audio',JSON.stringify({soundOn,volume:masterVolume}));}catch(_){}
  applyAudioSettings();
}
function setMusic(on){
  musicOn=false;
  const m=window.tomtomPiano;
  if(m){try{m.pause();m.currentTime=0;}catch(_) {}}
}
loadAudioSettings();

// The splash must never trap the user behind a loader. Hide it after the app initializes.
function finishSplash(){if(!splashEl)return;splashEl.classList.add('hide');setTimeout(()=>splashEl.remove(),180)}


function closeCurrentPanel(){
  const st=navState();
  if(st==='online'||st==='profile'||st==='rank'||st==='settings'){ window.history.back(); }
  else { closeAllPanels(); }
}

// Core controls
if(againBtn)againBtn.addEventListener('click',resetGame);
const closeModalBtn=document.getElementById('closeModal');if(closeModalBtn)closeModalBtn.addEventListener('click',hideModal);
const pauseBtn=document.getElementById('pauseBtn'),resumeBtn=document.getElementById('resumeBtn'),pauseOverlay=document.getElementById('pauseOverlay');
if(pauseBtn)pauseBtn.addEventListener('click',()=>{if(gameOver)return;paused=true;stopClock();pauseOverlay?.classList.add('show')});
if(resumeBtn)resumeBtn.addEventListener('click',()=>{paused=false;pauseOverlay?.classList.remove('show');startClock();render()});
if(soundBtn)soundBtn.addEventListener('click',()=>{ensureAudio();soundOn=!soundOn;soundBtn.textContent=soundOn?'🔊':'🔇';footerEl.textContent=soundOn?'TOMTOM CHESS PRO • صدا روشن است.':'TOMTOM CHESS PRO • صدا خاموش است.';if(soundOn)playTone('pick');saveAudioSettings()});
const flipBtn=document.getElementById('flipBtn');if(flipBtn)flipBtn.addEventListener('click',()=>{boardFlipped=!boardFlipped;render()});
const undoBtn=document.getElementById('undoBtn');if(undoBtn)undoBtn.addEventListener('click',()=>{
  if(!moveHistory.length || online.connected) return;
  let h=moveHistory.pop();
  board=h.board;turn=h.turn;castling=h.castling;enPassant=h.enPassant;clockSeconds=h.clockSeconds;lastMove=h.lastMove;halfmoveClock=h.halfmoveClock||0;repetitionCounts={...(h.repetitionCounts||{})};moveLog.pop();
  // In computer mode, undo both the computer reply and the player's last move.
  if(modeEl.value==='computer' && turn==='b' && moveHistory.length){
    h=moveHistory.pop();
    board=h.board;turn=h.turn;castling=h.castling;enPassant=h.enPassant;clockSeconds=h.clockSeconds;lastMove=h.lastMove;halfmoveClock=h.halfmoveClock||0;repetitionCounts={...(h.repetitionCounts||{})};
    moveLog.pop();
  }
  selected=null;gameOver=false;gameResultAwarded=false;render();updateClocks();updateStatus();startClock();
});
const settingsBtn=document.getElementById('settingsBtn');if(settingsBtn)settingsBtn.addEventListener('click',()=>showPanel(settingsPanel));
const closeSettingsBtn=document.getElementById('closeSettings');if(closeSettingsBtn)closeSettingsBtn.addEventListener('click',closeCurrentPanel);
const closeProfileBtn=document.getElementById('closeProfile');if(closeProfileBtn)closeProfileBtn.addEventListener('click',closeCurrentPanel);
const saveProfileBtn=document.getElementById('saveProfile');if(saveProfileBtn)saveProfileBtn.addEventListener('click',()=>{profile.name=(playerName.value||'TOMTOM PLAYER').trim()||'TOMTOM PLAYER';profile.avatar=avatarSelect.value;saveProfileData();profilePanel.classList.remove('show');profilePanel.setAttribute('aria-hidden','true');if(homeRatingEl)homeRatingEl.textContent=profile.rating});
const profileBtn=document.getElementById('profileBtn');if(profileBtn)profileBtn.addEventListener('click',()=>{playerName.value=profile.name;avatarSelect.value=profile.avatar;showPanel(profilePanel)});
const aiLevelEl=document.getElementById('aiLevel');
const aiLevelNote=document.getElementById('aiLevelNote');
const AI_NOTES={weak:'ضعیف: حرکت‌های ساده و سریع.',medium:'متوسط: بازی متعادل و سریع.',strong:'قوی: جست‌وجوی عمیق‌تر و تاکتیک‌های بهتر.', 'very-strong':'خیلی قوی: جست‌وجوی عمیق‌تر با ارزیابی موقعیتی.', king:'پادشاه: بالاترین سطح داخلی بازی؛ برای سخت‌ترین رقابت محلی.'};
function updateAILevelNote(){if(aiLevelNote)aiLevelNote.textContent=AI_NOTES[aiLevelEl?.value||aiLevel]||'';}
if(aiLevelEl){aiLevelEl.value=aiLevel;aiLevelEl.addEventListener('change',()=>{aiLevel=aiLevelEl.value;updateAILevelNote();});}
updateAILevelNote();
const musicEnabledEl=document.getElementById('musicEnabled');const masterVolumeEl=document.getElementById('masterVolume');const masterVolumeValue=document.getElementById('masterVolumeValue');if(masterVolumeEl)masterVolumeEl.addEventListener('input',()=>{masterVolume=Math.max(0,Math.min(1,Number(masterVolumeEl.value)/100));if(masterVolumeValue)masterVolumeValue.value=Math.round(masterVolume*100)+'٪';applyAudioSettings();});if(musicEnabledEl)musicEnabledEl.addEventListener('change',()=>{musicEnabledEl.checked=false;musicOn=false;setMusic(false);});const saveSettingsBtn=document.getElementById('saveSettings');if(saveSettingsBtn)saveSettingsBtn.addEventListener('click',()=>{timeControlSeconds=Number(document.getElementById('timeControl')?.value)||600;pieceSet=document.getElementById('pieceSet')?.value||'classic';smartMode=!!document.getElementById('smartMode')?.checked;aiLevel=aiLevelEl?.value||'medium';musicOn=false;saveAudioSettings();settingsPanel.classList.remove('show');settingsPanel.setAttribute('aria-hidden','true');resetGame()});


// ===== ONLINE ARENA CONNECTION =====
function serverBase(){return (localStorage.getItem('tomtom_server_url')||'https://tomtom-chess.onrender.com').replace(/\/$/,'')}
function sendOnline(msg){if(online.ws&&online.ws.readyState===WebSocket.OPEN)online.ws.send(JSON.stringify(msg))}
function addChat(name,text,me=false){const box=document.getElementById('chatMessages');if(!box)return;box.querySelector('.chat-empty')?.remove();const el=document.createElement('div');el.className='chat-msg'+(me?' me':'');const b=document.createElement('b');b.textContent=me?'شما':name;const sp=document.createElement('span');sp.textContent=text;el.append(b,sp);box.appendChild(el);box.scrollTop=box.scrollHeight}
function connectOnline(){
  if(online.ws&&[WebSocket.OPEN,WebSocket.CONNECTING].includes(online.ws.readyState))return online.ws;
  let url=serverBase();try{const u=new URL(url);u.protocol=u.protocol==='https:'?'wss:':'ws:';url=u.toString()}catch(_){$('onlineState').textContent='آدرس سرور نامعتبر';return null}
  const ws=new WebSocket(url);online.ws=ws;
  $('onlineState').textContent='در حال اتصال…';$('onlineDot').classList.remove('connected');
  ws.addEventListener('open',()=>{online.connected=true;$('onlineState').textContent='متصل به سرور';$('onlineDot').classList.add('connected')});
  ws.addEventListener('close',()=>{online.connected=false;online.started=false;$('onlineState').textContent='قطع شد';$('onlineDot').classList.remove('connected')});
  ws.addEventListener('error',()=>{$('onlineState').textContent='خطا در اتصال'});
  ws.addEventListener('message',ev=>{let m;try{m=JSON.parse(ev.data)}catch(_){return}
    if(m.type==='room_created'||m.type==='room_joined'){online.room=m.room;online.color=m.color;online.started=false;$('roomCode').value=m.room;$('roomMessage').textContent='اتاق '+m.room+' آماده است؛ منتظر بازیکن دوم…'}
    else if(m.type==='room_state'){online.room=m.room;online.started=!!m.started;$('roomMessage').textContent=m.started?'حریف وارد شد؛ بازی شروع شد.':'منتظر بازیکن دوم…';$('chatState').textContent=m.started?'آنلاین':'منتظر'}
    else if(m.type==='match_found'){online.room=m.room;online.color=m.color;online.started=true;$('roomCode').value=m.room;$('roomMessage').textContent='حریف پیدا شد؛ '+(m.color==='w'?'شما سفید هستید.':'شما سیاه هستید.');resetGame();if(m.color==='b')return}
    else if(m.type==='match_waiting'){$('roomMessage').textContent='⏳ در صف پیدا کردن حریف…'}
    else if(m.type==='remote_move'&&m.move){makeMove(m.move,true)}
    else if(m.type==='new_game'){resetGame()}
    else if(m.type==='chat'){addChat(m.name||'حریف',m.text,false)}
    else if(m.type==='opponent_left'){online.started=false;$('roomMessage').textContent='حریف از اتاق خارج شد.'}
    else if(m.type==='error')$('roomMessage').textContent=m.message||'خطا';
  });
  return ws;
}
window.connectOnline=connectOnline;window.sendOnline=sendOnline;
const serverInput=document.getElementById('serverUrlInput');
const savedServer=localStorage.getItem('tomtom_server_url');if(serverInput&&savedServer)serverInput.value=savedServer;
const saveServerBtn=document.getElementById('saveServerUrl');if(saveServerBtn)saveServerBtn.addEventListener('click',()=>{const v=serverInput.value.trim().replace(/\/$/,'');if(v){localStorage.setItem('tomtom_server_url',v);document.getElementById('roomMessage').textContent='آدرس سرور ذخیره شد.'}});
const testServerBtn=document.getElementById('testServer');if(testServerBtn)testServerBtn.addEventListener('click',async()=>{try{const r=await fetch(serverBase()+'/health');const d=await r.json();document.getElementById('roomMessage').textContent=d.ok?'سرور سالم و در دسترس است.':'سرور پاسخ نامعتبر داد.'}catch(e){document.getElementById('roomMessage').textContent='اتصال به سرور برقرار نشد.'}});
const closeOnlineBtn=document.getElementById('closeOnline');if(closeOnlineBtn)closeOnlineBtn.addEventListener('click',closeCurrentPanel);
const hostRoomBtn=document.getElementById('hostRoom');if(hostRoomBtn)hostRoomBtn.addEventListener('click',()=>{const ws=connectOnline();const send=()=>sendOnline({type:'create_room',room:document.getElementById('roomCode').value.trim(),name:profile.name,username:localStorage.getItem('tomtom_username')||''});if(ws?.readyState===WebSocket.OPEN)send();else ws?.addEventListener('open',send,{once:true})});
const joinRoomBtn=document.getElementById('joinRoom');if(joinRoomBtn)joinRoomBtn.addEventListener('click',()=>{const ws=connectOnline();const send=()=>sendOnline({type:'join_room',room:document.getElementById('roomCode').value.trim(),name:profile.name,username:localStorage.getItem('tomtom_username')||''});if(ws?.readyState===WebSocket.OPEN)send();else ws?.addEventListener('open',send,{once:true})});
const copyRoomBtn=document.getElementById('copyRoom');if(copyRoomBtn)copyRoomBtn.addEventListener('click',()=>navigator.clipboard?.writeText(document.getElementById('roomCode').value).then(()=>document.getElementById('roomMessage').textContent='کد اتاق کپی شد.').catch(()=>{}));

// ===== HOME SCREEN =====
const offlineBtn=document.getElementById('offlineBtn');
const homeOnlineBtn=document.getElementById('homeOnlineBtn');
const homeProfileBtn=document.getElementById('homeProfileBtn');
const homeRankBtn=document.getElementById('homeRankBtn');
const homeSettingsBtn=document.getElementById('homeSettingsBtn');
const homeSettingsTile=document.getElementById('homeSettingsTile');
const backHomeBtn=document.getElementById('backHomeBtn');

const offlineModeModal=document.getElementById('offlineModeModal');
function closeOfflineMode(){if(offlineModeModal){offlineModeModal.classList.remove('show');offlineModeModal.setAttribute('aria-hidden','true');document.body.classList.remove('offline-modal-open');}}
function openOfflineMode(){if(offlineModeModal){document.body.classList.add('offline-modal-open');offlineModeModal.classList.add('show');offlineModeModal.setAttribute('aria-hidden','false');}}
function startOfflineMode(mode){
  closeOfflineMode();
  if(modeEl) modeEl.value=mode;
  enterGameNav();
  setTimeout(()=>resetGame(),0);
}
function enterOffline(){ openOfflineMode(); }
if(offlineBtn) offlineBtn.addEventListener('click',enterOffline);
const localTwoPlayerBtn=document.getElementById('localTwoPlayerBtn');
const aiMatchBtn=document.getElementById('aiMatchBtn');
const cancelOfflineMode=document.getElementById('cancelOfflineMode');
if(localTwoPlayerBtn)localTwoPlayerBtn.addEventListener('click',()=>startOfflineMode('human'));
if(aiMatchBtn)aiMatchBtn.addEventListener('click',()=>startOfflineMode('computer'));
if(cancelOfflineMode)cancelOfflineMode.addEventListener('click',closeOfflineMode);
if(backHomeBtn) backHomeBtn.addEventListener('click',()=>{ closeOfflineMode(); hideModal(); hidePause(); closeAllPanels(); goHomeFromGame(); });
if(homeOnlineBtn) homeOnlineBtn.addEventListener('click',()=>openHomePanelNav(onlinePanel));
if(homeProfileBtn) homeProfileBtn.addEventListener('click',()=>openHomePanelNav(profilePanel));
if(homeRankBtn) homeRankBtn.addEventListener('click',()=>openHomePanelNav(rankPanel));
if(homeSettingsBtn) homeSettingsBtn.addEventListener('click',()=>openHomePanelNav(settingsPanel));
if(homeSettingsTile) homeSettingsTile.addEventListener('click',()=>openHomePanelNav(settingsPanel));

function syncOrientationClass(){
  const landscape=window.matchMedia('(orientation: landscape)').matches;
  document.body.classList.toggle('is-landscape',landscape);
  document.body.classList.toggle('is-portrait',!landscape);
}
syncOrientationClass();
window.addEventListener('resize',syncOrientationClass,{passive:true});
window.addEventListener('orientationchange',()=>setTimeout(syncOrientationClass,80),{passive:true});

// Start
blackLabel.textContent='PLAYER 2';
loadProfile();
saveProfileData();
if (homeRatingEl) homeRatingEl.textContent=profile.rating;
if(!window.history.state || !window.history.state.tomtom){ window.history.replaceState({tomtom:'home'},'',location.href); }
showHome();
finishSplash();
