import time

import numpy as np
import pytest

import anywidget_instruments as ai
from anywidget_instruments import _liveness


def capture(w):
    sent = []

    def send(content, buffers=None):
        if content.get("type") != "hb":  # liveness heartbeats (ROB-001) may arrive any time
            sent.append((content, buffers or []))

    w.send = send
    return sent


def test_commands_are_batched_into_one_message():
    pic = ai.PictureControl()
    sent = capture(pic)
    pic.line(0, 0, 10, 10, color="red").rect(1, 2, 3, 4, fill="#00f").circle(5, 5, 2)
    pic.text(3, 4, "<b>hi</b>")
    assert sent == []
    pic.flush()
    assert len(sent) == 1
    msg, buffers = sent[0]
    assert msg["type"] == "draw" and not msg["clear"]
    assert [c["op"] for c in msg["commands"]] == ["line", "rect", "arc", "text"]
    assert msg["commands"][3]["text"] == "<b>hi</b>"
    assert buffers == []
    pic.flush()
    assert len(sent) == 1  # nothing pending


def test_auto_flush_outside_ipython():
    pic = ai.PictureControl()
    sent = capture(pic)
    pic.polygon([(0, 0), (10, 0), (5, 8)], fill="green")
    pic.polyline([[0, 0], [1, 1], [2, 0]])
    time.sleep(0.2)
    assert len(sent) == 1
    assert [c["op"] for c in sent[0][0]["commands"]] == ["polygon", "polygon"]
    assert sent[0][0]["commands"][1]["closed"] is False


def test_capture_ignores_heartbeats():
    pic = ai.PictureControl()
    sent = capture(pic)
    pic.circle(1, 1, 1)
    _liveness.beat()  # the heartbeat thread may beat through the widget meanwhile
    pic.flush()
    assert [m["type"] for m, _ in sent] == ["draw"]


def test_images_travel_as_binary_buffers():
    pic = ai.PictureControl()
    sent = capture(pic)
    pic.image(0, 0, np.zeros((2, 3, 3), dtype=np.uint8))
    png = b"\x89PNG\r\n\x1a\n" + b"rest"
    pic.image(5, 5, png, w=10, h=10)
    pic.flush()
    msg, buffers = sent[0]
    rgba, png_cmd = msg["commands"]
    assert rgba["mime"] == "rgba" and (rgba["pw"], rgba["ph"]) == (3, 2)
    assert len(buffers[rgba["buffer"]]) == 2 * 3 * 4
    assert png_cmd["mime"] == "image/png" and buffers[png_cmd["buffer"]] == png
    with pytest.raises(ValueError):
        pic.image(0, 0, b"GIF89a")
    with pytest.raises(ValueError):
        pic.image(0, 0, np.zeros((2, 2, 2)))


def test_buffer_indices_are_remapped_per_message():
    pic = ai.PictureControl()
    sent = capture(pic)
    pic.image(0, 0, np.zeros((1, 1), dtype=np.uint8))
    pic.flush()
    pic.image(0, 0, np.ones((1, 1), dtype=np.uint8))
    pic.flush()
    msg, buffers = sent[1]
    assert msg["commands"][0]["buffer"] == 0 and len(buffers) == 1


def test_clear_and_snapshot():
    pic = ai.PictureControl()
    sent = capture(pic)
    pic.line(0, 0, 1, 1)
    pic.flush()
    pic.clear().text(0, 0, "x")
    pic.flush()
    assert sent[-1][0]["clear"] is True
    assert [c["op"] for c in pic.commands] == ["text"]
    pic._handle_front_msg(pic, {"type": "sync_request"}, [])
    assert sent[-1][0] == {"type": "draw", "clear": True, "commands": pic.commands}


def test_clicks_in_control_mode():
    pic = ai.PictureControl()
    clicks = []
    pic.on_click(lambda e: clicks.append((e["x"], e["y"], e["button"])))
    pic._handle_front_msg(pic, {"type": "click", "x": 12.5, "y": 4, "button": 2}, [])
    assert clicks == [(12.5, 4.0, 2)]
    assert pic.value == {"x": 12.5, "y": 4.0, "button": 2}
    pic.mode = "indicator"
    pic._handle_front_msg(pic, {"type": "click", "x": 1, "y": 1, "button": 0}, [])
    assert len(clicks) == 1


def test_text_anchor_validation():
    with pytest.raises(ValueError):
        ai.PictureControl().text(0, 0, "x", anchor="left")


def test_post_run_cell_hook(monkeypatch):
    from anywidget_instruments import _picture

    registered = []

    class Events:
        def register(self, name, fn):
            registered.append((name, fn))

    class Shell:
        events = Events()

    monkeypatch.setattr(_picture, "_hook_installed", False)
    monkeypatch.setattr("IPython.get_ipython", lambda: Shell())
    assert _picture._install_hook() is True
    assert registered[0][0] == "post_run_cell"
