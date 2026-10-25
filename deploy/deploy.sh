#!/bin/sh
# Builds and (re)starts the production stack on the EC2 instance.
# Usage, from the repo root on the server:   sh deploy/deploy.sh
set -e
cd "$(dirname "$0")/.."

if [ ! -f backend/.env ]; then
  echo "backend/.env is missing. Create it from backend/.env.production.example first." >&2
  exit 1
fi

# --env-file: lets docker-compose.prod.yml read DB_USER/DB_PASSWORD/DB_NAME
# from backend/.env, so the database password lives in exactly one file.
COMPOSE="docker compose --env-file backend/.env -f docker-compose.prod.yml"

$COMPOSE up -d --build --remove-orphans

# Old image layers pile up with every deploy; on a 20 GB disk that matters.
docker image prune -f

$COMPOSE ps
