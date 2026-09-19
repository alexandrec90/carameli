### Build stage — compile C extensions, then discard the compiler toolchain
# This tag is the project's Python version of record, and `.python-version` is the
# machine-readable copy of it that everything else reads: the lock compiler, the
# scripts, and CI's setup-python all take it from there via
# `script_common.pinned_python()` or `python-version-file`, so this tag and that file
# are the only two places a number appears. `tests/unit/test_python_version_pin.py`
# fails if they disagree, or if anything else spells one out. mypy.ini can read no
# file and is gated by the same test — bump all of them together, deliberately
# (dependabot.yml ignores bot bumps of this tag).
FROM python:3.12-slim AS builder

# uv is the installer for every dependency layer here: the same resolver that
# compiled the locks, an order of magnitude faster than pip. The pinned tag is
# maintained by dependabot's `docker` ecosystem; keep it in step with the
# `uv==` pin in requirements-dev.txt when bumping by hand.
COPY --from=ghcr.io/astral-sh/uv:0.11.29 /uv /bin/uv

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY requirements.txt ./
RUN uv pip install --python python3 --no-cache --prefix=/install -r requirements.txt

### Test-deps stage — layers the in-container test toolchain onto the runtime
### set in /install. Uses requirements-test.txt (pytest stack + contract-test
### deps only), NOT requirements-dev.txt: the dev lock drags in host-only
### tooling (playwright, mypy, locust, ruff, ...) that fattens the image ~5x.
FROM builder AS builder-test

COPY requirements-test.txt ./
RUN uv pip install --python python3 --no-cache --prefix=/install -r requirements-test.txt

### Shared runtime base — slim image, no compiler
FROM python:3.12-slim AS base

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
