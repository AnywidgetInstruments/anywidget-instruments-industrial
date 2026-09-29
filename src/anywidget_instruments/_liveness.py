"""Kernel liveness heartbeat (ROB-001, ROB-004).

A daemon thread sends a small ``{"type": "hb"}`` message every
``interval`` seconds through every open widget of the kernel. All views of
that kernel share the timestamp on the front end (keyed by ``_session``) and
show a stale-data indication, rejecting input, when heartbeats stop: kernel
restarted, died, disconnected, or notebook reopened without a kernel.

Every widget receives the heartbeat because some models are never rendered
(e.g. a widget wrapped by ``mo.ui.anywidget``): a single, arbitrarily chosen
widget may not reach any view. Under ``marimo run`` several sessions share
one process, so widgets are grouped by marimo runtime context, each group
with its own ``mo.Thread`` (plain threads cannot reach the front end there).
"""

from __future__ import annotations

import contextlib
import sys
import threading
import time
import uuid
import weakref
from typing import Any

SESSION = uuid.uuid4().hex

_interval = 2.0
_lock = threading.Lock()


class _Group:
    """Widgets of one runtime context (one kernel, or one marimo session)."""

    def __init__(self) -> None:
        self.widgets: weakref.WeakSet[Any] = weakref.WeakSet()
        self.thread: threading.Thread | None = None


_groups: dict[int | None, _Group] = {}


def _all_widgets() -> list[Any]:
    return [w for g in list(_groups.values()) for w in list(g.widgets)]


def get_heartbeat() -> float:
    """Heartbeat interval in seconds (0 = stale detection disabled)."""
    return _interval


def set_heartbeat(interval: float) -> None:
    """Set the heartbeat interval in seconds for every widget; 0 disables it.

    Views flag data as stale after about three missed heartbeats. Increase the
    interval if long GIL-holding computations cause false stale indications.
    """
    global _interval
    if interval < 0:
        raise ValueError("interval must be >= 0")
    _interval = float(interval)
    for w in _all_widgets():
        with contextlib.suppress(Exception):  # widget being torn down
            w._heartbeat = _interval


def _marimo_thread_class() -> Any:
    """marimo only forwards messages sent from threads created with ``mo.Thread``."""
    try:
        from marimo._runtime.context import runtime_context_installed
    except ImportError:
        return None
    try:
        if not runtime_context_installed():
            return None
        import marimo

        return marimo.Thread
    except Exception:  # pragma: no cover - defensive against marimo internals
        return None


def _context_key() -> int | None:
    """Identity of the current marimo runtime context (session), else None."""
    if _marimo_thread_class() is None:
        return None
    try:
        from marimo._runtime.context import get_context

        return id(get_context())
    except Exception:  # pragma: no cover - defensive against marimo internals
        return None


def _threads_available() -> bool:
    """Whether a heartbeat thread may run here.

    Pyodide has no threads. Starting one used to fail, which disabled the
    heartbeat; marimo's WebAssembly runtime now emulates ``mo.Thread`` on the
    event loop, so ``start()`` succeeds and the heartbeat's blocking loop then
    collides with the kernel's own tasks ("Cannot enter into task ... while
    another task ... is being executed"). Pyodide is therefore recognized
    rather than waited on to fail.
    """
    return sys.platform != "emscripten"


def _alive(thread: threading.Thread | None) -> bool:
    return thread is not None and thread.is_alive() and not getattr(thread, "should_exit", False)


def register(widget: Any) -> None:
    key = _context_key()
    with _lock:
        group = _groups.setdefault(key, _Group())
        group.widgets.add(widget)
        if _interval > 0 and not _threads_available():
            # no threads (Pyodide / JupyterLite / marimo WebAssembly): stale detection disabled
            set_heartbeat(0)
        elif _interval > 0 and not _alive(group.thread):
            thread_cls = _marimo_thread_class() or threading.Thread
            group.thread = thread_cls(
                target=_loop, args=(group,), name="awi-heartbeat", daemon=True
            )
            try:
                group.thread.start()
            except RuntimeError:
                # no threads (Pyodide / JupyterLite): stale detection disabled
                group.thread = None
                set_heartbeat(0)


def beat(group: _Group | None = None) -> int:
    """Send one heartbeat through every open widget (of ``group``, or of all groups).

    Returns the number of widgets the heartbeat was sent through.
    """
    widgets = list(group.widgets) if group is not None else _all_widgets()
    sent = 0
    for w in widgets:
        if getattr(w, "comm", None) is None:
            continue
        try:
            w.send({"type": "hb", "session": SESSION, "interval": _interval})
            sent += 1
        except Exception:
            continue
    return sent


def _loop(group: _Group) -> None:
    me = threading.current_thread()
    while not getattr(me, "should_exit", False):  # marimo: cell invalidated
        time.sleep(_interval if _interval > 0 else 1.0)
        if _interval > 0:
            beat(group)
