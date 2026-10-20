#!/usr/bin/env bash
# Runs on the host as ~/erc/deploy.sh <tag>, after the image erc-web:<tag> has been loaded with `docker load`.
set -euo pipefail
cd "$(dirname "$0")"

tag=${1:?usage: deploy.sh <image tag>}
keep_backups=5
keep_images=3

docker image inspect "erc-web:$tag" >/dev/null

# Checked before anything changes: compose refuses every command while either is missing, rollback included.
# The password goes unescaped into erc-umami's connection URL and into the SQL below, so only URL-safe characters.
umami_password=$(grep -E '^UMAMI_DB_PASSWORD=' .env | cut -d= -f2- || true)
[[ "$umami_password" =~ ^[A-Za-z0-9_-]{24,}$ ]] || { echo "Set UMAMI_DB_PASSWORD in .env: 24 or more letters, digits, - or _ (openssl rand -hex 24)" >&2; exit 1; }
grep -qE '^UMAMI_APP_SECRET=.+' .env || { echo "Set UMAMI_APP_SECRET in .env (openssl rand -hex 32)" >&2; exit 1; }

mkdir -p backups
trap 'rm -f backups/.predeploy-*.partial' EXIT
if [ "$(docker inspect -f '{{.State.Running}}' erc-postgres 2>/dev/null || true)" = "true" ]; then
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  partial="backups/.predeploy-$ts.partial"
  docker exec erc-postgres pg_dump -U erc erc | gzip > "$partial"
  mv "$partial" "backups/predeploy-$ts.sql.gz"
  ls -1t backups/predeploy-*.sql.gz | tail -n +$((keep_backups + 1)) | xargs -r rm --
  echo "pre-deploy backup: backups/predeploy-$ts.sql.gz"
fi

previous=$(grep -E '^ERC_WEB_TAG=' .env | cut -d= -f2- || true)
sed -i.bak -E "s/^ERC_WEB_TAG=.*/ERC_WEB_TAG=$tag/" .env && rm -f .env.bak
grep -q "^ERC_WEB_TAG=$tag$" .env || echo "ERC_WEB_TAG=$tag" >> .env
echo "erc-web: ${previous:-none} -> $tag (roll back with: ./deploy.sh ${previous:-<tag>})"

# Next never deletes fetch-cache entries, and every race list key carries the IST date, so a file older than a day is dead.
prune_marker='# erc-next-cache-prune'
# Read the whole crontab before writing, so the host's other jobs can never be truncated away.
current_crontab=$(crontab -l 2>/dev/null || true)
if ! grep -qF "$prune_marker" <<<"$current_crontab"; then
  prune_job="0 19 * * * find /data/media/erc/next-cache/fetch-cache -type f -mmin +1440 -delete $prune_marker (00:30 IST)"
  if [ -n "$current_crontab" ]; then printf '%s\n%s\n' "$current_crontab" "$prune_job"; else printf '%s\n' "$prune_job"; fi | crontab -
  echo "installed daily fetch-cache prune"
fi

docker compose up -d erc-postgres erc-web
for _ in $(seq 1 60); do
  if docker exec erc-web wget -qO /dev/null http://127.0.0.1:3000/races 2>/dev/null; then break; fi
  sleep 2
done
docker exec erc-web wget -qO /dev/null http://127.0.0.1:3000/races || { echo "erc-web did not become healthy" >&2; exit 1; }

# Umami keeps its data in its own role and database inside erc-postgres. Created on the first deploy; the password is
# set every time so a changed UMAMI_DB_PASSWORD takes effect. Sent on stdin, so it never shows in the process list.
docker exec -i erc-postgres psql -v ON_ERROR_STOP=1 -q -U erc -d erc <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'umami') THEN CREATE ROLE umami; END IF;
END \$\$;
ALTER ROLE umami WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '$umami_password';
REVOKE CONNECT ON DATABASE erc FROM PUBLIC;
SELECT 'CREATE DATABASE umami OWNER umami' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'umami')\gexec
SQL
docker compose up -d erc-umami

if [ -f cloudflared.yml ] && [ "${ERC_PUBLIC:-1}" = "1" ]; then
  docker compose --profile public up -d erc-cloudflared
  # A recreated web container gets a new IP; restart the tunnel so it drops the stale origin connection.
  docker restart erc-cloudflared >/dev/null
fi

# Newest first; keep the running tag, the previous one for rollback, and one older.
stale=$(docker images erc-web --format '{{.Tag}}' | grep -vxF -e "$tag" -e "${previous:-$tag}" | tail -n +$((keep_images - 1)) || true)
if [ -n "$stale" ]; then
  echo "$stale" | xargs -I{} docker image rm "erc-web:{}" >/dev/null || echo "WARNING: image prune failed; deploy itself succeeded" >&2
fi
docker inspect -f 'running {{.Config.Image}} ({{.Image}})' erc-web
