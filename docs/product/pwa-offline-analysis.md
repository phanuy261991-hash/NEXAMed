# Phân tích khả thi — PWA Offline toàn diện (định hướng bản SaaS)

**Trạng thái**: Định hướng cho giai đoạn SaaS/cloud (sau v1 on-premise) — **CHƯA triển khai, chưa chốt kiến trúc cụ thể**. File này là phần lập luận + phương án, dùng để tham khảo khi có quyết định bắt đầu (xem mục 7 điều kiện tiên quyết). Không thêm code/thư viện/migration nào theo tài liệu này cho tới khi có quyết định đó.

**Không nhầm với ENC-06** (Sprint 6, đang làm cùng thời điểm viết tài liệu này) — xem mục 1 để phân biệt rõ 2 tầng khác hẳn nhau về chi phí.

---

## 0. Câu hỏi gốc

Chủ dự án hỏi: khi làm ENC-06 (lưu nháp offline cho form khám), liệu ứng dụng có thể "hoạt động offline tạm thời" hay không — và muốn đưa hướng "PWA Offline toàn diện" vào kế hoạch phát triển cho bản SaaS (tương lai, không phải v1 on-premise hiện tại).

Đã trả lời trực tiếp lúc đó: **hiện tại KHÔNG** — app là SPA thuần, không service worker, không cache asset, không app-shell offline. ENC-06 chỉ giải quyết đúng 1 lát cắt hẹp (xem mục 1). Tài liệu này mở rộng thành phân tích đầy đủ cho hướng lớn hơn.

## 1. Hai tầng khác hẳn nhau về chi phí — không được gộp chung

| Tầng | Mô tả | Ví dụ | Chi phí | Trạng thái |
|---|---|---|---|---|
| 1. **An toàn dữ liệu tạm thời** | Trang ĐÃ TẢI XONG, mất mạng vài giây-vài phút giữa chừng thao tác — không mất nội dung đang gõ, tự đồng bộ lại khi có mạng | ENC-06: form khám lưu nháp `localStorage`, gửi lại khi `online` | Rẻ (đã làm, xem `docs/DECISIONS.md`) | Đang code, Sprint 6 |
| 2. **PWA Offline toàn diện** | Mở app/tải trang MỚI/F5 khi KHÔNG có mạng vẫn dùng được, làm việc liên tục nhiều giờ không mạng (app-shell + toàn bộ dữ liệu nghiệp vụ cần thiết đã cache sẵn), đồng bộ hàng loạt khi có mạng lại | Bác sĩ khám cả buổi ở khu vực sóng yếu, mất mạng bất ngờ vẫn tiếp nhận/khám/kê đơn được, dữ liệu tự đẩy lên khi có mạng | **Đắt** (service worker, cache chiến lược, hàng đợi ghi offline, giải quyết xung đột, bảo mật dữ liệu cache) | Chưa làm, mục này |

Tầng 1 giải quyết đúng nỗi đau cụ thể đã biết (mất mạng vài giây/phút do wifi phòng khám chập chờn). Tầng 2 là một **kiến trúc ứng dụng khác hẳn** — không phải "làm thêm" từ tầng 1, mà là một hệ thống song song (client có bản sao dữ liệu + hàng đợi ghi + engine đồng bộ).

## 2. Vì sao tầng 2 đắt hơn nhiều lần trong một hệ thống y tế multi-tenant

### 2.1. App-shell caching (phần "dễ")
Service Worker (Workbox) cache HTML/JS/CSS/font/icon — Vite có `vite-plugin-pwa` hỗ trợ sẵn, tích hợp không quá phức tạp. Đây là phần RẺ của bài toán, không phải phần quyết định effort.

### 2.2. Dữ liệu nghiệp vụ cần cache để dùng offline (phần đắt thật sự)
Để "tiếp nhận/khám/kê đơn" hoạt động offline, client cần có SẴN trước khi mất mạng:
- Danh mục ICD-10 (15.844 mã), danh mục dùng chung (dân tộc/quốc tịch/nghề nghiệp...), danh mục thuốc/dị ứng, danh sách bệnh nhân đã từng khám (hoặc ít nhất bệnh nhân có lịch hẹn hôm nay), cấu hình phòng khám, ma trận quyền của actor hiện tại.
- Đây không phải cache tĩnh — dữ liệu đổi liên tục (danh mục thuốc, giá dịch vụ, phân quyền). Cần chiến lược "cache dữ liệu nghiệp vụ" riêng (IndexedDB + đồng bộ nền định kỳ khi có mạng), khác hoàn toàn cache asset tĩnh.

### 2.3. Hàng đợi ghi offline (outbox pattern) — phần khó nhất
Mọi thao tác GHI khi offline (tiếp nhận, lưu ghi chú khám, kê đơn, thu tiền...) phải xếp vào một hàng đợi cục bộ (IndexedDB), phát lại tuần tự khi có mạng, và phải xử lý đúng:
- **Sinh mã hiển thị** (`patient_code`, `encounter_no`...) hiện dựa vào sequence phía DB (`CLAUDE.md`: "Không sinh phía client, không dùng `Math.random()` hay timestamp") — offline thì KHÔNG có DB để xin số thứ tự. Cần cơ chế mã tạm phía client (ví dụ UUID cục bộ) rồi đổi thành mã thật lúc đồng bộ, hoặc cấp trước 1 dải số dự phòng lúc online — cả hai đều là thay đổi kiến trúc, không phải cấu hình thêm.
- **Optimistic locking** (`version`) đang giả định thao tác là đồng bộ ngay; hàng đợi offline làm nhiều thao tác "trễ" hàng giờ mới tới server → tăng mạnh khả năng đụng `409 CONCURRENT_MODIFICATION` cần màn hình giải quyết xung đột tử tế (hiện tại chỉ báo lỗi, chưa có UI merge).
- **`EXCLUDE` constraint chống trùng giờ bác sĩ** (C2, `appointment`), **`UNIQUE` chống trùng CCCD** (C3, `patient`) — các ràng buộc chỉ DB mới kiểm được thật; 2 máy offline cùng lúc tạo trùng chỉ phát hiện được LÚC ĐỒNG BỘ, không phải lúc thao tác — cần luồng xử lý xung đột nghiệp vụ (không chỉ kỹ thuật) cho từng loại va chạm.
- **Đa tenant + RLS**: mọi ghi/đọc hiện đi qua middleware set `app.current_tenant_id` từ JWT phiên hiện tại ở SERVER. Client offline phải TỰ đảm bảo cách ly tenant trong tầng cache/hàng đợi của chính nó — sai một chỗ là rò dữ liệu giữa các phiên dùng chung máy (phòng khám thường dùng chung 1 máy tính nhiều ca).

### 2.4. Bảo mật dữ liệu cache tại client — ràng buộc riêng của ngành y tế
`.claude/docs/security-audit.md` yêu cầu mã hoá PII/PHI at-rest, không log PII, không đưa PII ra ngoài tầm kiểm soát server. Cache offline (IndexedDB) là dữ liệu PHI nằm THẲNG trên ổ đĩa máy tính dùng chung của phòng khám — vượt khỏi ranh giới "server có kiểm soát" hiện tại. Cần tối thiểu:
- Mã hoá dữ liệu cache tại client (Web Crypto API, khoá theo phiên đăng nhập — không lưu khoá cùng dữ liệu).
- Giới hạn thời gian sống của cache (tự xoá sau X giờ/khi đăng xuất) — không giữ vĩnh viễn trên máy dùng chung.
- Audit log phải phân biệt được "thao tác xảy ra lúc nào thực sự" (giờ offline) và "lúc nào đồng bộ lên server" — ảnh hưởng cột `occurred_at` hiện có.

### 2.5. Có hành động KHÔNG THỂ làm offline, phải chặn rõ ràng trong UI
- Ký hồ sơ/đơn thuốc (`signed_at` + tương lai chữ ký số CA thật) — cần tin cậy thời điểm ký, không thể ký "hồi tố" khi đồng bộ trễ.
- Tra cứu chống trùng CCCD/tên real-time qua toàn tenant (client chỉ có cache cục bộ, không thấy dữ liệu người khác vừa nhập ở máy khác).
- Break-glass (cần xác thực lại + ghi audit tức thời, không có ý nghĩa nếu trễ).
- Bất kỳ cổng bên thứ ba nào sau này (BHYT, thanh toán) — luôn cần online thật.

## 3. Kiến trúc đề xuất (mức khung, chưa chi tiết hoá)

```
apps/web/
├── service-worker (Workbox)         # cache app-shell, đăng ký qua vite-plugin-pwa
├── shared/offline/
│   ├── outbox.ts                    # hàng đợi ghi offline (IndexedDB), FIFO theo entity
│   ├── sync-engine.ts               # phát lại outbox khi online, xử lý lỗi/xung đột
│   └── local-cache.ts               # cache dữ liệu nghiệp vụ đọc (danh mục, bệnh nhân hôm nay...)
└── features/*/offline-adapter.ts    # từng domain tự khai báo cái gì cache được, cái gì KHÔNG (mục 2.5)
```

Nguyên tắc khớp với kiến trúc port/adapter đã có (`CLAUDE.md`: "mọi phụ thuộc hạ tầng đi qua port/adapter") — tầng offline nên là một **adapter phía client** cho cùng khái niệm gọi API hiện có, không phải viết lại từng feature. `packages/shared` (Zod schema dùng chung web/api) là điểm tựa tốt để validate dữ liệu trước khi đẩy vào outbox.

## 4. Vì sao để dành cho "bản SaaS" thay vì làm ngay ở v1 on-premise

- v1 là **on-premise, một tenant/một máy chủ tại phòng khám** (`CLAUDE.md`) — mất mạng ở v1 thường có nghĩa là mất kết nối tới CHÍNH máy chủ trong LAN, không phải mất Internet. Rủi ro/tần suất khác hẳn so với mô hình SaaS cloud (nơi mất mạng = mất kết nối Internet, xảy ra thường xuyên hơn và khó kiểm soát hơn).
- SaaS/cloud hoá (kiến trúc `branch` bên trong `tenant`, xem `docs/Deploy.md` Phần 0.1) là điều kiện tiên quyết hợp lý hơn để đầu tư offline toàn diện — lúc đó "mất mạng" mới là rủi ro vận hành thường trực đáng đầu tư giải pháp lớn.
- Effort ước tính (rất thô, cần làm lại khi thật sự bắt đầu): app-shell caching 3-5 ngày; cache dữ liệu nghiệp vụ đọc 5-8 ngày; outbox + sync engine cho 1 domain đầu tiên (ví dụ chỉ Tiếp nhận) 10-15 ngày; nhân theo số domain cần offline. Đây là hạng mục tính bằng SPRINT, không phải bằng ngày như ENC-06.

## 5. Đề xuất phạm vi tối thiểu nếu/khi bắt đầu (không phải "toàn bộ app offline")

Giống bài học "Specialty Pack" (`docs/product/multi-specialty-analysis.md`): không nên nhắm "toàn bộ ứng dụng offline" ngay — chọn 1-2 domain rủi ro/giá trị cao nhất trước:
1. **Tiếp nhận + Khám bệnh** (đúng luồng lâm sàng cốt lõi, ENC-06 là bước đệm tự nhiên) — ưu tiên cao nhất.
2. **KHÔNG** đưa Thu ngân/Sổ quỹ vào offline giai đoạn đầu — sai lệch tiền bạc do đồng bộ trễ/xung đột là rủi ro nghiêm trọng hơn nhiều so với lợi ích, nên giữ thu ngân LUÔN yêu cầu online (chặn rõ ràng, không silent-fail).

## 6. Liên hệ ENC-06 (đang làm cùng lúc)

ENC-06 (tầng 1, mục 1) **không bị thay thế** bởi hướng này — cứ tiếp tục theo đúng phạm vi đã chốt (lưu nháp `localStorage` cho Ghi chú SOAP + Chẩn đoán, tự đồng bộ khi có mạng). Nếu sau này làm PWA toàn diện, phần `outbox`/`sync-engine` ở mục 3 có thể TÁI DÙNG lại đúng cơ chế `localStorage` + retry-khi-online đã xây cho ENC-06 làm nền tảng — không phải bỏ đi làm lại, chỉ mở rộng phạm vi cache (từ 1 form lên nhiều domain) và thêm tầng app-shell/IndexedDB.

## 7. Điều kiện tiên quyết trước khi bắt đầu thật

- [ ] Đã chuyển hướng/có lộ trình rõ ràng sang mô hình SaaS/cloud (không còn là "on-premise từng phòng khám" thuần tuý).
- [ ] Có khách hàng/thị trường thật xác nhận đây là nhu cầu bức thiết (không phải suy đoán) — tương tự điều kiện "Specialty Pack" chờ khách trả tiền.
- [ ] Đã quyết định xong mô hình sinh mã hiển thị khi offline (mục 2.3) — đây là thay đổi kiến trúc lõi, ảnh hưởng `code_sequence` hiện có, cần chốt TRƯỚC khi viết dòng code offline đầu tiên.
- [ ] Đã có phương án mã hoá cache client cụ thể (mục 2.4), review cùng yêu cầu pháp lý dữ liệu y tế hiện hành.
- [ ] Xác định rõ domain nào offline được, domain nào CẤM offline (mục 2.5, mục 5) — ghi thành quyết định chính thức, không để ngầm định.
