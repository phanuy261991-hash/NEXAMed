/**
 * Kiểm tra tên miền đã trỏ về đúng máy này chưa trước khi bật HTTPS (docs/DECISIONS.md #238, câu 3A) — Caddy xin chứng chỉ thất bại nếu DNS chưa đúng,
 * và xin sai nhiều lần sẽ bị nhà cấp chứng chỉ khoá tạm. Hàm nhận bộ tra cứu DNS và bộ hỏi IP công khai từ ngoài để test không cần mạng.
 */
export interface DnsDeps {
  /** Các địa chỉ IPv4 của tên miền (rỗng nếu chưa trỏ). */
  resolve4: (domain: string) => Promise<string[]>;
  /** IP công khai của máy này nhìn từ Internet (null nếu không hỏi được). Dùng khi máy sau NAT/IP nổi của nhà cung cấp VPS. */
  publicIp: () => Promise<string | null>;
}

export type DnsCheck =
  | { status: 'ok'; resolved: string[]; matched: string }
  | { status: 'mismatch'; resolved: string[]; expected: string[] }
  | { status: 'unresolved'; resolved: [] };

export async function checkDomainPointsHere(domain: string, hostIps: string[], deps: DnsDeps): Promise<DnsCheck> {
  let resolved: string[] = [];
  try {
    resolved = await deps.resolve4(domain);
  } catch {
    resolved = [];
  }
  if (resolved.length === 0) return { status: 'unresolved', resolved: [] };
  const local = resolved.find((ip) => hostIps.includes(ip));
  if (local) return { status: 'ok', resolved, matched: local };
  const pub = await deps.publicIp().catch(() => null);
  if (pub && resolved.includes(pub)) return { status: 'ok', resolved, matched: pub };
  return { status: 'mismatch', resolved, expected: pub ? [pub, ...hostIps.filter((ip) => ip !== pub)] : hostIps };
}

/** Danh sách IP của máy từ biến `HOST_IPS` do script khởi động truyền vào (container Docker Desktop không thấy IP mạng LAN thật). */
export function parseHostIps(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[,\s]+/)
    .map((ip) => ip.trim())
    .filter((ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip));
}
