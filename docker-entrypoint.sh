#!/bin/sh
set -e

# Railway provides a single volume. We mount it at /app/storage
# for SQLite data. Uploads go to S3 object storage.

STORAGE=/app/storage

# Ensure data directories exist on the volume (SQLite + backups)
mkdir -p "$STORAGE/data/backups" \
         "$STORAGE/data/tmp"

# Symlink data into the app directory
rm -rf /app/data
ln -sf "$STORAGE/data" /app/data

# Backward-compat symlinks for /app/server/ paths
mkdir -p /app/server
rm -rf /app/server/data
ln -sf "$STORAGE/data" /app/server/data

# Temp directory for multer uploads (before S3 transfer)
mkdir -p /app/.tmp-uploads

exec "$@"
