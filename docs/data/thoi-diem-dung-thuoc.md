# MASTER DATA DƯỢC PHẨM: THỜI ĐIỂM DÙNG THUỐC (TIMING OF ADMINISTRATION)

Trích từ `cachdungthoidiemdung.md` (chủ dự án cung cấp, 16/09/2026) — chỉ phần "II. MASTER DATA: THỜI ĐIỂM DÙNG THUỐC", đúng phạm vi đã chốt (`docs/DECISIONS.md` #155): không dùng phần "I. CÁCH DÙNG THUỐC" (M01-M99) vì trùng lặp với danh mục Đường dùng/Dạng bào chế đã có.

## Bảng Danh Sách Master Data

| Mã UI (`code`) | Mã Bộ Y tế (`byt_code`) | Tên ngắn UI (`short_name`) | Tên đầy đủ chuẩn (`name`) | Quy tắc thời gian chi tiết |
| :--- | :--- | :--- | :--- | :--- |
| **T01** | `1` | Sau ăn | Uống sau khi ăn | Uống ngay sau bữa ăn hoặc sau ăn 15 - 30 phút |
| **T02** | `2` | Trước ăn | Uống trước khi ăn | Uống trước bữa ăn 30 - 60 phút (khi bụng rỗng) |
| **T03** | `3` | Trong khi ăn | Uống cùng bữa ăn | Uống ngay trong khi đang ăn bữa chính |
| **T04** | `4` | Sáng | Uống vào buổi sáng | Uống sau khi thức dậy hoặc sau bữa ăn sáng |
| **T05** | `5` | Tối / Trước ngủ | Uống buổi tối / Trước khi đi ngủ | Uống trước khi đi ngủ 30 phút |
| **T06** | `6` | Khi đau / Khi cần | Sử dụng khi có triệu chứng | Chỉ dùng khi xuất hiện triệu chứng (đau, sốt, lên cơn hen...) |
| **T07** | `7` | Cách giờ cố định | Uống cách mỗi X giờ | Uống đều đặn cách nhau mỗi 8h hoặc 12h (thường dùng cho kháng sinh) |
| **T08** | `8` | Tùy thời điểm | Không phụ thuộc bữa ăn | Có thể uống lúc nào trong ngày, không ảnh hưởng bởi thức ăn |
| **T99** | `99` | Khác | Thời điểm khác | Theo chỉ định cụ thể của bác sĩ kê đơn |
