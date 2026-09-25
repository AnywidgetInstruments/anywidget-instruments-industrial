"""License and citation metadata agree across the repository (GEN-006)."""

from __future__ import annotations

import json
import pathlib
import re

import anywidget_instruments as ai

ROOT = pathlib.Path(__file__).parents[1]
SPDX = "BSD-3-Clause"


def _read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def _cff(key: str) -> str:
    match = re.search(rf"^{key}:\s*(.+)$", _read("CITATION.cff"), re.MULTILINE)
    assert match, f"CITATION.cff has no {key!r}"
    return match.group(1).strip().strip('"')


def test_license_is_declared_everywhere() -> None:
    assert _read("LICENSE").startswith("BSD 3-Clause License")
    assert re.search(rf'^license = "{SPDX}"$', _read("pyproject.toml"), re.MULTILINE)
    assert json.loads(_read("package.json"))["license"] == SPDX
    lock = json.loads(_read("package-lock.json"))
    assert lock["packages"][""]["license"] == SPDX
    assert _cff("license") == SPDX


def test_citation_metadata_follows_the_release() -> None:
    assert _cff("cff-version") == "1.2.0"
    assert _cff("version") == ai.__version__
    assert _cff("repository-code") == "https://github.com/s-celles/anywidget-instruments"
    orcid = re.search(r"orcid: \"https://orcid.org/([0-9X-]+)\"", _read("CITATION.cff"))
    assert orcid and orcid.group(1) in _read("docs/citing.md")
    # the citing page gives the same version as the metadata
    assert f"(Version {ai.__version__})" in _read("docs/citing.md")
    assert f"version = {{{ai.__version__}}}" in _read("docs/citing.md")


def test_no_stale_license_name() -> None:
    for path in ("README.md", "docs/safety.md", "docs/citing.md"):
        assert not re.search(r"\bMIT\b", _read(path)), path
    # the revision history of the specification keeps the former license
    gen006 = next(line for line in _read("docs/specification.md").splitlines() if "GEN-006" in line)
    assert "BSD 3-Clause" in gen006
