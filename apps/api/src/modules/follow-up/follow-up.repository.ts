import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FollowUpReminderResultKind, FollowUpTabKind } from '@nexamed/shared';

/**
 * Truy vấn của trang "Hẹn tái khám" (docs/DECISIONS.md #285) — SQL phẳng vì đọc nhiều bảng (kế hoạch điều trị, lượt khám, bệnh nhân, nhật ký nhắc). Mọi truy vấn lọc `tenant_id` và
 * `branch_id` của lượt khám GỐC (hướng chi nhánh #231); bác sĩ (phạm vi `personal`) chỉ thấy hẹn của lượt khám do mình khám. Quy tắc trạng thái/tab nằm ở `@nexamed/core`
 * (`follow-up-status.ts`); SQL ở đây thể hiện CÙNG quy tắc và có test HTTP đối chiếu.
 */

const COUNTED_STATUSES = Prisma.sql`n.status IN ('CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED')`;

export interface FollowUpFilter {
  tenantId: string;
  branchId: string;
  /** Có giá trị → chỉ lượt khám do bác sĩ này khám (phạm vi `personal`). */
  onlyDoctorId: string | null;
  /** Tìm theo tên đã bỏ dấu + viết thường, SĐT hoặc mã BN. */
  searchNormalized: string | null;
  doctorId: string | null;
  today: string;
  overdueFrom: string;
  upcomingTo: string;
}

export interface FollowUpRow {
  encounterId: string;
  encounterNo: string;
  patientId: string;
  patientCode: string;
  patientName: string;
  phone: string;
  followUpDate: string;
  returned: boolean;
  sourceDate: string;
  doctorId: string | null;
}

export interface FollowUpCursor {
  date: string;
  id: string;
}

export interface ReminderStats {
  count: number;
  last: { remindedAt: Date; result: FollowUpReminderResultKind; byName: string } | null;
}

export interface ReminderRow {
  id: string;
  result: FollowUpReminderResultKind;
  note: string | null;
  remindedAt: Date;
  byName: string;
}

/**
 * Tập hẹn tái khám đủ điều kiện hiển thị: kế hoạch ĐÃ KÝ còn hiệu lực, hướng "Hẹn tái khám", lượt khám gốc ĐÃ HOÀN TẤT ở chi nhánh, chưa bị ghi "Bệnh nhân không tái khám",
 * kèm cờ `returned` (bệnh nhân có lượt khám đã tiếp nhận SAU lượt gốc).
 */
function eligibleCte(f: FollowUpFilter): Prisma.Sql {
  const doctorScope = f.onlyDoctorId ? Prisma.sql`AND e.doctor_id = ${f.onlyDoctorId}::uuid` : Prisma.empty;
  const doctorFilter = f.doctorId ? Prisma.sql`AND e.doctor_id = ${f.doctorId}::uuid` : Prisma.empty;
  const search = f.searchNormalized
    ? Prisma.sql`AND (pt.search_key LIKE ${'%' + f.searchNormalized + '%'} OR pt.phone LIKE ${f.searchNormalized + '%'} OR lower(pt.patient_code) LIKE ${'%' + f.searchNormalized + '%'})`
    : Prisma.empty;
  return Prisma.sql`
    WITH f AS (
      SELECT p.follow_up_date AS d, e.id AS eid, e.encounter_no, e.patient_id, e.checked_in_at AS at, e.doctor_id,
             pt.patient_code, pt.full_name, pt.phone
        FROM encounter_treatment_plan p
        JOIN encounter e ON e.tenant_id = p.tenant_id AND e.id = p.encounter_id
        JOIN patient pt ON pt.tenant_id = e.tenant_id AND pt.id = e.patient_id
       WHERE p.tenant_id = ${f.tenantId}::uuid AND p.deleted_at IS NULL AND p.signed_at IS NOT NULL
         AND 'FOLLOW_UP' = ANY(p.directions::text[]) AND p.follow_up_date IS NOT NULL
         AND e.branch_id = ${f.branchId}::uuid AND e.deleted_at IS NULL AND e.status = 'COMPLETED'
         ${doctorScope} ${doctorFilter} ${search}
         AND NOT EXISTS (
           SELECT 1 FROM follow_up_reminder r
            WHERE r.tenant_id = e.tenant_id AND r.encounter_id = e.id AND r.result = 'NOT_RETURNING' AND r.deleted_at IS NULL)
    ), x AS (
      SELECT f.*,
             EXISTS (
               SELECT 1 FROM encounter n
                WHERE n.tenant_id = ${f.tenantId}::uuid AND n.patient_id = f.patient_id AND n.deleted_at IS NULL AND n.id <> f.eid
                  AND ${COUNTED_STATUSES} AND n.checked_in_at > f.at
             ) AS returned
        FROM f
    )`;
}

function tabPredicate(tab: FollowUpTabKind, f: FollowUpFilter): Prisma.Sql {
  switch (tab) {
    case 'today':
      return Prisma.sql`d = ${f.today}::date`;
    case 'overdue':
      return Prisma.sql`NOT returned AND d < ${f.today}::date AND d >= ${f.overdueFrom}::date`;
    case 'upcoming':
      return Prisma.sql`NOT returned AND d > ${f.today}::date AND d <= ${f.upcomingTo}::date`;
    case 'all':
      return Prisma.sql`TRUE`;
  }
}

interface RawRow {
  due_date: string;
  eid: string;
  encounter_no: string;
  patient_id: string;
  patient_code: string;
  full_name: string;
  phone: string;
  doctor_id: string | null;
  returned: boolean;
  source_date: string;
}

@Injectable()
export class FollowUpRepository {
  /** Số hẹn từng tab theo cùng bộ lọc (bác sĩ, tìm kiếm, phạm vi). */
  async countTabs(tx: Prisma.TransactionClient, f: FollowUpFilter): Promise<{ today: number; overdue: number; upcoming: number }> {
    const rows = await tx.$queryRaw<Array<{ today: number; overdue: number; upcoming: number }>>`
      ${eligibleCte(f)}
      SELECT COUNT(*) FILTER (WHERE ${tabPredicate('today', f)})::int AS today,
             COUNT(*) FILTER (WHERE ${tabPredicate('overdue', f)})::int AS overdue,
             COUNT(*) FILTER (WHERE ${tabPredicate('upcoming', f)})::int AS upcoming
        FROM x`;
    return { today: rows[0]?.today ?? 0, overdue: rows[0]?.overdue ?? 0, upcoming: rows[0]?.upcoming ?? 0 };
  }

  /**
   * Một trang hẹn tái khám của tab. Thứ tự: tab "Tất cả" mới nhất trước, các tab còn lại hẹn sớm nhất trước (quá hạn lâu nhất lên đầu); hoà ngày thì theo mã lượt khám. Phân trang theo
   * khoá `(ngày hẹn, id lượt khám)`; lấy `limit + 1` dòng để biết còn trang sau.
   */
  async list(tx: Prisma.TransactionClient, f: FollowUpFilter, tab: FollowUpTabKind, cursor: FollowUpCursor | null, limit: number): Promise<FollowUpRow[]> {
    const desc = tab === 'all';
    const after = cursor
      ? desc
        ? Prisma.sql`AND (d, eid) < (${cursor.date}::date, ${cursor.id}::uuid)`
        : Prisma.sql`AND (d, eid) > (${cursor.date}::date, ${cursor.id}::uuid)`
      : Prisma.empty;
    const order = desc ? Prisma.sql`ORDER BY d DESC, eid DESC` : Prisma.sql`ORDER BY d ASC, eid ASC`;
    const rows = await tx.$queryRaw<RawRow[]>`
      ${eligibleCte(f)}
      SELECT to_char(d, 'YYYY-MM-DD') AS due_date, eid, encounter_no, patient_id, patient_code, full_name, phone, doctor_id, returned,
             to_char((at AT TIME ZONE 'UTC') + interval '7 hours', 'YYYY-MM-DD') AS source_date
        FROM x
       WHERE ${tabPredicate(tab, f)} ${after}
       ${order}
       LIMIT ${limit + 1}`;
    return rows.map((r) => ({
      encounterId: r.eid,
      encounterNo: r.encounter_no,
      patientId: r.patient_id,
      patientCode: r.patient_code,
      patientName: r.full_name,
      phone: r.phone,
      followUpDate: r.due_date,
      returned: r.returned,
      sourceDate: r.source_date,
      doctorId: r.doctor_id,
    }));
  }

  /** Tên bác sĩ theo id (hiển thị `display_name` nếu có). */
  async doctorNames(tx: Prisma.TransactionClient, tenantId: string, ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await tx.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT id, COALESCE(display_name, full_name) AS name FROM user_account WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${ids as string[]}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Chẩn đoán chính (còn hiệu lực) của từng lượt khám — tên theo danh mục ICD-10 của Bộ Y tế. */
  async primaryDiagnosisNames(tx: Prisma.TransactionClient, tenantId: string, encounterIds: readonly string[]): Promise<Map<string, string>> {
    if (encounterIds.length === 0) return new Map();
    const rows = await tx.$queryRaw<Array<{ encounter_id: string; name: string }>>`
      SELECT DISTINCT ON (d.encounter_id) d.encounter_id, c.name_vi AS name
        FROM diagnosis d JOIN icd10_catalog c ON c.code = d.icd10_code
       WHERE d.tenant_id = ${tenantId}::uuid AND d.encounter_id = ANY(${encounterIds as string[]}::uuid[]) AND d.deleted_at IS NULL AND d.type = 'PRIMARY'
       ORDER BY d.encounter_id, d.created_at DESC`;
    return new Map(rows.map((r) => [r.encounter_id, r.name]));
  }

  /** Số lần nhắc và lần nhắc gần nhất của từng lượt khám. */
  async reminderStats(tx: Prisma.TransactionClient, tenantId: string, encounterIds: readonly string[]): Promise<Map<string, ReminderStats>> {
    const stats = new Map<string, ReminderStats>();
    if (encounterIds.length === 0) return stats;
    const rows = await tx.$queryRaw<Array<{ encounter_id: string; n: number; reminded_at: Date; result: FollowUpReminderResultKind; by_name: string; rn: number }>>`
      SELECT r.encounter_id, COUNT(*) OVER (PARTITION BY r.encounter_id)::int AS n, r.reminded_at, r.result, COALESCE(u.display_name, u.full_name) AS by_name,
             ROW_NUMBER() OVER (PARTITION BY r.encounter_id ORDER BY r.reminded_at DESC, r.id DESC)::int AS rn
        FROM follow_up_reminder r JOIN user_account u ON u.tenant_id = r.tenant_id AND u.id = r.created_by
       WHERE r.tenant_id = ${tenantId}::uuid AND r.encounter_id = ANY(${encounterIds as string[]}::uuid[]) AND r.deleted_at IS NULL`;
    for (const r of rows) {
      if (r.rn !== 1) continue;
      stats.set(r.encounter_id, { count: r.n, last: { remindedAt: r.reminded_at, result: r.result, byName: r.by_name } });
    }
    return stats;
  }

  /** Toàn bộ nhật ký nhắc của một lượt khám, mới nhất trước. */
  async listReminders(tx: Prisma.TransactionClient, tenantId: string, encounterId: string): Promise<ReminderRow[]> {
    const rows = await tx.$queryRaw<Array<{ id: string; result: FollowUpReminderResultKind; note: string | null; reminded_at: Date; by_name: string }>>`
      SELECT r.id, r.result, r.note, r.reminded_at, COALESCE(u.display_name, u.full_name) AS by_name
        FROM follow_up_reminder r JOIN user_account u ON u.tenant_id = r.tenant_id AND u.id = r.created_by
       WHERE r.tenant_id = ${tenantId}::uuid AND r.encounter_id = ${encounterId}::uuid AND r.deleted_at IS NULL
       ORDER BY r.reminded_at DESC, r.id DESC`;
    return rows.map((r) => ({ id: r.id, result: r.result, note: r.note, remindedAt: r.reminded_at, byName: r.by_name }));
  }

  /**
   * Lượt khám có hẹn tái khám hợp lệ trong chi nhánh (kể cả hẹn đã đánh dấu "không tái khám" — vẫn ghi thêm nhật ký được). `onlyDoctorId` áp phạm vi `personal`.
   * `false` → máy chủ trả 404 (lượt khám không tồn tại, thuộc chi nhánh khác, chưa có hẹn tái khám đã ký, hoặc ngoài phạm vi).
   */
  async hasFollowUp(tx: Prisma.TransactionClient, tenantId: string, branchId: string, encounterId: string, onlyDoctorId: string | null): Promise<boolean> {
    const doctorScope = onlyDoctorId ? Prisma.sql`AND e.doctor_id = ${onlyDoctorId}::uuid` : Prisma.empty;
    const rows = await tx.$queryRaw<Array<{ ok: number }>>`
      SELECT 1 AS ok FROM encounter_treatment_plan p JOIN encounter e ON e.tenant_id = p.tenant_id AND e.id = p.encounter_id
       WHERE p.tenant_id = ${tenantId}::uuid AND p.encounter_id = ${encounterId}::uuid AND p.deleted_at IS NULL AND p.signed_at IS NOT NULL
         AND 'FOLLOW_UP' = ANY(p.directions::text[]) AND p.follow_up_date IS NOT NULL
         AND e.branch_id = ${branchId}::uuid AND e.deleted_at IS NULL AND e.status = 'COMPLETED' ${doctorScope}
       LIMIT 1`;
    return rows.length > 0;
  }

  async createReminder(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    data: { encounterId: string; result: FollowUpReminderResultKind; note: string | null },
  ): Promise<{ id: string; remindedAt: Date }> {
    const row = await tx.followUpReminder.create({
      data: { tenantId, encounterId: data.encounterId, result: data.result, note: data.note, createdBy: actorId, updatedBy: actorId },
      select: { id: true, remindedAt: true },
    });
    return row;
  }
}
