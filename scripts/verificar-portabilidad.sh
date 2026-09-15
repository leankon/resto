#!/usr/bin/env bash
# ¿Se puede instalar esto en Postgres gestionado?
#
# En Neon, Supabase o RDS el usuario con el que uno entra NO es superusuario, y esa
# diferencia esconde errores que localmente no se ven: cambiar SUPERUSER o BYPASSRLS
# está prohibido, y FORCE ROW LEVEL SECURITY también bloquea al dueño de las tablas.
# Los dos aparecieron de verdad al desplegar y los dos pasaban los tests locales.
#
# Esto simula ese escenario: crea un usuario con CREATEROLE pero sin superusuario,
# le da una base propia y corre las migraciones como él.
#
#   ./scripts/verificar-portabilidad.sh
set -euo pipefail

PORT="${PGPORT:-5433}"
DB=sim_gestionado
USUARIO=sim_owner
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sql() { psql -h localhost -p "$PORT" -U postgres "$@"; }

# Neon y Supabase validan la fuerza de la contraseña en su propio control plane y
# rechazan un CREATE ROLE con una débil. Eso no se puede simular en local, así que
# lo que se verifica es que las migraciones no traigan ninguna hardcodeada.
echo "Verificando que las migraciones no lleven contraseñas adentro…"
if grep -n "PASSWORD '" "$RAIZ"/src/datos/migraciones/*.sql | grep -v '^\s*--' | grep -v -- '--'; then
  echo "ERROR: hay una contraseña en las migraciones." >&2
  echo "Postgres gestionado rechaza las débiles y el esquema no se va a poder instalar." >&2
  echo "Los roles se crean sin contraseña; se les pone una al desplegar." >&2
  exit 1
fi

echo "Preparando un Postgres que se comporta como uno gestionado…"
sql -qc "DROP DATABASE IF EXISTS $DB" >/dev/null
for r in resto_app resto_auth resto_admin; do
  for d in $(sql -tAc "SELECT datname FROM pg_database WHERE datallowconn"); do
    sql -d "$d" -qc "DROP OWNED BY $r CASCADE" 2>/dev/null || true
  done
  sql -qc "DROP ROLE IF EXISTS $r" >/dev/null 2>&1 || true
done
sql -qc "DROP ROLE IF EXISTS $USUARIO" >/dev/null 2>&1 || true
sql -qc "CREATE ROLE $USUARIO LOGIN PASSWORD 'sim' CREATEDB CREATEROLE" >/dev/null
sql -qc "CREATE DATABASE $DB OWNER $USUARIO" >/dev/null
sql -d "$DB" -qc "GRANT ALL ON SCHEMA public TO $USUARIO" >/dev/null

echo "Aplicando migraciones como usuario sin superusuario…"
for archivo in "$RAIZ"/src/datos/migraciones/*.sql; do
  echo "  $(basename "$archivo")"
  PGPASSWORD=sim psql -h localhost -p "$PORT" -U "$USUARIO" -d "$DB" \
    -v ON_ERROR_STOP=1 -q -f "$archivo"
done

echo "Comprobando que ningún rol quedó con privilegios que no debería tener…"
PGPASSWORD=sim psql -h localhost -p "$PORT" -U "$USUARIO" -d "$DB" -tAc "
  SELECT CASE WHEN count(*) = 3 THEN 'ok' ELSE 'FALTAN ROLES: ' || count(*) END
    FROM pg_roles
   WHERE rolname IN ('resto_app','resto_auth','resto_admin')
     AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls"

sql -qc "DROP DATABASE $DB" >/dev/null
echo "Listo: el esquema se instala en Postgres gestionado."
