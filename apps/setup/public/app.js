/* Giao diện trình cài đặt NEXAMed (vanilla JS, không phụ thuộc) — bám mockup đã duyệt, docs/DECISIONS.md #238.
 * Mọi dữ liệu người dùng nhập đều được MÁY CHỦ kiểm tra lại; trang này chỉ hiển thị và gom câu trả lời. */
(function () {
  'use strict';

  var INSTALL_LABEL = { check: 'Kiểm tra máy', profile: 'Kiểu triển khai', info: 'Thông tin', backup: 'Sao lưu', review: 'Xem lại', progress: 'Đang cài', otp: 'Kích hoạt OTP', done: 'Hoàn tất' };
  var UPGRADE_LABEL = { check: 'Kiểm tra máy', current: 'Bản đang chạy', progress: 'Đang nâng cấp', done: 'Hoàn tất' };
  var PROFILES = {
    lan: { name: 'Tại phòng khám', sub: 'Máy tại cơ sở (PC Windows, máy chủ, NAS)', badge: ['Phổ biến nhất', ''], bullets: ['Nhân viên vào bằng địa chỉ IP trong mạng nội bộ', 'Dữ liệu nằm hoàn toàn tại cơ sở', 'Không cần Internet để dùng'] },
    vps: { name: 'VPS riêng của khách', sub: 'Có tên miền, tự bật HTTPS', badge: ['Có HTTPS', 'alt'], bullets: ['Truy cập qua Internet bằng tên miền riêng', 'Tự xin và gia hạn chứng chỉ HTTPS', 'Một phòng khám hoặc chuỗi chi nhánh'] },
    saas: { name: 'Hệ thống SaaS', sub: 'Nhiều công ty, mỗi công ty một tên miền phụ', badge: ['Nhà cung cấp', 'amber'], bullets: ['Một hệ thống phục vụ nhiều công ty', 'Có khu quản trị cho người vận hành', 'Dành cho nhà cung cấp, không phải phòng khám'] },
  };
  var INFO_FIELDS = ['lanAddress', 'webPort', 'clinicName', 'adminFullName', 'adminUsername', 'domain', 'acmeEmail', 'operatorFullName', 'operatorUsername', 'operatorPassword', 'operatorPasswordConfirm', 'certificate'];
  var BACKUP_FIELDS = ['backupDir', 'backupHourVn', 'backupRetentionDays'];

  var S = {
    detect: null, scene: 'install', step: 'check', profile: 'lan',
    a: { backupHourVn: 2, backupRetentionDays: 14, webPort: 80, lanAddress: '' },
    pre: null, errors: {}, extra: [], password: null, cert: null, review: null, job: null, result: null, otp: null,
    ack: false, ackKey: false, keyDownloaded: false, busy: false, error: null, closed: false, skipDns: false, timer: null,
  };

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  function api(path, body) {
    var opts = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
    return fetch('/api' + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok) { var e = new Error((json.error && json.error.message) || 'Có lỗi xảy ra.'); e.details = json.error && json.error.details; e.status = res.status; throw e; }
        return json.data;
      });
    });
  }

  function stepIds() {
    if (S.scene === 'upgrade') return ['check', 'current', 'progress', 'done'];
    return ['check', 'profile', 'info', 'backup', 'review', 'progress'].concat(S.profile === 'saas' ? ['otp'] : [], ['done']);
  }
  function labelOf(id) { return (S.scene === 'upgrade' ? UPGRADE_LABEL : INSTALL_LABEL)[id]; }

  /* ---------- Thành phần nhỏ ---------- */
  function check(kind, title, sub, val) {
    var mark = { ok: '✓', bad: '!', warn: '!', run: '…', wait: '' }[kind];
    return '<div class="check"><span class="ic ' + kind + '">' + mark + '</span><div><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></div><span class="val">' + esc(val || '') + '</span></div>';
  }
  function rowsHtml(rows) {
    return '<div class="checks">' + rows.map(function (r) { return check(r.status, r.title, r.detail, r.value); }).join('') + '</div>';
  }
  function fixHtml(rows) {
    var bad = (rows || []).filter(function (r) { return r.status === 'bad' && r.fix; });
    return bad.map(function (r) { return '<div class="err"><span>' + esc(r.title) + ': ' + esc(r.detail) + '</span><ol>' + r.fix.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ol></div>'; }).join('');
  }
  function field(key, label, value, opts) {
    opts = opts || {};
    var err = S.errors[key];
    var hint = err ? '<span class="hint bad">' + esc(err) + '</span>' : (opts.hint ? '<span class="hint">' + esc(opts.hint) + '</span>' : '');
    return '<div class="field' + (opts.span ? ' span2' : '') + '"><label for="f_' + key + '">' + esc(label) + ' <span class="req">*</span></label>' +
      '<input class="input' + (err ? ' invalid' : '') + '" id="f_' + key + '" data-k="' + key + '" type="' + (opts.type || 'text') + '" value="' + esc(value) + '"' + (opts.autocomplete ? ' autocomplete="' + opts.autocomplete + '"' : ' autocomplete="off"') + (opts.inputmode ? ' inputmode="' + opts.inputmode + '"' : '') + '>' + (opts.after || '') + hint + '</div>';
  }
  function errBox(text) { return text ? '<div class="err"><span>' + esc(text) + '</span></div>' : ''; }
  function copyButton(text, label) { return '<button class="btn" type="button" data-copy="' + esc(text) + '">' + (label || 'Sao chép') + '</button>'; }

  /* ---------- Các màn hình ---------- */
  function viewCheck() {
    var up = S.scene === 'upgrade';
    var head = '<div><h2>' + (up ? 'Nâng cấp NEXAMed' : 'Chào mừng, hãy kiểm tra máy trước khi cài') + '</h2><p class="lead">' +
      (up ? 'Trình cài đặt tìm thấy một hệ thống NEXAMed trên máy này và sẽ nâng cấp mà không mất dữ liệu.' : 'Mất khoảng 5 phút. Bạn không cần biết lệnh nào, chỉ cần bấm chọn.') + '</p></div>';
    // Lần cài trước dở dang (đã ghi cấu hình nhưng chưa tạo xong phòng khám): nói rõ để người cài không tưởng là cài mới hoàn toàn.
    if (S.detect && S.detect.incompleteInstall) head += '<div class="done-box" style="margin-top:14px"><b>Lần cài trước chưa xong.</b><span>Nhập lại thông tin để cài tiếp. Mật khẩu và khoá hệ thống đã sinh được giữ nguyên, dữ liệu không bị mất.</span></div>';
    if (!S.pre) return head + '<div class="checks">' + check('run', 'Đang kiểm tra máy…', 'Vui lòng chờ vài giây', '') + '</div>';
    return head + rowsHtml(S.pre) + fixHtml(S.pre);
  }

  function viewProfile() {
    var cards = ['lan', 'vps', 'saas'].map(function (k) {
      var p = PROFILES[k];
      return '<button class="card" type="button" role="radio" aria-checked="' + (S.profile === k) + '" data-profile="' + k + '"><span class="badge ' + p.badge[1] + '">' + p.badge[0] + '</span><h3>' + p.name + '</h3><p>' + p.sub + '</p><ul>' + p.bullets.map(function (b) { return '<li>' + b + '</li>'; }).join('') + '</ul></button>';
    }).join('');
    return '<div><h2>Bạn muốn triển khai theo kiểu nào?</h2><p class="lead">Chọn một kiểu. Các bước sau tự đổi theo lựa chọn, không phải cài mỗi kiểu một cách khác nhau.</p></div><div class="cards" role="radiogroup" aria-label="Kiểu triển khai">' + cards + '</div>';
  }

  function viewInfo() {
    var p = S.profile, a = S.a, h = '<div><h2>Thông tin ' + (p === 'saas' ? 'hệ thống và người vận hành' : 'phòng khám') + '</h2></div>';
    var rows = S.extra.length ? rowsHtml(S.extra) : '';
    if (p === 'lan') {
      var ips = (S.detect.hostIps || []).slice();
      var options = ips.map(function (ip) {
        return '<label class="radio"><input type="radio" name="addr" value="' + ip + '"' + (a.lanAddress === ip ? ' checked' : '') + '><span><b>http://' + ip + '</b><br><span class="hint">Nhân viên cùng mạng nội bộ vào được bằng địa chỉ này. Nên đặt IP cố định cho máy này.</span></span></label>';
      }).join('') + '<label class="radio"><input type="radio" name="addr" value="localhost"' + (a.lanAddress === 'localhost' ? ' checked' : '') + '><span><b>Chỉ trên máy này (http://localhost)</b><br><span class="hint">Dùng khi chỉ một máy tính sử dụng.</span></span></label>';
      h += '<div class="box"><span class="t">Phòng khám</span><div class="grid2">' + field('clinicName', 'Tên phòng khám', a.clinicName, { span: true }) + field('adminFullName', 'Họ tên quản trị viên', a.adminFullName) + field('adminUsername', 'Tên đăng nhập', a.adminUsername, { hint: 'Mật khẩu tạm được tạo tự động ở cuối.' }) + '</div></div>' +
        '<div class="box"><span class="t">Nhân viên truy cập bằng địa chỉ nào?</span><div class="radios">' + options + '</div>' + '<details class="guide"><summary>Router không giữ được IP cố định cho máy này? Xem hướng dẫn</summary>' +
        '<p>Ứng dụng vẫn chạy khi IP đổi, chỉ là nhân viên phải mở địa chỉ IP mới. Để IP không đổi, đặt IP tĩnh ngay trên máy này:</p>' +
        '<ol><li><b>Tìm router:</b> mở Command Prompt (Windows, gõ cmd), gõ <code>ipconfig</code>, xem dòng <b>Default Gateway</b> (ví dụ 192.168.1.1).</li>' +
        '<li><b>Xem dải DHCP:</b> mở trình duyệt vào địa chỉ đó, đăng nhập (mật khẩu thường ở tem dưới đáy router), vào mục <b>LAN</b> hoặc <b>DHCP Server</b>, đọc hai ô <b>Start IP</b> và <b>End IP</b> (ví dụ 192.168.1.100 đến 192.168.1.200).</li>' +
        '<li><b>Chọn IP nằm ngoài dải đó,</b> cùng ba số đầu với router (ví dụ 192.168.1.50). Không vào được router thì chọn số cuối dải như 192.168.1.250 và gõ <code>ping 192.168.1.250</code>: báo Request timed out hoặc Destination host unreachable là chưa ai dùng.</li>' +
        '<li><b>Đặt trên Windows:</b> Settings, Network &amp; Internet, Ethernet (hoặc Wi-Fi), IP assignment, Edit, chọn Manual, bật IPv4. Điền IP đã chọn, Subnet mask 255.255.255.0, Gateway là địa chỉ router, DNS 8.8.8.8, rồi Save.</li></ol></details>' + (S.errors.lanAddress ? '<span class="hint bad">' + esc(S.errors.lanAddress) + '</span>' : '') +
        '<div class="grid2" style="margin-top:12px">' + field('webPort', 'Cổng truy cập', a.webPort, { inputmode: 'numeric', hint: a.webPort === 80 ? 'Cổng 80: nhân viên không cần gõ số cổng.' : 'Nhân viên gõ thêm :' + a.webPort + ' sau địa chỉ.' }) + '</div></div>';
    } else if (p === 'vps') {
      h += '<div class="box"><span class="t">Tên miền và HTTPS</span><div class="grid2">' + field('domain', 'Tên miền', a.domain, { hint: 'Đã trỏ về địa chỉ IP của VPS này.' }) + field('acmeEmail', 'Email nhận thông báo chứng chỉ', a.acmeEmail, { hint: 'Nhà cấp chứng chỉ gửi nhắc khi sắp hết hạn.', autocomplete: 'email' }) + (rows ? '<div class="span2">' + rows + '</div>' : '') + '</div></div>' +
        '<div class="box"><span class="t">Phòng khám</span><div class="grid2">' + field('clinicName', 'Tên phòng khám', a.clinicName, { span: true }) + field('adminFullName', 'Họ tên quản trị viên', a.adminFullName) + field('adminUsername', 'Tên đăng nhập', a.adminUsername) + '</div></div>' +
        (S.dnsFailed ? '<label class="check2"><input type="checkbox" id="skipDns"' + (S.skipDns ? ' checked' : '') + '><span>Tôi biết tên miền chưa trỏ đúng, vẫn tiếp tục (Caddy sẽ không xin được chứng chỉ cho tới khi DNS đúng).</span></label>' : '');
    } else {
      var certHtml = S.cert ? (S.cert.ok ? check('ok', 'Chứng chỉ hợp lệ', 'Bao ' + (S.cert.names || []).join(', ') + '. Hiệu lực đến ' + new Date(S.cert.validTo).toLocaleDateString('vi-VN') + '.', '✓') : '<div class="err"><span>Chứng chỉ chưa dùng được</span><ol>' + S.cert.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ol></div>') : '';
      h += '<div class="box"><span class="t">Tên miền hệ thống</span><div class="grid2">' + field('domain', 'Tên miền gốc', a.domain, { span: true, hint: 'Công ty khách dùng saomai.<tên miền gốc>; khu quản trị ở admin.<tên miền gốc>.' }) +
        '<div class="field"><label for="crtFile">Chứng chỉ (.crt / .pem) <span class="req">*</span></label><input class="input" id="crtFile" type="file" accept=".crt,.pem,.cer"></div>' +
        '<div class="field"><label for="keyFile">Khoá riêng (.key) <span class="req">*</span></label><input class="input" id="keyFile" type="file" accept=".key,.pem"></div>' +
        '<div class="span2">' + (S.errors.certificate ? '<span class="hint bad">' + esc(S.errors.certificate) + '</span>' : '<span class="hint">Chứng chỉ HTTPS wildcard (*.tên-miền-gốc) và chính tên miền gốc, khoá riêng không đặt mật khẩu.</span>') + certHtml + '</div></div></div>' +
        '<div class="box"><span class="t">Tài khoản người vận hành (chỉ bạn)</span><div class="grid2">' + field('operatorFullName', 'Họ tên', a.operatorFullName) + field('operatorUsername', 'Tên đăng nhập', a.operatorUsername) +
        field('operatorPassword', 'Mật khẩu', a.operatorPassword, { type: 'password', autocomplete: 'new-password', after: '<div class="meter" aria-label="Độ mạnh mật khẩu"><i id="pwMeter" style="width:' + (S.password ? (S.password.score + 1) * 20 : 0) + '%"></i></div>', hint: S.password ? S.password.hint : 'Tối thiểu 12 ký tự, nên có chữ hoa, số, ký hiệu.' }) +
        field('operatorPasswordConfirm', 'Nhập lại mật khẩu', a.operatorPasswordConfirm, { type: 'password', autocomplete: 'new-password' }) +
        '<div class="span2 alert">Bước kế tiếp sau khi cài: quét mã QR bằng ứng dụng xác thực trên điện thoại và nhập thử một mã. Khu quản trị yêu cầu cả mật khẩu và mã OTP, nên không ai khác vào được.</div></div></div>';
    }
    return h + (S.extra.length && p === 'lan' ? rows : '') + errBox(S.error);
  }

  function viewBackup() {
    var a = S.a, c = S.backupRow;
    return '<div><h2>Nơi lưu bản sao lưu</h2><p class="lead">Hệ thống tự sao lưu mỗi ngày. Bản sao nên nằm ở ổ khác với dữ liệu chính để không mất cả hai khi hỏng ổ.</p></div>' +
      '<div class="box"><span class="t">Sao lưu hằng ngày</span><div class="grid2">' + field('backupDir', 'Thư mục lưu bản sao', a.backupDir, { span: true }) +
      field('backupHourVn', 'Giờ chạy (giờ Việt Nam, 0-23)', a.backupHourVn, { inputmode: 'numeric' }) + field('backupRetentionDays', 'Giữ bản sao trong (ngày)', a.backupRetentionDays, { inputmode: 'numeric' }) + '</div></div>' +
      (c ? rowsHtml([c]) : '') + errBox(S.error);
  }

  function viewReview() {
    if (!S.review) return '<div class="checks">' + check('run', 'Đang tổng hợp…', '', '') + '</div>';
    return '<div><h2>Xem lại trước khi cài</h2><p class="lead">Kiểm tra lần cuối. Bấm "Cài đặt" để bắt đầu; không có gì bị ghi trước đó.</p></div><div class="tbl"><table class="sum"><tbody>' +
      S.review.summary.map(function (r) { return '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</tbody></table></div>' + errBox(S.error);
  }

  function viewProgress() {
    var up = S.scene === 'upgrade', job = S.job;
    var title = job && job.kind === 'rollback' ? 'Đang quay lui, vui lòng không tắt máy' : (up ? 'Đang nâng cấp, vui lòng không tắt máy' : 'Đang cài đặt, vui lòng không tắt máy');
    if (!job) return '<div><h2>' + title + '</h2></div>';
    var steps = job.steps.map(function (s) {
      var kind = s.status === 'ok' ? 'ok' : s.status === 'run' ? 'run' : s.status === 'bad' ? 'bad' : 'wait';
      var val = s.status === 'ok' ? (s.note || 'xong') : s.status === 'run' ? 'đang chạy' : s.status === 'bad' ? 'lỗi' : '';
      return check(kind, s.title, s.detail, val);
    }).join('');
    return '<div><h2>' + title + '</h2></div><div class="progress" role="progressbar" aria-valuenow="' + job.percent + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + job.percent + '%"></i></div><div class="checks">' + steps + '</div>' +
      (job.error ? '<div class="err"><span>' + esc(job.error) + '</span></div>' : '') + (job.log.length ? '<div class="logbox" id="logbox">' + esc(job.log.slice(-40).join('\n')) + '</div>' : '');
  }

  function viewCurrent() {
    var d = S.detect, rows = '';
    rows += '<tr><th>Đang chạy</th><td>NEXAMed ' + esc(d.installedVersion) + '</td></tr>';
    rows += '<tr><th>Bản mới trong gói</th><td>' + (d.packageVersion ? 'NEXAMed ' + esc(d.packageVersion) : 'Không thấy đủ ảnh trong thư mục images') + '</td></tr>';
    rows += '<tr><th>Tình trạng dịch vụ</th><td>' + (d.services.length ? d.services.map(function (s) { return esc(s.service) + ': ' + esc(s.health || s.state); }).join(' · ') : 'Chưa có dịch vụ nào chạy') + '</td></tr>';
    rows += '<tr><th>Cấu hình</th><td>Giữ nguyên địa chỉ, mật khẩu, thư mục sao lưu đang dùng</td></tr>';
    var body = '<div><h2>Bản đang chạy và bản mới</h2></div><div class="tbl"><table class="sum"><tbody>' + rows + '</tbody></table></div>';
    if (d.upToDate) body += '<div class="done-box"><b style="font-size:16px">Hệ thống đã là bản mới nhất.</b><span>Không cần nâng cấp. Để cập nhật, giải nén gói cài đặt mới đè lên thư mục này rồi chạy lại nexamed-setup.</span></div>';
    else if (d.packageVersion) body += '<div class="alert">Hệ thống tự sao lưu trước khi nâng cấp. Nâng cấp mất vài phút, nhân viên không dùng được trong lúc này.</div>';
    if (d.lastUpgrade) body += '<div class="alert">Lần nâng cấp gần nhất (' + esc(d.lastUpgrade.from) + ' → ' + esc(d.lastUpgrade.to) + ') có thể quay lui bằng bản sao lưu đã lưu. <button class="btn" type="button" id="rollbackBtn" style="margin-left:8px">Quay lui về bản cũ</button></div>';
    return body + errBox(S.error);
  }

  function viewOtp() {
    var o = S.otp;
    if (!o) return '<div class="checks">' + check('run', 'Đang tạo mã…', '', '') + '</div>';
    return '<div><h2>Kích hoạt mã xác thực (OTP)</h2><p class="lead">Làm bước này ngay bây giờ để chắc chắn đăng nhập được. Khu quản trị không có cách đặt lại OTP từ giao diện.</p></div>' +
      '<div class="box"><span class="t">Thêm vào ứng dụng xác thực</span><div class="qrwrap"><div class="qr" role="img" aria-label="Mã QR kích hoạt OTP">' + o.qrSvg + '</div><ol class="steps-list"><li>Mở Google Authenticator, Microsoft Authenticator hoặc Authy trên điện thoại.</li><li>Chọn thêm tài khoản, quét mã QR bên trái.</li><li>Không quét được? Nhập khoá này: <b class="val" style="font-size:14px">' + esc(o.secretSpaced) + '</b></li><li>Nhập mã 6 số hiện trong ứng dụng vào ô bên dưới.</li></ol></div></div>' +
      '<div class="field otp"><label for="otpCode">Mã 6 số trong ứng dụng <span class="req">*</span></label><input class="input" id="otpCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000"><span class="hint ' + (S.otpMsg && S.otpMsg.cls || '') + '" id="otpMsg">' + esc(S.otpMsg ? S.otpMsg.text : 'Mã đổi mỗi 30 giây.') + '</span></div>';
  }

  function viewDone() {
    if (S.closed) return '<div class="done-box"><b style="font-size:18px">Trình cài đặt đã đóng.</b><span>Bạn có thể đóng tab này. Muốn cài đặt hoặc nâng cấp lần nữa, chạy lại lệnh nexamed-setup.</span></div>';
    if (S.scene === 'upgrade') {
      var d = S.detect, lu = d && d.lastUpgrade;
      var rolled = S.job && S.job.kind === 'rollback';
      return '<div class="done-box"><b style="font-size:18px">' + (rolled ? 'Đã quay lui về bản cũ' : 'Đã nâng cấp lên NEXAMed ' + esc(d.installedVersion)) + '</b><span>Hệ thống đã kiểm tra và hoạt động bình thường.' + (rolled ? '' : ' Bản sao lưu trước khi nâng cấp được giữ trong thư mục upgrade-backups, có thể quay lui nếu cần.') + '</span></div>' +
        (lu ? '<div class="tbl"><table class="sum"><tbody><tr><th>Bản sao lưu</th><td>upgrade-backups/' + esc(lu.backupFile) + '</td></tr><tr><th>Quay lui</th><td><button class="btn" type="button" id="rollbackBtn">Quay lui về bản cũ</button></td></tr></tbody></table></div>' : '');
    }
    var r = S.result;
    if (!r) return '<div class="checks">' + check('run', 'Đang lấy kết quả…', '', '') + '</div>';
    var saas = r.profile === 'saas';
    var secrets = saas
      ? sec('Địa chỉ quản trị', r.publicUrl) + sec('Tên đăng nhập', r.username) + '<div class="secret"><span class="k">Mật khẩu</span><span class="v">do bạn đặt ở bước Thông tin</span><span></span></div><div class="secret"><span class="k">Mã OTP</span><span class="v">Đã kích hoạt</span><span></span></div>'
      : sec('Địa chỉ đăng nhập', r.publicUrl) + sec('Tên đăng nhập', r.username) + sec('Mật khẩu tạm', r.tempPassword);
    var html = '<div class="done-box"><b style="font-size:18px">Đã cài xong NEXAMed ' + esc(r.version) + '</b><span class="bigurl">' + esc(r.publicUrl) + '</span><span class="muted">' +
      (r.profile === 'lan' ? 'Nhân viên mở địa chỉ này trên trình duyệt bất kỳ trong mạng nội bộ.' : r.profile === 'vps' ? 'HTTPS đã bật, chứng chỉ tự gia hạn.' : 'Công ty khách tạo trong khu quản trị, mỗi công ty một tên miền phụ.') + '</span></div>' +
      '<div class="box"><span class="t">' + (saas ? 'Thông tin đăng nhập khu quản trị' : 'Thông tin bàn giao (chỉ hiện một lần)') + '</span><div class="checks" style="border:0">' + secrets + '</div></div>';
    if (saas) return html + '<div class="alert">Thêm công ty khách đầu tiên ở khu quản trị: mỗi công ty có một tên miền phụ riêng, hoạt động ngay không cần cấu hình thêm.</div>' + keyBox(r);
    html += '<div class="alert">Mật khẩu tạm không xem lại được. Người dùng bị yêu cầu đổi mật khẩu ở lần đăng nhập đầu tiên.</div>' +
      '<div><a class="btn" href="/api/handoff.txt" download="NEXAMed-ban-giao.txt">Tải file thông tin bàn giao (.txt)</a></div>' + keyBox(r) +
      '<label class="check2"><input type="checkbox" id="ack"' + (S.ack ? ' checked' : '') + '><span>Tôi đã lưu thông tin trên. Sau khi đóng trang này sẽ không xem lại được.</span></label>';
    if (r.profile === 'lan') html += '<div class="checks">' + check('ok', 'Tự chạy lại khi máy khởi động lại', 'Các dịch vụ đã đặt tự khởi động. Trên Windows còn bước bật "Start Docker Desktop when you sign in" trong cài đặt Docker Desktop.', 'xem hướng dẫn') + '</div>';
    return html;
  }
  /* Hộp "Cất khoá hệ thống" (docs/DECISIONS.md #262, mockup đã chốt 24/10/2026): khoá mã hoá dữ liệu nhạy cảm KHÔNG nằm trong bản sao lưu; mất khoá là mất dữ liệu đã mã hoá. Bắt buộc tải file + tick xác nhận mới Hoàn tất. */
  function keyBox(r) {
    return '<div class="keybox"><span class="t">Bắt buộc · Cất khoá hệ thống</span>' +
      '<div class="keyhead">Khoá này mã hoá số CCCD, số thẻ BHYT và các thông tin nhạy cảm của bệnh nhân.</div>' +
      '<ul><li>Bản sao lưu tự động <b>KHÔNG chứa khoá</b> (để lộ bản sao lưu vẫn không lộ dữ liệu).</li>' +
      '<li>Mất khoá = các thông tin đã mã hoá <b>không đọc lại được và không có cách lấy lại</b>, kể cả khi còn bản sao lưu.</li>' +
      '<li>Hãy cất file khoá ở <b>nơi khác máy chủ</b> (USB, két, email nội bộ an toàn). Không gửi qua Zalo/nhóm chat.</li></ul>' +
      '<div class="keyrow"><div><span class="muted">Mã kiểm khoá (để đối chiếu sau này, không phải khoá)</span><span class="keyfp">' + esc(r.keyFingerprint || '—') + '</span></div>' +
      '<a class="btn amber big" id="keyDl" href="/api/key.txt" download="NEXAMed-khoa-he-thong.txt">' + (S.keyDownloaded ? 'Đã tải · Tải lại file khoá' : 'Tải file khoá (.txt)') + '</a></div>' +
      '<label class="check2"><input type="checkbox" id="ackKey"' + (S.ackKey ? ' checked' : '') + '><span>Tôi đã tải file khoá và <b>cất ở nơi khác máy chủ này</b>.</span></label></div>';
  }
  /* Nút Hoàn tất chỉ bật khi đã tải file khoá + tick xác nhận khoá (+ tick đã lưu thông tin bàn giao với kiểu không phải SaaS). */
  function canFinish() { return S.keyDownloaded && S.ackKey && (S.profile === 'saas' || S.ack); }
  function sec(k, v) { return '<div class="secret"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span>' + copyButton(v) + '</div>'; }

  /* ---------- Vẽ lại ---------- */
  function render() {
    var ids = stepIds(), idx = ids.indexOf(S.step);
    $('steps').innerHTML = '<div class="brandline">NEXAMed</div><div class="brandsub">Trình cài đặt' + (S.detect ? ' · ' + esc(S.detect.setupVersion) : '') + '</div>' +
      ids.map(function (id, i) { return '<div class="step' + (i === idx ? ' on' : i < idx ? ' done' : '') + '"><span class="n">' + (i < idx ? '✓' : i + 1) + '</span>' + labelOf(id) + '</div>'; }).join('');

    var views = { check: viewCheck, profile: viewProfile, info: viewInfo, backup: viewBackup, review: viewReview, progress: viewProgress, current: viewCurrent, otp: viewOtp, done: viewDone };
    var active = document.activeElement && document.activeElement.id;
    var sel = active && document.activeElement.selectionStart != null ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    $('body').innerHTML = '<form id="stepform" novalidate>' + views[S.step]() + '</form>';
    if (active && $(active) && (S.step === 'info' || S.step === 'backup' || S.step === 'otp')) { $(active).focus(); if (sel && $(active).setSelectionRange && $(active).type !== 'password') try { $(active).setSelectionRange(sel[0], sel[1]); } catch { /* một số kiểu ô không hỗ trợ */ } }
    var box = $('logbox'); if (box) box.scrollTop = box.scrollHeight;
    $('foot').innerHTML = footer();
  }

  function footer() {
    var busy = S.busy ? ' disabled' : '';
    var back = function (dis) { return '<button class="btn" type="button" id="back"' + (dis ? ' disabled' : '') + '>Quay lại</button>'; };
    if (S.closed) return '<span></span><span></span>';
    var job = S.job;
    switch (S.step) {
      case 'check': {
        var bad = !S.pre || S.pre.some(function (r) { return r.status === 'bad'; });
        return '<span></span><span style="display:flex;gap:10px"><button class="btn" type="button" id="recheck"' + busy + '>Kiểm tra lại</button>' + (S.scene === 'upgrade' || bad ? '' : '') +
          '<button class="btn primary" type="submit" form="stepform"' + (bad || S.busy ? ' disabled' : '') + '>Tiếp tục</button></span>';
      }
      case 'profile': return back(false) + '<button class="btn primary" type="submit" form="stepform">Tiếp tục</button>';
      case 'info': case 'backup': return back(false) + '<button class="btn primary" type="submit" form="stepform"' + busy + '>' + (S.busy ? 'Đang kiểm tra…' : 'Tiếp tục') + '</button>';
      case 'review': return back(false) + '<button class="btn primary big" type="submit" form="stepform"' + (busy || !S.review ? ' disabled' : '') + '>Cài đặt</button>';
      case 'current': {
        var can = S.detect && S.detect.packageVersion && !S.detect.upToDate;
        return back(false).replace('id="back"', 'id="back" disabled') + (can ? '<button class="btn primary big" type="submit" form="stepform"' + busy + '>Nâng cấp</button>' : '<button class="btn primary" type="button" id="finishBtn">Đóng trình cài đặt</button>');
      }
      case 'progress':
        if (job && job.state === 'failed') return '<span class="muted">Có thể sửa nguyên nhân rồi thử lại.</span><span style="display:flex;gap:10px">' + (S.scene === 'install' ? '<button class="btn" type="button" id="back">Sửa thông tin</button>' : '') + '<button class="btn primary" type="button" id="retry">Thử lại</button></span>';
        return '<span class="muted">Có thể mất vài phút…</span><span></span>';
      case 'otp': return '<span></span><button class="btn primary big" type="submit" form="stepform" disabled id="otpok">Xác nhận và tiếp tục</button>';
      case 'done':
        if (S.scene === 'upgrade') return '<span></span><button class="btn primary big" type="button" id="finishBtn">Hoàn tất</button>';
        return '<span class="muted">' + (canFinish() ? '' : 'Nút Hoàn tất chỉ bật khi đã tải file khoá và tick các ô xác nhận.') + '</span><button class="btn primary big" type="button" id="finishBtn"' + (canFinish() ? '' : ' disabled') + '>Hoàn tất</button>';
    }
    return '';
  }

  /* ---------- Hành động ---------- */
  function go(id) { S.step = id; S.error = null; S.busy = false; render(); onEnter(id); }

  function onEnter(id) {
    if (id === 'check') loadPre();
    if (id === 'review') loadReview();
    if (id === 'progress') startPolling();
    if (id === 'otp') loadOtp();
    if (id === 'done' && S.scene === 'install') loadResult();
    if (id === 'done' && S.scene === 'upgrade') refreshDetect();
  }

  function refreshDetect() { return api('/state').then(function (st) { S.detect = st.detect; render(); }); }

  function loadPre() {
    S.pre = null; render();
    api('/preflight?mode=' + S.scene).then(function (rows) {
      S.pre = rows;
      var p80 = rows.filter(function (r) { return r.id === 'port80'; })[0];
      if (p80 && p80.status === 'warn' && S.a.webPort === 80) S.a.webPort = 8080;
      render();
    }).catch(function (e) { S.pre = [{ id: 'x', title: 'Kiểm tra máy', detail: e.message, status: 'bad', value: 'lỗi' }]; render(); });
  }

  function loadReview() {
    S.review = null; render();
    api('/review', payload()).then(function (r) {
      if (!r.ok) { S.errors = r.errors; go(guessStepForErrors(r.errors)); return; }
      S.review = r; render();
    }).catch(function (e) { S.error = e.message; render(); });
  }
  function guessStepForErrors(errs) { return Object.keys(errs).some(function (k) { return BACKUP_FIELDS.indexOf(k) >= 0; }) ? 'backup' : 'info'; }

  function payload() { var a = Object.assign({}, S.a, { profile: S.profile }); return a; }

  function startPolling() {
    if (S.timer) return;
    var tick = function () {
      api('/job').then(function (job) {
        S.job = job;
        if (!job) { stop(); return; }
        if (job.state === 'running' || job.state === 'idle') { render(); return; }
        stop();
        if (job.state === 'done') { finishJob(); } else { render(); }
      }).catch(function () { /* tạm mất kết nối: thử lại ở nhịp sau */ });
    };
    var stop = function () { clearInterval(S.timer); S.timer = null; };
    S.timer = setInterval(tick, 1000);
    tick();
  }
  function finishJob() {
    if (S.scene === 'upgrade') { refreshDetect().then(function () { go('done'); }); return; }
    go(S.profile === 'saas' && !(S.otp && S.otp.verified) ? 'otp' : 'done');
  }

  function loadOtp() {
    api('/otp').then(function (o) { if (!o) { S.error = 'Chưa có bước kích hoạt OTP.'; render(); return; } S.otp = o; if (o.verified) { go('done'); return; } render(); }).catch(function (e) { S.error = e.message; render(); });
  }
  function loadResult() {
    api('/result').then(function (r) { S.result = r; S.profile = r.profile; render(); }).catch(function (e) { S.error = e.message; render(); });
  }

  function onSubmit(ev) {
    ev.preventDefault();
    if (S.busy) return;
    var id = S.step;
    if (id === 'check') return go(S.scene === 'upgrade' ? 'current' : 'profile');
    if (id === 'profile') return go('info');
    if (id === 'info') return submitInfo();
    if (id === 'backup') return submitBackup();
    if (id === 'review') { S.error = null; return api('/install', payload()).then(function () { S.job = null; go('progress'); }).catch(function (e) { S.errors = e.details || {}; S.error = e.message; if (e.details) go(guessStepForErrors(e.details)); else render(); }); }
    if (id === 'current') return api('/upgrade', {}).then(function () { S.job = null; go('progress'); }).catch(function (e) { S.error = e.message; render(); });
    if (id === 'otp') return verifyOtp();
  }

  function fieldErrors(keys) {
    return api('/validate', payload()).then(function (r) {
      S.errors = {};
      if (!r.ok) keys.forEach(function (k) { if (r.errors[k]) S.errors[k] = r.errors[k]; });
      return Object.keys(S.errors).length === 0;
    });
  }

  function submitInfo() {
    S.busy = true; S.error = null; S.extra = []; render();
    var p = S.profile;
    var step = fieldErrors(INFO_FIELDS).then(function (ok) {
      if (p === 'saas' && !(S.cert && S.cert.ok)) { S.errors.certificate = 'Tải lên chứng chỉ (.crt) và khoá riêng (.key) hợp lệ.'; ok = false; }
      if (!ok) return false;
      if (p === 'lan') {
        return api('/check/port', { port: S.a.webPort }).then(function (row) {
          if (row.status === 'bad') { S.extra = [row]; S.errors.webPort = 'Cổng này đang bị chiếm, chọn cổng khác (ví dụ 8080).'; return false; }
          return true;
        });
      }
      if (p === 'vps') {
        return Promise.all([api('/check/dns', { domain: S.a.domain }), api('/check/port', { port: 80 }), api('/check/port', { port: 443 })]).then(function (res) {
          var dns = res[0], rows = [];
          var domainOk = dns.status === 'ok';
          rows.push(domainOk ? { status: 'ok', title: S.a.domain, detail: 'Đã trỏ về ' + dns.matched + ', đúng IP của máy này', value: '✓' }
            : { status: 'bad', title: S.a.domain, detail: dns.status === 'unresolved' ? 'Chưa phân giải được tên miền. Kiểm tra bản ghi DNS (loại A) đã trỏ về IP của VPS.' : 'Đang trỏ về ' + dns.resolved.join(', ') + ' nhưng máy này là ' + dns.expected.join(' / '), value: '!' });
          rows.push(res[1].status === 'ok' && res[2].status === 'ok' ? { status: 'ok', title: 'Cổng 80 và 443', detail: 'Còn trống trên máy này', value: '✓' } : { status: 'bad', title: 'Cổng 80 và 443', detail: 'Một trong hai cổng đang bị chương trình khác chiếm', value: '!' });
          S.extra = rows; S.dnsFailed = !domainOk;
          return (domainOk || S.skipDns) && res[1].status === 'ok' && res[2].status === 'ok';
        });
      }
      return true;
    });
    step.then(function (ok) { S.busy = false; if (ok) { S.extra = []; go('backup'); } else render(); })
      .catch(function (e) { S.busy = false; S.error = e.message; render(); });
  }

  function submitBackup() {
    S.busy = true; S.error = null; S.backupRow = null; render();
    fieldErrors(BACKUP_FIELDS).then(function (ok) {
      if (!ok) return false;
      return api('/check/backup', { path: S.a.backupDir }).then(function (row) { S.backupRow = row; return row.status !== 'bad'; });
    }).then(function (ok) { S.busy = false; if (ok) go('review'); else render(); })
      .catch(function (e) { S.busy = false; S.error = e.message; render(); });
  }

  function verifyOtp() {
    var code = ($('otpCode') || {}).value || '';
    api('/otp/verify', { code: code }).then(function (r) {
      if (r.ok) { S.otp.verified = true; S.otpMsg = { text: 'Đúng mã.', cls: 'ok' }; go('done'); } else { S.otpMsg = { text: 'Mã chưa đúng. Kiểm tra giờ trên điện thoại và thử mã mới.', cls: 'bad' }; render(); }
    }).catch(function (e) { S.otpMsg = { text: e.message, cls: 'bad' }; render(); });
  }

  /* ---------- Sự kiện ---------- */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } finally { document.body.removeChild(t); }
    return Promise.resolve();
  }

  document.addEventListener('submit', onSubmit);

  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target : null; if (!t) return;
    var b;
    if ((b = t.closest('[data-profile]'))) { S.profile = b.getAttribute('data-profile'); S.errors = {}; return render(); }
    if ((b = t.closest('[data-copy]'))) { var old = b.textContent; copyText(b.getAttribute('data-copy')).then(function () { b.textContent = 'Đã chép'; setTimeout(function () { b.textContent = old; }, 1500); }); return; }
    if (t.closest('#back')) { var ids = stepIds(); var i = ids.indexOf(S.step); return go(S.step === 'progress' ? 'review' : ids[Math.max(0, i - 1)]); }
    if (t.closest('#recheck')) return loadPre();
    if (t.closest('#retry')) { var path = S.scene === 'upgrade' || (S.job && S.job.kind !== 'install') ? '/upgrade' : '/install'; return api(path, { retry: true }).then(function () { S.job.state = 'running'; startPolling(); render(); }).catch(function (er) { S.error = er.message; render(); }); }
    if (t.closest('#rollbackBtn')) {
      if (!window.confirm('Khôi phục dữ liệu về thời điểm trước lần nâng cấp gần nhất? Dữ liệu nhập SAU lần nâng cấp đó sẽ mất.')) return;
      return api('/rollback', {}).then(function () { S.scene = 'upgrade'; S.job = null; go('progress'); }).catch(function (er) { S.error = er.message; render(); });
    }
    if (t.closest('#keyDl')) { S.keyDownloaded = true; setTimeout(render, 80); return; }
    if (t.closest('#finishBtn')) {
      return (S.scene === 'install' && S.profile !== 'saas' ? api('/ack', {}) : Promise.resolve()).then(function () { return api('/finish', {}); }).then(function () { S.closed = true; render(); }).catch(function () { S.closed = true; render(); });
    }
  });

  document.addEventListener('input', function (e) {
    var el = e.target, k = el.getAttribute && el.getAttribute('data-k');
    if (k) {
      S.a[k] = (k === 'webPort' || k === 'backupHourVn' || k === 'backupRetentionDays') && el.value !== '' && /^\d+$/.test(el.value) ? Number(el.value) : el.value;
      if (S.errors[k]) { delete S.errors[k]; el.classList.remove('invalid'); }
      if (k === 'operatorPassword') {
        clearTimeout(S.pwTimer);
        S.pwTimer = setTimeout(function () { api('/password', { password: el.value }).then(function (r) { S.password = r; var m = $('pwMeter'); if (m) m.style.width = (r.score + 1) * 20 + '%'; var hint = el.parentNode.querySelector('.hint'); if (hint && !S.errors[k]) hint.textContent = r.hint; }); }, 200);
      }
    }
    if (el.id === 'otpCode') { var ok = /^\d{6}$/.test(el.value); var btn = $('otpok'); if (btn) btn.disabled = !ok; }
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.name === 'addr') { S.a.lanAddress = el.value; delete S.errors.lanAddress; }
    if (el.id === 'ack') { S.ack = el.checked; var f = $('finishBtn'); if (f) f.disabled = !canFinish(); }
    if (el.id === 'ackKey') { S.ackKey = el.checked; var fk = $('finishBtn'); if (fk) fk.disabled = !canFinish(); }
    if (el.id === 'skipDns') S.skipDns = el.checked;
    if (el.id === 'crtFile' || el.id === 'keyFile') {
      var file = el.files && el.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        S[el.id === 'crtFile' ? 'crtText' : 'keyText'] = String(reader.result);
        if (S.crtText && S.keyText && S.a.domain) {
          api('/cert', { baseDomain: S.a.domain, crt: S.crtText, key: S.keyText }).then(function (r) { S.cert = r; delete S.errors.certificate; render(); }).catch(function (er) { S.cert = { ok: false, errors: [er.message], names: [] }; render(); });
        }
      };
      reader.readAsText(file);
    }
  });

  /* ---------- Khởi động ---------- */
  api('/state').then(function (st) {
    S.detect = st.detect;
    S.scene = st.detect.mode;
    S.a.backupDir = defaultBackupDir(st.detect.hostInstallDir);
    S.a.lanAddress = (st.detect.hostIps && st.detect.hostIps[0]) || 'localhost';
    if (st.job) {
      // Tải lại trang giữa chừng: nối lại đúng chỗ đang chạy.
      S.scene = st.job.kind === 'install' ? 'install' : 'upgrade';
      S.job = st.job;
      if (st.job.kind === 'install') {
        api('/otp').then(function (o) { if (o) { S.profile = 'saas'; S.otp = o; go(st.job.state === 'done' ? (o.verified ? 'done' : 'otp') : 'progress'); } else go(st.job.state === 'done' ? 'done' : 'progress'); }).catch(function () { go(st.job.state === 'done' ? 'done' : 'progress'); });
        return;
      }
      go(st.job.state === 'done' ? 'done' : 'progress');
      return;
    }
    go('check');
  }).catch(function (e) {
    $('body').innerHTML = '<div class="err"><span>' + esc(e.message) + '</span></div>';
  });

  function defaultBackupDir(installDir) {
    var win = /^([A-Za-z]):\\/.exec(installDir || '');
    if (win) return (win[1].toUpperCase() === 'C' ? 'D' : win[1].toUpperCase()) + ':\\NEXAMed-backup';
    return '/srv/nexamed-backup';
  }
})();
