#!/usr/bin/env python3
"""Runs a shell command and caps combined stdout+stderr to stay within context limits.

`cap_output` is a pure function unit-tested via pytest
(`scripts/hooks/tests/test_invoke_capped.py`).

Usage: python3 scripts/hooks/invoke-capped.py --command "cmd" [--max-bytes 4000] [--head-bytes 2000]
"""
import argparse
import subprocess
import sys

MIN_MAX_BYTES = 512


def cap_output(data: bytes, max_bytes: int, head_bytes: int) -> bytes:
    """Cap `data` to `max_bytes`, keeping a head window and a tail window."""
    if len(data) <= max_bytes:
        return data
    head_bytes = min(head_bytes, max_bytes)
    tail_bytes = max_bytes - head_bytes
    head = data[:head_bytes]
    tail = data[max(0, len(data) - tail_bytes):] if tail_bytes > 0 else b''
    skipped = len(data) - max_bytes
    marker = f'\n... [truncated bytes={skipped}] ...\n'.encode()
    return head + marker + tail


def run_capped(command: str, max_bytes: int, head_bytes: int) -> tuple[int, bytes]:
    """Run `command` in a shell and return (exit_code, capped combined output)."""
    # shell=True is the whole point: this wrapper caps the output of an arbitrary
    # shell command. The command is agent-supplied tooling, not external input.
    result = subprocess.run(command, shell=True, capture_output=True)  # noqa: S602
    combined = result.stdout + result.stderr
    return result.returncode, cap_output(combined, max_bytes, head_bytes)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--command', required=True)
    parser.add_argument('--max-bytes', type=int, default=4000)
    parser.add_argument('--head-bytes', type=int, default=2000)
    args = parser.parse_args(argv)

    if args.max_bytes < MIN_MAX_BYTES:
        print(f'--max-bytes must be >= {MIN_MAX_BYTES}', file=sys.stderr)
        return 1

    exit_code, capped = run_capped(args.command, args.max_bytes, args.head_bytes)

    sys.stdout.buffer.write(capped)
    if capped and not capped.endswith(b'\n'):
        sys.stdout.buffer.write(b'\n')

    return exit_code


if __name__ == '__main__':
    sys.exit(main())
