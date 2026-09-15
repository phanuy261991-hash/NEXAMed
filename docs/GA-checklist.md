# Checklist GA v1 — NEXAMed

Theo dõi sống 5 điều kiện gate ở `docs/product/plan.md` mục 9 ("Mốc tuần 12 — GA v1") + bảng chỉ số PRD mục 5. Cập nhật trạng thái dòng nào khi có bằng chứng thật (đo tại pilot, không phải suy luận) — không tự đánh dấu `[x]` khi chưa có số liệu/xác nhận cụ thể.

Quy ước trạng thái: `[ ]` chưa đạt/chưa đo, `[~]` đang làm/một phần đạt, `[x]` đạt đủ điều kiện, kèm ngày + bằng chứng.

---

## 1. Pilot ngừng dùng sổ giấy, chạy hoàn toàn trên hệ thống ≥5 ngày làm việc liên tục

> Bao gồm cả sổ thu tiền (`docs/DECISIONS.md` #072 — lý do "Thu ngân cơ bản" được đưa vào v1).

- [ ] Chưa đo — cần phòng khám pilot chạy thật ≥5 ngày làm việc liên tiếp, không dùng sổ giấy song song (kể cả sổ tiền).
- Ghi chú: S4-07 đã cài đặt thành công tại pilot đầu tiên (02/09/2026, `docs/DECISIONS.md` #100), nhưng đây là điều kiện *vận hành liên tục*, khác với "cài đặt xong" — cần theo dõi thêm ở hiện trường.

## 2. Đạt các chỉ số ở PRD mục 5 (đo tại phòng khám pilot, so với hiện trạng trước triển khai)

| Chỉ số | Mục tiêu | Trạng thái |
|---|---|---|
| Thời gian tiếp nhận một bệnh nhân cũ | < 90 giây | [ ] Chưa đo tại pilot |
| Thời gian bác sĩ hoàn tất hồ sơ một ca khám thường | < 3 phút | [ ] Chưa đo tại pilot |
| Tỷ lệ lượt khám có mã ICD-10 hợp lệ | > 95% | [ ] Chưa đo tại pilot |
| Tỷ lệ đơn thuốc in từ hệ thống thay vì viết tay | > 90% | [ ] Chưa đo tại pilot |
| Số lần đặt trùng lịch bác sĩ | 0 | [x] Đảm bảo bằng constraint DB (C2, exclusion constraint) — không thể xảy ra kể cả race điều kiện, đã test tự động (`appointment-http.spec.ts`) |
| Tỷ lệ lượt khám nhập vào hệ thống trong ngày (từ tuần 3) | > 95% | [ ] Chưa đo tại pilot |
| Số ca phải quay lại dùng giấy vì hệ thống chậm/lỗi (từ tuần 3) | < 2 ca/tuần | [ ] Chưa đo tại pilot |
| Bác sĩ tự thao tác được không cần hỗ trợ sau đào tạo 2 giờ | 100% | [ ] Chưa đo tại pilot |
| p95 API | < 500ms | [~] Mới đo trên máy dev (không phải cấu hình pilot thật) — xem S6-04 |
| Tải màn hình khám có đủ tiền sử | < 2 giây | [x] Đo được 33ms trên dev DB với 20 lượt khám cũ (S3-09) — dưới ngưỡng xa, nhưng cần đo lại trên cấu hình pilot thật (S6-04) để chắc chắn |
| Uptime giờ làm việc | > 99% | [ ] Chưa đo — cần vận hành thật đủ lâu để tính |
| Sao lưu chạy đúng lịch + phục hồi thử thành công | 100%, kiểm thử hàng tháng | [~] Xem mục 3 dưới |
| Rò rỉ dữ liệu giữa tenant qua test tự động | 0 | [x] Test cách ly tenant chạy ở mọi module chạm dữ liệu (RLS + lọc tường minh ở repository) — 0 phát hiện, đã rà soát lại toàn diện ở S6-03 |

**Lưu ý (PRD mục 5, dòng "Đo trong 4 tuần đầu..."):** các chỉ số hiện trạng phải đo TẠI PHÒNG KHÁM PILOT trước khi triển khai — không có số gốc thì không chứng minh được cải thiện. Chưa có số gốc nào được ghi nhận.

## 3. Sao lưu tự động chạy đúng 7 ngày liên tiếp, phục hồi thử thành công

- [x] Cơ chế cảnh báo khi backup thất bại/trễ hạn đã xong (S6-01, `docs/DECISIONS.md` #141) — banner đỏ cho `clinic_admin` khi thất bại hoặc quá 30 giờ chưa có lần thành công.
- [x] Diễn tập phục hồi ĐÃ làm một phần trên máy dev (01/09/2026, `docs/DECISIONS.md` #099) — phát hiện + sửa bug thật chặn restore hoàn toàn (`unaccent` thiếu schema-qualify).
- [ ] Chưa lặp lại diễn tập phục hồi TRÊN MÁY CHỦ PILOT THẬT (S6-02) — mới đo trên máy dev.
- [ ] Chưa xác nhận backup chạy đúng 7 ngày liên tiếp không gián đoạn tại pilot thật.

## 4. Không lỗi nghiêm trọng nào chưa xử lý (mất dữ liệu, sai bệnh nhân, rò rỉ giữa tenant)

- [x] Rà soát bảo mật đầy đủ theo checklist `.claude/docs/security-audit.md` đã xong (S6-03, 15/09/2026, `docs/DECISIONS.md` #142) — 4 lỗ hổng thật phát hiện + đã sửa (rate limit tra cứu bệnh nhân, giới hạn phạm vi Sổ quỹ, audit log export, hardcode role sót). Đa số hệ thống PASS.
- [~] Cần theo dõi thêm trong lúc pilot thật chạy (rà soát tĩnh không thay thế được vận hành thật phát hiện lỗi thực tế).

## 5. Có tài liệu cài đặt để triển khai khách hàng thứ hai mà không cần dev có mặt

- [x] `docs/Deploy.md` Phần 2 — hướng dẫn cài đặt kỹ thuật đầy đủ (đã dùng thật để cài pilot đầu tiên, S4-07).
- [x] `docs/troubleshooting.md` (S6-07, 15/09/2026) — xử lý sự cố thường gặp cho người không rành IT, bổ sung phần còn thiếu đã ghi nhận ở `docs/TASK.md`.
- [ ] **Chưa xác nhận bằng một lần cài đặt THẬT SỰ không có dev hỗ trợ** — pilot đầu tiên (S4-07) đã có dev hỗ trợ trực tiếp; điều kiện này đòi hỏi lần cài thứ hai hoàn toàn độc lập.

---

## Ba mục KHÔNG được cắt dù chọn phương án nào (`docs/product/plan.md` mục 10)

- [x] RLS và test cách ly tenant — đã có ở mọi module chạm dữ liệu bệnh nhân, xác nhận lại toàn diện ở S6-03.
- [x] Nhật ký hoạt động (ADM-03) — đã xong từ S5-05.
- [x] Cơ chế đính chính bệnh án (ENC-04/05) — đã xong từ S5-02/03/04.

---

## Việc còn treo trước khi ký GA

1. **S6-02** — diễn tập phục hồi trên máy chủ pilot thật + lặp lại định kỳ (cần pilot thật).
2. **S6-04** — đo hiệu năng p95 trên cấu hình máy chủ pilot thật (cần pilot thật).
3. Đo đủ bộ chỉ số PRD mục 5 tại pilot, có số gốc trước triển khai để so sánh.
4. Xác nhận pilot chạy ≥5 ngày làm việc liên tục không dùng sổ giấy.
5. Cài đặt độc lập lần thứ hai không có dev hỗ trợ, xác nhận tài liệu đủ dùng.
6. **S6-08** — soát lại toàn bộ checklist này lần cuối trước khi ký GA chính thức (bản thân việc dựng khung checklist này LÀ một phần của S6-08 — soát lại nghĩa là điền nốt các dòng `[ ]` còn lại bằng bằng chứng thật, không phải tick khống).

Cập nhật file này ngay khi có bằng chứng mới — không để tồn đọng như đã từng xảy ra với `docs/CURRENT.md` mục "Giai đoạn".
