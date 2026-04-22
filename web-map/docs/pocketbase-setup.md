# PocketBase Superuser Setup

This application uses a local [PocketBase](https://pocketbase.io/) instance inside a Docker container for authenticated workspace features and user data synchronization.

## Docker Deployment Data Persistence

When deploying this application on PaaS platforms like **Dokploy**, Docker Compose is used to orchestrate the containers. By default, Docker Compose scopes named volumes using the directory name as a prefix. Because Dokploy often creates new directories for each deployment (e.g. `...-xybunn`, `...-abcde`), default volumes will be recreated and reset on every push.

To solve this, the `docker-compose.yml` file explicitly forces a static name for the database volume:

```yaml
volumes:
  pb_data:
    name: pocketbase_data
```

This ensures the exact same volume (`pocketbase_data`) is mounted across all future updates, preventing your user accounts and saved workspaces from being wiped during a `git push`.

## Creating the Initial Superuser

When deploying the application for the very first time (or after completely destroying the `pocketbase_data` volume), you will need to create an initial superuser account. 

### Method 1: Web Interface (Recommended)
Because the `pocketbase` container spins up instantly upon deployment, the easiest way to create your superuser is via the browser:
1. Navigate to your VPS IP or Domain at the PocketBase root path: `http://<YOUR_VPS_IP>:8090/_/` (or `https://<YOUR_DOMAIN>/_/` if configured with a reverse proxy).
2. The UI will automatically redirect to `/pbinstall` to set up the first administrator.
3. Enter your administrator email and a strong password.
4. Click **Create** and you are ready to go.

### Method 2: Command Line (CLI)
If you prefer or require terminal access, you can run the superuser creation command directly inside the running container. 

**Important:** You must use `docker exec` against the running container, or be in the correct active deployment directory if using `docker compose run`:

```bash
# Using docker exec (easiest, ignores working directory)
docker exec -it pocketbase superuser upsert admin@example.com YOUR_PASSWORD --dir /pb_data

# OR using docker compose (requires being in the correct code directory)
docker compose run --rm pocketbase superuser upsert admin@example.com YOUR_PASSWORD --dir /pb_data
```

> **Note:** Do *not* prepend the `pocketbase` executable name in the `docker compose run` command, as the image's ENTRYPOINT already calls the binary.
