import { join, relative } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Lớp 2 chống giao dịch lồng nhau (docs/DECISIONS.md #264, #296): phân tích tĩnh bằng TRÌNH BIÊN DỊCH TypeScript, bổ
 * sung cho `nested-transaction-coverage.spec.ts` (dùng biểu thức chính quy, chỉ thấy lời gọi viết thẳng
 * `this.<tênTrường>.<hàm>()` trong thân `runInTenantScope`).
 *
 * Bản này đi theo ĐỒ THỊ LỜI GỌI: từ thân mỗi `runInTenantScope(...)` đi vào mọi hàm/phương thức của dự án mà thân nó gọi tới
 * (kể cả ở class/file khác, hàm tự do nhận `tx`) và báo vi phạm nếu ở bất kỳ độ sâu nào có:
 *  1. một lời gọi tới PORT "đắt" (adapter/service thực thi port tự mở `runInTenantScope` — mỗi lời gọi chiếm thêm một kết nối);
 *  2. một cuộc gọi `runInTenantScope` khác (giao dịch lồng giao dịch);
 *  3. một port "đắt" bị TRUYỀN đi làm đối số (hàm nhận có thể gọi nó trong giao dịch — ca `assertMonthWritable`, #296).
 * Nhận biết kiểu bằng bộ kiểm tra kiểu nên không phụ thuộc tên trường hay thư mục.
 *
 * Phủ cả mã mà test chạy-thật chưa gọi tới. Giới hạn: lời gọi động (hàm lấy từ biến/mảng rồi gọi) không theo được; lớp 1 (bộ
 * phát hiện lúc chạy, `transaction-scope.ts`) bù phần đó trên mọi đường test đã chạy.
 *
 * CÁCH SỬA khi test này đỏ: gọi port TRƯỚC khi mở transaction (hoặc SAU khi đóng) rồi truyền KẾT QUẢ vào. KHÔNG thêm ngoại lệ.
 */
const API_ROOT = join(__dirname, '..', '..');
const SRC = join(API_ROOT, 'src');
const MAX_DEPTH = 14;

interface Violation {
  /** `tệp:dòng` của chính lời gọi vi phạm. */
  at: string;
  what: string;
  /** Chuỗi hàm đi từ thân transaction tới chỗ vi phạm (ngoài cùng trước). */
  via: string[];
}

function loadProgram(): ts.Program {
  const cfg = ts.readConfigFile(join(API_ROOT, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, API_ROOT);
  const files = parsed.fileNames.filter((f) => !f.endsWith('.spec.ts') && !f.includes('node_modules'));
  return ts.createProgram(files, { ...parsed.options, noEmit: true, incremental: false, tsBuildInfoFile: undefined });
}

describe('không giao dịch lồng nhau — phân tích đồ thị lời gọi bằng AST (docs/DECISIONS.md #296)', () => {
  const program = loadProgram();
  const checker = program.getTypeChecker();
  const sources = program.getSourceFiles().filter((s) => !s.isDeclarationFile && s.fileName.replace(/\\/g, '/').includes('/apps/api/src/'));

  const rel = (node: ts.Node): string => {
    const sf = node.getSourceFile();
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    return `${relative(SRC, sf.fileName).replace(/\\/g, '/')}:${line + 1}`;
  };

  const typeSymbolOf = (node: ts.Node): ts.Symbol | undefined => {
    const t = checker.getNonNullableType(checker.getTypeAtLocation(node));
    return t.aliasSymbol ?? t.getSymbol();
  };

  /** Class (hoặc định danh) có chứa lời gọi `.runInTenantScope(` ở bất kỳ đâu trong thân → "tự mở transaction". */
  const containsOpener = (node: ts.Node): boolean => {
    let found = false;
    const walk = (n: ts.Node): void => {
      if (found) return;
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'runInTenantScope') {
        found = true;
        return;
      }
      ts.forEachChild(n, walk);
    };
    walk(node);
    return found;
  };

  // 1) Token PORT nào do lớp tự mở transaction thực thi (`provide: X_PORT, useClass|useExisting: Lớp`).
  const expensiveTokens = new Set<string>();
  for (const sf of sources) {
    const walk = (n: ts.Node): void => {
      if (ts.isObjectLiteralExpression(n)) {
        let token: string | null = null;
        let impl: ts.Expression | null = null;
        for (const p of n.properties) {
          if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
          if (p.name.text === 'provide' && ts.isIdentifier(p.initializer) && p.initializer.text.endsWith('_PORT')) token = p.initializer.text;
          if ((p.name.text === 'useClass' || p.name.text === 'useExisting') && ts.isIdentifier(p.initializer)) impl = p.initializer;
        }
        if (token && impl) {
          let implSymbol = checker.getSymbolAtLocation(impl);
          // Tên lớp được nhập từ tệp khác là ALIAS — phải theo alias tới khai báo thật của lớp.
          if (implSymbol && implSymbol.flags & ts.SymbolFlags.Alias) implSymbol = checker.getAliasedSymbol(implSymbol);
          const decl = implSymbol?.declarations?.find(ts.isClassDeclaration);
          if (decl && containsOpener(decl)) expensiveTokens.add(token);
        }
      }
      ts.forEachChild(n, walk);
    };
    walk(sf);
  }

  // 2) Kiểu (symbol) của các tham số/trường `@Inject(TOKEN)` với TOKEN "đắt".
  const expensiveTypes = new Map<ts.Symbol, string>();
  for (const sf of sources) {
    const walk = (n: ts.Node): void => {
      if (ts.isParameter(n) && ts.canHaveDecorators(n)) {
        for (const d of ts.getDecorators(n) ?? []) {
          if (!ts.isCallExpression(d.expression) || d.expression.expression.getText() !== 'Inject') continue;
          const arg = d.expression.arguments[0];
          if (arg && ts.isIdentifier(arg) && expensiveTokens.has(arg.text)) {
            const sym = typeSymbolOf(n);
            if (sym) expensiveTypes.set(sym, arg.text);
          }
        }
      }
      ts.forEachChild(n, walk);
    };
    walk(sf);
  }

  const memo = new Map<ts.Node, Violation[]>();
  const inProgress = new Set<ts.Node>();

  const declName = (decl: ts.Node): string => {
    const named = decl as ts.Node & { name?: ts.Node };
    const owner = decl.parent && ts.isClassLike(decl.parent) && decl.parent.name ? `${decl.parent.name.text}.` : '';
    return `${owner}${named.name ? named.name.getText() : '<hàm>'}`;
  };

  /** Mọi vi phạm tìm được TRONG `body` (kể cả qua các hàm nó gọi tới). */
  function scan(body: ts.Node, depth: number): Violation[] {
    const out: Violation[] = [];
    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        if (ts.isPropertyAccessExpression(callee)) {
          if (callee.name.text === 'runInTenantScope') {
            out.push({ at: rel(n), what: 'runInTenantScope() lồng trong một transaction đang mở', via: [] });
          } else {
            const recv = typeSymbolOf(callee.expression);
            const token = recv ? expensiveTypes.get(recv) : undefined;
            if (token) out.push({ at: rel(n), what: `${callee.expression.getText()}.${callee.name.text}() [${token}]`, via: [] });
          }
        }
        for (const arg of n.arguments) {
          if (ts.isFunctionLike(arg)) continue;
          const sym = typeSymbolOf(arg);
          const token = sym ? expensiveTypes.get(sym) : undefined;
          if (token) out.push({ at: rel(n), what: `${arg.getText()} [${token}] bị truyền đi làm đối số`, via: [] });
        }
        const decl = checker.getResolvedSignature(n)?.getDeclaration();
        if (decl && depth < MAX_DEPTH && 'body' in decl && (decl as ts.FunctionLikeDeclaration).body) {
          const file = decl.getSourceFile().fileName.replace(/\\/g, '/');
          const isProject = file.includes('/apps/api/src/') && !decl.getSourceFile().isDeclarationFile;
          // Không đi vào chính UnitOfWork (lời gọi tới nó đã được báo ở trên) và chỉ đi vào mã của dự án.
          if (isProject && !file.endsWith('/unit-of-work.service.ts')) {
            for (const v of summarize(decl, depth + 1)) out.push({ ...v, via: [declName(decl), ...v.via] });
          }
        }
      }
      ts.forEachChild(n, walk);
    };
    walk(body);
    return out;
  }

  function summarize(decl: ts.Node, depth: number): Violation[] {
    const cached = memo.get(decl);
    if (cached) return cached;
    if (inProgress.has(decl)) return [];
    inProgress.add(decl);
    const body = (decl as ts.FunctionLikeDeclaration).body;
    const result = body ? scan(body, depth) : [];
    inProgress.delete(decl);
    memo.set(decl, result);
    return result;
  }

  it('nhận ra đủ port "đắt" (không quét trượt làm test "xanh giả")', () => {
    expect(expensiveTokens.size).toBeGreaterThan(5);
    expect(expensiveTypes.size).toBeGreaterThan(5);
    expect(expensiveTokens.has('CASHIER_SHIFT_READER_PORT')).toBe(true);
    expect(expensiveTokens.has('CLINIC_CONFIG_READER_PORT')).toBe(true);
  });

  it('không có thân runInTenantScope nào, ở bất kỳ độ sâu lời gọi nào, chạm port đắt hoặc mở giao dịch lồng', { timeout: 180_000 }, () => {
    const violations = new Set<string>();
    let roots = 0;
    for (const sf of sources) {
      const walk = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'runInTenantScope') {
          roots += 1;
          const cb = [...n.arguments].reverse().find((a) => ts.isFunctionLike(a));
          if (cb) {
            for (const v of scan(cb, 0)) {
              const chain = v.via.length > 0 ? ` (qua ${v.via.join(' → ')})` : '';
              violations.add(`${v.at} — ${v.what}${chain} · giao dịch mở tại ${rel(n)}`);
            }
          }
        }
        ts.forEachChild(n, walk);
      };
      walk(sf);
    }
    expect(roots, 'quét trượt: không tìm thấy lời gọi runInTenantScope nào').toBeGreaterThan(100);
    expect(
      [...violations].sort(),
      `Port tự mở transaction (hoặc runInTenantScope khác) bị chạm từ BÊN TRONG một transaction → mỗi lần chiếm thêm 1 kết nối, cạn bể khi đồng thời.\nLấy dữ liệu qua port TRƯỚC khi mở transaction rồi truyền kết quả vào:\n`,
    ).toEqual([]);
  });
});
