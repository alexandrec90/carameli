FROM minio/mc:latest AS minio-client

FROM postgres:18-alpine

COPY --from=minio-client /usr/bin/mc /usr/local/bin/mc
COPY backup.sh /usr/local/bin/backup.sh

RUN apk add --no-cache curl && chmod 0755 /usr/local/bin/backup.sh

ENTRYPOINT ["/usr/local/bin/backup.sh"]
