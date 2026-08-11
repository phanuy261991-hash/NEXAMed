import { createContext, useContext, type ReactNode } from 'react';
import type { AppConfig } from './config';

const AppConfigContext = createContext<AppConfig | null>(null);

export function AppConfigProvider({ config, children }: { config: AppConfig; children: ReactNode }) {
  return <AppConfigContext.Provider value={config}>{children}</AppConfigContext.Provider>;
}

/** Chỉ dùng bên trong cây component đã được `AppConfigProvider` bọc (sau khi `loadAppConfig` xong). */
export function useAppConfig(): AppConfig {
  const config = useContext(AppConfigContext);
  if (!config) {
    throw new Error('useAppConfig() gọi ngoài AppConfigProvider.');
  }
  return config;
}
