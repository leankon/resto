#!/usr/bin/env bash
# Postgres local para desarrollo y tests de integración.
#
# No hace falta ninguna cuenta en la nube para trabajar en la Fase 1: el esquema
# usa Postgres estándar (btree_gist, tstzrange, RLS), así que lo que corre acá
# corre igual en Supabase, Neon o Railway.
#
#   ./scripts/db-local.sh start|stop|reset|psql
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA:-/var/lib/postgresql/restodata}"
PORT="${PGPORT:-5433}"
DB=resto
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

comoPostgres() { su postgres -c "$1"; }

start() {
  if [ ! -d "$PGDATA/base" ]; then
    mkdir -p "$PGDATA"; chown postgres:postgres "$PGDATA"; chmod 700 "$PGDATA"
    comoPostgres "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust" >/dev/null
  fi
  comoPostgres "$PGBIN/pg_ctl -D $PGDATA -o '-p $PORT -c listen_addresses=localhost' -l /tmp/pg.log start" || true
  sleep 2
  psql -h localhost -p "$PORT" -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB'" \
    | grep -q 1 || psql -h localhost -p "$PORT" -U postgres -qc "CREATE DATABASE $DB"
  migrar
  echo "Postgres en localhost:$PORT, base '$DB'"
}

# Lleva registro de qué migraciones ya corrieron. Sin esto, arrancar la base una
# segunda vez intenta recrear las tablas y falla, que es ruido sin información.
migrar() {
  psql -h localhost -p "$PORT" -U postgres -d "$DB" -q -c "
    CREATE TABLE IF NOT EXISTS migraciones_aplicadas (
      archivo text PRIMARY KEY,
      aplicada_en timestamptz NOT NULL DEFAULT now())"

  for archivo in "$RAIZ"/src/datos/migraciones/*.sql; do
    nombre="$(basename "$archivo")"
    yaEsta="$(psql -h localhost -p "$PORT" -U postgres -d "$DB" -tAc \
      "SELECT 1 FROM migraciones_aplicadas WHERE archivo = '$nombre'")"
    if [ "$yaEsta" = "1" ]; then
      echo "  ya aplicada: $nombre"
      continue
    fi
    echo "  aplicando $nombre"
    psql -h localhost -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f "$archivo"
    psql -h localhost -p "$PORT" -U postgres -d "$DB" -q -c \
      "INSERT INTO migraciones_aplicadas (archivo) VALUES ('$nombre')"
  done
}

case "${1:-start}" in
  start) start ;;
  stop)  comoPostgres "$PGBIN/pg_ctl -D $PGDATA stop" ;;
  reset) psql -h localhost -p "$PORT" -U postgres -qc "DROP DATABASE IF EXISTS $DB" \
           && psql -h localhost -p "$PORT" -U postgres -qc "CREATE DATABASE $DB" && migrar ;;
  psql)  psql -h localhost -p "$PORT" -U postgres -d "$DB" ;;
  *)     echo "uso: $0 start|stop|reset|psql" >&2; exit 1 ;;
esac
