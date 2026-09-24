import datetime as dt

import pytest
import traitlets as t

import anywidget_instruments as ai


def test_alarm_transition_table():
    tr = ai.alarm_transition
    assert tr("normal", "activate") == "active_unacknowledged"
    assert tr("active_unacknowledged", "acknowledge") == "active_acknowledged"
    assert tr("active_unacknowledged", "clear") == "cleared_unacknowledged"
    assert tr("cleared_unacknowledged", "acknowledge") == "normal"
    assert tr("active_acknowledged", "clear") == "normal"
    assert tr("normal", "acknowledge") == "normal"
    with pytest.raises(ValueError):
        tr("normal", "shelve")


def test_banner_lifecycle():
    b = ai.AlarmBanner()
    acks = []
    b.on_acknowledge(lambda e: acks.append(e["alarm_id"]))
    t0 = dt.datetime(2026, 1, 1, 12, 0, 0)
    b.raise_alarm("TK1.HI", "Level high", source="TK1", priority="high", timestamp=t0)
    b.raise_alarm("P1.FLT", "Pump fault", source="P1", priority="critical")
    assert {a["id"] for a in b.value} == {"TK1.HI", "P1.FLT"}
    assert b.value[0]["timestamp"] == "2026-01-01T12:00:00"
    b.acknowledge("TK1.HI")
    assert b.state_of("TK1.HI") == "active_acknowledged"
    b.clear_alarm("TK1.HI")
    assert b.state_of("TK1.HI") == "normal"
    assert [a["id"] for a in b.value] == ["P1.FLT"]
    b.clear_alarm("P1.FLT")
    assert b.state_of("P1.FLT") == "cleared_unacknowledged"
    b._handle_front_msg(b, {"type": "ack_all"}, [])
    assert b.value == []
    assert acks == ["TK1.HI", "P1.FLT"]
    with pytest.raises(ValueError):
        b.raise_alarm("X", priority="urgent")


def test_banner_front_ack_requires_control_mode():
    b = ai.AlarmBanner(mode="indicator")
    b.raise_alarm("A")
    b._handle_front_msg(b, {"type": "ack", "alarm_id": "A"}, [])
    assert b.state_of("A") == "active_unacknowledged"
    b.mode = "control"
    b._handle_front_msg(b, {"type": "ack", "alarm_id": "A"}, [])
    assert b.state_of("A") == "active_acknowledged"


@pytest.mark.parametrize(
    ("cls", "states", "commands"),
    [
        (ai.Valve, {"open", "closed", "transit", "fault"}, ["open", "close"]),
        (ai.Pump, {"stopped", "running", "fault"}, ["start", "stop"]),
        (ai.Motor, {"stopped", "forward", "reverse", "fault"}, ["forward", "reverse", "stop"]),
    ],
)
def test_process_objects(cls, states, commands):
    w = cls(tag="X-1")
    assert set(w.traits()["value"].values) == states
    assert w.commands == commands
    with pytest.raises(t.TraitError):
        w.value = "exploded"


def test_commands_go_to_callbacks_without_changing_state():
    v = ai.Valve()
    seen = []
    v.on_command(lambda e: seen.append(e["command"]))
    v._handle_front_msg(v, {"type": "command", "command": "open"}, [])
    assert seen == ["open"] and v.value == "closed"
    v._handle_front_msg(v, {"type": "command", "command": "manual"}, [])
    assert v.auto is False
    v._handle_front_msg(v, {"type": "command", "command": "rm -rf"}, [])
    assert seen == ["open", "manual"]
    with pytest.raises(ValueError):
        v.command("explode")


def test_simulate_applies_commands():
    p = ai.Pump(simulate=True)
    p.command("start")
    assert p.value == "running"
    p.command("stop")
    assert p.value == "stopped"
    v = ai.Valve(simulate=True, position=0)
    v.command("open")
    assert v.value == "open" and v.position == 100
    m = ai.Motor(simulate=True)
    m.command("reverse")
    assert m.value == "reverse"


def test_indicator_mode_ignores_front_commands():
    p = ai.Pump(mode="indicator", simulate=True)
    p._handle_front_msg(p, {"type": "command", "command": "start"}, [])
    assert p.value == "stopped"


def test_pipe():
    p = ai.Pipe(shape="tee", rotation=90, value=True)
    assert p.shape in ai.PIPE_SHAPES and p.mode == "indicator"
    with pytest.raises(t.TraitError):
        ai.Pipe(rotation=45)


def test_synoptic_items_and_pipes():
    syn = ai.SynopticCanvas()
    tank = syn.add(ai.Tank(label="T1"), x=10, y=20)
    syn.add(ai.Pump(), 100, 50)
    assert syn.widgets[0] is tank
    state = syn.get_state()["items"]
    assert state[0]["widget"] == f"IPY_MODEL_{tank.model_id}"
    syn.move(tank, 30, 40)
    assert syn.items[0]["x"] == 30
    syn.remove(tank)
    assert len(syn.items) == 1
    i = syn.add_pipe([(0, 0), (50, 0), (50, 40)], flow=True)
    syn.set_flow(i, False, direction="reverse")
    assert syn.pipes[i]["flow"] is False and syn.pipes[i]["direction"] == "reverse"
    with pytest.raises(ValueError):
        syn.add_pipe([(0, 0)])


def test_synoptic_background_types():
    syn = ai.SynopticCanvas()
    syn.background = b"\x89PNG\r\n\x1a\n...."
    assert syn.background_mime == "image/png"
    syn.background = b'<svg xmlns="http://www.w3.org/2000/svg"/>'
    assert syn.background_mime == "image/svg+xml"
    with pytest.raises(t.TraitError):
        syn.background = b"GIF89a"
