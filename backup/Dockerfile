FROM pgsty/mc:RELEASE.2026-09-16T00-00-00Z@sha256:cfc83108c3abb371f8fb84d99c1fdc88f8c237e022409b0081fb7c0a3be634dd AS minio-client

FROM postgres:18-alpine

COPY --from=minio-client /usr/bin/mc /usr/local/bin/mc
COPY backup.sh /usr/local/bin/backup.sh

RUN apk add --no-cache curl && chmod 0755 /usr/local/bin/backup.sh

ENTRYPOINT ["/usr/local/bin/backup.sh"]
