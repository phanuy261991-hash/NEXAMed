import { useEffect } from 'react';
import { useRouteError } from 'react-router-dom';
import { classifyAppError, logAppError } from '../errors/app-error';
import { AppErrorScreen } from './AppErrorScreen';

/**
 * `errorElement` của router (docs/DECISIONS.md #255) — thay màn lỗi mặc định của `react-router` ("Unexpected Application Error!" kèm thông điệp và
 * ngăn xếp thô). `embedded`: đặt cho nhóm route con trong `AppShell` để lỗi của MỘT trang chỉ thay vùng nội dung, thanh bên/thanh trên còn nguyên.
 */
export function RouteErrorScreen({ embedded = false }: { embedded?: boolean }) {
  const error = useRouteError();
  useEffect(() => {
    logAppError(error);
  }, [error]);
  return <AppErrorScreen kind={classifyAppError(error)} embedded={embedded} />;
}
