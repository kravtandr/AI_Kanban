"""Exercise the deployed backup script with a failing/successful pg_dump."""

import os
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "deploy" / "backup.sh"


def test_failed_dump_is_not_published_or_reported_successful(tmp_path):
    fake = tmp_path / "bin"
    fake.mkdir()
    dump = fake / "pg_dump"
    dump.write_text("#!/bin/sh\necho partial\nexit 1\n")
    dump.chmod(0o755)
    backups = tmp_path / "backups"
    backups.mkdir()
    result = subprocess.run(
        ["sh", str(SCRIPT), "--once"],
        env={**os.environ, "PATH": f"{fake}:{os.environ['PATH']}", "BACKUP_DIR": str(backups)},
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "backup FAILED" in result.stderr
    assert list(backups.iterdir()) == []


def test_successful_dump_is_compressed_and_published(tmp_path):
    import gzip

    fake = tmp_path / "bin"
    fake.mkdir()
    dump = fake / "pg_dump"
    dump.write_text("#!/bin/sh\necho 'SELECT 1;'\n")
    dump.chmod(0o755)
    backups = tmp_path / "backups"
    backups.mkdir()
    result = subprocess.run(
        ["sh", str(SCRIPT), "--once"],
        env={**os.environ, "PATH": f"{fake}:{os.environ['PATH']}", "BACKUP_DIR": str(backups)},
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    outputs = list(backups.glob("*.sql.gz"))
    assert len(outputs) == 1
    assert gzip.decompress(outputs[0].read_bytes()) == b"SELECT 1;\n"
