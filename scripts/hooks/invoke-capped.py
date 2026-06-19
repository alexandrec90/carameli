#!/usr/bin/env python3
"""Runs a shell command and caps combined stdout+stderr to stay within context limits.

Usage: python3 scripts/hooks/invoke-capped.py --command "cmd" [--max-bytes 4000] [--head-bytes 2000]
"""
import argparse
import subprocess
import sys


def cap_output(data: bytes, max_bytes: int, head_bytes: int) -> bytes:
    if len(data) <= max_bytes:
        return data
    tail_bytes = max_bytes - head_bytes
    head = data[:head_bytes]
    tail = data[max(0, len(data) - tail_bytes):] if tail_bytes > 0 else b''
    skipped = len(data) - max_bytes
    marker = f'\n... [truncated bytes={skipped}] ...\n'.encode()
    return head + marker + tail


parser = argparse.ArgumentParser()
parser.add_argument('--command', required=True)
parser.add_argument('--max-bytes', type=int, default=4000)
parser.add_argument('--head-bytes', type=int, default=2000)
args = parser.parse_args()

if args.max_bytes < 512:
    print('--max-bytes must be >= 512', file=sys.stderr)
    sys.exit(1)

head_bytes = min(args.head_bytes, args.max_bytes)

result = subprocess.run(args.command, shell=True, capture_output=True)
combined = result.stdout + result.stderr
capped = cap_output(combined, args.max_bytes, head_bytes)

sys.stdout.buffer.write(capped)
if capped and not capped.endswith(b'\n'):
    sys.stdout.buffer.write(b'\n')

sys.exit(result.returncode)
