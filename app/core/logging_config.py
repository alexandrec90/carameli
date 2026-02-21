from __future__ import annotations

import logging
import logging.handlers
from pathlib import Path


def configure_logging(log_level: str = "INFO", log_file: str = "logs/voicegateway.log") -> None:
    """Set up console + rotating file logging.

    Format is intentionally structured for easy machine parsing:
        2026-02-21 14:30:00.123 | INFO     | app.main:23 | Starting VoiceGateway…
    """
    level = getattr(logging, log_level.upper(), logging.INFO)

    log_fmt = "%(asctime)s.%(msecs)03d | %(levelname)-8s | %(name)s:%(lineno)d | %(message)s"
    date_fmt = "%Y-%m-%d %H:%M:%S"
    formatter = logging.Formatter(fmt=log_fmt, datefmt=date_fmt)

    root = logging.getLogger()
    root.setLevel(level)
    # Remove any handlers already attached (e.g. from a previous basicConfig call)
    root.handlers.clear()

    # Console handler — keep INFO+ visible in docker logs / terminal
    console_handler = logging.StreamHandler()
    console_handler.setLevel(level)
    console_handler.setFormatter(formatter)
    root.addHandler(console_handler)

    # Rotating file handler — 10 MB per file, keep last 5 files (~50 MB max)
    log_path = Path(log_file)
    log_path.parent.mkdir(parents=True, exist_ok=True)

    file_handler = logging.handlers.RotatingFileHandler(
        filename=log_path,
        maxBytes=10 * 1024 * 1024,  # 10 MB
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setLevel(level)
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)
