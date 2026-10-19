#!/usr/bin/env bash
# Runs on the host as ~/erc/deploy.sh <tag>, after the image erc-web:<tag> has been loaded with `docker load`.
set -euo pipefail
cd "$(dirname "$0")"

tag=${1:?usage: deploy.sh <image tag>}
keep_backups=5
keep_images=3

docker image inspect "erc-web:$tag" >/dev/null

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

docker compose up -d erc-postgres erc-web
for _ in $(seq 1 60); do
  if docker exec erc-web wget -qO /dev/null http://127.0.0.1:3000/races 2>/dev/null; then break; fi
  sleep 2
done
docker exec erc-web wget -qO /dev/null http://127.0.0.1:3000/races || { echo "erc-web did not become healthy" >&2; exit 1; }

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
