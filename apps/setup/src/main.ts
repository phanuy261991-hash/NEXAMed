/**
 * Điểm khởi động của container `nexamed-setup` (docs/DECISIONS.md #238). Cấu hình qua biến môi trường do script `nexamed-setup.cmd/.sh` truyền vào:
 *  - HOST_INSTALL_DIR  đường dẫn THẬT của thư mục cài đặt trên máy (Windows đã đổi sang `/c/Users/...`)
 *  - HOST_INSTALL_DIR_DISPLAY  cùng thư mục, dạng người dùng quen thấy (`C:\NEXAMed`) — chỉ để hiển thị
 *  - HOST_IPS          các IP của máy trong mạng (cách nhau dấu phẩy)
 *  - SETUP_VERSION     phiên bản gói
 *  - SETUP_IMAGE       tên ảnh của chính container này, dùng chạy container thăm dò
 *  - SETUP_KEY         mã kèm link (rỗng = không cần mã)
 *  - SETUP_PORT        cổng nghe trong container (mặc định 8090)
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DockerClient } from './lib/docker';
import { parseHostIps } from './lib/dns';
import { NodeShell } from './lib/shell';
import { createSetupServer } from './server';
import { SetupService } from './service';

const workDir = process.env.WORK_DIR ?? '/work';
const hostInstallDir = process.env.HOST_INSTALL_DIR ?? '';
if (!hostInstallDir) {
  console.error('Thiếu HOST_INSTALL_DIR. Hãy chạy trình cài đặt bằng lệnh nexamed-setup (nexamed-setup.cmd / nexamed-setup.sh), không chạy trực tiếp.');
  process.exit(1);
}

const docker = new DockerClient(new NodeShell(), { workDir, hostInstallDir, probeImage: process.env.SETUP_IMAGE ?? 'alpine' });
const service = new SetupService(
  {
    workDir,
    hostInstallDir,
    hostInstallDirDisplay: process.env.HOST_INSTALL_DIR_DISPLAY ?? hostInstallDir,
    hostIps: parseHostIps(process.env.HOST_IPS),
    setupVersion: process.env.SETUP_VERSION ?? '0.0.0',
  },
  docker,
);

// Khi chạy từ `dist/main.js`, giao diện nằm ở `dist/public`; chạy thẳng từ nguồn (phát triển) thì ở `public/`.
const publicDir = existsSync(join(__dirname, 'public')) ? join(__dirname, 'public') : join(__dirname, '..', 'public');
const port = Number(process.env.SETUP_PORT ?? 8090);
const key = process.env.SETUP_KEY ?? '';

const server = createSetupServer({
  service,
  publicDir,
  key,
  allowedHosts: parseHostIps(process.env.HOST_IPS).concat((process.env.SETUP_ALLOWED_HOSTS ?? '').split(',').filter(Boolean)),
  onFinish: () => {
    console.log('Hoàn tất. Trình cài đặt tự đóng.');
    server.close();
    process.exit(0);
  },
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Trình cài đặt NEXAMed sẵn sàng ở cổng ${port}.`);
});
