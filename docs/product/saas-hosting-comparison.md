# So sánh nhà cung cấp hạ tầng cho NEXAMed SaaS (lập 15/10/2026)

Mục đích: chọn nơi đặt máy chủ + tên miền cho kiểu triển khai SaaS (`docs/DECISIONS.md` #237, #238; còn nợ "chọn nhà cung cấp trong nước"). **Tài liệu này là khung chọn + dữ liệu đã kiểm được; KHÔNG phải báo giá.** Phần lớn nhà cung cấp không đăng giá công khai nên phải xin báo giá theo mẫu ở mục 4.

## 1. Hệ thống SaaS cần gì từ hạ tầng

| Nhu cầu | Vì sao | Yêu cầu tối thiểu |
|---|---|---|
| Máy chủ Linux có quyền root, chạy Docker | Cài bằng `nexamed-setup` (Docker Compose) | 4 vCPU, 8 GB RAM, 100 GB SSD để bắt đầu; mở rộng được |
| IP công khai tĩnh, mở cổng 80/443 | Khách vào qua `https://<mã>.<tên-miền>` | IP tĩnh, không chặn cổng |
| Đặt tại Việt Nam | Dữ liệu y tế là dữ liệu cá nhân nhạy cảm; tránh phải làm hồ sơ chuyển dữ liệu ra nước ngoài | Trung tâm dữ liệu tại VN (xem mục 5, cần luật sư xác nhận) |
| DNS: bản ghi wildcard `*.tên-miền` + `admin` | Mỗi công ty một tên miền phụ | Hỗ trợ bản ghi `*` kiểu A |
| Chứng chỉ HTTPS wildcard, gia hạn tự động | Chứng chỉ có hạn; thay tay dễ quên là sập cả hệ thống | DNS có API tạo bản ghi TXT (ACME DNS-01) HOẶC mua chứng chỉ wildcard + quy trình thay |
| Sao lưu ngoài máy (khác ổ, khác nơi) | Mất máy chủ thì mất cả dữ liệu và bản sao nằm cùng máy | Snapshot + kho lưu trữ đối tượng tương thích S3 (hoặc máy chủ sao lưu riêng) |
| Hỗ trợ tiếng Việt, hoá đơn VAT, hợp đồng | Vận hành thực tế | Hỗ trợ 24/7, SLA bằng văn bản |

## 2. Dữ liệu đã kiểm được

**Viettel IDC** (cloud server, theo trang tổng hợp whtop.com, cập nhật khoảng tháng 4/2026; giá có thể chưa gồm VAT 10%, **kiểm lại ở viettelidc.com.vn**):

| Gói | Cấu hình | Giá/tháng | SLA | Ghi chú |
|---|---|---|---|---|
| T1.Base 05 | 4 vCPU, 8 GB, 40 GB SSD, 300 Mbps | 799.000 đ | 99,95% | CPU Intel E5-2690v4; ổ 40 GB nhỏ, phải mua thêm |
| T2.Gen 02 | 4 vCPU, 8 GB, 80 GB SSD, 300 Mbps | 1.200.000 đ | 99,99% | CPU Intel Gold; thêm 100.000 đ/vCPU hoặc GB RAM |
| T2.Gen 04 | 4 vCPU, 16 GB, 100 GB SSD, 300 Mbps | 2.000.000 đ | | khi cần nhiều RAM |

Mức giá thị trường chung (bài GreenNode, 2026): cấu hình 2–4 vCPU / 4–8 GB thường 600.000–1.200.000 đ/tháng ở Việt Nam.

**Cơ chế chứng chỉ (đã kiểm):** chứng chỉ wildcard của Let's Encrypt BẮT BUỘC dùng xác thực DNS-01 (tạo bản ghi TXT trong vùng DNS); không cần mở cổng 80 cho cách này. Certbot có plugin cho Cloudflare, Route 53, DigitalOcean, Google, OVH; nhà cung cấp DNS không có plugin thì dùng `acme-dns` (uỷ quyền nhãn `_acme-challenge` sang vùng do mình kiểm soát) hoặc tự chạy DNS riêng.

## 3. Chưa kiểm được (tra cứu không ra — cần báo giá hoặc xem trang chính thức)

Giá và tính năng của **VNPT Cloud/VNPT IDC, FPT Cloud, CMC Cloud**, các nhà hosting/VPS (Vinahost, BKNS, Nhân Hòa, Mắt Bão, iNET, ...), việc từng nhà đăng ký tên miền có **API DNS** hay không, và thủ tục đổi nameserver tên miền `.vn` sang nhà cung cấp DNS khác. **Không có số liệu nào trong mục này được bịa ra.**

## 4. Mẫu yêu cầu báo giá (gửi cho 3 đến 4 nhà cung cấp, so cùng một đề bài)

1. Cloud server Linux (Ubuntu 22.04/24.04), 4 vCPU, 8 GB RAM, 100 GB SSD, root, IP tĩnh, băng thông không giới hạn hoặc nêu rõ hạn mức. Giá tháng và giá khi trả năm, đã gồm VAT chưa.
2. Có cài được Docker và Docker Compose không; có chặn cổng 80/443 hoặc chính sách nào hạn chế dịch vụ y tế không.
3. Trung tâm dữ liệu đặt ở đâu (thành phố, quốc gia); chứng nhận (ISO 27001 hoặc tương đương); SLA bằng văn bản và mức đền bù.
4. Snapshot/backup: giá, tần suất, lưu giữ bao lâu; có kho lưu trữ đối tượng tương thích S3 không (giá theo GB/tháng) để sao lưu ngoài máy.
5. DNS: có quản lý DNS không, có bản ghi wildcard không, **có API tạo/xoá bản ghi TXT không** (tên API/tài liệu).
6. Mở rộng: nâng cấu hình có dừng máy không; giá thêm vCPU/RAM/ổ đĩa.
7. Hỗ trợ: giờ hỗ trợ, kênh, thời gian phản hồi sự cố; có tài khoản kỹ thuật riêng không; hợp đồng và hoá đơn VAT.
8. Thoát khỏi nhà cung cấp: xuất toàn bộ dữ liệu, xoá dữ liệu khi chấm dứt hợp đồng có xác nhận bằng văn bản không.

## 5. Điểm pháp lý cần luật sư xác nhận (tra cứu mới chỉ ra một phần)

- Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15 có hiệu lực từ 01/01/2026; tại thời điểm tra cứu (bài cập nhật 21/8/2025) chưa thấy nghị định hướng dẫn chi tiết.
- Nghị định 53/2022/NĐ-CP (hướng dẫn Luật An ninh mạng) quy định một số loại dữ liệu người dùng phải lưu tại Việt Nam, nhưng kết quả tra cứu **không nói về dữ liệu y tế**.
- Dữ liệu sức khoẻ thường được coi là dữ liệu cá nhân nhạy cảm; nghĩa vụ đánh giá tác động khi chuyển ra nước ngoài **chưa tra được trong phiên này**. Cách an toàn: chọn nhà cung cấp có máy chủ tại Việt Nam và hỏi luật sư trước khi ký.

## 6. Gợi ý kiến trúc để đỡ phụ thuộc nhà cung cấp

- **Tách DNS khỏi máy chủ.** Vùng DNS chỉ chứa tên và IP (không phải dữ liệu bệnh nhân), nên có thể đặt ở nhà cung cấp DNS có API tốt (ví dụ Cloudflare, miễn phí) dù máy chủ đặt ở Việt Nam. Cần đổi nameserver của tên miền sang nhà cung cấp DNS đó (hỏi nhà đăng ký `.vn` thủ tục và có cho đổi không).
- **Tự gia hạn chứng chỉ bằng certbot trên máy chủ** (plugin DNS tương ứng), hook sau gia hạn ghi chứng chỉ vào thư mục `certs/` của NEXAMed rồi chạy `docker compose restart caddy`. Cách này giữ nguyên thiết kế hiện tại của trình cài đặt (chứng chỉ do người vận hành cung cấp), không phải sửa mã. Phương án thay thế (Caddy tự xin qua plugin DNS) cần dựng lại ảnh Caddy kèm plugin — chỉ làm nếu cần.
- Thời hạn chứng chỉ có xu hướng ngắn dần theo quy định của các tổ chức cấp chứng chỉ, nên **tự động hoá gia hạn là bắt buộc**, không nên dựa vào nhắc lịch bằng tay (thông tin này nhớ từ lộ trình ngành, chưa kiểm lại trong phiên).

## 7. Đề xuất bước tiếp

1. Chọn 3 đến 4 nhà cung cấp trong nước (gồm Viettel IDC đã có giá, và 2 đến 3 nhà khác như VNPT, FPT, CMC hoặc một nhà hosting) và gửi mẫu ở mục 4.
2. Chọn nhà cung cấp DNS có API và kiểm tra việc đổi nameserver cho tên miền SaaS.
3. Nhận báo giá, điền bảng so sánh thật (cùng đề bài), chốt, rồi dựng thử bằng `nexamed-setup` kiểu SaaS trên máy thật (kiểm chứng DNS wildcard, chứng chỉ, Host header, sao lưu ngoài máy).

Nguồn: [bảng giá Viettel IDC (whtop.com)](https://www.whtop.com/plans/viettelidc.com.vn/147281), [bảng giá thị trường (GreenNode)](https://greennode.ai/blog/cloud-server-bang-gia-thue), [Let's Encrypt wildcard DNS-01](https://stackharbor.com/en/knowledge-base/letsencrypt-dns01-wildcard/), [certbot-dns-cloudflare](https://certbot-dns-cloudflare.readthedocs.io/), [Nghị định 53/2022 (KPMG)](https://advisory.kpmg.us:443/content/dam/kpmg/vn/pdf/Legal-Update/2022/9/legal-alert-for-decree-53-guiding-cybersecurity-law-vn.pdf), [Luật BVDLCN 2025 hiệu lực 1/1/2026](https://hatinh.gov.vn/vi/bai-viet/luat-bao-ve-du-lieu-ca-nhan-chinh-thuc-co-hieu-luc-thi-hanh-tu-ngay-112026).
