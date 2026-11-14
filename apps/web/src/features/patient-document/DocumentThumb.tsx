import { useState } from 'react';
import type { PatientDocumentKind } from '@nexamed/shared';
import { resolveApiUrl } from '../../shared/api/client';

/** Hình thu nhỏ của một tệp: ảnh thật, hoặc hình minh hoạ cho PDF/DICOM (và khi ảnh không tải được). Lấp đầy khung cha. */
export function DocumentThumb({ kind, url, category }: { kind: PatientDocumentKind; url?: string; category?: string }) {
  const [broken, setBroken] = useState(false);
  if (kind === 'image' && url && !broken) {
    return <img src={resolveApiUrl(url)} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />;
  }
  return <DocumentArt kind={kind} contract={category === 'CONTRACT'} />;
}

export function DocumentArt({ kind, contract = false }: { kind: PatientDocumentKind; contract?: boolean }) {
  if (kind === 'dicom') {
    return (
      <svg viewBox="0 0 160 110" preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden="true">
        <rect width="160" height="110" fill="#0d1623" />
        <ellipse cx="80" cy="55" rx="34" ry="40" fill="#2a3b52" />
        <ellipse cx="80" cy="55" rx="14" ry="18" fill="#0d1623" />
        <text x="80" y="102" textAnchor="middle" fontSize="11" fontWeight="600" fill="#8aa0ba">
          DICOM
        </text>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 160 110" preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden="true">
      <rect width="160" height="110" fill="#eef2f6" />
      <rect x="50" y="10" width="60" height="92" rx="3" fill="#fff" stroke="#cbd5e1" />
      {contract ? (
        <>
          <path d="M62 22h36" stroke="#334155" strokeWidth="4" />
          <path d="M58 38h44M58 46h44M58 54h44M58 62h30" stroke="#cbd5e1" strokeWidth="3" />
          <path d="M60 88q6-10 12 0t12 0" stroke="#2563eb" strokeWidth="2" fill="none" />
        </>
      ) : (
        <>
          <path d="M58 30h44M58 40h44M58 50h30M58 60h44M58 70h38" stroke="#cbd5e1" strokeWidth="3" />
          <rect x="58" y="16" width="22" height="9" rx="2" fill="#e11d48" />
        </>
      )}
    </svg>
  );
}
