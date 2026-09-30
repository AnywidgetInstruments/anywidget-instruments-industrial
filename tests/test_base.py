import pytest
import traitlets as t

import anywidget_instruments_industrial as ai


def test_on_change_callback_and_decorator():
    k = ai.Knob()
    seen = []

    @k.on_change
    def cb(change):
        seen.append(change["new"])

    k.value = 12
    assert seen == [12]


def test_callback_exception_is_logged_and_widget_keeps_working(capsys):
    k = ai.Knob()
    seen = []

    def bad(change):
        raise RuntimeError("boom")

    k.on_change(bad)
    k.observe(lambda c: seen.append(c["new"]), names="value")
    k.value = 1
    k.value = 2
    assert seen == [1, 2]
    err = capsys.readouterr().err
    assert "boom" in err and "Knob" in err


def test_unobserve_wrapped_handler():
    k = ai.Knob()
    seen = []

    def cb(c):
        seen.append(c["new"])

    k.observe(cb, names="value")
    k.unobserve(cb, names="value")
    k.value = 3
    assert seen == []


def test_single_bundle_offline():
    # GEN-005: the bundle references no URL except the SVG namespace identifier
    js = ai.Knob()._esm
    text = js if isinstance(js, str) else js.read_text()
    text = text.replace("http://www.w3.org/2000/svg", "")
    assert "http://" not in text and "https://" not in text
    assert "import(" not in text


def test_panel_serialization():
    k = ai.Knob(10, label="Gain")
    s = ai.ToggleSwitch(label="Run")
    g = ai.Gauge(3, label="Pressure")
    c = ai.WaveformChart(label="Signal")
    p = ai.Panel([k, s, g, c], columns=2)
    state = p.to_dict()
    assert state == {"Gain": 10, "Run": False, "Pressure": 3}
    p.from_dict({"Gain": 42, "Run": True, "unknown": 1})
    assert k.value == 42 and s.value is True


def test_skin_is_sanitized():
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
        "<script>alert(1)</script>"
        '<rect width="10" height="10" onclick="evil()" style="fill:url(http://x/y)"/>'
        '<image xlink:href="https://example.com/a.png"/>'
        '<use href="#ok"/>'
        "<foreignObject><div>x</div></foreignObject>"
        "</svg>"
    )
    k = ai.Knob(skin={"background": svg})
    out = k.skin["background"]
    assert "script" not in out
    assert "onclick" not in out
    assert "example.com" not in out
    assert "http://x/y" not in out
    assert "foreignObject" not in out
    assert 'href="#ok"' in out


def test_invalid_skin_rejected():
    with pytest.raises(t.TraitError):
        ai.Knob(skin={"background": "<div/>"})
    with pytest.raises(t.TraitError):
        ai.Knob(skin={"background": '<!DOCTYPE x [<!ENTITY a "b">]><svg/>'})


def test_skin_parts_are_validated():
    svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>'
    k = ai.Knob(skin={"knob": svg, "housing": svg, "background": svg})
    assert set(k.skin) == {"knob", "housing", "background"}
    with pytest.raises(t.TraitError, match="unknown part"):
        ai.Gauge(skin={"neddle": svg})


def test_on_change_decorator_with_arguments():
    g = ai.Gauge(50, hi=80)
    seen = []

    @g.on_change(names="alarm_level")
    def _(change):
        seen.append(change["new"])

    g.value = 90
    assert seen == ["hi"]


# -- DOC-007: safety notice -------------------------------------------------------------
@pytest.mark.parametrize(
    "name",
    [
        "EmergencyStop",
        "AlarmIndicator",
        "AlarmBanner",
        "Annunciator",
        "AlarmList",
        "PID",
        "PIDFaceplate",
        "StateMachine",
    ],
)
def test_safety_related_classes_refer_to_the_safety_notice(name):
    doc = getattr(ai, name).__doc__
    assert "safety notice" in doc and "DOC-007" in doc


# -- STYLE-007: light / dark theme -----------------------------------------------------------
def test_set_theme_switches_open_and_new_widgets():
    try:
        knob = ai.Knob()
        ai.set_theme("dark")
        assert knob.theme == "dark" and ai.Gauge().theme == "dark"
        with pytest.raises(ValueError, match="theme"):
            ai.set_theme("blue")
    finally:
        ai.set_theme("auto")
    assert knob.theme == "auto"


def test_theme_switch_has_three_positions():
    """STYLE-008: light / system / dark switch driving every widget."""
    try:
        tank = ai.Tank()
        switch = ai.theme_switch()
        assert isinstance(switch, ai.ThemeSwitch) and switch.page_theme
        assert switch.value == "auto" and switch.label == "Theme"
        for position in ai.THEME_SWITCH_POSITIONS:
            switch.value = position
            assert tank.theme == position and ai.Knob().theme == position
        with pytest.raises(t.TraitError):
            switch.value = "sepia"
        ai.set_theme("dark")
        assert ai.theme_switch().value == "dark"  # starts from the current theme
    finally:
        ai.set_theme("auto")


def test_system_theme():
    assert "system" in ai.THEMES
    assert ai.Gauge(theme="system").theme == "system"
