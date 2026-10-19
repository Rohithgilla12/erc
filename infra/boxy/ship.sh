#!/usr/bin/env bash
# Runs on a workstation: builds the committed HEAD as an arm64 image, streams it to the host, and deploys it.
# Usage: ERC_DEPLOY_HOST=<ssh host> infra/boxy/ship.sh
set -euo pipefail
host=${ERC_DEPLOY_HOST:?set ERC_DEPLOY_HOST to the ssh host}
root=$(git rev-parse --show-toplevel)
cd "$root"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Refusing to ship uncommitted changes; commit first so the tag names what is running." >&2
  exit 1
fi
tag=$(git rev-parse --short=12 HEAD)

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
git archive HEAD | tar -x -C "$stage"

ssh "$host" 'cat /proc/loadavg; df -h / | tail -1'
docker build --platform linux/arm64 -f "$stage/apps/web/Dockerfile" -t "erc-web:$tag" "$stage"
docker save "erc-web:$tag" | gzip | ssh "$host" 'gunzip | docker load'

ssh "$host" 'mkdir -p ~/erc && sudo mkdir -p /data/media/erc/pg /data/media/erc/uploads /data/media/erc/next-cache && sudo chown 1001:1001 /data/media/erc/uploads /data/media/erc/next-cache'
scp -q infra/boxy/compose.yaml infra/boxy/deploy.sh "$host":erc/
ssh "$host" "chmod +x ~/erc/deploy.sh && ~/erc/deploy.sh $tag"
