import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Dung lượng tệp gắn bệnh nhân của CÔNG TY (docs/DECISIONS.md #299 bổ sung 4, mockup màn 13) — chỉ SQL, mọi chi nhánh (tệp đi theo bệnh nhân). Dung lượng lấy từ cột `size_bytes` khi có;
 * ảnh thẻ BHYT, ảnh đại diện và ảnh thu nhỏ không lưu dung lượng nên chỉ trả KHOÁ LƯU để service đo bằng `StoragePort.sizeOf` SAU khi transaction đóng (#264).
 */
export interface UsageFromDatabase {
  /** Tệp tải tay (kể cả đã xoá mềm — tệp vẫn nằm trên đĩa). */
  uploads: { count: number; bytes: number };
  /** Ảnh/PDF của kết quả cận lâm sàng (PDF đối tác nằm chung ở đây), mỗi tệp gốc tính một lần. */
  results: { count: number; bytes: number };
  /** Tệp chưa biết dung lượng: `counted` = tính vào số tệp (ảnh thẻ, ảnh đại diện); ảnh thu nhỏ chỉ cộng byte. */
  unsized: { key: string; counted: boolean }[];
}

@Injectable()
export class PatientDocumentUsageRepository {
  async collect(tx: Prisma.TransactionClient, tenantId: string): Promise<UsageFromDatabase> {
    const uploaded = await tx.patientDocument.aggregate({
      where: { tenantId, sourceType: 'UPLOAD' },
      _count: { _all: true },
      _sum: { sizeBytes: true },
    });
    // Một tệp gốc có thể là ảnh của nhiều dịch vụ (PDF đối tác dùng chung) hoặc được sao sang bản đính chính: tính MỘT lần theo khoá lưu.
    const results = await tx.$queryRaw<{ files: number; bytes: bigint }[]>`
      SELECT COUNT(*)::int AS files, COALESCE(SUM(size_bytes), 0)::bigint AS bytes
      FROM (SELECT DISTINCT ON (storage_key) size_bytes FROM paraclinical_result_image WHERE tenant_id = ${tenantId}::uuid ORDER BY storage_key) t`;

    const [cards, photos, thumbs] = await Promise.all([
      tx.insuranceCard.findMany({ where: { tenantId }, select: { photoFrontKey: true, photoBackKey: true } }),
      tx.patient.findMany({ where: { tenantId, photoKey: { not: null } }, select: { photoKey: true } }),
      tx.patientDocument.findMany({ where: { tenantId, thumbKey: { not: null } }, select: { thumbKey: true } }),
    ]);
    const unsized: UsageFromDatabase['unsized'] = [];
    for (const c of cards) {
      if (c.photoFrontKey) unsized.push({ key: c.photoFrontKey, counted: true });
      if (c.photoBackKey) unsized.push({ key: c.photoBackKey, counted: true });
    }
    for (const p of photos) unsized.push({ key: p.photoKey as string, counted: true });
    for (const t of thumbs) unsized.push({ key: t.thumbKey as string, counted: false });

    return {
      uploads: { count: uploaded._count._all, bytes: uploaded._sum.sizeBytes ?? 0 },
      results: { count: results[0]?.files ?? 0, bytes: Number(results[0]?.bytes ?? 0n) },
      unsized,
    };
  }
}
