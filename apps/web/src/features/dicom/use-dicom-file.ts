import { useCallback, useEffect, useState } from 'react';
import { resolveApiUrl } from '../../shared/api/client';
import { compressionLabel, DicomDecodeError, openDicom, type DicomImage } from './dicom-decode';

export type DicomFileState =
  | { status: 'idle' }
  | { status: 'loading'; loaded: number; total: number | null }
  | { status: 'ready'; image: DicomImage }
  | { status: 'unsupported'; label: string }
  | { status: 'corrupt' }
  | { status: 'network' };

/**
 * Tải tệp DICOM qua đường dẫn ký (cùng nguồn gốc, đi qua nginx của máy chủ) kèm tiến độ rồi giải mã trong trình duyệt (docs/DECISIONS.md #299 bổ sung 6).
 * `enabled=false` (công tắc "Dùng tệp DICOM" tắt) thì không tải gì. Mất mạng/máy chủ lỗi → `network` (có `retry`); tệp nén chưa hỗ trợ → `unsupported`; tệp hỏng → `corrupt`.
 */
export function useDicomFile(url: string | null, enabled: boolean): { state: DicomFileState; retry: () => void } {
  const [state, setState] = useState<DicomFileState>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled || !url) {
      setState({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading', loaded: 0, total: null });
    (async () => {
      try {
        const response = await fetch(resolveApiUrl(url), { signal: controller.signal });
        if (!response.ok || !response.body) {
          setState({ status: 'network' });
          return;
        }
        const total = Number(response.headers.get('content-length')) || null;
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let loaded = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.length;
          setState({ status: 'loading', loaded, total });
        }
        const bytes = new Uint8Array(loaded);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        try {
          setState({ status: 'ready', image: openDicom(bytes) });
        } catch (err) {
          if (err instanceof DicomDecodeError && err.reason === 'unsupported') setState({ status: 'unsupported', label: compressionLabel(err.transferSyntax) });
          else setState({ status: 'corrupt' });
        }
      } catch {
        if (controller.signal.aborted) return;
        setState({ status: 'network' });
      }
    })();
    return () => controller.abort();
  }, [url, enabled, attempt]);

  return { state, retry };
}
