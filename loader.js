// 노운베러 오더·입고 보드 — Firebase 연결부
// 로그인 → 팀원 확인 → 시트 데이터 불러오기 → 보드 실행
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithCredential, onAuthStateChanged, signOut, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  collection, doc, query, orderBy, limit, onSnapshot, setDoc, addDoc, getDoc, deleteDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const CFG = window.FIREBASE_CONFIG || {};
const ADMINS = (window.BOARD_ADMINS || []).map(e => String(e).trim().toLowerCase());
const gate = document.getElementById('gate');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function show(html){ gate.hidden = false; gate.querySelector('.gcard').innerHTML = html; }

if(!CFG.apiKey || /여기에/.test(CFG.apiKey)){
  show('<h1>설정이 아직 안 됐어요</h1><p><b>firebase-config.js</b> 파일에 Firebase 설정값을 붙여넣어 주세요.<br>설명서의 6단계를 보면 됩니다.</p>');
  throw new Error('firebase-config.js 미설정');
}

const app = initializeApp(CFG);
const auth = getAuth(app);
let fs;
try{
  fs = initializeFirestore(app, { ignoreUndefinedProperties: true, localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
}catch(e){ fs = initializeFirestore(app, { ignoreUndefinedProperties: true }); }
if(window.__EMU){ connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); connectFirestoreEmulator(fs, '127.0.0.1', 8080); }

let me = null, isAdmin = false, started = false;

// ---------- 화면 ----------
function loginScreen(msg){
  show('<span class="logo glogo"></span><h1>노운베러 오더·입고 보드</h1><p>회사에서 쓰는 Google 계정으로 로그인하세요.</p>'+
    (msg ? '<p class="gerr">'+esc(msg)+'</p>' : '')+
    '<button class="gbtn" id="gLogin">Google 계정으로 로그인</button>');
  document.getElementById('gLogin').onclick = async () => {
    try{
      if(window.__EMU && window.__EMU.email){ await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({sub:'u-'+window.__EMU.email.replace(/\W/g,''), email:window.__EMU.email, email_verified:true, name:window.__EMU.name||'테스트'}))); }
      else { const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' }); await signInWithPopup(auth, p); }
    }catch(e){ if(e && e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') loginScreen('로그인하지 못했습니다: '+(e.code||e.message)); }
  };
}
function deniedScreen(email){
  show('<span class="logo glogo"></span><h1>아직 팀원으로 등록되지 않았어요</h1><p>관리자에게 아래 이메일을 알려주고 팀원 등록을 요청하세요.</p><p class="gmail">'+esc(email)+'</p>'+
    '<div class="grow"><button class="gbtn ghost" id="gRetry">등록됐어요, 다시 확인</button><button class="gbtn ghost" id="gOut">다른 계정으로 로그인</button></div>');
  document.getElementById('gRetry').onclick = () => location.reload();
  document.getElementById('gOut').onclick = () => signOut(auth);
}
function loadingScreen(t){ show('<span class="logo glogo"></span><p class="gload">'+esc(t||'불러오는 중…')+'</p>'); }

// ---------- 로그인 상태 ----------
onAuthStateChanged(auth, async user => {
  if(!user){ if(started){ location.reload(); return; } loginScreen(); return; }
  if(started) return;
  me = user;
  const email = String(user.email || '').toLowerCase();
  isAdmin = ADMINS.includes(email);
  loadingScreen('팀원 확인 중…');
  let ok = isAdmin;
  if(!ok){
    try{ ok = (await getDoc(doc(fs, 'members', email))).exists(); }catch(e){ ok = false; }
  }
  if(!ok){ deniedScreen(email); return; }
  try{ await setDoc(doc(fs, 'users', user.uid), { name: user.displayName || email.split('@')[0], email, at: new Date().toISOString() }); }catch(e){}
  loadingScreen('시트 데이터 불러오는 중…');
  let snapText = '';
  try{ snapText = await loadSnap(); }
  catch(e){ show('<h1>데이터를 불러오지 못했어요</h1><p class="gerr">'+esc(e.code||e.message)+'</p><p>Firestore 규칙(설명서 4단계)이 제대로 게시됐는지 확인해 주세요.</p><button class="gbtn ghost" onclick="location.reload()">다시 시도</button>'); return; }
  if(!snapText){ isAdmin ? setupScreen() : show('<span class="logo glogo"></span><h1>아직 데이터가 없어요</h1><p>관리자가 처음 데이터를 올린 뒤에 열 수 있습니다.</p>'); return; }
  start(snapText);
});

// ---------- 시트 스냅샷 (여러 조각으로 저장, 브라우저에 보관해서 다시 읽지 않음) ----------
async function loadSnap(){
  const m = await getDoc(doc(fs, 'meta', 'snap'));
  if(!m.exists()) return '';
  const meta = m.data();
  const key = 'kb_snap_'+meta.at;
  try{ const c = localStorage.getItem(key); if(c) return c; }catch(e){}
  const parts = [];
  for(let i = 0; i < meta.parts; i++){ const d = await getDoc(doc(fs, 'snap', 'p'+i)); parts.push(d.exists() ? d.data().t : ''); }
  const text = parts.join('');
  try{ for(const k of Object.keys(localStorage)) if(k.startsWith('kb_snap_')) localStorage.removeItem(k); localStorage.setItem(key, text); }catch(e){}
  return text;
}

// ---------- 처음 설정: 백업 파일 올리기 (관리자) ----------
function setupScreen(){
  show('<span class="logo glogo"></span><h1>처음 설정</h1><p>기존 보드(claude.ai)의 <b>등록·입고처리 › 변경 이력 › 전체 데이터 백업 내려받기</b>로 받은 파일을 올려주세요.</p>'+
    '<label class="gbtn" for="gFile">백업 파일 선택 (knownbetter-backup-….json)</label><input type="file" id="gFile" accept=".json" hidden><p class="gload" id="gProg"></p>');
  document.getElementById('gFile').onchange = async ev => {
    const f = ev.target.files && ev.target.files[0]; if(!f) return;
    const prog = t => { document.getElementById('gProg').textContent = t; };
    try{
      const b = JSON.parse(await f.text());
      if(!b || b.kind !== 'knownbetter-board-backup' || !b.snap) throw new Error('노운베러 보드 백업 파일이 아닙니다');
      await importBackup(b, prog);
      prog('완료! 보드를 엽니다…'); setTimeout(() => location.reload(), 800);
    }catch(e){ prog('실패: '+(e.code||e.message)); }
  };
}
async function importBackup(b, prog){
  const writes = [];
  for(const [col, docs] of Object.entries(b.db || {})) for(const [id, data] of Object.entries(docs || {})) if(id && data && typeof data === 'object') writes.push([col, id, data]);
  let done = 0;
  for(let i = 0; i < writes.length; i += 300){
    const batch = writeBatch(fs);
    for(const [col, id, data] of writes.slice(i, i+300)) batch.set(doc(fs, col, id), data);
    await batch.commit(); done += Math.min(300, writes.length - i);
    prog('팀 공유 기록 올리는 중… '+done+' / '+writes.length);
  }
  await saveSnap(JSON.stringify(b.snap), prog);
}
async function saveSnap(text, prog){
  const SIZE = 200000; const n = Math.ceil(text.length / SIZE);
  for(let i = 0; i < n; i++){ await setDoc(doc(fs, 'snap', 'p'+i), { t: text.slice(i*SIZE, (i+1)*SIZE) }); prog && prog('시트 데이터 올리는 중… '+(i+1)+' / '+n); }
  await setDoc(doc(fs, 'meta', 'snap'), { parts: n, at: new Date().toISOString(), by: me ? me.email : '' });
}

// ---------- 보드가 쓰는 저장소 연결 (claude.ai 보드와 같은 모양으로 맞춤) ----------
const wrapDocs = s => ({ docs: s.docs.map(d => ({ id: d.id, data: () => d.data() })) });
function colRef(path, cons){
  return {
    orderBy: (f, dir) => colRef(path, cons.concat(orderBy(f, dir || 'asc'))),
    limit: n => colRef(path, cons.concat(limit(n))),
    onSnapshot: (cb, err) => onSnapshot(cons.length ? query(collection(fs, path), ...cons) : collection(fs, path), s => cb(wrapDocs(s)), err),
    add: async data => { const r = await addDoc(collection(fs, path), data); return { id: r.id }; },
    doc: id => docRef(path+'/'+id)
  };
}
function docRef(path){
  return {
    get: async () => { const d = await getDoc(doc(fs, path)); return { exists: d.exists(), data: () => d.data() }; },
    set: data => setDoc(doc(fs, path), data),
    delete: () => deleteDoc(doc(fs, path)),
    onSnapshot: (cb, err) => onSnapshot(doc(fs, path), d => cb({ exists: d.exists(), data: () => d.data() }), err)
  };
}
const dbShim = { collection: path => colRef(path, []), doc: path => docRef(path) };
let userNames = null;
function watchUsers(){
  if(userNames) return; userNames = {};
  onSnapshot(collection(fs, 'users'), s => { s.docs.forEach(d => { userNames[d.id] = d.data().name || ''; }); }, () => {});
}
const userShim = {
  id: async () => me.uid,
  me: async () => ({ id: me.uid, name: me.displayName || me.email }),
  isOwner: () => isAdmin, canEdit: () => true, can: () => true,
  profiles: async ids => {
    watchUsers();
    const out = {};
    for(const id of ids){
      if(!(id in userNames)){ try{ const d = await getDoc(doc(fs, 'users', id)); userNames[id] = d.exists() ? (d.data().name || '') : ''; }catch(e){ userNames[id] = ''; } }
      out[id] = { name: userNames[id] || '' };
    }
    return out;
  }
};
const dlShim = {
  save: async ({ filename, data }) => {
    const blob = data instanceof Blob ? data : new Blob([data], { type: /\.json$/.test(filename) ? 'application/json' : 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
};

// ---------- 보드 실행 ----------
function start(snapText){
  started = true;
  document.getElementById('snap').textContent = snapText;
  window.claude = { use: async n => n === 'db' ? dbShim : n === 'user' ? userShim : n === 'downloads' ? dlShim : null };
  const sc = document.createElement('script'); sc.textContent = document.getElementById('app-src').textContent; document.body.appendChild(sc);
  gate.hidden = true;
  const acct = document.getElementById('acct');
  acct.innerHTML = '<span>'+esc(me.displayName || me.email)+'</span>'+(isAdmin ? '<button class="btn sm" id="aMembers">팀원 관리</button>' : '')+'<button class="btn sm ghost" id="aOut">로그아웃</button>';
  document.getElementById('aOut').onclick = () => signOut(auth);
  if(isAdmin) document.getElementById('aMembers').onclick = membersPanel;
}

// ---------- 팀원 관리 (관리자) ----------
let unMembers = null;
function membersPanel(){
  const box = document.getElementById('members');
  box.hidden = false;
  box.innerHTML = '<div class="mcard"><div class="mh"><h2>팀원 관리</h2><button class="btn sm" id="mClose">닫기</button></div>'+
    '<p class="note">여기 등록된 Google 계정만 보드를 열 수 있어요. 퇴사자는 삭제하면 바로 못 들어옵니다.</p>'+
    '<div class="filters"><input id="mEmail" type="email" placeholder="팀원 Google 이메일 (예: hong@gmail.com)"><input id="mName" placeholder="이름 (선택)" style="max-width:140px"><button class="btn pri" id="mAdd">추가</button></div>'+
    '<div class="mlist" id="mList">불러오는 중…</div>'+'</div>';
  document.getElementById('mClose').onclick = () => { box.hidden = true; if(unMembers){ unMembers(); unMembers = null; } };
  document.getElementById('mAdd').onclick = async () => {
    const e = document.getElementById('mEmail').value.trim().toLowerCase(); const nm = document.getElementById('mName').value.trim();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)){ alertBox('이메일 형식을 확인해 주세요'); return; }
    try{ await setDoc(doc(fs, 'members', e), { email: e, name: nm, at: new Date().toISOString(), by: me.email }); document.getElementById('mEmail').value = ''; document.getElementById('mName').value = ''; }
    catch(err){ alertBox('추가하지 못했습니다: '+(err.code||err.message)); }
  };
  if(unMembers) unMembers();
  unMembers = onSnapshot(collection(fs, 'members'), s => {
    const rows = s.docs.map(d => d.data()).sort((a,b) => (a.name||a.email).localeCompare(b.name||b.email, 'ko'));
    const list = document.getElementById('mList'); if(!list) return;
    list.innerHTML = '<div class="mrow"><span><b>'+esc(ADMINS.join(', '))+'</b></span><span class="note">관리자</span><span></span></div>'+
      (rows.length ? rows.map(r => '<div class="mrow"><span>'+esc(r.email)+'</span><span>'+esc(r.name||'')+'</span><button class="btn sm ghost" data-del="'+esc(r.email)+'">삭제</button></div>').join('') : '<div class="note" style="padding:10px 0">아직 등록된 팀원이 없어요.</div>');
    list.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if(!confirmBox(b.dataset.del+' 님을 팀원에서 삭제할까요?')) return;
      try{ await deleteDoc(doc(fs, 'members', b.dataset.del)); }catch(err){ alertBox('삭제하지 못했습니다: '+(err.code||err.message)); }
    });
  }, err => { const list = document.getElementById('mList'); if(list) list.textContent = '불러오지 못했습니다: '+(err.code||err.message); });
}
function alertBox(t){ const p = document.getElementById('mProg'); if(p) p.textContent = t; }
function confirmBox(t){ return window.__EMU ? true : window.confirm(t); }
