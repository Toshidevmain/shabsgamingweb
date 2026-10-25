#!/bin/sh
set -eu

port="${PORT:-10000}"
case "$port" in
  *[!0-9]*|'') echo "PORT must be a valid port number" >&2; exit 1 ;;
esac

sed -i "s/^Listen 80$/Listen ${port}/" /etc/apache2/ports.conf
sed -i "s/<VirtualHost \\*:80>/<VirtualHost *:${port}>/" /etc/apache2/sites-available/000-default.conf
printf 'upload_max_filesize=%s\npost_max_size=%s\n' \
  "${PHP_UPLOAD_MAX_FILESIZE:-100M}" \
  "${PHP_POST_MAX_SIZE:-105M}" \
  > /usr/local/etc/php/conf.d/uploads.ini
exec apache2-foreground
