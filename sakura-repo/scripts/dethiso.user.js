// ==UserScript==
// @name         DeThiSo Helper
// @namespace    https://dethiso.vn/
// @version      12.0
// @description  Sakura Edition (điện thoại + máy tính): học đáp án đúng sau mỗi lần Kiểm tra, xuất/nhập .txt, tự chọn - kiểm tra - chuyển câu với tốc độ chỉnh được
// @match        https://dethiso.vn/*
// @match        https://*.dethiso.vn/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// DeThiSo Helper v12 - chạy trên cả điện thoại lẫn máy tính, giao diện mới, sửa lỗi.
(function () {
  'use strict';
  if (window.__dts11) return;
  window.__dts11 = true;

  const BANK_KEY = 'dts10-bank';   // giữ khoá cũ để không mất sổ đã học
  const CFG_KEY = 'dts11-cfg';
  const SEP = ' ||| ';
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const flat = s => String(s || '').replace(/\s+/g, ' ').trim();
  const norm2 = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const stripNo = s => String(s || '').replace(/^\s*Câu\s*\d+\s*\/\s*\d+\s*/i, '');
  const loadKey = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const now = () => Date.now();

  // ---------- Sổ đáp án ----------
  let idx2 = null; // chỉ mục dự phòng (bỏ dấu câu/khoảng trắng) để đỡ "miss" vì khác định dạng
  let bank = loadKey(BANK_KEY) || {};
  const saveBank = () => { idx2 = null; try { localStorage.setItem(BANK_KEY, JSON.stringify(bank)); } catch (e) {} };
  // Nhập MỘT LẦN từ sổ cũ v9 / v8.1 rồi xoá khoá cũ
  function legacyKeys() {
    const ks = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (/^(dts9-bank:|dts81-log:)/.test(k)) ks.push(k);
      }
    } catch (e) {}
    return ks;
  }
  try {
    const ks = legacyKeys();
    ks.forEach(k => {
      const v = loadKey(k);
      if (k.startsWith('dts9-bank:') && v && typeof v === 'object') {
        Object.keys(v).forEach(x => { if (!bank[x]) bank[x] = v[x]; });
      } else if (Array.isArray(v)) {
        v.forEach(r => {
          if (r && r.q && r.q !== '?' && r.correct && r.correct !== '?' && !bank[norm(r.q)])
            bank[norm(r.q)] = { q: flat(r.q), correct: flat(r.correct.replace(/^[A-D]\.\s*/, '')) };
        });
      }
    });
    if (ks.length) { saveBank(); ks.forEach(k => localStorage.removeItem(k)); }
  } catch (e) {}

  // ---------- Cấu hình (lưu lại) ----------
  const cfg = Object.assign({ run: true, sel: true, chk: true, next: true, delay: 300, unk: 'wait', min: null, x: null, y: null }, loadKey(CFG_KEY) || {});
  delete cfg.code;                       // không nhớ mã đề giữa các link
  const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {} };
  let manualCode = '';                   // mã gõ tay: chỉ sống trong 1 link
  let ghNote = '';                       // ghi chú GitHub hiện cạnh trạng thái
  let holdUntil = 0;                     // giữ thông báo thao tác của người dùng vài giây

  // ---------- Mã đề (từ link) ----------
  function extractCode(v) {
    v = String(v || '').trim();
    if (!v) return '';
    const clean = s => s.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    let path = v;
    try { path = new URL(v).pathname; } catch (e) {}
    const segs = path.split('/').map(s => s.trim()).filter(Boolean);
    if (segs.length > 1 || /^https?:/i.test(v)) {
      const skip = /^(vi|en|test|take|take-test|answer-test|exam|result|submit-test|do|view|de-thi|share)$/i;
      const cand = segs.filter(s => !skip.test(s) && !/^\d+$/.test(s));
      if (cand.length) return clean(cand[0]);
      return segs.find(s => /^\d{5,}$/.test(s)) || '';
    }
    return clean(v);
  }
  const isExam = () => /\/exam\//i.test(location.pathname);
  const autoCode = () => isExam() ? extractCode(location.href) : '';
  const examCode = () => extractCode(manualCode) || autoCode();
  // Chỉ lọc theo mã đề khi sổ đã có câu gắn đúng mã đề này (câu chưa gắn mã vẫn dùng được).
  // Nếu mã đề nhận sai / sổ chưa gắn mã nào thì dùng cả sổ, tránh "có đáp án mà không chọn".
  const STRICT_EXAM = true;
  const strictCode = () => {
    const c = examCode();
    return STRICT_EXAM && c && Object.values(bank).some(r => r && r.t === c) ? c : '';
  };
  const usableWith = (r, sc) => !!(r && r.q && r.correct && (!sc || !r.t || r.t === sc));
  const usableRecs = () => { const sc = strictCode(); return Object.values(bank).filter(r => usableWith(r, sc)); };

  function findRec(q) {
    const sc = strictCode();
    const r = bank[norm(q)];
    if (r && usableWith(r, sc)) return r;
    if (!idx2) { idx2 = {}; Object.values(bank).forEach(v => { if (v && v.q) idx2[norm2(stripNo(v.q))] = v; }); }
    const v = idx2[norm2(stripNo(q))];
    return v && usableWith(v, sc) ? v : null;
  }
  function matchLetter(texts, correct) {
    const L = Object.keys(texts);
    return L.find(k => norm(texts[k]) === norm(correct)) || L.find(k => norm2(texts[k]) === norm2(correct)) || null;
  }

  // ---------- Trạng thái tự động ----------
  let lastSnap = null;          // snapshot gần nhất lúc câu CHƯA kiểm tra
  let st = { key: null };       // thao tác của câu hiện tại (chọn / kiểm tra)
  let stN = { sig: null };      // thao tác bấm "Tiếp" của câu đã kiểm tra
  let lastAct = 0;
  const gapOk = () => now() - lastAct >= cfg.delay;
  const chkRetry = () => Math.max(3000, cfg.delay * 5);
  const nextRetry = () => Math.max(2500, cfg.delay * 4);

  // ---------- Giao diện (dùng được cho cả điện thoại lẫn máy tính) ----------
  const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const COARSE = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  if (typeof cfg.min !== 'boolean') cfg.min = innerWidth <= 640;   // điện thoại: mặc định thu gọn thành nút tròn
  if (typeof cfg.x !== 'number' || typeof cfg.y !== 'number') { cfg.x = null; cfg.y = null; }

  const css = document.createElement('style');
  css.textContent = `#dts11{--pk:#ff7eb6;--pk2:#e0559b;--vi:#a78bfa;--sk:#7dc4ff;--tx:#3d2f52;--tx2:#7a6a94;--bg:rgba(255,255,255,.92);--card:rgba(255,255,255,.7);--line:rgba(255,150,200,.38);--inp:#fff;
  position:fixed;top:72px;right:max(12px,env(safe-area-inset-right,0px));width:min(340px,calc(100vw - 16px));
  max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px);display:flex;flex-direction:column;z-index:2147483647;
  font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--tx);border-radius:22px;overflow:hidden;border:2px solid transparent;
  background:linear-gradient(var(--bg),var(--bg)) padding-box,linear-gradient(135deg,#ff8fc2,#c19bff,#86cfff) border-box;
  -webkit-backdrop-filter:blur(16px) saturate(1.4);backdrop-filter:blur(16px) saturate(1.4);
  box-shadow:0 14px 40px rgba(150,80,160,.35),0 2px 8px rgba(0,0,0,.12);
  -webkit-text-size-adjust:100%;touch-action:manipulation;text-align:left;letter-spacing:normal;
  animation:dts11-in .45s cubic-bezier(.2,1.4,.4,1) both}
@media (prefers-color-scheme:dark){#dts11{--tx:#f3ebfb;--tx2:#bcaed4;--bg:rgba(34,27,50,.93);--card:rgba(255,255,255,.07);--line:rgba(255,150,200,.28);--inp:#2b2342}}
#dts11 *{box-sizing:border-box}
#dts11 button{font:inherit;cursor:pointer;border:0;position:relative;overflow:hidden;-webkit-tap-highlight-color:transparent;margin:0}
#dts11 input,#dts11 select{font:inherit;color:var(--tx);margin:0}

/* header */
#dts11-head{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;color:#fff;cursor:grab;
  user-select:none;-webkit-user-select:none;touch-action:none;flex:none;
  background:linear-gradient(120deg,#ff7fb8,#c19bff 55%,#7fc8ff,#ff7fb8);background-size:240% 100%}
#dts11.running #dts11-head{animation:dts11-flow 9s linear infinite}
#dts11-head::after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;background:repeating-linear-gradient(90deg,rgba(255,255,255,.85) 0 7px,transparent 7px 14px);opacity:.35}
#dts11.running #dts11-head::after{opacity:.9}
@media (pointer:fine){#dts11.running #dts11-head::after{animation:dts11-march .8s linear infinite}}
.dts11-logo{position:relative;z-index:1;display:flex;align-items:center;gap:9px;min-width:0}
.dts11-title{font-weight:800;font-size:14px;letter-spacing:.3px;text-shadow:0 1px 5px rgba(150,40,120,.55);white-space:nowrap}
.dts11-sub{display:flex;align-items:center;gap:5px;font-size:10px;letter-spacing:.7px;opacity:.95;white-space:nowrap}
.dts11-dot{width:7px;height:7px;border-radius:50%;background:#ffe27a;box-shadow:0 0 0 2px rgba(255,255,255,.35)}
#dts11.running .dts11-dot{background:#7dffb0;animation:dts11-dotp 1.6s ease-in-out infinite}
.dts11-hbtns{position:relative;z-index:1;display:flex;gap:6px;align-items:center;flex:none}
.dts11-mascot{position:relative;width:38px;height:38px;flex:none;border-radius:50%;background:rgba(255,255,255,.93);
  box-shadow:0 0 0 3px rgba(255,255,255,.35),0 3px 10px rgba(150,40,120,.4)}
.dts11-flower{position:absolute;inset:0;animation:dts11-spin 16s linear infinite}
.dts11-flower i{position:absolute;left:50%;top:50%;width:10px;height:14px;margin:-14px 0 0 -5px;transform-origin:50% 100%;
  border-radius:50% 50% 50% 50%/75% 75% 25% 25%;background:linear-gradient(180deg,#ffe0ee,#ff7fb8)}
.dts11-flower::after{content:"";position:absolute;left:50%;top:50%;width:7px;height:7px;margin:-3.5px;border-radius:50%;background:radial-gradient(circle,#fff6a8,#ffc55c)}
.dts11-badge{display:none;position:absolute;right:-7px;bottom:-5px;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:#fff;color:var(--pk2);
  font-weight:800;font-size:11px;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.28)}
.dts11-runbtn{padding:7px 13px;border-radius:999px;font-weight:800;font-size:12px;min-height:30px;transition:transform .15s}
.dts11-runbtn:active{transform:scale(.94)}
.dts11-runbtn.on{background:#fff;color:var(--pk2);box-shadow:0 2px 10px rgba(120,40,110,.3)}
.dts11-runbtn.off{background:#fff3a0;color:#a65a00;animation:dts11-pulse 1.4s ease-in-out infinite}
.dts11-minbtn{width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.35);color:#fff;font-size:17px;font-weight:800;line-height:1;padding:0}
.dts11-minbtn:active{background:rgba(255,255,255,.6)}

/* thu gọn thành nút tròn */
#dts11.min{width:58px;height:58px;max-height:none;border-radius:50%;cursor:pointer;touch-action:none}
#dts11.min #dts11-body,#dts11.min .dts11-hbtns,#dts11.min .dts11-ttl{display:none}
#dts11.min #dts11-head{padding:0;width:100%;height:100%;justify-content:center;border-radius:50%}
#dts11.min #dts11-head::after{display:none}
#dts11.min .dts11-mascot{width:40px;height:40px;animation:dts11-bob 2.8s ease-in-out infinite}
#dts11.min .dts11-badge{display:flex}

/* thân */
#dts11-body{position:relative;flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:12px;scrollbar-width:thin;scrollbar-color:#ffb3d4 transparent}
.dts11-fx{position:absolute;left:0;top:0;right:0;height:100%;pointer-events:none;overflow:hidden;z-index:0}
.dts11-fx .pt{position:absolute;top:-18px;border-radius:150% 0 150% 0;opacity:.7;animation:dts11-fall linear infinite;background:linear-gradient(135deg,#ffd0e5,#ff8fc2)}
.dts11-fx .sp{position:absolute;background:#fff;clip-path:polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%);animation:dts11-twinkle ease-in-out infinite;opacity:0}
.dts11-fx .sp.v{background:#d9c8ff}.dts11-fx .sp.b{background:#cdeaff}
.dts11-main{position:relative;z-index:1}

.dts11-stats{display:flex;gap:8px;margin-bottom:8px}
.dts11-stat{flex:1;min-width:0;padding:8px 11px;border-radius:14px;background:var(--card);border:1px solid var(--line)}
.dts11-stat small{display:block;color:var(--tx2);font-size:10px;letter-spacing:.6px;text-transform:uppercase;white-space:nowrap}
.dts11-stat b{display:inline-block;font-size:20px;line-height:1.15;color:var(--pk2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;vertical-align:bottom}
.dts11-stat b.sm{font-size:14px;line-height:1.7}
.dts11-stat b.bump{animation:dts11-bump .5s cubic-bezier(.3,1.8,.5,1)}
.dts11-stat span{color:var(--tx2);font-size:11px}
.dts11-bar{height:7px;margin:0 2px 10px;border-radius:999px;background:rgba(167,139,250,.2);overflow:hidden}
.dts11-bar i{display:block;height:100%;width:0;border-radius:999px;background:linear-gradient(90deg,#ff7fb8,#b69bff,#7fc8ff);transition:width .5s cubic-bezier(.3,1.4,.5,1)}

.dts11-bubble{display:flex;align-items:center;gap:9px;padding:9px 12px;margin-bottom:10px;border-radius:16px;background:var(--card);border:1.5px dashed #ffb3d4}
.dts11-bubble.pop{animation:dts11-pop .4s cubic-bezier(.3,1.7,.5,1)}
#dts11-face{font-weight:800;color:var(--pk2);white-space:nowrap;font-size:12.5px}
#dts11-st{color:var(--tx2);font-size:12px;word-break:break-word;min-width:0}

.dts11-sw{position:relative;display:flex;align-items:center;gap:11px;min-height:42px;padding:4px 6px;cursor:pointer;border-radius:12px;-webkit-tap-highlight-color:transparent}
@media (hover:hover){.dts11-sw:hover{background:rgba(255,160,205,.16)}}
.dts11-sw input{position:absolute;opacity:0;pointer-events:none}
.dts11-sw i{position:relative;flex:none;width:42px;height:24px;border-radius:999px;background:rgba(150,130,180,.4);transition:background .25s,box-shadow .25s}
.dts11-sw i::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(60,30,90,.4);transition:transform .3s cubic-bezier(.3,1.7,.5,1)}
.dts11-sw input:checked + i{background:linear-gradient(90deg,#ff7fb8,#b69bff);box-shadow:0 0 10px rgba(255,127,184,.55)}
.dts11-sw input:checked + i::after{transform:translateX(18px)}
.dts11-sw input:focus-visible + i{outline:2px solid #b69bff;outline-offset:2px}
.dts11-sw span{font-weight:600;min-width:0}

.dts11-box{margin:8px 0;padding:10px 12px;border-radius:14px;background:var(--card);border:1px solid var(--line);border-left:4px solid #ff8fc2}
.dts11-box small{color:var(--tx2)}
#dts11-ms{color:var(--pk2);font-size:14px}
#dts11-spd{-webkit-appearance:none;appearance:none;display:block;width:100%;height:10px;margin:12px 0 4px;border-radius:999px;outline:0;touch-action:pan-y;
  background:linear-gradient(90deg,#ff7fb8 var(--p,15%),rgba(167,139,250,.25) var(--p,15%))}
#dts11-spd::-webkit-slider-thumb{-webkit-appearance:none;width:26px;height:26px;border-radius:50%;border:3px solid #fff;background:radial-gradient(circle at 35% 35%,#fff 0 16%,#ff6fb0 18%);box-shadow:0 2px 10px rgba(200,70,140,.6)}
#dts11-spd::-moz-range-thumb{width:20px;height:20px;border-radius:50%;border:3px solid #fff;background:#ff6fb0;box-shadow:0 2px 10px rgba(200,70,140,.6)}
.dts11-inp{display:block;width:100%;margin-top:6px;padding:9px 12px;border-radius:12px;border:1.5px solid #ffc2dc;background:var(--inp);outline:0;min-height:40px}
.dts11-inp:focus{border-color:#b69bff;box-shadow:0 0 0 3px rgba(182,155,255,.25)}

.dts11-adv{margin:8px 0 0;border-radius:14px;background:var(--card);border:1px solid var(--line)}
.dts11-adv>summary{list-style:none;cursor:pointer;padding:11px 12px;font-weight:700;display:flex;justify-content:space-between;align-items:center;-webkit-tap-highlight-color:transparent}
.dts11-adv>summary::-webkit-details-marker{display:none}
.dts11-adv>summary::after{content:"▾";color:var(--tx2);transition:transform .2s}
.dts11-adv[open]>summary::after{transform:rotate(180deg)}
.dts11-advin{padding:0 10px 10px}

.dts11-acts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.dts11-act{min-height:40px;padding:8px 10px;border-radius:999px;font-weight:700;font-size:12px;color:#fff;
  background:linear-gradient(90deg,#ff7fb8,#b69bff);box-shadow:0 3px 10px rgba(180,90,170,.3);transition:transform .15s,box-shadow .15s}
@media (hover:hover){.dts11-act:hover{transform:translateY(-2px);box-shadow:0 7px 16px rgba(180,90,170,.4)}}
.dts11-act:active{transform:scale(.96)}
.dts11-act.alt{background:linear-gradient(90deg,#6fc4ff,#b69bff)}
.dts11-act.wide{grid-column:1/-1}
.dts11-act.danger{grid-column:1/-1;background:linear-gradient(90deg,#ff8fa3,#ffb0c8)}
.dts11-rip{position:absolute;border-radius:50%;background:rgba(255,255,255,.6);transform:scale(0);animation:dts11-rip .6s ease-out forwards;pointer-events:none}
.dts11-foot{text-align:center;margin-top:10px;font-size:10.5px;letter-spacing:1px;color:var(--tx2);opacity:.8}
.dts11-trail{position:absolute;width:9px;height:9px;margin:-4px;border-radius:150% 0 150% 0;pointer-events:none;z-index:5;animation:dts11-trail .8s ease-out forwards}

/* sổ đáp án */
#dts11-bookv{display:none;position:relative;z-index:1}
#dts11-list{margin:10px 0;max-height:min(300px,45vh);overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:7px;scrollbar-width:thin;scrollbar-color:#ffb3d4 transparent}
.dts11-item{position:relative;padding:8px 32px 8px 10px;border-radius:14px;background:var(--card);border:1px solid var(--line);border-left:4px solid #ff8fc2}
.dts11-item .q{font-weight:700;font-size:12px;word-break:break-word}
.dts11-item .a{margin-top:3px;color:var(--pk2);font-size:12px;word-break:break-word}
#dts11 .dts11-item .x{position:absolute;top:6px;right:6px;width:24px;height:24px;border-radius:50%;background:rgba(255,143,194,.25);color:var(--pk2);font-weight:800;font-size:14px;line-height:1;padding:0}
#dts11 .dts11-item .x:active{background:#ff8fc2;color:#fff}
.dts11-empty{text-align:center;color:var(--tx2);padding:14px 0}

@media (pointer:coarse){#dts11 input,#dts11 select{font-size:16px}#dts11 .dts11-act{min-height:44px;font-size:13px}}
@media (max-width:360px){.dts11-sub{display:none}}

@keyframes dts11-in{from{opacity:0;transform:translateY(-16px) scale(.9)}to{opacity:1;transform:none}}
@keyframes dts11-flow{from{background-position:0 0}to{background-position:240% 0}}
@keyframes dts11-march{from{background-position:0 0}to{background-position:14px 0}}
@keyframes dts11-bob{0%,100%{transform:translateY(0) rotate(-5deg)}50%{transform:translateY(-3px) rotate(5deg)}}
@keyframes dts11-spin{to{transform:rotate(360deg)}}
@keyframes dts11-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,243,160,.95)}50%{box-shadow:0 0 0 8px rgba(255,243,160,0)}}
@keyframes dts11-dotp{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes dts11-fall{0%{transform:translate(0,0) rotate(0)}25%{transform:translate(16px,120px) rotate(120deg)}50%{transform:translate(-10px,240px) rotate(240deg)}75%{transform:translate(14px,360px) rotate(360deg)}100%{transform:translate(-6px,520px) rotate(480deg)}}
@keyframes dts11-twinkle{0%,100%{opacity:0;transform:scale(.2) rotate(0)}50%{opacity:.9;transform:scale(1) rotate(90deg)}}
@keyframes dts11-bump{0%{transform:scale(1)}40%{transform:scale(1.5) rotate(-5deg)}100%{transform:scale(1)}}
@keyframes dts11-pop{0%{transform:scale(.95)}60%{transform:scale(1.03)}100%{transform:scale(1)}}
@keyframes dts11-rip{to{transform:scale(1);opacity:0}}
@keyframes dts11-trail{0%{opacity:.95;transform:translate(0,0) rotate(0) scale(1)}100%{opacity:0;transform:translate(var(--dx),var(--dy)) rotate(var(--r)) scale(.3)}}
@media (prefers-reduced-motion:reduce){#dts11,#dts11 *{animation:none!important;transition:none!important}}
`;
  (document.head || document.documentElement).appendChild(css);

  const rnd = (a, b) => a + Math.random() * (b - a);
  // cánh hoa rơi chỉ bật trên máy tính (điện thoại tắt cho đỡ nóng máy / tốn pin)
  const FX = !COARSE && !REDUCED;
  const petals = FX ? Array.from({ length: 12 }, () => {
    const s = rnd(7, 14).toFixed(1);
    return `<span class="pt" style="left:${rnd(0, 96).toFixed(0)}%;width:${s}px;height:${s}px;animation-duration:${rnd(7, 13).toFixed(1)}s;animation-delay:${(-rnd(0, 12)).toFixed(1)}s"></span>`;
  }).join('') : '';
  const sparks = FX ? Array.from({ length: 7 }, (_, i) => {
    const s = rnd(8, 14).toFixed(0);
    return `<span class="sp ${['', 'v', 'b'][i % 3]}" style="left:${rnd(2, 94).toFixed(0)}%;top:${rnd(2, 94).toFixed(0)}%;width:${s}px;height:${s}px;animation-duration:${rnd(2.4, 4.5).toFixed(1)}s;animation-delay:${(-rnd(0, 4)).toFixed(1)}s"></span>`;
  }).join('') : '';
  const flower = [0, 1, 2, 3, 4].map(i => `<i style="transform:rotate(${i * 72}deg)"></i>`).join('');
  const fxHtml = FX ? `<div class="dts11-fx">${petals}${sparks}</div>` : '';
  const headHtml = ver => `
    <div id="dts11-head" title="Kéo để di chuyển">
      <div class="dts11-logo">
        <div class="dts11-mascot"><div class="dts11-flower">${flower}</div><span class="dts11-badge" id="dts11-badge">0</span></div>
        <div class="dts11-ttl"><div class="dts11-title">HuyDz</div><div class="dts11-sub"><span class="dts11-dot"></span>${ver} · 桜 SAKURA</div></div>
      </div>
      <div class="dts11-hbtns">
        <button id="dts11-run" class="dts11-runbtn" type="button"></button>
        <button id="dts11-min" class="dts11-minbtn" type="button" title="Thu gọn" aria-label="Thu gọn">–</button>
      </div>
    </div>`;

  const panel = document.createElement('div');
  panel.id = 'dts11';
  panel.innerHTML = headHtml('v12') + `
    <div id="dts11-body">
      ${fxHtml}
      <div class="dts11-main">
        <div class="dts11-stats">
          <div class="dts11-stat"><small>Sổ đáp án</small><div><b id="dts11-cnt">0</b> <span>câu</span></div></div>
          <div class="dts11-stat"><small>Mã đề</small><div><b id="dts11-codeshow" class="sm">–</b></div></div>
        </div>
        <div class="dts11-bubble" aria-live="polite"><span id="dts11-face">(◕‿◕)</span><span id="dts11-st"></span></div>

        <label class="dts11-sw"><input type="checkbox" id="dts11-sel"><i></i><span>Tự chọn đáp án đã nhớ</span></label>
        <label class="dts11-sw"><input type="checkbox" id="dts11-chk"><i></i><span>Tự bấm "Kiểm tra"</span></label>
        <label class="dts11-sw"><input type="checkbox" id="dts11-next"><i></i><span>Tự bấm "Tiếp"</span></label>

        <div class="dts11-box">
          Độ trễ mỗi bước: <b id="dts11-ms"></b> ms <small>(0 = nhanh nhất)</small>
          <input type="range" id="dts11-spd" min="0" max="2000" step="50">
        </div>
        <div class="dts11-box">
          Câu chưa biết
          <select id="dts11-unk" class="dts11-inp">
            <option value="wait">Dừng chờ tôi tự làm</option>
            <option value="guess">Chọn A rồi Kiểm tra (để học)</option>
          </select>
        </div>

        <details class="dts11-adv">
          <summary>Đồng bộ &amp; dữ liệu</summary>
          <div class="dts11-advin">
            <input id="dts11-code" class="dts11-inp" type="text" spellcheck="false" autocomplete="off" autocapitalize="off">
            <div class="dts11-acts">
              <button id="dts11-gpull" class="dts11-act wide" type="button">Tải đáp án từ GitHub</button>
              <button id="dts11-gpush" class="dts11-act wide alt" type="button">Lưu sổ lên GitHub</button>
              <button id="dts11-exp" class="dts11-act" type="button">Xuất .txt</button>
              <button id="dts11-imp" class="dts11-act alt" type="button">Nhập .txt</button>
              <button id="dts11-clr" class="dts11-act danger" type="button" title="Xoá toàn bộ câu đã nhớ">Xoá sổ đã nhớ</button>
            </div>
          </div>
        </details>
        <input type="file" id="dts11-file" accept=".txt,text/plain" style="display:none">
        <div class="dts11-foot">ganbatte ne~ · 頑張って</div>
      </div>
    </div>`;
  (document.body || document.documentElement).appendChild(panel);
  const $ = id => document.getElementById('dts11-' + id);

  // ---------- Vị trí / thu gọn / kéo thả (chuột + cảm ứng) ----------
  const isMin = () => panel.classList.contains('min');
  function clampPanel() {
    // đo theo layout (offset*) chứ không theo getBoundingClientRect, vì lúc đang chạy hiệu ứng xuất hiện khung bị co/dịch
    const w = panel.offsetWidth, h = panel.offsetHeight;
    const vw = document.documentElement.clientWidth || innerWidth, vh = innerHeight;
    const x = Math.min(Math.max(8, panel.offsetLeft), Math.max(8, vw - w - 8));
    const y = Math.min(Math.max(8, panel.offsetTop), Math.max(8, vh - h - 8));
    panel.style.left = x + 'px'; panel.style.top = y + 'px'; panel.style.right = 'auto'; panel.style.bottom = 'auto';
  }
  function savePos() { cfg.x = panel.offsetLeft; cfg.y = panel.offsetTop; saveCfg(); }
  function setMin(v, silent) {
    cfg.min = !!v;
    panel.classList.toggle('min', cfg.min);
    $('min').textContent = '–';
    if (!silent) saveCfg();
    requestAnimationFrame(() => { clampPanel(); if (!silent) savePos(); });
  }
  if (cfg.x !== null) { panel.style.left = cfg.x + 'px'; panel.style.top = cfg.y + 'px'; panel.style.right = 'auto'; }
  setMin(cfg.min, true);
  addEventListener('resize', clampPanel);
  addEventListener('orientationchange', () => setTimeout(clampPanel, 350));
  $('min').onclick = () => setMin(true);

  let drag = null;
  panel.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const min = isMin();
    if (!min && (!e.target.closest('#dts11-head') || e.target.closest('button'))) return;
    const r = panel.getBoundingClientRect();
    drag = { id: e.pointerId, ox: e.clientX - r.left, oy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false, min };
    try { panel.setPointerCapture(e.pointerId); } catch (x) {}
  });
  panel.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
    drag.moved = true; e.preventDefault();
    panel.style.left = (e.clientX - drag.ox) + 'px'; panel.style.top = (e.clientY - drag.oy) + 'px';
    panel.style.right = 'auto'; panel.style.bottom = 'auto';
  });
  const endDrag = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    try { panel.releasePointerCapture(e.pointerId); } catch (x) {}
    if (d.moved) { clampPanel(); savePos(); }
    else if (d.min && e.type === 'pointerup') setMin(false);   // chạm nhẹ vào nút tròn = mở rộng
  };
  panel.addEventListener('pointerup', endDrag);
  panel.addEventListener('pointercancel', endDrag);

  // gợn sóng khi bấm nút
  panel.addEventListener('click', e => {
    if (REDUCED) return;
    const btn = e.target.closest('.dts11-act, .dts11-runbtn');
    if (!btn) return;
    const r = btn.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2;
    const s = document.createElement('span');
    s.className = 'dts11-rip';
    s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    btn.appendChild(s);
    setTimeout(() => s.remove(), 650);
  });

  // vệt cánh hoa theo con trỏ (chỉ có chuột)
  let lastTrail = 0;
  if (!REDUCED && !COARSE) panel.addEventListener('mousemove', e => {
    const t = performance.now();
    if (t - lastTrail < 50 || isMin()) return;
    lastTrail = t;
    const r = panel.getBoundingClientRect();
    const b = document.createElement('b');
    b.className = 'dts11-trail';
    b.style.left = (e.clientX - r.left) + 'px';
    b.style.top = (e.clientY - r.top) + 'px';
    b.style.background = ['#ffb3d4', '#c9b6ff', '#ffd0e5', '#a9dcff'][Math.floor(Math.random() * 4)];
    b.style.setProperty('--dx', rnd(-26, 26).toFixed(0) + 'px');
    b.style.setProperty('--dy', rnd(14, 44).toFixed(0) + 'px');
    b.style.setProperty('--r', rnd(0, 420).toFixed(0) + 'deg');
    b.addEventListener('animationend', () => b.remove());
    panel.appendChild(b);
  });

  // xuất file .txt (chạy được cả trên điện thoại: link phải nằm trong DOM)
  function downloadTxt(name, text) {
    const blob = new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
  }

  // Mặt kaomoji theo trạng thái
  const FACES = [
    [/⚠️/, '(；′⌒`)'], [/vừa học/, '(≧▽≦)'], [/đã chọn|đoán/, '(๑•̀ㅂ•́)و✧'],
    [/Kiểm tra/, '(｡•̀ᴗ-)✧'], [/chuyển câu/, '┌(・。・)┘♪'], [/tạm dừng/, '(－ω－) zzZ'],
    [/đang chạy/, '(＾▽＾)'], [/câu mới|không khớp|đề đổi/, '(・・?)'], [/đáp án nhớ/, '(•̀ᴗ•́)و'],
    [/xoá|trống/, '(・ω・)'], [/xuất|nhập/, '(๑˃ᴗ˂)ﻭ']
  ];
  const faceFor = m => { const f = FACES.find(x => x[0].test(m)); return f ? f[1] : '(◕‿◕)'; };

  let lastMsg = '', lastShown = '', lastN = -1;
  function stat(msg) {
    if (msg !== undefined) lastMsg = msg;
    const n = usableRecs().length, code = examCode();
    const m = (lastMsg || 'sẵn sàng nè ~') + (ghNote ? ' · ' + ghNote : '');
    const sig = n + '|' + code + '|' + m;
    if (sig === lastShown) return;   // chỉ cập nhật DOM khi có thay đổi
    lastShown = sig;
    $('cnt').textContent = n; $('badge').textContent = n > 99 ? '99+' : n;
    $('codeshow').textContent = code || '–';
    $('face').textContent = faceFor(lastMsg || '');
    $('st').textContent = m.replace(/⚠️\s*/g, '');
    const bub = panel.querySelector('.dts11-bubble');
    bub.classList.remove('pop'); void bub.offsetWidth; bub.classList.add('pop');
    if (lastN !== -1 && n !== lastN) {
      const c = $('cnt'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
    }
    lastN = n;
  }
  // thông báo do người dùng bấm: giữ 4 giây, vòng lặp tự động không ghi đè ngay
  const say = msg => { holdUntil = now() + 4000; stat(msg); };
  // thông báo của vòng lặp tự động
  const stt = msg => { if (now() >= holdUntil) stat(msg); else stat(); };

  const runLabel = () => {
    const b = $('run');
    b.textContent = cfg.run ? 'Tạm dừng' : 'Chạy nào!';
    b.className = 'dts11-runbtn ' + (cfg.run ? 'on' : 'off');
    panel.classList.toggle('running', !!cfg.run);
  };
  const fillSpd = () => $('spd').style.setProperty('--p', (cfg.delay / 20) + '%');

  $('sel').checked = cfg.sel;   $('sel').onchange = e => { cfg.sel = e.target.checked; saveCfg(); };
  $('chk').checked = cfg.chk;   $('chk').onchange = e => { cfg.chk = e.target.checked; saveCfg(); };
  $('next').checked = cfg.next; $('next').onchange = e => { cfg.next = e.target.checked; saveCfg(); };
  $('unk').value = cfg.unk;     $('unk').onchange = e => { cfg.unk = e.target.value; saveCfg(); };
  $('spd').value = cfg.delay;   $('ms').textContent = cfg.delay; fillSpd();
  $('spd').oninput = e => { cfg.delay = +e.target.value; $('ms').textContent = cfg.delay; fillSpd(); saveCfg(); };
  $('run').onclick = () => { cfg.run = !cfg.run; runLabel(); saveCfg(); say(cfg.run ? 'đang chạy, cố lên!' : 'đã tạm dừng'); };
  runLabel(); stat('');

  // ---------- Xuất / nhập .txt ----------
  // Định dạng: mỗi dòng "câu hỏi ||| đáp án đúng"; dòng bắt đầu bằng # là ghi chú
  function exportTxt() {
    const lines = Object.values(bank).filter(r => r && r.q && r.correct).map(r => flat(r.q) + SEP + flat(r.correct));
    const head = ['# DeThiSo Helper - sổ đáp án', '# Mỗi dòng: câu hỏi ||| đáp án đúng', ''];
    downloadTxt('dethiso-dap-an.txt', head.concat(lines).join('\n') + '\n');
    say(`đã xuất ${lines.length} câu`);
  }
  function importTxt(text) {
    let added = 0, skipped = 0;
    text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const i = line.lastIndexOf('|||');
      if (i < 0) { skipped++; return; }
      const q = flat(line.slice(0, i)), c = flat(line.slice(i + 3));
      if (!q || !c) { skipped++; return; }
      if (!bank[norm(q)]) added++;
      bank[norm(q)] = { q, correct: c, t: examCode() || undefined };
    });
    saveBank();
    st = { key: null }; stN = { sig: null };
    say(`nhập +${added} câu mới` + (skipped ? `, bỏ ${skipped} dòng lỗi` : ''));
  }
  $('exp').onclick = exportTxt;

  // ---------- Lưu lên GitHub (token nhập mỗi lần, dùng xong bỏ, không lưu) ----------
  const GHC = { user: 'Huy7684', repo: 'School', branch: 'main', dir: 'sakura-repo/', site: 'dethiso' };
  const ghEnc = str => { const u = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); };
  const ghDec = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));
  const ghParse = txt => {
    const out = [];
    String(txt).replace(/^\uFEFF/, '').split(/\r?\n/).forEach(line => {
      line = line.trim();
      if (!line || line[0] === '#') return;
      const i = line.lastIndexOf('|||');
      if (i < 0) return;
      const q = flat(line.slice(0, i)), c = flat(line.slice(i + 3));
      if (q && c) out.push([q, c]);
    });
    return out;
  };
  // fetch thẳng; nếu trang chặn (CSP) thì đi qua Sakura Loader
  function ghViaLoader(method, url, headers, data) {
    return new Promise(res => {
      const id = Math.random().toString(36).slice(2);
      const done = v => { document.removeEventListener('sakura-http-res', h); clearTimeout(t); res(v); };
      const h = e => { try { const o = JSON.parse(e.detail); if (o.id === id) done({ s: o.s, j: o.j }); } catch (x) {} };
      const t = setTimeout(() => done({ s: 0, j: null }), 25000);
      document.addEventListener('sakura-http-res', h);
      document.dispatchEvent(new CustomEvent('sakura-http', { detail: JSON.stringify({ id, method, url, headers, data }) }));
    });
  }
  function ghReq(method, tok, file, body) {
    const url = `https://api.github.com/repos/${GHC.user}/${GHC.repo}/contents/${GHC.dir}${file}` + (method === 'GET' ? '?ref=' + GHC.branch : '');
    const headers = { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
    const data = body ? JSON.stringify(body) : undefined;
    return fetch(url, { method, headers, body: data })
      .then(async r => ({ s: r.status, j: await r.json().catch(() => null) }))
      .catch(() => ghViaLoader(method, url, headers, data));
  }
  const ghErr = s => s === 0 ? 'không kết nối được GitHub (mạng hoặc trang chặn, cần cài Sakura Loader)'
    : (s === 401 || s === 403) ? 'token sai/hết hạn/thiếu quyền Contents: Read and write (HTTP ' + s + ')'
    : s === 404 ? 'token không thấy repo ' + GHC.repo + ' (HTTP 404)' : 'lỗi GitHub HTTP ' + s;
  // gộp items vào 1 file trên GitHub; trả {n} (số câu mới/đổi) hoặc {err}
  async function ghPushFile(tok, file, items) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const cur = await ghReq('GET', tok, file);
      if (cur.s !== 200 && cur.s !== 404) return { err: ghErr(cur.s) };
      const map = {};
      if (cur.s === 200) ghParse(ghDec(cur.j.content)).forEach(([q, c]) => { map[norm(q)] = [q, c]; });
      let n = 0;
      items.forEach(([q, c]) => { const k = norm(q); if (!map[k] || norm(map[k][1]) !== norm(c)) n++; map[k] = [q, c]; });
      if (!n) return { n: 0 };
      const text = '# Mỗi dòng: câu hỏi ||| đáp án đúng\n' + Object.values(map).sort((a, b) => a[0].toLowerCase() < b[0].toLowerCase() ? -1 : 1).map(([q, c]) => `${q} ||| ${c}`).join('\n') + '\n';
      const put = await ghReq('PUT', tok, file, { message: `bank ${file}: +${n}`, content: ghEnc(text), branch: GHC.branch, sha: cur.s === 200 ? cur.j.sha : undefined });
      if (put.s === 200 || put.s === 201) return { n };
      if (put.s !== 409 && put.s !== 422) return { err: ghErr(put.s) };
    }
    return { err: 'xung đột phiên bản, bấm lưu lại nhé' };
  }
  let pushing = false;
  async function pushGithub() {
    if (pushing) return;
    const code = examCode();
    const all = Object.values(bank).filter(r => r && r.q && r.correct);
    const mine = code ? all.filter(r => r.t === code) : [];
    const pair = r => [flat(r.q), flat(r.correct)];
    if (!all.length) return say('sổ đang trống, chưa có gì để lưu');
    let tok = prompt('Dán GitHub token để lưu (dùng 1 lần, không được lưu lại)\nSổ chung: ' + all.length + ' câu' + (code ? '\nĐề ' + code + ': ' + mine.length + ' câu' : '\n(chưa nhận ra mã đề)'), '');
    if (!tok || !tok.trim()) return say('đã huỷ, chưa lưu');
    tok = tok.trim();
    pushing = true;
    say('đang lưu lên GitHub...');
    try {
      const r1 = await ghPushFile(tok, `banks/${GHC.site}.txt`, all.map(pair));
      if (r1.err) return say(r1.err);
      let r2 = { n: 0 };
      if (code && mine.length) { r2 = await ghPushFile(tok, `banks/${GHC.site}/${code}.txt`, mine.map(pair)); if (r2.err) return say(r2.err); }
      say(r1.n || r2.n ? `đã lưu: sổ chung +${r1.n}` + (code && mine.length ? `, đề ${code} +${r2.n}` : '') : 'sổ đã khớp GitHub, không có gì mới');
    } finally { tok = null; pushing = false; }
  }

  // ---------- Tải từ GitHub ----------
  $('gpush').onclick = pushGithub;
  const codeEl = $('code');
  codeEl.value = '';
  const labelOnly = c => /^(?:[A-F]\s*\.\s*)+$/i.test(flat(c));

  // tải file đề trên GitHub (repo public, không cần token); bị trang chặn thì đi qua Sakura Loader
  function ghGetPublic(file) {
    const url = `https://api.github.com/repos/${GHC.user}/${GHC.repo}/contents/${GHC.dir}${file}?ref=${GHC.branch}`;
    const headers = { Accept: 'application/vnd.github+json' };
    return fetch(url, { headers, cache: 'no-store' }).then(async r => ({ s: r.status, j: await r.json().catch(() => null) })).catch(() => ghViaLoader('GET', url, headers));
  }
  async function pullExam(code) {
    if (!code) { ghNote = ''; return stat(); }
    ghNote = 'đang tải đề ' + code + ' từ GitHub…'; stat();
    const r = await ghGetPublic(`banks/${GHC.site}/${code}.txt`);
    if (code !== examCode()) return;                 // đã sang link khác, bỏ kết quả cũ
    if (r.s === 200 && r.j && r.j.content) {
      const items = ghParse(ghDec(r.j.content)).filter(([q, c]) => !labelOnly(c));
      items.forEach(([q, c]) => { bank[norm(q)] = { q, correct: c, t: code }; });
      saveBank(); st = { key: null }; stN = { sig: null };
      ghNote = `đề ${code}: đã tải ${items.length} câu từ GitHub`;
    } else if (r.s === 404) ghNote = `đề ${code} không có trên GitHub`;
    else if (r.s === 0) ghNote = 'không kết nối được GitHub';
    else if (r.s === 403) ghNote = 'GitHub đang giới hạn lượt gọi, thử lại sau';
    else ghNote = 'lỗi GitHub HTTP ' + r.s;
    stat();
  }
  $('gpull').onclick = () => { say('tải lại từ GitHub...'); pullExam(examCode()); };
  codeEl.onchange = () => {
    manualCode = extractCode(codeEl.value); codeEl.value = manualCode;
    say(manualCode ? 'mã đề: ' + manualCode : 'dùng mã tự nhận từ trang: ' + (autoCode() || 'không có'));
    pullExam(examCode());
  };
  setInterval(() => { const h = 'Link / mã đề (tự nhận: ' + (autoCode() || 'không có') + ')'; if (codeEl.placeholder !== h) codeEl.placeholder = h; }, 1500);

  // vào link nào tự nhận mã đề link đó và tự tải file từ GitHub; sang link khác thì bỏ mã cũ
  let lastAuto = null;
  function watchUrl() {
    const c = autoCode();
    if (c === lastAuto) return;
    lastAuto = c; manualCode = ''; codeEl.value = ''; ghNote = '';
    if (c) pullExam(c); else stat();
  }
  setInterval(watchUrl, 700); watchUrl();

  document.addEventListener('sakura-status', e => { bank = loadKey(BANK_KEY) || {}; idx2 = null; st = { key: null }; stN = { sig: null }; say(String(e.detail || '')); });
  $('imp').onclick = () => $('file').click();
  $('file').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => importTxt(String(rd.result));
    rd.readAsText(f, 'utf-8');
    e.target.value = '';
  };
  $('clr').onclick = () => {
    const n = Object.keys(bank).length;
    if (!n) { say('sổ đang trống'); return; }
    if (confirm(`Xoá toàn bộ ${n} câu đã nhớ trong trình duyệt?\n(Nên bấm "Xuất .txt" trước nếu muốn giữ bản sao. File .txt đã xuất không bị ảnh hưởng.)`)) {
      bank = {};
      saveBank();
      legacyKeys().forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
      st = { key: null }; stN = { sig: null };
      say(`đã xoá ${n} câu`);
    }
  };

  // ---------- Đọc DOM ----------
  // Trang dùng màu oklch() (Tailwind v4): getComputedStyle trả "oklch(...)" chứ không phải "rgb(...)".
  // Tự đổi oklch/oklab/color(srgb) về RGB (trình duyệt điện thoại cũ không hiểu oklch trong canvas), còn lại nhờ canvas.
  let cx = null, cxTried = false;
  function ctx2d() {
    if (!cxTried) {
      cxTried = true;
      try {
        const cv = document.createElement('canvas'); cv.width = cv.height = 1;
        cx = cv.getContext('2d', { willReadFrequently: true });
      } catch (e) {}
    }
    return cx;
  }
  function oklab2rgb(L, a, b) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s].map(v => {
      v = Math.min(1, Math.max(0, v));
      v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
      return Math.round(v * 255);
    });
  }
  function parseModern(c) {
    let m = c.match(/^ok(lch|lab)\(\s*([^\s)\/]+)\s+([^\s)\/]+)\s+([^\s)\/]+)/i);
    if (m) {
      const num = (s, pctScale) => s === 'none' ? 0 : (/%$/.test(s) ? parseFloat(s) / 100 * pctScale : parseFloat(s));
      const L = num(m[2], 1);
      if (m[1].toLowerCase() === 'lch') {
        const C = num(m[3], 0.4), h = (num(m[4], 360)) * Math.PI / 180;
        return oklab2rgb(L, C * Math.cos(h), C * Math.sin(h));
      }
      return oklab2rgb(L, num(m[3], 0.4), num(m[4], 0.4));
    }
    m = c.match(/^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
    if (m) return [m[1], m[2], m[3]].map(v => Math.round(Math.min(1, Math.max(0, parseFloat(v))) * 255));
    return null;
  }
  function toRgb(c) {
    if (!c) return null;
    const m = c.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
    if (m) return (m[4] !== undefined && parseFloat(m[4]) === 0) ? null : [+m[1], +m[2], +m[3]];
    if (/transparent/i.test(c)) return null;
    const p = parseModern(c);
    if (p) return p;
    if (!ctx2d()) return null;
    try {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = '#000'; cx.fillStyle = c;   // màu không hợp lệ thì giữ '#000'
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      return d[3] ? [d[0], d[1], d[2]] : null;
    } catch (e) { return null; }
  }
  const greenRgb = v => !!v && v[1] > v[0] + 40 && v[1] > v[2] + 40;
  const redRgb = v => !!v && v[0] > v[1] + 60 && v[0] > v[2] + 60;
  // 'good' (xanh) | 'bad' (đỏ) | null: xét viền/nền của ô và của vòng tròn icon (con đầu tiên)
  function rowKind(el) {
    for (const n of [el, el.children[0]]) {
      if (!n) continue;
      const cs = getComputedStyle(n);
      for (const c of [cs.borderTopColor, cs.backgroundColor]) {
        const v = toRgb(c);
        if (greenRgb(v)) return 'good';
        if (redRgb(v)) return 'bad';
      }
    }
    return null;
  }

  // ô đáp án: rộng/cao vừa đủ (điện thoại màn hẹp, chữ xuống dòng nhiều nên cho cao hơn)
  const rowOk = el => {
    if (panel.contains(el) || el.children.length < 2) return false;
    if (!el.parentElement || el.parentElement.children.length < 4) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 120 && r.height >= 36 && r.height <= 280;
  };

  // Chụp câu hỏi + 4 phương án khi CHƯA kiểm tra (các ô còn hiện chữ A-D)
  function snapshot() {
    const rows = {};
    document.querySelectorAll('div, button, li, label').forEach(el => {
      if (!rowOk(el)) return;
      const l = (el.children[0].textContent || '').trim();
      if (!/^[A-D]$/.test(l)) return;
      const r = el.getBoundingClientRect();
      const a = r.width * r.height;
      if (!rows[l] || a < rows[l].a) rows[l] = { el, a };
    });
    if (Object.keys(rows).length < 4) return null;
    const els = {}, texts = {};
    Object.keys(rows).forEach(l => {
      els[l] = rows[l].el;
      texts[l] = flat(rows[l].el.textContent).replace(/^[A-D]\s*/, '');
    });
    const card = els.A.parentElement.parentElement || els.A.parentElement;
    const raw = card.innerText || '';
    const mq = raw.match(/^\s*Câu\s*(\d+)/);
    const q = flat(raw.split(/\nA\s*\n/)[0].replace(/^Câu\s*\d+\s*\/\s*\d+\s*/, ''));
    return { q, qno: mq ? mq[1] : '', els, texts };
  }

  // Các ô có icon (sau khi kiểm tra); `texts` = 4 phương án đã chụp, loại hộp "Đúng rồi!"
  function resultRows(texts) {
    const allowed = texts ? new Set(Object.values(texts).map(norm)) : null;
    const rows = [];
    document.querySelectorAll('div, button, li, label').forEach(el => {
      if (!rowOk(el) || !el.querySelector('svg')) return;
      const txt = flat(el.textContent);
      if (allowed && !allowed.has(norm(txt))) return;
      rows.push({ el, txt, kind: rowKind(el) });
    });
    return rows;
  }
  // Dự phòng khi mở trang ở câu đã kiểm tra sẵn (không có snapshot): ô xanh nằm trong nhóm >=4 ô cùng bề rộng
  function genericGood() {
    let found = null;
    document.querySelectorAll('div, button, li, label').forEach(el => {
      if (found || !rowOk(el) || !el.querySelector('svg') || rowKind(el) !== 'good') return;
      const w = el.getBoundingClientRect().width;
      const sibs = [...el.parentElement.children].filter(s => {
        const r = s.getBoundingClientRect();
        return Math.abs(r.width - w) < 3 && r.height >= 36;
      });
      if (sibs.length >= 3) found = el;
    });
    return found;
  }
  function infoFor(el, txt, matched) {
    const cont = el.parentElement && (el.parentElement.parentElement || el.parentElement);
    const text = (cont && cont.innerText) || '';
    const mq = text.match(/Câu\s*(\d+)/);
    return { txt, matched, sig: (mq ? mq[1] : '?') + '|' + norm(txt), cont: flat(text) };
  }
  function checkedInfo() {
    if (lastSnap) {
      const rows = resultRows(lastSnap.texts);
      const good = rows.find(r => r.kind === 'good');
      // Chỉ 1 ô hiện icon (không đỏ) = người làm chọn đúng, ô đó là đáp án
      const pick = good || (rows.length === 1 && rows[0].kind !== 'bad' ? rows[0] : null);
      if (pick) {
        const inf = infoFor(pick.el, pick.txt, true);
        if (inf.cont.includes(lastSnap.q)) return inf;   // đúng là câu vừa chụp (chống học nhầm khi bấm "Trước")
      }
    }
    const g = genericGood();
    return g ? infoFor(g, flat(g.textContent), false) : null;
  }

  // ---------- Nút ----------
  const visible = el => el.getClientRects().length > 0;
  const findBtn = re => [...document.querySelectorAll('button, a, [role="button"]')]
    .find(b => !panel.contains(b) && visible(b) && re.test(flat(b.textContent)));
  function btnEnabled(b) {
    if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
    const cs = getComputedStyle(b);
    return cs.pointerEvents !== 'none' && !(parseFloat(cs.opacity) < 0.9);
  }
  // bấm thật sự cả trên cảm ứng: gửi đủ chuỗi sự kiện rồi click
  function tap(el) {
    try {
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(t => {
        const Ev = t.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Ev(t, { bubbles: true, cancelable: true, view: window }));
      });
    } catch (e) {}
    el.click();
  }

  // ---------- Học đáp án ----------
  function learnFrom(info) {
    if (!info.matched || !lastSnap || !lastSnap.q) return;
    const k = norm(lastSnap.q);
    const code = examCode();
    if (bank[k] && norm(bank[k].correct) === norm(info.txt)) { if (code && bank[k].t !== code) { bank[k].t = code; saveBank(); } return; }
    bank[k] = { q: lastSnap.q, correct: info.txt, t: code || undefined };
    saveBank();
    stt('vừa học 1 câu');
    console.log('🧠 Đã nhớ:', lastSnap.q.slice(0, 60), '→', info.txt);
  }

  // ---------- Máy trạng thái ----------
  const clearOutline = snap => Object.values(snap.els).forEach(e => { e.style.outline = ''; });
  // Câu CHƯA kiểm tra: chọn đáp án → chờ nút Kiểm tra sáng → bấm Kiểm tra
  function stepUnchecked(snap) {
    lastSnap = snap;
    const key = snap.qno + '|' + norm(snap.q);
    if (st.key !== key) st = { key, selTries: 0, selAt: 0, chkTries: 0, chkAt: 0 };
    const rec = findRec(snap.q);
    let letter = rec ? matchLetter(snap.texts, rec.correct) : null;
    let guess = false;
    if (!letter) {
      const willGuess = cfg.run && cfg.unk === 'guess';
      if (!rec) stt(willGuess ? 'câu mới → đoán A để học' : 'câu mới — tự chọn rồi bấm Kiểm tra để học');
      else stt(willGuess ? 'không khớp đáp án đã nhớ → đoán A để học' : 'đã nhớ câu nhưng không khớp đáp án (đề đổi chữ?)');
      if (!willGuess) return;
      letter = 'A'; guess = true;
    }
    if (!cfg.run || (!guess && !cfg.sel)) {
      clearOutline(snap);
      snap.els[letter].style.outline = '4px solid #10B981';
      stt(`đáp án nhớ: ${letter}`);
      return;
    }
    if (st.stuck) return;
    const t = now();
    if (st.selTries === 0) {
      if (!gapOk()) return;
      clearOutline(snap);
      tap(snap.els[letter]);
      st.selTries = 1; st.selAt = t; lastAct = t;
      stt(guess ? `đoán ${letter}` : `đã chọn ${letter}`);
      return;
    }
    if (!cfg.chk && !guess) return;
    const btn = findBtn(/^Kiểm tra$/);
    if (st.chkTries === 0) {
      const ready = btnEnabled(btn) || t - st.selAt > Math.max(700, cfg.delay * 2);
      if (!ready || !btn || !gapOk()) return;
      tap(btn);
      st.chkTries = 1; st.chkAt = t; lastAct = t;
      stt('đã bấm Kiểm tra');
      return;
    }
    // Đã bấm mà trang chưa đổi: chờ lâu rồi mới thử lại (tránh gửi trùng), tối đa 2 lần
    if (t - st.chkAt > chkRetry() && btnEnabled(btn) && gapOk()) {
      if (st.chkTries >= 2) { st.stuck = true; stt('⚠️ Kẹt ở nút Kiểm tra — hãy bấm tay'); return; }
      tap(btn);
      st.chkTries++; st.chkAt = t; lastAct = t;
    }
  }

  // Câu ĐÃ kiểm tra: học đáp án → bấm Tiếp
  function stepChecked(info) {
    if (stN.sig !== info.sig) stN = { sig: info.sig, tries: 0, at: 0 };
    learnFrom(info);
    if (!cfg.run || !cfg.next || stN.stuck) return;
    const nb = findBtn(/^Tiếp/);
    if (!nb) { stt('không thấy nút Tiếp (cuối bài?) — dừng'); return; }
    if (!btnEnabled(nb)) return;
    const t = now();
    if (stN.tries === 0) {
      if (!gapOk()) return;
      tap(nb);
      stN.tries = 1; stN.at = t; lastAct = t;
      stt('đang chuyển câu');
      return;
    }
    if (t - stN.at > nextRetry() && gapOk()) {
      if (stN.tries >= 2) { stN.stuck = true; stt('⚠️ Kẹt ở nút Tiếp — hãy bấm tay'); return; }
      tap(nb);
      stN.tries++; stN.at = t; lastAct = t;
    }
  }

  // Chỉ hoạt động ở trang làm bài (/exam/<mã>/take). Trang bắt đầu / xếp hạng: script không đọc, không bấm gì.
  const onTake = () => /\/take(\/|$)/.test(location.pathname);
  function tick() {
    if (!onTake()) { lastSnap = null; stt('chờ vào trang làm bài…'); return; }
    const snap = snapshot();
    if (snap) return stepUnchecked(snap);
    const info = checkedInfo();
    if (info) return stepChecked(info);
  }
  // điện thoại quét thưa hơn một chút cho đỡ nóng máy
  const FAST = COARSE ? 160 : 80;
  function loop() {
    try { if (!document.hidden) tick(); } catch (e) { console.error('DTS tick lỗi:', e); }
    setTimeout(loop, document.hidden ? 1500 : (onTake() && cfg.run ? (cfg.delay <= 150 ? FAST : 150) : 600));
  }
  loop();

  console.log('✅ DeThiSo Helper v12 sẵn sàng.');
})();
