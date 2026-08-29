import { describe, expect, it } from 'vitest';
import { formatAuditFieldValue, isHiddenAuditField, labelForAuditField } from './field-labels';

describe('labelForAuditField', () => {
  it('trả về nhãn tiếng Việt cho field đã biết, fallback nguyên văn cho field lạ', () => {
    expect(labelForAuditField('amount')).toBe('Số tiền');
    expect(labelForAuditField('unknownField')).toBe('unknownField');
  });
});

describe('isHiddenAuditField', () => {
  it('ẩn field kỹ thuật nội bộ, không ẩn field nghiệp vụ', () => {
    expect(isHiddenAuditField('tenantId')).toBe(true);
    expect(isHiddenAuditField('version')).toBe(true);
    expect(isHiddenAuditField('amount')).toBe(false);
  });
});

describe('formatAuditFieldValue', () => {
  it('định dạng đúng từng kiểu giá trị scalar', () => {
    expect(formatAuditFieldValue(null)).toBe('—');
    expect(formatAuditFieldValue(true)).toBe('Có');
    expect(formatAuditFieldValue(false)).toBe('Không');
    expect(formatAuditFieldValue(250000)).toBe('250.000');
  });

  it('dịch giá trị dạng mã đã biết (enum UPPER_SNAKE_CASE) sang tiếng Việt', () => {
    expect(formatAuditFieldValue('CASH')).toBe('Tiền mặt');
    expect(formatAuditFieldValue('REASON_FOR_VISIT')).toBe('Lý do khám');
  });

  it('chuỗi lạ (chưa biết) hiện nguyên văn', () => {
    expect(formatAuditFieldValue('Đau bụng 2 ngày')).toBe('Đau bụng 2 ngày');
  });
});
