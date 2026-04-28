#!/bin/sh
set -e

# Railway provides a single volume. We mount it at /app/storage
# and symlink /app/data and /app/uploads into it so the app
# works without code changes.

STORAGE=/app/storage

# Ensure subdirectories exist on the volume
mkdir -p "$STORAGE/data/backups" \
         "$STORAGE/data/tmp" \
         "$STORAGE/uploads/files" \
         "$STORAGE/uploads/covers" \
         "$STORAGE/uploads/avatars" \
         "$STORAGE/uploads/photos"

# Remove any existing dirs/symlinks and point to the volume
rm -rf /app/data /app/uploads
ln -sf "$STORAGE/data" /app/data
ln -sf "$STORAGE/uploads" /app/uploads

# Maintain backward-compat symlinks (old paths under /app/server/)
mkdir -p /app/server
rm -rf /app/server/uploads /app/server/data
ln -sf "$STORAGE/uploads" /app/server/uploads
ln -sf "$STORAGE/data" /app/server/data

exec "$@"
