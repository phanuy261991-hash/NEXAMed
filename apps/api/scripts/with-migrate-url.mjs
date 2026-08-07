#!/usr/bin/env node
// Chạy Prisma CLI bằng MIGRATE_DATABASE_URL (role đặc quyền) thay vì DATABASE_URL (role app,
// không có quyền tạo bảng/role — xem prisma/migrations/*_tenant_context/migration.sql).
// Dùng: node scripts/with-migrate-url.mjs migrate deploy
import 'dotenv/config';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;

if (!url) {
  console.error('Thiếu MIGRATE_DATABASE_URL (và cả DATABASE_URL) — không biết kết nối DB nào để chạy migration.');
  process.exit(1);
}

const result = spawnSync('prisma', args, {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, DATABASE_URL: url },
});

process.exit(result.status ?? 1);