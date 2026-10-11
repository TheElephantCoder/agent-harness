"""PTY bridge for the agent-harness web GUI terminal tab.

Usage: python3 gui-pty.py <cols> <rows> <cmd> [args ...]

Creates a real pseudo-terminal, runs the given command attached to it, and
bridges bytes both ways over this process's own stdin/stdout (which are
plain pipes owned by the node server). Exits when the child exits.

No third-party dependencies; stdlib only (pty, select, fcntl, termios).
"""

import fcntl
import os
import pty
import select
import struct
import sys
import termios


def set_winsize(fd, rows, cols):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def main():
    if len(sys.argv) < 4:
        sys.stderr.write("usage: gui-pty.py <cols> <rows> <cmd> [args ...]\n")
        return 2
    try:
        cols = int(sys.argv[1])
        rows = int(sys.argv[2])
    except ValueError:
        cols, rows = 80, 24
    cols = min(max(cols, 20), 500)
    rows = min(max(rows, 5), 200)
    cmd = sys.argv[3:]

    pid, fd = pty.fork()
    if pid == 0:
        # Child: attached to the slave side of the pty, a real TTY.
        env = dict(os.environ)
        env["TERM"] = "xterm-256color"
        env.pop("NO_COLOR", None)
        os.execvpe(cmd[0], cmd, env)
        return 127  # unreachable

    set_winsize(fd, rows, cols)
    stdin = sys.stdin.buffer
    stdout = sys.stdout.buffer
    # Pipes, not TTYs: never block the loop on a partial write path.
    for f in (fd,):
        try:
            flags = fcntl.fcntl(f, fcntl.F_GETFL)
            fcntl.fcntl(f, fcntl.F_SETFL, flags | os.O_NONBLOCK)
        except OSError:
            pass

    alive = True
    while alive:
        try:
            r, _, _ = select.select([fd, stdin], [], [], 0.5)
        except (OSError, ValueError):
            break
        if fd in r:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                break  # child exited (EIO on BSD/macOS)
            if not chunk:
                break
            try:
                stdout.write(chunk)
                stdout.flush()
            except (OSError, ValueError):
                break
        if stdin in r:
            try:
                chunk = os.read(stdin.fileno(), 65536)
            except OSError:
                break
            if not chunk:
                break  # server closed our stdin: shut down
            try:
                # The slave echoes input itself (real TTY semantics); the
                # server must not double-echo.
                os.write(fd, chunk)
            except OSError:
                break
    try:
        os.close(fd)
    except OSError:
        pass
    try:
        _, status = os.waitpid(pid, os.WNOHANG)
        if status == 0:
            # Reap blocking only if the child already died; otherwise leave
            # init to reap it (we are exiting anyway).
            pass
    except ChildProcessError:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
