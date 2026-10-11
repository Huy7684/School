// ==UserScript==
// @name         Azota Helper - Sakura Edition
// @namespace    https://azota.vn/
// @version      4.0
// @description  桜 Sakura Edition (điện thoại + máy tính): quét "Đáp án đúng" (trắc nghiệm, đáp án ảnh, đúng/sai) ở trang xem đáp án rồi lưu, tự chọn lại ở lần làm sau, sổ đáp án có tìm kiếm, xuất/nhập .txt. Không tự nộp bài.
// @match        https://azota.vn/*
// @match        https://*.azota.vn/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// Azota Helper v4 - chạy trên cả điện thoại lẫn máy tính (bỏ regex lookbehind để iPhone/Safari cũ không lỗi), giao diện mới, sửa lỗi.
(function () {
  'use strict';
  if (window.__azh) return;
  window.__azh = true;

  const BANK_KEY = 'azh-bank', CFG_KEY = 'azh-cfg', SEP = ' ||| ';
  const flat = s => String(s || '').replace(/\s+/g, ' ').trim();
  const norm = s => flat(s).toLowerCase();
  const norm2 = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const load = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const panelId = 'azh';

  let bank = load(BANK_KEY) || {};
  const cfg = Object.assign({ run: true, select: true, learn: true, delay: 300, min: null, x: null, y: null }, load(CFG_KEY) || {});
  delete cfg.code;                       // không nhớ mã đề giữa các link
  const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {} };
  let manualCode = '';                   // mã gõ tay: chỉ sống trong 1 link, sang link khác là bỏ
  let ghNote = '', holdUntil = 0;        // ghi chú GitHub hiện cạnh trạng thái; giữ thông báo thao tác vài giây
  // dọn bản ghi hỏng cũ (đáp án chỉ là "B. C. D." do không đọc được ảnh)
  const labelOnly = c => /^(?:[A-F]\s*\.\s*)+$/i.test(flat(c));
  const cleanAns = s => flat(s).replace(/\s*(Giải thích|Tìm (Giáo Án|Tài Liệu)).*$/i, '');   // bỏ chữ nút dính vào đáp án
  const saveBank = () => { try { localStorage.setItem(BANK_KEY, JSON.stringify(bank)); } catch (e) {} };
  { let dirty = 0; Object.keys(bank).forEach(k => { const r = bank[k]; if (r && r.correct) { const cc = cleanAns(r.correct); if (cc !== r.correct) { r.correct = cc; dirty = 1; } } if (!r || !r.q || !r.correct || labelOnly(r.correct)) { delete bank[k]; dirty = 1; } }); if (dirty) saveBank(); }

  // ---------- Mã đề (từ link) ----------
  function extractCode(v) {
    v = String(v || '').trim();
    if (!v) return '';
    const clean = s => s.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    let path = v;
    try { path = new URL(v).pathname; } catch (e) {}
    const segs = path.split('/').map(s => s.trim()).filter(Boolean);
    if (segs.length > 1 || /^https?:/i.test(v)) {
      // azota.vn/de-thi/xmq2mr, .../answer-test/23611069/0/xmq2mr/544206132 -> xmq2mr (bỏ các đoạn toàn số và từ khoá đường dẫn)
      const skip = /^(vi|en|test|take|take-test|answer-test|exam|result|submit-test|do|view|de-thi|share)$/i;
      const cand = segs.filter(s => !skip.test(s) && !/^\d+$/.test(s));
      if (cand.length) return clean(cand[0]);
      return segs.find(s => /^\d{5,}$/.test(s)) || '';
    }
    return clean(v);
  }
  // nhận mã đề cả ở trang làm bài (take-test) và trang xem đáp án (answer-test), không chỉ trang /de-thi/
  const isExam = () => /\/(test|de-thi|exam|take-test|answer-test|result)(\/|$)/i.test(location.pathname);
  const autoCode = () => isExam() ? extractCode(location.href) : '';
  const examCode = () => extractCode(manualCode) || autoCode();
  // Chỉ lọc theo mã đề khi sổ đã có câu gắn đúng mã đề này (câu chưa gắn mã vẫn dùng được).
  // Nếu mã đề nhận khác nhau giữa trang xem đáp án và trang làm bài thì dùng cả sổ, tránh "có đáp án mà không chọn".
  const STRICT_EXAM = true;
  const strictCode = () => {
    const c = examCode();
    return STRICT_EXAM && c && Object.values(bank).some(r => r && r.t === c) ? c : '';
  };
  const usableWith = (r, sc) => !!(r && r.q && r.correct && (!sc || !r.t || r.t === sc));
  const usableEntries = () => { const sc = strictCode(); return Object.entries(bank).filter(([, v]) => usableWith(v, sc)); };
  const usableRecs = () => usableEntries().map(e => e[1]);

  // ---------- Giao diện (dùng được cho cả điện thoại lẫn máy tính) ----------
  const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const COARSE = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  if (typeof cfg.min !== 'boolean') cfg.min = innerWidth <= 640;   // điện thoại: mặc định thu gọn thành nút tròn
  if (typeof cfg.x !== 'number' || typeof cfg.y !== 'number') { cfg.x = null; cfg.y = null; }

  const css = document.createElement('style');
  css.textContent = `#azh{--pk:#ff7eb6;--pk2:#e0559b;--vi:#a78bfa;--sk:#7dc4ff;--tx:#3d2f52;--tx2:#7a6a94;--bg:rgba(255,255,255,.92);--card:rgba(255,255,255,.7);--line:rgba(255,150,200,.38);--inp:#fff;
  position:fixed;top:72px;right:max(12px,env(safe-area-inset-right,0px));width:min(340px,calc(100vw - 16px));
  max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px);display:flex;flex-direction:column;z-index:2147483647;
  font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--tx);border-radius:22px;overflow:hidden;border:2px solid transparent;
  background:linear-gradient(var(--bg),var(--bg)) padding-box,linear-gradient(135deg,#ff8fc2,#c19bff,#86cfff) border-box;
  -webkit-backdrop-filter:blur(16px) saturate(1.4);backdrop-filter:blur(16px) saturate(1.4);
  box-shadow:0 14px 40px rgba(150,80,160,.35),0 2px 8px rgba(0,0,0,.12);
  -webkit-text-size-adjust:100%;touch-action:manipulation;text-align:left;letter-spacing:normal;
  animation:azh-in .45s cubic-bezier(.2,1.4,.4,1) both}
@media (prefers-color-scheme:dark){#azh{--tx:#f3ebfb;--tx2:#bcaed4;--bg:rgba(34,27,50,.93);--card:rgba(255,255,255,.07);--line:rgba(255,150,200,.28);--inp:#2b2342}}
#azh *{box-sizing:border-box}
#azh button{font:inherit;cursor:pointer;border:0;position:relative;overflow:hidden;-webkit-tap-highlight-color:transparent;margin:0}
#azh input,#azh select{font:inherit;color:var(--tx);margin:0}

/* header */
#azh-head{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;color:#fff;cursor:grab;
  user-select:none;-webkit-user-select:none;touch-action:none;flex:none;
  background:linear-gradient(120deg,#ff7fb8,#c19bff 55%,#7fc8ff,#ff7fb8);background-size:240% 100%}
#azh.running #azh-head{animation:azh-flow 9s linear infinite}
#azh-head::after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;background:repeating-linear-gradient(90deg,rgba(255,255,255,.85) 0 7px,transparent 7px 14px);opacity:.35}
#azh.running #azh-head::after{opacity:.9}
@media (pointer:fine){#azh.running #azh-head::after{animation:azh-march .8s linear infinite}}
.azh-logo{position:relative;z-index:1;display:flex;align-items:center;gap:9px;min-width:0}
.azh-title{font-weight:800;font-size:14px;letter-spacing:.3px;text-shadow:0 1px 5px rgba(150,40,120,.55);white-space:nowrap}
.azh-sub{display:flex;align-items:center;gap:5px;font-size:10px;letter-spacing:.7px;opacity:.95;white-space:nowrap}
.azh-dot{width:7px;height:7px;border-radius:50%;background:#ffe27a;box-shadow:0 0 0 2px rgba(255,255,255,.35)}
#azh.running .azh-dot{background:#7dffb0;animation:azh-dotp 1.6s ease-in-out infinite}
.azh-hbtns{position:relative;z-index:1;display:flex;gap:6px;align-items:center;flex:none}
.azh-mascot{position:relative;width:38px;height:38px;flex:none;border-radius:50%;background:rgba(255,255,255,.93);
  box-shadow:0 0 0 3px rgba(255,255,255,.35),0 3px 10px rgba(150,40,120,.4)}
.azh-flower{position:absolute;inset:0;animation:azh-spin 16s linear infinite}
.azh-flower i{position:absolute;left:50%;top:50%;width:10px;height:14px;margin:-14px 0 0 -5px;transform-origin:50% 100%;
  border-radius:50% 50% 50% 50%/75% 75% 25% 25%;background:linear-gradient(180deg,#ffe0ee,#ff7fb8)}
.azh-flower::after{content:"";position:absolute;left:50%;top:50%;width:7px;height:7px;margin:-3.5px;border-radius:50%;background:radial-gradient(circle,#fff6a8,#ffc55c)}
.azh-badge{display:none;position:absolute;right:-7px;bottom:-5px;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:#fff;color:var(--pk2);
  font-weight:800;font-size:11px;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.28)}
.azh-runbtn{padding:7px 13px;border-radius:999px;font-weight:800;font-size:12px;min-height:30px;transition:transform .15s}
.azh-runbtn:active{transform:scale(.94)}
.azh-runbtn.on{background:#fff;color:var(--pk2);box-shadow:0 2px 10px rgba(120,40,110,.3)}
.azh-runbtn.off{background:#fff3a0;color:#a65a00;animation:azh-pulse 1.4s ease-in-out infinite}
.azh-minbtn{width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.35);color:#fff;font-size:17px;font-weight:800;line-height:1;padding:0}
.azh-minbtn:active{background:rgba(255,255,255,.6)}

/* thu gọn thành nút tròn */
#azh.min{width:58px;height:58px;max-height:none;border-radius:50%;cursor:pointer;touch-action:none}
#azh.min #azh-body,#azh.min .azh-hbtns,#azh.min .azh-ttl{display:none}
#azh.min #azh-head{padding:0;width:100%;height:100%;justify-content:center;border-radius:50%}
#azh.min #azh-head::after{display:none}
#azh.min .azh-mascot{width:40px;height:40px;animation:azh-bob 2.8s ease-in-out infinite}
#azh.min .azh-badge{display:flex}

/* thân */
#azh-body{position:relative;flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:12px;scrollbar-width:thin;scrollbar-color:#ffb3d4 transparent}
.azh-fx{position:absolute;left:0;top:0;right:0;height:100%;pointer-events:none;overflow:hidden;z-index:0}
.azh-fx .pt{position:absolute;top:-18px;border-radius:150% 0 150% 0;opacity:.7;animation:azh-fall linear infinite;background:linear-gradient(135deg,#ffd0e5,#ff8fc2)}
.azh-fx .sp{position:absolute;background:#fff;clip-path:polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%);animation:azh-twinkle ease-in-out infinite;opacity:0}
.azh-fx .sp.v{background:#d9c8ff}.azh-fx .sp.b{background:#cdeaff}
.azh-main{position:relative;z-index:1}

.azh-stats{display:flex;gap:8px;margin-bottom:8px}
.azh-stat{flex:1;min-width:0;padding:8px 11px;border-radius:14px;background:var(--card);border:1px solid var(--line)}
.azh-stat small{display:block;color:var(--tx2);font-size:10px;letter-spacing:.6px;text-transform:uppercase;white-space:nowrap}
.azh-stat b{display:inline-block;font-size:20px;line-height:1.15;color:var(--pk2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;vertical-align:bottom}
.azh-stat b.sm{font-size:14px;line-height:1.7}
.azh-stat b.bump{animation:azh-bump .5s cubic-bezier(.3,1.8,.5,1)}
.azh-stat span{color:var(--tx2);font-size:11px}
.azh-bar{height:7px;margin:0 2px 10px;border-radius:999px;background:rgba(167,139,250,.2);overflow:hidden}
.azh-bar i{display:block;height:100%;width:0;border-radius:999px;background:linear-gradient(90deg,#ff7fb8,#b69bff,#7fc8ff);transition:width .5s cubic-bezier(.3,1.4,.5,1)}

.azh-bubble{display:flex;align-items:center;gap:9px;padding:9px 12px;margin-bottom:10px;border-radius:16px;background:var(--card);border:1.5px dashed #ffb3d4}
.azh-bubble.pop{animation:azh-pop .4s cubic-bezier(.3,1.7,.5,1)}
#azh-face{font-weight:800;color:var(--pk2);white-space:nowrap;font-size:12.5px}
#azh-st{color:var(--tx2);font-size:12px;word-break:break-word;min-width:0}

.azh-sw{position:relative;display:flex;align-items:center;gap:11px;min-height:42px;padding:4px 6px;cursor:pointer;border-radius:12px;-webkit-tap-highlight-color:transparent}
@media (hover:hover){.azh-sw:hover{background:rgba(255,160,205,.16)}}
.azh-sw input{position:absolute;opacity:0;pointer-events:none}
.azh-sw i{position:relative;flex:none;width:42px;height:24px;border-radius:999px;background:rgba(150,130,180,.4);transition:background .25s,box-shadow .25s}
.azh-sw i::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(60,30,90,.4);transition:transform .3s cubic-bezier(.3,1.7,.5,1)}
.azh-sw input:checked + i{background:linear-gradient(90deg,#ff7fb8,#b69bff);box-shadow:0 0 10px rgba(255,127,184,.55)}
.azh-sw input:checked + i::after{transform:translateX(18px)}
.azh-sw input:focus-visible + i{outline:2px solid #b69bff;outline-offset:2px}
.azh-sw span{font-weight:600;min-width:0}

.azh-box{margin:8px 0;padding:10px 12px;border-radius:14px;background:var(--card);border:1px solid var(--line);border-left:4px solid #ff8fc2}
.azh-box small{color:var(--tx2)}
#azh-ms{color:var(--pk2);font-size:14px}
#azh-spd{-webkit-appearance:none;appearance:none;display:block;width:100%;height:10px;margin:12px 0 4px;border-radius:999px;outline:0;touch-action:pan-y;
  background:linear-gradient(90deg,#ff7fb8 var(--p,15%),rgba(167,139,250,.25) var(--p,15%))}
#azh-spd::-webkit-slider-thumb{-webkit-appearance:none;width:26px;height:26px;border-radius:50%;border:3px solid #fff;background:radial-gradient(circle at 35% 35%,#fff 0 16%,#ff6fb0 18%);box-shadow:0 2px 10px rgba(200,70,140,.6)}
#azh-spd::-moz-range-thumb{width:20px;height:20px;border-radius:50%;border:3px solid #fff;background:#ff6fb0;box-shadow:0 2px 10px rgba(200,70,140,.6)}
.azh-inp{display:block;width:100%;margin-top:6px;padding:9px 12px;border-radius:12px;border:1.5px solid #ffc2dc;background:var(--inp);outline:0;min-height:40px}
.azh-inp:focus{border-color:#b69bff;box-shadow:0 0 0 3px rgba(182,155,255,.25)}

.azh-adv{margin:8px 0 0;border-radius:14px;background:var(--card);border:1px solid var(--line)}
.azh-adv>summary{list-style:none;cursor:pointer;padding:11px 12px;font-weight:700;display:flex;justify-content:space-between;align-items:center;-webkit-tap-highlight-color:transparent}
.azh-adv>summary::-webkit-details-marker{display:none}
.azh-adv>summary::after{content:"▾";color:var(--tx2);transition:transform .2s}
.azh-adv[open]>summary::after{transform:rotate(180deg)}
.azh-advin{padding:0 10px 10px}

.azh-acts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.azh-act{min-height:40px;padding:8px 10px;border-radius:999px;font-weight:700;font-size:12px;color:#fff;
  background:linear-gradient(90deg,#ff7fb8,#b69bff);box-shadow:0 3px 10px rgba(180,90,170,.3);transition:transform .15s,box-shadow .15s}
@media (hover:hover){.azh-act:hover{transform:translateY(-2px);box-shadow:0 7px 16px rgba(180,90,170,.4)}}
.azh-act:active{transform:scale(.96)}
.azh-act.alt{background:linear-gradient(90deg,#6fc4ff,#b69bff)}
.azh-act.wide{grid-column:1/-1}
.azh-act.danger{grid-column:1/-1;background:linear-gradient(90deg,#ff8fa3,#ffb0c8)}
.azh-rip{position:absolute;border-radius:50%;background:rgba(255,255,255,.6);transform:scale(0);animation:azh-rip .6s ease-out forwards;pointer-events:none}
.azh-foot{text-align:center;margin-top:10px;font-size:10.5px;letter-spacing:1px;color:var(--tx2);opacity:.8}
.azh-trail{position:absolute;width:9px;height:9px;margin:-4px;border-radius:150% 0 150% 0;pointer-events:none;z-index:5;animation:azh-trail .8s ease-out forwards}

/* sổ đáp án */
#azh-bookv{display:none;position:relative;z-index:1}
#azh-list{margin:10px 0;max-height:min(300px,45vh);overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:7px;scrollbar-width:thin;scrollbar-color:#ffb3d4 transparent}
.azh-item{position:relative;padding:8px 32px 8px 10px;border-radius:14px;background:var(--card);border:1px solid var(--line);border-left:4px solid #ff8fc2}
.azh-item .q{font-weight:700;font-size:12px;word-break:break-word}
.azh-item .a{margin-top:3px;color:var(--pk2);font-size:12px;word-break:break-word}
#azh .azh-item .x{position:absolute;top:6px;right:6px;width:24px;height:24px;border-radius:50%;background:rgba(255,143,194,.25);color:var(--pk2);font-weight:800;font-size:14px;line-height:1;padding:0}
#azh .azh-item .x:active{background:#ff8fc2;color:#fff}
.azh-empty{text-align:center;color:var(--tx2);padding:14px 0}

@media (pointer:coarse){#azh input,#azh select{font-size:16px}#azh .azh-act{min-height:44px;font-size:13px}}
@media (max-width:360px){.azh-sub{display:none}}

@keyframes azh-in{from{opacity:0;transform:translateY(-16px) scale(.9)}to{opacity:1;transform:none}}
@keyframes azh-flow{from{background-position:0 0}to{background-position:240% 0}}
@keyframes azh-march{from{background-position:0 0}to{background-position:14px 0}}
@keyframes azh-bob{0%,100%{transform:translateY(0) rotate(-5deg)}50%{transform:translateY(-3px) rotate(5deg)}}
@keyframes azh-spin{to{transform:rotate(360deg)}}
@keyframes azh-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,243,160,.95)}50%{box-shadow:0 0 0 8px rgba(255,243,160,0)}}
@keyframes azh-dotp{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes azh-fall{0%{transform:translate(0,0) rotate(0)}25%{transform:translate(16px,120px) rotate(120deg)}50%{transform:translate(-10px,240px) rotate(240deg)}75%{transform:translate(14px,360px) rotate(360deg)}100%{transform:translate(-6px,520px) rotate(480deg)}}
@keyframes azh-twinkle{0%,100%{opacity:0;transform:scale(.2) rotate(0)}50%{opacity:.9;transform:scale(1) rotate(90deg)}}
@keyframes azh-bump{0%{transform:scale(1)}40%{transform:scale(1.5) rotate(-5deg)}100%{transform:scale(1)}}
@keyframes azh-pop{0%{transform:scale(.95)}60%{transform:scale(1.03)}100%{transform:scale(1)}}
@keyframes azh-rip{to{transform:scale(1);opacity:0}}
@keyframes azh-trail{0%{opacity:.95;transform:translate(0,0) rotate(0) scale(1)}100%{opacity:0;transform:translate(var(--dx),var(--dy)) rotate(var(--r)) scale(.3)}}
@media (prefers-reduced-motion:reduce){#azh,#azh *{animation:none!important;transition:none!important}}
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
  const fxHtml = FX ? `<div class="azh-fx">${petals}${sparks}</div>` : '';
  const headHtml = ver => `
    <div id="azh-head" title="Kéo để di chuyển">
      <div class="azh-logo">
        <div class="azh-mascot"><div class="azh-flower">${flower}</div><span class="azh-badge" id="azh-badge">0</span></div>
        <div class="azh-ttl"><div class="azh-title">HuyDz</div><div class="azh-sub"><span class="azh-dot"></span>${ver} · 桜 SAKURA</div></div>
      </div>
      <div class="azh-hbtns">
        <button id="azh-run" class="azh-runbtn" type="button"></button>
        <button id="azh-min" class="azh-minbtn" type="button" title="Thu gọn" aria-label="Thu gọn">–</button>
      </div>
    </div>`;

  const panel = document.createElement('div');
  panel.id = 'azh';
  panel.innerHTML = headHtml('v4') + `
    <div id="azh-body">
      ${fxHtml}
      <div class="azh-main" id="azh-mainv">
        <div class="azh-stats">
          <div class="azh-stat"><small>Sổ đáp án</small><div><b id="azh-cnt">0</b> <span>câu</span></div></div>
          <div class="azh-stat"><small>Khớp trang này</small><div><b id="azh-pt">–</b></div></div>
        </div>
        <div class="azh-bar"><i id="azh-pb"></i></div>
        <div class="azh-bubble" aria-live="polite"><span id="azh-face">(◕‿◕)</span><span id="azh-st"></span></div>

        <label class="azh-sw"><input type="checkbox" id="azh-sel"><i></i><span>Tự chọn đáp án đã nhớ</span></label>
        <label class="azh-sw"><input type="checkbox" id="azh-lrn"><i></i><span>Tự học ở trang xem đáp án</span></label>

        <div class="azh-box">
          Độ trễ giữa các câu: <b id="azh-ms"></b> ms <small>(0 = nhanh nhất)</small>
          <input type="range" id="azh-spd" min="0" max="2000" step="50">
        </div>

        <div class="azh-acts"><button id="azh-book" class="azh-act wide" type="button">Xem sổ đáp án</button></div>

        <details class="azh-adv">
          <summary>Đồng bộ &amp; dữ liệu</summary>
          <div class="azh-advin">
            <input id="azh-code" class="azh-inp" type="text" spellcheck="false" autocomplete="off" autocapitalize="off">
            <div class="azh-acts">
              <button id="azh-gpull" class="azh-act wide" type="button">Tải đáp án từ GitHub</button>
              <button id="azh-gpush" class="azh-act wide alt" type="button">Lưu sổ lên GitHub</button>
              <button id="azh-exp" class="azh-act" type="button">Xuất .txt</button>
              <button id="azh-imp" class="azh-act alt" type="button">Nhập .txt</button>
              <button id="azh-clr" class="azh-act danger" type="button" title="Xoá toàn bộ câu đã nhớ">Xoá sổ đã nhớ</button>
            </div>
          </div>
        </details>
        <input type="file" id="azh-file" accept=".txt,text/plain" style="display:none">
        <div class="azh-foot">ganbatte ne~ · 頑張って</div>
      </div>

      <div id="azh-bookv">
        <input id="azh-q" class="azh-inp" type="search" placeholder="Tìm câu hỏi hoặc đáp án…" autocomplete="off">
        <div id="azh-list"></div>
        <div class="azh-acts"><button id="azh-back" class="azh-act wide" type="button">Quay lại</button></div>
      </div>
    </div>`;
  (document.body || document.documentElement).appendChild(panel);
  const $ = id => document.getElementById('azh-' + id);

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
    if (!min && (!e.target.closest('#azh-head') || e.target.closest('button'))) return;
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
    const btn = e.target.closest('.azh-act, .azh-runbtn');
    if (!btn) return;
    const r = btn.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2;
    const s = document.createElement('span');
    s.className = 'azh-rip';
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
    b.className = 'azh-trail';
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

  // ---------- Tra sổ ----------
  // (đã bỏ hàm findRec cũ không dùng tới; chọn đáp án đi qua usableRecs + locate)

  // ---------- Học từ trang xem đáp án ----------
  // Mỗi câu có chữ "Đáp án đúng: X" và các phương án "A. ...": quét từng thẻ câu, lưu nội dung phương án đúng.
  const ANS_RE = /^Đáp án đúng\s*:\s*([A-F])(?![\p{L}\p{N}\)])/iu;   // không đòi hết dòng: có thể có nút "Tìm Giáo Án" chèn thêm phía sau
  // Đọc phương án theo thứ tự A, B, C, D... kể cả khi cả 4 phương án nằm cùng 1 dòng.
  // Không dùng regex lookbehind (iPhone / Safari cũ không hỗ trợ): bắt khoảng trắng đứng trước rồi trừ ra.
  function parseOpts(body) {
    const opts = {}, hits = [];
    let pos = 0;
    for (const L of 'ABCDEF') {
      const re = new RegExp('(^|\\s)' + L + '\\s*\\.\\s*', 'g');
      re.lastIndex = pos;
      const m = re.exec(body);
      if (!m) break;
      hits.push({ L, start: m.index + m[1].length, end: m.index + m[0].length });
      pos = m.index + m[0].length;
    }
    hits.forEach((h, i) => { const t = flat(body.slice(h.end, i + 1 < hits.length ? hits[i + 1].start : body.length)); if (t) opts[h.L] = t; });
    return opts;
  }
  const A_START = /(^|\s)A\s*\.\s*\S/;
  // Phương án / câu hỏi là ẢNH: dùng tên file ảnh làm "chữ" định danh, dạng ⟦img:ten-file.png⟧
  const hashStr = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  function imgKey(im) {
    const raw = im.getAttribute('data-src') || im.getAttribute('data-original') || im.currentSrc || im.getAttribute('src') || '';
    if (!raw) return '';
    if (/^data:/i.test(raw)) return 'd' + hashStr(raw);
    try { const segs = new URL(raw, location.href).pathname.split('/').filter(Boolean); return decodeURIComponent(segs[segs.length - 1] || '').toLowerCase(); }
    catch (e) { return raw.split('?')[0].split('/').pop().toLowerCase(); }
  }
  function imgTok(im) {
    const r = im.getBoundingClientRect();
    if (r.width < 20 || (r.height > 0 && r.height < 20)) return '';     // bỏ icon nhỏ; giữ ảnh chưa có chiều cao (cao 0)
    const k = imgKey(im);
    return k ? '⟦img:' + k + '⟧' : '';
  }
  // gom chữ + ảnh của 1 thẻ theo thứ tự DOM (không phụ thuộc xuống dòng / CSS)
  function nodesText(root) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT), parts = [];
    for (let nd; (nd = tw.nextNode());) {
      if (nd.nodeType === 1) { if (nd.tagName === 'IMG') { const t = imgTok(nd); if (t) parts.push(t); } continue; }
      const t = flat(nd.nodeValue); if (t) parts.push(t);
    }
    return parts.join(' ');
  }
  // thẻ có ảnh thì ưu tiên bản có token ảnh (innerText không thấy ảnh)
  const cardTexts = (card, inner) => card.querySelector('img') ? [nodesText(card), inner] : [inner, nodesText(card)];
  // thử lần lượt các bản văn bản của thẻ; trả {q, correct} hoặc null
  function readTexts(texts, letter) {
    for (const tx of texts) {
      const at = tx.search(A_START);
      if (at < 0) continue;
      const q = flat(tx.slice(0, at).replace(/Câu\s*\d+/i, '').replace(/ID\s*:\s*\d+/gi, ''));
      const opts = parseOpts(tx.slice(at).replace(/Đáp án đúng[\s\S]*$/i, ''));
      if (q.length >= 3 && opts[letter]) return { q, correct: cleanAns(opts[letter]) };
    }
    return null;
  }
  // Câu ĐÚNG/SAI: "a) ... b) ... c) ... d) ..." + "Đáp án đúng: a) Đúng b) Sai ..." -> mỗi ý lưu thành 1 bản ghi "[ĐS] nội dung ý" -> Đúng/Sai
  const DS = '[ĐS] ';
  const DS_ANS = /Đáp án đúng(?:(?!Thí sinh|Câu làm sai)[\s\S]){0,80}?(?:^|\s)[a-d]\s*\)\s*(?:Đúng|Sai)/i;   // cho phép nút "Tìm Tài Liệu"... chen giữa
  function readDS(texts) {
    for (const tx of texts) {
      const am = tx.match(/Đáp án đúng\s*:?([\s\S]*?)(?=Thí sinh|Câu làm sai|$)/i);
      if (!am) continue;
      const ans = {};
      am[1].replace(/(?:^|\s)([a-d])\s*\)\s*(Đúng|Sai|đúng|sai)/g, (m, l, v) => { ans[l] = /^đ/i.test(v) ? 'Đúng' : 'Sai'; return m; });
      if (!Object.keys(ans).length) continue;
      const head = tx.slice(0, tx.search(/Đáp án đúng/i));
      const at = head.search(/(^|\s)a\s*\)\s*\.?\s*\S/i);
      if (at < 0) continue;
      const body = head.slice(at), hits = [];
      let pos = 0;
      for (const L of 'abcd') {
        const re = new RegExp('(^|\\s)' + L + '\\s*\\)\\s*\\.?\\s*', 'gi');
        re.lastIndex = pos;
        const m = re.exec(body);
        if (!m) break;
        hits.push({ L, start: m.index + m[1].length, end: m.index + m[0].length });
        pos = m.index + m[0].length;
      }
      const items = [];
      hits.forEach((h, i) => { const t = flat(body.slice(h.end, i + 1 < hits.length ? hits[i + 1].start : body.length)); if (t && ans[h.L]) items.push({ q: DS + t, correct: ans[h.L] }); });
      if (items.length) return items;
    }
    return null;
  }
  // đọc 1 câu từ nhãn "Câu N": leo lên thẻ nhỏ nhất có "Đáp án đúng"; nếu thẻ gộp nhiều câu thì cắt đoạn từ "Câu N" tới "Câu kế tiếp"
  function readByLabel(labelEl, num) {
    for (let card = labelEl, i = 0; card && i < 12; card = card.parentElement, i++) {
      const tx = card.innerText || '';
      const c = (tx.match(/Đáp án đúng/gi) || []).length;
      if (!c) continue;
      let texts = cardTexts(card, tx), seg = tx;
      if (c > 1) {
        const segOf = (t, nl) => {
          const pre = nl ? '(^|\\n)\\s*' : '(^|\\s)';
          const m = new RegExp(pre + 'Câu\\s*' + num + '(?!\\d)').exec(t);
          if (!m) return '';
          const rest = t.slice(m.index);
          const nx = rest.slice(5).search(new RegExp(pre + 'Câu\\s*\\d+(?!\\d)'));
          return nx < 0 ? rest : rest.slice(0, nx + 5);
        };
        const s1 = segOf(tx, true), s2 = segOf(nodesText(card), false);
        if (!s1 && !s2) return { why: 'thẻ gộp nhiều câu', sample: tx };
        seg = s1 || s2;
        texts = (card.querySelector('img') ? [s2, s1] : [s1, s2]).filter(Boolean);
      }
      if (DS_ANS.test(seg)) { const items = readDS(texts); return items ? { ds: items } : { why: 'không đọc được các ý đúng/sai', sample: seg }; }
      const lm = seg.match(/Đáp án đúng\s*:?\s*([A-F])/i);
      if (!lm) return { why: 'không thấy chữ cái đáp án', sample: seg };
      const L = lm[1].toUpperCase();
      const r = readTexts(texts, L);
      return r || { why: 'thiếu phương án ' + L, sample: seg };
    }
    return { why: 'không tìm thấy thẻ câu', sample: '' };
  }
  const warnedFail = new Set();
  function learnNow() {
    // thoát sớm nếu trang không có chữ "Đáp án đúng" (đỡ tốn máy, nhất là trên điện thoại)
    if (!/Đáp án đúng/i.test(document.body.textContent || '')) return { n: 0, seen: 0, total: 0, missing: [] };
    let n = 0, seen = 0, tagged = 0;
    const code = examCode(), okNums = new Set(), okCards = [];
    const store = (q, correct, noSeen) => {
      if (!noSeen) seen++;
      const k = norm(q);
      if (bank[k] && norm(bank[k].correct) === norm(correct)) { if (code && bank[k].t !== code) { bank[k].t = code; tagged++; } return; }
      bank[k] = { q, correct, t: code || undefined };
      n++;
    };
    // 1) theo chữ "Đáp án đúng: X" (qua text node)
    const marks = [], used = new Set();
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node; (node = tw.nextNode());) {
      if (!/Đáp án đúng/i.test(node.nodeValue)) continue;
      let el = node.parentElement;
      for (let i = 0; i < 3 && el; i++, el = el.parentElement) {
        if (el.closest('#' + panelId)) { el = null; break; }
        const m = flat(el.textContent).match(ANS_RE);
        if (m) { if (!used.has(el)) { used.add(el); marks.push({ el, letter: m[1].toUpperCase() }); } break; }
      }
    }
    marks.forEach(({ el, letter }) => {
      let card = el.parentElement, text = '';
      for (let i = 0; i < 8 && card; i++, card = card.parentElement) {
        text = card.innerText || '';
        if (/Câu\s*\d+/i.test(text) && A_START.test(text)) break;
      }
      if (!card || (text.match(/Đáp án đúng\s*:/gi) || []).length !== 1) return;   // thẻ gộp nhiều câu: để bước 2 xử lý
      const r = readTexts(cardTexts(card, text), letter);
      if (!r) return;
      const num = (text.match(/Câu\s*(\d+)/i) || [])[1];
      if (num) okNums.add(num);
      okCards.push(card);
      store(r.q, r.correct);
    });
    // 2) theo nhãn "Câu N": đếm số câu trên trang và đọc lại những câu bước 1 bỏ sót
    const labelEls = [];
    const tw2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node; (node = tw2.nextNode());) {
      const m = node.nodeValue.match(/^\s*Câu\s*(\d+)\s*$/i);
      if (m && node.parentElement && !node.parentElement.closest('#' + panelId)) labelEls.push({ num: m[1], el: node.parentElement });
    }
    const okIdx = new Set(), why = {}, skip = new Set();
    labelEls.forEach((lb, i) => {
      if (okCards.some(c => c.contains(lb.el))) { okIdx.add(i); return; }
      const r = readByLabel(lb.el, lb.num);
      if (r.ds) { okIdx.add(i); seen++; r.ds.forEach(x => store(x.q, x.correct, true)); }
      else if (r.q === undefined && r.why) {
        // nhãn "Câu N" trùng số ở chỗ không phải thẻ câu (không có đáp án đi kèm): bỏ qua, không tính là câu thiếu
        if (r.why === 'không tìm thấy thẻ câu' && labelEls.some((o, k) => k !== i && o.num === lb.num && (okIdx.has(k) || k < i))) { skip.add(i); return; }
        why[i] = r.why;
        const wk = lb.num + '|' + r.why;
        if (!warnedFail.has(wk)) { warnedFail.add(wk); console.warn('[Azota Helper] Câu ' + lb.num + ': ' + r.why, JSON.stringify(String(r.sample || '').slice(0, 500))); }
      } else { okIdx.add(i); store(r.q, r.correct); }
    });
    if (n || tagged) saveBank();
    const missing = labelEls.map((lb, i) => ({ lb, i })).filter(x => !okIdx.has(x.i) && !skip.has(x.i)).sort((a, b) => a.lb.num - b.lb.num).map(x => x.lb.num + (why[x.i] ? ' (' + why[x.i] + ')' : ''));
    return { n, seen, total: labelEls.length - skip.size, missing };
  }

  // ---------- Chọn đáp án đã nhớ ----------
  // Với mỗi câu trong sổ: tìm đoạn chữ câu hỏi trên trang, rồi bấm vào ô có nội dung = đáp án đúng.
  const inTake = () => /take-test/.test(location.pathname);
  let clickedQ = new Set(), clickedUrl = location.href, learnedNow = 0, lastAct = 0;
  const hl = new Set();   // các ô đang được tô viền gợi ý

  function pageEls() {
    const all = [], withImg = new Set();
    document.querySelectorAll('img').forEach(im => { for (let p = im; p && !withImg.has(p); p = p.parentElement) withImg.add(p); });
    document.querySelectorAll('div, span, p, label, li, b, strong, button, img').forEach(el => {
      if (el.closest('#' + panelId) || !el.getClientRects().length) return;
      if (el.tagName === 'IMG') { const t = imgTok(el); if (t) all.push({ el, t }); return; }
      const raw = el.textContent;
      if ((!raw && !withImg.has(el)) || (raw && raw.length > 800)) return;
      all.push({ el, t: withImg.has(el) ? nodesText(el) : flat(raw) });
    });
    return all;
  }
  const deepest = list => list.filter(a => !list.some(b => b !== a && a.el.contains(b.el)));
  const isTok = t => /^⟦img:[^⟧]*⟧$/.test(t);
  const tokKey = t => t.slice(5, -1).toLowerCase().replace(/[?#].*$/, '').replace(/\.[a-z0-9]{2,5}$/, '').replace(/[-_](?:\d+x\d+|thumb|small|medium|large|origin|original)$/, '');
  const sameText = (a, b) => norm(a) === norm(b) || norm2(a) === norm2(b) || (isTok(a) && isTok(b) && tokKey(a) === tokKey(b));
  function press(el) {
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(t => {
      const Ev = t.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
      try { el.dispatchEvent(new Ev(t, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
    });
  }
  // Trả về { qEl } nếu thấy câu hỏi, kèm { card, target } nếu xác định được ô đáp án đúng
  function locate(rec, all) {
    const qEl = deepest(all.filter(a => sameText(a.t, rec.q)))[0];
    if (!qEl) return null;
    for (let card = qEl.el.parentElement, i = 0; card && i < 8; card = card.parentElement, i++) {
      if (((card.innerText || '').match(/(^|\n)\s*Câu\s*\d+/gi) || []).length > 1) return { qEl, why: 'thẻ gộp nhiều câu' };   // leo quá cao
      const hits = deepest(all.filter(a => card.contains(a.el) && !a.el.contains(qEl.el) && a.el !== qEl.el && sameText(a.t, cleanAns(rec.correct))));
      if (!hits.length) continue;
      if (hits.length > 1) return { qEl, why: hits.length + ' ô trùng nhau' };           // hai phương án trùng chữ: không đoán bừa
      return { qEl, card, target: hits[0].el };
    }
    return { qEl, why: 'không thấy ảnh đáp án' };
  }
  // Câu đúng/sai: tìm dòng chứa nội dung ý, rồi bấm nút "Đúng" / "Sai" trong dòng đó (nếu dòng chứa nhiều ý thì không đoán bừa)
  function locateDS(rec, all) {
    const k = norm2(rec.q.slice(DS.length));
    if (!k) return null;
    const stEl = deepest(all.filter(a => { const t = norm2(a.t); return t.length >= k.length && t.length <= k.length + 6 && t.includes(k); }))[0];
    if (!stEl) return null;
    for (let card = stEl.el.parentElement, i = 0; card && i < 6; card = card.parentElement, i++) {
      const hits = deepest(all.filter(a => card.contains(a.el) && !a.el.contains(stEl.el) && a.el !== stEl.el && sameText(a.t, cleanAns(rec.correct))));
      if (!hits.length) continue;
      if (hits.length > 1) return { qEl: stEl, noFallback: true };
      return { qEl: stEl, card, target: hits[0].el, noFallback: true };
    }
    return { qEl: stEl, noFallback: true };
  }
  const numOf = qEl => { for (let c = qEl.el.parentElement, i = 0; c && i < 6; c = c.parentElement, i++) { const m = (c.innerText || '').match(/(^|\n)\s*Câu\s*(\d+)/i); if (m) return m[2]; } return '?'; };
  const warnedImg = new Set();
  function dbgImg(rec, loc) {
    const key = norm(rec.q);
    if (warnedImg.has(key)) return;
    warnedImg.add(key);
    let card = loc.qEl.el.parentElement;
    for (let i = 0; i < 8 && card; i++, card = card.parentElement) if (card.querySelectorAll('img').length >= 2) break;
    const imgs = card ? [...card.querySelectorAll('img')].map(im => { const r = im.getBoundingClientRect(); return (imgTok(im) || '(bị bỏ qua)') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' src=' + String(im.currentSrc || im.src || im.getAttribute('data-src') || '').slice(-70); }) : [];
    console.warn('[Azota Helper] không khớp ảnh đáp án (' + (loc.why || '?') + ') cho: ' + rec.q.slice(0, 60) + '\n  cần: ' + rec.correct + '\n  ảnh tìm thấy trong câu này:\n  ' + (imgs.join('\n  ') || '(không thấy thẻ <img> nào)'));
  }
  const clearHl = () => { hl.forEach(el => { el.style.outline = ''; el.style.outlineOffset = ''; }); hl.clear(); };

  function selectNow() {
    if (clickedUrl !== location.href) { clickedUrl = location.href; clickedQ = new Set(); clearHl(); }
    const recs = usableRecs();
    const all = pageEls();
    const pageQ = new Set();
    all.forEach(a => { const m = a.t.match(/^Câu\s*(\d+)$/i); if (m) pageQ.add(m[1]); });
    if (!recs.length) return { found: 0, done: 0, page: pageQ.size, bankN: 0 };
    const active = cfg.run && cfg.select;
    if (active) clearHl();
    let found = 0, dsFound = 0;
    const imgFail = [];
    for (const rec of recs) {
      const isDS = rec.q.startsWith(DS);
      const loc = isDS ? locateDS(rec, all) : locate(rec, all);
      if (!loc) continue;
      if (isDS) dsFound++; else found++;
      if (!loc.target) { if (!isDS && /^⟦img:/.test(rec.correct)) { dbgImg(rec, loc); imgFail.push('Câu ' + numOf(loc.qEl) + ' (' + (loc.why || '?') + ')'); } continue; }
      const key = norm(rec.q);
      if (clickedQ.has(key)) continue;               // mỗi câu chỉ chọn 1 lần, không đè lên lựa chọn của bạn
      if (!active) {                                 // chỉ gợi ý: tô viền đáp án đã nhớ
        loc.target.style.outline = '3px solid #ff6fb0'; loc.target.style.outlineOffset = '2px'; hl.add(loc.target);
        continue;
      }
      const t = Date.now();
      if (t - lastAct < cfg.delay) break;            // giữ nhịp theo độ trễ đã chỉnh
      const { card, target } = loc, before = card.outerHTML;
      clickedQ.add(key); lastAct = t;
      press(target);
      // nếu trang chưa đổi gì thì thử bấm vòng tròn chữ cái / cả hàng
      setTimeout(() => {
        if (loc.noFallback || card.outerHTML !== before) return;
        const row = target.parentElement;
        if (row && row.children[0] && row.children[0] !== target) press(row.children[0]);
        setTimeout(() => { if (card.outerHTML === before && row) press(row); }, 400);
      }, 500);
      if (cfg.delay > 0) break;                      // có độ trễ: mỗi nhịp chỉ chọn 1 câu
    }
    return { imgFail, found: found + Math.floor(dsFound / 4), ds: dsFound, done: clickedQ.size, page: pageQ.size, bankN: recs.length };
  }

  // ---------- Giao diện: trạng thái ----------
  const FACES = [
    [/trống/, '(・ω・)'], [/học thêm|vừa học/, '(≧▽≦)'], [/đã chọn|khớp/, '(๑•̀ㅂ•́)و✧'],
    [/tạm dừng/, '(－ω－) zzZ'], [/đang chạy/, '(＾▽＾)'], [/xuất|nhập/, '(๑˃ᴗ˂)ﻭ'],
    [/xoá/, '(・ω・)'], [/chờ|quét/, '(・・?)']
  ];
  const faceFor = m => { const f = FACES.find(x => x[0].test(m)); return f ? f[1] : '(◕‿◕)'; };

  let lastMsg = '', lastShown = '', lastN = -1;
  function stat(msg, fromTick) {
    if (msg !== undefined) lastMsg = msg;
    if (msg && !fromTick) holdUntil = Date.now() + 5000;
    const n = usableRecs().length;
    const m = (lastMsg || 'sẵn sàng nè ~') + (ghNote ? ' · ' + ghNote : '');
    const sig = n + '|' + m;
    if (sig === lastShown) return;
    lastShown = sig;
    $('cnt').textContent = n; $('badge').textContent = n > 99 ? '99+' : n;
    $('face').textContent = faceFor(lastMsg || '');
    $('st').textContent = m;
    const bub = panel.querySelector('.azh-bubble');
    bub.classList.remove('pop'); void bub.offsetWidth; bub.classList.add('pop');
    if (lastN !== -1 && n !== lastN) {
      const c = $('cnt'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
    }
    lastN = n;
  }
  function prog(found, page) {
    $('pt').textContent = page ? `${found}/${page}` : (found ? `${found}` : '–');
    $('pb').style.width = (page ? Math.min(100, Math.round(found / page * 100)) : 0) + '%';
  }
  const runLabel = () => {
    const b = $('run');
    b.textContent = cfg.run ? 'Tạm dừng' : 'Chạy nào!';
    b.className = 'azh-runbtn ' + (cfg.run ? 'on' : 'off');
    panel.classList.toggle('running', !!cfg.run);
  };
  const fillSpd = () => $('spd').style.setProperty('--p', (cfg.delay / 20) + '%');

  $('sel').checked = cfg.select; $('sel').onchange = e => { cfg.select = e.target.checked; saveCfg(); stat(cfg.select ? 'tự chọn đã bật' : 'tự chọn đã tắt, chỉ tô viền gợi ý'); };
  $('lrn').checked = cfg.learn;  $('lrn').onchange = e => { cfg.learn = e.target.checked; saveCfg(); stat(cfg.learn ? 'tự học đã bật' : 'tự học đã tắt, không quét đáp án nữa'); };
  $('spd').value = cfg.delay; $('ms').textContent = cfg.delay; fillSpd();
  $('spd').oninput = e => { cfg.delay = +e.target.value; $('ms').textContent = cfg.delay; fillSpd(); saveCfg(); };
  $('run').onclick = () => { cfg.run = !cfg.run; runLabel(); saveCfg(); if (!cfg.run) clearHl(); stat(cfg.run ? 'đang chạy, cố lên!' : 'đã tạm dừng'); };
  runLabel(); stat('');

  // ---------- Sổ đáp án: xem, tìm, xoá từng câu ----------
  function renderBook() {
    const f = norm($('q').value);
    const entries = usableEntries().filter(([, v]) => !f || norm(v.q).includes(f) || norm(v.correct).includes(f));
    const box = $('list');
    box.textContent = '';
    if (!entries.length) {
      const d = document.createElement('div');
      d.className = 'azh-empty';
      d.textContent = usableRecs().length ? 'không có câu nào khớp ~' : 'đề này chưa có đáp án, hãy mở trang xem đáp án';
      box.appendChild(d);
      return;
    }
    entries.slice(0, 200).forEach(([k, v]) => {
      const it = document.createElement('div'); it.className = 'azh-item';
      const q = document.createElement('div'); q.className = 'q'; q.textContent = v.q;
      const a = document.createElement('div'); a.className = 'a'; a.textContent = '→ ' + v.correct;
      const x = document.createElement('button'); x.className = 'x'; x.type = 'button'; x.textContent = '×'; x.title = 'Xoá câu này';
      x.onclick = () => { delete bank[k]; saveBank(); clickedQ.delete(k); renderBook(); stat('đã xoá 1 câu'); };
      it.append(q, a, x); box.appendChild(it);
    });
    if (entries.length > 200) {
      const d = document.createElement('div'); d.className = 'azh-empty';
      d.textContent = `…còn ${entries.length - 200} câu nữa, hãy gõ để lọc`; box.appendChild(d);
    }
  }
  const showBook = on => {
    $('mainv').style.display = on ? 'none' : 'block'; $('bookv').style.display = on ? 'block' : 'none';
    if (on) { renderBook(); if (!COARSE) $('q').focus(); }   // điện thoại: không tự bật bàn phím
    else $('body').scrollTop = 0;
  };
  $('book').onclick = () => showBook(true);
  $('back').onclick = () => showBook(false);
  $('q').oninput = renderBook;

  // ---------- Lưu lên GitHub (token nhập mỗi lần, dùng xong bỏ, không lưu) ----------
  const GHC = { user: 'Huy7684', repo: 'School', branch: 'main', dir: 'sakura-repo/', site: 'azota' };
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
    if (!all.length) return stat('sổ đang trống, chưa có gì để lưu');
    let tok = prompt('Dán GitHub token để lưu (dùng 1 lần, không được lưu lại)\nSổ chung: ' + all.length + ' câu' + (code ? '\nĐề ' + code + ': ' + mine.length + ' câu' : '\n(chưa nhận ra mã đề)'), '');
    if (!tok || !tok.trim()) return stat('đã huỷ, chưa lưu');
    tok = tok.trim();
    pushing = true;
    stat('đang lưu lên GitHub...');
    try {
      const r1 = await ghPushFile(tok, `banks/${GHC.site}.txt`, all.map(pair));
      if (r1.err) return stat(r1.err);
      let r2 = { n: 0 };
      if (code && mine.length) { r2 = await ghPushFile(tok, `banks/${GHC.site}/${code}.txt`, mine.map(pair)); if (r2.err) return stat(r2.err); }
      stat(r1.n || r2.n ? `đã lưu: sổ chung +${r1.n}` + (code && mine.length ? `, đề ${code} +${r2.n}` : '') : 'sổ đã khớp GitHub, không có gì mới');
    } finally { tok = null; pushing = false; }
  }

  // ---------- Tải từ GitHub ----------
  $('gpush').onclick = pushGithub;
  const codeEl = $('code');
  codeEl.value = '';

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
      items.forEach(([q, c]) => { bank[norm(q)] = { q, correct: cleanAns(c), t: code }; });
      saveBank();
      ghNote = `đề ${code}: đã tải ${items.length} câu từ GitHub`;
    } else if (r.s === 404) ghNote = `đề ${code} không có trên GitHub`;
    else if (r.s === 0) ghNote = 'không kết nối được GitHub';
    else if (r.s === 403) ghNote = 'GitHub đang giới hạn lượt gọi, thử lại sau';
    else ghNote = 'lỗi GitHub HTTP ' + r.s;
    stat();
  }
  $('gpull').onclick = () => { stat('tải lại từ GitHub...'); pullExam(examCode()); };
  codeEl.onchange = () => {
    manualCode = extractCode(codeEl.value); codeEl.value = manualCode;
    stat(manualCode ? 'mã đề: ' + manualCode : 'dùng mã tự nhận từ trang: ' + (autoCode() || 'không có'));
    pullExam(examCode());
  };
  setInterval(() => { const h = 'Link / mã đề (tự nhận: ' + (autoCode() ? 'azota.vn/de-thi/' + autoCode() : 'không có') + ')'; if (codeEl.placeholder !== h) codeEl.placeholder = h; }, 1500);

  // vào link nào tự nhận mã đề link đó và tự tải file từ GitHub; sang link khác thì bỏ mã cũ
  let lastAuto = null;
  function watchUrl() {
    const c = autoCode();
    if (c === lastAuto) return;
    lastAuto = c; manualCode = ''; codeEl.value = ''; ghNote = ''; clearHl();
    if (c) pullExam(c); else stat();
  }
  setInterval(watchUrl, 700); watchUrl();

  document.addEventListener('sakura-status', e => { bank = load(BANK_KEY) || {}; stat(String(e.detail || '')); });

  // ---------- Xuất / nhập .txt ----------
  $('exp').onclick = () => {
    const lines = Object.values(bank).filter(r => r && r.q && r.correct).map(r => flat(r.q) + SEP + flat(r.correct));
    const head = ['# Azota Helper - sổ đáp án', '# Mỗi dòng: câu hỏi ||| đáp án đúng', ''];
    downloadTxt('azota-dap-an.txt', head.concat(lines).join('\n') + '\n');
    stat(`đã xuất ${lines.length} câu`);
  };
  $('imp').onclick = () => $('file').click();
  $('file').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      let add = 0, bad = 0;
      String(rd.result).replace(/^\uFEFF/, '').split(/\r?\n/).forEach(line => {
        line = line.trim();
        if (!line || line.startsWith('#')) return;
        const i = line.lastIndexOf('|||');
        const q = i < 0 ? '' : flat(line.slice(0, i)), c = i < 0 ? '' : flat(line.slice(i + 3));
        if (!q || !c) { bad++; return; }
        if (!bank[norm(q)]) add++;
        bank[norm(q)] = { q, correct: cleanAns(c), t: examCode() || undefined };
      });
      saveBank(); stat(`nhập +${add} câu mới` + (bad ? `, bỏ ${bad} dòng lỗi` : ''));
    };
    rd.readAsText(f, 'utf-8'); e.target.value = '';
  };
  $('clr').onclick = () => {
    const n = Object.keys(bank).length;
    if (!n) return stat('sổ đang trống');
    if (confirm(`Xoá toàn bộ ${n} câu đã nhớ trong trình duyệt?\n(Nên bấm "Xuất .txt" trước nếu muốn giữ bản sao.)`)) {
      bank = {}; saveBank(); clickedQ = new Set(); clearHl(); stat(`đã xoá ${n} câu`);
    }
  };

  // ---------- Vòng lặp (trang là SPA nên quét định kỳ) ----------
  const ts = m => { if (Date.now() >= holdUntil) stat(m, true); };
  function tick() {
    if (inTake()) {
      const r = selectNow();
      prog(r.found, r.page);
      if (!r.bankN) return ts('chưa có đáp án cho đề này');
      if (!cfg.run) return ts('đã tạm dừng' + (r.found ? `, tô viền ${r.found} câu đã nhớ` : ''));
      if (!cfg.select) return ts(`tự chọn đang tắt, tô viền gợi ý ${r.found} câu`);
      return ts(`khớp ${r.found}/${r.page || r.bankN} câu` + (r.ds ? ` (${r.ds} ý đúng/sai)` : '') + `, đã chọn ${r.done}` + (r.imgFail && r.imgFail.length ? ' — chưa chọn được: ' + r.imgFail.join('; ') : ''));
    }
    prog(0, 0);
    if (!cfg.run) return ts('đã tạm dừng, không quét đáp án');
    if (!cfg.learn) return ts('tự học đang tắt, không quét đáp án');
    const r = learnNow();
    learnedNow += r.n;
    if (r.seen) ts(`đã quét ${r.seen}${r.total ? '/' + r.total : ''} câu, học thêm ${learnedNow} câu mới` + (r.missing.length ? ` — chưa đọc được: Câu ${r.missing.join('; Câu ')}` : ''));
    else ts('chờ trang xem đáp án để quét…');
  }
  // điện thoại quét thưa hơn một chút cho đỡ nóng máy; tab ẩn thì gần như nghỉ
  function loop() {
    try { if (!document.hidden) tick(); } catch (e) { console.error('Azota Helper:', e); }
    const fast = inTake() && cfg.run && cfg.select && cfg.delay > 0 && cfg.delay < 600;
    setTimeout(loop, document.hidden ? 1500 : (fast ? Math.max(COARSE ? 300 : 150, cfg.delay / 2) : 1000));
  }
  loop();
})();
