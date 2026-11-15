# Network and firewall requirements (Oracle Cloud)

## Flows

| Direction | From | To | Port/Proto | Purpose | Exposure |
|---|---|---|---|---|---|
| Inbound | K90 (outbound from the site) | Oracle VM | **TCP 80** (HTTP) | ADMS push: `/iclock/*` | Public (device cannot be IP-pinned unless site has static IP) |
| Inbound | Browser | Oracle VM | **TCP 443** (HTTPS) | Dashboard and `/api`, optional TLS device endpoint | Public, protected by token |
| Inbound | Let's Encrypt | Oracle VM | TCP 80 | ACME HTTP-01 challenge | Public |
| Inbound | Admin | Oracle VM | **TCP 22** | SSH | Restricted to admin source IP(s) |
| Internal | receiver | postgres | TCP 5432 | Database | Docker internal network only; **never published** |

The device connects outbound to the Oracle endpoint. The server never connects to the K90's LAN address.
The port the K90 uses is assumed to be configurable and defaults to 80 here; confirm on the device (`DEVICE_CONFIGURATION.md`). If the firmware requires another port, open that
port instead and add a matching `listen` in `deploy/nginx/nginx.conf.template`.

## Oracle Cloud Infrastructure

1. **VCN security list (or NSG) ingress rules** for the VM's subnet. Remove any "allow all":

   | Source CIDR | Proto | Dest port | Note |
   |---|---|---|---|
   | `<admin-ip>/32` | TCP | 22 | SSH |
   | `0.0.0.0/0` | TCP | 80 | device push + ACME |
   | `0.0.0.0/0` | TCP | 443 | dashboard |

   Do not add 5432. Egress: allow all (package pulls, Let's Encrypt).
2. **Reserved public IP** so the address does not change on VM stop/start.
3. **Block volume (200 GB)**: attach, format, mount at `/mnt/data` via `/etc/fstab` (use `UUID=` and `_netdev,nofail`), then `mkdir -p /mnt/data/k90/pgdata`.
   `PG_DATA_DIR` in `.env` points there.
4. **DNS**: A record for `DOMAIN` to the reserved IP.

## VM firewall (Ubuntu on OCI)

Oracle's Ubuntu images ship with iptables rules that reject everything except SSH, so the OCI rule alone is not enough.

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

(Verify the insert position with `sudo iptables -L INPUT --line-numbers`; the rules must come before the final REJECT.)
Docker publishes ports 80/443 itself via its own chains; the INPUT rules above matter on images that filter before Docker.

Restrict SSH: key-only auth (`PasswordAuthentication no` in `/etc/ssh/sshd_config`), source-limited in the OCI rule above,
optionally `fail2ban`. Keep unattended security upgrades enabled.

## HTTP vs HTTPS for the device

ADMS push on this class of device is normally plain HTTP. Consequences: punch data (PIN, time) and the serial number
travel unencrypted between site and Oracle and can be read or injected by anyone on the path. Mitigations in this design:

- Only `/iclock/*` is served over HTTP; the dashboard and API are HTTPS-only (HTTP redirects).
- No secrets, biometric templates or passwords are accepted into storage (redacted on ingest).
- Serial allow-list, optional source-IP allow-list, rate limiting, strict parsing.
- A forged request can at worst insert a fake punch for a known serial. If that threat matters, use a VPN
  (e.g. WireGuard from the site router) so device traffic is not on the open internet, or use HTTPS if the firmware supports it.

If the K90 firmware offers HTTPS push: enable it on the device, use port 443; the same `/iclock/` location exists in the TLS server block.
Many device TLS stacks reject modern TLS or Let's Encrypt chains, so test before relying on it.

## Monitoring

- `GET /health` (public) returns database state and free space of the data volume; Docker `HEALTHCHECK` uses it.
- `deploy/scripts/monitor.sh` (cron every 5 minutes) logs to syslog on database failure, degraded status or low disk.
- Container logs rotate (10 MB × 5). Application logs are structured JSON (pino).
- `deploy/scripts/backup.sh` daily `pg_dump`, 14 day retention. Copy dumps off the VM (e.g. to Object Storage) as well.
