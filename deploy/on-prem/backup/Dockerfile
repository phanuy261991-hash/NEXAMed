# Ảnh backup on-prem (S4-05) — dùng thẳng ảnh `postgres:18` chính thức để `pg_dump` LUÔN khớp
# đúng phiên bản server (18) đang chạy, tránh lệch phiên bản gây lỗi dump/restore.
FROM postgres:18
# `jq` (S6-01, docs/DECISIONS.md #141) — parse/ghi JSON trạng thái backup an toàn trong
# backup.sh, tránh tự viết bằng sed/awk dễ sai escape.
RUN apt-get update && apt-get install -y --no-install-recommends jq && rm -rf /var/lib/apt/lists/*
COPY deploy/on-prem/backup/backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]