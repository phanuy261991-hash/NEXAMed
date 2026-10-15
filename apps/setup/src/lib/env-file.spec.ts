import { describe, expect, it } from 'vitest';
import { getEnvValue, parseEnv, setEnvValues } from './env-file';

describe('env-file', () => {
  it('đọc khoá, bỏ qua chú thích và dòng trống', () => {
    const map = parseEnv('# ghi chú\nA=1\n\nB = 2\nC=x=y\n');
    expect(map.get('A')).toBe('1');
    expect(map.get('C')).toBe('x=y');
    expect(getEnvValue('A=1', 'Z')).toBeUndefined();
  });
  it('đổi giá trị tại chỗ, giữ chú thích và thứ tự, thêm khoá mới ở cuối', () => {
    const out = setEnvValues('# chú thích\nA=1\nB=2\n', { B: '9', C: '3' });
    expect(out).toBe('# chú thích\nA=1\nB=9\n\nC=3\n');
  });
  it('giữ kiểu xuống dòng CRLF', () => {
    const out = setEnvValues('A=1\r\nB=2\r\n', { A: '5' });
    expect(out).toBe('A=5\r\nB=2\r\n');
  });
  it('file rỗng', () => {
    expect(setEnvValues('', { A: '1' })).toBe('A=1\n');
  });
  it('khoá trùng chỉ đổi dòng đầu và không nhân đôi', () => {
    const out = setEnvValues('A=1\nA=2\n', { A: '9' });
    expect(out.match(/^A=/gm)?.length).toBe(2);
    expect(out.startsWith('A=9')).toBe(true);
  });
});
