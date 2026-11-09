# VPS Deployment

This setup runs the Angular production build and Node API in one container. Caddy is the only public-facing service: it obtains and renews HTTPS certificates and protects the whole site, including ownership updates, with HTTP Basic Authentication. The CardSight JSON is bind-mounted from `deploy/data/`, so card ownership survives container rebuilds and restarts.

## Requirements

- A Linux VPS with Docker Engine and the Docker Compose plugin.
- A DNS `A` record for the chosen domain pointing to the VPS. Add an `AAAA` record only if IPv6 is configured on the VPS.
- Firewall rules that allow inbound TCP ports 80 and 443 (and UDP 443 for HTTP/3). Do not expose port 3000.
- A rotated CardSight API key for card images.

## Prepare the server

Copy this app directory to the VPS, preserving its `deploy/` directory. On the machine where the CardSight export is available, prepare the persistent data file:

```sh
cd baseball_card_tracker/topps-card-gallery-angular
./deploy/prepare-data.sh
```

Copy the app directory, including `deploy/data/cards.json`, to the VPS. On the VPS, set `APP_UID` and `APP_GID` in `deploy/.env` to the owner IDs of `deploy/data` (`id -u` and `id -g` are usually the right values). The app runs as that user so it can update the mounted JSON without running as root.

Create the deployment environment file and enter the values directly on the VPS:

```sh
cd deploy
cp .env.example .env
```

Set `DOMAIN` and `CARDSIGHT_API_KEY`. Create a long, unique password for the group, then generate a Caddy bcrypt hash on the VPS:

```sh
docker run --rm -it caddy:2-alpine caddy hash-password --algorithm bcrypt
```

The command prompts for the password without echoing it and prints the bcrypt hash. Put the username and resulting hash into `.env`. Keep `.env` and `data/cards.json` private; neither belongs in source control. The supplied `.env.example` contains placeholders only.

## Start and update

After DNS points to the VPS and ports 80/443 are open:

```sh
docker compose up -d --build
docker compose ps
docker compose logs -f app caddy
```

Open `https://<DOMAIN>` and sign in with the configured shared username and password. To deploy an update, copy the updated app files while preserving `deploy/.env` and `deploy/data/cards.json`, then run `docker compose up -d --build` again. Back up `deploy/data/cards.json` regularly; it contains the ownership state.

For stronger account management, audit logs, or per-person access, put the app behind an identity-aware access proxy instead of sharing one Basic Auth password. Do not publish the Node container's port directly: the ownership API is intended to be reachable only behind this authenticated proxy.