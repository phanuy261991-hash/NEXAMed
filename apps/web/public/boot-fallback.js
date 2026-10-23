/* Bật khung báo lỗi tĩnh `#boot-fallback` (xem apps/web/index.html, docs/DECISIONS.md #255) khi mã ứng dụng không tải được: tệp script hỏng/mất
   (trình duyệt giữ trang index.html cũ sau cập nhật, mất mạng giữa chừng) hoặc quá 15 giây mà ứng dụng vẫn chưa hiện gì. Ứng dụng hiện ra thì tự ẩn.
   Cố ý là tệp script RIÊNG, JavaScript thuần (không qua Vite/React): vẫn chạy khi bundle chính hỏng, và hợp lệ khi CSP chuyển sang chế độ chặn
   (không dùng script nội tuyến). */
(function () {
  var fallback = document.getElementById('boot-fallback');
  var root = document.getElementById('root');
  if (!fallback || !root) return;

  function mounted() {
    return root.childElementCount > 0;
  }
  function show() {
    if (!mounted()) fallback.hidden = false;
  }

  // Lỗi tải THẺ <script> (404, mất mạng): sự kiện `error` của tài nguyên không nổi bọt nên phải bắt ở pha capture.
  window.addEventListener(
    'error',
    function (event) {
      var target = event.target;
      if (target && target.tagName === 'SCRIPT') show();
    },
    true,
  );

  // Lưới đỡ: quá 15 giây ứng dụng vẫn chưa hiện gì.
  window.setTimeout(show, 15000);

  // Ứng dụng đã hiện ra (kể cả sau khi khung này đã bật vì mạng chậm) → ẩn khung.
  new MutationObserver(function () {
    if (mounted()) fallback.hidden = true;
  }).observe(root, { childList: true });

  var button = fallback.querySelector('button');
  if (button) {
    button.addEventListener('click', function () {
      window.location.reload();
    });
  }
})();
