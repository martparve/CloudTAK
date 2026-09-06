# TAARA CloudTAK deployment

This fork (`martparve/CloudTAK`) carries our deployment changes on the `taara` branch.
`main` mirrors upstream `dfpc-coe/CloudTAK` and stays untouched.

## Where it runs

| Item | Value |
|---|---|
| Host | Oracle Cloud Stockholm, VM "cloudtak", arm64 (Ampere A1, 2 OCPU / 12 GB), Ubuntu 24.04 |
| Public IP | 79.72.16.120 |
| Web UI / API | https://map.79-72-16-120.sslip.io (Caddy, Let's Encrypt) |
| Tiles | https://tiles.map.79-72-16-120.sslip.io |
| SSH | `ssh ubuntu@79.72.16.120` |
| Checkout on server | `/home/ubuntu/CloudTAK`, branch `taara`, remote `origin` = this fork |
| TAK server | OpenTAKServer at 79.76.50.144 (8089 SSL, Marti API 8443, enrollment/oauth 8446) |

The `*.sslip.io` names resolve to the embedded IP without any DNS setup. Swap in a real domain by
changing `API_URL`, `PMTILES_URL` and `CLOUDTAK_HOSTNAME` in the server's `.env` and the two hostnames
in `/etc/caddy/Caddyfile`.

## What the `taara` branch changes

- `docker-compose.override.yml`: arm64 PostGIS image, arm64-friendly tiles build, and
  `extra_hosts` so containers can reach our own hostname (Oracle NATs the public IP, so hairpin
  connections to it fail from inside Docker).
- `tasks/pmtiles/Dockerfile.arm64`: tiles task on a glibc base; the alpine build crashes on arm64.
- `deploy/`: this README, the pull-based deploy script and its systemd units.
- `.github/workflows/taara.yml`: CI smoke checks on every push to `taara`.

## CI/CD flow

1. Work on a branch off `taara`, open a PR into `taara` (or push straight to `taara`).
2. GitHub Actions (`taara.yml`) validates the compose files, shellchecks the deploy script and
   lints/builds the tiles task.
3. On the server a systemd timer runs `deploy/taara-deploy.sh` every 3 minutes. When
   `origin/taara` has moved it fast-forwards, runs `docker compose build`, then
   `docker compose up -d`. A failed build leaves the running stack untouched.
4. Log: `/var/log/taara-deploy.log` on the server. Force a redeploy of the current commit with
   `FORCE=1 /home/ubuntu/CloudTAK/deploy/taara-deploy.sh` (as the ubuntu user).

Rollback: `git revert` on `taara` and push. The timer deploys the revert.

## Server-side files not in git

- `/home/ubuntu/CloudTAK/.env`: `SigningSecret`, `API_URL`, `PMTILES_URL`, `CLOUDTAK_HOSTNAME`,
  MinIO and Postgres credentials.
- `/etc/caddy/Caddyfile`: reverse proxy for the two hostnames.
- `/etc/systemd/system/taara-deploy.{service,timer}`: copies of the files in `deploy/`.

## Keeping up with upstream

```
git fetch upstream
git checkout main && git merge --ff-only upstream/main && git push origin main
git checkout taara && git merge main   # resolve conflicts if any, then push
```
