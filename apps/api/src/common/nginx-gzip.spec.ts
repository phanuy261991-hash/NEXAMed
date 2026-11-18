import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Nén gzip ở nginx của bản cài (docs/DECISIONS.md #303): đo 17/11/2026 cho thấy gói JS vào app 620 KB, danh mục phường/xã 263 KB, danh sách API vài chục–trăm KB đều đi KHÔNG nén
 * (nginx mặc định tắt gzip, API không tự nén). Test này chặn ai đó vô tình bỏ khối gzip khi sửa `nginx.conf`.
 */
describe('nginx.conf của bản cài on-prem bật nén gzip', () => {
  const nginx = readFileSync(resolve(__dirname, '../../../../deploy/on-prem/nginx.conf'), 'utf8');

  it('bật ở cấp server, có Vary và nén cả phản hồi proxy', () => {
    expect(nginx).toMatch(/^\s{4}gzip on;/m);
    expect(nginx).toMatch(/^\s{4}gzip_vary on;/m);
    expect(nginx).toMatch(/^\s{4}gzip_proxied any;/m);
    expect(nginx).toMatch(/^\s{4}gzip_min_length \d+;/m);
  });

  it('nén JS, CSS, JSON, SVG và KHÔNG nén ảnh/PDF/DICOM/zip (đã nén sẵn)', () => {
    const types = /^\s{4}gzip_types ([^;]+);/m.exec(nginx)?.[1] ?? '';
    for (const t of ['application/javascript', 'text/css', 'application/json', 'image/svg+xml']) expect(types).toContain(t);
    for (const t of ['image/png', 'image/jpeg', 'application/pdf', 'application/zip', 'application/dicom']) expect(types).not.toContain(t);
  });
});
