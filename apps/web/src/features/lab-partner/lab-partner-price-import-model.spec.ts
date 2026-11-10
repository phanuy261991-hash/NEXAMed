import { describe, expect, it } from 'vitest';
import type { LabPartnerPriceImportChange } from '@nexamed/shared';
import { canWritePriceImport, priceImportWriteLabel, splitErrorReason, summarizePriceImport } from './lab-partner-price-import-model';

const change = (result: LabPartnerPriceImportChange['result']): LabPartnerPriceImportChange => ({
  rowNumber: 2,
  serviceName: 'HbA1c',
  partnerCode: 'DT0001',
  partnerName: 'Bình Minh',
  currentAmount: result === 'ADD' ? null : 150_000,
  newAmount: result === 'SAME' ? 150_000 : 155_000,
  result,
});

const error = { sheet: 'Giá trả đối tác', rowNumber: 5, name: 'X', reason: 'Cột "Tên dịch vụ": không có dịch vụ.' };

describe('summarizePriceImport', () => {
  it('đếm ô đổi/thêm là sẽ ghi; ô trống và ô trùng giá là giữ nguyên', () => {
    const t = summarizePriceImport({ changes: [change('CHANGE'), change('ADD'), change('SAME')], blankCellCount: 4, errorRows: [], defaultChangeCount: 1 });
    expect(t).toEqual({ writeCount: 2, keepCount: 5, errorCount: 0, defaultChangeCount: 1 });
  });

  it('file lỗi: số lỗi theo dòng lỗi', () => {
    expect(summarizePriceImport({ changes: [], blankCellCount: 0, errorRows: [error, error], defaultChangeCount: 0 }).errorCount).toBe(2);
  });
});

describe('canWritePriceImport + priceImportWriteLabel', () => {
  it('chỉ ghi được khi hết lỗi và có gì đó đổi', () => {
    expect(canWritePriceImport({ writeCount: 3, keepCount: 0, errorCount: 0, defaultChangeCount: 0 })).toBe(true);
    expect(canWritePriceImport({ writeCount: 0, keepCount: 9, errorCount: 0, defaultChangeCount: 1 })).toBe(true);
    expect(canWritePriceImport({ writeCount: 0, keepCount: 9, errorCount: 0, defaultChangeCount: 0 })).toBe(false);
    expect(canWritePriceImport({ writeCount: 3, keepCount: 0, errorCount: 1, defaultChangeCount: 0 })).toBe(false);
  });

  it('nhãn nút theo số giá; chỉ đổi mặc định thì "Ghi thay đổi"', () => {
    expect(priceImportWriteLabel({ writeCount: 11, keepCount: 0, errorCount: 0, defaultChangeCount: 0 })).toBe('Ghi 11 giá');
    expect(priceImportWriteLabel({ writeCount: 0, keepCount: 0, errorCount: 0, defaultChangeCount: 2 })).toBe('Ghi thay đổi');
  });
});

describe('splitErrorReason', () => {
  it('tách tên cột khỏi nội dung lỗi', () => {
    expect(splitErrorReason('Cột "Giá trả [DT0002]": "abc" không phải số.')).toEqual({ column: 'Giá trả [DT0002]', message: '"abc" không phải số.' });
  });

  it('lý do không theo dạng thì giữ nguyên, cột rỗng', () => {
    expect(splitErrorReason('Có lỗi khác')).toEqual({ column: '', message: 'Có lỗi khác' });
  });
});
