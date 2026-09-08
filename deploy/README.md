# TAARA CloudTAK deployment

This fork (`martparve/est-webtak`, a fork of `dfpc-coe/CloudTAK`) carries our deployment changes on the `taara` branch.
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

## OpenTAKServer specifics

- OTS (1.7.13) lacks `GET /Marti/api/version`, which CloudTAK calls after login. The OTS nginx has a static stub for it
  on ports 8443 and 8446. Without it every login fails with a 404.
- OTS answers TAK pings with a copy of the ping instead of a `t-x-c-t-r` pong, so node-tak never marks the stream
  "open" and the admin panel shows the connection as **dead** even though CoT traffic flows. Cosmetic until fixed upstream.
- The OTS server certificate is issued for the name `opentakserver`; the api container maps that name to the OTS IP
  (`OTS_HOSTNAME`/`OTS_IP` in `.env`) and trusts the OTS CA (`deploy/certs/ots-ca.pem`, `NODE_EXTRA_CA_CERTS`).
- Initial configuration was done with `PATCH /api/server` (name, `ssl://opentakserver:8089`, `https://opentakserver:8443`,
  `https://opentakserver:8446`, the muhv_1 client cert/key as admin auth, and muhv_1's TAK login as first system admin).

## TAARA features on top of upstream

- **MGRS grid overlay**: grid button (4x4 icon) in the map's right-hand control stack. Draws UTM/MGRS lines for the
  visible area: 100 km squares when zoomed out, 10 km and 1 km lines when zoomed in, with square ids (e.g. "35V MF")
  and km values. Generated client-side in `api/web/src/utils/mgrsGrid.ts`, layers managed in `stores/map.ts`
  (`toggleGrid`, `refreshGrid`, `ensureGridLayers`), preference stored in localStorage.
- **Coordinate widgets honour Settings > Display > Coordinate Format** (`util/Coordinate.vue`), so Query Mode and
  feature panels open in MGRS when that is the chosen format.

## End-to-end tests (Playwright)

`api/web/e2e/` holds browser tests that run against a live CloudTAK: login, Display settings (Coordinate Format and the
MGRS Grid toggle), the grid overlay (lines, labels, 100 m level, persistence), Query Mode opening in MGRS, basemaps,
the MUHV-TAARA Data Sync mission, and the Admin area for admin users.

Run locally from `api/web`:

```
npx playwright install chromium          # once
E2E_USERNAME=e2e_test E2E_PASSWORD=... npm run e2e
```

`E2E_BASE_URL` defaults to the TAARA deployment. Screenshots land in `api/web/e2e-results/`.
In CI the `e2e-live` job runs nightly and via "Run workflow", using the repository secrets `E2E_USERNAME` /
`E2E_PASSWORD` (a low-privilege OTS user `e2e_test` in the MUHV group; password in
`~/Code/Android/opentakserver/credentials.env`). The map instance is exposed as `window.cloudtakMap` for these tests.
