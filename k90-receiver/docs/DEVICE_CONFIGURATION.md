# Configuring the eSSL K90 to push to the Oracle server

## Read this first

The exact menu names and paths differ between K90 firmware versions and I could not inspect the physical device or
its manual from the development environment. **This guide therefore does not claim a specific menu path.** It lists
what must be configured and where on ZKTeco-family terminals such settings usually live, with blanks for you to fill in
from the real screens. Do not trust a path here until you have confirmed it on your unit, and record what you find in
the "Observed on this device" table so the next person does not have to guess.

## Step 0: record the device facts

| Item | Where to read it | Observed on this device |
|---|---|---|
| Serial number | Device info / system info menu, or the label on the back | _fill in_ |
| Firmware version | Device info / system info menu | _fill in_ |
| Platform / push version | Device info menu if shown; otherwise the `pushver` parameter in the first captured request | _fill in_ |
| Date, time, timezone | Date/time menu | _fill in_ |
| Network mode (static IP / DHCP) | Communication / network menu | _fill in_ |

Take a photo of each screen and keep them in `docs/screenshots/`.

## Step 1: prepare the server

1. Deploy the stack (`README.md`). Confirm `curl http://<server-ip>/health` returns `{"status":"ok",...}` from another network.
2. Confirm TCP 80 (and 443) are open in both the OCI security list and the VM firewall (`NETWORK.md`).
3. Decide address style: **domain name** (preferred, survives IP changes) or the Oracle **public IP**.
4. Set `DEVICE_TIMEZONE` in `deploy/.env` to the timezone the K90's clock shows, then restart the receiver.

## Step 2: network settings on the device

Settings to check in the communication/network menu (commonly titled "Comm.", "Network", or "Ethernet"):

- IP address, subnet mask, gateway: valid for the site LAN (DHCP is fine).
- **DNS server**: required if you use a domain name. Set a public resolver such as `8.8.8.8` or the site router. If the
  firmware has no DNS field, use the public IP address instead.
- Gateway must route to the internet; the device connects *outbound* only. No port forwarding is needed on the site router.

## Step 3: enable ADMS / cloud push

On ZKTeco-family firmware this is usually under a menu called **"Cloud Server Setting"**, **"ADMS"**, or similar inside the
communication menu. Look for the following fields, and note their exact labels on your unit:

| Setting | Value to enter |
|---|---|
| Enable domain name / use domain | On if using a hostname, Off if using an IP |
| Server address | `<your domain>` or the Oracle public IP (no `http://`, no path) |
| Server port | `80` (the port nginx serves the device endpoint on). Some firmware fixes this field or defaults to 8081; if the port cannot be set to 80, either change the nginx `listen`/OCI rules to match or use the port the device insists on |
| HTTPS / secure | Off unless the firmware offers it and you have confirmed it works. Then use port 443, see `NETWORK.md` |
| Proxy | Off |
| Server mode | ADMS (if there is a choice between ADMS and other modes) |

If your K90 has no such menu at all, it may be a firmware without push support. In that case the receiver cannot work
and a different integration method (device SDK pull from a machine on the site LAN) is required. Report that
finding rather than forcing this approach.

## Step 4: restart and watch

1. Save settings, then reboot the device (power cycle or the firmware's restart option) so it re-registers.
2. On the server: `docker compose logs -f receiver` and watch the dashboard **Monitor** page.
3. Within about a minute you should see `GET /iclock/cdata?SN=...` (registration, kind `registration`) and then
   repeating `GET /iclock/getrequest?SN=...` (kind `heartbeat`).
4. The **Devices** page should list the real serial, without a SIMULATED badge, as Online.
5. Have an enrolled employee punch. A `POST /iclock/cdata?...table=ATTLOG` request should arrive; the **Attendance** page should show the PIN and the device-clock time.
6. Copy the first registration, heartbeat and ATTLOG requests from the Monitor page into `docs/captures/` and update `PROTOCOL.md`.

## Step 5: lock down

After the first real connection: set `ALLOWED_DEVICE_SERIALS=<real serial>` in `deploy/.env`, set `AUTO_REGISTER_DEVICES=false`,
and `docker compose up -d receiver`. If the site has a static public IP, also fill `deploy/nginx/device-allow.conf`.

## Troubleshooting

| Symptom | Check |
|---|---|
| Nothing in Monitor | Device DNS/gateway; try the IP instead of the domain; OCI security list; VM iptables; `curl http://<server>/health` from the site LAN |
| Registration arrives but no heartbeats | Device may use another path or parameter: look for `unhandled` rows in Monitor and compare with `PROTOCOL.md` |
| Rows `rejected` | SN not in `ALLOWED_DEVICE_SERIALS`, or `AUTO_REGISTER_DEVICES=false` |
| Times off by hours | `DEVICE_TIMEZONE` does not match the device clock |
| Punches show `failed`/`partial` | Open the raw body in Monitor; format differs from the assumption, fix the parser and add the capture as a test |
| Device shows "server error" | Look at `docker compose logs receiver` and `GET /health` |
