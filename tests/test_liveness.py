import pytest

import anywidget_instruments as ai
from anywidget_instruments import _liveness


def test_widgets_share_session_and_heartbeat():
    a, b = ai.Knob(), ai.LED()
    assert a._session == b._session == _liveness.SESSION
    assert a.trait_metadata("_session", "sync")
    assert a._heartbeat == ai.get_heartbeat()


def test_set_heartbeat_updates_widgets():
    k = ai.Knob()
    try:
        ai.set_heartbeat(5)
        assert k._heartbeat == 5
        assert ai.Gauge()._heartbeat == 5
        ai.set_heartbeat(0)
        assert k._heartbeat == 0
    finally:
        ai.set_heartbeat(2)
    with pytest.raises(ValueError):
        ai.set_heartbeat(-1)


def test_beat_sends_through_one_widget(monkeypatch):
    sent = []
    widgets = [ai.Knob(), ai.Knob()]
    for w in widgets:
        monkeypatch.setattr(w, "send", lambda msg, w=w: sent.append((w, msg)))
    monkeypatch.setattr(_liveness, "_widgets", type(_liveness._widgets)(widgets))
    assert _liveness.beat() is True
    assert len(sent) == 1
    assert sent[0][1]["type"] == "hb" and sent[0][1]["session"] == _liveness.SESSION


def test_beat_skips_closed_widgets(monkeypatch):
    w = ai.Knob()
    w.close()
    monkeypatch.setattr(_liveness, "_widgets", type(_liveness._widgets)([w]))
    assert _liveness.beat() is False


def test_no_threads_disables_heartbeat(monkeypatch):
    """Pyodide (JupyterLite) cannot start threads: stale detection is disabled."""
    import threading

    def refuse(self):
        raise RuntimeError("can't start new thread")

    monkeypatch.setattr(_liveness, "_thread", None)
    monkeypatch.setattr(threading.Thread, "start", refuse)
    try:
        k = ai.Knob()
        assert ai.get_heartbeat() == 0
        assert k._heartbeat == 0
    finally:
        monkeypatch.undo()
        ai.set_heartbeat(2)


def test_picture_flushes_without_threads(monkeypatch):
    import threading

    from anywidget_instruments import _picture

    pic = ai.PictureControl()
    sent = []
    pic.send = lambda content, buffers=None: sent.append(content)
    monkeypatch.setattr(_picture, "_timer", None)
    monkeypatch.setattr(
        threading.Thread, "start", lambda self: (_ for _ in ()).throw(RuntimeError())
    )
    pic.line(0, 0, 1, 1)
    assert len(sent) == 1
