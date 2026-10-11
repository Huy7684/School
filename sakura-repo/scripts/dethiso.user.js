// ==UserScript==
// @name         DeThiSo Helper
// @namespace    https://dethiso.vn/
// @version      11.5
// @description  Sakura Edition: học đáp án đúng sau mỗi lần Kiểm tra, xuất/nhập .txt, tự chọn - kiểm tra - chuyển câu với tốc độ chỉnh được
// @match        https://dethiso.vn/*
// @match        https://*.dethiso.vn/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// DeThiSo Helper v11 - máy trạng thái tự động: tự thử lại khi kẹt, chỉnh tốc độ, tự chuyển câu sau khi học
(function () {
  'use strict';
  if (window.__dts11) { console.log('v11 đã chạy. Reload để chạy lại.'); return; }
  window.__dts11 = true;

  const BANK_KEY = 'dts10-bank';   // giữ khoá cũ để không mất sổ đã học
  const CFG_KEY = 'dts11-cfg';
  const SEP = ' ||| ';
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const flat = s => String(s || '').replace(/\s+/g, ' ').trim();
  const norm2 = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const stripNo = s => String(s || '').replace(/^\s*Câu\s*\d+\s*\/\s*\d+\s*/i, '');
  const loadKey = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };

  // ---------- Sổ đáp án ----------
  let idx2 = null; // chỉ mục dự phòng (bỏ dấu câu/khoảng trắng) để đỡ "miss" vì khác định dạng
  let bank = loadKey(BANK_KEY) || {};
  const saveBank = () => { idx2 = null; try { localStorage.setItem(BANK_KEY, JSON.stringify(bank)); } catch (e) {} };
  // Nhập MỘT LẦN từ sổ cũ v9 / v8.1 rồi xoá khoá cũ, để nút "Xoá sổ" không bị nhập lại sau khi tải lại trang
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
    saveBank();
    ks.forEach(k => localStorage.removeItem(k));
  } catch (e) {}
  function findRec(q) {
    const r = bank[norm(q)];
    if (r) return usable(r) ? r : null;
    if (!idx2) { idx2 = {}; Object.values(bank).forEach(v => { idx2[norm2(stripNo(v.q))] = v; }); }
    const v = idx2[norm2(stripNo(q))];
    return v && usable(v) ? v : null;
  }
  function matchLetter(texts, correct) {
    const L = Object.keys(texts);
    return L.find(k => norm(texts[k]) === norm(correct)) || L.find(k => norm2(texts[k]) === norm2(correct)) || null;
  }

  // ---------- Cấu hình (lưu lại) ----------
  const cfg = Object.assign({ run: true, sel: true, chk: true, next: true, delay: 300, unk: 'wait' }, loadKey(CFG_KEY) || {});
  delete cfg.code;                       // không còn nhớ mã đề giữa các link
  let manualCode = '';                   // mã gõ tay: chỉ sống trong 1 link
  let ghNote = '';                       // ghi chú GitHub hiện cạnh trạng thái

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
  const isExam = () => /\/exam\//i.test(location.pathname);
  const autoCode = () => isExam() ? extractCode(location.href) : '';
  const examCode = () => extractCode(manualCode) || autoCode();
  // chỉ dùng đáp án của đề đang mở (đã gắn mã đề). Đổi false nếu muốn dùng chung cả sổ.
  const STRICT_EXAM = true;
  const usable = r => r && r.q && r.correct && (!STRICT_EXAM || !examCode() || r.t === examCode());
  const usableRecs = () => Object.values(bank).filter(usable);
  const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {} };

  // ---------- Trạng thái tự động ----------
  let lastSnap = null;          // snapshot gần nhất lúc câu CHƯA kiểm tra
  let st = { key: null };       // thao tác của câu hiện tại (chọn / kiểm tra)
  let stN = { sig: null };      // thao tác bấm "Tiếp" của câu đã kiểm tra
  let lastAct = 0;
  const now = () => Date.now();
  const gapOk = () => now() - lastAct >= cfg.delay;
  const chkRetry = () => Math.max(3000, cfg.delay * 5);
  const nextRetry = () => Math.max(2500, cfg.delay * 4);

  // ---------- UI (Sakura Edition, nhiều hiệu ứng, không icon emoji) ----------
  const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const css = document.createElement('style');
  css.textContent = `
  #dts11{position:fixed;top:80px;right:20px;width:320px;z-index:999999;font:13px/1.4 "Segoe UI",system-ui,sans-serif;color:#4a3b5c;
    border-radius:26px;overflow:hidden;border:2.5px solid transparent;
    background:linear-gradient(165deg,#fff4fa,#eee8ff 55%,#e2f3ff) padding-box,
               linear-gradient(90deg,#ff8fc2,#c19bff,#86cfff,#ff8fc2) border-box;
    background-size:100% 100%,600px 100%;background-repeat:no-repeat,repeat-x;
    box-shadow:0 18px 50px rgba(190,100,170,.4);
    animation:dts11-in .7s cubic-bezier(.2,1.5,.4,1) both,dts11-border 5s linear infinite,dts11-glow 3.2s ease-in-out infinite}
  #dts11 *{box-sizing:border-box}
  #dts11 button{font:inherit;cursor:pointer;border:0;position:relative;overflow:hidden}

  /* header */
  #dts11-head{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 12px 13px;overflow:hidden;
    background:linear-gradient(120deg,#ff7fb8,#c19bff 55%,#7fc8ff,#ff7fb8);background-size:240% 100%;animation:dts11-flow 7s linear infinite;
    color:#fff;cursor:move;user-select:none}
  #dts11-head::before{content:"";position:absolute;top:0;bottom:0;left:-60%;width:40%;
    background:linear-gradient(100deg,transparent,rgba(255,255,255,.65),transparent);transform:skewX(-20deg);animation:dts11-sweep 3.8s ease-in-out infinite}
  #dts11-head::after{content:"";position:absolute;left:0;right:0;bottom:0;height:4px;
    background:repeating-linear-gradient(90deg,rgba(255,255,255,.85) 0 7px,transparent 7px 14px);opacity:.5}
  #dts11.running #dts11-head::after{animation:dts11-march .7s linear infinite;opacity:.95}
  .dts11-logo{position:relative;z-index:1;display:flex;align-items:center;gap:9px;min-width:0}
  .dts11-title{font-weight:800;font-size:14px;letter-spacing:.3px;text-shadow:0 1px 5px rgba(150,40,120,.6);white-space:nowrap}
  .dts11-sub{font-size:10px;letter-spacing:.8px;opacity:.95;text-shadow:0 1px 3px rgba(150,40,120,.55)}
  .dts11-hbtns{position:relative;z-index:1;display:flex;gap:6px;align-items:center;flex:none}

  /* mascot: hoa anh đào vẽ bằng CSS */
  .dts11-mascot{position:relative;width:38px;height:38px;flex:none;border-radius:50%;background:rgba(255,255,255,.92);
    box-shadow:0 0 0 3px rgba(255,255,255,.35),0 3px 10px rgba(150,40,120,.4);animation:dts11-bob 2.6s ease-in-out infinite}
  .dts11-flower{position:absolute;inset:0;animation:dts11-spin 14s linear infinite}
  .dts11-flower i{position:absolute;left:50%;top:50%;width:10px;height:14px;margin:-14px 0 0 -5px;transform-origin:50% 100%;
    border-radius:50% 50% 50% 50%/75% 75% 25% 25%;background:linear-gradient(180deg,#ffe0ee,#ff7fb8)}
  .dts11-flower::after{content:"";position:absolute;left:50%;top:50%;width:7px;height:7px;margin:-3.5px;border-radius:50%;
    background:radial-gradient(circle,#fff6a8,#ffc55c);box-shadow:0 0 6px #ffd37a}

  /* nút đầu trang */
  .dts11-runbtn{padding:6px 12px;border-radius:999px;font-weight:800;font-size:11.5px;transition:transform .15s}
  .dts11-runbtn:hover{transform:translateY(-1px) scale(1.06)}
  .dts11-runbtn:active{transform:scale(.95)}
  .dts11-runbtn.on{background:#fff;color:#e0559b;box-shadow:0 2px 10px rgba(120,40,110,.35)}
  .dts11-runbtn.off{background:#fff3a0;color:#a65a00;animation:dts11-pulse 1.3s ease-in-out infinite}
  .dts11-minbtn{width:27px;height:27px;border-radius:50%;background:rgba(255,255,255,.35);color:#fff;font-size:16px;font-weight:800;line-height:1;padding:0;transition:transform .2s,background .2s}
  .dts11-minbtn:hover{background:rgba(255,255,255,.65);transform:rotate(90deg)}

  /* thân */
  #dts11-body{position:relative;z-index:1;padding:13px}
  .dts11-fx{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:0}
  .dts11-fx .pt{position:absolute;top:-18px;border-radius:150% 0 150% 0;opacity:.8;animation:dts11-fall linear infinite;
    background:linear-gradient(135deg,#ffd0e5,#ff8fc2)}
  .dts11-fx .sp{position:absolute;background:#fff;clip-path:polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%);
    filter:drop-shadow(0 0 3px #ff9cc9);animation:dts11-twinkle ease-in-out infinite}
  .dts11-fx .sp.v{background:#d9c8ff;filter:drop-shadow(0 0 3px #a98bff)}
  .dts11-fx .sp.b{background:#cdeaff;filter:drop-shadow(0 0 3px #6fc0ff)}
  .dts11-main{position:relative;z-index:1}

  .dts11-chip{display:flex;justify-content:space-between;align-items:center;padding:6px 12px;margin-bottom:12px;border-radius:999px;font-weight:700;font-size:11.5px;
    color:#fff;letter-spacing:.4px;background:linear-gradient(90deg,#ff7fb8,#b69bff,#7fc8ff);background-size:200% 100%;animation:dts11-flow 5s linear infinite;
    box-shadow:0 3px 12px rgba(180,90,170,.35)}
  .dts11-chip b{font-size:15px;display:inline-block;text-shadow:0 1px 4px rgba(120,40,110,.5)}
  .dts11-chip b.bump{animation:dts11-bump .5s cubic-bezier(.3,1.8,.5,1)}

  .dts11-bubble{position:relative;display:flex;align-items:center;gap:9px;padding:9px 11px;margin-bottom:12px;border-radius:18px;
    background:#fff;border:2px dashed #ffb3d4;box-shadow:0 3px 12px rgba(200,110,170,.2)}
  .dts11-bubble.pop{animation:dts11-pop .45s cubic-bezier(.3,1.7,.5,1)}
  .dts11-bubble::before{content:"";position:absolute;top:-8px;left:24px;width:12px;height:12px;background:#fff;
    border-left:2px dashed #ffb3d4;border-top:2px dashed #ffb3d4;transform:rotate(45deg)}
  #dts11-face{font-weight:800;color:#e0559b;white-space:nowrap;font-size:12.5px;animation:dts11-wob 1.8s ease-in-out infinite}
  #dts11-st{color:#6b5a85;font-size:12px;word-break:break-word}

  .dts11-sw{display:flex;align-items:center;gap:10px;padding:6px 6px;cursor:pointer;border-radius:12px;transition:background .2s,transform .2s}
  .dts11-sw:hover{background:linear-gradient(90deg,rgba(255,160,205,.22),transparent);transform:translateX(3px)}
  .dts11-sw input{position:absolute;opacity:0;pointer-events:none}
  .dts11-sw i{position:relative;flex:none;width:40px;height:23px;border-radius:999px;background:#ddd3ea;transition:background .3s,box-shadow .3s;box-shadow:inset 0 1px 3px rgba(80,40,100,.28)}
  .dts11-sw i::after{content:"";position:absolute;top:2.5px;left:2.5px;width:18px;height:18px;border-radius:50%;background:#fff;
    box-shadow:0 1px 4px rgba(80,40,100,.4);transition:transform .35s cubic-bezier(.3,1.9,.5,1)}
  .dts11-sw input:checked + i{background:linear-gradient(90deg,#ff7fb8,#b69bff);box-shadow:0 0 12px rgba(255,127,184,.7)}
  .dts11-sw input:checked + i::after{transform:translateX(17px)}
  .dts11-sw input:focus-visible + i{outline:2px solid #b69bff;outline-offset:2px}
  .dts11-sw span{font-weight:600}

  .dts11-box{margin:10px 0;padding:10px 11px;border-radius:16px;background:rgba(255,255,255,.75);border:1px solid rgba(255,170,210,.5);
    border-left:4px solid #ff8fc2;transition:box-shadow .25s,transform .25s}
  .dts11-box:hover{box-shadow:0 5px 16px rgba(200,110,170,.25);transform:translateY(-1px)}
  .dts11-box small{color:#8b7aa3}
  #dts11-ms{color:#e0559b;font-size:14px}
  #dts11-spd{-webkit-appearance:none;appearance:none;width:100%;height:9px;margin:10px 0 3px;border-radius:999px;outline:0;
    background:linear-gradient(90deg,#ff7fb8 var(--p,15%),#eadcf6 var(--p,15%))}
  #dts11-spd::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;border-radius:50%;border:3px solid #fff;
    background:radial-gradient(circle at 35% 35%,#fff 0 16%,#ff6fb0 18%);box-shadow:0 2px 10px rgba(200,70,140,.6);cursor:grab;transition:transform .15s}
  #dts11-spd::-webkit-slider-thumb:hover{transform:scale(1.2)}
  #dts11-spd::-webkit-slider-thumb:active{transform:scale(1.35);cursor:grabbing}
  #dts11-spd::-moz-range-thumb{width:16px;height:16px;border-radius:50%;border:3px solid #fff;background:#ff6fb0;box-shadow:0 2px 10px rgba(200,70,140,.6);cursor:grab}
  #dts11-unk{width:100%;margin-top:6px;padding:7px 9px;border-radius:12px;border:2px solid #ffc2dc;background:#fff;color:#4a3b5c;font:inherit;outline:0;transition:border-color .2s,box-shadow .2s}
  #dts11-unk:hover,#dts11-unk:focus{border-color:#b69bff;box-shadow:0 0 0 4px rgba(182,155,255,.2)}

  .dts11-acts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
  .dts11-act{padding:8px 10px;border-radius:999px;font-weight:700;font-size:12px;color:#fff;
    background:linear-gradient(90deg,#ff7fb8,#b69bff);box-shadow:0 4px 12px rgba(180,90,170,.35);transition:transform .2s,box-shadow .2s}
  .dts11-act::after{content:"";position:absolute;top:0;bottom:0;left:-70%;width:40%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.7),transparent);transform:skewX(-20deg);transition:left .6s}
  .dts11-act:hover{transform:translateY(-3px);box-shadow:0 8px 18px rgba(180,90,170,.45)}
  .dts11-act:hover::after{left:130%}
  .dts11-act:active{transform:translateY(0) scale(.96)}
  .dts11-act.alt{background:linear-gradient(90deg,#6fc4ff,#b69bff)}
  .dts11-act.danger{grid-column:1/-1;background:linear-gradient(90deg,#ff8fa3,#ffb0c8)}
  .dts11-rip{position:absolute;border-radius:50%;background:rgba(255,255,255,.65);transform:scale(0);animation:dts11-rip .6s ease-out forwards;pointer-events:none}
  .dts11-foot{text-align:center;margin-top:11px;font-size:10.5px;letter-spacing:1px;color:#a58cc0}
  .dts11-trail{position:absolute;width:9px;height:9px;margin:-4px;border-radius:150% 0 150% 0;pointer-events:none;z-index:5;animation:dts11-trail .8s ease-out forwards}

  @keyframes dts11-in{from{opacity:0;transform:translateY(-24px) scale(.82) rotate(-2deg)}to{opacity:1;transform:none}}
  @keyframes dts11-border{from{background-position:0 0,0 0}to{background-position:0 0,600px 0}}
  @keyframes dts11-glow{0%,100%{box-shadow:0 18px 50px rgba(190,100,170,.35),0 0 18px rgba(255,143,194,.3)}50%{box-shadow:0 18px 56px rgba(150,120,230,.45),0 0 34px rgba(182,155,255,.55)}}
  @keyframes dts11-flow{from{background-position:0 0}to{background-position:240% 0}}
  @keyframes dts11-sweep{0%{left:-60%}55%,100%{left:140%}}
  @keyframes dts11-march{from{background-position:0 0}to{background-position:14px 0}}
  @keyframes dts11-bob{0%,100%{transform:translateY(0) rotate(-5deg)}50%{transform:translateY(-4px) rotate(5deg)}}
  @keyframes dts11-spin{to{transform:rotate(360deg)}}
  @keyframes dts11-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,243,160,.95)}50%{box-shadow:0 0 0 9px rgba(255,243,160,0)}}
  @keyframes dts11-fall{0%{transform:translate(0,0) rotate(0)}25%{transform:translate(16px,120px) rotate(120deg)}50%{transform:translate(-10px,240px) rotate(240deg)}75%{transform:translate(14px,360px) rotate(360deg)}100%{transform:translate(-6px,520px) rotate(480deg)}}
  @keyframes dts11-twinkle{0%,100%{opacity:0;transform:scale(.2) rotate(0)}50%{opacity:1;transform:scale(1) rotate(90deg)}}
  @keyframes dts11-bump{0%{transform:scale(1)}40%{transform:scale(1.7) rotate(-6deg)}100%{transform:scale(1)}}
  @keyframes dts11-pop{0%{transform:scale(.9)}60%{transform:scale(1.04)}100%{transform:scale(1)}}
  @keyframes dts11-wob{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
  @keyframes dts11-rip{to{transform:scale(1);opacity:0}}
  @keyframes dts11-trail{0%{opacity:.95;transform:translate(0,0) rotate(0) scale(1)}100%{opacity:0;transform:translate(var(--dx),var(--dy)) rotate(var(--r)) scale(.3)}}
  @media (prefers-reduced-motion:reduce){#dts11,#dts11 *{animation:none!important;transition:none!important}}
  `;
  document.head.appendChild(css);

  const rnd = (a, b) => a + Math.random() * (b - a);
  const petals = Array.from({ length: 18 }, () => {
    const s = rnd(7, 15).toFixed(1);
    return `<span class="pt" style="left:${rnd(0, 96).toFixed(0)}%;width:${s}px;height:${s}px;animation-duration:${rnd(6, 13).toFixed(1)}s;animation-delay:${(-rnd(0, 12)).toFixed(1)}s"></span>`;
  }).join('');
  const sparks = Array.from({ length: 12 }, (_, i) => {
    const s = rnd(8, 16).toFixed(0);
    return `<span class="sp ${['', 'v', 'b'][i % 3]}" style="left:${rnd(2, 94).toFixed(0)}%;top:${rnd(2, 94).toFixed(0)}%;width:${s}px;height:${s}px;animation-duration:${rnd(2.2, 4.5).toFixed(1)}s;animation-delay:${(-rnd(0, 4)).toFixed(1)}s"></span>`;
  }).join('');
  const flower = [0, 1, 2, 3, 4].map(i => `<i style="transform:rotate(${i * 72}deg)"></i>`).join('');

  const panel = document.createElement('div');
  panel.id = 'dts11';
  panel.innerHTML = `
    <div id="dts11-head">
      <div class="dts11-logo">
        <div class="dts11-mascot"><div class="dts11-flower">${flower}</div></div>
        <div><div class="dts11-title">HuyDz</div><div class="dts11-sub">v11.4 · 桜 SAKURA EDITION</div></div>
      </div>
      <div class="dts11-hbtns">
        <button id="dts11-run" class="dts11-runbtn"></button>
        <button id="dts11-min" class="dts11-minbtn" title="Thu gọn">–</button>
      </div>
    </div>
    <div id="dts11-body">
      <div class="dts11-fx">${petals}${sparks}</div>
      <div class="dts11-main">
        <div class="dts11-chip"><span>SỔ ĐÁP ÁN</span><span><b id="dts11-cnt">0</b> câu</span></div>
        <div class="dts11-bubble"><span id="dts11-face">(◕‿◕)</span><span id="dts11-st"></span></div>

        <label class="dts11-sw"><input type="checkbox" id="dts11-sel"><i></i><span>Tự chọn đáp án đã nhớ</span></label>
        <label class="dts11-sw"><input type="checkbox" id="dts11-chk"><i></i><span>Tự bấm "Kiểm tra"</span></label>
        <label class="dts11-sw"><input type="checkbox" id="dts11-next"><i></i><span>Tự bấm "Tiếp"</span></label>

        <div class="dts11-box">
          Độ trễ mỗi bước: <b id="dts11-ms"></b> ms <small>(0 = nhanh nhất)</small>
          <input type="range" id="dts11-spd" min="0" max="2000" step="50">
        </div>
        <div class="dts11-box">
          Câu chưa biết
          <select id="dts11-unk">
            <option value="wait">Dừng chờ tôi tự làm</option>
            <option value="guess">Chọn A rồi Kiểm tra (để học)</option>
          </select>
        </div>

        <div class="dts11-acts">
          <input id="dts11-code" type="text" spellcheck="false" style="grid-column:1/-1;width:100%;padding:8px 12px;border-radius:999px;border:1.5px solid #e3b6e8;background:rgba(255,255,255,.85);font:12px 'Segoe UI',sans-serif;color:#4a3b5c;outline:0">
          <button id="dts11-gpull" class="dts11-act" style="grid-column:1/-1">Tải đáp án từ GitHub</button>
          <button id="dts11-gpush" class="dts11-act alt" style="grid-column:1/-1">Lưu sổ lên GitHub</button>
          <button id="dts11-exp" class="dts11-act">Xuất .txt</button>
          <button id="dts11-imp" class="dts11-act alt">Nhập .txt</button>
          <button id="dts11-clr" class="dts11-act danger" title="Xoá toàn bộ câu đã nhớ">Xoá sổ đã nhớ</button>
        </div>
        <input type="file" id="dts11-file" accept=".txt,text/plain" style="display:none">
        <div class="dts11-foot">ganbatte ne~ · 頑張って</div>
      </div>
    </div>`;
  document.body.appendChild(panel);
  const $ = id => document.getElementById(id);

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
    const n = usableRecs().length;
    const m = (lastMsg || 'sẵn sàng nè ~') + (ghNote ? ' · ' + ghNote : '');
    const sig = n + '|' + m;
    if (sig === lastShown) return;   // chỉ cập nhật DOM khi có thay đổi
    lastShown = sig;
    $('dts11-cnt').textContent = n;
    $('dts11-face').textContent = faceFor(lastMsg || '');
    $('dts11-st').textContent = m.replace(/⚠️\s*/g, '');
    const bub = panel.querySelector('.dts11-bubble');
    bub.classList.remove('pop'); void bub.offsetWidth; bub.classList.add('pop');
    if (lastN !== -1 && n !== lastN) {
      const c = $('dts11-cnt'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
    }
    lastN = n;
  }
  const runLabel = () => {
    const b = $('dts11-run');
    b.textContent = cfg.run ? 'Tạm dừng' : 'Chạy nào!';
    b.className = 'dts11-runbtn ' + (cfg.run ? 'on' : 'off');
    panel.classList.toggle('running', !!cfg.run);
  };
  const fillSpd = () => $('dts11-spd').style.setProperty('--p', (cfg.delay / 20) + '%');

  $('dts11-sel').checked = cfg.sel;   $('dts11-sel').onchange = e => { cfg.sel = e.target.checked; saveCfg(); };
  $('dts11-chk').checked = cfg.chk;   $('dts11-chk').onchange = e => { cfg.chk = e.target.checked; saveCfg(); };
  $('dts11-next').checked = cfg.next; $('dts11-next').onchange = e => { cfg.next = e.target.checked; saveCfg(); };
  $('dts11-unk').value = cfg.unk;     $('dts11-unk').onchange = e => { cfg.unk = e.target.value; saveCfg(); };
  $('dts11-spd').value = cfg.delay;   $('dts11-ms').textContent = cfg.delay; fillSpd();
  $('dts11-spd').oninput = e => { cfg.delay = +e.target.value; $('dts11-ms').textContent = cfg.delay; fillSpd(); saveCfg(); };
  $('dts11-run').onclick = () => { cfg.run = !cfg.run; runLabel(); saveCfg(); stat(cfg.run ? 'đang chạy, cố lên!' : 'đã tạm dừng'); };
  $('dts11-min').onclick = () => {
    const b = $('dts11-body'), hide = b.style.display !== 'none';
    b.style.display = hide ? 'none' : 'block';
    $('dts11-min').textContent = hide ? '+' : '–';
  };
  runLabel(); stat('');

  // Hiệu ứng gợn sóng khi bấm nút
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

  // Vệt cánh hoa theo con trỏ chuột trong panel
  let lastTrail = 0;
  if (!REDUCED) panel.addEventListener('mousemove', e => {
    const t = performance.now();
    if (t - lastTrail < 45) return;
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

  // kéo panel bằng thanh tiêu đề
  let drag = null;
  $('dts11-head').addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON') return;
    drag = { dx: e.clientX - panel.offsetLeft, dy: e.clientY - panel.offsetTop };
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    panel.style.left = (e.clientX - drag.dx) + 'px'; panel.style.top = (e.clientY - drag.dy) + 'px'; panel.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => { drag = null; });

  // ---------- Xuất / nhập .txt ----------
  // Định dạng: mỗi dòng "câu hỏi ||| đáp án đúng"; dòng bắt đầu bằng # là ghi chú
  function exportTxt() {
    const lines = Object.values(bank).map(r => flat(r.q) + SEP + flat(r.correct));
    const head = ['# DeThiSo Helper - sổ đáp án', '# Mỗi dòng: câu hỏi ||| đáp án đúng', ''];
    const blob = new Blob(['﻿' + head.concat(lines).join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dethiso-dap-an.txt';
    a.click();
    stat(`đã xuất ${lines.length} câu`);
  }
  function importTxt(text) {
    let added = 0, skipped = 0;
    text.replace(/^﻿/, '').split(/\r?\n/).forEach(line => {
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
    st = { key: null };
    stat(`nhập +${added} câu mới` + (skipped ? `, bỏ ${skipped} dòng lỗi` : ''));
  }
  $('dts11-exp').onclick = exportTxt;

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
  async function pushGithub() {
    const code = examCode();
    const all = Object.values(bank).filter(r => r && r.q && r.correct);
    const mine = code ? all.filter(r => r.t === code) : [];
    const pair = r => [flat(r.q), flat(r.correct)];
    if (!all.length) return stat('sổ đang trống, chưa có gì để lưu');
    let tok = prompt('Dán GitHub token để lưu (dùng 1 lần, không được lưu lại)\nSổ chung: ' + all.length + ' câu' + (code ? '\nĐề ' + code + ': ' + mine.length + ' câu' : '\n(chưa nhận ra mã đề)'), '');
    if (!tok || !tok.trim()) return stat('đã huỷ, chưa lưu');
    tok = tok.trim();
    stat('đang lưu lên GitHub...');
    try {
      const r1 = await ghPushFile(tok, `banks/${GHC.site}.txt`, all.map(pair));
      if (r1.err) return stat(r1.err);
      let r2 = { n: 0 };
      if (code && mine.length) { r2 = await ghPushFile(tok, `banks/${GHC.site}/${code}.txt`, mine.map(pair)); if (r2.err) return stat(r2.err); }
      stat(r1.n || r2.n ? `đã lưu: sổ chung +${r1.n}` + (code && mine.length ? `, đề ${code} +${r2.n}` : '') : 'sổ đã khớp GitHub, không có gì mới');
    } finally { tok = null; }
  }

  // ---------- Nút tải từ GitHub (cần Sakura Loader) ----------
  let gAck = 0;
  $('dts11-gpush').onclick = pushGithub;
  const codeEl = $('dts11-code');
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
  $('dts11-gpull').onclick = () => { stat('tải lại từ GitHub...'); pullExam(examCode()); };
  codeEl.onchange = () => {
    manualCode = extractCode(codeEl.value); codeEl.value = manualCode;
    stat(manualCode ? 'mã đề: ' + manualCode : 'dùng mã tự nhận từ trang: ' + (autoCode() || 'không có'));
    pullExam(examCode());
  };
  setInterval(() => { const h = 'Link / mã đề (tự nhận: ' + (autoCode() || 'không có') + ')'; if (codeEl.placeholder !== h) codeEl.placeholder = h; }, 1000);

  // vào link nào tự nhận mã đề link đó và tự tải file từ GitHub; sang link khác thì bỏ mã cũ
  let lastAuto = null;
  function watchUrl() {
    const c = autoCode();
    if (c === lastAuto) return;
    lastAuto = c; manualCode = ''; codeEl.value = ''; ghNote = '';
    if (c) pullExam(c); else stat();
  }
  setInterval(watchUrl, 700); watchUrl();

  document.addEventListener('sakura-status', e => { gAck = 1; bank = loadKey(BANK_KEY) || {}; idx2 = null; st = { key: null }; stN = { sig: null }; stat(String(e.detail || '')); });
  $('dts11-imp').onclick = () => $('dts11-file').click();
  $('dts11-file').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => importTxt(String(rd.result));
    rd.readAsText(f, 'utf-8');
    e.target.value = '';
  };
  $('dts11-clr').onclick = () => {
    const n = Object.keys(bank).length;
    if (!n) { stat('sổ đang trống'); return; }
    if (confirm(`Xoá toàn bộ ${n} câu đã nhớ trong trình duyệt?\n(Nên bấm "Xuất .txt" trước nếu muốn giữ bản sao. File .txt đã xuất không bị ảnh hưởng.)`)) {
      bank = {};
      saveBank();
      legacyKeys().forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
      st = { key: null }; stN = { sig: null };
      stat(`đã xoá ${n} câu`);
      console.log(`🗑 Đã xoá ${n} câu đã nhớ.`);
    }
  };

  // ---------- Đọc DOM ----------
  // Trang dùng màu oklch() (Tailwind v4): getComputedStyle trả "oklch(...)" chứ không phải "rgb(...)",
  // nên đổi mọi kiểu màu về RGB bằng canvas thay vì tự parse chuỗi rgb().
  // Canvas chỉ tạo khi thật sự cần (lúc đọc kết quả ở trang làm bài), không đụng tới trang bắt đầu / xếp hạng
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
  function toRgb(c) {
    if (!c) return null;
    const m = c.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) return [+m[1], +m[2], +m[3]];
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

  const rowOk = el => {
    if (panel.contains(el) || el.children.length < 2) return false;
    if (!el.parentElement || el.parentElement.children.length < 4) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 200 && r.height >= 40 && r.height <= 140;
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
        return Math.abs(r.width - w) < 3 && r.height >= 40;
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

  // ---------- Học đáp án ----------
  function learnFrom(info) {
    if (!info.matched || !lastSnap || !lastSnap.q) return;
    const k = norm(lastSnap.q);
    const code = examCode();
    if (bank[k] && norm(bank[k].correct) === norm(info.txt)) { if (code && bank[k].t !== code) { bank[k].t = code; saveBank(); } return; }
    bank[k] = { q: lastSnap.q, correct: info.txt, t: code || undefined };
    saveBank();
    stat('vừa học 1 câu');
    console.log('🧠 Đã nhớ:', lastSnap.q.slice(0, 60), '→', info.txt);
  }

  // ---------- Máy trạng thái ----------
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
      if (!rec) stat(willGuess ? 'câu mới → đoán A để học' : 'câu mới — tự chọn rồi bấm Kiểm tra để học');
      else stat(willGuess ? 'không khớp đáp án đã nhớ → đoán A để học' : 'đã nhớ câu nhưng không khớp đáp án (đề đổi chữ?)');
      if (!willGuess) return;
      letter = 'A'; guess = true;
    }
    if (!cfg.run || (!guess && !cfg.sel)) {
      snap.els[letter].style.outline = '4px solid #10B981';
      stat(`đáp án nhớ: ${letter}`);
      return;
    }
    if (st.stuck) return;
    const t = now();
    if (st.selTries === 0) {
      if (!gapOk()) return;
      snap.els[letter].click();
      st.selTries = 1; st.selAt = t; lastAct = t;
      stat(guess ? `đoán ${letter}` : `đã chọn ${letter}`);
      return;
    }
    if (!cfg.chk && !guess) return;
    const btn = findBtn(/^Kiểm tra$/);
    if (st.chkTries === 0) {
      const ready = btnEnabled(btn) || t - st.selAt > Math.max(700, cfg.delay * 2);
      if (!ready || !btn || !gapOk()) return;
      btn.click();
      st.chkTries = 1; st.chkAt = t; lastAct = t;
      stat('đã bấm Kiểm tra');
      return;
    }
    // Đã bấm mà trang chưa đổi: chờ lâu rồi mới thử lại (tránh gửi trùng), tối đa 2 lần
    if (t - st.chkAt > chkRetry() && btnEnabled(btn) && gapOk()) {
      if (st.chkTries >= 2) { st.stuck = true; stat('⚠️ Kẹt ở nút Kiểm tra — hãy bấm tay'); return; }
      btn.click();
      st.chkTries++; st.chkAt = t; lastAct = t;
    }
  }

  // Câu ĐÃ kiểm tra: học đáp án → bấm Tiếp
  function stepChecked(info) {
    if (stN.sig !== info.sig) stN = { sig: info.sig, tries: 0, at: 0 };
    learnFrom(info);
    if (!cfg.run || !cfg.next || stN.stuck) return;
    const nb = findBtn(/^Tiếp/);
    if (!nb) { stat('không thấy nút Tiếp (cuối bài?) — dừng'); return; }
    if (!btnEnabled(nb)) return;
    const t = now();
    if (stN.tries === 0) {
      if (!gapOk()) return;
      nb.click();
      stN.tries = 1; stN.at = t; lastAct = t;
      stat('đang chuyển câu');
      return;
    }
    if (t - stN.at > nextRetry() && gapOk()) {
      if (stN.tries >= 2) { stN.stuck = true; stat('⚠️ Kẹt ở nút Tiếp — hãy bấm tay'); return; }
      nb.click();
      stN.tries++; stN.at = t; lastAct = t;
    }
  }

  // Chỉ hoạt động ở trang làm bài (/exam/<mã>/take). Trang bắt đầu / xếp hạng: script không đọc, không bấm gì.
  const onTake = () => /\/take(\/|$)/.test(location.pathname);
  function tick() {
    if (!onTake()) { lastSnap = null; stat('chờ vào trang làm bài…'); return; }
    const snap = snapshot();
    if (snap) return stepUnchecked(snap);
    const info = checkedInfo();
    if (info) return stepChecked(info);
  }
  function loop() {
    try { tick(); } catch (e) { console.error('DTS tick lỗi:', e); }
    setTimeout(loop, onTake() && cfg.run ? (cfg.delay <= 150 ? 80 : 150) : 500);
  }
  loop();

  console.log('✅ Helper v11 sẵn sàng.');
})();
