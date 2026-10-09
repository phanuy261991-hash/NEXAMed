/** Nối các nội dung mẫu đã chọn vào cuối lời dặn hiện có: ô trống thì điền thẳng, đã có chữ thì xuống dòng rồi nối thêm (docs/DECISIONS.md #222). */
export function appendAdviceTexts(current: string, texts: string[]): string {
  const added = texts.join('\n');
  return current.trim() === '' ? added : `${current.replace(/\s+$/, '')}\n${added}`;
}
