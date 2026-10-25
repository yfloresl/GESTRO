#!/bin/sh
# Los volúmenes nombrados pueden nacer con dueño root (según el motor de Docker). Aquí se corrige el dueño de
# /data y recién entonces se baja al usuario sin privilegios para correr la API. La llave maestra queda 0700.
set -e
mkdir -p /data/secretos /data/archivos
chown -R node:node /data
chmod 700 /data/secretos
exec setpriv --reuid=node --regid=node --init-groups -- "$@"
