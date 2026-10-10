// ==UserScript==
// @name         Sakura Loader (GitHub)
// @namespace    sakura-loader
// @version      1.0
// @description  Tự tải script + sổ đáp án từ GitHub rồi chạy trên azota.vn / dethiso.vn
// @match        https://azota.vn/*
// @match        https://*.azota.vn/*
// @match        https://dethiso.vn/*
// @match        https://*.dethiso.vn/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      raw.githubusercontent.com
// ==/UserScript==

(async () => {
  'use strict';
  // ===== SỬA 3 DÒNG NÀY =====
  const GH = { user: 'Huy7684', repo: 'School', branch: 'main' };
  // ==========================
  const RAW = `https://raw.githubusercontent.com/${GH.user}/${GH.repo}/${GH.branch}/`;
  const SITES = [
    { test: /(^|\.)azota\.vn$/,   name: 'azota',   script: 'scripts/azota-helper.user.js', bankKey: 'azh-bank' },
    { test: /(^|\.)dethiso\.vn$/, name: 'dethiso', script: 'scripts/dethiso.user.js',      bankKey: 'dts10-bank' },
  ];
  const site = SITES.find(s => s.test.test(location.hostname));
  if (!site) return;

  const get = path => new Promise(res => GM_xmlhttpRequest({
    method: 'GET', url: RAW + path + '?_=' + Math.floor(Date.now() / 60000), timeout: 15000,
    onload: r => res(r.status === 200 ? r.responseText : null),
    onerror: () => res(null), ontimeout: () => res(null),
  }));

  const flat = s => String(s || '').replace(/\s+/g, ' ').trim();
  const norm = s => flat(s).toLowerCase();
  const parse = txt => {
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

  // 1) Sổ đáp án: chung + theo mã link (các đoạn cuối của URL)
  const segs = location.pathname.split('/').filter(s => /^[\w-]{4,}$/.test(s) && !/^(take|take-test|test|exam|result)$/i.test(s)).slice(-2);
  const files = [`banks/${site.name}.txt`, ...segs.map(s => `banks/${site.name}/${s}.txt`)];
  const texts = await Promise.all(files.map(get));
  let bank = {};
  try { bank = JSON.parse(localStorage.getItem(site.bankKey) || '{}') || {}; } catch (e) {}
  let added = 0;
  texts.forEach(t => { if (t) parse(t).forEach(([q, c]) => { if (!bank[norm(q)]) { bank[norm(q)] = { q, correct: c }; added++; } }); });
  try { localStorage.setItem(site.bankKey, JSON.stringify(bank)); } catch (e) {}

  // 2) Script chính (có cache phòng khi mất mạng)
  let code = await get(site.script);
  if (code) GM_setValue('code:' + site.name, code); else code = GM_getValue('code:' + site.name, null);
  if (!code) { console.warn('[Sakura Loader] không tải được script'); return; }
  console.log(`[Sakura Loader] ${site.name}: +${added} câu từ GitHub`);
  new Function(code)();
})();
