"""Kernel liveness heartbeat (ROB-001, ROB-004).

A daemon thread sends a small ``{"type": "hb"}`` message every
``interval`` seconds through *one* open widget of the kernel. All views of
that kernel share the timestamp on the front end (keyed by ``_session``) and
show a stale-data indication, rejecting input, when heartbeats stop: kernel
restarted, died, disconnected, or notebook reopened without a kernel.
"""

from __future__ import annotations

import contextlib
import threading
import time
import uuid
import weakref
from typing import Any

SESSION = uuid.uuid4().hex

_widgets: weakref.WeakSet[Any] = weakref.WeakSet()
_interval = 2.0
_thread: threading.Thread | None = None
_lock = threading.Lock()


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
    for w in list(_widgets):
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


def _alive(thread: threading.Thread | None) -> bool:
    return thread is not None and thread.is_alive() and not getattr(thread, "should_exit", False)


def register(widget: Any) -> None:
    global _thread
    _widgets.add(widget)
    with _lock:
        if _interval > 0 and not _alive(_thread):
            thread_cls = _marimo_thread_class() or threading.Thread
            _thread = thread_cls(target=_loop, name="awi-heartbeat", daemon=True)
            try:
                _thread.start()
            except RuntimeError:
                # no threads (Pyodide / JupyterLite): stale detection disabled
                _thread = None
                set_heartbeat(0)


def beat() -> bool:
    """Send one heartbeat through the first open widget. Returns True if sent."""
    for w in list(_widgets):
        if getattr(w, "comm", None) is None:
            continue
        try:
            w.send({"type": "hb", "session": SESSION, "interval": _interval})
            return True
        except Exception:
            continue
    return False


def _loop() -> None:
    me = threading.current_thread()
    while not getattr(me, "should_exit", False):  # marimo: cell invalidated
        time.sleep(_interval if _interval > 0 else 1.0)
        if _interval > 0:
            beat()
