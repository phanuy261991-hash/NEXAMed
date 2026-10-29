import type { Prisma, PrismaClient, ReferenceCatalogCategory } from '@prisma/client';
import {
  CATALOG_SEQUENCE_PREFIX,
  DOSAGE_FORM_ITEMS,
  DRUG_GROUP_ITEMS,
  DRUG_ROUTE_ITEMS,
  DRUG_USAGE_TIMING_ITEMS,
  EMPLOYMENT_STATUS_ITEMS,
  EMPLOYMENT_TYPE_ITEMS,
  ETHNICITY_ITEMS,
  formatShortSequentialCode,
  NATIONALITY_ITEMS,
  OCCUPATION_ITEMS,
  REFERENCE_CATALOG_SHORT_CODE_PREFIXES,
  stripVietnameseDiacritics,
  STORAGE_CONDITION_ITEMS,
  UNIT_SEED_ITEMS,
} from '@nexamed/core';
import { CodeSequenceRepository } from './code-sequence.repository';

const codeSequenceRepository = new CodeSequenceRepository();

type SeedClient = Prisma.TransactionClient | PrismaClient;

interface SourceItem {
  code: string;
  name: string;
  sortOrder: number;
  bytCode?: string | null;
  fullName?: string | null;
  description?: string | null;
  deactivatesAccount?: boolean;
}

/**
 * Chèn các dòng còn thiếu cho MỘT tenant — `ON CONFLICT DO NOTHING` theo (tenant_id, category, code), nên chạy lại bao nhiêu lần cũng
 * KHÔNG ghi đè tên/thứ tự/cờ ẩn mà `clinic_admin` của tenant đã chỉnh qua UI (danh mục riêng theo tenant từ docs/DECISIONS.md #230).
 */
async function insertMissing(client: SeedClient, rows: Prisma.ReferenceCatalogCreateManyInput[]): Promise<void> {
  if (rows.length === 0) return;
  await (client as Prisma.TransactionClient).referenceCatalog.createMany({ data: rows, skipDuplicates: true });
}

function fromSource(tenantId: string, actorId: string, category: ReferenceCatalogCategory, items: readonly SourceItem[]): Prisma.ReferenceCatalogCreateManyInput[] {
  return items.map((item) => ({
    tenantId,
    category,
    code: item.code,
    name: item.name,
    sortOrder: item.sortOrder,
    bytCode: item.bytCode ?? null,
    fullName: item.fullName ?? null,
    description: item.description ?? null,
    deactivatesAccount: item.deactivatesAccount ?? false,
    createdBy: actorId,
    updatedBy: actorId,
  }));
}

/** Từ viết tắt chẩn đoán nạp sẵn (docs/DECISIONS.md #206): `code` = từ viết tắt chuẩn hoá (chữ thường), `name` = cách viết đầy đủ. */
const ICD10_ABBREVIATION_SEED_ITEMS: readonly { code: string; name: string }[] = [
  { code: 'tha', name: 'tăng huyết áp' },
  { code: 'đtđ', name: 'đái tháo đường' },
  { code: 'dtd', name: 'đái tháo đường' },
  { code: 'type', name: 'típ' },
  { code: 'tip', name: 'típ' },
  { code: 'sxh', name: 'sốt xuất huyết' },
  { code: 'vpq', name: 'viêm phế quản' },
  { code: 'rlth', name: 'rối loạn tiêu hóa' },
  { code: 'nktn', name: 'nhiễm trùng tiết niệu' },
  { code: 'gerd', name: 'trào ngược dạ dày thực quản' },
  { code: 'cảm', name: 'viêm mũi họng cấp tính' },
];

/**
 * Dòng danh mục BẮT BUỘC cho hệ thống chạy — code nghiệp vụ tra theo MÃ (hình thức thanh toán CASH/BANK_TRANSFER/WALLET, loại thu chi
 * hệ thống cho Ví tạm ứng/Công nợ NCC) và từ điển viết tắt ICD-10. Trước #230 các dòng này do MIGRATION nạp vào bảng dùng chung; nay
 * mỗi tenant cần bản riêng nên nạp bằng code. Nhẹ (~17 dòng) — gọi cho MỌI tenant mới (kể cả tenant test) và backfill tenant cũ lúc API khởi động.
 * Idempotent, không ghi đè chỉnh sửa của tenant.
 */
export async function seedSystemReferenceDataForTenant(client: SeedClient, tenantId: string, actorId: string): Promise<void> {
  const base = { tenantId, createdBy: actorId, updatedBy: actorId } as const;
  await insertMissing(client, [
    { ...base, category: 'PAYMENT_METHOD', code: 'CASH', name: 'Tiền mặt', sortOrder: 0, countsAsCash: true },
    { ...base, category: 'PAYMENT_METHOD', code: 'BANK_TRANSFER', name: 'Chuyển khoản', sortOrder: 1, countsAsCash: false },
    { ...base, category: 'PAYMENT_METHOD', code: 'WALLET', name: 'Ví tạm ứng', sortOrder: 2, countsAsCash: false },
    // direction = NULL: ẩn khỏi form lập Phiếu thu/chi TAY (mã do hệ thống tự dùng).
    { ...base, category: 'INCOME_EXPENSE_TYPE', code: 'PATIENT_ADVANCE', name: 'Tạm ứng bệnh nhân', sortOrder: 0 },
    { ...base, category: 'INCOME_EXPENSE_TYPE', code: 'SUPPLIER_DEBT_PAYMENT', name: 'Thanh toán công nợ nhà cung cấp', sortOrder: 0 },
    { ...base, category: 'INCOME_EXPENSE_TYPE', code: 'SUPPLIER_REFUND', name: 'Nhà cung cấp hoàn tiền', sortOrder: 0 },
    ...ICD10_ABBREVIATION_SEED_ITEMS.map((item, index) => ({ ...base, category: 'ICD10_ABBREVIATION' as const, code: item.code, name: item.name, sortOrder: index })),
  ]);
}

/**
 * Nạp danh mục MẶC ĐỊNH đầy đủ cho MỘT tenant (Dân tộc, Quốc tịch, Nghề nghiệp, Trạng thái/Hình thức làm việc, 5 danh mục Kho Thuốc có
 * nguồn BYT, Đơn vị tính, Đơn vị kết quả xét nghiệm + dòng hệ thống ở trên). "Tạo nếu thiếu, không ghi đè" — admin của tenant sửa/ẩn
 * mục nào cũng không bị seed hồi sinh hay đè lại. Dùng khi tạo tenant thật (pilot/SaaS) và `db:seed` cho mọi tenant hiện có.
 */
export async function seedReferenceCatalogForTenant(client: SeedClient, tenantId: string, actorId: string): Promise<void> {
  await seedSystemReferenceDataForTenant(client, tenantId, actorId);

  await insertMissing(client, [
    ...fromSource(tenantId, actorId, 'ETHNICITY', ETHNICITY_ITEMS),
    ...fromSource(tenantId, actorId, 'NATIONALITY', NATIONALITY_ITEMS),
    ...fromSource(tenantId, actorId, 'EMPLOYMENT_STATUS', EMPLOYMENT_STATUS_ITEMS),
    ...fromSource(tenantId, actorId, 'EMPLOYMENT_TYPE', EMPLOYMENT_TYPE_ITEMS),
    ...fromSource(tenantId, actorId, 'OCCUPATION', OCCUPATION_ITEMS),
    // Kho Thuốc GĐ1 (#152/#153/#155) — nạp ĐẦY ĐỦ mọi cột của file nguồn.
    ...fromSource(tenantId, actorId, 'DRUG_GROUP', DRUG_GROUP_ITEMS),
    ...fromSource(tenantId, actorId, 'DRUG_ROUTE', DRUG_ROUTE_ITEMS),
    ...fromSource(tenantId, actorId, 'DOSAGE_FORM', DOSAGE_FORM_ITEMS),
    ...fromSource(tenantId, actorId, 'STORAGE_CONDITION', STORAGE_CONDITION_ITEMS),
    ...fromSource(tenantId, actorId, 'DRUG_USAGE_TIMING', DRUG_USAGE_TIMING_ITEMS),
  ]);

  await seedDefaultPriceType(client, tenantId, actorId);
  await seedUnits(client, tenantId, actorId);
  await seedLabResultUnits(client, tenantId, actorId);
  await seedTechServiceCategories(client, tenantId, actorId);
}

/**
 * Loại giá "Thường" làm mặc định (docs/DECISIONS.md #268) — CHỈ cho công ty CHƯA CÓ Loại giá nào (kể cả mục đã ẩn). KHÔNG hồi tố: công ty đang có sẵn
 * Loại giá thì không đánh dấu gì, vì tự chọn một mức (ví dụ VIP) làm mặc định sẽ khiến Tiếp nhận điền sẵn sai mức và thu sai tiền âm thầm.
 */
async function seedDefaultPriceType(client: SeedClient, tenantId: string, actorId: string): Promise<void> {
  const tx = client as Prisma.TransactionClient;
  if ((await tx.referenceCatalog.count({ where: { tenantId, category: 'PRICE_TYPE' } })) > 0) return;
  await insertMissing(client, [{ tenantId, category: 'PRICE_TYPE', code: 'THUONG', name: 'Thường', sortOrder: 0, isDefault: true, createdBy: actorId, updatedBy: actorId }]);
}

/**
 * Nạp theo TÊN (mã ngắn tuần tự tự sinh, #113): mục đã có cùng tên trong tenant được BỎ QUA, không ghi đè mô tả/thứ tự.
 * Bộ đếm mã nằm trong `code_sequence` của tenant (khoá `CATALOG:<tiền tố>`).
 */
async function seedByName(
  client: SeedClient,
  tenantId: string,
  actorId: string,
  category: 'UNIT' | 'LAB_RESULT_UNIT' | 'TECH_SERVICE_CATEGORY',
  items: readonly { name: string; description?: string | null; abbreviation?: string | null }[],
  /** Khoá so khớp tên với mục đã có (mặc định: tên đúng từng chữ). Nhóm dịch vụ dùng khoá bỏ dấu + không phân biệt hoa/thường để "Sinh hoá" khớp "Sinh hóa" đã do phòng khám tự đặt. */
  matchKey: (name: string) => string = (name) => name,
): Promise<void> {
  const prefix = REFERENCE_CATALOG_SHORT_CODE_PREFIXES[category];
  if (!prefix) {
    throw new Error(`REFERENCE_CATALOG_SHORT_CODE_PREFIXES.${category} không được cấu hình.`);
  }
  const tx = client as Prisma.TransactionClient;
  const existingNames = new Set((await tx.referenceCatalog.findMany({ where: { tenantId, category }, select: { name: true } })).map((r) => matchKey(r.name)));
  let sortOrder = 1;
  for (const item of items) {
    if (!existingNames.has(matchKey(item.name))) {
      const seq = await codeSequenceRepository.next(tx, tenantId, CATALOG_SEQUENCE_PREFIX + prefix, actorId);
      await tx.referenceCatalog.create({
        data: {
          tenantId,
          category,
          code: formatShortSequentialCode(prefix, seq),
          name: item.name,
          description: item.description ?? null,
          abbreviation: item.abbreviation ?? null,
          sortOrder,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
    }
    sortOrder += 1;
  }
}

/** "Đơn vị tính" (chủ dự án cung cấp `docs/data/don-vi-tinh.md`). */
function seedUnits(client: SeedClient, tenantId: string, actorId: string): Promise<void> {
  return seedByName(client, tenantId, actorId, 'UNIT', UNIT_SEED_ITEMS);
}

/** "Đơn vị kết quả xét nghiệm" (Cận lâm sàng GĐ2, #212) — đơn vị phổ biến nạp sẵn để chọn thay vì gõ tay (tránh "g/L"/"g/l"/"G/L" thành nhiều đơn vị). */
const LAB_RESULT_UNIT_SEED_NAMES = [
  'g/L', 'g/dL', 'mg/dL', 'mg/L', 'ng/mL', 'pg/mL', 'µg/dL', 'mmol/L', 'µmol/L', 'mEq/L',
  'U/L', 'IU/L', 'IU/mL', '%', '10^9/L', '10^12/L', 'fL', 'pg', 'mm/giờ', 'giây',
];

function seedLabResultUnits(client: SeedClient, tenantId: string, actorId: string): Promise<void> {
  return seedByName(client, tenantId, actorId, 'LAB_RESULT_UNIT', LAB_RESULT_UNIT_SEED_NAMES.map((name) => ({ name })));
}

/**
 * "Nhóm dịch vụ" kỹ thuật (Cận lâm sàng, docs/DECISIONS.md #265) — nạp sẵn vài nhóm phổ biến để ô "Nhóm dịch vụ" ở form Thêm dịch vụ không trống ngay từ đầu
 * (chủ dự án duyệt danh sách 27/10/2026). `abbreviation` (tối đa 4 ký tự) là chữ in trên tem mã vạch ống mẫu (#220). Nạp THEO TÊN, không phân biệt dấu/hoa-thường:
 * phòng khám đã tự tạo nhóm cùng tên (kể cả viết "Sinh hóa" thay vì "Sinh hoá") thì BỎ QUA — không tạo bản trùng, không đè viết tắt đã chỉnh.
 */
const TECH_SERVICE_CATEGORY_SEED_ITEMS: readonly { name: string; abbreviation: string }[] = [
  { name: 'Huyết học', abbreviation: 'HH' },
  { name: 'Sinh hoá', abbreviation: 'SH' },
  { name: 'Miễn dịch', abbreviation: 'MD' },
  { name: 'Nước tiểu', abbreviation: 'NT' },
  { name: 'Siêu âm', abbreviation: 'SA' },
  { name: 'X-quang', abbreviation: 'XQ' },
];

const normalizeCatalogName = (name: string): string => stripVietnameseDiacritics(name).toLowerCase().replace(/\s+/g, ' ').trim();

function seedTechServiceCategories(client: SeedClient, tenantId: string, actorId: string): Promise<void> {
  return seedByName(client, tenantId, actorId, 'TECH_SERVICE_CATEGORY', TECH_SERVICE_CATEGORY_SEED_ITEMS, normalizeCatalogName);
}
