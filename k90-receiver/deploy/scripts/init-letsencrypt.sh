#!/usr/bin/env bash
# First-time certificate bootstrap. Run from the deploy/ directory after creating .env and pointing DNS at this server.
# nginx cannot start without a cert, so: temporary self-signed cert -> start nginx -> real cert via webroot -> reload.
# NOT TESTED against a live Let's Encrypt endpoint in the development environment (no Docker daemon there).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
: "${DOMAIN:?DOMAIN missing in .env}" "${LETSENCRYPT_EMAIL:?LETSENCRYPT_EMAIL missing in .env}"

docker compose run --rm --entrypoint sh certbot -c "
  mkdir -p '/etc/letsencrypt/live/$DOMAIN' &&
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj '/CN=localhost' \
    -keyout '/etc/letsencrypt/live/$DOMAIN/privkey.pem' -out '/etc/letsencrypt/live/$DOMAIN/fullchain.pem'"

docker compose up -d --build postgres receiver nginx
sleep 5

# Remove ONLY the temporary certificate directory created above, then request the real one.
docker compose run --rm --entrypoint sh certbot -c "
  rm -r '/etc/letsencrypt/live/$DOMAIN' &&
  certbot certonly --webroot -w /var/www/certbot -d '$DOMAIN' --email '$LETSENCRYPT_EMAIL' --agree-tos --no-eff-email"

docker compose exec nginx nginx -s reload
docker compose up -d certbot
echo "Done. Verify: curl -fsS https://$DOMAIN/health"
