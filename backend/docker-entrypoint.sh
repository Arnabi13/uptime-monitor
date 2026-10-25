#!/bin/sh
# Runs database migrations, then starts the app.
# `set -e` means: if migrations fail, the container exits instead of starting
# an app against the wrong schema.
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Running database migrations..."
  ./node_modules/.bin/typeorm migration:run -d dist/database/data-source.js
fi

# exec replaces this shell with node, so node becomes PID 1 and receives
# SIGTERM directly from `docker stop` (graceful shutdown).
exec "$@"
