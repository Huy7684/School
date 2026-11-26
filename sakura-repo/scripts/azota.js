// ==UserScript==
// @name         Azota Helper - Sakura Edition
// @namespace    https://azota.vn/
// @version      6.13
// @description  桜 Sakura Edition (điện thoại + máy tính): quét "Đáp án đúng" (trắc nghiệm, đáp án ảnh, đúng/sai) ở trang xem đáp án rồi lưu, tự chọn lại ở lần làm sau, sổ đáp án có tìm kiếm, xuất/nhập .txt. Không tự nộp bài.
// @match        https://azota.vn/*
// @match        https://*.azota.vn/*
// @noframes
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// Azota Helper v6 - chạy trên điện thoại, máy tính bảng và máy tính (không dùng regex lookbehind để iPhone/Safari cũ không lỗi); giao diện wibu mới, sửa lỗi.
(function () {
  'use strict';
  if (window.__azh) return;
  window.__azh = true;

  const DS_PREFIX = '[ĐS] ';
  const BANK_KEY = 'azh-bank', CFG_KEY = 'azh-cfg', SEP = ' ||| ';
  const flat = s => String(s || '').replace(/\s+/g, ' ').trim();
  const norm = s => flat(s).toLowerCase();
  // v6.6: bỏ tiêu đề phần (vd "PHẦN I. TRẮC NGHIỆM ... LỰA CHỌN") dính vào đầu câu hỏi đầu tiên của mỗi phần
  const PART_RE = /^\s*PHẦN\s+[IVXLC\d]+\s*[.:\-–]?\s*[^\p{Ll}]+?(?=\s*\p{Lu}\p{Ll})/u;
  // v6.10: tiêu đề phần dạng "Phần 1. Câu hỏi trắc nghiệm nhiều phương án lựa chọn" có chữ thường nên PART_RE không bắt được -> câu bị lưu/so khớp kèm tiêu đề, lệch khoá với câu trên trang
  const PART2_RE = /^\s*PHẦN\s+[IVXLC\d]+\s*[.:\-–]?\s*Câu hỏi\s+(?:trắc nghiệm|đúng\s*sai|trả lời ngắn)[^?:.]*?(?:lựa chọn|đúng\s*sai|trả lời ngắn)\s*/iu;
  const stripPart = t => { const f = flat(t), r = f.replace(PART_RE, '').replace(PART2_RE, '').trim(); return r.length >= 3 ? r : f; };
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
  let bankVer = 0;   // tăng mỗi khi sổ đổi, để biết khi nào phải tính lại danh sách dùng được
  const saveBank = () => { bankVer++; try { localStorage.setItem(BANK_KEY, JSON.stringify(bank)); } catch (e) {} };
  { let dirty = 0; Object.keys(bank).forEach(k => { const r = bank[k]; if (r && r.correct) { const cc = cleanAns(r.correct); if (cc !== r.correct) { r.correct = cc; dirty = 1; } } if (!r || !r.q || !r.correct || labelOnly(r.correct)) { delete bank[k]; dirty = 1; } }); if (dirty) saveBank(); }

  { // v6.6: sửa các câu đã lưu bị dính tiêu đề "PHẦN ..."
    let dirty = 0;
    Object.keys(bank).forEach(k => {
      const r = bank[k]; if (!r || !r.q || r.q.indexOf(DS_PREFIX) === 0) return;
      const nq = stripPart(r.q);
      if (nq !== flat(r.q)) { delete bank[k]; const nk = norm(nq); if (!bank[nk]) bank[nk] = Object.assign({}, r, { q: nq }); dirty = 1; }
    });
    if (dirty) saveBank();
  }

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
  // Mỗi câu có thể thuộc nhiều đề: r.t là danh sách mã đề cách nhau bằng dấu phẩy (sổ cũ chỉ có 1 mã vẫn đọc được).
  // Trước đây r.t chỉ giữ 1 mã nên câu trùng giữa 2 đề cứ bị gắn lại qua lại, đề này lấy mất của đề kia.
  const hasT = (r, c) => !!r && !!r.t && ('' + r.t).split(',').indexOf(c) >= 0;
  const addT = (t, c) => !c ? t : (!t ? c : (hasT({ t }, c) ? t : t + ',' + c));
  // v6.9: khi các phương án giống hệt nhau (chỉ khác định dạng), đáp án lưu kèm chữ cái: "chữ ⟦opt:B⟧"
  // v6.12: thêm dấu vân tay ĐỊNH DẠNG của ô đúng "⟦fmt:u+i/b⟧" (đậm/nghiêng/gạch chân...). Đề đảo A-B-C-D thì chữ cái vô nghĩa,
  // còn định dạng đi theo nội dung ô nên vẫn chọn đúng khi 4 ô cùng chữ.
  const OPT_RE = /\s*(?:⟦fmt:([^⟧]*)⟧)?\s*(?:⟦opt:([A-F])⟧)?\s*$/;
  const stripOpt = s => String(s || '').replace(OPT_RE, '');
  const optLetter = s => { const m = OPT_RE.exec(String(s || '')); return m && m[2] ? m[2] : ''; };
  const fmtOf = s => { const m = OPT_RE.exec(String(s || '')); return m && m[1] ? m[1] : ''; };
  // Chữ cái chỉ đáng tin khi đề KHÔNG đảo. Mặc định tắt để không chọn nhầm khi đề đảo ô.
  const LETTER_FALLBACK = false;
  const putRec = (q, c, code, batch) => {
    let k = norm(q);
    if (batch) { const ck = norm(stripOpt(c)); if (batch[k] === undefined) batch[k] = ck; else if (batch[k] !== ck) k = k + ' ¦' + ck; }   // v6.10: 2 dòng cùng câu hỏi khác đáp án thì giữ cả hai
    const o = bank[k], same = !!o && norm(stripOpt(o.correct)) === norm(stripOpt(c));
    if (same && optLetter(o.correct) && !optLetter(c)) c = o.correct;   // bản tải từ GitHub không có chữ cái thì giữ bản đã học
    bank[k] = { q, correct: c, t: same ? (code ? addT(o.t, code) : o.t) : (code || undefined) };
  };
  let scKey = '', scVal = '', ueKey = '', ueVal = [], urSrc = null, urVal = [];
  const strictCode = () => {
    const c = examCode(), k = bankVer + '|' + c;
    if (k !== scKey) { scKey = k; scVal = STRICT_EXAM && c && Object.values(bank).some(r => r && hasT(r, c)) ? c : ''; }
    return scVal;
  };
  const usableWith = (r, sc) => !!(r && r.q && r.correct && (!sc || !r.t || hasT(r, sc)));
  const usableEntries = () => {
    const sc = strictCode(), k = bankVer + '|' + sc;
    if (k !== ueKey) { ueKey = k; ueVal = Object.entries(bank).filter(([, v]) => usableWith(v, sc)); }
    return ueVal;
  };
  // số câu hiện trên bảng: khi đã nhận ra đề thì chỉ đếm câu gắn đúng mã đề đó (không cộng cả sổ chung)
  let scnKey = '', scnVal = 0;
  const shownCount = () => {
    const sc = strictCode(), k = bankVer + '|' + sc;
    if (k !== scnKey) { scnKey = k; scnVal = sc ? Object.values(bank).filter(r => r && r.q && r.correct && hasT(r, sc)).length : usableRecs().length; }
    return scnVal;
  };
  // Danh sách dùng để so khớp với trang: chỉ câu gắn đúng mã đề này. Nếu trang còn câu chưa khớp thì mới mở rộng ra cả sổ (wideMode).
  let wideMode = false, wideFor = '', poolKey = '', poolVal = [];
  const poolRecs = () => {
    const sc = strictCode(), k = bankVer + '|' + sc + '|' + location.pathname;
    if (k !== wideFor) { wideFor = k; wideMode = false; }
    if (!sc || wideMode) return usableRecs();
    if (k !== poolKey) { poolKey = k; poolVal = usableEntries().map(x => x[1]).filter(r => hasT(r, sc)); }
    return poolVal.length ? poolVal : usableRecs();
  };
  const usableRecs = () => { const e = usableEntries(); if (urSrc !== e) { urSrc = e; urVal = e.map(x => x[1]); } return urVal; };

  // ---------- Giao diện (điện thoại, máy tính bảng, máy tính) ----------
  const mq = q => { try { return !!(window.matchMedia && matchMedia(q).matches); } catch (e) { return false; } };
  const REDUCED = mq('(prefers-reduced-motion: reduce)');
  const COARSE = mq('(pointer: coarse)');
  if (typeof cfg.min !== 'boolean') cfg.min = innerWidth <= 640;   // điện thoại: mặc định thu gọn thành nút tròn
  if (typeof cfg.x !== 'number' || typeof cfg.y !== 'number') { cfg.x = null; cfg.y = null; }

  const css = document.createElement('style');
  css.textContent = `#azh{--ink:#2b1b3d;--pk:#ff6fa8;--pk2:#c42a76;--pkl:#ffd3e4;--lv:#9c86f5;--gold:#ffd25e;--red:#e8404f;
--tx:#2b1b3d;--tx2:#7a6694;--paper:#fff8f1;--paper2:#ffeef6;--edge:#ffd3e4;--dot:rgba(255,111,168,.17);--box:#2b1b3d;--boxtx:#fff6fb;--inp:#fff;--trk:#d8cdea;--rim:rgba(255,255,255,0);
position:fixed;top:72px;right:max(12px,env(safe-area-inset-right,0px));width:min(348px,calc(100vw - 16px));margin:0;padding:0;
max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));
display:flex;flex-direction:column;z-index:2147483647;
font:13px/1.5 "Hiragino Maru Gothic ProN","M PLUS Rounded 1c","Yu Gothic UI","Meiryo UI",system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif;
color:var(--tx);color-scheme:light;text-align:left;letter-spacing:normal;text-transform:none;
-webkit-text-size-adjust:100%;text-size-adjust:100%;touch-action:manipulation;
animation:azh-in .5s cubic-bezier(.2,1.4,.4,1) both}
@media (prefers-color-scheme:dark){#azh{color-scheme:dark;--ink:#150b24;--tx:#fbeefa;--tx2:#c9b8e0;--pk2:#ff9fcd;--paper:#2a1a40;--paper2:#36234f;--edge:#4d3072;--dot:rgba(255,150,200,.11);--box:#150b24;--inp:#231536;--trk:#5a4a78;--rim:rgba(255,159,205,.55)}}
#azh *,#azh *::before,#azh *::after{box-sizing:border-box}
#azh button{-webkit-appearance:none;appearance:none;font:inherit;cursor:pointer;border:0;position:relative;overflow:hidden;-webkit-tap-highlight-color:transparent;margin:0}
#azh input,#azh select{font:inherit;color:var(--tx);margin:0}
#azh button:focus-visible,#azh summary:focus-visible,#azh-head:focus-visible{outline:3px solid #7a4dff;outline-offset:2px}
#azh-head button:focus-visible,#azh-head:focus-visible{outline-color:#fff}
.azh-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* khung chính: giấy washi + chấm screentone, viền mực dày, bóng cứng kiểu manga */
.azh-card{position:relative;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden;border-radius:18px;border:3px solid var(--ink);
  background:radial-gradient(var(--dot) 1.3px,transparent 1.7px) 0 0/12px 12px,radial-gradient(var(--dot) 1.3px,transparent 1.7px) 6px 6px/12px 12px,var(--paper);
  box-shadow:inset 0 0 0 2px var(--edge),0 0 0 1.5px var(--rim),5px 6px 0 var(--ink),0 14px 30px rgba(60,20,80,.28)}
.azh-card::after{content:"桜";position:absolute;right:-4px;bottom:-22px;z-index:0;font:900 132px/1 "Yu Mincho","Hiragino Mincho ProN","Noto Serif CJK JP","Noto Serif JP","Songti SC",serif;color:var(--pk);opacity:.09;pointer-events:none}

/* cánh hoa rơi sau nội dung */
.azh-fx{position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;overflow:hidden;z-index:0}
.azh-fx .pt{position:absolute;top:-16px;border-radius:150% 0 150% 0;background:linear-gradient(135deg,#ffd0e5,#ff8fc2);opacity:0;animation:azh-fall linear infinite}
.azh-fx .sp{position:absolute;background:#fff;clip-path:polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%);opacity:0;animation:azh-sp ease-in-out infinite}
.azh-fx .sp.v{background:#d9c8ff}.azh-fx .sp.b{background:#cdeaff}

/* header: tông hồng screentone, có vạch tốc độ khi đang chạy */
#azh-head{position:relative;z-index:2;flex:none;display:flex;align-items:center;justify-content:space-between;padding:9px 10px 10px;color:#fff;cursor:grab;
  user-select:none;-webkit-user-select:none;touch-action:none;border-bottom:3px solid var(--ink);
  background:radial-gradient(rgba(255,255,255,.42) 1.4px,transparent 1.9px) 0 0/9px 9px,linear-gradient(180deg,#ff8dbb,#ff5f9d)}
#azh-head::before{content:"";position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;opacity:0;transition:opacity .4s;
  background:repeating-linear-gradient(105deg,transparent 0 16px,rgba(255,255,255,.3) 16px 19px);background-size:38px 100%}
#azh.running #azh-head::before{opacity:1;animation:azh-lines 1.1s linear infinite}
.azh-logo{position:relative;z-index:1;display:flex;align-items:center;min-width:0}
.azh-ttl{min-width:0}
.azh-title{font-weight:900;font-size:16px;line-height:1.2;letter-spacing:.5px;white-space:nowrap;color:#fff;
  text-shadow:-1.5px -1.5px 0 var(--ink),1.5px -1.5px 0 var(--ink),-1.5px 1.5px 0 var(--ink),1.5px 1.5px 0 var(--ink),0 2.5px 0 var(--ink)}
.azh-sub{display:inline-flex;align-items:center;margin-top:3px;padding:0 8px 0 6px;border:1.5px solid var(--ink);border-radius:999px;background:#fff8f1;color:#c42a76;
  font-size:10.5px;font-weight:800;letter-spacing:.3px;white-space:nowrap;line-height:16px;text-shadow:none}
.azh-dot{flex:none;width:7px;height:7px;margin-right:5px;border-radius:50%;background:#ffd25e;border:1.5px solid var(--ink)}
#azh.running .azh-dot{background:#5ff0a4;animation:azh-dotp 1.6s ease-in-out infinite}
.azh-hbtns{position:relative;z-index:1;display:flex;align-items:center;flex:none;margin-left:8px}
.azh-hbtns>*+*{margin-left:7px}
#azh .azh-runbtn{display:inline-flex;align-items:center;padding:5px 12px;border:2.5px solid var(--ink);border-radius:10px;font-weight:900;font-size:12.5px;min-height:34px;white-space:nowrap;box-shadow:0 3px 0 var(--ink);transition:transform .1s,box-shadow .1s}
#azh .azh-runbtn::before{margin-right:6px;font-size:10px}
#azh .azh-runbtn:active{transform:translateY(3px);box-shadow:0 0 0 var(--ink)}
#azh .azh-runbtn.on{background:#fff8f1;color:#c42a76}
#azh .azh-runbtn.on::before{content:"❚❚"}
#azh .azh-runbtn.off{background:#ffd25e;color:#2b1b3d;animation:azh-pulse 1.4s ease-in-out infinite}
#azh .azh-runbtn.off::before{content:"▶"}
#azh .azh-minbtn{width:34px;height:34px;border:2.5px solid var(--ink);border-radius:10px;background:#fff8f1;color:#2b1b3d;font-size:18px;font-weight:900;line-height:1;padding:0;box-shadow:0 3px 0 var(--ink);transition:transform .1s,box-shadow .1s}
#azh .azh-minbtn:active{transform:translateY(3px);box-shadow:0 0 0 var(--ink)}

/* linh vật neko: đổi biểu cảm theo trạng thái (data-mood) */
.azh-mascot{position:relative;flex:none;width:50px;height:50px;margin-right:10px;border-radius:50%;border:3px solid var(--ink);
  background:radial-gradient(circle at 50% 30%,#fff,#ffd9ea 75%);box-shadow:2px 3px 0 rgba(43,27,61,.55)}
.azh-mascot::before{content:"";position:absolute;left:-7px;right:-7px;top:-7px;bottom:-7px;border-radius:50%;border:2px dashed rgba(255,255,255,.95);opacity:0;transition:opacity .3s;pointer-events:none}
#azh.running .azh-mascot::before{opacity:1;animation:azh-spin 9s linear infinite}
#azh.running .azh-mascot{animation:azh-bob 3.2s ease-in-out infinite}
.azh-mv{position:absolute;left:0;top:0;width:100%;height:100%;display:block;overflow:visible}
#azh .azh-mv [data-for]{display:none}
#azh[data-mood="idle"] .azh-mv [data-for~="idle"],#azh[data-mood="happy"] .azh-mv [data-for~="happy"],#azh[data-mood="star"] .azh-mv [data-for~="star"],
#azh[data-mood="sleep"] .azh-mv [data-for~="sleep"],#azh[data-mood="worry"] .azh-mv [data-for~="worry"],#azh[data-mood="think"] .azh-mv [data-for~="think"]{display:inline}
.azh-eo{transform-box:fill-box;transform-origin:50% 55%}
#azh[data-mood="idle"] .azh-eo{animation:azh-blink 4.8s infinite}
#azh[data-mood="think"] .azh-eo{transform:translate(1.4px,-1.2px)}
#azh[data-mood="star"] .azh-mv{animation:azh-hop .6s ease-out}
.azh-spk{transform-box:fill-box;transform-origin:center;animation:azh-sp 1.6s ease-in-out infinite}
.azh-zz{animation:azh-zz 2.4s ease-in-out infinite}

/* thu gọn: nút tròn linh vật + nút Chạy/Dừng ngay bên cạnh */
#azh .azh-mrun{display:none}
#azh.min{width:auto;height:auto;max-height:none;cursor:pointer;touch-action:none}
#azh.min .azh-card{flex-direction:row;align-items:center;overflow:visible;border:0;border-radius:0;background:none;box-shadow:none}
#azh.min .azh-card::after{display:none}
#azh.min #azh-body,#azh.min .azh-hbtns,#azh.min .azh-ttl,#azh.min .azh-fx{display:none}
#azh.min #azh-head{flex:none;width:64px;height:64px;padding:0;justify-content:center;border:3px solid var(--ink);border-radius:50%;cursor:pointer;
  box-shadow:3px 4px 0 var(--ink),0 8px 18px rgba(60,20,80,.3)}
#azh.min #azh-head::before{border-radius:50%}
#azh.min .azh-mascot{width:52px;height:52px;margin:0;border:0;background:none;box-shadow:none}
#azh.min .azh-mascot::before{left:-2px;right:-2px;top:-2px;bottom:-2px}
#azh.min .azh-mrun{display:flex;align-items:center;justify-content:center;flex:none;width:48px;height:48px;margin-left:10px;padding:0;
  border:3px solid var(--ink);border-radius:50%;background:var(--pk);color:#fff;box-shadow:3px 4px 0 var(--ink);transition:transform .1s,box-shadow .1s}
#azh.min .azh-mrun:active{transform:translate(3px,4px);box-shadow:0 0 0 var(--ink)}
#azh.min:not(.running) .azh-mrun{background:var(--gold);color:var(--ink);animation:azh-ring 1.5s ease-in-out infinite}
#azh .azh-mrun svg{width:22px;height:22px;fill:currentColor;pointer-events:none}
#azh .azh-ic-pause{display:none}
#azh.running .azh-ic-pause{display:block}
#azh.running .azh-ic-play{display:none}
.azh-badge{display:none;position:absolute;z-index:3;min-width:22px;height:22px;padding:0 5px;border:2px solid var(--ink);border-radius:999px;background:#fff8f1;color:#c42a76;
  font-weight:900;font-size:11px;line-height:1;align-items:center;justify-content:center;pointer-events:none}
#azh.min .azh-badge{display:flex;left:42px;top:42px}

/* hiệu ứng biến hình khi thu gọn / mở ra + cánh hoa bung */
#azh.fold .azh-card{transform-origin:32px 34px;animation:azh-fold .24s cubic-bezier(.5,0,.9,.4) forwards}
#azh.pop-in .azh-card{transform-origin:32px 32px;animation:azh-dock .55s cubic-bezier(.2,1.6,.4,1) both}
#azh.unfold .azh-card{transform-origin:32px 34px;animation:azh-unfold .5s cubic-bezier(.2,1.35,.4,1) both}
#azh.unfold .azh-main>*{animation:azh-rise .45s cubic-bezier(.2,1.3,.4,1) both}
#azh.unfold .azh-main>*:nth-child(1){animation-delay:0.10s}
#azh.unfold .azh-main>*:nth-child(2){animation-delay:0.14s}
#azh.unfold .azh-main>*:nth-child(3){animation-delay:0.18s}
#azh.unfold .azh-main>*:nth-child(4){animation-delay:0.22s}
#azh.unfold .azh-main>*:nth-child(5){animation-delay:0.26s}
#azh.unfold .azh-main>*:nth-child(6){animation-delay:0.30s}
#azh.unfold .azh-main>*:nth-child(7){animation-delay:0.34s}
#azh.unfold .azh-main>*:nth-child(8){animation-delay:0.38s}
#azh.unfold .azh-main>*:nth-child(9){animation-delay:0.42s}
#azh.unfold .azh-main>*:nth-child(10){animation-delay:0.46s}
#azh.unfold .azh-main>*:nth-child(11){animation-delay:0.50s}
#azh.unfold .azh-main>*:nth-child(12){animation-delay:0.54s}
.azh-bst{position:absolute;z-index:6;width:11px;height:11px;margin:-5px;border-radius:150% 0 150% 0;pointer-events:none;animation:azh-bst .8s cubic-bezier(.1,.7,.3,1) forwards}
.azh-bst.s{border-radius:0;clip-path:polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%)}

/* thân */
#azh-body{position:relative;z-index:1;flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:14px 12px 12px;scrollbar-width:thin;scrollbar-color:#ff8fc2 transparent}
#azh-body::-webkit-scrollbar{width:6px}#azh-body::-webkit-scrollbar-thumb{background:#ff8fc2;border-radius:6px}

.azh-stats{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:6px}
.azh-stat{position:relative;min-width:0;padding:6px 38px 8px 10px;border:2px solid var(--ink);border-radius:11px;background:var(--paper2);box-shadow:2px 3px 0 var(--ink)}
.azh-stat::after{content:attr(data-jp);position:absolute;right:6px;top:7px;width:26px;height:26px;border-radius:5px;background:var(--red);color:#fff;
  font:900 15px/26px "Yu Mincho","Hiragino Mincho ProN","Noto Serif CJK JP","Noto Serif JP","Songti SC",serif;text-align:center;transform:rotate(7deg);
  box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.65);opacity:.95;pointer-events:none}
.azh-stat small{display:block;color:var(--tx2);font-size:11px;font-weight:700;white-space:nowrap}
.azh-stat b{position:relative;display:inline-block;font-size:21px;line-height:1.15;color:var(--pk2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;vertical-align:bottom}
.azh-stat b.sm{font-size:15px;line-height:1.6}
.azh-stat b.bump{animation:azh-bump .5s cubic-bezier(.3,1.8,.5,1)}
.azh-stat span{position:relative;color:var(--tx2);font-size:11px}

/* khung thoại visual novel: bảng tên + gõ chữ + mũi tên ▼ */
.azh-bubble{position:relative;display:flex;align-items:flex-start;margin:20px 0 12px;padding:14px 26px 11px 13px;min-height:62px;border:2.5px solid var(--ink);border-radius:12px;background:var(--box);color:var(--boxtx);
  box-shadow:inset 0 0 0 2px rgba(255,211,228,.5),3px 4px 0 var(--ink)}
.azh-bubble.pop{animation:azh-pop .4s cubic-bezier(.3,1.7,.5,1)}
.azh-np{position:absolute;left:12px;top:-13px;padding:0 12px;border:2.5px solid var(--ink);border-radius:999px;background:var(--pk);color:#fff;font-weight:900;font-size:11.5px;line-height:19px;letter-spacing:.4px;text-shadow:0 1px 0 rgba(43,27,61,.5)}
.azh-caret{position:absolute;right:10px;bottom:8px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:8px solid var(--gold);animation:azh-caret 1s ease-in-out infinite}
#azh-face{flex:none;margin-right:9px;font-weight:800;color:var(--gold);white-space:nowrap;font-size:12.5px}
#azh-st{min-width:0;color:var(--boxtx);font-size:12.5px;word-break:break-word}

.azh-sw{position:relative;display:flex;align-items:center;min-height:44px;padding:4px 6px;cursor:pointer;border-radius:12px;-webkit-tap-highlight-color:transparent}
@media (hover:hover){.azh-sw:hover{background:rgba(255,111,168,.14)}}
.azh-sw input{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px}
.azh-sw i{position:relative;flex:none;width:50px;height:28px;margin-right:11px;border:2.5px solid var(--ink);border-radius:999px;background:var(--trk);transition:background .25s}
.azh-sw i::after{content:"✿";position:absolute;top:1.5px;left:2px;width:20px;height:20px;border:2px solid var(--ink);border-radius:50%;background:#fff;
  font:700 12px/16px system-ui,sans-serif;text-align:center;color:#c6bad8;transition:transform .3s cubic-bezier(.3,1.7,.5,1),color .2s}
.azh-sw input:checked+i{background:var(--pk)}
.azh-sw input:checked+i::after{transform:translateX(21px) rotate(72deg);color:#e0357f}
.azh-sw input:focus-visible+i{outline:3px solid #7a4dff;outline-offset:2px}
.azh-sw span{min-width:0;font-weight:700}

.azh-box{position:relative;margin:9px 0;padding:9px 12px 10px;border:2px solid var(--ink);border-radius:12px;background:var(--paper2);box-shadow:2px 3px 0 var(--ink)}
.azh-box small{color:var(--tx2)}
#azh-ms{color:var(--pk2);font-size:14px}
#azh-spd{-webkit-appearance:none;appearance:none;display:block;width:100%;height:13px;margin:14px 0 6px;padding:0;border:2px solid var(--ink);border-radius:999px;outline:0;cursor:pointer;touch-action:pan-y;
  background:linear-gradient(90deg,#ff6fa8 var(--p,15%),var(--trk) var(--p,15%))}
#azh-spd::-webkit-slider-thumb{-webkit-appearance:none;width:26px;height:26px;border-radius:50%;border:3px solid var(--ink);background:radial-gradient(circle,#ffd25e 0 24%,#ff6fa8 27%);box-shadow:0 2px 0 var(--ink)}
#azh-spd::-moz-range-thumb{width:20px;height:20px;border-radius:50%;border:3px solid var(--ink);background:radial-gradient(circle,#ffd25e 0 24%,#ff6fa8 27%)}
#azh-spd::-moz-range-track{background:transparent}
#azh-spd:focus-visible{outline:3px solid #7a4dff;outline-offset:4px}
.azh-ends{display:flex;justify-content:space-between;font-size:11px;font-weight:700;color:var(--tx2)}
.azh-inp{display:block;width:100%;margin-top:6px;padding:8px 12px;border:2px solid var(--ink);border-radius:10px;background:var(--inp);outline:0;min-height:42px}
.azh-inp:focus{border-color:var(--pk2);box-shadow:3px 3px 0 var(--pk)}
select.azh-inp{-webkit-appearance:none;appearance:none;padding-right:34px;
  background-image:linear-gradient(45deg,transparent 50%,#c42a76 50%),linear-gradient(135deg,#c42a76 50%,transparent 50%);
  background-position:calc(100% - 19px) 55%,calc(100% - 14px) 55%;background-size:5px 5px,5px 5px;background-repeat:no-repeat}

.azh-adv{margin:9px 0 0;border:2px solid var(--ink);border-radius:12px;background:var(--paper2);box-shadow:2px 3px 0 var(--ink)}
.azh-adv>summary{list-style:none;cursor:pointer;min-height:44px;padding:12px;font-weight:800;display:flex;justify-content:space-between;align-items:center;-webkit-tap-highlight-color:transparent}
.azh-adv>summary::-webkit-details-marker{display:none}
.azh-adv>summary::after{content:"▾";color:var(--pk2);transition:transform .2s}
.azh-adv[open]>summary::after{transform:rotate(180deg)}
.azh-advin{padding:0 10px 10px}

/* nút sticker: viền mực, bóng cứng, nhấn xuống khi bấm */
.azh-acts{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:9px}
#azh .azh-act{min-height:42px;padding:8px 10px;border:2.5px solid var(--ink);border-radius:12px;font-weight:800;font-size:12.5px;color:#fff;text-shadow:0 1.5px 0 rgba(43,27,61,.55);
  background:linear-gradient(180deg,rgba(255,255,255,.28) 0 45%,transparent 45%),var(--pk);box-shadow:0 4px 0 var(--ink);transition:transform .1s,box-shadow .1s}
@media (hover:hover){#azh .azh-act:hover{transform:translateY(-1px);box-shadow:0 5px 0 var(--ink)}}
#azh .azh-act:active{transform:translateY(4px);box-shadow:0 0 0 var(--ink)}
#azh .azh-act.alt{background:linear-gradient(180deg,rgba(255,255,255,.28) 0 45%,transparent 45%),var(--lv)}
#azh .azh-act.danger{grid-column:1/-1;background:linear-gradient(180deg,rgba(255,255,255,.28) 0 45%,transparent 45%),var(--red)}
#azh .azh-act.wide{grid-column:1/-1}
.azh-rip{position:absolute;border-radius:50%;background:rgba(255,255,255,.6);transform:scale(0);animation:azh-rip .6s ease-out forwards;pointer-events:none}
.azh-foot{display:flex;align-items:center;margin-top:14px;font-size:11px;font-weight:700;letter-spacing:.6px;color:var(--tx2)}
.azh-foot::before,.azh-foot::after{content:"";flex:1;height:2px;background:repeating-linear-gradient(90deg,var(--pk) 0 4px,transparent 4px 8px);opacity:.7}
.azh-foot::before{margin-right:9px}.azh-foot::after{margin-left:9px}
.azh-trail{position:absolute;width:9px;height:9px;margin:-4px;border-radius:150% 0 150% 0;pointer-events:none;z-index:5;animation:azh-trail .8s ease-out forwards}
.azh-bar{height:12px;margin:0 2px 8px;border:2px solid var(--ink);border-radius:999px;background:var(--paper2);overflow:hidden}
.azh-bar i{display:block;height:100%;width:0;background:repeating-linear-gradient(135deg,rgba(255,255,255,.4) 0 6px,transparent 6px 12px),linear-gradient(90deg,#ff6fa8,#b69bff);transition:width .5s cubic-bezier(.3,1.4,.5,1)}
#azh-bookv{display:none;position:relative;z-index:1}
#azh-list{margin:10px 0;max-height:min(320px,45vh);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#ff8fc2 transparent}
.azh-item{position:relative;margin-bottom:8px;padding:8px 40px 8px 11px;border:2px solid var(--ink);border-radius:11px;background:var(--paper2);box-shadow:2px 3px 0 var(--ink)}
.azh-item .q{font-weight:800;font-size:12px;word-break:break-word}
.azh-item .a{margin-top:3px;color:var(--pk2);font-size:12px;font-weight:700;word-break:break-word}
#azh .azh-item .x{position:absolute;top:7px;right:7px;width:28px;height:28px;border:2px solid var(--ink);border-radius:8px;background:var(--red);color:#fff;font-weight:900;font-size:15px;line-height:1;padding:0;box-shadow:0 2px 0 var(--ink)}
#azh .azh-item .x:active{transform:translateY(2px);box-shadow:none}
.azh-empty{text-align:center;color:var(--tx2);padding:14px 0}
@media (pointer:coarse){#azh .azh-item .x{width:36px;height:36px}}


/* mọi kích cỡ màn hình */
@media (pointer:coarse){#azh input,#azh select{font-size:16px}#azh .azh-act{min-height:46px;font-size:13.5px}#azh .azh-runbtn{min-height:38px}#azh .azh-minbtn{width:38px;height:38px}}
@media (max-width:360px){#azh .azh-sub{display:none}#azh .azh-title{font-size:14px}#azh .azh-stat b{font-size:19px}}
@media (max-height:520px){#azh-body{padding:8px}.azh-fx{display:none}}
@media (min-width:1280px){#azh{width:372px}#azh.min{width:auto}}
@media print{#azh{display:none!important}}

@keyframes azh-in{from{opacity:0;transform:translateY(-16px) scale(.92)}to{opacity:1;transform:none}}
@keyframes azh-lines{from{background-position:0 0}to{background-position:38px 0}}
@keyframes azh-spin{to{transform:rotate(360deg)}}
@keyframes azh-bob{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-3px) rotate(4deg)}}
@keyframes azh-hop{0%{transform:translateY(0)}35%{transform:translateY(-6px) scale(1.08)}70%{transform:translateY(0) scale(.97)}100%{transform:none}}
@keyframes azh-blink{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(.08)}}
@keyframes azh-sp{0%,100%{opacity:0;transform:scale(.2) rotate(0)}50%{opacity:.95;transform:scale(1) rotate(90deg)}}
@keyframes azh-zz{0%{opacity:0;transform:translate(0,3px)}40%{opacity:1}100%{opacity:0;transform:translate(4px,-7px)}}
@keyframes azh-fall{0%{opacity:0;transform:translate(0,0) rotate(0)}10%{opacity:.8}85%{opacity:.8}100%{opacity:0;transform:translate(var(--sx,0px),var(--fh,520px)) rotate(540deg)}}
@keyframes azh-pulse{0%,100%{box-shadow:0 3px 0 var(--ink),0 0 0 0 rgba(255,243,160,.95)}50%{box-shadow:0 3px 0 var(--ink),0 0 0 8px rgba(255,243,160,0)}}
@keyframes azh-ring{0%,100%{box-shadow:3px 4px 0 var(--ink),0 0 0 0 rgba(255,210,94,.95)}50%{box-shadow:3px 4px 0 var(--ink),0 0 0 10px rgba(255,210,94,0)}}
@keyframes azh-dotp{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes azh-bump{0%{transform:scale(1)}40%{transform:scale(1.5) rotate(-5deg)}100%{transform:scale(1)}}
@keyframes azh-pop{0%{transform:scale(.96)}60%{transform:scale(1.03)}100%{transform:scale(1)}}
@keyframes azh-caret{0%,100%{transform:translateY(0)}50%{transform:translateY(3px)}}
@keyframes azh-rip{to{transform:scale(1);opacity:0}}
@keyframes azh-trail{0%{opacity:.95;transform:translate(0,0) rotate(0) scale(1)}100%{opacity:0;transform:translate(var(--dx),var(--dy)) rotate(var(--r)) scale(.3)}}
@keyframes azh-fold{0%{transform:none;opacity:1}100%{transform:scale(.16) rotate(-14deg);opacity:0}}
@keyframes azh-dock{0%{transform:scale(.25) rotate(-30deg);opacity:0}55%{opacity:1}100%{transform:none;opacity:1}}
@keyframes azh-unfold{0%{transform:scale(.2) rotate(8deg);opacity:0}100%{transform:none;opacity:1}}
@keyframes azh-rise{0%{opacity:0;transform:translateY(10px) scale(.96)}100%{opacity:1;transform:none}}
@keyframes azh-bst{0%{opacity:1;transform:translate(0,0) rotate(0) scale(.5)}100%{opacity:0;transform:translate(var(--dx),var(--dy)) rotate(var(--r)) scale(1.15)}}
@media (prefers-reduced-motion:reduce){#azh,#azh *{animation:none!important;transition:none!important}}


/* ===== v2: giao diện tinh chỉnh + đổi kích thước menu ===== */
#azh{width:var(--w,min(348px,calc(100vw - 16px)));height:var(--h,auto);
--ic-sync:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M20 11a8 8 0 00-14.5-4M4 4v4h4M4 13a8 8 0 0014.5 4M20 20v-4h-4' fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
--ic-cdl:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M7 18a4.5 4.5 0 01-.6-8.96A6 6 0 0117.7 8.5 4 4 0 0117 18M12 11v7m0 0l-3-3m3 3l3-3' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
--ic-cup:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M7 18a4.5 4.5 0 01-.6-8.96A6 6 0 0117.7 8.5 4 4 0 0117 18M12 18v-7m0 0l-3 3m3-3l3 3' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
--ic-dl:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 4v11m0 0l-4-4m4 4l4-4M5 20h14' fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
--ic-ul:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 15V4m0 0L8 8m4-4l4 4M5 20h14' fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
--ic-trash:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
--ic-link:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1' fill='none' stroke='%23ff6fa8' stroke-width='2.3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
@media (min-width:1280px){#azh{width:var(--w,372px)}}
#azh.sizing{user-select:none;-webkit-user-select:none}
#azh.sizing *{transition:none!important}
#azh-body{padding-bottom:24px}

/* tay nắm kéo giãn ở góc dưới bên phải */
.azh-grip{position:absolute;right:2px;bottom:2px;z-index:7;width:28px;height:28px;border-radius:10px;cursor:nwse-resize;touch-action:none;opacity:.8;transition:opacity .15s,background .15s}
.azh-grip::before{content:"";position:absolute;right:6px;bottom:6px;width:13px;height:13px;
  background:linear-gradient(135deg,transparent 0 38%,var(--pk2) 38% 50%,transparent 50% 63%,var(--pk2) 63% 75%,transparent 75% 88%,var(--pk2) 88% 100%);clip-path:polygon(100% 0,100% 100%,0 100%)}
@media (hover:hover){.azh-grip:hover{opacity:1;background:rgba(255,111,168,.16)}}
#azh.sizing .azh-grip{opacity:1;background:rgba(255,111,168,.22)}
#azh.min .azh-grip{display:none}
@media (pointer:coarse){.azh-grip{width:38px;height:38px}.azh-grip::before{right:9px;bottom:9px}}

/* khối "Đồng bộ & dữ liệu" */
#azh .azh-adv{margin-top:12px;border-radius:16px;overflow:hidden;background:linear-gradient(180deg,var(--paper2),var(--paper))}
#azh .azh-adv>summary{justify-content:flex-start;gap:10px;padding:12px 14px;font-size:13px;letter-spacing:.2px}
#azh .azh-adv>summary::before{content:"";flex:none;width:20px;height:20px;background:var(--pk2);-webkit-mask:var(--ic-sync) center/contain no-repeat;mask:var(--ic-sync) center/contain no-repeat}
#azh .azh-adv>summary::after{margin-left:auto;display:grid;place-items:center;width:22px;height:22px;border-radius:50%;border:2px solid var(--ink);background:var(--pk);color:#fff;font-size:11px;line-height:1}
#azh .azh-adv[open]>summary{border-bottom:2px dashed var(--edge)}
#azh .azh-advin{padding:12px}
#azh #azh-code{min-height:46px;margin:0;padding:10px 12px 10px 40px;border:2px solid var(--ink);border-radius:14px;font-size:13px;
  background:var(--inp) var(--ic-link) 13px center/17px no-repeat;box-shadow:inset 0 2px 0 rgba(43,27,61,.08);transition:box-shadow .15s,border-color .15s}
#azh #azh-code:focus{border-color:var(--pk);box-shadow:0 0 0 3px rgba(255,111,168,.35)}
#azh .azh-acts{gap:9px;margin-top:11px}
#azh .azh-act{display:flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:9px 12px;border:2px solid var(--ink);border-radius:14px;
  font-weight:800;font-size:12.5px;letter-spacing:.2px;color:#fff;text-shadow:none;background:linear-gradient(135deg,#ff86b8,#f0488f);
  box-shadow:0 3px 0 var(--ink),inset 0 1px 0 rgba(255,255,255,.45);transition:transform .1s,box-shadow .1s,filter .15s}
#azh .azh-act::before{content:"";flex:none;width:17px;height:17px;background:currentColor;pointer-events:none;-webkit-mask:var(--i) center/contain no-repeat;mask:var(--i) center/contain no-repeat}
#azh #azh-gpull{--i:var(--ic-cdl)}#azh #azh-gpush{--i:var(--ic-cup)}#azh #azh-exp{--i:var(--ic-dl)}#azh #azh-imp{--i:var(--ic-ul)}#azh #azh-clr{--i:var(--ic-trash)}
#azh #azh-book{--i:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4 5a2 2 0 012-2h13v15H6a2 2 0 00-2 2zM4 20a2 2 0 002 2h13M9 7.5h6' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
#azh #azh-back{--i:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M10 6l-6 6 6 6M4 12h16' fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
#azh .azh-act:not([id])::before{display:none}
@media (hover:hover){#azh .azh-act:hover{transform:translateY(-1px);filter:brightness(1.07);box-shadow:0 4px 0 var(--ink),inset 0 1px 0 rgba(255,255,255,.45)}}
#azh .azh-act:active{transform:translateY(3px);box-shadow:0 0 0 var(--ink),inset 0 1px 0 rgba(255,255,255,.45)}
#azh .azh-act.wide.alt{background:linear-gradient(135deg,#b3a2ff,#7a5ae6)}
#azh .azh-act:not(.wide):not(.danger){background:var(--inp);color:var(--tx);box-shadow:0 3px 0 var(--ink)}
#azh #azh-exp::before{background:var(--pk2)}#azh #azh-imp::before{background:var(--lv)}
#azh .azh-act.danger{min-height:40px;background:transparent;color:var(--red);border:2px dashed var(--red);box-shadow:none;font-size:12px}
#azh .azh-act.danger:active{transform:none;background:var(--red);color:#fff;box-shadow:none}
@media (hover:hover){#azh .azh-act.danger:hover{transform:none;filter:none;background:var(--red);color:#fff;box-shadow:none}}
@media (prefers-color-scheme:dark){#azh .azh-act.danger{color:#ff8791;border-color:#ff8791}#azh .azh-act.danger:active{background:#e8404f;color:#fff}}
@media (prefers-color-scheme:dark) and (hover:hover){#azh .azh-act.danger:hover{background:#e8404f;color:#fff}}

/* khối "Kích thước menu" */
#azh .azh-szh{display:flex;justify-content:space-between;align-items:baseline}
#azh .azh-szh label{font-weight:800}
#azh .azh-szh b{color:var(--pk2);font-size:13px}
#azh #azh-sz{-webkit-appearance:none;appearance:none;display:block;width:100%;height:13px;margin:14px 0 8px;padding:0;border:2px solid var(--ink);border-radius:999px;outline:0;cursor:pointer;touch-action:pan-y;
  background:linear-gradient(90deg,#ff6fa8 var(--p,40%),var(--trk) var(--p,40%))}
#azh #azh-sz::-webkit-slider-thumb{-webkit-appearance:none;width:26px;height:26px;border-radius:50%;border:3px solid var(--ink);background:radial-gradient(circle,#ffd25e 0 24%,#ff6fa8 27%);box-shadow:0 2px 0 var(--ink)}
#azh #azh-sz::-moz-range-thumb{width:20px;height:20px;border-radius:50%;border:3px solid var(--ink);background:radial-gradient(circle,#ffd25e 0 24%,#ff6fa8 27%)}
#azh #azh-sz::-moz-range-track{background:transparent}
#azh #azh-sz:focus-visible{outline:3px solid #7a4dff;outline-offset:4px}
#azh .azh-ends{align-items:center}
#azh .azh-chip{padding:3px 12px;border:2px solid var(--ink);border-radius:999px;background:var(--inp);color:var(--tx);font-weight:800;font-size:11px;box-shadow:0 2px 0 var(--ink)}
#azh .azh-chip:active{transform:translateY(2px);box-shadow:none}
@media (pointer:coarse){#azh .azh-chip{padding:8px 16px}}
#azh .azh-tip{margin-top:8px;font-size:11px;color:var(--tx2)}
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
  const fxHtml = REDUCED ? '' : `<div class="azh-fx" aria-hidden="true">${petals}${sparks}</div>`;

  // Linh vật neko chibi (SVG nội tuyến, không cần tải ảnh nên không bị CSP chặn). Biểu cảm đổi theo data-mood của khung.
  const MASCOT = `<svg class="azh-mv" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="azh-hair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cdb9ff"/><stop offset="1" stop-color="#9a7bf0"/></linearGradient>
      <linearGradient id="azh-iris" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a2fb0"/><stop offset=".62" stop-color="#7d5cf0"/><stop offset="1" stop-color="#ff8cc4"/></linearGradient>
    </defs>
    <path d="M11 24L8 4l18 8z" fill="url(#azh-hair)" stroke="#2b1b3d" stroke-width="2" stroke-linejoin="round"/><path d="M13.6 18.4L11.8 9.6l8 3.4z" fill="#ff9ccb"/>
    <path d="M53 24L56 4 38 12z" fill="url(#azh-hair)" stroke="#2b1b3d" stroke-width="2" stroke-linejoin="round"/><path d="M50.4 18.4L52.2 9.6l-8 3.4z" fill="#ff9ccb"/>
    <path d="M9 34C9 14 19 8 32 8s23 6 23 26v9c0 6-4 10-9 10H18c-5 0-9-4-9-10z" fill="url(#azh-hair)" stroke="#2b1b3d" stroke-width="2" stroke-linejoin="round"/>
    <ellipse cx="32" cy="38" rx="18" ry="14" fill="#fff1e8"/>
    <path d="M13 34C13 17 22 10 32 10S51 17 51 34L47 26L43 32L38 25L32 31L26 25L21 32L17 26Z" fill="url(#azh-hair)" stroke="#2b1b3d" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M20 17Q26 12.5 33 12.5" stroke="#e6dbff" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M32 8C30 2 34 -1 38 1" fill="none" stroke="#2b1b3d" stroke-width="4.6" stroke-linecap="round"/><path d="M32 8C30 2 34 -1 38 1" fill="none" stroke="#9a7bf0" stroke-width="2.4" stroke-linecap="round"/>
    <ellipse cx="19" cy="46.5" rx="3.6" ry="2.1" fill="#ff7fb3" opacity=".55"/><ellipse cx="45" cy="46.5" rx="3.6" ry="2.1" fill="#ff7fb3" opacity=".55"/>
    <g class="azh-eo" data-for="idle worry think">
      <ellipse cx="24" cy="39" rx="4.7" ry="5.9" fill="#2b1b3d"/><ellipse cx="40" cy="39" rx="4.7" ry="5.9" fill="#2b1b3d"/>
      <ellipse cx="24" cy="40.2" rx="3.7" ry="4.7" fill="url(#azh-iris)"/><ellipse cx="40" cy="40.2" rx="3.7" ry="4.7" fill="url(#azh-iris)"/>
      <circle cx="25.8" cy="37" r="1.9" fill="#fff"/><circle cx="41.8" cy="37" r="1.9" fill="#fff"/>
      <circle cx="22.4" cy="42.2" r=".9" fill="#fff"/><circle cx="38.4" cy="42.2" r=".9" fill="#fff"/>
      <path d="M18.4 35.6Q24 31.6 29.6 35.8M34.4 35.8Q40 31.6 45.6 35.6" stroke="#2b1b3d" stroke-width="2.3" fill="none" stroke-linecap="round"/>
    </g>
    <g data-for="star">
      <ellipse cx="24" cy="39" rx="4.7" ry="5.9" fill="#2b1b3d"/><ellipse cx="40" cy="39" rx="4.7" ry="5.9" fill="#2b1b3d"/>
      <path d="M24 34.6L25 37.9 28.3 39 25 40.1 24 43.4 23 40.1 19.7 39 23 37.9Z" fill="#fff"/>
      <path d="M40 34.6L41 37.9 44.3 39 41 40.1 40 43.4 39 40.1 35.7 39 39 37.9Z" fill="#fff"/>
      <path d="M18.4 35.6Q24 31.6 29.6 35.8M34.4 35.8Q40 31.6 45.6 35.6" stroke="#2b1b3d" stroke-width="2.3" fill="none" stroke-linecap="round"/>
    </g>
    <path data-for="happy" d="M19.5 41Q24 33.5 28.5 41M35.5 41Q40 33.5 44.5 41" stroke="#2b1b3d" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <path data-for="sleep" d="M19.5 38Q24 43.5 28.5 38M35.5 38Q40 43.5 44.5 38" stroke="#2b1b3d" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <path data-for="idle" d="M28.4 46.2Q30.2 49.2 32 46.2Q33.8 49.2 35.6 46.2" fill="none" stroke="#c42a76" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    <g data-for="happy star"><path d="M28 45.5Q32 53 36 45.5Z" fill="#e0357f" stroke="#2b1b3d" stroke-width="1.2" stroke-linejoin="round"/><path d="M30 49.6Q32 48.4 34 49.6Q32 52 30 49.6z" fill="#ff9ccb"/></g>
    <ellipse data-for="sleep" cx="32" cy="47" rx="1.9" ry="1.5" fill="#c42a76"/>
    <path data-for="worry" d="M28 48Q30 45.6 32 48T36 48" fill="none" stroke="#c42a76" stroke-width="1.7" stroke-linecap="round"/>
    <path data-for="think" d="M30 47h4" fill="none" stroke="#c42a76" stroke-width="1.9" stroke-linecap="round"/>
    <path data-for="worry" d="M51 22c-2.4 3.4-3.6 5.2-3.6 7a3.6 3.6 0 007.2 0c0-1.8-1.2-3.6-3.6-7z" fill="#8fd3ff" stroke="#2b1b3d" stroke-width="1"/>
    <text data-for="think" x="46" y="21" font-size="15" font-weight="800" fill="#c42a76" stroke="#fff" stroke-width=".8" paint-order="stroke" font-family="system-ui,sans-serif">?</text>
    <text data-for="sleep" class="azh-zz" x="47" y="18" font-size="12" font-weight="800" fill="#7e5ed6" stroke="#fff" stroke-width=".8" paint-order="stroke" font-family="system-ui,sans-serif">z</text>
    <g transform="translate(19.5 16.5)">
      <g fill="#ff8cbc" stroke="#2b1b3d" stroke-width=".9" stroke-linejoin="round">
        <ellipse cx="0" cy="-4.3" rx="2.9" ry="3.8"/><ellipse cx="0" cy="-4.3" rx="2.9" ry="3.8" transform="rotate(72)"/><ellipse cx="0" cy="-4.3" rx="2.9" ry="3.8" transform="rotate(144)"/>
        <ellipse cx="0" cy="-4.3" rx="2.9" ry="3.8" transform="rotate(216)"/><ellipse cx="0" cy="-4.3" rx="2.9" ry="3.8" transform="rotate(288)"/>
      </g>
      <circle r="2.1" fill="#ffd25e" stroke="#2b1b3d" stroke-width=".8"/>
    </g>
    <g data-for="star happy"><g transform="translate(46 28)"><path class="azh-spk" d="M7 14l1.2 3 3 1.2-3 1.2L7 22.4l-1.2-3-3-1.2 3-1.2z" fill="#ffd25e" stroke="#2b1b3d" stroke-width=".8"/></g>
      <g transform="translate(2 28) scale(.7)"><path class="azh-spk" d="M7 14l1.2 3 3 1.2-3 1.2L7 22.4l-1.2-3-3-1.2 3-1.2z" fill="#ffd25e" stroke="#2b1b3d" stroke-width=".8"/></g></g>
  </svg>`;

  const headHtml = ver => `
    <div id="azh-head" title="Kéo để di chuyển">
      <div class="azh-logo">
        <div class="azh-mascot">${MASCOT}</div>
        <div class="azh-ttl"><div class="azh-title">HuyDz</div><div class="azh-sub"><span class="azh-dot"></span>${ver} · 桜 SAKURA</div></div>
      </div>
      <div class="azh-hbtns">
        <button id="azh-run" class="azh-runbtn" type="button"></button>
        <button id="azh-min" class="azh-minbtn" type="button" title="Thu gọn" aria-label="Thu gọn">–</button>
      </div>
    </div>`;

  const panel = document.createElement('div');
  panel.id = 'azh';
  panel.setAttribute('data-mood', 'idle');
  panel.innerHTML = `<div class="azh-card">${fxHtml}${headHtml('v6.11')}<button id="azh-mrun" class="azh-mrun" type="button" aria-label="Tạm dừng" title="Chạy / Tạm dừng"><svg class="azh-ic-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6a.8.8 0 001.2.7l10.6-6.8a.8.8 0 000-1.4L9.2 4.5A.8.8 0 008 5.2z"/></svg><svg class="azh-ic-pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="4.5" width="4.6" height="15" rx="1.4"/><rect x="13.9" y="4.5" width="4.6" height="15" rx="1.4"/></svg></button>
    <div id="azh-body">
      <div class="azh-main" id="azh-mainv">
        <div class="azh-stats">
          <div class="azh-stat" data-jp="答"><small>Sổ đáp án</small><div><b id="azh-cnt">0</b> <span>câu</span></div></div>
          <div class="azh-stat" data-jp="合"><small>Khớp trang này</small><div><b id="azh-pt">–</b></div></div>
        </div>
        <div class="azh-bar" role="presentation"><i id="azh-pb"></i></div>
        <div class="azh-bubble"><span class="azh-np">HuyDz</span><span id="azh-face">(◕‿◕)</span><span id="azh-st"></span><span class="azh-sr" id="azh-sr" aria-live="polite"></span><i class="azh-caret"></i></div>

        <label class="azh-sw"><input type="checkbox" id="azh-sel"><i></i><span>Tự chọn đáp án đã nhớ</span></label>
        <label class="azh-sw"><input type="checkbox" id="azh-lrn"><i></i><span>Tự học ở trang xem đáp án</span></label>

        <div class="azh-box">
          Độ trễ giữa các câu: <b id="azh-ms"></b> ms <small>(0 = nhanh nhất)</small>
          <input type="range" id="azh-spd" min="0" max="2000" step="50" aria-label="Độ trễ giữa các câu (ms)">
          <div class="azh-ends"><span>nhanh</span><span>chậm</span></div>
        </div>

        <div class="azh-acts"><button id="azh-book" class="azh-act wide" type="button">Xem sổ đáp án</button></div>

        <details class="azh-adv">
          <summary>Đồng bộ &amp; dữ liệu</summary>
          <div class="azh-advin">
            <input id="azh-code" class="azh-inp" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" enterkeyhint="done" aria-label="Link hoặc mã đề">
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
        <div class="azh-box azh-size">
          <div class="azh-szh"><label for="azh-sz">Kích thước menu</label><b id="azh-szv"></b></div>
          <input type="range" id="azh-sz" min="280" max="560" step="10" aria-label="Chiều rộng menu">
          <div class="azh-ends"><span>nhỏ</span><button type="button" id="azh-szr" class="azh-chip">Mặc định</button><span>lớn</span></div>
          <div class="azh-tip">Kéo góc dưới bên phải để đổi cả chiều cao.</div>
        </div>
        <div class="azh-foot">頑張ってね ✧ ganbatte ne~</div>
      </div>

      <div id="azh-bookv">
        <input id="azh-q" class="azh-inp" type="search" placeholder="Tìm câu hỏi hoặc đáp án…" autocomplete="off" aria-label="Tìm trong sổ đáp án">
        <div id="azh-list"></div>
        <div class="azh-acts"><button id="azh-back" class="azh-act wide" type="button">Quay lại</button></div>
      </div>
    </div></div><span class="azh-badge" id="azh-badge">0</span>`;
  (document.body || document.documentElement).appendChild(panel);
  const $ = id => document.getElementById('azh-' + id);
  const head = $('head');


  // gõ chữ kiểu visual novel (chữ đầy đủ vẫn nằm trong vùng đọc màn hình ẩn)
  let typeT = 0, lastType = 0;
  function typeInto(el, text) {
    clearInterval(typeT);
    const sr = $('sr'); if (sr) sr.textContent = text;
    const t = Date.now(), fast = t - lastType < 300;
    lastType = t;
    if (REDUCED || fast || isMin() || text.length < 4) { el.textContent = text; return; }
    const step = Math.max(1, Math.ceil(text.length / 18));
    let i = 0;
    el.textContent = '';
    typeT = setInterval(() => { i += step; el.textContent = text.slice(0, i); if (i >= text.length) clearInterval(typeT); }, 18);
  }
  // cánh hoa + sao bung ra quanh linh vật khi đóng / mở
  function burst() {
    if (REDUCED) return;
    const cx = isMin() ? 32 : 37, cy = isMin() ? 32 : 35, cols = ['#ffb3d4', '#ff6fa8', '#c9b6ff', '#ffd25e', '#a9dcff'];
    for (let i = 0; i < 14; i++) {
      const b = document.createElement('b'), a = (i / 14) * Math.PI * 2 + rnd(-.2, .2), d = rnd(34, 74);
      b.className = 'azh-bst' + (i % 3 === 0 ? ' s' : '');
      b.style.left = cx + 'px'; b.style.top = cy + 'px';
      b.style.background = cols[i % cols.length];
      b.style.setProperty('--dx', (Math.cos(a) * d).toFixed(0) + 'px');
      b.style.setProperty('--dy', (Math.sin(a) * d).toFixed(0) + 'px');
      b.style.setProperty('--r', rnd(-300, 300).toFixed(0) + 'deg');
      b.addEventListener('animationend', () => b.remove());
      panel.appendChild(b);
    }
  }

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
  let morphing = false;
  function applyMin(v, silent) {
    cfg.min = !!v;
    panel.classList.toggle('min', cfg.min);
    // thu gọn: đầu khung thành nút bấm được bằng bàn phím
    if (cfg.min) { head.setAttribute('role', 'button'); head.setAttribute('tabindex', '0'); head.setAttribute('aria-label', 'Mở bảng HuyDz'); head.title = 'Chạm để mở · kéo để di chuyển'; }
    else { head.removeAttribute('role'); head.removeAttribute('tabindex'); head.removeAttribute('aria-label'); head.title = 'Kéo để di chuyển'; }
    if (!silent) saveCfg();
    requestAnimationFrame(() => { clampPanel(); if (!silent) savePos(); });
  }
  // thu gọn / mở ra có hiệu ứng: khung co lại vào linh vật rồi bật ra nút tròn, mở thì bung ngược lại
  function setMin(v, silent) {
    v = !!v;
    if (morphing) return;
    if (silent || REDUCED || v === panel.classList.contains('min')) { applyMin(v, silent); return; }
    morphing = true;
    const fin = () => { panel.classList.remove('fold', 'pop-in', 'unfold'); morphing = false; };
    if (v) {
      panel.classList.add('fold');
      setTimeout(() => { panel.classList.remove('fold'); applyMin(true); panel.classList.add('pop-in'); burst(); setTimeout(fin, 560); }, 230);
    } else {
      applyMin(false); panel.classList.add('unfold'); burst(); setTimeout(fin, 700);
    }
  }
  if (cfg.x !== null) { panel.style.left = cfg.x + 'px'; panel.style.top = cfg.y + 'px'; panel.style.right = 'auto'; }
  // ---------- Kích thước menu: kéo góc dưới phải hoặc dùng thanh trượt (nhớ lại cho lần sau) ----------
  const SZ = { minW: 280, maxW: 640, minH: 280, def: 348 };
  const vwNow = () => document.documentElement.clientWidth || innerWidth;
  const slider = $('sz');
  function applySize(save) {
    const maxW = Math.max(SZ.minW, vwNow() - 16);
    const hasW = typeof cfg.w === 'number', hasH = typeof cfg.h === 'number';
    if (hasW) panel.style.setProperty('--w', Math.min(Math.max(cfg.w, Math.min(SZ.minW, maxW)), maxW) + 'px'); else panel.style.removeProperty('--w');
    if (hasH) panel.style.setProperty('--h', Math.min(Math.max(cfg.h, SZ.minH), Math.max(SZ.minH, innerHeight - 16)) + 'px'); else panel.style.removeProperty('--h');
    const hi = Math.min(SZ.maxW, maxW), lo = Math.min(SZ.minW, hi);
    slider.min = lo; slider.max = hi;
    const w = hasW ? Math.min(cfg.w, hi) : (isMin() ? SZ.def : Math.round(panel.offsetWidth) || SZ.def);
    slider.value = w;
    slider.style.setProperty('--p', (hi > lo ? ((w - lo) / (hi - lo)) * 100 : 0) + '%');
    $('szv').textContent = hasW || hasH ? (hasW ? w : 'auto') + (hasH ? ' × ' + Math.round(cfg.h) : '') + ' px' : 'mặc định';
    if (save) saveCfg();
  }
  slider.oninput = e => { cfg.w = +e.target.value; applySize(true); };
  $('szr').onclick = () => { cfg.w = null; cfg.h = null; applySize(true); requestAnimationFrame(() => { clampPanel(); savePos(); }); };
  const grip = document.createElement('div');
  grip.className = 'azh-grip';
  grip.title = 'Kéo để đổi kích thước · bấm đúp = mặc định';
  grip.setAttribute('aria-hidden', 'true');
  panel.querySelector('.azh-card').appendChild(grip);
  let rs = null;
  grip.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.isPrimary === false) return;
    e.preventDefault(); e.stopPropagation();
    // neo theo góc trên-trái để kéo góc dưới-phải cho đúng tay
    panel.style.left = panel.offsetLeft + 'px'; panel.style.top = panel.offsetTop + 'px'; panel.style.right = 'auto'; panel.style.bottom = 'auto';
    rs = { id: e.pointerId, sx: e.clientX, sy: e.clientY, w: panel.offsetWidth, h: panel.offsetHeight };
    try { grip.setPointerCapture(e.pointerId); } catch (x) {}
    panel.classList.add('sizing');
  });
  grip.addEventListener('pointermove', e => {
    if (!rs || e.pointerId !== rs.id) return;
    e.preventDefault();
    const maxW = Math.max(SZ.minW, Math.min(SZ.maxW, vwNow() - panel.offsetLeft - 8));
    const maxH = Math.max(SZ.minH, innerHeight - panel.offsetTop - 8);
    cfg.w = Math.round(Math.min(Math.max(SZ.minW, rs.w + e.clientX - rs.sx), maxW));
    cfg.h = Math.round(Math.min(Math.max(SZ.minH, rs.h + e.clientY - rs.sy), maxH));
    applySize(false);
  });
  const endSize = e => {
    if (!rs || e.pointerId !== rs.id) return;
    rs = null; panel.classList.remove('sizing');
    try { grip.releasePointerCapture(e.pointerId); } catch (x) {}
    saveCfg(); savePos();
  };
  grip.addEventListener('pointerup', endSize);
  grip.addEventListener('pointercancel', endSize);
  grip.addEventListener('dblclick', () => $('szr').click());
  addEventListener('resize', () => applySize(false));
  applySize(false);

  
  setMin(cfg.min, true);

  // Khung đổi cao (mở "Đồng bộ & dữ liệu", mở sổ đáp án, đổi cỡ màn hình): giữ nguyên trong màn hình + cập nhật độ rơi của cánh hoa
  const fxEl = panel.querySelector('.azh-fx');
  const onSize = () => { clampPanel(); if (fxEl) fxEl.style.setProperty('--fh', (panel.offsetHeight + 24) + 'px'); };
  if (window.ResizeObserver) { try { new ResizeObserver(onSize).observe(panel); } catch (e) {} }
  addEventListener('resize', onSize);
  addEventListener('orientationchange', () => setTimeout(onSize, 350));
  $('min').onclick = () => setMin(true);
  head.addEventListener('keydown', e => { if (isMin() && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setMin(false); } });
  // trình duyệt quá cũ không có Pointer Events: chạm vào nút tròn vẫn mở được
  if (!window.PointerEvent) panel.addEventListener('click', e => { if (isMin() && !e.target.closest('.azh-mrun')) setMin(false); });

  panel.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.isPrimary === false) return;
    const min = isMin();
    if (min && e.target.closest('.azh-mrun')) return;
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
    const btn = e.target.closest('.azh-act, .azh-runbtn, .azh-mrun');
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
    // Azota có thể đảo vị trí phương án (trang hiện A, C, B, D) nên đọc theo CHỮ CÁI của nhãn, không theo thứ tự xuất hiện.
    const opts = {}, hits = [], seen = {};
    const re = /(^|\s)([A-F])\s*\.\s*/g;
    for (let m; (m = re.exec(body));) {
      let L = m[2];
      if (seen[L]) {
        // đề gõ nhầm nhãn (2 phương án liền nhau cùng "C."): gán cho chữ còn thiếu duy nhất trong A-D
        const miss = [...'ABCD'].filter(x => !seen[x]);
        if (hits.length && hits[hits.length - 1].L === L && miss.length === 1) L = miss[0]; else continue;
      }
      seen[L] = 1;
      hits.push({ L, start: m.index + m[1].length, end: m.index + m[0].length });
    }
    hits.forEach((h, i) => { const t = flat(body.slice(h.end, i + 1 < hits.length ? hits[i + 1].start : body.length)); if (t) opts[h.L] = t; });
    return opts;
  }
  const optAt = tx => { let best = -1; for (const L of 'ABCD') { const m = new RegExp('(^|\\s)' + L + '\\s*\\.\\s*\\S').exec(tx); if (m && (best < 0 || m.index < best)) best = m.index; } return best; };
  const A_START = { test: tx => optAt(tx) >= 0, [Symbol.search]: tx => optAt(tx) };
  // Phương án / câu hỏi là ẢNH: dùng tên file ảnh làm "chữ" định danh, dạng ⟦img:ten-file.png⟧
  const hashStr = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  function imgKey(im) {
    // v6.7: bỏ ảnh giữ chỗ data: nhỏ của lazy-load, lấy nguồn thật
    const cands = [im.getAttribute('data-src'), im.getAttribute('data-original'), im.currentSrc, im.getAttribute('src')];
    const raw = cands.find(x => x && !(/^data:/i.test(x) && x.length < 400)) || '';
    if (!raw) return '';
    if (/^data:/i.test(raw)) return 'd' + hashStr(raw);
    try { const segs = new URL(raw, location.href).pathname.split('/').filter(Boolean); return decodeURIComponent(segs[segs.length - 1] || '').toLowerCase(); }
    catch (e) { return raw.split('?')[0].split('/').pop().toLowerCase(); }
  }
  function imgTok(im) {
    const r = im.getBoundingClientRect();
    if (!im.getClientRects().length && im.complete && im.naturalWidth > 0) return '';   // v6.7: chỉ bỏ ảnh ẩn khi đã tải xong; ảnh chưa tải vẫn giữ token
    if (im.complete && im.naturalWidth > 0 && (r.width < 20 || (r.height > 0 && r.height < 20))) return '';   // chỉ bỏ icon nhỏ đã tải xong; ảnh chưa tải vẫn giữ token (khoá theo tên file) để câu không đổi khoá theo tốc độ tải     // bỏ icon nhỏ; giữ ảnh chưa có chiều cao (cao 0)
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
      const q = stripPart(tx.slice(0, at).replace(/Câu\s*\d+/i, '').replace(/ID\s*:\s*\d+/gi, ''));
      const opts = parseOpts(tx.slice(at).replace(/Đáp án đúng[\s\S]*$/i, ''));
      if (q.length >= 3 && opts[letter]) {
        // v6.11: coi là trùng cả khi chỉ khác dấu câu / khoảng trắng (locate cũng so khớp kiểu đó), để luôn lưu kèm chữ cái
        const dup = Object.keys(opts).some(k => k !== letter && (norm(opts[k]) === norm(opts[letter]) || norm2(opts[k]) === norm2(opts[letter])));
        return { q, correct: cleanAns(opts[letter]) + (dup ? ' ⟦opt:' + letter + '⟧' : '') };
      }
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
      if (r && c === 1) r.card = card;
      return r || { why: 'thiếu phương án ' + L, sample: seg };
    }
    return { why: 'không tìm thấy thẻ câu', sample: '' };
  }
  const FMT_TAG = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', INS: 'u', S: 's', STRIKE: 's', DEL: 's', SUB: 'sub', SUP: 'sup', MARK: 'm', CODE: 'c' };
  // dấu vân tay định dạng của 1 ô phương án: theo từng đoạn chữ, gồm thẻ <b><i><u>... và style inline (không dùng style tính toán vì nó đổi theo trạng thái đã chọn / đúng / sai)
  function fmtSig(el) {
    const base = norm(el.textContent), segs = [];
    let top = el;
    for (let p = el.parentElement, i = 0; p && i < 4 && p.tagName !== 'BODY' && norm(p.textContent) === base; p = p.parentElement, i++) top = p;
    const tw = document.createTreeWalker(top, NodeFilter.SHOW_TEXT);
    for (let nd; (nd = tw.nextNode());) {
      if (!flat(nd.nodeValue)) continue;
      const fl = new Set();
      for (let p = nd.parentElement; p; p = p.parentElement) {
        if (FMT_TAG[p.tagName]) fl.add(FMT_TAG[p.tagName]);
        const st = (p.getAttribute('style') || '').toLowerCase();
        if (/font-weight\s*:\s*(bold|[6-9]00)/.test(st)) fl.add('b');
        if (/font-style\s*:\s*italic/.test(st)) fl.add('i');
        if (/text-decoration[^;]*underline/.test(st)) fl.add('u');
        if (/vertical-align\s*:\s*sub/.test(st)) fl.add('sub');
        if (/vertical-align\s*:\s*super/.test(st)) fl.add('sup');
        if (p === top) break;
      }
      segs.push([...fl].sort().join('+') || '-');
    }
    return segs.filter((x, i) => x !== segs[i - 1]).join('/') || '-';
  }
  // v6.13: ID riêng của từng ô (thuộc tính HTML hoặc props React): dãy số >= 5 chữ số.
  // Ô giống hệt chữ + định dạng vẫn có ID khác nhau, ID đi theo nội dung ô nên đề đảo A-B-C-D không ảnh hưởng.
  const NUM_RE = /\d{5,}/g;
  function scanVal(v, out, d) {
    if (v == null || d > 3) return;
    if (typeof v === 'string' || typeof v === 'number') { String(v).replace(NUM_RE, m => { out.add(m); return m; }); return; }
    if (typeof v !== 'object' || v.nodeType || v.$$typeof) return;
    let n = 0;
    for (const k in v) { if (++n > 25) break; try { if (k === 'children' || k === 'ref' || k === '_owner') continue; scanVal(v[k], out, d + 1); } catch (e) {} }
  }
  function nodeIds(el, out) {
    for (const a of el.attributes) { if (/^(class|style)$/i.test(a.name)) continue; String(a.value).replace(NUM_RE, m => { out.add(m); return m; }); }
    for (const k of Object.keys(el)) {
      try {
        if (k.indexOf('__reactProps') === 0) scanVal(el[k], out, 0);
        else if (k.indexOf('__reactFiber') === 0) {
          for (let f = el[k], i = 0; f && i < 4; f = f.return, i++) { if (f.key) scanVal(f.key, out, 0); scanVal(f.memoizedProps, out, 1); }
        }
      } catch (e) {}
    }
  }
  function idsOf(el, hits) {
    const out = new Set();
    let row = el;
    for (let p = el.parentElement; p && p.tagName !== 'BODY' && !hits.some(o => o.el !== el && p.contains(o.el)); p = p.parentElement) row = p;
    for (let p = el; p; p = p.parentElement) { nodeIds(p, out); if (p === row) break; }
    row.querySelectorAll('*').forEach(c => nodeIds(c, out));
    return out;
  }
  let fmtAll = null;
  // thẻ có các ô giống hệt chữ: gắn thêm dấu vân tay định dạng của ô đúng (nhận ra ô đúng nhờ chữ cái ở trang xem đáp án)
  function addFmt(card, r) {
    const L = optLetter(r.correct);
    if (!L || !card) return;
    try {
      fmtAll = fmtAll || pageEls();
      const as = prepStr(stripOpt(r.correct));
      const hits = deepest(fmtAll.filter(a => same(a, as) && card.contains(a.el)));
      if (hits.length < 2) return;
      const h = hits.find(x => letterBefore(x, card, fmtAll) === L) || hits.find(x => letterByPos(x, hits) === L);
      if (!h) return;
      const mine = idsOf(h.el, hits), others = new Set();
      hits.forEach(o => { if (o !== h) idsOf(o.el, hits).forEach(x => others.add(x)); });
      const ids = [...mine].filter(x => !others.has(x)).slice(0, 6).join(',');
      r.correct = stripOpt(r.correct) + ' ⟦fmt:' + fmtSig(h.el) + (ids ? '~' + ids : '') + '⟧ ⟦opt:' + L + '⟧';
    } catch (e) {}
  }
  const warnedFail = new Set();
  function learnNow() {
    fmtAll = null;
    // thoát sớm nếu trang không có chữ "Đáp án đúng" (đỡ tốn máy, nhất là trên điện thoại)
    if (!/Đáp án đúng/i.test(document.body.textContent || '')) return { n: 0, seen: 0, total: 0, missing: [] };
    let n = 0, seen = 0, tagged = 0;
    const code = examCode(), okNums = new Set(), okCards = [];
    const passSeen = {};
    const store = (q, correct, noSeen) => {
      if (!noSeen) seen++;
      let k = norm(q);
      const ck = norm(stripOpt(correct));
      // v6.10: cùng chữ câu hỏi nhưng đáp án khác (câu hỏi là ảnh) -> lưu 2 bản ghi riêng, trước đây ghi đè qua lại mỗi lượt quét nên cứ ~10s lại "học thêm" 2 câu
      if (passSeen[k] === undefined) passSeen[k] = ck;
      else if (passSeen[k] !== ck) k = k + ' ¦' + ck;
      const old = bank[k], sameTxt = !!old && norm(stripOpt(old.correct)) === norm(stripOpt(correct));
      // v6.11: trang này không nhận ra trùng mà bản cũ đã có chữ cái -> giữ bản cũ
      if (sameTxt && optLetter(old.correct) && !optLetter(correct)) correct = old.correct;
      if (old && norm(old.correct) === norm(correct)) { if (code && !hasT(old, code)) { old.t = addT(old.t, code); tagged++; } return; }
      // v6.11: cùng chữ đáp án mà chỉ thêm chữ cái (nâng cấp) -> giữ nguyên các mã đề đã gắn, không làm rơi mã đề cũ
      bank[k] = { q, correct, t: sameTxt ? (code ? addT(old.t, code) : old.t) : (code || undefined) };
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
      addFmt(card, r);
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
      } else { okIdx.add(i); if (r.card) addFmt(r.card, r); store(r.q, r.correct); }
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
  const retryN = {};   // số lần đã bấm mỗi câu (để thử lại câu bị mất cú bấm)

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
  // Bản nhanh của sameText: chuẩn hoá chữ của mỗi phần tử trang đúng 1 lần mỗi lượt quét (trước đây chuẩn hoá lại cho từng câu trong sổ -> điện thoại nóng máy)
  const prepStr = t => ({ n1: norm(t), n2: norm2(t), tk: isTok(t) ? tokKey(t) : null });
  const prep = a => { if (a.n1 === undefined) { const p = prepStr(a.t); a.n1 = p.n1; a.n2 = p.n2; a.tk = p.tk; } return a; };
  const same = (a, s) => { prep(a); return a.n1 === s.n1 || a.n2 === s.n2 || (a.tk !== null && s.tk !== null && a.tk === s.tk); };
  function press(el) {
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(t => {
      const Ev = t.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
      try { el.dispatchEvent(new Ev(t, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
    });
  }
  // Trả về { qEl } nếu thấy câu hỏi, kèm { card, target } nếu xác định được ô đáp án đúng
  function locate(rec, all) {
    const qs = prepStr(rec.q), as = prepStr(stripOpt(cleanAns(rec.correct))), optL = optLetter(rec.correct);
    let qEls = deepest(all.filter(a => same(a, qs)));
    if (!qEls.length) { const q2 = stripPart(rec.q); if (q2 !== flat(rec.q)) { const s2 = prepStr(q2); qEls = deepest(all.filter(a => same(a, s2))); } }
    if (!qEls.length) return null;
    // v6.10: nhiều câu cùng chữ câu hỏi (khác ảnh/phương án) -> thử từng câu, lấy câu có ô đáp án khớp
    let first = null;
    for (const qEl of qEls) { const r = locateOne(rec, all, qEl, as, optL); if (r.target) return r; if (!first) first = r; }
    return first;
  }
  // v6.11: chữ cái (A-F) của vòng tròn đứng ngay trước ô phương án trong cùng thẻ câu
  function letterBefore(h, card, all) {
    let best = '';
    for (const a of all) {
      if (!/^[A-F]$/i.test(a.t) || !card.contains(a.el) || a.el === h.el || a.el.contains(h.el) || h.el.contains(a.el)) continue;
      if (a.el.compareDocumentPosition(h.el) & 4) best = a.t.toUpperCase();   // 4 = h đứng sau a
      else break;
    }
    return best;
  }
  // v6.11: suy chữ cái từ vị trí hàng phương án trong khối chứa các ô trùng nhau
  function letterByPos(h, hits) {
    let box = h.el.parentElement;
    while (box && !hits.every(o => box.contains(o.el))) box = box.parentElement;
    if (!box || box.children.length < 2 || box.children.length > 6) return '';
    const row = [...box.children].find(c => c.contains(h.el));
    const i = row ? [...box.children].indexOf(row) : -1;
    return i >= 0 ? 'ABCDEF'[i] : '';
  }
  function locateOne(rec, all, qEl, as, optL) {
    for (let card = qEl.el.parentElement, i = 0; card && i < 8; card = card.parentElement, i++) {
      if (((card.innerText || '').match(/(^|\n)\s*Câu\s*\d+/gi) || []).length > 1) return { qEl, why: 'thẻ gộp nhiều câu' };   // leo quá cao
      let hits = deepest(all.filter(a => same(a, as) && card.contains(a.el) && !a.el.contains(qEl.el) && a.el !== qEl.el));
      if (!hits.length) continue;
      if (hits.length > 1) {
        // v6.8: so khớp bỏ dấu câu làm các phương án chỉ khác nhau ở dấu (vd "info.html" và "/info.html") bị coi là một.
        // Thử lại: khớp chính xác (giữ dấu câu), rồi khớp bỏ khoảng trắng.
        const want = norm(stripOpt(cleanAns(rec.correct))), want2 = want.replace(/\s+/g, '');
        let ex = hits.filter(h => norm(h.t) === want);
        if (ex.length !== 1) ex = hits.filter(h => norm(h.t).replace(/\s+/g, '') === want2);
        if (ex.length >= 1) hits = ex;
      }
      if (hits.length > 1 && fmtOf(rec.correct)) {
        // v6.12: các ô giống hệt chữ -> lọc theo định dạng (đậm/nghiêng/gạch chân) của ô đúng, không phụ thuộc thứ tự A-B-C-D
        const parts = fmtOf(rec.correct).split('~'), fm = parts[0], want = parts[1] ? parts[1].split(',') : [];
        if (want.length) {   // v6.13: lọc theo ID riêng của ô trước (chắc nhất)
          const byI = hits.filter(h => { const ids = idsOf(h.el, hits); return want.some(x => ids.has(x)); });
          if (byI.length >= 1) hits = byI;
        }
        if (hits.length > 1) { const byF = hits.filter(h => fmtSig(h.el) === fm); if (byF.length >= 1) hits = byF; }
      }
      if (LETTER_FALLBACK && hits.length > 1 && optL) {
        // v6.9: các ô giống hệt chữ -> chọn ô có vòng tròn chữ cái đúng (A/B/C/D) đã lưu lúc học
        const byL = hits.filter(h => {
          for (let pe = h.el.parentElement, i = 0; pe && i < 5; pe = pe.parentElement, i++) {
            if (hits.some(o => o !== h && pe.contains(o.el))) return false;
            if (all.some(a => a.t === optL && pe.contains(a.el) && a.el !== h.el && !a.el.contains(h.el))) return true;
          }
          return false;
        });
        if (byL.length === 1) hits = byL;
      }
      if (LETTER_FALLBACK && hits.length > 1 && optL) {
        // v6.11 cách 2: vòng tròn chữ cái gần nhất đứng TRƯỚC ô đó trong trang (không phụ thuộc cấu trúc lồng nhau)
        const byPrev = hits.filter(h => letterBefore(h, card, all) === optL);
        if (byPrev.length === 1) hits = byPrev;
      }
      if (LETTER_FALLBACK && hits.length > 1 && optL) {
        // v6.11 cách 3: vị trí của hàng phương án trong khối chứa chúng (hàng thứ 1 = A, thứ 2 = B...)
        const byPos = hits.filter(h => letterByPos(h, hits) === optL);
        if (byPos.length === 1) hits = byPos;
      }
      if (hits.length > 1 && !LETTER_FALLBACK) {
        // v6.12: không phân biệt được ô nào đúng -> KHÔNG đoán bừa (đoán dễ chọn sai khi đề đảo), chỉ báo + in HTML các ô ra console để chẩn đoán
        const wk = 'amb|' + norm(rec.q);
        if (!warnedFail.has(wk)) { warnedFail.add(wk); console.warn('[Azota Helper] ô giống hệt nhau, bỏ qua: ' + rec.q.slice(0, 60) + '\n' + hits.map(h => h.el.outerHTML.slice(0, 300) + '  ⇒ fmt=' + fmtSig(h.el) + ' ids=' + [...idsOf(h.el, hits)].join(',')).join('\n')); }
        return { qEl, card, why: 'các ô giống hệt, không phân biệt được' };
      }
      if (hits.length > 1) {
        // v6.11: các ô thật sự giống hệt mà chưa biết ô nào đúng -> chọn tạm 1 ô và báo là đoán
        const g = hits[0];
        return { qEl, card, target: g.el, guess: hits.length, guessL: letterBefore(g, card, all) || letterByPos(g, hits) };
      }
      return { qEl, card, target: hits[0].el };
    }
    return { qEl, why: 'không thấy ảnh đáp án' };
  }
  // Câu đúng/sai: tìm dòng chứa nội dung ý, rồi bấm nút "Đúng" / "Sai" trong dòng đó (nếu dòng chứa nhiều ý thì không đoán bừa)
  function locateDS(rec, all) {
    const k = norm2(rec.q.slice(DS.length));
    if (!k) return null;
    const as = prepStr(cleanAns(rec.correct));
    const stEl = deepest(all.filter(a => { const t = prep(a).n2; return t.length >= k.length && t.length <= k.length + 6 && t.includes(k); }))[0];
    if (!stEl) return null;
    for (let card = stEl.el.parentElement, i = 0; card && i < 6; card = card.parentElement, i++) {
      const hits = deepest(all.filter(a => same(a, as) && card.contains(a.el) && !a.el.contains(stEl.el) && a.el !== stEl.el));
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
    const recs = poolRecs();
    const all = pageEls();
    const pageQ = new Set();
    all.forEach(a => { const m = a.t.match(/^Câu\s*(\d+)$/i); if (m) pageQ.add(m[1]); });
    if (!pageQ.size && clickedQ.size) { clickedQ = new Set(); clearHl(); }   // trang không còn thẻ câu (đang tải / sang màn kết quả): lần làm lại sau phải được chọn lại từ đầu
    if (!recs.length) return { found: 0, done: 0, page: pageQ.size, bankN: 0 };
    const active = cfg.run && cfg.select;
    if (active) clearHl();
    let found = 0, dsFound = 0, pend = false;   // pend: còn câu đang chờ chọn (để vòng quét biết khi nào được nghỉ)
    const imgFail = [], guessed = [];
    for (const rec of recs) {
      const isDS = rec.q.startsWith(DS);
      const loc = isDS ? locateDS(rec, all) : locate(rec, all);
      if (!loc) continue;
      if (isDS) dsFound++; else found++;
      if (loc.guess && loc.target) guessed.push('Câu ' + numOf(loc.qEl) + ' (' + loc.guess + ' ô giống hệt nhau, chọn tạm' + (loc.guessL ? ' ô ' + loc.guessL : '') + ' — hãy kiểm tra lại)');
      if (!loc.target) { if (!isDS) { if (/^⟦img:/.test(rec.correct)) dbgImg(rec, loc); imgFail.push('Câu ' + numOf(loc.qEl) + ' (' + (loc.why || '?') + ')'); } continue; }
      const key = norm(rec.q) + ' ¦' + norm(stripOpt(rec.correct));
      if (clickedQ.has(key)) continue;               // mỗi câu chỉ chọn 1 lần, không đè lên lựa chọn của bạn
      if (!active) {                                 // chỉ gợi ý: tô viền đáp án đã nhớ
        loc.target.style.outline = '3px solid #ff6fb0'; loc.target.style.outlineOffset = '2px'; hl.add(loc.target);
        continue;
      }
      const t = Date.now();
      if (t - lastAct < cfg.delay) { pend = true; break; }   // giữ nhịp theo độ trễ đã chỉnh
      const { card, target } = loc, before = card.outerHTML;
      clickedQ.add(key); lastAct = t;
      press(target);
      // nếu trang chưa đổi gì thì thử bấm vòng tròn chữ cái / cả hàng
      const tries = (retryN[key] = (retryN[key] || 0) + 1);
      const urlAtClick = location.href;
      setTimeout(() => {
        if (loc.noFallback || card.outerHTML !== before) return;
        const row = target.parentElement;
        if (row && row.children[0] && row.children[0] !== target) press(row.children[0]);
        setTimeout(() => {
          if (card.outerHTML === before && row) press(row);
          // v6.5: bấm mà ô không đổi gì (hay gặp ở câu đầu lúc trang đang tải) -> cho phép thử lại, tối đa 3 lần
          setTimeout(() => { if (card.outerHTML === before && tries < 3 && urlAtClick === location.href) clickedQ.delete(key); }, 500);
        }, 400);
      }, 500);
      if (cfg.delay > 0) { pend = true; break; }     // có độ trễ: mỗi nhịp chỉ chọn 1 câu
    }
    const fnd = found + Math.floor(dsFound / 4);
    if (!wideMode && !pend && strictCode() && pageQ.size && fnd < pageQ.size && recs.length < usableRecs().length) wideMode = true;   // còn câu chưa khớp: thử thêm các câu cũ chưa gắn mã đề
    return { imgFail, guessed, pend, found: fnd, ds: dsFound, done: clickedQ.size, page: pageQ.size, bankN: recs.length };
  }

  // ---------- Giao diện: trạng thái ----------
  // Mặt kaomoji + biểu cảm linh vật theo trạng thái (điều kiện cụ thể đặt trước điều kiện chung)
  const FACES = [
    [/⚠️|không kết nối|token sai|lỗi GitHub|xung đột|giới hạn lượt/, '(；′⌒`)', 'worry'],
    [/trống/, '(・ω・)', 'idle'],
    [/học thêm|vừa học|đã lưu|đã tải/, '(≧▽≦)', 'star'],
    [/xuất|nhập \+/, '(๑˃ᴗ˂)ﻭ', 'star'],
    [/đã chọn|khớp/, '(๑•̀ㅂ•́)و✧', 'happy'],
    [/tạm dừng/, '(－ω－) zzZ', 'sleep'],
    [/đang chạy/, '(＾▽＾)', 'happy'],
    [/xoá/, '(・ω・)', 'idle'],
    [/chờ|quét|chưa có đáp án/, '(・・?)', 'think']
  ];
  const faceFor = m => { const f = FACES.find(x => x[0].test(m)); return f ? [f[1], f[2]] : ['(◕‿◕)', cfg.run ? 'idle' : 'sleep']; };

  let lastMsg = '', lastShown = '', lastN = -1;
  function stat(msg, fromTick) {
    if (msg !== undefined) lastMsg = msg;
    if (msg && !fromTick) holdUntil = Date.now() + 5000;
    const n = shownCount(), sc = strictCode(), total = usableRecs().length;
    const m = (lastMsg || 'sẵn sàng nè ~') + (ghNote ? ' · ' + ghNote : '');
    const sig = n + '|' + sc + '|' + total + '|' + m;
    if (sig === lastShown) return;
    lastShown = sig;
    $('cnt').textContent = n; $('badge').textContent = n > 99 ? '99+' : n;
    { const box = $('cnt').closest('.azh-stat'), sm = box && box.querySelector('small');
      if (sm) sm.textContent = sc ? 'Đáp án đề này' : 'Sổ đáp án';
      if (box) box.title = sc ? `Đề ${sc}: ${n} câu · sổ chung: ${Object.keys(bank).length} câu` : `Sổ chung: ${Object.keys(bank).length} câu`; }
    const fc = faceFor(lastMsg || '');
    $('face').textContent = fc[0]; setMood(fc[1]);
    typeInto($('st'), m);
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
    $('mrun').setAttribute('aria-label', cfg.run ? 'Tạm dừng' : 'Chạy nào'); $('mrun').title = cfg.run ? 'Tạm dừng' : 'Chạy nào!';
  };
  const fillSpd = () => $('spd').style.setProperty('--p', (cfg.delay / 20) + '%');

  $('sel').checked = cfg.select; $('sel').onchange = e => { cfg.select = e.target.checked; saveCfg(); stat(cfg.select ? 'tự chọn đã bật' : 'tự chọn đã tắt, chỉ tô viền gợi ý'); };
  $('lrn').checked = cfg.learn;  $('lrn').onchange = e => { cfg.learn = e.target.checked; saveCfg(); stat(cfg.learn ? 'tự học đã bật' : 'tự học đã tắt, không quét đáp án nữa'); };
  $('spd').value = cfg.delay; $('ms').textContent = cfg.delay; fillSpd();
  $('spd').oninput = e => { cfg.delay = +e.target.value; $('ms').textContent = cfg.delay; fillSpd(); saveCfg(); };
  $('run').onclick = $('mrun').onclick = () => { cfg.run = !cfg.run; runLabel(); saveCfg(); if (!cfg.run) clearHl(); stat(cfg.run ? 'đang chạy, cố lên!' : 'đã tạm dừng'); };
  runLabel(); stat('');

  // ---------- Sổ đáp án: xem, tìm, xoá từng câu ----------
  function renderBook() {
    const f = norm($('q').value);
    const sc0 = strictCode(), base0 = usableEntries(), mine0 = sc0 ? base0.filter(([, v]) => hasT(v, sc0)) : base0;
    const entries = (mine0.length ? mine0 : base0).filter(([, v]) => !f || norm(v.q).includes(f) || norm(v.correct).includes(f));
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
    const mine = code ? all.filter(r => hasT(r, code)) : [];
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
  async function ghGetRaw(file) {
    const url = `https://raw.githubusercontent.com/${GHC.user}/${GHC.repo}/${GHC.branch}/${GHC.dir}${file}`;
    try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? { s: 200, text: await r.text() } : { s: r.status }; }
    catch (e) { return { s: 0 }; }
  }
  async function pullExam(code) {
    if (!code) { ghNote = ''; return stat(); }
    ghNote = 'đang tải đề ' + code + ' từ GitHub…'; stat();
    const file = `banks/${GHC.site}/${code}.txt`;
    let r = await ghGetPublic(file), rawTxt = null;
    // v6.11: API bị giới hạn lượt (403/429) hoặc không kết nối được -> thử đọc thẳng file raw (không tính lượt API)
    if (r.s === 403 || r.s === 429 || r.s === 0) {
      const w = await ghGetRaw(file);
      if (w.s === 200) { rawTxt = w.text; r = { s: 200, j: null }; } else if (w.s === 404) r = { s: 404, j: null };
    }
    if (code !== examCode()) return;                 // đã sang link khác, bỏ kết quả cũ
    if (r.s === 200 && (rawTxt !== null || (r.j && r.j.content))) {
      const items = ghParse(rawTxt !== null ? rawTxt : ghDec(r.j.content)).filter(([q, c]) => !labelOnly(c));
      const bt = {}; items.forEach(([q, c]) => putRec(q, cleanAns(c), code, bt));
      saveBank();
      ghNote = `đề ${code}: đã tải ${items.length} câu từ GitHub`;
    } else if (r.s === 404) ghNote = `đề ${code} không có trên GitHub`;
    else if (r.s === 0) ghNote = 'không kết nối được GitHub';
    else if (r.s === 403 || r.s === 429) ghNote = 'GitHub đang giới hạn lượt gọi, thử lại sau ít phút';
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

  document.addEventListener('sakura-status', e => { bank = load(BANK_KEY) || {}; bankVer++; stat(String(e.detail || '')); });

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
      let add = 0, bad = 0; const bt = {};
      String(rd.result).replace(/^\uFEFF/, '').split(/\r?\n/).forEach(line => {
        line = line.trim();
        if (!line || line.startsWith('#')) return;
        const i = line.lastIndexOf('|||');
        const q = i < 0 ? '' : flat(line.slice(0, i)), c = i < 0 ? '' : flat(line.slice(i + 3));
        if (!q || !c) { bad++; return; }
        if (!bank[norm(q)]) add++;
        putRec(q, cleanAns(c), examCode(), bt);
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
  let selPending = true;
  // v6.7: chỉ quét lại khi trang thật sự đổi, quét đủ câu thì nghỉ (đỡ nóng + không nhảy số trên điện thoại)
  let domDirty = true, lastLearn = 0, learnDone = false;
  try {
    new MutationObserver(ms => {
      for (const m of ms) {
        const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (el && el.closest && el.closest('#' + panelId)) continue;
        domDirty = true; learnDone = false; return;
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src', 'data-src'] });
  } catch (e) {}
  const ts = m => { if (Date.now() >= holdUntil) stat(m, true); };
  function tick() {
    if (inTake()) {
      const r = selectNow();
      selPending = !!r.pend;
      prog(r.found, r.page);
      if (!r.bankN) return ts('chưa có đáp án cho đề này');
      if (!cfg.run) return ts('đã tạm dừng' + (r.found ? `, tô viền ${r.found} câu đã nhớ` : ''));
      if (!cfg.select) return ts(`tự chọn đang tắt, tô viền gợi ý ${r.found} câu`);
      return ts(`khớp ${r.found}/${r.page || r.bankN} câu` + (r.ds ? ` (${r.ds} ý đúng/sai)` : '') + `, đã chọn ${r.done}` + (r.imgFail && r.imgFail.length ? ' — chưa chọn được: ' + r.imgFail.join('; ') : '') + (r.guessed && r.guessed.length ? ' — đoán: ' + r.guessed.join('; ') : ''));
    }
    prog(0, 0);
    if (!cfg.run) return ts('đã tạm dừng, không quét đáp án');
    if (!cfg.learn) return ts('tự học đang tắt, không quét đáp án');
    if (learnDone && !domDirty && Date.now() - lastLearn < 8000) return;
    document.querySelectorAll('img[loading="lazy"]').forEach(i => { i.loading = 'eager'; });   // ép ảnh lazy tải hết
    domDirty = false; lastLearn = Date.now();
    const r = learnNow();
    learnDone = r.total > 0 && !r.missing.length;
    learnedNow += r.n;
    if (r.seen) ts(`đã quét ${r.seen}${r.total ? '/' + r.total : ''} câu, học thêm ${learnedNow} câu mới` + (r.missing.length ? ` — chưa đọc được: Câu ${r.missing.join('; Câu ')}` : ''));
    else ts('chờ trang xem đáp án để quét…');
  }
  // điện thoại quét thưa hơn một chút cho đỡ nóng máy; tab ẩn thì gần như nghỉ
  function loop() {
    try { if (!document.hidden) tick(); } catch (e) { console.error('Azota Helper:', e); }
    const fast = inTake() && cfg.run && cfg.select && cfg.delay > 0 && cfg.delay < 600 && selPending;
    setTimeout(loop, document.hidden ? 1500 : (fast ? Math.max(COARSE ? 300 : 150, cfg.delay / 2) : (inTake() ? 700 : 1000)));
  }
  loop();
})();
