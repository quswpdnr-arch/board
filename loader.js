// 오더·입고 보드 (틸아이다이 · 노운베러 · 프리버) — Firebase 연결부
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

let me = null, isAdmin = false, started = false, memberName = '';

// ---------- 화면 ----------
function loginScreen(msg){
  show('<span class="logo lg-jk glogo"></span><h1>오더·입고 보드</h1><p>틸아이다이 · 노운베러 · 프리버</p><p>회사에서 쓰는 Google 계정으로 로그인하세요.</p>'+
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
  show('<span class="logo lg-jk glogo"></span><h1>아직 팀원으로 등록되지 않았어요</h1><p>관리자에게 아래 이메일을 알려주고 팀원 등록을 요청하세요.</p><p class="gmail">'+esc(email)+'</p>'+
    '<div class="grow"><button class="gbtn ghost" id="gRetry">등록됐어요, 다시 확인</button><button class="gbtn ghost" id="gOut">다른 계정으로 로그인</button></div>');
  document.getElementById('gRetry').onclick = () => location.reload();
  document.getElementById('gOut').onclick = () => signOut(auth);
}
function loadingScreen(t){ show('<span class="logo lg-jk glogo"></span><p class="gload">'+esc(t||'불러오는 중…')+'</p>'); }

// ---------- 로그인 상태 ----------
onAuthStateChanged(auth, async user => {
  if(!user){ if(started){ location.reload(); return; } loginScreen(); return; }
  if(started) return;
  me = user;
  const email = String(user.email || '').toLowerCase();
  isAdmin = ADMINS.includes(email);
  loadingScreen('불러오는 중…');
  // 팀원 확인과 시트 데이터 확인을 동시에 (기다리는 시간 단축)
  const memberP = getDoc(doc(fs, 'members', email)).then(md => { if(md.exists()){ memberName = (md.data() || {}).name || ''; return true; } return false; }).catch(() => false);
  const snapP = loadSnap().then(t => ({t}), e => ({e}));
  let ok = (await memberP) || isAdmin;
  if(!ok){ deniedScreen(email); return; }
  // 이름 기록은 바뀌었을 때만, 기다리지 않고
  const nm = memberName || user.displayName || email.split('@')[0];
  try{ if(localStorage.getItem('kb_user_'+user.uid) !== nm){ setDoc(doc(fs, 'users', user.uid), { name: nm, email, at: new Date().toISOString() }).then(()=>{ try{ localStorage.setItem('kb_user_'+user.uid, nm); }catch(e){} }).catch(()=>{}); } }catch(e){}
  let snapText = '';
  try{ const r = await snapP; if(r.e) throw r.e; snapText = r.t; }
  catch(e){ show('<h1>데이터를 불러오지 못했어요</h1><p class="gerr">'+esc(e.code||e.message)+'</p><p>Firestore 규칙(설명서 4단계)이 제대로 게시됐는지 확인해 주세요.</p><button class="gbtn ghost" onclick="location.reload()">다시 시도</button>'); return; }
  if(!snapText){ isAdmin ? setupScreen() : show('<span class="logo lg-jk glogo"></span><h1>아직 데이터가 없어요</h1><p>관리자가 처음 데이터를 올린 뒤에 열 수 있습니다.</p>'); return; }
  start(snapText);
});

// ---------- 시트 스냅샷 (여러 조각으로 저장, 브라우저에 보관해서 다시 읽지 않음) ----------
// 브랜드: kb = 기존 위치(meta/snap, snap/p0…), 다른 브랜드 = meta/snap_frv, snap/frv_p0…
const BRANDS = ['all','tid','kb','frv'];
let BRAND = 'kb'; try{ BRAND = localStorage.getItem('kb_brand') || 'kb'; }catch(e){}
if(!BRANDS.includes(BRAND)) BRAND = 'kb';
const metaId = b => b === 'kb' ? 'snap' : 'snap_'+b;
const partId = (b, i) => (b === 'kb' ? 'p' : b+'_p') + i;
async function loadSnap(){
  const metas = {};
  await Promise.all(['kb','tid','frv'].map(async b => { try{ const m = await getDoc(doc(fs, 'meta', metaId(b))); if(m.exists()) metas[b] = m.data(); }catch(e){} }));
  const sums = {}; for(const [b, m] of Object.entries(metas)) sums[b] = m.sum || {asof:'', prods:0, open:[]};
  window.__BRAND_SUMS = sums;
  let use = (BRAND === 'all' || !metas[BRAND]) ? 'kb' : BRAND;
  if(!metas[use]) use = Object.keys(metas)[0];
  window.__BRAND = BRAND;
  if(!use) return '';
  const meta = metas[use];
  const key = 'kb_snap_'+use+'_'+meta.at;
  try{ const c = localStorage.getItem(key); if(c) return c; }catch(e){}
  const parts = await Promise.all(Array.from({length: meta.parts}, (_, i) => getDoc(doc(fs, 'snap', partId(use, i))).then(d => d.exists() ? d.data().t : '')));
  const text = parts.join('');
  try{ for(const k of Object.keys(localStorage)) if(k.startsWith('kb_snap_'+use+'_') || /^kb_snap_\d/.test(k)) localStorage.removeItem(k); localStorage.setItem(key, text); }catch(e){}
  return text;
}

// ---------- 처음 설정: 백업 파일 올리기 (관리자) ----------
function setupScreen(){
  show('<span class="logo lg-jk glogo"></span><h1>처음 설정</h1><p>기존 보드(claude.ai)의 <b>등록·입고처리 › 변경 이력 › 전체 데이터 백업 내려받기</b>로 받은 파일을 올려주세요.</p>'+
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
  await saveSnap(JSON.stringify(b.snap), prog, b.brand || b.snap.brand || 'kb', b.snap.sum);
}
async function saveSnap(text, prog, brand, sum){
  brand = brand || 'kb';
  const SIZE = 200000; const n = Math.ceil(text.length / SIZE);
  for(let i = 0; i < n; i++){ await setDoc(doc(fs, 'snap', partId(brand, i)), { t: text.slice(i*SIZE, (i+1)*SIZE) }); prog && prog('시트 데이터 올리는 중… '+(i+1)+' / '+n); }
  await setDoc(doc(fs, 'meta', metaId(brand)), { parts: n, at: new Date().toISOString(), by: me ? me.email : '', sum: sum || null });
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
  me: async () => ({ id: me.uid, name: memberName || me.displayName || me.email, email: String(me.email || '').toLowerCase() }),
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
  acct.innerHTML = '<span>'+esc(memberName || me.displayName || me.email)+(isAdmin ? ' · 관리자' : '')+'</span><button class="btn sm ghost" id="aOut">로그아웃</button>';
  document.getElementById('aOut').onclick = () => signOut(auth);
}

// ---------- 관리자: 시트 데이터 교체 (팀원 · 권한 화면에서 사용) ----------
window.__boardAdmin = {
  replaceSnap: async (file, prog) => {
    if(!isAdmin) throw new Error('관리자만 할 수 있습니다');
    const b = JSON.parse(await file.text());
    if(!b || b.kind !== 'knownbetter-board-backup' || !b.snap) throw new Error('보드 데이터 파일이 아닙니다');
    const br = b.brand || b.snap.brand || 'kb';
    if(!['kb','tid','frv'].includes(br)) throw new Error('브랜드를 알 수 없는 파일입니다');
    await saveSnap(JSON.stringify(b.snap), prog, br, b.snap.sum);
    return br;
  }
};
