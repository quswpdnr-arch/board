// ▼ Firebase '구성(Config)'에서 복사한 내용(const firebaseConfig = { ... };)을 아래 빈 줄에 통째로 붙여넣으세요 ▼
const firebaseConfig = {
  apiKey: "AIzaSyDZkcExe-g_h-YMZafU2_zco3HJ2T5xNSA",
  authDomain: "knownbetter-board.firebaseapp.com",
  projectId: "knownbetter-board",
  storageBucket: "knownbetter-board.firebasestorage.app",
  messagingSenderId: "954732735205",
  appId: "1:954732735205:web:ba82122fe4fc7e7cd1020c"
};
// ▲ 여기까지 ▲
window.FIREBASE_CONFIG = (typeof firebaseConfig !== 'undefined') ? firebaseConfig : {};
// 관리자 Google 이메일 (팀원 관리 · 처음 데이터 올리기를 할 수 있는 사람)
window.BOARD_ADMINS = ["quswpdnr@gmail.com"];
