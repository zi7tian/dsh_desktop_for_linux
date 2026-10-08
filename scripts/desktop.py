#!/usr/bin/env python3
"""Prepare a pinned upstream checkout and build the Linux x86_64 installers."""

import argparse
import hashlib
import json
import platform
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def git(directory, *arguments):
    """Run Git in one checkout and return its captured standard output."""
    return subprocess.check_output(
        ["git", "-C", str(directory), *arguments], text=True
    ).strip()


def sha256(path):
    """Hash a file without loading the complete installer into memory."""
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prepare_checkout(source, patch, lock):
    """Apply the locked patch once; refuse unrelated staged or unstaged edits."""
    if sha256(patch) != lock["patch_sha256"]:
        raise RuntimeError("Patch checksum differs from upstream.lock.json")
    if git(source, "rev-parse", "HEAD") != lock["commit"]:
        raise RuntimeError("Build checkout is not at the pinned upstream commit")
    if git(source, "diff", "--name-only") or git(
        source, "ls-files", "--others", "--exclude-standard"
    ):
        raise RuntimeError("Build checkout has local edits; preserve them before rebuilding")
    tree = git(source, "write-tree")
    if tree == git(source, "rev-parse", "HEAD^{tree}"):
        git(source, "apply", "--check", "--index", str(patch))
        git(source, "apply", "--index", str(patch))
    if git(source, "write-tree") != lock["patched_tree"]:
        raise RuntimeError("Patched source tree differs from upstream.lock.json")


def prepare(root):
    """Keep the submodule pristine and apply desktop changes in .work/source."""
    lock = json.loads((root / "upstream.lock.json").read_text())
    patch = root / "patches/linux-desktop.patch"
    if sha256(patch) != lock["patch_sha256"]:
        raise RuntimeError("Patch checksum differs from upstream.lock.json")
    entry = git(root, "ls-files", "--stage", "upstream").split()
    if len(entry) != 4 or entry[:2] != ["160000", lock["commit"]]:
        raise RuntimeError("Submodule gitlink differs from upstream.lock.json")
    if git(root, "config", "-f", ".gitmodules", "--get", "submodule.upstream.url") != lock["repository"]:
        raise RuntimeError("Submodule URL differs from upstream.lock.json")
    upstream = root / "upstream"
    if (upstream / ".git").exists() and git(upstream, "status", "--porcelain"):
        raise RuntimeError("Upstream submodule has local edits; preserve them before preparing")
    git(root, "submodule", "update", "--init", "--depth", "1", "--", "upstream")
    if git(upstream, "rev-parse", "HEAD") != lock["commit"]:
        raise RuntimeError("Upstream checkout does not match its pin")
    source = root / ".work/source"
    if not source.exists():
        source.parent.mkdir(parents=True, exist_ok=True)
        git(root, "clone", "--shared", "--no-checkout", str(upstream), str(source))
        git(source, "checkout", "--detach", lock["commit"])
    prepare_checkout(source, patch, lock)
    print(f"Verified upstream {lock['commit']} + desktop patch", flush=True)
    return source, lock


def installers(directory, version):
    """Reject missing or misnamed archives and calculate their release checksums."""
    names = {
        f"deepseek-harness-{version}-linux-amd64.deb": b"!<arch>\n",
        f"deepseek-harness-{version}-linux-x86_64.rpm": b"\xed\xab\xee\xdb",
        f"deepseek-harness-{version}-linux-x86_64.pkg.tar.zst": b"\x28\xb5\x2f\xfd",
    }
    result = {}
    for name, magic in names.items():
        path = directory / name
        with path.open("rb") as stream:
            if stream.read(len(magic)) != magic:
                raise RuntimeError(f"Unexpected installer format: {name}")
        result[name] = sha256(path)
    return result


def build(root):
    """Build through upstream's Linux profile entry and collect exactly three packages."""
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "amd64"):
        raise RuntimeError("Packaging requires a Linux x86_64 host; ARM is unsupported")
    for tool in ("git", "node", "pnpm", "rpmbuild", "tar", "xz", "zstd"):
        if shutil.which(tool) is None:
            raise RuntimeError(f"Required build tool not found: {tool}")
    source, lock = prepare(root)
    configuration = root / ".env.linux"
    if not configuration.exists():
        configuration = root / ".env.linux.example"
    shutil.copyfile(configuration, source / "apps/desktop/.env.linux")
    subprocess.run(["pnpm", "install", "--frozen-lockfile"], cwd=source, check=True)
    subprocess.run(["pnpm", "run", "package:desktop:linux:x64"], cwd=source, check=True)
    artifacts = source / "apps/desktop/.desktop-build/targets/linux-x64/artifacts"
    hashes = installers(artifacts, lock["version"])
    output = root / "dist"
    output.mkdir(exist_ok=True)
    for name in hashes:
        shutil.copyfile(artifacts / name, output / name)
    if installers(output, lock["version"]) != hashes:
        raise RuntimeError("Copied installer checksums differ from build output")
    (output / "SHA256SUMS").write_text(
        "".join(f"{digest}  {name}\n" for name, digest in sorted(hashes.items()))
    )
    (output / "build-info.json").write_text(json.dumps({
        "packaging_commit": git(root, "rev-parse", "HEAD"),
        "packaging_dirty": bool(git(root, "status", "--porcelain")),
        "upstream": lock,
        "sha256": hashes,
    }, indent=2) + "\n")
    print(f"Installers and checksums written to {output}")


def main():
    """Expose source preparation, source verification, and installer creation."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "verify", "build"))
    command = parser.parse_args().command
    if command == "build":
        build(ROOT)
    else:
        prepare(ROOT)


if __name__ == "__main__":
    main()
