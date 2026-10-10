<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:ff7fb8,50:c19bff,100:7fc8ff&height=270&section=header&text=Azota%20Helper&fontSize=64&fontColor=ffffff&fontAlignY=36&animation=fadeIn&desc=%E6%A1%9C%20SAKURA%20EDITION%20%C2%B7%20v3.0&descSize=22&descAlignY=58" alt="Azota Helper - Sakura Edition" width="100%">

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=20&duration=3000&pause=900&color=D6498F&center=true&vCenter=true&width=640&height=45&lines=Qu%C3%A9t%20%22%C4%90%C3%A1p%20%C3%A1n%20%C4%91%C3%BAng%22%20%E1%BB%9F%20trang%20xem%20%C4%91%C3%A1p%20%C3%A1n%20%E2%9C%BF;Nh%E1%BB%9B%20%C4%91%C3%A1p%20%C3%A1n%20%C2%B7%20t%E1%BB%B1%20ch%E1%BB%8Dn%20l%E1%BA%A1i%20%E1%BB%9F%20l%E1%BA%A7n%20l%C3%A0m%20sau%20%E2%9C%BF;S%E1%BB%95%20%C4%91%C3%A1p%20%C3%A1n%20c%C3%B3%20t%C3%ACm%20ki%E1%BA%BFm%20%C2%B7%20xu%E1%BA%A5t%20/%20nh%E1%BA%ADp%20.txt%20%E2%9C%BF;Kh%C3%B4ng%20t%E1%BB%B1%20n%E1%BB%99p%20b%C3%A0i%20%C2%B7%20ch%E1%BB%89%20%C4%91%E1%BB%83%20h%E1%BB%8Dc%20t%E1%BA%ADp%20%E2%9C%BF" alt="Azota Helper tagline">

<br>

![Version](https://img.shields.io/badge/version-3.0-ff7fb8?style=for-the-badge&labelColor=c19bff)
![Type](https://img.shields.io/badge/userscript-Tampermonkey-c19bff?style=for-the-badge&labelColor=ff7fb8)
![Purpose](https://img.shields.io/badge/m%E1%BB%A5c%20%C4%91%C3%ADch-h%E1%BB%8Dc%20t%E1%BA%ADp%20%26%20nghi%C3%AAn%20c%E1%BB%A9u-7fc8ff?style=for-the-badge&labelColor=c19bff)
![Auto submit](https://img.shields.io/badge/t%E1%BB%B1%20n%E1%BB%99p%20b%C3%A0i-kh%C3%B4ng-ffb3d4?style=for-the-badge&labelColor=ff7fb8)

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:ff7fb8,50:c19bff,100:7fc8ff&height=3" alt="" width="100%">

### 🌸 &nbsp;*Mỗi lần làm lại một đề là một lần nhớ thêm một chút* &nbsp;🌸

</div>

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:ff7fb8,50:c19bff,100:7fc8ff&height=3" alt="" width="100%">

## 🌷 Dự án này là gì?

**School** là kho lưu trữ cá nhân của mình, dùng để thử nghiệm và nghiên cứu cách một trang luyện đề trực tuyến ([azota.vn](https://azota.vn)) hiển thị câu hỏi, đáp án và kết quả. Thành phần chính là **Azota Helper - Sakura Edition**: một userscript chạy trong trình duyệt, giúp mình:

- đọc phần **"Đáp án đúng"** ở trang xem đáp án sau khi làm bài xong,
- lưu lại thành một **sổ đáp án** cá nhân,
- khi làm **lại cùng đề** thì tô viền hoặc chọn sẵn đáp án đã nhớ để ôn tập nhanh hơn.

Script **không tự nộp bài**. Mọi quyết định vẫn là của người làm.

<table align="center">
<tr>
<td align="center" width="33%"><h3>🔍 Tự học</h3>Quét “Đáp án đúng” ở<br>trang xem đáp án</td>
<td align="center" width="33%"><h3>🌸 Tự chọn lại</h3>Điền lại đáp án đã nhớ<br>khi làm lại đề</td>
<td align="center" width="33%"><h3>📖 Sổ đáp án</h3>Tìm kiếm, xoá từng câu,<br>xuất / nhập .txt</td>
</tr>
</table>

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:ff7fb8,50:c19bff,100:7fc8ff&height=3" alt="" width="100%">

## 🎓 Mục đích: chỉ để học tập và nghiên cứu

> [!IMPORTANT]
> Dự án được viết để **tìm hiểu cách hoạt động của giao diện web**, rèn kỹ năng JavaScript (DOM, `MutationObserver`/polling, `localStorage`, GitHub REST API) và hỗ trợ **tự ôn luyện**.
> Không dùng dự án này để gian lận trong bài kiểm tra, thi cử hay đánh giá chính thức. Hãy tuân thủ nội quy của trường, giáo viên và điều khoản của Azota.
> Dự án **không liên kết, không được tài trợ và không được Azota xác nhận**. Tên "Azota" thuộc về chủ sở hữu của nó.

Những điều mình học được khi làm dự án:

| 🌸 Chủ đề | 📚 Nội dung nghiên cứu |
|---|---|
| Phân tích DOM | Tìm thẻ câu hỏi trong một trang Angular (SPA) khi cấu trúc thay đổi liên tục |
| Xử lý văn bản | Tách phương án `A. B. C. D.` kể cả khi nằm cùng một dòng, hỗ trợ tiếng Việt có dấu |
| Đáp án dạng ảnh | Dùng tên file ảnh làm định danh, dạng `⟦img:ten-file.png⟧` |
| Câu đúng/sai | Lưu từng ý `a) b) c) d)` thành một bản ghi riêng |
| Lưu trữ | `localStorage` cộng với đồng bộ file `.txt` lên GitHub qua REST API |
| Giao diện | CSS thuần: gradient động, hiệu ứng cánh hoa, công tắc, thanh tiến trình |

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:ff7fb8,50:c19bff,100:7fc8ff&height=3" alt="" width="100%">

## 🌀 Cách hoạt động

```mermaid
flowchart LR
    A([🌸 Làm bài xong]) --> B[📄 Mở trang xem đáp án]
    B --> C{Tự học<br/>đang bật?}
    C -- có --> D[🔍 Quét 'Đáp án đúng'<br/>của từng câu]
    D --> E[(📖 Sổ đáp án<br/>localStorage)]
    E <-->|Lưu / Tải| F[(☁️ GitHub<br/>banks/azota/mã-đề.txt)]
    E --> G([🔁 Làm lại đề])
    G --> H[🌷 Tô viền hoặc chọn sẵn<br/>đáp án đã nhớ]
    H --> I([✋ Bạn tự kiểm tra và tự nộp])
    classDef p fill:#ffe0ee,stroke:#ff7fb8,color:#4a3b5c;
    classDef v fill:#eee8ff,stroke:#b69bff,color:#4a3b5c;
    classDef b fill:#e2f3ff,stroke:#7fc8ff,color:#4a3b5c;
    class A,B,C,D p; class E,F v; class G,H,I b;
```

1. **Nhận mã đề tự động** từ đường dẫn của trang (ví dụ `azota.vn/de-thi/xxxxxx`). Sang link khác thì mã cũ được bỏ, tránh lẫn đáp án giữa các đề.
2. **Học** ở trang xem đáp án: mỗi câu có chữ "Đáp án đúng: X", script đọc nội dung phương án X và lưu cùng mã đề.
3. **Nhớ lại** ở trang làm bài: tìm đúng câu theo nội dung, rồi chọn hoặc tô viền phương án đã lưu. Mỗi câu chỉ chọn **một lần** và không đè lên lựa chọn của bạn.
4. **Đồng bộ** (tuỳ chọn): đẩy hoặc tải sổ đáp án theo từng đề từ GitHub của chính bạn.

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:ff7fb8,50:c19bff,100:7fc8ff&height=3" alt="" width="100%">

## 🌺 Tính năng

- ✿ Nhận dạng **trắc nghiệm**, **đáp án là ảnh** và **đúng/sai**
- ✿ Sổ đáp án có **tìm kiếm**, xoá từng câu
- ✿ **Xuất / nhập `.txt`** để sao lưu hoặc chia sẻ trong nhóm học
- ✿ Chỉ dùng đáp án của **đúng đề đang mở** (khoá theo mã đề)
- ✿ Chỉnh **độ trễ** giữa các câu, nút **Tạm dừng** bất cứ lúc nào
- ✿ Chế độ **chỉ gợi ý**: tắt tự chọn thì script chỉ tô viền đáp án đã nhớ
- ✿ Bảng điều khiển kéo thả được, thu gọn được, giao diện **Sakura** có hiệu ứng cánh hoa 🌸
- ✿ Token GitHub chỉ nhập khi lưu, **dùng xong bỏ, không lưu lại**

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:ff7fb8,50:c19bff,100:7fc8ff&height=3" alt="" width="100%">

## 🗂️ Cấu trúc repo

```text
School/
├─ README.md                 ← bạn đang đọc
└─ sakura-repo/
   ├─ azota-helper.user.js   ← userscript chính
   ├─ sakura-loader.user.js  ← loader: tải script từ GitHub, chuyển tiếp request khi trang chặn CSP
   └─ banks/
      ├─ azota.txt           ← sổ chung
      └─ azota/
         └─ <mã-đề>.txt      ← sổ riêng cho từng đề
```

> Tên file có thể khác một chút so với thực tế trong repo, hãy chỉnh lại cho khớp.

### Định dạng sổ đáp án

Mỗi dòng là một cặp `câu hỏi ||| đáp án đúng`. Dòng bắt đầu bằng `#` là ghi chú.

```text
# Mỗi dòng: câu hỏi ||| đáp án đúng
Thủ đô của Việt Nam là ||| Hà Nội
[ĐS] Nước sôi ở 100°C ở áp suất khí quyển chuẩn ||| Đúng
Mạch logic thực hiện phép toán AND có kí hiệu là : ||| ⟦img:ten-file-anh.png⟧
```

- `[ĐS]` đứng đầu: ý của câu đúng/sai, đáp án là `Đúng` hoặc `Sai`.
- `⟦img:...⟧`: đáp án là ảnh, được định danh bằng tên file ảnh.

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:ff7fb8,50:c19bff,100:7fc8ff&height=3" alt="" width="100%">

## 🚀 Cài đặt

1. Cài tiện ích quản lý userscript: **Tampermonkey** hoặc **Violentmonkey**.
2. Tạo script mới và dán nội dung `azota-helper.user.js` (hoặc mở file ở dạng *Raw* để trình quản lý tự cài).
3. *(Tuỳ chọn)* Cài thêm **Sakura Loader** nếu muốn tải và lưu sổ lên GitHub khi trang chặn kết nối ngoài.
4. Mở `azota.vn`, bảng điều khiển 🌸 sẽ hiện ở góc phải màn hình.

## 🌙 Sử dụng

| Bước | Việc cần làm |
|:-:|---|
| 1 | Làm bài như bình thường, tự nộp bài |
| 2 | Mở trang **xem đáp án**, bảng 🌸 tự quét và báo `đã quét N câu` |
| 3 | Bấm **Lưu sổ lên GitHub** (nhập token một lần) nếu muốn đồng bộ |
| 4 | Khi làm lại đề, bấm **Tải đáp án từ GitHub**, script tô viền hoặc chọn sẵn đáp án đã nhớ |
| 5 | **Tự đọc lại, tự suy nghĩ, tự nộp** ✨ |

<details>
<summary><b>🔑 Về GitHub token</b></summary>

- Dùng *fine-grained token*, chỉ cấp cho đúng repo này, quyền **Contents: Read and write**.
- Script hỏi token mỗi lần lưu và **không ghi vào `localStorage`**.
- Repo công khai thì việc tải đáp án không cần token.
- Không chia sẻ token, không commit token vào repo.

</details>

<details>
<summary><b>🛠️ Xử lý sự cố thường gặp</b></summary>

| Hiện tượng | Cách xử lý |
|---|---|
| `không khớp ảnh đáp án` | Cập nhật lên **v3.0**, F5 trang, bấm *Tải đáp án từ GitHub*, rồi xem log trong Console |
| Đáp án lưu có dính chữ "Giải thích" | v3.0 tự làm sạch, kể cả dữ liệu cũ |
| Không kết nối được GitHub | Trang đang chặn kết nối ngoài, hãy cài Sakura Loader |
| GitHub báo 403 khi tải | Đang bị giới hạn lượt gọi, chờ một lúc rồi thử lại |
| Không thấy bảng điều khiển | Kiểm tra userscript đã bật chưa, thử F5 |

</details>

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:ff7fb8,50:c19bff,100:7fc8ff&height=3" alt="" width="100%">

## 📝 Lịch sử phiên bản

| Phiên bản | Ghi chú |
|:-:|---|
| **3.0** | Nhận ảnh đáp án có chiều cao 0; tự bỏ chữ nút "Giải thích / Tìm Giáo Án" dính vào đáp án |
| 2.9 | Giao diện Sakura, đồng bộ GitHub theo mã đề, đáp án dạng ảnh, câu đúng/sai |

## ⚖️ Lưu ý

- Dự án phục vụ **học tập cá nhân và nghiên cứu kỹ thuật**. Người dùng tự chịu trách nhiệm về cách sử dụng.
- Không dùng trong các bài kiểm tra, kỳ thi hoặc bài đánh giá khi quy định không cho phép.
- Trang web có thể thay đổi cấu trúc bất cứ lúc nào, script có thể ngừng hoạt động mà không báo trước.
- Nếu chủ sở hữu trang hoặc nhà trường yêu cầu, mình sẽ gỡ nội dung liên quan.

<div align="center">

### 🌸 ganbatte ne~ · 頑張って 🌸

*Học thật, nhớ thật, và đừng quên nghỉ ngơi.*

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:ff7fb8,50:c19bff,100:7fc8ff&height=140&section=footer&animation=twinkling" alt="" width="100%">

</div>
