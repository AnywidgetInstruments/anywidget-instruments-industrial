"""PictureControl: drawing surface driven from Python (SPEC-005 .. SPEC-007)."""

from __future__ import annotations

import threading
import weakref
from typing import Any

import numpy as np
import traitlets as t

from . import _dispatch
from ._base import Callback, InstrumentWidget, size_trait

_pending: weakref.WeakSet[PictureControl] = weakref.WeakSet()
_hook_installed = False
_timer: threading.Timer | None = None
_timer_lock = threading.Lock()
#: Seconds during which drawing commands issued outside IPython are coalesced.
FLUSH_DELAY = 0.02


def _flush_all(*_args: Any) -> None:
    for pic in list(_pending):
        pic.flush()


def _install_hook() -> bool:
    """Flush pending drawings after each IPython cell (SPEC-007)."""
    global _hook_installed
    if _hook_installed:
        return True
    try:
        from IPython import get_ipython
    except ImportError:  # pragma: no cover
        return False
    ip = get_ipython()
    if ip is None:
        return False
    ip.events.register("post_run_cell", _flush_all)
    _hook_installed = True
    return True


def _schedule_flush() -> None:
    """Outside IPython: coalesce commands issued within 20 ms."""
    global _timer
    with _timer_lock:
        if _timer is None or not _timer.is_alive():
            _timer = threading.Timer(FLUSH_DELAY, _flush_all)
            _timer.daemon = True
            try:
                _timer.start()
            except RuntimeError:  # no threads (Pyodide): send right away
                _timer = None
                _flush_all()


def _style(stroke: str | None, fill: str | None, width: float) -> dict[str, Any]:
    return {"stroke": stroke, "fill": fill, "width": float(width)}


class PictureControl(InstrumentWidget):
    """A canvas on which Python code draws primitives.

    Drawing commands issued during one cell execution are batched and
    rendered in a single frame. Call :meth:`flush` to send them earlier (for
    example inside a long-running loop). Coordinates are CSS pixels, origin
    top-left. In control mode, clicks are reported in ``value`` (``{"x", "y",
    "button"}``) and to :meth:`on_click` callbacks (SPEC-006).
    """

    _kind = t.Unicode("picture").tag(sync=True)
    _default_size = (320, 200)
    size = size_trait(*_default_size)
    value = t.Dict(read_only=True).tag(sync=True)
    background = t.Unicode("").tag(sync=True)

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._commands: list[dict[str, Any]] = []
        self._buffers: list[bytes] = []
        self._pending_commands: list[dict[str, Any]] = []
        self._pending_clear = False
        self._click_callbacks: list[Callback] = []
        self.on_msg(self._handle_front_msg)

    # -- batching ------------------------------------------------------------------
    def _add(self, command: dict[str, Any], buffer: bytes | None = None) -> PictureControl:
        if buffer is not None:
            command["buffer"] = len(self._buffers)
            self._buffers.append(buffer)
        self._commands.append(command)
        self._pending_commands.append(command)
        _pending.add(self)
        if not _install_hook():
            _schedule_flush()
        return self

    @property
    def commands(self) -> list[dict[str, Any]]:
        """Current display list."""
        return list(self._commands)

    def flush(self) -> None:
        """Send the pending drawing commands now, as one message."""
        if not self._pending_commands and not self._pending_clear:
            return
        commands, self._pending_commands = self._pending_commands, []
        used = sorted({c["buffer"] for c in commands if "buffer" in c})
        remap = {old: new for new, old in enumerate(used)}
        out = [dict(c, buffer=remap[c["buffer"]]) if "buffer" in c else c for c in commands]
        clear, self._pending_clear = self._pending_clear, False
        self.send(
            {"type": "draw", "clear": clear, "commands": out},
            buffers=[self._buffers[i] for i in used],
        )

    def clear(self) -> PictureControl:
        """Erase the picture."""
        self._commands.clear()
        self._buffers.clear()
        self._pending_commands.clear()
        self._pending_clear = True
        _pending.add(self)
        if not _install_hook():
            _schedule_flush()
        return self

    # -- primitives -----------------------------------------------------------------
    def line(
        self,
        x0: float,
        y0: float,
        x1: float,
        y1: float,
        color: str = "currentColor",
        width: float = 1.0,
    ) -> PictureControl:
        return self._add(
            {"op": "line", "x0": x0, "y0": y0, "x1": x1, "y1": y1, **_style(color, None, width)}
        )

    def rect(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        stroke: str | None = "currentColor",
        fill: str | None = None,
        width: float = 1.0,
    ) -> PictureControl:
        return self._add(
            {"op": "rect", "x": x, "y": y, "w": w, "h": h, **_style(stroke, fill, width)}
        )

    def circle(
        self,
        cx: float,
        cy: float,
        r: float,
        stroke: str | None = "currentColor",
        fill: str | None = None,
        width: float = 1.0,
    ) -> PictureControl:
        return self.arc(cx, cy, r, 0, 360, stroke=stroke, fill=fill, width=width)

    def arc(
        self,
        cx: float,
        cy: float,
        r: float,
        start: float,
        end: float,
        stroke: str | None = "currentColor",
        fill: str | None = None,
        width: float = 1.0,
    ) -> PictureControl:
        """Arc from ``start`` to ``end`` degrees, clockwise from 3 o'clock."""
        return self._add(
            {
                "op": "arc",
                "cx": cx,
                "cy": cy,
                "r": r,
                "start": start,
                "end": end,
                **_style(stroke, fill, width),
            }
        )

    def polygon(
        self,
        points: Any,
        stroke: str | None = "currentColor",
        fill: str | None = None,
        width: float = 1.0,
        closed: bool = True,
    ) -> PictureControl:
        pts = np.asarray(points, dtype=float).reshape(-1, 2).tolist()
        return self._add(
            {"op": "polygon", "points": pts, "closed": closed, **_style(stroke, fill, width)}
        )

    def polyline(self, points: Any, color: str = "currentColor", width: float = 1.0) -> Any:
        return self.polygon(points, stroke=color, fill=None, width=width, closed=False)

    def text(
        self,
        x: float,
        y: float,
        text: str,
        color: str = "currentColor",
        size: float = 12,
        anchor: str = "start",
    ) -> PictureControl:
        if anchor not in ("start", "middle", "end"):
            raise ValueError("anchor must be 'start', 'middle' or 'end'")
        return self._add(
            {
                "op": "text",
                "x": x,
                "y": y,
                "text": str(text),
                "fill": color,
                "size": float(size),
                "anchor": anchor,
            }
        )

    def image(
        self, x: float, y: float, data: Any, w: float | None = None, h: float | None = None
    ) -> PictureControl:
        """Draw an image: PNG/JPEG ``bytes`` or a ``(H, W[, 3|4])`` uint8 array."""
        if isinstance(data, (bytes, bytearray, memoryview)):
            raw = bytes(data)
            if raw[:8] == b"\x89PNG\r\n\x1a\n":
                mime = "image/png"
            elif raw[:3] == b"\xff\xd8\xff":
                mime = "image/jpeg"
            else:
                raise ValueError("image bytes must be PNG or JPEG")
            return self._add({"op": "image", "x": x, "y": y, "w": w, "h": h, "mime": mime}, raw)
        arr = np.asarray(data)
        if arr.dtype != np.uint8:
            arr = np.clip(arr, 0, 255).astype(np.uint8)
        if arr.ndim == 2:
            arr = np.stack([arr] * 3, axis=-1)
        if arr.ndim != 3 or arr.shape[2] not in (3, 4):
            raise ValueError("array images must have shape (H, W), (H, W, 3) or (H, W, 4)")
        if arr.shape[2] == 3:
            arr = np.concatenate([arr, np.full((*arr.shape[:2], 1), 255, np.uint8)], axis=2)
        height, width = arr.shape[:2]
        return self._add(
            {
                "op": "image",
                "x": x,
                "y": y,
                "w": w,
                "h": h,
                "mime": "rgba",
                "pw": int(width),
                "ph": int(height),
            },
            np.ascontiguousarray(arr).tobytes(),
        )

    # -- clicks ---------------------------------------------------------------------
    def on_click(self, callback: Callback) -> Callback:
        """Register ``callback(event)`` with ``event = {"x", "y", "button"}``."""
        self._click_callbacks.append(callback)
        return callback

    def _handle_front_msg(self, _widget: Any, content: Any, _buffers: Any) -> None:
        if not isinstance(content, dict):
            return
        if content.get("type") == "sync_request":
            self._send_snapshot()
        elif content.get("type") == "click" and self.mode == "control" and not self.disabled:
            event = {
                "x": float(content.get("x", 0)),
                "y": float(content.get("y", 0)),
                "button": int(content.get("button", 0)),
            }
            with _dispatch.batch():
                self.set_trait("value", event)
                for cb in list(self._click_callbacks):
                    _dispatch.call(self, cb, dict(event, owner=self), self._callback_priority)

    def _send_snapshot(self) -> None:
        # the snapshot contains the pending commands too
        self._pending_commands = []
        self._pending_clear = False
        self.send(
            {"type": "draw", "clear": True, "commands": self._commands},
            buffers=list(self._buffers),
        )
