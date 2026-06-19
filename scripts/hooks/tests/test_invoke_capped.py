"""Unit tests for the invoke-capped output-capping helper."""
from conftest import load_module

hook = load_module('scripts/hooks/invoke-capped.py')


# --- cap_output ---

def test_small_output_passthrough():
    data = b'hello world'
    assert hook.cap_output(data, max_bytes=4000, head_bytes=2000) == data


def test_exact_boundary_passthrough():
    data = b'a' * 2000
    assert hook.cap_output(data, max_bytes=2000, head_bytes=1000) == data


def test_oversized_truncates_with_marker():
    data = b'a' * 12000
    out = hook.cap_output(data, max_bytes=2000, head_bytes=1000)
    assert b'[truncated bytes=10000]' in out
    # head + marker + tail stays close to the cap (marker adds a small overhead)
    assert len(out) < 2000 + 64


def test_head_and_tail_windows_preserved():
    data = b'H' * 1000 + b'M' * 10000 + b'T' * 1000
    out = hook.cap_output(data, max_bytes=2000, head_bytes=1000)
    assert out.startswith(b'H' * 1000)
    assert out.endswith(b'T' * 1000)


def test_head_bytes_clamped_to_max():
    data = b'a' * 5000
    # head_bytes > max_bytes must not raise or produce a negative tail
    out = hook.cap_output(data, max_bytes=2000, head_bytes=9999)
    assert b'[truncated bytes=3000]' in out


def test_zero_head_keeps_only_tail():
    data = b'H' * 1000 + b'T' * 4000
    out = hook.cap_output(data, max_bytes=2000, head_bytes=0)
    assert out.endswith(b'T' * 2000)
    assert b'[truncated bytes=3000]' in out


# --- run_capped ---

def test_run_capped_preserves_exit_code():
    code, _ = hook.run_capped('exit 7', max_bytes=4000, head_bytes=2000)
    assert code == 7


def test_run_capped_captures_stdout():
    code, out = hook.run_capped('echo hello', max_bytes=4000, head_bytes=2000)
    assert code == 0
    assert b'hello' in out


def test_run_capped_merges_stderr():
    code, out = hook.run_capped('echo err 1>&2', max_bytes=4000, head_bytes=2000)
    assert code == 0
    assert b'err' in out


# --- main argument validation ---

def test_main_rejects_tiny_max_bytes(capsys):
    rc = hook.main(['--command', 'echo hi', '--max-bytes', '10'])
    assert rc == 1
    assert 'must be >=' in capsys.readouterr().err
