#!/usr/bin/env python3
"""Gộp file .txt xuất từ panel vào sổ trên repo (khử trùng câu hỏi).
Dùng:  python tools/merge_bank.py azota-dap-an.txt banks/azota.txt
       python tools/merge_bank.py azota-dap-an.txt banks/azota/<ma-link>.txt"""
import sys, re, os
flat = lambda s: re.sub(r'\s+', ' ', s).strip()
def read(p):
    d = {}
    if os.path.exists(p):
        for l in open(p, encoding='utf-8-sig'):
            l = l.strip()
            if not l or l.startswith('#') or '|||' not in l: continue
            q, _, c = l.rpartition('|||'); q, c = flat(q), flat(c)
            if q and c: d[q.lower()] = (q, c)
    return d
src, dst = sys.argv[1], sys.argv[2]
a, b = read(dst), read(src)
n = sum(k not in a for k in b)
a.update(b)
os.makedirs(os.path.dirname(dst) or '.', exist_ok=True)
with open(dst, 'w', encoding='utf-8') as f:
    f.write('# Mỗi dòng: câu hỏi ||| đáp án đúng\n')
    for q, c in sorted(a.values(), key=lambda x: x[0].lower()): f.write(f'{q} ||| {c}\n')
print(f'+{n} câu mới, tổng {len(a)} -> {dst}')
