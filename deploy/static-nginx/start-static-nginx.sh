#!/bin/sh
set -eu
PORT=${PORT:-3000}
case "$PORT" in
    ''|*[!0-9]*) echo 'Invalid PORT: expected integer 1..65535' >&2; exit 1 ;;
esac
if [ "${#PORT}" -gt 5 ] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
    echo 'Invalid PORT: expected integer 1..65535' >&2
    exit 1
fi
export PORT
# Substitute only PORT; keep NGINX variables such as $uri intact.
envsubst '${PORT}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
