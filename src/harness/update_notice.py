"""Update discovery for the interactive menu and fast-forward source installs."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

if __package__:
    from .cli import cmp_versions, fetch_text
else:
    from cli import cmp_versions, fetch_text


REPO = "TheElephantCoder/agent-harness"
UPSTREAM = f"https://github.com/{REPO}"


def git(root, *args):
    return subprocess.run(["git", *args], cwd=root, text=True, capture_output=True,
                          timeout=8, check=True).stdout.strip()


def official_main(root):
    remote = git(root, "config", "--get", "remote.origin.url").removesuffix(".git")
    return (remote in (UPSTREAM, f"git@github.com:{REPO}", f"ssh://git@github.com/{REPO}")
            and git(root, "symbolic-ref", "--short", "HEAD") == "main")


def available(kind, root, version):
    try:
        if root and (Path(root) / ".git").exists():
            if not official_main(root):
                return False
            head = git(root, "rev-parse", "HEAD")
            url = f"https://api.github.com/repos/{REPO}/compare/{head}...main?per_page=1"
            result = json.loads(fetch_text(url, 2 * 1024 * 1024) or "{}")
            return result.get("status") == "ahead"
        if kind == "npm":
            if not root or Path(root).parts[-3:] != ("node_modules", "@theelephantcoder", "agent-harness"):
                return False
            manifest = "package.json"
        elif kind == "pip" and {"site-packages", "dist-packages"}.intersection(Path(__file__).parts):
            manifest = "pyproject.toml"
        else:
            return False
        data = fetch_text(f"https://raw.githubusercontent.com/{REPO}/main/{manifest}", 65536)
        if not data:
            return False
        if kind == "npm":
            remote = json.loads(data).get("version")
        else:
            match = re.search(r'^version\s*=\s*"([^"]+)"', data, re.M)
            remote = match.group(1) if match else None
        return bool(isinstance(remote, str) and re.fullmatch(r"\d+\.\d+\.\d+", remote)
                    and cmp_versions(version, remote) < 0)
    except (OSError, ValueError, AttributeError, subprocess.SubprocessError):
        return False


def should_offer(kind, root, version):
    """Check once per day per installation, outside CI and agent sessions."""
    if os.environ.get("NO_UPDATE_NOTIFIER") or any(
        os.environ.get(name, "").lower() not in ("", "0", "false")
        for name in ("CI", "CODEX_CI", "CLAUDECODE", "CURSOR_AGENT")
    ):
        return False

    # Only the POSIX full-screen picker requests optional update notices.
    import fcntl
    try:
        cache_base = os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache"
        directory = Path(cache_base) / "agent-harness"
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        install = root or sys.prefix
        key = hashlib.sha256(os.fsencode(f"{kind}:{install}")).hexdigest()[:16]
        with (directory / f"update-{key}").open("a+b") as stamp:
            # Parallel terminals should neither wait nor issue duplicate checks.
            fcntl.flock(stamp, fcntl.LOCK_EX | fcntl.LOCK_NB)
            stamp.seek(0)
            saved = stamp.read(32).strip()
            now = int(time.time())
            if saved.isdigit() and 0 <= now - int(saved) < 86400:
                return False
            offer = available(kind, root, version)
            stamp.seek(0)
            stamp.truncate()
            stamp.write(str(now).encode("ascii"))
            return offer
    except (OSError, RuntimeError):
        return False


def update_checkout(root):
    try:
        if not official_main(root):
            print("[harness] automatic updates require main and the agent-harness origin.")
            return False
        if git(root, "status", "--porcelain", "--untracked-files=no"):
            print("[harness] commit or stash your tracked changes before updating.")
            return False
        result = subprocess.run(["git", "pull", "--no-autostash", "--no-rebase", "--ff-only", "origin", "main"], cwd=root)
        if result.returncode == 0:
            print("[harness] checkout updated. Restart harness to use it.")
            return True
    except (OSError, subprocess.SubprocessError) as error:
        print(f"[harness] upgrade failed: {error}")
    return False


if __name__ == "__main__":
    if sys.argv[1] == "check":
        sys.exit(0 if should_offer(*sys.argv[2:]) else 1)
    if sys.argv[1] == "update-checkout":
        sys.exit(0 if update_checkout(sys.argv[2]) else 1)
    sys.exit(2)
