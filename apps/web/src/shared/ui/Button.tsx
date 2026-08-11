import type { ButtonHTMLAttributes } from 'react';
import { CircleNotch } from '@phosphor-icons/react';

/**
 * Nút dùng chung — biến thể primary theo .claude/docs/ui-guidelines.md mục 2.1
 * (`bg-blue-600 hover:bg-blue-700 active:bg-blue-800`). Dùng ở ≥2 màn hình (login, form sau
 * này) nên đặt ở `shared/ui` theo .claude/docs/project-structure.md.
 */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
}

export function Button({ loading = false, disabled, children, className = '', ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 active:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {loading && <CircleNotch size={16} weight="bold" className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
