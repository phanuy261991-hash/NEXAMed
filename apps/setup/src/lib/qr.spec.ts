import { describe, expect, it } from 'vitest';
import { qrSvg } from './qr';

describe('qr', () => {
  it('sinh SVG hợp lệ', () => {
    const svg = qrSvg('otpauth://totp/NEXAMed:x?secret=ABC');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
  });
});
