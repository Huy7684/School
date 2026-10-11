// ==UserScript==
// @name         DeThiSo Helper
// @namespace    https://dethiso.vn/
// @version      13.0
// @description  Sakura Edition (điện thoại + máy tính): học đáp án đúng sau mỗi lần Kiểm tra, xuất/nhập .txt, tự chọn - kiểm tra - chuyển câu với tốc độ chỉnh được
// @match        https://dethiso.vn/*
// @match        https://*.dethiso.vn/*
// @noframes
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// DeThiSo Helper v13 - chạy trên điện thoại, máy tính bảng và máy tính; giao diện wibu mới, sửa lỗi.
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
  let bankVer = 0;   // tăng mỗi khi sổ đổi, để biết khi nào phải tính lại danh sách dùng được
  const saveBank = () => { idx2 = null; bankVer++; try { localStorage.setItem(BANK_KEY, JSON.stringify(bank)); } catch (e) {} };
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
  // Mỗi câu có thể thuộc nhiều đề: r.t là danh sách mã đề cách nhau bằng dấu phẩy (sổ cũ chỉ có 1 mã vẫn đọc được).
  // Trước đây r.t chỉ giữ 1 mã nên câu trùng giữa 2 đề cứ bị gắn lại qua lại, đề này lấy mất của đề kia.
  const hasT = (r, c) => !!r && !!r.t && ('' + r.t).split(',').indexOf(c) >= 0;
  const addT = (t, c) => !c ? t : (!t ? c : (hasT({ t }, c) ? t : t + ',' + c));
  const putRec = (q, c, code) => {
    const k = norm(q), o = bank[k], same = !!o && norm(o.correct) === norm(c);
    bank[k] = { q, correct: c, t: same ? (code ? addT(o.t, code) : o.t) : (code || undefined) };
  };
  let scKey = '', scVal = '', urKey = '', urVal = [];
  const strictCode = () => {
    const c = examCode(), k = bankVer + '|' + c;
    if (k !== scKey) { scKey = k; scVal = STRICT_EXAM && c && Object.values(bank).some(r => r && hasT(r, c)) ? c : ''; }
    return scVal;
  };
  const usableWith = (r, sc) => !!(r && r.q && r.correct && (!sc || !r.t || hasT(r, sc)));
  const usableRecs = () => {
    const sc = strictCode(), k = bankVer + '|' + sc;
    if (k !== urKey) { urKey = k; urVal = Object.values(bank).filter(r => usableWith(r, sc)); }
    return urVal;
  };

  function findRec(q) {
    const sc = strictCode();
    const r = bank[norm(q)];
    if (r && usableWith(r, sc)) return r;
    // chỉ mục dự phòng giữ cả danh sách (trước đây chỉ giữ 1 câu cuối nên câu trùng chữ giữa các đề có thể bị bỏ sót)
    if (!idx2) { idx2 = {}; Object.values(bank).forEach(v => { if (v && v.q) { const k = norm2(stripNo(v.q)); (idx2[k] = idx2[k] || []).push(v); } }); }
    return (idx2[norm2(stripNo(q))] || []).find(v => usableWith(v, sc)) || null;
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

  // ---------- Giao diện (điện thoại, máy tính bảng, máy tính) ----------
  const mq = q => { try { return !!(window.matchMedia && matchMedia(q).matches); } catch (e) { return false; } };
  const REDUCED = mq('(prefers-reduced-motion: reduce)');
  const COARSE = mq('(pointer: coarse)');
  if (typeof cfg.min !== 'boolean') cfg.min = innerWidth <= 640;   // điện thoại: mặc định thu gọn thành nút tròn
  if (typeof cfg.x !== 'number' || typeof cfg.y !== 'number') { cfg.x = null; cfg.y = null; }

  const css = document.createElement('style');
  css.textContent = `#dts11{--pk:#ff86bd;--pk2:#c2297a;--tx:#40305a;--tx2:#7d6c9a;--bg:rgba(255,250,253,.95);--bub:#fff7fb;--card:rgba(255,255,255,.82);--line:rgba(255,134,189,.42);--inp:#fff;--trk:#d9cdee;
position:fixed;top:72px;right:max(12px,env(safe-area-inset-right,0px));width:min(348px,calc(100vw - 16px));margin:0;padding:0;
max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));
display:flex;flex-direction:column;z-index:2147483647;
font:13px/1.5 "Hiragino Maru Gothic ProN","M PLUS Rounded 1c","Yu Gothic UI","Meiryo UI",system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif;
color:var(--tx);color-scheme:light;text-align:left;letter-spacing:normal;text-transform:none;
-webkit-text-size-adjust:100%;text-size-adjust:100%;touch-action:manipulation;
animation:dts11-in .5s cubic-bezier(.2,1.4,.4,1) both}
@media (prefers-color-scheme:dark){#dts11{color-scheme:dark;--tx:#f6eefc;--tx2:#c8b9df;--bg:rgba(30,23,46,.95);--bub:#2c2342;--card:rgba(255,255,255,.08);--line:rgba(255,134,189,.32);--inp:#2b2342;--trk:#4a3d68;--pk2:#ff9fcd}}
#dts11 *{box-sizing:border-box}
#dts11 button{-webkit-appearance:none;appearance:none;font:inherit;cursor:pointer;border:0;position:relative;overflow:hidden;-webkit-tap-highlight-color:transparent;margin:0}
#dts11 input,#dts11 select{font:inherit;color:var(--tx);margin:0}
#dts11 button:focus-visible,#dts11 summary:focus-visible,#dts11-head:focus-visible{outline:3px solid #7a4dff;outline-offset:2px}
#dts11-head button:focus-visible,#dts11-head:focus-visible{outline-color:#fff}

.dts11-card{position:relative;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden;border-radius:24px;border:2px solid transparent;
  background:linear-gradient(var(--bg),var(--bg)) padding-box,linear-gradient(135deg,#ff8fc2,#c19bff,#86cfff) border-box;
  -webkit-backdrop-filter:blur(14px) saturate(1.4);backdrop-filter:blur(14px) saturate(1.4);
  box-shadow:0 14px 38px rgba(150,70,160,.36),0 2px 8px rgba(0,0,0,.14)}

/* hiệu ứng nền: nằm sau nội dung, phủ cả khung (không bị cuộn mất) */
.dts11-fx{position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;overflow:hidden;z-index:0}
.dts11-fx .pt{position:absolute;top:-16px;border-radius:150% 0 150% 0;background:linear-gradient(135deg,#ffd0e5,#ff8fc2);opacity:0;animation:dts11-fall linear infinite}
.dts11-fx .sp{position:absolute;background:#fff;clip-path:polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%);opacity:0;animation:dts11-sp ease-in-out infinite}
.dts11-fx .sp.v{background:#d9c8ff}.dts11-fx .sp.b{background:#cdeaff}

/* header */
#dts11-head{position:relative;z-index:2;flex:none;display:flex;align-items:center;justify-content:space-between;padding:10px 12px 12px;color:#fff;cursor:grab;
  user-select:none;-webkit-user-select:none;touch-action:none;
  background:linear-gradient(120deg,#e0488f,#9a6cf0 55%,#6a7df0,#e0488f);background-size:240% 100%}
#dts11.running #dts11-head{animation:dts11-flow 9s linear infinite}
#dts11-head::after{content:"";position:absolute;left:0;right:0;bottom:0;height:4px;background:repeating-linear-gradient(90deg,rgba(255,255,255,.9) 0 6px,transparent 6px 12px);opacity:.3}
#dts11.running #dts11-head::after{opacity:.85}
@media (pointer:fine){#dts11.running #dts11-head::after{animation:dts11-march .8s linear infinite}}
.dts11-logo{position:relative;z-index:1;display:flex;align-items:center;min-width:0}
.dts11-ttl{min-width:0}
.dts11-title{font-weight:800;font-size:15px;line-height:1.25;letter-spacing:.3px;white-space:nowrap;text-shadow:0 1px 4px rgba(80,20,90,.55)}
.dts11-sub{display:flex;align-items:center;font-size:11px;letter-spacing:.4px;white-space:nowrap;text-shadow:0 1px 3px rgba(80,20,90,.5)}
.dts11-dot{flex:none;width:7px;height:7px;margin-right:5px;border-radius:50%;background:#ffe27a;box-shadow:0 0 0 2px rgba(255,255,255,.35)}
#dts11.running .dts11-dot{background:#7dffb0;animation:dts11-dotp 1.6s ease-in-out infinite}
.dts11-hbtns{position:relative;z-index:1;display:flex;align-items:center;flex:none;margin-left:8px}
.dts11-hbtns>*+*{margin-left:6px}
.dts11-runbtn{padding:7px 14px;border-radius:999px;font-weight:800;font-size:12.5px;min-height:34px;white-space:nowrap;transition:transform .15s}
.dts11-runbtn:active{transform:scale(.94)}
.dts11-runbtn.on{background:#fff;color:#c2297a;box-shadow:0 2px 10px rgba(80,20,90,.3)}
.dts11-runbtn.off{background:#fff3a0;color:#8a4a00;animation:dts11-pulse 1.4s ease-in-out infinite}
.dts11-minbtn{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.3);color:#fff;font-size:18px;font-weight:800;line-height:1;padding:0}
.dts11-minbtn:active{background:rgba(255,255,255,.55)}

/* linh vật chibi: đổi biểu cảm theo trạng thái (data-mood) */
.dts11-mascot{position:relative;flex:none;width:48px;height:48px;margin-right:10px;border-radius:50%;
  background:radial-gradient(circle at 50% 35%,#fff,#ffe9f4);box-shadow:0 0 0 3px rgba(255,255,255,.5),0 3px 10px rgba(80,20,90,.45)}
#dts11.running .dts11-mascot{animation:dts11-bob 3.2s ease-in-out infinite}
.dts11-mv{position:absolute;left:0;top:0;width:100%;height:100%;display:block;overflow:visible}
#dts11 .dts11-mv [data-for]{display:none}
#dts11[data-mood="idle"] .dts11-mv [data-for~="idle"],#dts11[data-mood="happy"] .dts11-mv [data-for~="happy"],#dts11[data-mood="star"] .dts11-mv [data-for~="star"],
#dts11[data-mood="sleep"] .dts11-mv [data-for~="sleep"],#dts11[data-mood="worry"] .dts11-mv [data-for~="worry"],#dts11[data-mood="think"] .dts11-mv [data-for~="think"]{display:inline}
.dts11-eo{transform-box:fill-box;transform-origin:50% 55%}
#dts11[data-mood="idle"] .dts11-eo{animation:dts11-blink 4.8s infinite}
#dts11[data-mood="think"] .dts11-eo{transform:translate(1.4px,-1.2px)}
#dts11[data-mood="star"] .dts11-mv{animation:dts11-hop .6s ease-out}
.dts11-spk{transform-box:fill-box;transform-origin:center;animation:dts11-sp 1.6s ease-in-out infinite}
.dts11-zz{animation:dts11-zz 2.4s ease-in-out infinite}

/* thu gọn thành nút tròn */
#dts11.min{width:60px;height:60px;max-height:none;cursor:pointer;touch-action:none}
#dts11.min .dts11-card{border-radius:50%}
#dts11.min #dts11-body,#dts11.min .dts11-hbtns,#dts11.min .dts11-ttl,#dts11.min .dts11-fx{display:none}
#dts11.min #dts11-head{flex:1 1 auto;padding:0;justify-content:center;border-radius:50%;cursor:pointer}
#dts11.min #dts11-head::after{display:none}
#dts11.min .dts11-mascot{width:46px;height:46px;margin:0}
.dts11-badge{display:none;position:absolute;right:-6px;bottom:-4px;z-index:3;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:#fff;color:#c2297a;
  font-weight:800;font-size:11px;line-height:1;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.3);pointer-events:none}
#dts11.min .dts11-badge{display:flex}

/* thân */
#dts11-body{position:relative;z-index:1;flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:12px;scrollbar-width:thin;scrollbar-color:#ffb3d4 transparent}
#dts11-body::-webkit-scrollbar{width:6px}#dts11-body::-webkit-scrollbar-thumb{background:#ffb3d4;border-radius:6px}

.dts11-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
.dts11-stat{position:relative;min-width:0;overflow:hidden;padding:8px 11px;border-radius:16px;background:var(--card);border:1.5px solid var(--line)}
.dts11-stat::after{content:attr(data-jp);position:absolute;right:7px;bottom:-9px;font:800 42px/1 "Hiragino Maru Gothic ProN","Yu Gothic","Noto Sans CJK JP","Noto Sans JP","Microsoft YaHei",sans-serif;color:var(--pk);opacity:.17;pointer-events:none}
.dts11-stat small{display:block;color:var(--tx2);font-size:11px;white-space:nowrap}
.dts11-stat b{position:relative;display:inline-block;font-size:21px;line-height:1.15;color:var(--pk2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;vertical-align:bottom}
.dts11-stat b.sm{font-size:15px;line-height:1.6}
.dts11-stat b.bump{animation:dts11-bump .5s cubic-bezier(.3,1.8,.5,1)}
.dts11-stat span{position:relative;color:var(--tx2);font-size:11px}

/* bong bóng thoại: mascot "nói" trạng thái */
.dts11-bubble{position:relative;display:flex;align-items:center;margin:14px 0 12px;padding:9px 12px;border-radius:18px;background:var(--bub);border:2px solid #ffb3d4}
.dts11-bubble::before{content:"";position:absolute;top:-8px;left:20px;width:12px;height:12px;background:var(--bub);border-left:2px solid #ffb3d4;border-top:2px solid #ffb3d4;transform:rotate(45deg)}
.dts11-bubble.pop{animation:dts11-pop .4s cubic-bezier(.3,1.7,.5,1)}
#dts11-face{flex:none;margin-right:9px;font-weight:800;color:var(--pk2);white-space:nowrap;font-size:12.5px}
#dts11-st{min-width:0;color:var(--tx);font-size:12.5px;word-break:break-word}

.dts11-sw{position:relative;display:flex;align-items:center;min-height:44px;padding:4px 6px;cursor:pointer;border-radius:14px;-webkit-tap-highlight-color:transparent}
@media (hover:hover){.dts11-sw:hover{background:rgba(255,134,189,.14)}}
.dts11-sw input{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px}
.dts11-sw i{position:relative;flex:none;width:46px;height:26px;margin-right:11px;border-radius:999px;background:var(--trk);box-shadow:inset 0 1px 3px rgba(60,30,90,.25);transition:background .25s,box-shadow .25s}
.dts11-sw i::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(60,30,90,.4);
  font:700 12px/20px system-ui,sans-serif;text-align:center;color:#ff5fa8;transition:transform .3s cubic-bezier(.3,1.7,.5,1)}
.dts11-sw input:checked+i{background:linear-gradient(90deg,#ff7fb8,#a98cf5);box-shadow:0 0 10px rgba(255,127,184,.55)}
.dts11-sw input:checked+i::after{content:"\\2665";transform:translateX(20px)}
.dts11-sw input:focus-visible+i{outline:3px solid #7a4dff;outline-offset:2px}
.dts11-sw span{min-width:0;font-weight:600}

.dts11-box{margin:8px 0;padding:10px 12px;border-radius:16px;background:var(--card);border:1.5px solid var(--line);border-left:5px solid #ff8fc2}
.dts11-box small{color:var(--tx2)}
#dts11-ms{color:var(--pk2);font-size:14px}
#dts11-spd{-webkit-appearance:none;appearance:none;display:block;width:100%;height:12px;margin:14px 0 6px;padding:0;border-radius:999px;outline:0;cursor:pointer;touch-action:pan-y;
  background:linear-gradient(90deg,#ff7fb8 var(--p,15%),var(--trk) var(--p,15%))}
#dts11-spd::-webkit-slider-thumb{-webkit-appearance:none;width:28px;height:28px;border-radius:50%;border:3px solid #fff;background:radial-gradient(circle at 35% 35%,#fff 0 14%,#ff6fb0 16%);box-shadow:0 2px 10px rgba(200,70,140,.6)}
#dts11-spd::-moz-range-thumb{width:22px;height:22px;border-radius:50%;border:3px solid #fff;background:#ff6fb0;box-shadow:0 2px 10px rgba(200,70,140,.6)}
#dts11-spd::-moz-range-track{background:transparent}
#dts11-spd:focus-visible{outline:3px solid #7a4dff;outline-offset:4px}
.dts11-ends{display:flex;justify-content:space-between;font-size:11px;color:var(--tx2)}
.dts11-inp{display:block;width:100%;margin-top:6px;padding:9px 12px;border-radius:14px;border:1.5px solid #ffc2dc;background:var(--inp);outline:0;min-height:42px}
.dts11-inp:focus{border-color:#a98cf5;box-shadow:0 0 0 3px rgba(169,140,245,.28)}
select.dts11-inp{-webkit-appearance:none;appearance:none;padding-right:34px;
  background-image:linear-gradient(45deg,transparent 50%,#c2297a 50%),linear-gradient(135deg,#c2297a 50%,transparent 50%);
  background-position:calc(100% - 19px) 55%,calc(100% - 14px) 55%;background-size:5px 5px,5px 5px;background-repeat:no-repeat}

.dts11-adv{margin:8px 0 0;border-radius:16px;background:var(--card);border:1.5px solid var(--line)}
.dts11-adv>summary{list-style:none;cursor:pointer;min-height:44px;padding:12px;font-weight:700;display:flex;justify-content:space-between;align-items:center;-webkit-tap-highlight-color:transparent}
.dts11-adv>summary::-webkit-details-marker{display:none}
.dts11-adv>summary::after{content:"\\25BE";color:var(--tx2);transition:transform .2s}
.dts11-adv[open]>summary::after{transform:rotate(180deg)}
.dts11-advin{padding:0 10px 10px}

/* nút kẹo: có đáy nổi, nhấn xuống khi bấm */
.dts11-acts{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:8px}
.dts11-act{min-height:42px;padding:8px 10px;border-radius:999px;font-weight:800;font-size:12.5px;color:#fff;text-shadow:0 1px 2px rgba(100,10,70,.45);
  background:linear-gradient(180deg,#f372b0,#cf3a88);box-shadow:0 3px 0 #a52a6c,0 6px 12px rgba(176,70,150,.3);transition:transform .12s,box-shadow .12s}
@media (hover:hover){.dts11-act:hover{transform:translateY(-1px)}}
.dts11-act:active{transform:translateY(3px);box-shadow:0 0 0 #a52a6c,0 2px 5px rgba(176,70,150,.3)}
.dts11-act.alt{background:linear-gradient(180deg,#8aa0ff,#5468d8);box-shadow:0 3px 0 #3b4bb0,0 6px 12px rgba(84,104,216,.3)}
.dts11-act.alt:active{box-shadow:0 0 0 #3b4bb0,0 2px 5px rgba(84,104,216,.3)}
.dts11-act.danger{grid-column:1/-1;background:linear-gradient(180deg,#f0728a,#c93556);box-shadow:0 3px 0 #9e2542,0 6px 12px rgba(201,53,86,.3)}
.dts11-act.danger:active{box-shadow:0 0 0 #9e2542,0 2px 5px rgba(201,53,86,.3)}
.dts11-act.wide{grid-column:1/-1}
.dts11-rip{position:absolute;border-radius:50%;background:rgba(255,255,255,.6);transform:scale(0);animation:dts11-rip .6s ease-out forwards;pointer-events:none}
.dts11-foot{text-align:center;margin-top:12px;font-size:11px;letter-spacing:.6px;color:var(--tx2)}
.dts11-trail{position:absolute;width:9px;height:9px;margin:-4px;border-radius:150% 0 150% 0;pointer-events:none;z-index:5;animation:dts11-trail .8s ease-out forwards}

/* mọi kích cỡ màn hình */
@media (pointer:coarse){#dts11 input,#dts11 select{font-size:16px}#dts11 .dts11-act{min-height:46px;font-size:13.5px}#dts11 .dts11-runbtn{min-height:38px}#dts11 .dts11-minbtn{width:38px;height:38px}#dts11 .dts11-item .x{width:36px;height:36px}}
@media (max-width:360px){#dts11 .dts11-sub{display:none}#dts11 .dts11-title{font-size:14px}#dts11 .dts11-stat b{font-size:19px}}
@media (max-height:520px){#dts11-body{padding:8px}.dts11-fx{display:none}}
@media (min-width:1280px){#dts11{width:372px}}
@media print{#dts11{display:none!important}}

@keyframes dts11-in{from{opacity:0;transform:translateY(-16px) scale(.92)}to{opacity:1;transform:none}}
@keyframes dts11-flow{from{background-position:0 0}to{background-position:240% 0}}
@keyframes dts11-march{from{background-position:0 0}to{background-position:12px 0}}
@keyframes dts11-bob{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-3px) rotate(4deg)}}
@keyframes dts11-hop{0%{transform:translateY(0)}35%{transform:translateY(-6px) scale(1.08)}70%{transform:translateY(0) scale(.97)}100%{transform:none}}
@keyframes dts11-blink{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(.08)}}
@keyframes dts11-sp{0%,100%{opacity:0;transform:scale(.2) rotate(0)}50%{opacity:.95;transform:scale(1) rotate(90deg)}}
@keyframes dts11-zz{0%{opacity:0;transform:translate(0,3px)}40%{opacity:1}100%{opacity:0;transform:translate(4px,-7px)}}
@keyframes dts11-fall{0%{opacity:0;transform:translate(0,0) rotate(0)}10%{opacity:.8}85%{opacity:.8}100%{opacity:0;transform:translate(var(--sx,0px),var(--fh,520px)) rotate(540deg)}}
@keyframes dts11-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,243,160,.95)}50%{box-shadow:0 0 0 8px rgba(255,243,160,0)}}
@keyframes dts11-dotp{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes dts11-bump{0%{transform:scale(1)}40%{transform:scale(1.5) rotate(-5deg)}100%{transform:scale(1)}}
@keyframes dts11-pop{0%{transform:scale(.96)}60%{transform:scale(1.03)}100%{transform:scale(1)}}
@keyframes dts11-rip{to{transform:scale(1);opacity:0}}
@keyframes dts11-trail{0%{opacity:.95;transform:translate(0,0) rotate(0) scale(1)}100%{opacity:0;transform:translate(var(--dx),var(--dy)) rotate(var(--r)) scale(.3)}}
@media (prefers-reduced-motion:reduce){#dts11,#dts11 *{animation:none!important;transition:none!important}}
`;
  (document.head || document.documentElement).appendChild(css);

  const rnd = (a, b) => a + Math.random() * (b - a);
  // cánh hoa + lấp lánh nằm sau nội dung; điện thoại dùng ít hơn cho đỡ nóng máy, tắt hẳn nếu bật "giảm chuyển động"
  const nPt = COARSE ? 5 : 12, nSp = COARSE ? 3 : 7;
  const petals = REDUCED ? '' : Array.from({ length: nPt }, () => {
    const s = rnd(7, 14).toFixed(1);
    return `<span class="pt" style="left:${rnd(0, 96).toFixed(0)}%;width:${s}px;height:${s}px;--sx:${rnd(-24, 24).toFixed(0)}px;animation-duration:${rnd(7, 13).toFixed(1)}s;animation-delay:${(-rnd(0, 12)).toFixed(1)}s"></span>`;
  }).join('');
  const sparks = REDUCED ? '' : Array.from({ length: nSp }, (_, i) => {
    const s = rnd(8, 14).toFixed(0);
    return `<span class="sp ${['', 'v', 'b'][i % 3]}" style="left:${rnd(2, 94).toFixed(0)}%;top:${rnd(2, 94).toFixed(0)}%;width:${s}px;height:${s}px;animation-duration:${rnd(2.4, 4.5).toFixed(1)}s;animation-delay:${(-rnd(0, 4)).toFixed(1)}s"></span>`;
  }).join('');
  const fxHtml = REDUCED ? '' : `<div class="dts11-fx" aria-hidden="true">${petals}${sparks}</div>`;

  // Linh vật neko chibi (SVG nội tuyến, không cần tải ảnh nên không bị CSP chặn). Biểu cảm đổi theo data-mood của khung.
  const MASCOT = `<svg class="dts11-mv" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <path d="M12 23L8 3l18 8z" fill="#9f7df0"/><path d="M13.8 17.5L11.5 8.2l8.4 3.6z" fill="#ff9ccb"/>
    <path d="M52 23L56 3 38 11z" fill="#9f7df0"/><path d="M50.2 17.5L52.5 8.2l-8.4 3.6z" fill="#ff9ccb"/>
    <path d="M9 34C9 14 19 8 32 8s23 6 23 26v9c0 6-4 10-9 10H18c-5 0-9-4-9-10z" fill="#b79cff"/>
    <ellipse cx="32" cy="38" rx="18" ry="15" fill="#fff1e8"/>
    <path d="M13 34C13 17 22 10 32 10S51 17 51 34L47 26L43 32L38 25L32 31L26 25L21 32L17 26Z" fill="#b79cff"/>
    <path d="M20 17Q26 12 33 12" stroke="#d9c9ff" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M32 9C30 3 34 0 38 2" fill="none" stroke="#b79cff" stroke-width="2.6" stroke-linecap="round"/>
    <ellipse cx="19" cy="46" rx="3.4" ry="2" fill="#ff7fb3" opacity=".5"/><ellipse cx="45" cy="46" rx="3.4" ry="2" fill="#ff7fb3" opacity=".5"/>
    <g class="dts11-eo" data-for="idle worry think">
      <ellipse cx="24" cy="39" rx="4.1" ry="5.2" fill="#3a2470"/><ellipse cx="40" cy="39" rx="4.1" ry="5.2" fill="#3a2470"/>
      <circle cx="25.6" cy="36.6" r="1.7" fill="#fff"/><circle cx="41.6" cy="36.6" r="1.7" fill="#fff"/>
      <circle cx="22.6" cy="41.2" r=".8" fill="#fff"/><circle cx="38.6" cy="41.2" r=".8" fill="#fff"/>
      <path d="M19.2 35.2Q24 32.6 28.6 35.2M35.4 35.2Q40 32.6 44.8 35.2" stroke="#3a2470" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    </g>
    <g data-for="star">
      <ellipse cx="24" cy="39" rx="4.1" ry="5.2" fill="#3a2470"/><ellipse cx="40" cy="39" rx="4.1" ry="5.2" fill="#3a2470"/>
      <path d="M24 35.4L24.85 38.15 27.6 39 24.85 39.85 24 42.6 23.15 39.85 20.4 39 23.15 38.15Z" fill="#fff"/>
      <path d="M40 35.4L40.85 38.15 43.6 39 40.85 39.85 40 42.6 39.15 39.85 36.4 39 39.15 38.15Z" fill="#fff"/>
      <path d="M19.2 35.2Q24 32.6 28.6 35.2M35.4 35.2Q40 32.6 44.8 35.2" stroke="#3a2470" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    </g>
    <path data-for="happy" d="M19.5 40Q24 33 28.5 40M35.5 40Q40 33 44.5 40" stroke="#3a2470" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path data-for="sleep" d="M19.5 38Q24 43 28.5 38M35.5 38Q40 43 44.5 38" stroke="#3a2470" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path data-for="idle" d="M28.4 46Q30.2 49 32 46Q33.8 49 35.6 46" fill="none" stroke="#c2297a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    <g data-for="happy star"><path d="M28 45.5Q32 53 36 45.5Z" fill="#e0488f"/><path d="M30 49.6Q32 48.4 34 49.6Q32 52 30 49.6z" fill="#ff9ccb"/></g>
    <ellipse data-for="sleep" cx="32" cy="47" rx="1.9" ry="1.5" fill="#c2297a"/>
    <path data-for="worry" d="M28 48Q30 45.6 32 48T36 48" fill="none" stroke="#c2297a" stroke-width="1.6" stroke-linecap="round"/>
    <path data-for="think" d="M30 47h4" fill="none" stroke="#c2297a" stroke-width="1.8" stroke-linecap="round"/>
    <path data-for="worry" d="M50 22c-2.4 3.4-3.6 5.2-3.6 7a3.6 3.6 0 007.2 0c0-1.8-1.2-3.6-3.6-7z" fill="#8fd3ff" stroke="#fff" stroke-width=".8"/>
    <text data-for="think" x="45" y="21" font-size="15" font-weight="800" fill="#c2297a" font-family="system-ui,sans-serif">?</text>
    <text data-for="sleep" class="dts11-zz" x="46" y="17" font-size="12" font-weight="800" fill="#7e5ed6" font-family="system-ui,sans-serif">z</text>
    <g transform="translate(46 15)"><path d="M0 0L-7-5V5zM0 0L7-5V5z" fill="#ff5fa8"/><circle r="2.3" fill="#ff9ccb"/></g>
    <g data-for="star happy"><g transform="translate(1 12)"><path class="dts11-spk" d="M7 14l1.2 3 3 1.2-3 1.2L7 22.4l-1.2-3-3-1.2 3-1.2z" fill="#ffd86b"/></g>
      <g transform="translate(50 30) scale(.7)"><path class="dts11-spk" d="M7 14l1.2 3 3 1.2-3 1.2L7 22.4l-1.2-3-3-1.2 3-1.2z" fill="#ffd86b"/></g></g>
  </svg>`;

  const headHtml = ver => `
    <div id="dts11-head" title="Kéo để di chuyển">
      <div class="dts11-logo">
        <div class="dts11-mascot">${MASCOT}</div>
        <div class="dts11-ttl"><div class="dts11-title">HuyDz</div><div class="dts11-sub"><span class="dts11-dot"></span>${ver} · 桜 SAKURA</div></div>
      </div>
      <div class="dts11-hbtns">
        <button id="dts11-run" class="dts11-runbtn" type="button"></button>
        <button id="dts11-min" class="dts11-minbtn" type="button" title="Thu gọn" aria-label="Thu gọn">–</button>
      </div>
    </div>`;

  const panel = document.createElement('div');
  panel.id = 'dts11';
  panel.setAttribute('data-mood', 'idle');
  panel.innerHTML = `<div class="dts11-card">${fxHtml}${headHtml('v13')}
    <div id="dts11-body">
      <div class="dts11-main">
        <div class="dts11-stats">
          <div class="dts11-stat" data-jp="答"><small>Sổ đáp án</small><div><b id="dts11-cnt">0</b> <span>câu</span></div></div>
          <div class="dts11-stat" data-jp="番"><small>Mã đề</small><div><b id="dts11-codeshow" class="sm">–</b></div></div>
        </div>
        <div class="dts11-bubble" aria-live="polite"><span id="dts11-face">(◕‿◕)</span><span id="dts11-st"></span></div>

        <label class="dts11-sw"><input type="checkbox" id="dts11-sel"><i></i><span>Tự chọn đáp án đã nhớ</span></label>
        <label class="dts11-sw"><input type="checkbox" id="dts11-chk"><i></i><span>Tự bấm "Kiểm tra"</span></label>
        <label class="dts11-sw"><input type="checkbox" id="dts11-next"><i></i><span>Tự bấm "Tiếp"</span></label>

        <div class="dts11-box">
          Độ trễ mỗi bước: <b id="dts11-ms"></b> ms <small>(0 = nhanh nhất)</small>
          <input type="range" id="dts11-spd" min="0" max="2000" step="50" aria-label="Độ trễ mỗi bước (ms)">
          <div class="dts11-ends"><span>nhanh</span><span>chậm</span></div>
        </div>
        <div class="dts11-box">
          <label for="dts11-unk">Câu chưa biết</label>
          <select id="dts11-unk" class="dts11-inp">
            <option value="wait">Dừng chờ tôi tự làm</option>
            <option value="guess">Chọn A rồi Kiểm tra (để học)</option>
          </select>
        </div>

        <details class="dts11-adv">
          <summary>Đồng bộ &amp; dữ liệu</summary>
          <div class="dts11-advin">
            <input id="dts11-code" class="dts11-inp" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" enterkeyhint="done" aria-label="Link hoặc mã đề">
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
        <div class="dts11-foot">頑張ってね ✧ ganbatte ne~</div>
      </div>
    </div></div><span class="dts11-badge" id="dts11-badge">0</span>`;
  (document.body || document.documentElement).appendChild(panel);
  const $ = id => document.getElementById('dts11-' + id);
  const head = $('head');

  let curMood = 'idle';
  const setMood = m => { if (m !== curMood) { curMood = m; panel.setAttribute('data-mood', m); } };

  // ---------- Vị trí / thu gọn / kéo thả (chuột + cảm ứng + bút) ----------
  const isMin = () => panel.classList.contains('min');
  let drag = null;
  // vùng an toàn (tai thỏ, thanh điều hướng) — đọc qua env() bằng 1 phần tử đo
  function insets() {
    const o = { t: 0, r: 0, b: 0, l: 0 };
    try {
      const p = document.createElement('div');
      p.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
      document.documentElement.appendChild(p);
      const cs = getComputedStyle(p);
      o.t = parseFloat(cs.paddingTop) || 0; o.r = parseFloat(cs.paddingRight) || 0; o.b = parseFloat(cs.paddingBottom) || 0; o.l = parseFloat(cs.paddingLeft) || 0;
      p.remove();
    } catch (e) {}
    return o;
  }
  function clampPanel() {
    if (drag) return;
    // đo theo layout (offset*) chứ không theo getBoundingClientRect, vì lúc đang chạy hiệu ứng xuất hiện khung bị co/dịch
    const w = panel.offsetWidth, h = panel.offsetHeight, ins = insets(), M = 8;
    const vw = document.documentElement.clientWidth || innerWidth, vh = innerHeight;
    const minX = M + ins.l, minY = M + ins.t;
    const x = Math.min(Math.max(minX, panel.offsetLeft), Math.max(minX, vw - w - M - ins.r));
    const y = Math.min(Math.max(minY, panel.offsetTop), Math.max(minY, vh - h - M - ins.b));
    panel.style.left = x + 'px'; panel.style.top = y + 'px'; panel.style.right = 'auto'; panel.style.bottom = 'auto';
  }
  function savePos() { cfg.x = panel.offsetLeft; cfg.y = panel.offsetTop; saveCfg(); }
  function setMin(v, silent) {
    cfg.min = !!v;
    panel.classList.toggle('min', cfg.min);
    // thu gọn: đầu khung thành nút bấm được bằng bàn phím
    if (cfg.min) { head.setAttribute('role', 'button'); head.setAttribute('tabindex', '0'); head.setAttribute('aria-label', 'Mở bảng HuyDz'); }
    else { head.removeAttribute('role'); head.removeAttribute('tabindex'); head.removeAttribute('aria-label'); }
    if (!silent) saveCfg();
    requestAnimationFrame(() => { clampPanel(); if (!silent) savePos(); });
  }
  if (cfg.x !== null) { panel.style.left = cfg.x + 'px'; panel.style.top = cfg.y + 'px'; panel.style.right = 'auto'; }
  setMin(cfg.min, true);

  // Khung đổi cao (mở "Đồng bộ & dữ liệu", mở sổ đáp án, đổi cỡ màn hình): giữ nguyên trong màn hình + cập nhật độ rơi của cánh hoa
  const fxEl = panel.querySelector('.dts11-fx');
  const onSize = () => { clampPanel(); if (fxEl) fxEl.style.setProperty('--fh', (panel.offsetHeight + 24) + 'px'); };
  if (window.ResizeObserver) { try { new ResizeObserver(onSize).observe(panel); } catch (e) {} }
  addEventListener('resize', onSize);
  addEventListener('orientationchange', () => setTimeout(onSize, 350));
  $('min').onclick = () => setMin(true);
  head.addEventListener('keydown', e => { if (isMin() && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setMin(false); } });
  // trình duyệt quá cũ không có Pointer Events: chạm vào nút tròn vẫn mở được
  if (!window.PointerEvent) panel.addEventListener('click', () => { if (isMin()) setMin(false); });

  panel.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.isPrimary === false) return;
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

  // Mặt kaomoji + biểu cảm linh vật theo trạng thái (điều kiện cụ thể đặt trước điều kiện chung)
  const FACES = [
    [/⚠️|không kết nối|token sai|lỗi GitHub|xung đột|giới hạn lượt/, '(；′⌒`)', 'worry'],
    [/vừa học|đã lưu|đã tải/, '(≧▽≦)', 'star'],
    [/xuất|nhập \+/, '(๑˃ᴗ˂)ﻭ', 'star'],
    [/câu mới|không khớp|đề đổi|chờ vào|không có trên GitHub/, '(・・?)', 'think'],
    [/đã chọn|đoán/, '(๑•̀ㅂ•́)و✧', 'happy'],
    [/Kiểm tra/, '(｡•̀ᴗ-)✧', 'happy'],
    [/chuyển câu/, '┌(・。・)┘♪', 'happy'],
    [/tạm dừng/, '(－ω－) zzZ', 'sleep'],
    [/đang chạy/, '(＾▽＾)', 'happy'],
    [/đáp án nhớ/, '(•̀ᴗ•́)و', 'happy'],
    [/xoá|trống/, '(・ω・)', 'idle']
  ];
  const faceFor = m => { const f = FACES.find(x => x[0].test(m)); return f ? [f[1], f[2]] : ['(◕‿◕)', cfg.run ? 'idle' : 'sleep']; };

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
    const fc = faceFor(lastMsg || '');
    $('face').textContent = fc[0]; setMood(fc[1]);
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
      putRec(q, c, examCode());
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
    const mine = code ? all.filter(r => hasT(r, code)) : [];
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
      items.forEach(([q, c]) => putRec(q, c, code));
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

  document.addEventListener('sakura-status', e => { bank = loadKey(BANK_KEY) || {}; idx2 = null; bankVer++; st = { key: null }; stN = { sig: null }; say(String(e.detail || '')); });
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
    if (bank[k] && norm(bank[k].correct) === norm(info.txt)) { if (code && !hasT(bank[k], code)) { bank[k].t = addT(bank[k].t, code); saveBank(); } return; }
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

  console.log('✅ DeThiSo Helper v13 sẵn sàng.');
})();
