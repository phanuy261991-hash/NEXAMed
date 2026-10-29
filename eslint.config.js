// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

const CORE_RESTRICTED_MESSAGE =
  'packages/core là logic nghiệp vụ thuần — không phụ thuộc framework/hạ tầng (xem .claude/docs/project-structure.md).';

/**
 * `apps/web` chỉ được phụ thuộc `@nexamed/shared` (type + Zod schema, ~123 kB), KHÔNG phụ thuộc
 * `@nexamed/core`. Lý do là HIỆU SUẤT, không phải kiến trúc: `packages/core` chứa dữ liệu seed
 * lớn (`icd10/data.ts` ~9.1 MB, `geo/data.ts` ~280 kB) phục vụ riêng tầng API — kéo vào web là
 * kéo theo rủi ro phình bundle của trình duyệt. Trước đây ranh giới này chỉ được giữ bằng quy
 * ước ngầm (`apps/web/package.json` không khai dependency) + comment, không có gì cưỡng chế.
 * Cần một hàm thuần đang nằm ở `core`? Chuyển hàm đó sang `packages/shared` (nếu thật sự dùng
 * chung cả hai phía) thay vì mở dependency này.
 */
const WEB_RESTRICTED_MESSAGE =
  'apps/web không được import @nexamed/core (kéo theo dữ liệu seed lớn vào bundle trình duyệt) — dùng @nexamed/shared, hoặc chuyển hàm thuần cần dùng chung sang packages/shared. Xem .claude/docs/coding-standards.md mục Hiệu suất.';

/**
 * `apps/web` chỉ được import KIỂU từ `@nexamed/shared` (bản dist của nó là CommonJS, Vite không gộp giá trị của nó vào bundle
 * trình duyệt ổn định — docs/handoffs/HANDOFF-NestJS11-DoTaiGhi-DanhSachTheoLo-2026-10-22-p2.md mục 4). Hằng/hàm giá trị cần ở web thì khai riêng
 * ở `apps/web/src` (hoặc chuyển phần thuần sang một gói ESM). File `*.spec.*` được miễn vì chạy trong Node.
 */
const WEB_SHARED_VALUE_IMPORT_MESSAGE =
  'apps/web chỉ được import KIỂU từ @nexamed/shared (dùng `import type { ... }` hoặc `import { type X }`): bản dist là CommonJS nên import giá trị sẽ hỏng/phình bundle. Cần hằng/hàm thì khai riêng trong apps/web/src.';

export default tseslint.config(
  {
    // scripts/ui-audit: công cụ kiểm giao diện chạy tay bằng Node + Playwright (không phải mã sản phẩm).
    ignores: ['**/dist/**', '**/.scripts-dist/**', '**/build/**', '**/node_modules/**', '**/coverage/**', 'scripts/ui-audit/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        // Node 26 (CLAUDE.md): API chuẩn có sẵn, scripts/dev-lan.mjs dùng để dò API.
        fetch: 'readonly',
        AbortSignal: 'readonly',
      },
    },
  },
  {
    // Giao diện tĩnh của trình cài đặt (apps/setup/public) chạy trong trình duyệt, không qua bộ dựng — khai các biến toàn cục của trình duyệt.
    // + apps/web/public: `boot-fallback.js` (khung báo lỗi tĩnh khi mã ứng dụng không tải được, docs/DECISIONS.md #255) cũng là JavaScript thuần chạy ở trình duyệt.
    files: ['apps/setup/public/**/*.js', 'apps/web/public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        MutationObserver: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        FileReader: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
  },
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@nestjs/*'], message: CORE_RESTRICTED_MESSAGE },
            { group: ['@prisma/*'], message: CORE_RESTRICTED_MESSAGE },
            { group: ['react', 'react-dom', 'react/*', 'react-dom/*'], message: CORE_RESTRICTED_MESSAGE },
            { group: ['axios', 'node-fetch', 'got'], message: CORE_RESTRICTED_MESSAGE },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'packages/core không được đọc process.env trực tiếp — nhận cấu hình qua tham số.' },
      ],
    },
  },
  {
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: ['@nexamed/core', '@nexamed/core/*'], message: WEB_RESTRICTED_MESSAGE }],
        },
      ],
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [{ group: ['@nexamed/shared', '@nexamed/shared/*'], allowTypeImports: true, message: WEB_SHARED_VALUE_IMPORT_MESSAGE }],
        },
      ],
      // Chỉ bật 2 rule cổ điển (đúng thứ mã nguồn đang có `eslint-disable-next-line` tham chiếu tới
      // — trước đây báo lỗi "Definition for rule ... was not found" vì plugin chưa từng cài/đăng
      // ký, 2026-08-26). KHÔNG bật cả bộ `recommended`/`recommended-latest` của plugin (v7 gộp
      // thêm nhiều rule hướng React Compiler — immutability/purity/set-state-in-render...) — chưa
      // rà soát tác động, ngoài phạm vi việc này.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Bản cài tại phòng khám chạy HTTP thường trong LAN → trình duyệt KHÔNG cấp `crypto.randomUUID` (chỉ có ở HTTPS/localhost). Đã làm hỏng Kê đơn/Đơn thuốc mẫu/Phát thuốc (docs/DECISIONS.md #257).
    // Mọi nơi dùng `generateUuid()` (`apps/web/src/shared/uuid.ts`, có đường dự phòng `getRandomValues`) hoặc `makeDraftId()` (key React của dòng nháp).
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    ignores: ['apps/web/src/shared/uuid.ts', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'crypto', property: 'randomUUID', message: 'Không gọi thẳng crypto.randomUUID (không có ở HTTP thường trong LAN). Dùng generateUuid() ở shared/uuid.ts hoặc makeDraftId() ở shared/make-draft-id.ts.' },
        { object: 'globalThis', property: 'crypto', message: 'Dùng generateUuid() ở shared/uuid.ts thay vì truy cập crypto trực tiếp.' },
      ],
    },
  },
  {
    // Test của web chạy trong Node (vitest), import giá trị từ bản dist CommonJS của shared được.
    files: ['apps/web/**/*.spec.ts', 'apps/web/**/*.spec.tsx'],
    rules: { '@typescript-eslint/no-restricted-imports': 'off' },
  },
  {
    // CHUẨN ĐỘ ĐẬM CHỮ (chủ dự án chốt 16/10/2026, .claude/docs/ui-guidelines.md mục 16): giao diện màn hình TỐI ĐA font-semibold (600) — ưu tiên nét chữ sắc, chữ quá đậm bị
    // "vỡ nét" nhất là tiếng Việt có dấu ở cỡ nhỏ. Phân cấp bằng cỡ chữ và màu, không bằng độ đậm. Bản in (chứng từ in, vd. chỉ số xét nghiệm vượt mức phải in đậm) được loại trừ.
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    ignores: ['**/*PrintView.tsx', 'apps/web/src/shared/print/PrintDocument.tsx', 'apps/web/src/features/print-template/PrintDocumentPreview.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/\\bfont-(bold|extrabold|black)\\b/]',
          message: 'Không dùng font-bold/extrabold/black — độ đậm tối đa là font-semibold (ui-guidelines mục 16). Cần nhấn mạnh hơn thì tăng cỡ chữ/đổi màu.',
        },
        {
          selector: 'TemplateElement[value.raw=/\\bfont-(bold|extrabold|black)\\b/]',
          message: 'Không dùng font-bold/extrabold/black — độ đậm tối đa là font-semibold (ui-guidelines mục 16).',
        },
        {
          selector: "JSXAttribute[name.name='fontWeight'] Literal[value>=700]",
          message: 'fontWeight tối đa 600 (ui-guidelines mục 16).',
        },
      ],
    },
  },
  eslintConfigPrettier,
);