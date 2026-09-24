"""Callback dispatcher (BOOL-013, ROB-002).

User callbacks normally run synchronously. Inside a *batch* they are queued
and run when the batch closes, highest priority first; the EmergencyStop has
the highest priority so that its callbacks run before any other pending
widget callback of the same batch. Every state update received from the
front end is processed as a batch, and :func:`batch` groups kernel-side
updates (for example one simulation step updating many widgets).
"""

from __future__ import annotations

import sys
import traceback
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

PRIORITY_NORMAL = 0
PRIORITY_EMERGENCY = 100

_depth = 0
_seq = 0
_queue: list[tuple[int, int, Any, Callable[[Any], Any], Any]] = []


def report_callback_error(widget: Any, callback: Any) -> None:
    """ROB-002: log a failing user callback without breaking the widget."""
    name = getattr(callback, "__qualname__", repr(callback))
    print(
        f"[anywidget-instruments] exception in callback {name!r} of {type(widget).__name__}:",
        file=sys.stderr,
    )
    traceback.print_exc(file=sys.stderr)


def _run(widget: Any, callback: Callable[[Any], Any], event: Any) -> None:
    try:
        callback(event)
    except Exception:
        report_callback_error(widget, callback)


def call(widget: Any, callback: Callable[[Any], Any], event: Any, priority: int) -> None:
    """Run ``callback(event)`` now, or queue it when a batch is open."""
    global _seq
    if _depth == 0:
        _run(widget, callback, event)
        return
    _seq += 1
    _queue.append((-priority, _seq, widget, callback, event))


def flush() -> None:
    """Run queued callbacks, highest priority first, then in arrival order."""
    while _queue:
        _queue.sort(key=lambda item: (item[0], item[1]))
        _, _, widget, callback, event = _queue.pop(0)
        _run(widget, callback, event)


@contextmanager
def batch() -> Iterator[None]:
    """Group widget updates; their callbacks run by priority when the block exits.

    >>> with ai.batch():
    ...     level.value = 3.2
    ...     estop.value = True   # estop callbacks run first
    """
    global _depth
    _depth += 1
    try:
        yield
    finally:
        _depth -= 1
        if _depth == 0:
            flush()


def in_batch() -> bool:
    return _depth > 0
