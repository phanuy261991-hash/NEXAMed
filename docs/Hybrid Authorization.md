# YÊU CẦU THIẾT KẾ KIẾN TRÚC PHÂN QUYỀN HỆ SINH THÁI (PLATFORM)

Hãy đóng vai trò là một **Principal Software Architect**. Tôi đang phát triển một hệ thống ban đầu là Phần mềm Quản lý Phòng khám (HIS), nhưng tầm nhìn dài hạn là mở rộng thành một **Hệ sinh thái Nền tảng (Platform)** bao gồm nhiều Module/Service độc lập (ví dụ: HIS, CRM, Telemedicine, HR).

Để chuẩn bị cho việc mở rộng này, tôi cần bạn thiết kế hệ thống tài khoản và phân quyền theo mô hình **Định danh tập trung kết hợp Phân quyền phân tán (Centralized Identity + Module-Specific Authorization)**.

## 1. NGUYÊN TẮC KIẾN TRÚC CỐT LÕI (HYBRID MODEL)

Hệ thống phải được chia làm hai lớp rõ ràng:

### Lớp 1: Hệ thống Định danh Trung tâm (Identity Provider - IdP / SSO)
*   **Chức năng:** Chịu trách nhiệm Authentication (Xác thực). Cung cấp tính năng Single Sign-On (SSO).
*   **Tài khoản duy nhất:** Một nhân viên (VD: Bác sĩ A) chỉ có một User_ID, Email, và Password duy nhất trên toàn hệ sinh thái.
*   **Global Roles:** IdP chỉ cấp phát các nhãn vai trò toàn cục cơ bản (VD: `Doctor`, `Nurse`, `Admin`, `Patient`), tuyệt đối KHÔNG lưu trữ các quyền chi tiết (Permissions).
*   **Đầu ra:** Cấp phát một **JWT (JSON Web Token)** chứa `User_ID`, `Global_Role`, và `Tenant_ID` (nếu có chi nhánh).

### Lớp 2: Quản lý Phân quyền tại từng Module (Module-Specific Authorization)
*   **Chức năng:** Chịu trách nhiệm Authorization (Cấp quyền). Mỗi module (HIS, CRM, HR) sẽ có bảng phân quyền (RBAC & Row-level) của riêng nó.
*   **Role Mapping (Phiên dịch vai trò):** Khi một module nhận được JWT từ IdP, nó sẽ tự đối chiếu `Global_Role` với bảng Permissions nội bộ.
    *   *Ví dụ:* Module HIS thấy `Doctor` -> Cho phép xem Bệnh án. Module HR thấy `Doctor` -> Coi như nhân viên thường, không có quyền duyệt lương.
*   **Tính độc lập:** Các module không chia sẻ chung Database Phân quyền. Tránh tình trạng bảng Permissions bị phình to (Bloat) chứa hàng ngàn quyền không liên quan đến nhau.

---

## 2. CHIẾN LƯỢC CƠ SỞ DỮ LIỆU TÁCH BIỆT (Database Strategy)

Bạn cần thiết kế schema theo hướng cô lập dữ liệu (tương thích với Modular Monolith hoặc Microservices):

*   **Database 1 (Auth DB / Central):**
    *   Bảng `Users` (ID, Email, Password Hash, Status).
    *   Bảng `Global_Roles` (ID, Role_Name).
    *   Bảng `User_Global_Roles`.

*   **Database 2 (HIS Module DB):**
    *   Bảng `HIS_Permissions` (Kê đơn, Xem bệnh án, Thu tiền...).
    *   Bảng `HIS_Role_Permissions` (Mapping giữa Global_Roles ID và HIS_Permissions).
    *   *(Các bảng nghiệp vụ của HIS như Bệnh án, Đơn thuốc...)*

*   **Database 3 (CRM Module DB - Tương lai):**
    *   Bảng `CRM_Permissions` (Gọi điện, Chăm sóc KH...).
    *   Bảng `CRM_Role_Permissions`.

---

## 3. LUỒNG HOẠT ĐỘNG API (API Flow)
Khi thiết kế luồng gọi API, hãy đảm bảo tính quy trình sau:
1.  **Client** gửi Request đăng nhập (Email/Pass) đến `Auth Service`.
2.  `Auth Service` kiểm tra và trả về JWT (chứa `user_id` và `role="doctor"`).
3.  **Client** muốn kê đơn thuốc, gửi Request kèm JWT tới `HIS Service`.
4.  `HIS Service` (thông qua Middleware) verify chữ ký JWT, đọc role `doctor`.
5.  `HIS Service` truy vấn DB nội bộ của nó xem role `doctor` có quyền "Kê đơn" hay không, và kiểm tra Row-level Security (như đã định nghĩa ở tài liệu trước) trước khi cho phép.

---

## 4. YÊU CẦU THỰC THI CHO CLAUDE

Nếu bạn đã nắm rõ tầm nhìn kiến trúc nền tảng này, hãy phản hồi: "Tôi đã hiểu rõ mô hình Centralized Identity + Module-Specific Authorization." 

