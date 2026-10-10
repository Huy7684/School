// ==UserScript==
// @name         Azota Helper - Sakura Edition
// @namespace    https://azota.vn/
// @version      2.7
// @description  桜 Sakura Edition: quét "Đáp án đúng" (trắc nghiệm, đáp án ảnh, đúng/sai) ở trang xem đáp án rồi lưu, tự chọn lại ở lần làm sau, sổ đáp án có tìm kiếm, xuất/nhập .txt. Không tự nộp bài.
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
  const cfg = Object.assign({ run: true, select: true, learn: true, delay: 300, min: false, x: null, y: null }, load(CFG_KEY) || {});
  delete cfg.code;                       // không còn nhớ mã đề giữa các link
  let manualCode = '';                   // mã gõ tay: chỉ sống trong 1 link, sang link khác là bỏ
  let ghNote = '', holdUntil = 0;        // ghi chú GitHub hiện cạnh trạng thái; giữ thông báo thao tác vài giây
  // dọn bản ghi hỏng cũ (đáp án chỉ là "B. C. D." do không đọc được ảnh)
  const labelOnly = c => /^(?:[A-F]\s*\.\s*)+$/i.test(flat(c));
  { let dirty = 0; Object.keys(bank).forEach(k => { const r = bank[k]; if (!r || !r.q || !r.correct || labelOnly(r.correct)) { delete bank[k]; dirty = 1; } }); if (dirty) { try { localStorage.setItem(BANK_KEY, JSON.stringify(bank)); } catch (e) {} } }

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
  const isExam = () => /\/(test|de-thi|exam)(\/|$)/i.test(location.pathname);
  const autoCode = () => isExam() ? extractCode(location.href) : '';
  const examCode = () => extractCode(manualCode) || autoCode();
  // chỉ dùng đáp án của đề đang mở (đã gắn mã đề). Đổi false nếu muốn dùng chung cả sổ.
  const STRICT_EXAM = true;
  const usable = r => r && r.q && r.correct && (!STRICT_EXAM || !examCode() || r.t === examCode());
  const usableRecs = () => Object.values(bank).filter(usable);
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
  const ANS_RE = /^Đáp án đúng\s*:\s*([A-F])(?![\p{L}\p{N}\)])/iu;   // không đòi hết dòng: có thể có nút "Tìm Giáo Án" chèn thêm phía sau
  // Đọc phương án theo thứ tự A, B, C, D... kể cả khi cả 4 phương án nằm cùng 1 dòng
  function parseOpts(body) {
    const opts = {}, hits = [];
    let pos = 0;
    for (const L of 'ABCDEF') {
      const re = new RegExp('(?<=^|\\s)' + L + '\\s*\\.\\s*', 'g');
      re.lastIndex = pos;
      const m = re.exec(body);
      if (!m) break;
      hits.push({ L, start: m.index, end: m.index + m[0].length });
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
    if (r.width < 20 || r.height < 20) return '';     // bỏ icon nhỏ / ảnh ẩn
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
      if (q.length >= 3 && opts[letter]) return { q, correct: opts[letter] };
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
        const re = new RegExp('(?<=^|\\s)' + L + '\\s*\\)\\s*\\.?\\s*', 'gi');
        re.lastIndex = pos;
        const m = re.exec(body);
        if (!m) break;
        hits.push({ L, end: m.index + m[0].length, start: m.index });
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
  // Câu đúng/sai: tìm dòng chứa nội dung ý, rồi bấm nút "Đúng" / "Sai" trong dòng đó (nếu dòng chứa nhiều ý thì không đoán bừa)
  function locateDS(rec, all) {
    const k = norm2(rec.q.slice(DS.length));
    if (!k) return null;
    const stEl = deepest(all.filter(a => { const t = norm2(a.t); return t.length >= k.length && t.length <= k.length + 6 && t.includes(k); }))[0];
    if (!stEl) return null;
    for (let card = stEl.el.parentElement, i = 0; card && i < 6; card = card.parentElement, i++) {
      const hits = deepest(all.filter(a => card.contains(a.el) && !a.el.contains(stEl.el) && a.el !== stEl.el && sameText(a.t, rec.correct)));
      if (!hits.length) continue;
      if (hits.length > 1) return { qEl: stEl, noFallback: true };
      return { qEl: stEl, card, target: hits[0].el, noFallback: true };
    }
    return { qEl: stEl, noFallback: true };
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
    for (const rec of recs) {
      const isDS = rec.q.startsWith(DS);
      const loc = isDS ? locateDS(rec, all) : locate(rec, all);
      if (!loc) continue;
      if (isDS) dsFound++; else found++;
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
        if (loc.noFallback || card.outerHTML !== before) return;
        const row = target.parentElement;
        if (row && row.children[0] && row.children[0] !== target) press(row.children[0]);
        setTimeout(() => { if (card.outerHTML === before && row) press(row); }, 400);
      }, 500);
      if (cfg.delay > 0) break;                      // có độ trễ: mỗi nhịp chỉ chọn 1 câu
    }
    return { found: found + Math.floor(dsFound / 4), ds: dsFound, done: clickedQ.size, page: pageQ.size, bankN: recs.length };
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
        <div><div class="azh-title">Azota Helper</div><div class="azh-sub">v2.7 · 桜 SAKURA</div></div>
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
  function stat(msg, fromTick) {
    if (msg !== undefined) lastMsg = msg;
    if (msg && !fromTick) holdUntil = Date.now() + 5000;
    const n = usableRecs().length;
    const m = (lastMsg || 'sẵn sàng nè ~') + (ghNote ? ' · ' + ghNote : '');
    const sig = n + '|' + m;
    if (sig === lastShown) return;
    lastShown = sig;
    $('azh-cnt').textContent = n;
    $('azh-face').textContent = faceFor(lastMsg || '');
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
  $('azh-lrn').checked = cfg.learn;  $('azh-lrn').onchange = e => { cfg.learn = e.target.checked; saveCfg(); stat(cfg.learn ? 'tự học đã bật' : 'tự học đã tắt, không quét đáp án nữa'); };
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
    const entries = Object.entries(bank).filter(([, v]) => usable(v)).filter(([, v]) => !f || norm(v.q).includes(f) || norm(v.correct).includes(f));
    const box = $('azh-list');
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
  $('azh-gpush').onclick = pushGithub;
  const codeEl = $('azh-code');
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
      items.forEach(([q, c]) => { bank[norm(q)] = { q, correct: c, t: code }; });
      saveBank();
      ghNote = `đề ${code}: đã tải ${items.length} câu từ GitHub`;
    } else if (r.s === 404) ghNote = `đề ${code} không có trên GitHub`;
    else if (r.s === 0) ghNote = 'không kết nối được GitHub';
    else if (r.s === 403) ghNote = 'GitHub đang giới hạn lượt gọi, thử lại sau';
    else ghNote = 'lỗi GitHub HTTP ' + r.s;
    stat();
  }
  $('azh-gpull').onclick = () => { stat('tải lại từ GitHub...'); pullExam(examCode()); };
  codeEl.onchange = () => {
    manualCode = extractCode(codeEl.value); codeEl.value = manualCode;
    stat(manualCode ? 'mã đề: ' + manualCode : 'dùng mã tự nhận từ trang: ' + (autoCode() || 'không có'));
    pullExam(examCode());
  };
  setInterval(() => { const h = 'Link / mã đề (tự nhận: ' + (autoCode() ? 'azota.vn/de-thi/' + autoCode() : 'không có') + ')'; if (codeEl.placeholder !== h) codeEl.placeholder = h; }, 1000);

  // vào link nào tự nhận mã đề link đó và tự tải file từ GitHub; sang link khác thì bỏ mã cũ
  let lastAuto = null;
  function watchUrl() {
    const c = autoCode();
    if (c === lastAuto) return;
    lastAuto = c; manualCode = ''; codeEl.value = ''; ghNote = ''; clearHl();
    if (c) pullExam(c); else stat();
  }
  setInterval(watchUrl, 700); watchUrl();

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
        bank[norm(q)] = { q, correct: c, t: examCode() || undefined };
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
  const ts = m => { if (Date.now() >= holdUntil) stat(m, true); };
  function tick() {
    if (inTake()) {
      const r = selectNow();
      prog(r.found, r.page);
      if (!r.bankN) return ts('chưa có đáp án cho đề này');
      if (!cfg.run) return ts('đã tạm dừng' + (r.found ? `, tô viền ${r.found} câu đã nhớ` : ''));
      if (!cfg.select) return ts(`tự chọn đang tắt, tô viền gợi ý ${r.found} câu`);
      return ts(`khớp ${r.found}/${r.page || r.bankN} câu` + (r.ds ? ` (${r.ds} ý đúng/sai)` : '') + `, đã chọn ${r.done}`);
    }
    prog(0, 0);
    if (!cfg.run) return ts('đã tạm dừng, không quét đáp án');
    if (!cfg.learn) return ts('tự học đang tắt, không quét đáp án');
    const r = learnNow();
    learnedNow += r.n;
    if (r.seen) ts(`đã quét ${r.seen}${r.total ? '/' + r.total : ''} câu, học thêm ${learnedNow} câu mới` + (r.missing.length ? ` — chưa đọc được: Câu ${r.missing.join('; Câu ')}` : ''));
    else ts('chờ trang xem đáp án để quét…');
  }
  function loop() {
    try { tick(); } catch (e) { console.error('Azota Helper:', e); }
    setTimeout(loop, inTake() && cfg.run && cfg.select && cfg.delay > 0 && cfg.delay < 600 ? Math.max(150, cfg.delay / 2) : 1000);
  }
  loop();
})();
