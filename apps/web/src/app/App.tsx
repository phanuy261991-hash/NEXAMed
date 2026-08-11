import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { AppBootstrap } from './AppBootstrap';
import { AppConfigProvider } from './AppConfigProvider';
import type { AppConfig } from './config';
import { router } from './router';

const queryClient = new QueryClient();

export function App({ config }: { config: AppConfig }) {
  return (
    <AppConfigProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <AppBootstrap />
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AppConfigProvider>
  );
}
