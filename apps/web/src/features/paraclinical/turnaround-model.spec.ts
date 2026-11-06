import { describe, expect, it } from 'vitest';
import { convertTurnaroundText, MAX_TURNAROUND_MINUTES, parseTurnaround, splitTurnaround } from './turnaround-model';

describe('turnaround-model (#291)', () => {
  it('giá trị đã lưu: tròn giờ hiện theo giờ, còn lại theo phút, trống thì để trống', () => {
    expect(splitTurnaround(1440)).toEqual({ unit: 'hour', text: '24' });
    expect(splitTurnaround(120)).toEqual({ unit: 'hour', text: '2' });
    expect(splitTurnaround(90)).toEqual({ unit: 'minute', text: '90' });
    expect(splitTurnaround(45)).toEqual({ unit: 'minute', text: '45' });
    expect(splitTurnaround(null)).toEqual({ unit: 'minute', text: '' });
    expect(splitTurnaround(0)).toEqual({ unit: 'minute', text: '' });
  });

  it('theo phút: số nguyên dương, ô trống là chưa đặt', () => {
    expect(parseTurnaround('', 'minute')).toEqual({});
    expect(parseTurnaround('  ', 'hour')).toEqual({});
    expect(parseTurnaround('120', 'minute')).toEqual({ minutes: 120 });
    expect(parseTurnaround('0', 'minute').error).toBeTruthy();
    expect(parseTurnaround('1,5', 'minute').error).toBeTruthy();
    expect(parseTurnaround('-3', 'minute').error).toBeTruthy();
  });

  it('theo giờ: nhân 60, cho phép phần lẻ bằng dấu phẩy hoặc chấm, làm tròn về phút', () => {
    expect(parseTurnaround('24', 'hour')).toEqual({ minutes: 1440 });
    expect(parseTurnaround('1,5', 'hour')).toEqual({ minutes: 90 });
    expect(parseTurnaround('1.5', 'hour')).toEqual({ minutes: 90 });
    expect(parseTurnaround('0,25', 'hour')).toEqual({ minutes: 15 });
    expect(parseTurnaround('0', 'hour').error).toBeTruthy();
    expect(parseTurnaround('abc', 'hour').error).toBeTruthy();
    expect(parseTurnaround('1,555', 'hour').error).toBeTruthy();
  });

  it('chặn quá 30 ngày ở cả hai đơn vị; đúng 30 ngày hợp lệ', () => {
    expect(parseTurnaround(String(MAX_TURNAROUND_MINUTES), 'minute')).toEqual({ minutes: MAX_TURNAROUND_MINUTES });
    expect(parseTurnaround(String(MAX_TURNAROUND_MINUTES + 1), 'minute').error).toBeTruthy();
    expect(parseTurnaround('720', 'hour')).toEqual({ minutes: MAX_TURNAROUND_MINUTES });
    expect(parseTurnaround('721', 'hour').error).toBeTruthy();
  });

  it('đổi đơn vị giữ nguyên thời lượng thật; không đọc được thì xoá ô', () => {
    expect(convertTurnaroundText('24', 'hour', 'minute')).toBe('1440');
    expect(convertTurnaroundText('1440', 'minute', 'hour')).toBe('24');
    expect(convertTurnaroundText('90', 'minute', 'hour')).toBe('1,5');
    expect(convertTurnaroundText('100', 'minute', 'hour')).toBe('1,67');
    expect(convertTurnaroundText('abc', 'minute', 'hour')).toBe('');
    expect(convertTurnaroundText('7', 'hour', 'hour')).toBe('7');
  });
});
