"""SvgPanel (IND-120 .. IND-126)."""

from __future__ import annotations

import pytest
import traitlets as t

import anywidget_instruments_industrial as ai

SVG = """<svg xmlns="http://www.w3.org/2000/svg"
  xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 100 100">
  <script>alert(1)</script>
  <text id="v" inkscape:label="awi:text=vout;unit=V">0</text>
  <rect id="sp" data-awi="awi:step=sp;min=0;max=2;step=0.5"/>
  <g inkscape:label="awi:state=mode"><text inkscape:label="awi:case=AUTO">A</text></g>
  <text id="stray" inkscape:label="awi:case=OFF">O</text>
  <circle id="bad" data-awi="awi:rotate=f;min=3;max=1"/>
  <circle inkscape:label="lens"/>
</svg>"""


def test_roles_problems_and_sanitizing():
    panel = ai.SvgPanel(SVG, label="Supply")
    assert panel.mode == "control"
    assert "script" not in panel.svg
    assert 'inkscape:label="awi:text=vout;unit=V"' in panel.svg
    assert panel.names() == ["mode", "sp", "vout"]
    assert [b["role"] for b in panel.bindings()] == ["text", "step", "state", "case"]
    assert panel.problems == [
        "stray: a 'case' must be inside a 'state' element",
        "bad: option 'max' must be greater than 'min'",
    ]
    with pytest.raises(t.TraitError, match="svg"):
        panel.svg = "<svg><g></svg>"


def test_values():
    panel = ai.SvgPanel(SVG)
    panel["vout"] = 12.5
    panel.update(mode="AUTO", sp=float("nan"))
    assert panel.value == {"vout": 12.5, "mode": "AUTO", "sp": None}
    assert panel["mode"] == "AUTO"
    with pytest.raises(t.TraitError, match="must be a number"):
        panel["vout"] = [1, 2]


def test_kernel_refuses_step_values_outside_limits():
    panel = ai.SvgPanel(SVG, value={"sp": 1.0})
    panel.set_state({"value": {"sp": 5.0}})
    assert panel["sp"] == 1.0
    panel.set_state({"value": {"sp": 1.5}})
    assert panel["sp"] == 1.5


@pytest.mark.parametrize("name", ai.TEMPLATES)
def test_templates(name):
    panel = ai.SvgPanel.template(name)
    assert panel.problems == []
    assert "value" in panel.names()
    assert panel.label


def test_unknown_template():
    with pytest.raises(ValueError, match="unknown template"):
        ai.SvgPanel.template("oscilloscope")
