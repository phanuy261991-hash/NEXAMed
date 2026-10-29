#!/usr/bin/env node
/**
 * Vá file văn bản theo danh sách thay thế, AN TOÀN với kiểu xuống dòng và dấu `\`.
 *
 * Vì sao có: nhiều file của repo là CRLF (Windows) — vá bằng `sed`/here-doc/regex trong shell dễ làm hỏng xuống dòng hoặc nuốt dấu `\`
 * (bài học nhiều lần, xem `.claude/docs/coding-standards.md` mục "Vá file hàng loạt"). Công cụ này đọc danh sách thay thế từ MỘT FILE JSON
 * (không qua shell nên không có chuyện escape), khớp CHÍNH XÁC chuỗi (không regex), viết `old`/`new` bằng LF — công cụ tự đổi sang kiểu xuống dòng
 * của file đích (CRLF hay LF) và giữ nguyên BOM.
 *
 * Dùng:   node scripts/patch-file.mjs <edits.json> [--check]
 * edits.json:  [{ "file": "apps/x.ts", "old": "chuỗi cũ", "new": "chuỗi mới", "all": false }, ...]
 *   - `file`: đường dẫn tương đối so với thư mục hiện hành (hoặc tuyệt đối).
 *   - `old` phải xuất hiện ĐÚNG MỘT lần, trừ khi `"all": true` (thay mọi lần, tối thiểu một).
 *   - Mọi thay thế được kiểm TRƯỚC; một cái sai là KHÔNG ghi file nào. `--check` chỉ kiểm, không ghi.
 *
 * Dùng như thư viện:  import { patchText } from './patch-file.mjs'
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Kiểu xuống dòng chiếm đa số trong văn bản (CRLF nếu mọi/đa số dòng kết thúc bằng \r\n). */
export function detectEol(text) {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

function toEol(text, eol) {
  return text.replace(/\r\n/g, '\n').replace(/\n/g, eol);
}

function countOccurrences(haystack, needle) {
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) count += 1;
  return count;
}

/**
 * Áp một danh sách thay thế lên MỘT văn bản, trả về văn bản mới. Ném lỗi (không sửa gì) nếu `old` rỗng, không thấy, hoặc thấy nhiều hơn một lần mà không `all`.
 * @param {string} text
 * @param {{old: string, new: string, all?: boolean}[]} edits
 */
export function patchText(text, edits) {
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const body = bom ? text.slice(1) : text;
  const eol = detectEol(body);
  let result = body;
  edits.forEach((edit, index) => {
    const label = `thay thế #${index + 1}`;
    if (typeof edit.old !== 'string' || edit.old === '') throw new Error(`${label}: "old" rỗng.`);
    if (typeof edit.new !== 'string') throw new Error(`${label}: thiếu "new".`);
    const oldText = toEol(edit.old, eol);
    const newText = toEol(edit.new, eol);
    const found = countOccurrences(result, oldText);
    if (found === 0) throw new Error(`${label}: không tìm thấy chuỗi cần thay (kiểm lại khoảng trắng/dấu \\).`);
    if (found > 1 && edit.all !== true) throw new Error(`${label}: chuỗi xuất hiện ${found} lần — thêm ngữ cảnh để duy nhất, hoặc đặt "all": true.`);
    result = result.split(oldText).join(newText);
  });
  return bom + result;
}

function main(argv) {
  const args = argv.filter((a) => !a.startsWith('--'));
  const checkOnly = argv.includes('--check');
  if (args.length !== 1) {
    console.error('Dùng: node scripts/patch-file.mjs <edits.json> [--check]');
    return 2;
  }
  const edits = JSON.parse(readFileSync(resolve(args[0]), 'utf8'));
  if (!Array.isArray(edits) || edits.length === 0) {
    console.error('edits.json phải là mảng không rỗng.');
    return 2;
  }
  const byFile = new Map();
  for (const edit of edits) {
    if (typeof edit.file !== 'string' || edit.file === '') {
      console.error('Mỗi phần tử phải có "file".');
      return 2;
    }
    const path = resolve(edit.file);
    byFile.set(path, [...(byFile.get(path) ?? []), edit]);
  }
  const outputs = new Map();
  try {
    for (const [path, fileEdits] of byFile) outputs.set(path, patchText(readFileSync(path, 'utf8'), fileEdits));
  } catch (err) {
    console.error(`LỖI — không ghi file nào: ${err.message}`);
    return 1;
  }
  for (const [path, content] of outputs) {
    if (!checkOnly) writeFileSync(path, content);
    console.log(`${checkOnly ? 'OK (chỉ kiểm)' : 'Đã vá'}: ${path}`);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
