/** Giờ mở/đóng cửa một ngày trong tuần; `null` = đóng cửa cả ngày. Khớp `businessHoursSchema` ở
 * `packages/shared/src/clinic.ts` — định nghĩa lại cục bộ (không import `packages/shared` vào
 * `packages/core`, giữ đúng chiều phụ thuộc `.claude/docs/project-structure.md`). */
export interface DayHours {
  open: string;
  close: string;
}

export interface WeeklyBusinessHours {
  monday: DayHours | null;
  tuesday: DayHours | null;
  wednesday: DayHours | null;
  thursday: DayHours | null;
  friday: DayHours | null;
  saturday: DayHours | null;
  sunday: DayHours | null;
}

/**
 * Đọc cấu hình lịch (giờ làm việc + độ dài slot) cho màn hình Lịch hẹn (S2-09) — dữ liệu thuộc
 * module `clinic` (`tenant_setting`). Cùng lý do dùng port thay vì import thẳng như
 * `DoctorDirectoryPort` (xem file đó) — `appointment` không tự đọc bảng của module khác.
 */
export interface ClinicConfigReaderPort {
  getScheduleConfig(tenantId: string): Promise<{ businessHours: WeeklyBusinessHours | null; slotDurationMinutes: number }>;

  /**
   * "Phòng làm việc hôm nay" của từng bác sĩ (docs/DECISIONS.md #054) — key = doctorId. Chỉ để
   * hiển thị cạnh tên bác sĩ ở danh sách chọn (`GET /appointments/doctors`), KHÔNG dùng để lọc
   * quyền/hàng đợi khám (vẫn theo doctor_id như trước). Bác sĩ chưa chọn phòng hôm nay, hoặc
   * tenant chưa có ≥2 phòng active, thì không có key tương ứng trong kết quả.
   */
  getTodayDoctorRoomAssignments(tenantId: string): Promise<Record<string, { roomId: string; roomName: string }>>;

  /**
   * Thu ngân cơ bản (Sprint 5/6) — bật/tắt tính năng "Thanh toán sau" CẤP PHÒNG KHÁM (`tenant_setting`
   * key `deferred_payment_enabled`). `encounter`/`reception` đọc qua port này (không import thẳng
   * module `clinic`) để gate "Hàng đợi khám" (`EncounterService.startConsultation`,
   * `EncounterRepository.listForDay`) — tắt thì mọi `Encounter.allowsDeferredPayment` bị coi như
   * `false`, không phân biệt giá trị đã lưu.
   */
  getDeferredPaymentEnabled(tenantId: string): Promise<boolean>;

  /**
   * Tự động đánh dấu "Không đến" (S5-07, APP-05) — job nền (`apps/api/src/modules/appointment/
   * no-show.ts`) đọc qua port này thay vì import thẳng `ClinicSettingsRepository`, cùng lý do
   * `getDeferredPaymentEnabled` ở trên. `enabled=false` (mặc định) — job bỏ qua tenant này hoàn
   * toàn, lễ tân/bác sĩ tự đánh dấu thủ công.
   */
  getNoShowConfig(tenantId: string): Promise<{ enabled: boolean; thresholdMinutes: number }>;

  /**
   * "Tạm nghỉ / Đóng ca" của bác sĩ — 2 công tắc độc lập (`tenant_setting`):
   * `allowEmergencyEndShift` (mặc định BẬT) gate riêng Trường hợp 1 "đóng đột xuất" (nút "Đóng ca
   * hôm nay" bấm bất kỳ lúc nào) — KHÔNG ảnh hưởng Trường hợp 2 "hết giờ làm việc" (tự nhắc theo
   * giờ đóng cửa phòng khám, luôn hoạt động). `allowReceptionistEndShift` (mặc định TẮT) gate lễ
   * tân/clinic_admin thao tác hộ trạng thái của bác sĩ khác. Module `doctor-availability` đọc qua
   * port này thay vì import thẳng `ClinicSettingsRepository`, cùng lý do `getNoShowConfig` ở trên.
   */
  getDoctorAvailabilityPolicy(tenantId: string): Promise<{ allowEmergencyEndShift: boolean; allowReceptionistEndShift: boolean }>;

  /**
   * "Đăng ký ca làm việc" Giai đoạn 2 — bật/tắt chặn đặt lịch hẹn ngoài ca bác sĩ đã đăng ký
   * (`tenant_setting` key `block_booking_outside_work_shift_enabled`, mặc định `false`).
   * `AppointmentService` đọc qua port này (module `clinic` sở hữu `tenant_setting`), cùng lý do
   * `getNoShowConfig`/`getDoctorAvailabilityPolicy` ở trên.
   */
  getBlockBookingOutsideWorkShiftEnabled(tenantId: string): Promise<boolean>;

  /**
   * Công tắc con "Chặn cả khi bác sĩ không có ca nào trong ngày" (`tenant_setting` key
   * `block_booking_when_no_shift_enabled`, mặc định `false`) — chỉ có hiệu lực khi
   * `getBlockBookingOutsideWorkShiftEnabled` cũng bật. Module `work-shift-assignment` đọc qua port này.
   */
  getBlockBookingWhenNoShiftEnabled(tenantId: string): Promise<boolean>;

  /**
   * Quota "nghỉ tối thiểu N ngày/tuần" khi Gửi duyệt đăng ký ca tháng (`tenant_setting` key
   * `min_weekly_days_off`, mặc định `0` = tắt).
   */
  getMinWeeklyDaysOff(tenantId: string): Promise<number>;

  /**
   * "Cấu hình chung" — bật/tắt cho phép nhân viên tự đăng ký ca trên "Lịch làm việc của tôi"
   * (`tenant_setting` key `allow_staff_self_schedule_enabled`, mặc định `true`). Module
   * `work-shift-assignment` đọc qua port này (module `clinic` sở hữu `tenant_setting`), cùng lý do
   * `getBlockBookingOutsideWorkShiftEnabled` ở trên. Chỉ chặn `create`/`bulkCreate`/`copy`/`remove`
   * khi `dataScope==='personal'` — `list()` (xem) và scope `global` (clinic_admin ở "Lịch làm việc
   * nhân viên") không bị ảnh hưởng.
   */
  getAllowStaffSelfScheduleEnabled(tenantId: string): Promise<boolean>;

  /**
   * "Khoá bảng ca" theo tháng (2026-09-03) — số ngày ân hạn sau khi sang tháng mới trước khi tháng
   * trước bị khoá hoàn toàn (`tenant_setting` key `work_shift_assignment_lock_grace_days`, mặc
   * định `0` = khoá ngay khi sang tháng mới). Module `work-shift-assignment` đọc qua port này
   * (module `clinic` sở hữu `tenant_setting`), cùng lý do `getAllowStaffSelfScheduleEnabled` ở
   * trên. Dùng cùng `isMonthLocked()` (`packages/core/src/work-shift-assignment/month-lock.ts`).
   */
  getWorkShiftAssignmentLockGraceDays(tenantId: string): Promise<number>;

  /**
   * "Đa thu ngân" (2026-09-04) — cho phép nhiều thu ngân cùng mở ca RIÊNG, chạy song song
   * (`tenant_setting` key `cashier_shift_multi_cashier_enabled`, mặc định `false` — giữ nguyên "1
   * két dùng chung toàn tenant"). Module `cashier-shift` đọc qua port này (module `clinic` sở hữu
   * `tenant_setting`), cùng lý do các cấu hình khác ở trên.
   */
  getCashierShiftMultiCashierEnabled(tenantId: string): Promise<boolean>;

  /**
   * "Thu chi tại quầy" (Sổ quỹ & Thu chi GĐ1) — bật/tắt bắt buộc duyệt phiếu CHI trước khi tính
   * vào tiền mặt dự kiến của ca (`tenant_setting` key `cash_voucher_approval_enabled`, mặc định
   * `false` — thu ngân tự lập phiếu, hiệu lực ngay). Module `cash-book` đọc qua port này (module
   * `clinic` sở hữu `tenant_setting`), cùng lý do các cấu hình khác ở trên.
   */
  getCashVoucherApprovalEnabled(tenantId: string): Promise<boolean>;

  /**
   * "Thủ quỹ riêng" (Sổ quỹ & Thu chi GĐ2) — mỗi thu ngân có 1 quỹ `DRAWER` riêng, tự cấp lúc mở
   * ca (`tenant_setting` key `cashier_drawer_separate_enabled`, mặc định `false`). BẮT BUỘC đi
   * cùng `getCashierShiftMultiCashierEnabled=true` (validate lúc `PATCH /clinic-settings`, không
   * validate lại ở đây — port chỉ đọc). Module `cashier-shift` đọc qua port này, cùng lý do các
   * cấu hình khác ở trên.
   */
  getCashierDrawerSeparateEnabled(tenantId: string): Promise<boolean>;

  /**
   * "Ví tạm ứng" — cho phép trừ TOÀN BỘ số dư ví rồi thu PHẦN CÒN LẠI bằng phương thức khác trên
   * CÙNG 1 phiếu khi số dư không đủ (`tenant_setting` key `wallet_mixed_payment_enabled`, mặc định
   * `false`). Module `billing` đọc qua port này (module `clinic` sở hữu `tenant_setting`), cùng lý
   * do các cấu hình khác ở trên.
   */
  getWalletMixedPaymentEnabled(tenantId: string): Promise<boolean>;

  /**
   * "Cảnh báo hạn dùng" (Kho Thuốc GĐ2) — số ngày trước hạn dùng để bắt đầu cảnh báo
   * (`tenant_setting` key `expiry_warning_days`, mặc định `30`). Module `inventory` đọc qua port
   * này (module `clinic` sở hữu `tenant_setting`), cùng lý do các cấu hình khác ở trên.
   */
  getExpiryWarningDays(tenantId: string): Promise<number>;

  /**
   * Kho Thuốc GĐ3 (#163) — TẮT (mặc định) Phiếu xuất kho cộng thẳng vào hoá đơn `SERVICE` đang mở;
   * BẬT thì luôn tự tạo/cộng vào hoá đơn `DRUG` riêng (`tenant_setting` key
   * `pharmacy_separate_invoice_enabled`). Module `inventory` đọc qua port này (module `clinic` sở
   * hữu `tenant_setting`), cùng lý do các cấu hình khác ở trên.
   */
  getPharmacySeparateInvoiceEnabled(tenantId: string): Promise<boolean>;

  /**
   * "Có kho thuốc" (Kho Thuốc GĐ5) — bật (mặc định) thì màn Kê đơn hiện tồn kho/cảnh báo vượt tồn/
   * nút "Phát thuốc"; tắt thì phòng khám không có kho thuốc riêng, ẩn sạch các phần đó (`tenant_setting`
   * key `pharmacy_stock_tracking_enabled`). Module `encounter` đọc qua port này (module `clinic` sở
   * hữu `tenant_setting`), cùng lý do các cấu hình khác ở trên.
   */
  getPharmacyStockTrackingEnabled(tenantId: string): Promise<boolean>;

  /**
   * "Chặn kê vượt tồn" (Kho Thuốc GĐ5) — tắt (mặc định) chỉ CẢNH BÁO MỀM lúc ký đơn; bật thì chặn
   * CỨNG (`tenant_setting` key `prescription_stock_block_enabled`). Chỉ có ý nghĩa khi
   * `getPharmacyStockTrackingEnabled=true`. Module `encounter` đọc qua port này, cùng lý do trên.
   */
  getPrescriptionStockBlockEnabled(tenantId: string): Promise<boolean>;

  /**
   * "Kê thuốc tự do, không qua danh mục" (mở rộng Kho Thuốc GĐ5, đảo ngược 1 điểm của #190) — tắt
   * (mặc định) giữ nguyên ràng buộc `drugId` bắt buộc; bật thì bác sĩ thêm được dòng thuốc chỉ có
   * tên tự do (không tính tiền/tồn kho, không phát được qua "Phát thuốc") — `tenant_setting` key
   * `allow_free_text_prescription_enabled`. Module `encounter` đọc qua port này, cùng lý do trên.
   */
  getAllowFreeTextPrescriptionEnabled(tenantId: string): Promise<boolean>;

  /**
   * "Cho thực hiện cận lâm sàng trước khi thu tiền" (Cận lâm sàng GĐ4, #212) — `tenant_setting` key `paraclinical_before_payment_enabled`, mặc định TẮT.
   * Module `paraclinical-result` đọc qua port này (không import thẳng module `clinic`) để quyết định dịch vụ chưa thu có vào "Chờ lấy mẫu / gọi vào phòng" hay không.
   */
  getParaclinicalBeforePaymentEnabled(tenantId: string): Promise<boolean>;

  /**
   * "Bắt buộc quét đủ ống trước khi xác nhận lấy mẫu" (Lấy mẫu xét nghiệm có tem mã vạch, #220) — `tenant_setting` key `specimen_scan_required`, mặc định TẮT.
   * Module `paraclinical-result` đọc qua port này; bật thì chặn xác nhận lấy mẫu bằng tích tay.
   */
  getSpecimenScanRequired(tenantId: string): Promise<boolean>;

  /**
   * "Gợi ý mã ICD-10 từ ô Chẩn đoán" — tắt (mặc định, giữ nguyên hành vi pilot đang chạy); bật thì màn
   * khám hiện khối gợi ý mã ICD từ nội dung ô "Chẩn đoán" (`tenant_setting` key
   * `icd10_suggestion_enabled`). Module `encounter` đọc qua port này, cùng lý do các cấu hình khác.
   */
  getIcd10SuggestionEnabled(tenantId: string): Promise<boolean>;

  /**
   * "Học từ lịch sử chọn mã" — tắt (mặc định); chỉ có ý nghĩa khi `getIcd10SuggestionEnabled=true`.
   * Bật thì "Hoàn tất khám" ghi thêm cặp "cụm từ bác sĩ gõ ↔ mã đã chọn từ gợi ý" để xếp hạng lần sau
   * (`tenant_setting` key `icd10_suggestion_learning_enabled`).
   */
  getIcd10SuggestionLearningEnabled(tenantId: string): Promise<boolean>;
}

export const CLINIC_CONFIG_READER_PORT = Symbol('CLINIC_CONFIG_READER_PORT');
