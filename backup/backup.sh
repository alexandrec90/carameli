#!/bin/sh
set -eu

: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT is required}"
: "${BACKUP_S3_ACCESS_KEY_ID:?BACKUP_S3_ACCESS_KEY_ID is required}"
: "${BACKUP_S3_SECRET_ACCESS_KEY:?BACKUP_S3_SECRET_ACCESS_KEY is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"

BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-carameli-backups}"
BACKUP_INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"
BACKUP_KEEP_COUNT="${BACKUP_KEEP_COUNT:-14}"
PGHOST="${PGHOST:-db}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-carameli}"
PGDATABASE="${PGDATABASE:-carameli}"

case "$BACKUP_INTERVAL_SECONDS" in
    ''|*[!0-9]*)
        echo "BACKUP_INTERVAL_SECONDS must be a positive integer" >&2
        exit 1
        ;;
esac
case "$BACKUP_KEEP_COUNT" in
    ''|*[!0-9]*)
        echo "BACKUP_KEEP_COUNT must be a positive integer" >&2
        exit 1
        ;;
esac
if [ "$BACKUP_INTERVAL_SECONDS" -eq 0 ] || [ "$BACKUP_KEEP_COUNT" -eq 0 ]; then
    echo "BACKUP_INTERVAL_SECONDS and BACKUP_KEEP_COUNT must be greater than zero" >&2
    exit 1
fi

cleanup_files() {
    rm -f "${dump_path:-}" "${listing_path:-}" "${prune_path:-}"
}
trap cleanup_files EXIT INT TERM

mc alias set target "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" \
    "$BACKUP_S3_SECRET_ACCESS_KEY"

while true; do
    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    object_name="carameli-${timestamp}.dump"
    dump_path="/tmp/${object_name}"
    listing_path="$(mktemp)"
    prune_path="$(mktemp)"

    echo "Creating PostgreSQL backup ${object_name}"
    pg_dump \
        --format=custom \
        --host="$PGHOST" \
        --port="$PGPORT" \
        --username="$PGUSER" \
        --dbname="$PGDATABASE" \
        > "$dump_path"

    echo "Uploading ${object_name} to ${BACKUP_S3_BUCKET}"
    mc cp "$dump_path" "target/${BACKUP_S3_BUCKET}/${object_name}"

    mc ls "target/${BACKUP_S3_BUCKET}/" > "$listing_path"
    awk '$NF ~ /^carameli-/ && $NF ~ /\.dump$/ { print $NF }' "$listing_path" \
        | sort -r \
        | awk -v keep="$BACKUP_KEEP_COUNT" 'NR > keep { print }' \
        > "$prune_path"

    while IFS= read -r expired_object; do
        if [ -n "$expired_object" ]; then
            echo "Pruning expired backup ${expired_object}"
            mc rm "target/${BACKUP_S3_BUCKET}/${expired_object}"
        fi
    done < "$prune_path"

    rm -f "$dump_path" "$listing_path" "$prune_path"
    dump_path=""
    listing_path=""
    prune_path=""

    echo "Backup cycle completed successfully; sleeping ${BACKUP_INTERVAL_SECONDS}s"
    if [ -n "${HEARTBEAT_URL:-}" ]; then
        heartbeat_target="${HEARTBEAT_URL%/}/backup"
        if ! curl --fail --silent --show-error --max-time 5 "$heartbeat_target"; then
            echo "Backup heartbeat ping failed; continuing" >&2
        fi
    fi
    sleep "$BACKUP_INTERVAL_SECONDS"
done
