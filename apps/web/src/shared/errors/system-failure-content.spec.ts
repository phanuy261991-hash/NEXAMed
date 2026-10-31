import { describe, expect, it } from 'vitest';
import { SYSTEM_FAILURE_CONTENT } from './system-failure-content';

const KINDS = ['network', 'unavailable', 'server'] as const;

describe('SYSTEM_FAILURE_CONTENT — nội dung hộp báo lỗi hệ thống (#273)', () => {
  it('đủ cả ba loại lỗi, mỗi loại có tiêu đề, một câu dẫn và đúng ba dòng thông tin', () => {
    for (const kind of KINDS) {
      const c = SYSTEM_FAILURE_CONTENT[kind];
      expect(c.title.trim().length, kind).toBeGreaterThan(0);
      expect(c.lead.trim().length, kind).toBeGreaterThan(0);
      expect(c.items, kind).toHaveLength(3);
    }
  });

  it('lỗi tạm thời (mất mạng, máy chủ chưa bật) dùng tông cam, lỗi thật của hệ thống (5xx) dùng đỏ', () => {
    expect(SYSTEM_FAILURE_CONTENT.network.tone).toBe('amber');
    expect(SYSTEM_FAILURE_CONTENT.unavailable.tone).toBe('amber');
    expect(SYSTEM_FAILURE_CONTENT.server.tone).toBe('rose');
  });

  it('mọi loại đều nói đủ ba điều người dùng cần biết: việc vừa làm chưa rõ kết quả, bấm lại an toàn (#257), dữ liệu đã nhập còn nguyên', () => {
    for (const kind of KINDS) {
      const kinds = SYSTEM_FAILURE_CONTENT[kind].items.map((i) => i.kind);
      expect(kinds, kind).toEqual(['wait', 'safe', 'kept']);
    }
  });

  it('KHÔNG khẳng định "chưa thực hiện" khi mất kết nối (máy chủ có thể đã ghi xong, chỉ chưa kịp trả lời)', () => {
    for (const kind of ['network', 'unavailable'] as const) {
      const wait = SYSTEM_FAILURE_CONTENT[kind].items.find((i) => i.kind === 'wait')!;
      expect(wait.detail).toBe('Chưa rõ đã xong hay chưa');
      expect(JSON.stringify(SYSTEM_FAILURE_CONTENT[kind])).not.toMatch(/chưa (được )?thực hiện/i);
    }
  });

  it('không lộ mã lỗi, tiếng Anh kỹ thuật hay chữ "undefined" (ui-guidelines mục 17)', () => {
    for (const kind of KINDS) {
      expect(JSON.stringify(SYSTEM_FAILURE_CONTENT[kind]), kind).not.toMatch(/\b(500|502|503|504|ECONN\w*|NETWORK|undefined|null|error|failed|server)\b/i);
    }
  });
});
