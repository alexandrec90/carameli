### Build stage — compile C extensions, then discard the compiler toolchain
FROM python:3.14-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

### Test-deps stage — layers the in-container test toolchain onto the runtime
### set in /install. Uses requirements-test.txt (pytest stack + contract-test
### deps only), NOT requirements-dev.txt: the dev lock drags in host-only
### tooling (playwright, mypy, locust, ruff, ...) that fattens the image ~5x.
FROM builder AS builder-test

COPY requirements-test.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements-test.txt

### Shared runtime base — slim image, no compiler
FROM python:3.14-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

### Dev image — runtime + pytest toolchain. docker-compose.yml targets this so
### `docker compose exec app pytest` survives image rebuilds (scripts/run-tests.py
### runs the backend suite in the container).
FROM base AS dev

COPY --from=builder-test /install /usr/local

COPY . .

### Runtime image — last stage, so a plain `docker build .` (production) still
### produces the slim image with no test toolchain.
FROM base AS runtime

COPY --from=builder /install /usr/local

COPY . .
