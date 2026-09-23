import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { EncounterStatus, ReceptionListItem } from '@nexamed/shared';

/** Nhãn tiếng Việt cho `EncounterStatus` — khai RIÊNG ở backend, KHÔNG import từ
 * `ENCOUNTER_STATUS_META` (`apps/web/src/features/reception/encounter-status.ts`) vì hằng số xuất
 * từ `apps/web` không resolve được qua ranh giới build backend (cùng lý do đã ghi ở
 * `CashBookExportService` — `docs/DECISIONS.md` #032/#091/#114), 6 chuỗi ngắn chấp nhận trùng lặp. */
const STATUS_LABELS: Record<EncounterStatus, string> = {
  SCHEDULED: 'Đã đặt',
  CHECKED_IN: 'Đã tiếp nhận',
  IN_CONSULTATION: 'Đang khám',
  COMPLETED: 'Đã hoàn tất',
  CANCELLED: 'Đã huỷ',
  NO_SHOW: 'Không đến',
};

/** Tuổi hiển thị (năm/tháng) — đúng khuôn `computeAgeLabel()` (`apps/web/src/features/patient/
 * patient-form.utils.ts`), khai lại RIÊNG ở backend cùng lý do `STATUS_LABELS` ở trên. */
function ageLabel(dob: string, at: Date): string {
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return '';
  let months = (at.getFullYear() - birth.getFullYear()) * 12 + (at.getMonth() - birth.getMonth());
  if (at.getDate() < birth.getDate()) months -= 1;
  if (months < 0) return '';
  const years = Math.floor(months / 12);
  return years >= 3 ? `${years} tuổi` : `${months} tháng tuổi`;
}

function formatVnDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 60 * 60_000);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()} ${hh}:${min}`;
}

/** Nhãn trạng thái — "Chờ thu" ưu tiên hơn "Đã tiếp nhận" khi CHECKED_IN chưa thu tiền, đúng
 * `resolveStatusBadge()` (`ReceptionListPage.tsx`). */
function statusLabel(item: ReceptionListItem): string {
  if (item.status === 'CHECKED_IN' && item.invoiceStatus === 'UNPAID') return 'Chờ thu';
  return STATUS_LABELS[item.status];
}

/** "Xuất Excel" cho "Bệnh nhân trong ngày" (Danh sách tiếp nhận) — LUÔN xuất toàn bộ lượt khám
 * trong ngày (bỏ qua tab/tìm kiếm đang chọn trên màn hình), cột khớp đúng bảng đang hiển thị
 * (chốt qua AskUserQuestion). Backend-only (`exceljs`), đúng khuôn `CashBookExportService`. */
@Injectable()
export class ReceptionExportService {
  async buildReceptionListExcel(
    date: string,
    items: ReceptionListItem[],
    doctorNameById: Map<string, string>,
    departmentNameById: Map<string, string>,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Bệnh nhân trong ngày');

    sheet.addRow([`Bệnh nhân trong ngày — ${date}`]);
    sheet.addRow([]);
    const headerRow = sheet.addRow(['Mã LK', 'Họ tên', 'Năm sinh / Tuổi', 'SĐT', 'Bác sĩ / Khoa phụ trách', 'Giờ tiếp nhận', 'Trạng thái']);
    headerRow.font = { bold: true };

    const now = new Date();
    for (const item of items) {
      const doctorOrDept = item.doctorId
        ? (doctorNameById.get(item.doctorId) ?? '—')
        : `Chưa gán · ${departmentNameById.get(item.departmentId) ?? ''}`;
      sheet.addRow([
        item.encounterNo,
        item.fullName,
        `${item.dob.slice(0, 4)} (${ageLabel(item.dob, now)})`,
        item.phone,
        doctorOrDept,
        formatVnDateTime(item.checkedInAt),
        statusLabel(item),
      ]);
    }

    sheet.getColumn(1).width = 16;
    sheet.getColumn(2).width = 26;
    sheet.getColumn(3).width = 18;
    sheet.getColumn(4).width = 14;
    sheet.getColumn(5).width = 28;
    sheet.getColumn(6).width = 18;
    sheet.getColumn(7).width = 16;

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer as unknown as Uint8Array);
  }
}
