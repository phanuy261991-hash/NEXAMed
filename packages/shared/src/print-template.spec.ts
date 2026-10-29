import { describe, expect, it } from 'vitest';
import {
  PRINT_DOCUMENT_TYPE_REGISTRY,
  buildDefaultPrintTemplateConfig,
  buildResolvedPrintTemplate,
  deriveConfigForPaper,
  printDocumentTypeSchema,
  printTemplateConfigSchema,
  withDefaultPrintOptions,
  type PrintDocumentType,
  type PrintTemplateConfig,
} from './print-template';

/**
 * Chứng từ in được ở NHIỀU khổ giấy: khổ chưa có bản mẫu riêng dùng `deriveConfigForPaper(khổ, bản mặc định)`. Bản mặc định do phòng khám chỉnh (đầu trang, tiêu đề, chữ ký, số liên,
 * công tắc thông tin của đơn thuốc...) PHẢI áp cả khi in ra khổ khác — nếu một trường bị quên kế thừa, lựa chọn của phòng khám âm thầm quay về mặc định ở khổ đó (lỗi đã gặp với
 * `prescriptionInfo`, #242). Test này quét MỌI chứng từ × MỌI khổ giấy và chặn trường mới quên quyết định "kế thừa hay riêng từng khổ".
 */

/** Khoá cấu hình KẾ THỪA từ bản mặc định sang khổ khác. */
const INHERITED_KEYS = ['header', 'title', 'footer', 'notice', 'prescriptionInfo', 'insurance', 'medicineLabel', 'copies'] as const;
/** Khoá RIÊNG TỪNG KHỔ có chủ đích: lề theo khổ giấy; bộ tuỳ chọn tem theo cỡ tem ("Mỗi khổ tem có bộ tuỳ chọn riêng"). */
const PER_PAPER_KEYS = ['margins', 'label'] as const;

/** Cấu hình "người dùng đã chỉnh": MỌI công tắc đảo khác mặc định, mọi chuỗi có giá trị riêng — để trường nào không được kế thừa thì lộ ra ngay. */
function customised(documentType: PrintDocumentType): PrintTemplateConfig {
  const info = PRINT_DOCUMENT_TYPE_REGISTRY[documentType];
  const base = withDefaultPrintOptions(documentType, buildDefaultPrintTemplateConfig(info.defaultPaper));
  const flip = <T extends Record<string, boolean>>(o: T): T => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, !v])) as T;
  return {
    ...base,
    header: flip(base.header),
    title: { text: 'Tiêu đề tuỳ chỉnh' },
    footer: { note: 'Ghi chú tuỳ chỉnh', showSignature: !base.footer.showSignature, showSignatureHint: !base.footer.showSignatureHint },
    ...(base.notice ? { notice: { show: !base.notice.show, title: 'Khuyến cáo riêng', text: 'Nội dung riêng' } } : {}),
    ...(base.prescriptionInfo
      ? {
          prescriptionInfo: {
            ...(flip({ ...base.prescriptionInfo, nationalIdWhenMissing: false } as unknown as Record<string, boolean>) as unknown as typeof base.prescriptionInfo),
            nationalIdWhenMissing: 'dots' as const,
          },
        }
      : {}),
    ...(base.insurance ? { insurance: { show: !base.insurance.show, whenSelfPay: base.insurance.whenSelfPay === 'hide' ? ('selfPay' as const) : ('hide' as const) } } : {}),
    ...(base.medicineLabel ? { medicineLabel: flip(base.medicineLabel) } : {}),
    copies: { count: 3, labels: ['Liên A', 'Liên B', 'Liên C'] },
  };
}

describe('mọi trường cấu hình bản mẫu in đã được quyết định "kế thừa" hay "riêng từng khổ"', () => {
  it('schema không có khoá nào ngoài hai danh sách trên (thêm trường mới phải chọn một bên)', () => {
    const known = new Set<string>([...INHERITED_KEYS, ...PER_PAPER_KEYS]);
    const unknown = Object.keys(printTemplateConfigSchema.shape).filter((k) => !known.has(k));
    expect(unknown, `Trường mới ${unknown.join(', ')} cần được kế thừa ở deriveConfigForPaper (rồi thêm vào INHERITED_KEYS) hoặc ghi rõ là riêng từng khổ`).toEqual([]);
  });
});

describe('deriveConfigForPaper — khổ giấy khác khổ đã chỉnh vẫn áp lựa chọn của phòng khám', () => {
  for (const documentType of printDocumentTypeSchema.options) {
    const info = PRINT_DOCUMENT_TYPE_REGISTRY[documentType];
    const base = customised(documentType);
    for (const size of info.allowedPapers) {
      it(`${documentType} → ${size}`, () => {
        const derived = deriveConfigForPaper(size, base, info.defaultPaper);
        const roll = size === 'K80';
        for (const key of INHERITED_KEYS) {
          if (!(key in base)) {
            expect(derived[key], `${key} không có ở bản mặc định thì khổ ${size} cũng không có`).toBeUndefined();
            continue;
          }
          let expected: unknown = base[key];
          // Giấy cuộn K80 luôn không logo, không ô chữ ký (ràng buộc khổ giấy, không phải lựa chọn của phòng khám).
          if (roll && key === 'header') expected = { ...base.header, showLogo: false };
          if (roll && key === 'footer') expected = { ...base.footer, showSignature: false };
          expect(derived[key], `${key} ở khổ ${size}`).toEqual(expected);
        }
        // Khoá riêng từng khổ lấy theo mặc định CỦA KHỔ ĐÓ (không mang lề/tuỳ chọn tem của khổ khác sang).
        const defaults = buildDefaultPrintTemplateConfig(size);
        expect(derived.margins).toEqual(defaults.margins);
        expect(derived.label).toEqual(defaults.label);
      });
    }
  }
});

describe('bản mặc định là giấy cuộn K80', () => {
  it('"không logo, không chữ ký" là ràng buộc của giấy cuộn — KHÔNG mang sang khổ A4/A5 khi in ra khổ đó', () => {
    const k80 = buildDefaultPrintTemplateConfig('K80');
    expect(k80.footer.showSignature).toBe(false);
    for (const size of ['A4', 'A5'] as const) {
      const derived = deriveConfigForPaper(size, k80, 'K80');
      expect(derived.footer.showSignature, `chữ ký ở ${size}`).toBe(true);
      expect(derived.header.showLogo, `logo ở ${size}`).toBe(true);
    }
  });
});

describe('buildResolvedPrintTemplate — các lựa chọn khổ giấy của một chứng từ', () => {
  it('đơn thuốc: bản mặc định đã chỉnh công tắc → MỌI khổ trong options đều mang công tắc đó', () => {
    const base = customised('PRESCRIPTION');
    const resolved = buildResolvedPrintTemplate('PRESCRIPTION', 'A5', base);
    expect(resolved.options.length).toBeGreaterThan(1);
    for (const option of resolved.options) {
      expect(option.config.prescriptionInfo, `khổ ${option.paperSize}`).toEqual(base.prescriptionInfo);
      expect(option.config.footer.showSignature, `chữ ký ở khổ ${option.paperSize}`).toBe(base.footer.showSignature);
    }
  });

  it('khổ đã có bản mẫu riêng thì dùng ĐÚNG bản đó, không bị bản mặc định đè', () => {
    const base = customised('PRESCRIPTION');
    const a4Own = { ...buildDefaultPrintTemplateConfig('A4'), prescriptionInfo: { ...base.prescriptionInfo!, showPhone: !base.prescriptionInfo!.showPhone } };
    const resolved = buildResolvedPrintTemplate('PRESCRIPTION', 'A5', base, { A4: a4Own });
    expect(resolved.options.find((o) => o.paperSize === 'A4')!.config.prescriptionInfo!.showPhone).toBe(a4Own.prescriptionInfo.showPhone);
    expect(resolved.options.find((o) => o.paperSize === 'A5_LANDSCAPE')!.config.prescriptionInfo).toEqual(base.prescriptionInfo);
  });
});
