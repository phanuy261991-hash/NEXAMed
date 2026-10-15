// Sao chép giao diện tĩnh (public/) vào dist/public cạnh mã máy chủ đã biên dịch — ảnh Docker chỉ cần thư mục dist.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'dist'), { recursive: true });
cpSync(join(root, 'public'), join(root, 'dist', 'public'), { recursive: true });
console.log('Đã sao chép public/ vào dist/public');
