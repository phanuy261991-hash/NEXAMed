import { describe, expect, it } from 'vitest';
import { appendAdviceTexts } from './advice-template.utils';

describe('appendAdviceTexts', () => {
  it('ô trống hoặc chỉ khoảng trắng thì điền thẳng', () => {
    expect(appendAdviceTexts('', ['A', 'B'])).toBe('A\nB');
    expect(appendAdviceTexts('  \n ', ['A'])).toBe('A');
  });
  it('đã có chữ thì xuống dòng rồi nối thêm, bỏ khoảng trắng thừa cuối ô', () => {
    expect(appendAdviceTexts('Giữ ấm.', ['Tái khám khi sốt.'])).toBe('Giữ ấm.\nTái khám khi sốt.');
    expect(appendAdviceTexts('Giữ ấm.\n\n', ['X', 'Y'])).toBe('Giữ ấm.\nX\nY');
  });
});
