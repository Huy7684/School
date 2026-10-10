# Sakura Scripts

- `sakura-loader.user.js` : cài vào Tampermonkey (nhớ sửa dòng `GH = {...}`)
- `scripts/` : script chính, loader tự tải từ đây
- `banks/<site>.txt` : sổ đáp án chung, định dạng `câu hỏi ||| đáp án đúng`
- `banks/<site>/<mã-link>.txt` : sổ riêng theo mã link
- `tools/merge_bank.py` : gộp file .txt xuất từ panel vào sổ

Cập nhật đáp án:
    python tools/merge_bank.py azota-dap-an.txt banks/azota.txt
    git add . && git commit -m bank && git push
