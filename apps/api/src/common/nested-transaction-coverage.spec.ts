import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CHẶN lớp lỗi "gọi port tự mở transaction từ BÊN TRONG một transaction khác" (docs/DECISIONS.md #264).
 *
 * `UnitOfWorkService.runInTenantScope()` mở `prisma.$transaction` — chiếm MỘT kết nối Postgres suốt thân hàm.
 * Nhiều adapter của port (`PricingAdapter`, `DoctorDirectoryAdapter`...) cũng gọi `runInTenantScope` vì port chỉ
 * nhận `tenantId`. Gọi một port như vậy từ trong transaction → request chiếm 2 kết nối CÙNG LÚC; khi số request
 * đồng thời chạm cỡ bể kết nối thì mọi request đều giữ kết nối 1 và chờ kết nối 2 không bao giờ tới (bể kết nối
 * tự khoá nhau) → Prisma ném "Unable to start a transaction in the given time" → HTTP 500.
 *
 * Đã xảy ra THẬT 3 lần: #242 GĐ1 (tra mã cơ sở KCB lúc ký đơn), #244 (argon2 trong transaction), và #264
 * (`StockIssueService.create()` giữ `pg_advisory_xact_lock` rồi gọi `PRICING_PORT` — phát thuốc đồng thời ra 500).
 *
 * CÁCH SỬA khi test này đỏ: gọi port TRƯỚC khi mở transaction (hoặc SAU khi transaction đóng) rồi truyền kết quả
 * vào — xem `StockIssueService.create()` / `SupplierDebtService.listLedger()` làm mẫu. KHÔNG thêm ngoại lệ vào đây.
 */
const SRC = join(__dirname, '..');

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(p));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** Đoạn mã từ dấu `(` của `runInTenantScope(` tới dấu `)` cân bằng tương ứng. */
function balancedArgs(src: string, openParenIdx: number): string {
  let depth = 0;
  for (let i = openParenIdx; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(openParenIdx, i);
    }
  }
  return src.slice(openParenIdx);
}

describe('không gọi port tự-mở-transaction từ bên trong transaction (docs/DECISIONS.md #264)', () => {
  const files = listTsFiles(SRC);

  /** Adapter nào tự mở transaction → port nào "đắt" (mỗi lời gọi tốn thêm một kết nối). */
  const txAdapters = new Set<string>();
  for (const f of files) {
    if (!f.includes('infrastructure')) continue;
    const src = readFileSync(f, 'utf8');
    if (!src.includes('runInTenantScope')) continue;
    for (const m of src.matchAll(/export class (\w+)/g)) txAdapters.add(m[1]!);
  }

  const txTokens = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/provide:\s*([A-Z0-9_]+_PORT)\s*,[\s\S]{0,200}?useClass:\s*(\w+)/g)) {
      if (txAdapters.has(m[2]!)) txTokens.add(m[1]!);
    }
  }

  it('quét được số adapter/port đủ lớn (không quét trượt làm test "xanh giả")', () => {
    expect(txAdapters.size).toBeGreaterThan(5);
    expect(txTokens.size).toBeGreaterThan(5);
  });

  it('không file nào gọi port đắt bên trong thân runInTenantScope', () => {
    const violations: string[] = [];

    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (!src.includes('runInTenantScope')) continue;

      // Tên field của các port "đắt" trong service này.
      const watched: Array<[string, string]> = [];
      for (const m of src.matchAll(/@Inject\(([A-Z0-9_]+_PORT)\)\s*(?:private|public|protected)?\s*(?:readonly)?\s*(\w+)/g)) {
        if (txTokens.has(m[1]!)) watched.push([m[2]!, m[1]!]);
      }
      if (watched.length === 0) continue;

      // Hàm phụ nhận `tx` → thân nó CŨNG chạy trong transaction (lời gọi gián tiếp, đúng ca #264).
      const helpersWithTx = new Set<string>();
      for (const m of src.matchAll(/(?:private|public|protected)?\s*async\s+(\w+)\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?tx:\s*Prisma\.TransactionClient/g)) {
        helpersWithTx.add(m[1]!);
      }

      const scopes: Array<{ body: string; at: number }> = [];
      for (const m of src.matchAll(/runInTenantScope\s*\(/g)) {
        const open = m.index! + m[0].length - 1;
        scopes.push({ body: balancedArgs(src, open), at: open });
      }
      for (const name of helpersWithTx) {
        const re = new RegExp(`async\\s+${name}\\s*\\(`, 'g');
        for (const m of src.matchAll(re)) {
          // Bỏ qua danh sách tham số (cân bằng ngoặc tròn) rồi lấy thân hàm (cân bằng ngoặc nhọn).
          const sigOpen = m.index! + m[0].length - 1;
          const sigEnd = sigOpen + balancedArgs(src, sigOpen).length;
          const braceIdx = src.indexOf('{', sigEnd);
          if (braceIdx < 0) continue;
          let depth = 0;
          let end = src.length;
          for (let i = braceIdx; i < src.length; i += 1) {
            if (src[i] === '{') depth += 1;
            else if (src[i] === '}') {
              depth -= 1;
              if (depth === 0) { end = i; break; }
            }
          }
          scopes.push({ body: src.slice(braceIdx, end), at: braceIdx });
        }
      }

      for (const scope of scopes) {
        for (const [field, token] of watched) {
          const callRe = new RegExp(`this\\.${field}\\.(\\w+)\\s*\\(`, 'g');
          for (const call of scope.body.matchAll(callRe)) {
            const line = src.slice(0, scope.at + call.index!).split('\n').length;
            violations.push(`${relative(SRC, f).replace(/\\/g, '/')}:${line} — this.${field}.${call[1]}() [${token}]`);
          }
        }
      }
    }

    expect(
      [...new Set(violations)].sort(),
      `Port tự mở transaction bị gọi từ trong transaction (mỗi lời gọi chiếm thêm 1 kết nối → cạn bể khi đồng thời).\nĐưa lời gọi ra TRƯỚC khi mở transaction (hoặc SAU khi đóng) rồi truyền kết quả vào:\n`,
    ).toEqual([]);
  });
});
