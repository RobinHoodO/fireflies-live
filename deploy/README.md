# deploy/ — 1Password for fireflies-live (Phase 6, step B6)

Two files for Thrivbe-1. Neither holds a secret value.

| File | Goes to | What it does |
|---|---|---|
| `op.env` | `/etc/fireflies-live/op.env` (root:root 0600) | Three `op://` addresses: `FIREFLY_API_KEY`, `OPENROUTER_API_KEY`, `FIREFLIES_APP_SECRET` |
| `fireflies-live.service.d/zz-1password.conf` | `/etc/systemd/system/fireflies-live.service.d/` | Starts `serve.mjs` through `oprun --env-file /etc/fireflies-live/op.env` |

How it behaves:

- **Secrets:** `oprun` resolves the three values once at start and puts them in the server's environment. The environment wins over `SERVE_ENV_FILE`. A value starting with `op://` is never used, from either place.
- **Policy lists:** `FIREFLIES_ALLOWED_TAILSCALE_LOGINS` and `FIREFLIES_ALLOWED_DATA_PROCESSORS` stay plaintext in `SERVE_ENV_FILE` (`/opt/Thrivbe-AI/.env`). They are re-read from that file on every request, so an edit grants or revokes on the next request with no restart.
- **The bridge child** never gets the three secrets. `serve.mjs` strips them from its environment, because the bridge forwards `OPENROUTER_*` to its `/pi` child.
- **Other keys:** only these three go through oprun, so the other workspace keys stay out of this process.
- **Before the drop-in:** the code does nothing new. With no oprun and a plaintext file, it behaves as it does today.

What changes for Robin:

- **Rotating a secret:** change it in 1Password, then `systemctl restart fireflies-live`. Editing the file no longer does it.
- **Every restart logs everyone out**, because sessions live in memory. Rotating the app secret did the same before.

## Install (on Thrivbe-1, as root)

> **The restart logs Robin out. Do it outside meetings, at a time Robin picks.**

```sh
cd /opt/Thrivbe-AI/lab/fireflies-live
git pull && npm ci && npm run build

# 1. The address file (addresses only).
install -d -m 700 -o root -g root /etc/fireflies-live
install -m 600 -o root -g root deploy/op.env /etc/fireflies-live/op.env

# 2. Prove the addresses BEFORE touching the unit. This prints names and results only, never values.
#    check-keys.py is the 1password skill's script (on T1 under /opt/Thrivbe-AI/.claude/skills/1password/scripts/;
#    if it's missing, copy it from the Mac skill).
CK=/opt/Thrivbe-AI/.claude/skills/1password/scripts/check-keys.py
oprun --env-file /etc/fireflies-live/op.env -- python3 "$CK" OPENROUTER_API_KEY   # PASS
oprun --env-file /etc/fireflies-live/op.env -- python3 "$CK" --compare /opt/Thrivbe-AI/.env
#    Expect SAME for all three names. FIREFLY_API_KEY and FIREFLIES_APP_SECRET have no API check (SKIP):
#    SAME here plus the real login and request below are their proof.

# 3. The drop-in, then the restart (this logs Robin out).
install -d -m 755 /etc/systemd/system/fireflies-live.service.d
install -m 644 deploy/fireflies-live.service.d/zz-1password.conf /etc/systemd/system/fireflies-live.service.d/
systemctl daemon-reload
systemctl restart fireflies-live
systemctl show -p ExecStart fireflies-live | grep -c oprun                          # 1
```

## Proof: a real login and a real request

```sh
curl -s -H 'Host: localhost:3017' http://127.0.0.1:3017/api/auth/status
# {"required":true,"configured":true,"authenticated":false}
```

1. **Real login.** Robin opens the app through Tailscale and logs in. The login works, so `FIREFLIES_APP_SECRET` came from 1Password.
2. **Real request.** The Fireflies meeting list loads (`/api/fireflies/meetings` returns 200), and one AI suggestion or chat answer arrives (OpenRouter). In DevTools, `/api/config` shows `firefliesAvailable:true`, `openRouterAvailable:true` and `blockedProviders:[]`.
3. **The policy still reloads live.** Remove `openrouter` from `FIREFLIES_ALLOWED_DATA_PROCESSORS` in `/opt/Thrivbe-AI/.env`. The next `/api/config` shows `blockedProviders:["openrouter"]`, with no restart. Put it back.
4. **Where the keys are.** This prints names and counts only:
   ```sh
   for p in $(pgrep -f 'server/(serve|bridge)\.mjs'); do
     printf '%s  %-40.40s  ' "$p" "$(tr '\0' ' ' </proc/$p/cmdline)"
     tr '\0' '\n' </proc/$p/environ | cut -d= -f1 | grep -c -E '^(FIREFLY_API_KEY|OPENROUTER_API_KEY|FIREFLIES_APP_SECRET)$'
   done
   # node server/serve.mjs → 3   node …/bridge.mjs → 0   (op's own process → 0)
   ```
   Also check `OP_SERVICE_ACCOUNT_TOKEN` is absent from the node processes (`grep -c '^OP_SERVICE_ACCOUNT_TOKEN$'` → 0).
5. **No address leaked into the logs:** `journalctl -u fireflies-live --since "<restart time>" --no-pager | grep -cF 'op://'` → 0.

Then tick B6 off in the 1password skill's `MIGRATION.md`.

## Revert

```sh
rm /etc/systemd/system/fireflies-live.service.d/zz-1password.conf
systemctl daemon-reload && systemctl restart fireflies-live   # logs Robin out again
```

- **This works while `/opt/Thrivbe-AI/.env` still holds plaintext values** for the three keys. After that file itself is switched to `op://`, restore the `.env.old` that `env-to-op.py` keeps.
- **The code can stay:** without oprun and with a plaintext file, it behaves as it did before. To remove it anyway, `git revert` the merge, then pull, build and restart.
- **`/etc/fireflies-live/op.env`** can stay too, since it holds addresses only.

## Watch-out

`Restart=always` with `RestartSec=3` means that while 1Password is unreachable, a restart retries every 3 s, and each try is one 1Password request. That uses up the service account's hourly quota, which is shared across Thrivbe-1. A service that is already running is not affected, because its values were resolved at start. If a restart fails during a 1Password outage, run `systemctl stop fireflies-live` until 1Password is back.
