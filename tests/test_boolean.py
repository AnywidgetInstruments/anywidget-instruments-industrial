import time

import pytest
import traitlets as t

import anywidget_instruments as ai

BOOLEAN = [
    ai.LED,
    ai.ToggleSwitch,
    ai.RockerSwitch,
    ai.SlideSwitch,
    ai.PushButton,
    ai.EmergencyStop,
]


@pytest.mark.parametrize("cls", BOOLEAN)
def test_boolean_api(cls):
    w = cls()
    assert w.value is False
    assert "mechanical_action" in w.traits()
    assert w._kind


def test_mechanical_actions_list():
    assert set(ai.MECHANICAL_ACTIONS) == {
        "switch_when_pressed",
        "switch_when_released",
        "switch_until_released",
        "latch_when_pressed",
        "latch_when_released",
        "latch_until_released",
    }
    with pytest.raises(t.TraitError):
        ai.ToggleSwitch(mechanical_action="latch_forever")


def test_switch_is_not_consumed_by_read():
    s = ai.ToggleSwitch(mechanical_action="switch_when_pressed")
    s.value = True  # as set by the front end
    assert s.read_latched() is True
    assert s.value is True


@pytest.mark.parametrize("action", ["latch_when_pressed", "latch_when_released"])
def test_latch_restored_after_read(action):
    b = ai.PushButton(mechanical_action=action)
    b.value = True
    assert b.read_latched() is True
    assert b.value is False
    assert b.read_latched() is False


def test_latch_until_released_waits_for_release():
    b = ai.PushButton(mechanical_action="latch_until_released")
    b._pressed = True
    b.value = True
    assert b.read_latched() is True
    assert b.value is True  # still held
    b._pressed = False
    assert b.value is False


def test_latch_with_true_default():
    b = ai.PushButton(mechanical_action="latch_when_pressed", default_state=True, value=True)
    b.value = False
    assert b.read_latched() is False
    assert b.value is True


def test_latch_timeout_expires():
    b = ai.PushButton(mechanical_action="latch_when_released", latch_timeout=0.05)
    expired = []
    b.on_latch_expired(lambda e: expired.append(e["name"]))
    b.value = True
    time.sleep(0.2)
    assert b.value is False
    assert expired == ["latch_expired"]


def test_latch_timeout_cancelled_by_read():
    b = ai.PushButton(mechanical_action="latch_when_released", latch_timeout=0.05)
    expired = []
    b.on_latch_expired(lambda e: expired.append(e))
    b.value = True
    b.read_latched()
    time.sleep(0.15)
    assert expired == []


def test_emergency_stop_requires_reset():
    e = ai.EmergencyStop()
    e.value = True
    e.value = False  # ignored: only reset() releases it
    assert e.value is True
    assert e.read_latched() is True
    assert e.value is True
    e.reset()
    assert e.value is False


def test_emergency_stop_callbacks_run_first_in_a_batch():
    level = ai.Tank()
    pump = ai.ToggleSwitch()
    e = ai.EmergencyStop()
    order = []
    level.on_change(lambda c: order.append("level"))
    pump.on_change(lambda c: order.append("pump"))
    e.on_change(lambda c: order.append("estop"))
    e.observe(lambda c: order.append("estop-observer"), names="value")
    with ai.batch():
        level.value = 3
        pump.value = True
        e.value = True
        assert order == []  # deferred until the batch closes
    assert order == ["estop", "estop-observer", "level", "pump"]


def test_front_end_update_is_a_batch():
    e = ai.EmergencyStop()
    order = []
    e.observe(lambda c: order.append(("value", c["new"])), names="value")
    e.set_state({"value": True, "_pressed": True})
    assert order == [("value", True)]


def test_callbacks_outside_batch_are_synchronous():
    k = ai.Knob()
    seen = []
    k.on_change(lambda c: seen.append(c["new"]))
    k.value = 5
    assert seen == [5]


def test_led_defaults():
    led = ai.LED(True, on_color="red", blink=True)
    assert led.mode == "indicator"
    assert led.value is True
