# Pokkit

Self-hosted file storage server for [MemoryGuy](https://github.com/Jeffrey0117/MemoryGuy).

Upload files, get a URL back, stream them anywhere. Designed as the backend for MemoryGuy's disk virtualizer — push large files to Pokkit, keep tiny pointer files locally.

## Quick Start

```bash
npm install
npm start
```

Server starts on `http://0.0.0.0:8877`.

## Usage

```bash
# Upload a file
curl -F "file=@photo.jpg" http://localhost:8877/upload
# → { "url": "http://localhost:8877/files/{id}/photo.jpg", "id": "..." }

# Download / view
curl http://localhost:8877/files/{id}/photo.jpg

# Check existence
curl -I http://localhost:8877/files/{id}/photo.jpg

# List all files
curl http://localhost:8877/files

# Storage stats
curl http://localhost:8877/status

# Delete a file
curl -X DELETE http://localhost:8877/files/{id}
```

## Configuration

| Method | Example |
|--------|---------|
| CLI args | `npm start -- --port 9000 --data-dir ./storage` |
| Env vars | `POKKIT_PORT=9000 POKKIT_API_KEY=secret npm start` |

| Option | Default | Description |
|--------|---------|-------------|
| `--port` / `POKKIT_PORT` | `8877` | Server port |
| `--host` / `POKKIT_HOST` | `0.0.0.0` | Bind address |
| `--data-dir` / `POKKIT_DATA_DIR` | `./data` | File storage directory |
| `--api-key` / `POKKIT_API_KEY` | _(none)_ | Bearer token for protected endpoints |
| `--max-file-size` / `POKKIT_MAX_FILE_SIZE` | `524288000` (500MB) | Max upload size in bytes |

## Auth

When `apiKey` is set, these endpoints require `Authorization: Bearer <key>`:
- `POST /upload`
- `GET /files` (list)
- `GET /status`
- `DELETE /files/:id`

File download (`GET /files/:id/:filename`) and HEAD are always public, so REPIC/REVID viewers can stream directly.

## License

MIT
