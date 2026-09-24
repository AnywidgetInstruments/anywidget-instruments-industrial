"""Industrial operator objects (IND-*): kernel side."""

from __future__ import annotations

import time

import pytest
import traitlets as t

import anywidget_instruments as ai


# -- AnalogIndicator (IND-001 .. IND-003) --------------------------------------------
def test_analog_indicator_defaults_and_alarm_level():
    a = ai.AnalogIndicator(50, normal_lo=40, normal_hi=60, hi=80, hihi=90, target=55)
    assert a.mode == "indicator"
    assert a.show_limits is True
    assert a.alarm_level == "normal"
    a.value = 85
    assert a.alarm_level == "hi"
    v = ai.AnalogIndicator(orientation="vertical")
    assert v.size == (70, 220)


# -- SelectorSwitch (IND-010 .. IND-013) -----------------------------------------------
def test_selector_default_value_is_the_middle_position():
    s = ai.SelectorSwitch()
    assert s.positions == ["HAND", "OFF", "AUTO"]
    assert s.value == "OFF" and s.index == 1
    assert ai.SelectorSwitch(positions=["A", "B"], default_position="B").value == "B"


def test_selector_validates_positions_and_value():
    with pytest.raises(t.TraitError, match=r"positions.*SelectorSwitch"):
        ai.SelectorSwitch(positions=["only"])
    with pytest.raises(t.TraitError, match=r"positions.*SelectorSwitch"):
        ai.SelectorSwitch(positions=["A", "B", "C", "D", "E", "F"])
    s = ai.SelectorSwitch()
    with pytest.raises(t.TraitError, match=r"value.*SelectorSwitch"):
        s.value = "MANUAL"
    with pytest.raises(t.TraitError, match="default_position"):
        s.default_position = "X"


def test_locked_key_switch_ignores_the_front_end():
    s = ai.SelectorSwitch("LOCAL", positions=["LOCAL", "REMOTE"], keyed=True, locked=True)
    s.set_state({"value": "REMOTE"})  # front-end update
    assert s.value == "LOCAL"
    s.value = "REMOTE"  # the kernel may still move it
    assert s.value == "REMOTE"
    s.locked = False
    s.set_state({"value": "LOCAL"})
    assert s.value == "LOCAL"


# -- StackLight (IND-020 .. IND-022) ---------------------------------------------------
def test_stack_light_tiers_and_states():
    light = ai.StackLight(tiers=["red", "amber", "green"], labels=["Fault", "Warning", "Run"])
    assert light.value == ["off", "off", "off"]
    light.set("green", "on")
    light.set(0, "blink")
    assert light.value == ["blink", "off", "on"]
    assert light.get("red") == "blink"
    light.all_off()
    assert light.value == ["off"] * 3


def test_stack_light_validation():
    with pytest.raises(t.TraitError):
        ai.StackLight(tiers=["purple"])
    with pytest.raises(t.TraitError, match="1 to 5"):
        ai.StackLight(tiers=["red"] * 6)
    light = ai.StackLight()
    with pytest.raises(ValueError, match="state"):
        light.set("red", "flash")
    with pytest.raises(ValueError, match="no 'blue' tier"):
        light.set("blue", "on")
    with pytest.raises(t.TraitError, match="one state per tier"):
        light.value = ["on"]


def test_stack_light_resizes_value_with_tiers():
    light = ai.StackLight(tiers=["red", "green"], value=["on", "blink"])
    light.tiers = ["red", "green", "blue"]
    assert light.value == ["on", "blink", "off"]


# -- PID controller (IND-033, IND-034) --------------------------------------------------
def _first_order(pid: ai.PID, y: float, n: int, dt: float = 0.1, tau: float = 10.0) -> float:
    for _ in range(n):
        u = pid.step(y, dt)
        y += dt / tau * (-y + u)
    return y


def test_pid_reaches_the_setpoint_without_offset():
    pid = ai.PID(kp=2.0, ti=5.0, sp=50.0)
    y = _first_order(pid, 20.0, 3000)
    assert y == pytest.approx(50.0, abs=0.05)


def test_pid_proportional_only_leaves_an_offset():
    pid = ai.PID(kp=2.0, sp=50.0)
    y = _first_order(pid, 20.0, 3000)
    assert y == pytest.approx(100 / 3, abs=0.1)  # K*kp/(1+K*kp) * sp


def test_pid_direct_and_reverse_action():
    rev = ai.PID(kp=1.0, sp=50.0, output=50.0)
    direct = ai.PID(kp=1.0, sp=50.0, output=50.0, action="direct")
    assert rev.step(40.0, 0.1) > 50.0  # PV low -> more output (heating)
    assert direct.step(40.0, 0.1) < rev.output


def test_pid_anti_windup_keeps_the_output_responsive():
    pid = ai.PID(kp=1.0, ti=1.0, sp=100.0, out_max=100.0)
    for _ in range(1000):  # long saturation
        pid.step(0.0, 0.1)
    assert pid.output == 100.0
    # the error reverses: the output must leave saturation at once, not after unwinding
    assert pid.step(150.0, 0.1) < 100.0


def test_pid_derivative_acts_on_the_measurement_only():
    pid = ai.PID(kp=1.0, td=1.0, sp=0.0, output=0.0, out_min=-100)
    pid.step(0.0, 0.1)
    pid.sp = 10.0  # setpoint step: no derivative kick
    assert pid.step(0.0, 0.1) == pytest.approx(10.0)
    assert pid.step(1.0, 0.1) == pytest.approx(9.0 - 10.0)  # PV rising -> derivative brakes


def test_pid_bumpless_transfer_from_manual():
    pid = ai.PID(kp=3.0, ti=10.0, sp=60.0)
    pid.set_mode("MAN")
    pid.set_output(35.0)
    assert pid.step(40.0, 0.1) == 35.0  # manual output held
    pid.set_mode("AUTO", pv=40.0)
    assert pid.step(40.0, 0.1) == pytest.approx(35.0 + 3.0 * 0.1 / 10.0 * 20.0)


def test_pid_argument_checks():
    with pytest.raises(ValueError, match="action"):
        ai.PID(action="sideways")
    with pytest.raises(ValueError, match="out_max"):
        ai.PID(out_min=10, out_max=0)
    with pytest.raises(ValueError, match="dt"):
        ai.PID().step(1.0, 0.0)
    assert ai.PID(output=12.0).step(float("nan"), 0.1) == 12.0  # bad PV holds the output


# -- PIDFaceplate (IND-030 .. IND-032) ----------------------------------------------------
def sent_messages(w):
    sent = []

    def send(content, buffers=None):
        if content.get("type") != "hb":
            sent.append(content)

    w.send = send
    return sent


def test_faceplate_follows_its_controller():
    fp = ai.PIDFaceplate(tag="TIC-1", controller=ai.PID(kp=1.0, ti=10.0, sp=40.0))
    assert fp.sp == 40.0 and fp.loop_mode == "AUTO"
    op = fp.step(30.0, 0.5)
    assert op == fp.op > 0
    assert fp.value == {"pv": 30.0, "sp": 40.0, "op": op, "mode": "AUTO"}
    fp.sp = 45.0
    assert fp.controller.sp == 45.0


def test_faceplate_operator_entries_follow_the_mode_rules():
    fp = ai.PIDFaceplate(modes=["MAN", "AUTO", "CAS"], pv_max=200, sp_max=150)
    sent = sent_messages(fp)
    assert fp.operator_set("op", 30) is False  # AUTO: OP locked
    assert sent[-1] == {
        "type": "rejected",
        "field": "op",
        "reason": "OP can only be changed in MAN mode",
    }
    assert fp.operator_set("sp", 999) is True
    assert fp.sp == 150.0  # clamped to sp_max
    fp.loop_mode = "CAS"
    assert fp.operator_set("sp", 10) is False
    fp.loop_mode = "MAN"
    assert fp.operator_set("op", 120) is True and fp.op == 100.0


def test_faceplate_large_changes_need_confirmation():
    fp = ai.PIDFaceplate(confirm_delta=5.0)
    sent = sent_messages(fp)
    fp._handle_front_msg(fp, {"type": "set", "field": "sp", "value": 20}, [])
    assert fp.sp == 0.0 and sent[-1]["reason"] == "confirmation required"
    fp._handle_front_msg(fp, {"type": "set", "field": "sp", "value": 20, "confirmed": True}, [])
    assert fp.sp == 20.0
    fp._handle_front_msg(fp, {"type": "set", "field": "sp", "value": 23}, [])
    assert fp.sp == 23.0  # small change: no confirmation


def test_faceplate_mode_change_is_bumpless_with_setpoint_tracking():
    fp = ai.PIDFaceplate(controller=ai.PID(kp=2.0, ti=20.0, sp=80.0), sp_tracking=True)
    fp._handle_front_msg(fp, {"type": "loop_mode", "mode": "MAN"}, [])
    fp.operator_set("op", 42.0)
    fp.step(55.0, 1.0)
    fp._handle_front_msg(fp, {"type": "loop_mode", "mode": "AUTO"}, [])
    assert fp.sp == 55.0  # IND-034: SP took the PV
    assert fp.step(55.0, 1.0) == pytest.approx(42.0)  # no bump


def test_faceplate_rejects_disabled_modes_and_reports_pv_alarms():
    fp = ai.PIDFaceplate(hi=80.0)
    sent = sent_messages(fp)
    fp._handle_front_msg(fp, {"type": "loop_mode", "mode": "CAS"}, [])
    assert fp.loop_mode == "AUTO" and sent[-1]["field"] == "mode"
    with pytest.raises(t.TraitError, match="loop_mode"):
        fp.loop_mode = "CAS"
    fp.step(90.0, 1.0)
    assert fp.alarm_level == "hi"
    fp.mode = "indicator"
    fp._handle_front_msg(fp, {"type": "set", "field": "sp", "value": 5}, [])
    assert fp.sp == 0.0  # indicator mode: no operator action


# -- Annunciator (IND-040 .. IND-043) ----------------------------------------------------
@pytest.mark.parametrize(
    ("sequence", "after_clear", "after_reset"),
    [("A", "normal", "normal"), ("M", "acknowledged", "normal"), ("R", "ringback", "normal")],
)
def test_isa_18_1_sequences(sequence, after_clear, after_reset):
    step = ai.annunciator_transition
    s = step("normal", True, "process", sequence)
    assert s == "alert"
    s = step(s, True, "acknowledge", sequence)
    assert s == "acknowledged"
    s = step(s, False, "process", sequence)
    assert s == after_clear
    assert step(s, False, "reset", sequence) == after_reset


def test_alerts_are_locked_in_until_acknowledged():
    step = ai.annunciator_transition
    assert step("alert", False, "process", "A") == "alert"  # cleared, not yet acknowledged
    assert step("alert", False, "acknowledge", "A") == "normal"
    assert step("alert", False, "acknowledge", "R") == "ringback"
    assert step("acknowledged", True, "reset", "M") == "acknowledged"  # still active
    with pytest.raises(ValueError, match="sequence"):
        step("normal", True, "process", "Z")
    with pytest.raises(ValueError, match="event"):
        step("normal", True, "blink", "A")


def test_annunciator_panel_first_out_horn_and_actions():
    ann = ai.Annunciator(
        [("PAH-1", "Pressure high", "red"), {"tag": "TAL-2", "text": "Temp low"}],
        sequence="R",
        first_out=True,
    )
    actions = []
    ann.on_action(lambda e: actions.append(e["name"]))
    ann.set("TAL-2")
    ann.set("PAH-1")
    assert ann.first_out_tag == "TAL-2"  # IND-042
    assert ann.horn is True
    ann.silence()
    assert ann.horn is False and ann.state_of("PAH-1") == "alert"
    ann.acknowledge()
    ann.clear("TAL-2")
    assert ann.state_of("TAL-2") == "ringback" and ann.horn is True  # ringback sounds
    ann.reset()
    assert ann.state_of("TAL-2") == "normal" and ann.first_out_tag is None
    assert actions == ["silence", "acknowledge", "reset"]
    assert [w["tag"] for w in ann.value] == ["PAH-1", "TAL-2"]


def test_annunciator_front_end_actions_and_lamp_test():
    ann = ai.Annunciator([("XA-1", "Fault")])
    events = []
    ann.on_action(events.append)
    ann.set("XA-1")
    ann._handle_front_msg(ann, {"type": "acknowledge"}, [])
    assert ann.state_of("XA-1") == "acknowledged"
    ann._handle_front_msg(ann, {"type": "test", "on": True}, [])
    assert ann.test is True and events[-1]["on"] is True
    ann.mode = "indicator"
    ann._handle_front_msg(ann, {"type": "silence"}, [])
    assert [e["name"] for e in events] == ["acknowledge", "test"]


def test_annunciator_configuration_errors():
    ann = ai.Annunciator([("A", "a")])
    with pytest.raises(ValueError, match="duplicate"):
        ann.add_window("A")
    with pytest.raises(ValueError, match="color"):
        ann.add_window("B", color="purple")
    with pytest.raises(KeyError, match="no annunciator window"):
        ann.set("Z")


# -- AlarmList (IND-050 .. IND-053) --------------------------------------------------------
class FakeClock:
    def __init__(self) -> None:
        self.now = 1_000_000.0

    def __call__(self) -> float:
        return self.now


def alarm_list():
    lst = ai.AlarmList()
    lst._clock = FakeClock()
    return lst


def test_alarm_list_states_and_acknowledgement():
    lst = alarm_list()
    events = []
    lst.on_event(events.append)
    lst.raise_alarm("TI-1.HI", "Temperature high", "TI-1", "high")
    assert lst.state_of("TI-1.HI") == "active_unacknowledged"
    assert lst.acknowledge("TI-1.HI") is True
    assert lst.acknowledge("TI-1.HI") is False  # already acknowledged
    lst.clear_alarm("TI-1.HI")
    assert lst.value == []  # back to normal: removed
    assert [(e["name"], e["alarm_id"]) for e in events] == [("acknowledge", "TI-1.HI")]
    with pytest.raises(ValueError, match="priority"):
        lst.raise_alarm("X", priority="urgent")


def test_alarm_list_shelving_expires(monkeypatch):
    lst = alarm_list()
    events = []
    lst.on_event(events.append)
    monkeypatch.setattr(lst, "_schedule_expiry", lambda: None)  # expiry driven by refresh()
    lst.raise_alarm("FI-9.LO", "Flow low", "FI-9", "low")
    lst.shelve("FI-9.LO", 600)
    row = lst.value[0]
    assert row["shelved_until"] is not None and lst.is_shelved("FI-9.LO")
    lst._clock.now += 599
    assert lst.is_shelved("FI-9.LO")
    lst._clock.now += 2
    lst.refresh()  # IND-051: automatic unshelving
    assert not lst.is_shelved("FI-9.LO")
    assert [e["name"] for e in events] == ["shelve", "unshelve"]
    assert events[-1]["expired"] is True
    with pytest.raises(ValueError, match="duration"):
        lst.shelve("FI-9.LO", 10 * 3600)


def test_alarm_list_shelving_timer_unshelves_by_itself():
    lst = ai.AlarmList()
    lst.raise_alarm("A", "a")
    lst.shelve("A", 0.05)
    deadline = time.time() + 3
    while lst.value[0]["shelved_until"] is not None and time.time() < deadline:
        time.sleep(0.02)
    assert lst.value[0]["shelved_until"] is None


def test_alarm_list_suppressed_and_out_of_service_are_kept_apart():
    lst = alarm_list()
    lst.suppress("PI-9.LO", message="Unit shut down", source="PI-9", priority="low")
    lst.out_of_service("LT-4.HI")
    rows = {r["id"]: r for r in lst.value}
    assert rows["PI-9.LO"]["suppressed"] and rows["PI-9.LO"]["state"] == "normal"
    assert rows["LT-4.HI"]["out_of_service"]
    lst.suppress("PI-9.LO", False)
    assert [r["id"] for r in lst.value] == ["LT-4.HI"]
    lst.out_of_service("never-seen", False)  # nothing to do
    assert len(lst.value) == 1


def test_alarm_list_front_end_messages():
    lst = alarm_list()
    lst.raise_alarm("A", "a")
    lst._handle_front_msg(lst, {"type": "shelve", "alarm_id": "A", "seconds": 300}, [])
    assert lst.value[0]["shelved_until"] is not None
    lst._handle_front_msg(lst, {"type": "unshelve", "alarm_id": "A"}, [])
    lst._handle_front_msg(lst, {"type": "ack", "alarm_id": "A"}, [])
    assert lst.state_of("A") == "active_acknowledged"
    lst._handle_front_msg(lst, {"type": "shelve", "alarm_id": "A", "seconds": -1}, [])
    lst._handle_front_msg(lst, {"type": "ack", "alarm_id": "unknown"}, [])
    assert lst.value[0]["shelved_until"] is None


# -- StateMachine (IND-060 .. IND-063) -------------------------------------------------------
def test_packml_model_has_17_states_and_9_commands():
    names = [s["name"] for s in ai.PACKML_MODEL["states"]]
    assert len(names) == 17 == len(set(names))
    assert ai.PACKML_MODEL["commands"] == list(ai.PACKML_COMMANDS)


def test_state_machine_offers_only_valid_commands():
    m = ai.StateMachine()
    assert m.value == "Stopped"
    assert m.available_commands == ["Reset", "Abort"]
    sent = sent_messages(m)
    assert m.command("Start") is False  # IND-061
    assert sent[-1] == {"type": "rejected", "command": "Start", "state": "Stopped"}
    assert m.command("Reset") and m.value == "Resetting" and m.is_acting


def test_state_machine_acting_states_end_with_state_complete():
    m = ai.StateMachine()
    seen = []
    m.on_change(lambda c: seen.append(c["new"]))
    m.command("Reset")
    m.state_complete()  # IND-062
    m.command("Start")
    m.state_complete()
    assert m.value == "Execute"
    assert m.state_complete()  # Execute -> Completing (production finished)
    m.state_complete()
    assert m.value == "Complete"
    assert m.state_complete() is False  # not an acting state
    m.command("Abort")
    m.state_complete()
    m.command("Clear")
    m.state_complete()
    assert m.value == "Stopped"
    assert seen[:4] == ["Resetting", "Idle", "Starting", "Execute"]


def test_state_machine_hold_and_front_end_commands():
    m = ai.StateMachine(value="Execute")
    m._handle_front_msg(m, {"type": "command", "command": "Hold"}, [])
    m.state_complete()
    assert m.value == "Held" and m.available_commands == ["Stop", "Unhold", "Abort"]
    m.disabled = True
    m._handle_front_msg(m, {"type": "command", "command": "Unhold"}, [])
    assert m.value == "Held"


def test_state_machine_custom_model():
    model = {
        "states": [{"name": "Off"}, {"name": "Warming", "acting": True}, {"name": "Ready"}],
        "transitions": [
            ["Off", "On", "Warming"],
            ["Warming", "SC", "Ready"],
            ["Ready", "Off", "Off"],
        ],
    }
    m = ai.StateMachine(model)
    assert m.value == "Off" and m.machine["commands"] == ["On", "Off"]
    m.command("On")
    m.state_complete()
    assert m.value == "Ready"
    with pytest.raises(t.TraitError, match="invalid transition"):
        ai.StateMachine({"states": [{"name": "A"}], "transitions": [["A", "go", "B"]]})
    with pytest.raises(t.TraitError, match="unique"):
        ai.StateMachine({"states": [{"name": "A"}, {"name": "A"}]})
