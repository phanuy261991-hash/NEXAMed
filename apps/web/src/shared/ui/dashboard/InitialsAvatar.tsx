import { getInitials } from '../../format/initials';

const TONES = ['bg-blue-100 text-blue-700', 'bg-violet-100 text-violet-700', 'bg-pink-100 text-pink-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700'] as const;

/** Màu ổn định theo tên: cùng một người luôn cùng màu giữa các lần tải. */
export function avatarToneIndex(name: string): number {
  let sum = 0;
  for (const ch of name) sum += ch.codePointAt(0) ?? 0;
  return sum % TONES.length;
}

/** Ô tròn chữ cái đầu của họ và tên (trang Tổng quan, hướng B). Chỉ trang trí — tên đầy đủ luôn có chữ bên cạnh nên ẩn khỏi trình đọc màn hình. */
export function InitialsAvatar({ name }: { name: string }) {
  return (
    <span aria-hidden="true" className={`flex size-9 flex-none items-center justify-center rounded-full text-[13px] font-semibold ${TONES[avatarToneIndex(name)]}`}>
      {getInitials(name)}
    </span>
  );
}
