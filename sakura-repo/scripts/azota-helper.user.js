// ==UserScript==
// @name         Azota Helper - Sakura Edition
// @namespace    https://azota.vn/
// @version      2.0
// @description  桜 Sakura Edition: quét "Đáp án đúng" ở trang xem đáp án rồi lưu, tự chọn lại ở lần làm sau, sổ đáp án có tìm kiếm, xuất/nhập .txt. Không tự nộp bài.
// @match        https://azota.vn/*
// @match        https://*.azota.vn/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

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
  const cfg = Object.assign({ run: true, select: true, learn: true, delay: 300, min: false, x: null, y: null, code: '' }, load(CFG_KEY) || {});

  // ---------- Mã đề (từ link) ----------
  function extractCode(v) {
    v = String(v || '').trim();
    if (!v) return '';
    const clean = s => s.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    let path = v;
    try { path = new URL(v).pathname; } catch (e) {}
    const segs = path.split('/').map(s => s.trim()).filter(Boolean);
    if (segs.length > 1 || /^https?:/i.test(v)) {
      const num = segs.find(s => /^\d{5,}$/.test(s));
      if (num) return num;
      const c = segs.filter(s => !/^(vi|en|test|take|take-test|answer-test|exam|result|submit-test|do|view)$/i.test(s)).pop();
      return c ? clean(c) : '';
    }
    return clean(v);
  }
  const autoCode = () => extractCode(location.href);
  const examCode = () => extractCode(cfg.code) || autoCode();
  const saveBank = () => { try { localStorage.setItem(BANK_KEY, JSON.stringify(bank)); } catch (e) {} };
  const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {} };

  // ---------- Tra sổ ----------
  const findRec = q => {
    const r = bank[norm(q)];
    if (r) return r;
    const k = norm2(q);
    return Object.values(bank).find(v => norm2(v.q) === k) || null;
  };

  // ---------- Học từ trang xem đáp án ----------
  // Mỗi câu có chữ "Đáp án đúng: X" và các phương án "A. ...": quét từng thẻ câu, lưu nội dung phương án đúng.
  const ANS_RE = /^Đáp án đúng\s*:\s*([A-F])$/i;
  function learnNow() {
    let n = 0, seen = 0, tagged = 0;
    const marks = [];
    document.querySelectorAll('div, span, p, b, strong, label').forEach(el => {
      if (el.children.length || el.closest('#' + panelId)) return;
      const m = flat(el.textContent).match(ANS_RE);
      if (m) marks.push({ el, letter: m[1].toUpperCase() });
    });
    marks.forEach(({ el, letter }) => {
      let card = el.parentElement, text = '';
      for (let i = 0; i < 8 && card; i++, card = card.parentElement) {
        text = card.innerText || '';
        if (/Câu\s*\d+/i.test(text) && /(^|\n)\s*A\s*\.\s*\S/.test(text)) break;
      }
      if (!card || (text.match(/Đáp án đúng\s*:/gi) || []).length !== 1) return;   // thẻ chứa nhiều câu: bỏ qua cho an toàn
      const at = text.search(/(^|\n)\s*A\s*\.\s*\S/);
      const q = flat(text.slice(0, at).replace(/Câu\s*\d+/i, '').replace(/ID\s*:\s*\d+/gi, ''));
      const body = text.slice(at).replace(/Đáp án đúng[\s\S]*$/i, '');
      const opts = {};
      const re = /(?:^|\n)\s*([A-F])\s*\.\s*([\s\S]*?)(?=\n\s*[A-F]\s*\.\s|$)/g;
      let m;
      while ((m = re.exec(body))) if (!opts[m[1]]) opts[m[1]] = flat(m[2]);
      if (q.length < 3 || !opts[letter]) return;
      seen++;
      const k = norm(q);
      const code = examCode();
      if (bank[k] && norm(bank[k].correct) === norm(opts[letter])) { if (code && bank[k].t !== code) { bank[k].t = code; tagged++; } return; }
      bank[k] = { q, correct: opts[letter], t: code || undefined };
      n++;
    });
    if (n || tagged) saveBank();
    return { n, seen };
  }

  // ---------- Chọn đáp án đã nhớ ----------
  // Với mỗi câu trong sổ: tìm đoạn chữ câu hỏi trên trang, rồi bấm vào ô có nội dung = đáp án đúng.
  const inTake = () => /take-test/.test(location.pathname);
  let clickedQ = new Set(), clickedUrl = location.href, learnedNow = 0, lastAct = 0;
  const hl = new Set();   // các ô đang được tô viền gợi ý

  function pageEls() {
    const all = [];
    document.querySelectorAll('div, span, p, label, li, b, strong, button').forEach(el => {
      if (el.closest('#' + panelId) || !el.getClientRects().length) return;
      const raw = el.textContent;
      if (!raw || raw.length > 800) return;
      all.push({ el, t: flat(raw) });
    });
    return all;
  }
  const deepest = list => list.filter(a => !list.some(b => b !== a && a.el.contains(b.el)));
  const sameText = (a, b) => norm(a) === norm(b) || norm2(a) === norm2(b);
  function press(el) {
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(t => {
      const Ev = t.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ev(t, { bubbles: true, cancelable: true, view: window }));
    });
  }
  // Trả về { qEl } nếu thấy câu hỏi, kèm { card, target } nếu xác định được ô đáp án đúng
  function locate(rec, all) {
    const qEl = deepest(all.filter(a => sameText(a.t, rec.q)))[0];
    if (!qEl) return null;
    for (let card = qEl.el.parentElement, i = 0; card && i < 8; card = card.parentElement, i++) {
      if (((card.innerText || '').match(/(^|\n)\s*Câu\s*\d+/gi) || []).length > 1) return { qEl };   // leo quá cao
      const hits = deepest(all.filter(a => card.contains(a.el) && !a.el.contains(qEl.el) && a.el !== qEl.el && sameText(a.t, rec.correct)));
      if (!hits.length) continue;
      if (hits.length > 1) return { qEl };           // hai phương án trùng chữ: không đoán bừa
      return { qEl, card, target: hits[0].el };
    }
    return { qEl };
  }
  const clearHl = () => { hl.forEach(el => { el.style.outline = ''; el.style.outlineOffset = ''; }); hl.clear(); };

  function selectNow() {
    if (clickedUrl !== location.href) { clickedUrl = location.href; clickedQ = new Set(); clearHl(); }
    const recs = Object.values(bank);
    const all = pageEls();
    const pageQ = new Set();
    all.forEach(a => { const m = a.t.match(/^Câu\s*(\d+)$/i); if (m) pageQ.add(m[1]); });
    if (!recs.length) return { found: 0, done: 0, page: pageQ.size, bankN: 0 };
    const active = cfg.run && cfg.select;
    if (active) clearHl();
    let found = 0;
    for (const rec of recs) {
      const loc = locate(rec, all);
      if (!loc) continue;
      found++;
      if (!loc.target) continue;
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
        if (card.outerHTML !== before) return;
        const row = target.parentElement;
        if (row && row.children[0] && row.children[0] !== target) press(row.children[0]);
        setTimeout(() => { if (card.outerHTML === before && row) press(row); }, 400);
      }, 500);
      if (cfg.delay > 0) break;                      // có độ trễ: mỗi nhịp chỉ chọn 1 câu
    }
    return { found, done: clickedQ.size, page: pageQ.size, bankN: recs.length };
  }

  // ---------- UI Sakura ----------
  const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const css = document.createElement('style');
  css.textContent = `
  #azh{position:fixed;top:80px;right:20px;width:322px;z-index:2147483647;font:13px/1.4 "Segoe UI",system-ui,sans-serif;color:#4a3b5c;
    border-radius:26px;overflow:hidden;border:2.5px solid transparent;
    background:linear-gradient(165deg,#fff4fa,#eee8ff 55%,#e2f3ff) padding-box,
               linear-gradient(90deg,#ff8fc2,#c19bff,#86cfff,#ff8fc2) border-box;
    background-size:100% 100%,600px 100%;background-repeat:no-repeat,repeat-x;
    box-shadow:0 18px 50px rgba(190,100,170,.4);
    animation:azh-in .7s cubic-bezier(.2,1.5,.4,1) both,azh-border 5s linear infinite,azh-glow 3.2s ease-in-out infinite}
  #azh *{box-sizing:border-box}
  #azh button{font:inherit;cursor:pointer;border:0;position:relative;overflow:hidden}

  #azh-head{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 12px 13px;overflow:hidden;
    background:linear-gradient(120deg,#ff7fb8,#c19bff 55%,#7fc8ff,#ff7fb8);background-size:240% 100%;animation:azh-flow 7s linear infinite;
    color:#fff;cursor:move;user-select:none}
  #azh-head::before{content:"";position:absolute;top:0;bottom:0;left:-60%;width:40%;
    background:linear-gradient(100deg,transparent,rgba(255,255,255,.65),transparent);transform:skewX(-20deg);animation:azh-sweep 3.8s ease-in-out infinite}
  #azh-head::after{content:"";position:absolute;left:0;right:0;bottom:0;height:4px;
    background:repeating-linear-gradient(90deg,rgba(255,255,255,.85) 0 7px,transparent 7px 14px);opacity:.5}
  #azh.running #azh-head::after{animation:azh-march .7s linear infinite;opacity:.95}
  .azh-logo{position:relative;z-index:1;display:flex;align-items:center;gap:9px;min-width:0}
  .azh-title{font-weight:800;font-size:14px;letter-spacing:.3px;text-shadow:0 1px 5px rgba(150,40,120,.6);white-space:nowrap}
  .azh-sub{font-size:10px;letter-spacing:.8px;opacity:.95;text-shadow:0 1px 3px rgba(150,40,120,.55);white-space:nowrap}
  .azh-hbtns{position:relative;z-index:1;display:flex;gap:6px;align-items:center;flex:none}

  .azh-mascot{position:relative;width:38px;height:38px;flex:none;border-radius:50%;background:rgba(255,255,255,.92);
    box-shadow:0 0 0 3px rgba(255,255,255,.35),0 3px 10px rgba(150,40,120,.4);animation:azh-bob 2.6s ease-in-out infinite}
  .azh-flower{position:absolute;inset:0;animation:azh-spin 14s linear infinite}
  .azh-flower i{position:absolute;left:50%;top:50%;width:10px;height:14px;margin:-14px 0 0 -5px;transform-origin:50% 100%;
    border-radius:50% 50% 50% 50%/75% 75% 25% 25%;background:linear-gradient(180deg,#ffe0ee,#ff7fb8)}
  .azh-flower::after{content:"";position:absolute;left:50%;top:50%;width:7px;height:7px;margin:-3.5px;border-radius:50%;
    background:radial-gradient(circle,#fff6a8,#ffc55c);box-shadow:0 0 6px #ffd37a}

  .azh-runbtn{padding:6px 12px;border-radius:999px;font-weight:800;font-size:11.5px;transition:transform .15s}
  .azh-runbtn:hover{transform:translateY(-1px) scale(1.06)}
  .azh-runbtn:active{transform:scale(.95)}
  .azh-runbtn.on{background:#fff;color:#e0559b;box-shadow:0 2px 10px rgba(120,40,110,.35)}
  .azh-runbtn.off{background:#fff3a0;color:#a65a00;animation:azh-pulse 1.3s ease-in-out infinite}
  .azh-minbtn{width:27px;height:27px;border-radius:50%;background:rgba(255,255,255,.35);color:#fff;font-size:16px;font-weight:800;line-height:1;padding:0;transition:transform .2s,background .2s}
  .azh-minbtn:hover{background:rgba(255,255,255,.65);transform:rotate(90deg)}

  #azh-body{position:relative;z-index:1;padding:13px;max-height:calc(100vh - 170px);overflow-y:auto;scrollbar-width:thin;scrollbar-color:#ffb3d4 transparent}
  .azh-fx{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:0}
  .azh-fx .pt{position:absolute;top:-18px;border-radius:150% 0 150% 0;opacity:.8;animation:azh-fall linear infinite;background:linear-gradient(135deg,#ffd0e5,#ff8fc2)}
  .azh-fx .sp{position:absolute;background:#fff;clip-path:polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%);
    filter:drop-shadow(0 0 3px #ff9cc9);animation:azh-twinkle ease-in-out infinite}
  .azh-fx .sp.v{background:#d9c8ff;filter:drop-shadow(0 0 3px #a98bff)}
  .azh-fx .sp.b{background:#cdeaff;filter:drop-shadow(0 0 3px #6fc0ff)}
  .azh-main{position:relative;z-index:1}

  .azh-chip{display:flex;justify-content:space-between;align-items:center;padding:6px 12px;margin-bottom:10px;border-radius:999px;font-weight:700;font-size:11.5px;
    color:#fff;letter-spacing:.4px;background:linear-gradient(90deg,#ff7fb8,#b69bff,#7fc8ff);background-size:200% 100%;animation:azh-flow 5s linear infinite;
    box-shadow:0 3px 12px rgba(180,90,170,.35)}
  .azh-chip b{font-size:15px;display:inline-block;text-shadow:0 1px 4px rgba(120,40,110,.5)}
  .azh-chip b.bump{animation:azh-bump .5s cubic-bezier(.3,1.8,.5,1)}

  .azh-prog{margin:0 2px 12px}
  .azh-prog-t{display:flex;justify-content:space-between;font-size:11px;color:#8b7aa3;margin-bottom:4px}
  .azh-bar{height:10px;border-radius:999px;background:#eadcf6;overflow:hidden;box-shadow:inset 0 1px 3px rgba(80,40,100,.2)}
  .azh-bar i{display:block;height:100%;width:0;border-radius:999px;background:linear-gradient(90deg,#ff7fb8,#b69bff,#7fc8ff);background-size:200% 100%;
    animation:azh-flow 3s linear infinite;transition:width .5s cubic-bezier(.3,1.4,.5,1)}

  .azh-bubble{position:relative;display:flex;align-items:center;gap:9px;padding:9px 11px;margin-bottom:12px;border-radius:18px;
    background:#fff;border:2px dashed #ffb3d4;box-shadow:0 3px 12px rgba(200,110,170,.2)}
  .azh-bubble.pop{animation:azh-pop .45s cubic-bezier(.3,1.7,.5,1)}
  .azh-bubble::before{content:"";position:absolute;top:-8px;left:24px;width:12px;height:12px;background:#fff;
    border-left:2px dashed #ffb3d4;border-top:2px dashed #ffb3d4;transform:rotate(45deg)}
  #azh-face{font-weight:800;color:#e0559b;white-space:nowrap;font-size:12.5px;animation:azh-wob 1.8s ease-in-out infinite}
  #azh-st{color:#6b5a85;font-size:12px;word-break:break-word}

  .azh-sw{display:flex;align-items:center;gap:10px;padding:6px 6px;cursor:pointer;border-radius:12px;transition:background .2s,transform .2s}
  .azh-sw:hover{background:linear-gradient(90deg,rgba(255,160,205,.22),transparent);transform:translateX(3px)}
  .azh-sw input{position:absolute;opacity:0;pointer-events:none}
  .azh-sw i{position:relative;flex:none;width:40px;height:23px;border-radius:999px;background:#ddd3ea;transition:background .3s,box-shadow .3s;box-shadow:inset 0 1px 3px rgba(80,40,100,.28)}
  .azh-sw i::after{content:"";position:absolute;top:2.5px;left:2.5px;width:18px;height:18px;border-radius:50%;background:#fff;
    box-shadow:0 1px 4px rgba(80,40,100,.4);transition:transform .35s cubic-bezier(.3,1.9,.5,1)}
  .azh-sw input:checked + i{background:linear-gradient(90deg,#ff7fb8,#b69bff);box-shadow:0 0 12px rgba(255,127,184,.7)}
  .azh-sw input:checked + i::after{transform:translateX(17px)}
  .azh-sw input:focus-visible + i{outline:2px solid #b69bff;outline-offset:2px}
  .azh-sw span{font-weight:600}

  .azh-box{margin:10px 0;padding:10px 11px;border-radius:16px;background:rgba(255,255,255,.75);border:1px solid rgba(255,170,210,.5);
    border-left:4px solid #ff8fc2;transition:box-shadow .25s,transform .25s}
  .azh-box:hover{box-shadow:0 5px 16px rgba(200,110,170,.25);transform:translateY(-1px)}
  .azh-box small{color:#8b7aa3}
  #azh-ms{color:#e0559b;font-size:14px}
  #azh-spd{-webkit-appearance:none;appearance:none;width:100%;height:9px;margin:10px 0 3px;border-radius:999px;outline:0;
    background:linear-gradient(90deg,#ff7fb8 var(--p,15%),#eadcf6 var(--p,15%))}
  #azh-spd::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;border-radius:50%;border:3px solid #fff;
    background:radial-gradient(circle at 35% 35%,#fff 0 16%,#ff6fb0 18%);box-shadow:0 2px 10px rgba(200,70,140,.6);cursor:grab;transition:transform .15s}
  #azh-spd::-webkit-slider-thumb:hover{transform:scale(1.2)}
  #azh-spd::-webkit-slider-thumb:active{transform:scale(1.35);cursor:grabbing}
  #azh-spd::-moz-range-thumb{width:16px;height:16px;border-radius:50%;border:3px solid #fff;background:#ff6fb0;box-shadow:0 2px 10px rgba(200,70,140,.6);cursor:grab}

  .azh-acts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
  .azh-act{padding:8px 10px;border-radius:999px;font-weight:700;font-size:12px;color:#fff;
    background:linear-gradient(90deg,#ff7fb8,#b69bff);box-shadow:0 4px 12px rgba(180,90,170,.35);transition:transform .2s,box-shadow .2s}
  .azh-act::after{content:"";position:absolute;top:0;bottom:0;left:-70%;width:40%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.7),transparent);transform:skewX(-20deg);transition:left .6s}
  .azh-act:hover{transform:translateY(-3px);box-shadow:0 8px 18px rgba(180,90,170,.45)}
  .azh-act:hover::after{left:130%}
  .azh-act:active{transform:translateY(0) scale(.96)}
  .azh-act.alt{background:linear-gradient(90deg,#6fc4ff,#b69bff)}
  .azh-act.wide{grid-column:1/-1}
  .azh-act.danger{grid-column:1/-1;background:linear-gradient(90deg,#ff8fa3,#ffb0c8)}
  .azh-rip{position:absolute;border-radius:50%;background:rgba(255,255,255,.65);transform:scale(0);animation:azh-rip .6s ease-out forwards;pointer-events:none}
  .azh-foot{text-align:center;margin-top:11px;font-size:10.5px;letter-spacing:1px;color:#a58cc0}
  .azh-trail{position:absolute;width:9px;height:9px;margin:-4px;border-radius:150% 0 150% 0;pointer-events:none;z-index:5;animation:azh-trail .8s ease-out forwards}

  /* sổ đáp án */
  #azh-bookv{display:none;position:relative;z-index:1}
  #azh-q{width:100%;padding:8px 12px;border-radius:999px;border:2px solid #ffc2dc;background:#fff;color:#4a3b5c;font:inherit;outline:0;transition:border-color .2s,box-shadow .2s}
  #azh-q:focus{border-color:#b69bff;box-shadow:0 0 0 4px rgba(182,155,255,.2)}
  #azh-list{margin:10px 0;max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:7px;padding-right:2px;scrollbar-width:thin;scrollbar-color:#ffb3d4 transparent}
  .azh-item{position:relative;padding:8px 30px 8px 10px;border-radius:14px;background:#fff;border:1px solid rgba(255,170,210,.6);border-left:4px solid #ff8fc2;animation:azh-pop .35s cubic-bezier(.3,1.6,.5,1)}
  .azh-item .q{font-weight:700;color:#4a3b5c;font-size:12px}
  .azh-item .a{margin-top:3px;color:#d1478b;font-size:12px}
  #azh .azh-item .x{position:absolute;top:6px;right:6px;width:20px;height:20px;border-radius:50%;background:#ffe0ec;color:#e0559b;font-weight:800;font-size:12px;line-height:1;padding:0}
  #azh .azh-item .x:hover{background:#ff8fc2;color:#fff}
  .azh-empty{text-align:center;color:#a58cc0;padding:14px 0}

  @keyframes azh-in{from{opacity:0;transform:translateY(-24px) scale(.82) rotate(-2deg)}to{opacity:1;transform:none}}
  @keyframes azh-border{from{background-position:0 0,0 0}to{background-position:0 0,600px 0}}
  @keyframes azh-glow{0%,100%{box-shadow:0 18px 50px rgba(190,100,170,.35),0 0 18px rgba(255,143,194,.3)}50%{box-shadow:0 18px 56px rgba(150,120,230,.45),0 0 34px rgba(182,155,255,.55)}}
  @keyframes azh-flow{from{background-position:0 0}to{background-position:240% 0}}
  @keyframes azh-sweep{0%{left:-60%}55%,100%{left:140%}}
  @keyframes azh-march{from{background-position:0 0}to{background-position:14px 0}}
  @keyframes azh-bob{0%,100%{transform:translateY(0) rotate(-5deg)}50%{transform:translateY(-4px) rotate(5deg)}}
  @keyframes azh-spin{to{transform:rotate(360deg)}}
  @keyframes azh-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,243,160,.95)}50%{box-shadow:0 0 0 9px rgba(255,243,160,0)}}
  @keyframes azh-fall{0%{transform:translate(0,0) rotate(0)}25%{transform:translate(16px,120px) rotate(120deg)}50%{transform:translate(-10px,240px) rotate(240deg)}75%{transform:translate(14px,360px) rotate(360deg)}100%{transform:translate(-6px,520px) rotate(480deg)}}
  @keyframes azh-twinkle{0%,100%{opacity:0;transform:scale(.2) rotate(0)}50%{opacity:1;transform:scale(1) rotate(90deg)}}
  @keyframes azh-bump{0%{transform:scale(1)}40%{transform:scale(1.7) rotate(-6deg)}100%{transform:scale(1)}}
  @keyframes azh-pop{0%{transform:scale(.9)}60%{transform:scale(1.04)}100%{transform:scale(1)}}
  @keyframes azh-wob{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
  @keyframes azh-rip{to{transform:scale(1);opacity:0}}
  @keyframes azh-trail{0%{opacity:.95;transform:translate(0,0) rotate(0) scale(1)}100%{opacity:0;transform:translate(var(--dx),var(--dy)) rotate(var(--r)) scale(.3)}}
  @media (prefers-reduced-motion:reduce){#azh,#azh *{animation:none!important;transition:none!important}}
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
  panel.id = panelId;
  panel.innerHTML = `
    <div id="azh-head">
      <div class="azh-logo">
        <div class="azh-mascot"><div class="azh-flower">${flower}</div></div>
        <div><div class="azh-title">Azota Helper</div><div class="azh-sub">v2.0 · 桜 SAKURA</div></div>
      </div>
      <div class="azh-hbtns">
        <button id="azh-run" class="azh-runbtn"></button>
        <button id="azh-min" class="azh-minbtn" title="Thu gọn">–</button>
      </div>
    </div>
    <div id="azh-body">
      <div class="azh-fx">${petals}${sparks}</div>

      <div class="azh-main" id="azh-mainv">
        <div class="azh-chip"><span>SỔ ĐÁP ÁN</span><span><b id="azh-cnt">0</b> câu</span></div>
        <div class="azh-prog">
          <div class="azh-prog-t"><span>Khớp trên trang này</span><span id="azh-pt">–</span></div>
          <div class="azh-bar"><i id="azh-pb"></i></div>
        </div>
        <div class="azh-bubble"><span id="azh-face">(◕‿◕)</span><span id="azh-st"></span></div>

        <label class="azh-sw"><input type="checkbox" id="azh-sel"><i></i><span>Tự chọn đáp án đã nhớ</span></label>
        <label class="azh-sw"><input type="checkbox" id="azh-lrn"><i></i><span>Tự học ở trang xem đáp án</span></label>

        <div class="azh-box">
          Độ trễ giữa các câu: <b id="azh-ms"></b> ms <small>(0 = nhanh nhất)</small>
          <input type="range" id="azh-spd" min="0" max="2000" step="50">
        </div>

        <div class="azh-acts">
          <input id="azh-code" type="text" spellcheck="false" style="grid-column:1/-1;width:100%;padding:8px 12px;border-radius:999px;border:1.5px solid #e3b6e8;background:rgba(255,255,255,.85);font:12px 'Segoe UI',sans-serif;color:#4a3b5c;outline:0">
          <button id="azh-gpull" class="azh-act wide" style="grid-column:1/-1">Tải đáp án từ GitHub</button>
          <button id="azh-gpush" class="azh-act wide alt" style="grid-column:1/-1">Lưu sổ lên GitHub</button>
          <button id="azh-book" class="azh-act wide">Xem sổ đáp án</button>
          <button id="azh-exp" class="azh-act">Xuất .txt</button>
          <button id="azh-imp" class="azh-act alt">Nhập .txt</button>
          <button id="azh-clr" class="azh-act danger" title="Xoá toàn bộ câu đã nhớ">Xoá sổ đã nhớ</button>
        </div>
        <input type="file" id="azh-file" accept=".txt,text/plain" style="display:none">
        <div class="azh-foot">ganbatte ne~ · 頑張って</div>
      </div>

      <div id="azh-bookv">
        <input id="azh-q" type="search" placeholder="Tìm câu hỏi hoặc đáp án…" autocomplete="off">
        <div id="azh-list"></div>
        <div class="azh-acts"><button id="azh-back" class="azh-act wide">Quay lại</button></div>
      </div>
    </div>`;
  document.body.appendChild(panel);
  const $ = id => document.getElementById(id);

  if (cfg.x !== null && cfg.y !== null) {
    panel.style.left = Math.max(0, Math.min(cfg.x, innerWidth - 120)) + 'px';
    panel.style.top = Math.max(0, Math.min(cfg.y, innerHeight - 60)) + 'px';
    panel.style.right = 'auto';
  }

  const FACES = [
    [/trống/, '(・ω・)'], [/học thêm|vừa học/, '(≧▽≦)'], [/đã chọn|khớp/, '(๑•̀ㅂ•́)و✧'],
    [/tạm dừng/, '(－ω－) zzZ'], [/đang chạy/, '(＾▽＾)'], [/xuất|nhập/, '(๑˃ᴗ˂)ﻭ'],
    [/xoá/, '(・ω・)'], [/chờ|quét/, '(・・?)']
  ];
  const faceFor = m => { const f = FACES.find(x => x[0].test(m)); return f ? f[1] : '(◕‿◕)'; };

  let lastMsg = '', lastShown = '', lastN = -1;
  function stat(msg) {
    if (msg !== undefined) lastMsg = msg;
    const n = Object.keys(bank).length;
    const m = lastMsg || 'sẵn sàng nè ~';
    const sig = n + '|' + m;
    if (sig === lastShown) return;
    lastShown = sig;
    $('azh-cnt').textContent = n;
    $('azh-face').textContent = faceFor(m);
    $('azh-st').textContent = m;
    const bub = panel.querySelector('.azh-bubble');
    bub.classList.remove('pop'); void bub.offsetWidth; bub.classList.add('pop');
    if (lastN !== -1 && n !== lastN) {
      const c = $('azh-cnt'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
    }
    lastN = n;
  }
  function prog(found, page) {
    const t = page ? `${found} / ${page} câu` : (found ? `${found} câu` : '–');
    $('azh-pt').textContent = t;
    $('azh-pb').style.width = (page ? Math.min(100, Math.round(found / page * 100)) : 0) + '%';
  }
  const runLabel = () => {
    const b = $('azh-run');
    b.textContent = cfg.run ? 'Tạm dừng' : 'Chạy nào!';
    b.className = 'azh-runbtn ' + (cfg.run ? 'on' : 'off');
    panel.classList.toggle('running', !!cfg.run);
  };
  const fillSpd = () => $('azh-spd').style.setProperty('--p', (cfg.delay / 20) + '%');
  const applyMin = () => { $('azh-body').style.display = cfg.min ? 'none' : 'block'; $('azh-min').textContent = cfg.min ? '+' : '–'; };

  $('azh-sel').checked = cfg.select; $('azh-sel').onchange = e => { cfg.select = e.target.checked; saveCfg(); stat(cfg.select ? 'tự chọn đã bật' : 'tự chọn đã tắt, chỉ tô viền gợi ý'); };
  $('azh-lrn').checked = cfg.learn;  $('azh-lrn').onchange = e => { cfg.learn = e.target.checked; saveCfg(); };
  $('azh-spd').value = cfg.delay; $('azh-ms').textContent = cfg.delay; fillSpd();
  $('azh-spd').oninput = e => { cfg.delay = +e.target.value; $('azh-ms').textContent = cfg.delay; fillSpd(); saveCfg(); };
  $('azh-run').onclick = () => { cfg.run = !cfg.run; runLabel(); saveCfg(); stat(cfg.run ? 'đang chạy, cố lên!' : 'đã tạm dừng'); };
  $('azh-min').onclick = () => { cfg.min = !cfg.min; applyMin(); saveCfg(); };
  runLabel(); applyMin(); stat('');

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

  // vệt cánh hoa theo con trỏ
  let lastTrail = 0;
  if (!REDUCED) panel.addEventListener('mousemove', e => {
    const t = performance.now();
    if (t - lastTrail < 45) return;
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

  // kéo panel bằng thanh tiêu đề (nhớ vị trí)
  let drag = null;
  $('azh-head').addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON') return;
    drag = { dx: e.clientX - panel.offsetLeft, dy: e.clientY - panel.offsetTop };
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    panel.style.left = (e.clientX - drag.dx) + 'px'; panel.style.top = (e.clientY - drag.dy) + 'px'; panel.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => {
    if (!drag) return;
    drag = null; cfg.x = panel.offsetLeft; cfg.y = panel.offsetTop; saveCfg();
  });

  // ---------- Sổ đáp án: xem, tìm, xoá từng câu ----------
  function renderBook() {
    const f = norm($('azh-q').value);
    const entries = Object.entries(bank).filter(([, v]) => !f || norm(v.q).includes(f) || norm(v.correct).includes(f));
    const box = $('azh-list');
    box.textContent = '';
    if (!entries.length) {
      const d = document.createElement('div');
      d.className = 'azh-empty';
      d.textContent = Object.keys(bank).length ? 'không có câu nào khớp ~' : 'sổ đang trống, hãy mở trang xem đáp án';
      box.appendChild(d);
      return;
    }
    entries.slice(0, 200).forEach(([k, v]) => {
      const it = document.createElement('div'); it.className = 'azh-item';
      const q = document.createElement('div'); q.className = 'q'; q.textContent = v.q;
      const a = document.createElement('div'); a.className = 'a'; a.textContent = '→ ' + v.correct;
      const x = document.createElement('button'); x.className = 'x'; x.textContent = '×'; x.title = 'Xoá câu này';
      x.onclick = () => { delete bank[k]; saveBank(); clickedQ.delete(k); renderBook(); stat('đã xoá 1 câu'); };
      it.append(q, a, x); box.appendChild(it);
    });
    if (entries.length > 200) {
      const d = document.createElement('div'); d.className = 'azh-empty';
      d.textContent = `…còn ${entries.length - 200} câu nữa, hãy gõ để lọc`; box.appendChild(d);
    }
  }
  const showBook = on => { $('azh-mainv').style.display = on ? 'none' : 'block'; $('azh-bookv').style.display = on ? 'block' : 'none'; if (on) { renderBook(); $('azh-q').focus(); } };
  $('azh-book').onclick = () => showBook(true);

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
  const gAsk = (ev, msg) => { gAck = 0; stat(msg); document.dispatchEvent(new CustomEvent(ev, { detail: examCode() })); setTimeout(() => { if (!gAck) stat('chưa thấy Sakura Loader, cài loader trước nhé'); }, 3000); };
  $('azh-gpull').onclick = () => gAsk('sakura-pull', 'đang tải đáp án từ GitHub...');
  $('azh-gpush').onclick = pushGithub;
  const codeEl = $('azh-code');
  codeEl.value = cfg.code || '';
  codeEl.onchange = () => { cfg.code = extractCode(codeEl.value); codeEl.value = cfg.code; saveCfg(); stat(cfg.code ? 'mã đề: ' + cfg.code : 'dùng mã tự nhận từ trang: ' + (autoCode() || 'không có')); };
  setInterval(() => { const h = 'Link / mã đề (tự nhận: ' + (autoCode() || 'không có') + ')'; if (codeEl.placeholder !== h) codeEl.placeholder = h; }, 1000);

  document.addEventListener('sakura-status', e => { gAck = 1; bank = load(BANK_KEY) || {}; stat(String(e.detail || '')); });
  $('azh-back').onclick = () => showBook(false);
  $('azh-q').oninput = renderBook;

  // ---------- Xuất / nhập .txt ----------
  $('azh-exp').onclick = () => {
    const lines = Object.values(bank).map(r => flat(r.q) + SEP + flat(r.correct));
    const head = ['# Azota Helper - sổ đáp án', '# Mỗi dòng: câu hỏi ||| đáp án đúng', ''];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + head.concat(lines).join('\n') + '\n'], { type: 'text/plain;charset=utf-8' }));
    a.download = 'azota-dap-an.txt'; a.click();
    stat(`đã xuất ${lines.length} câu`);
  };
  $('azh-imp').onclick = () => $('azh-file').click();
  $('azh-file').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      let add = 0, bad = 0;
      String(rd.result).replace(/^﻿/, '').split(/\r?\n/).forEach(line => {
        line = line.trim();
        if (!line || line.startsWith('#')) return;
        const i = line.lastIndexOf('|||');
        const q = i < 0 ? '' : flat(line.slice(0, i)), c = i < 0 ? '' : flat(line.slice(i + 3));
        if (!q || !c) { bad++; return; }
        if (!bank[norm(q)]) add++;
        bank[norm(q)] = { q, correct: c };
      });
      saveBank(); stat(`nhập +${add} câu mới` + (bad ? `, bỏ ${bad} dòng lỗi` : ''));
    };
    rd.readAsText(f, 'utf-8'); e.target.value = '';
  };
  $('azh-clr').onclick = () => {
    const n = Object.keys(bank).length;
    if (!n) return stat('sổ đang trống');
    if (confirm(`Xoá toàn bộ ${n} câu đã nhớ trong trình duyệt?\n(Nên bấm "Xuất .txt" trước nếu muốn giữ bản sao.)`)) {
      bank = {}; saveBank(); clickedQ = new Set(); clearHl(); stat(`đã xoá ${n} câu`);
    }
  };

  // ---------- Vòng lặp (trang là SPA nên quét định kỳ) ----------
  function tick() {
    if (inTake()) {
      const r = selectNow();
      prog(r.found, r.page);
      if (!r.bankN) return stat('sổ đang trống: hãy mở trang xem đáp án để học trước');
      if (!cfg.run) return stat('đã tạm dừng' + (r.found ? `, tô viền ${r.found} câu đã nhớ` : ''));
      if (!cfg.select) return stat(`tự chọn đang tắt, tô viền gợi ý ${r.found} câu`);
      return stat(`khớp ${r.found}/${r.page || r.bankN} câu, đã chọn ${r.done}`);
    }
    prog(0, 0);
    if (!cfg.learn) return;
    const r = learnNow();
    learnedNow += r.n;
    if (r.seen) stat(`đã quét ${r.seen} câu, học thêm ${learnedNow} câu mới`);
    else stat('chờ trang xem đáp án để quét…');
  }
  function loop() {
    try { tick(); } catch (e) { console.error('Azota Helper:', e); }
    setTimeout(loop, inTake() && cfg.run && cfg.select && cfg.delay > 0 && cfg.delay < 600 ? Math.max(150, cfg.delay / 2) : 1000);
  }
  loop();
})();
