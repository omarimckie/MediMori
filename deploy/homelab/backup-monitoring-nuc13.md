# NUC13 homelab — backup and monitoring integration (design only)

Separate physical or VM **backup/monitoring** host; no install performed in Phase 5c.

## Restic backups

| Source | Destination | Notes |
| --- | --- | --- |
| Proxmox VM configs | `restic:/backups/proxmox` | `vzdump` metadata + snippets |
| `/etc/medimori/` on CAM VM | `restic:/backups/cam-config` | Env templates only on backup host |
| `/var/lib/medimori/` | `restic:/backups/cam-state` | Lock + budget files |
| Git checkouts on dev USB | `restic:/backups/dev-repos` | Copy-first; see USB migration doc |

- **Encryption:** `RESTIC_PASSWORD` from hardware key or 1Password; never in git.
- **Retention:** `7d` daily, `4w` weekly, `6m` monthly (`restic forget --keep-within`).
- **Verify:** Monthly `restic check` + quarterly `restic restore --target /var/tmp/restic-verify` on CAM VM.

## Uptime Kuma (monitoring host)

| Monitor | Type | Target |
| --- | --- | --- |
| Proxmox API | HTTP(s) | `https://pve.local:8006` |
| CAM consumer app | HTTP | App host `/api/health` (when online) |
| CAM runner | Push heartbeat | Future: runner posts to Kuma push URL |
| Backup job | Cron + push | Restic exit code script |

## Alerting

- Kuma → Discord/email webhook on down.
- Restic failure → same webhook via systemd `OnFailure=`.

## Capacity planning

- Budget 3× largest repo size for Restic repo (dedupe helps).
- CAM state files < 1 MB; VM disk ≥ 20 GB for runner VM.

## CAM runner health (future online)

- Parse runner JSON health from journald or sidecar file.
- Alert on `lock_contested`, `budget_file_unreadable`, or `emergency_stop` sustained > 15 minutes.
