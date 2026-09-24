# Examples

The notebooks live in the `examples/` folder of the repository. Each one runs a
live simulation in a background thread (set the environment variable
`AWI_EXAMPLE_SECONDS` to limit its duration).

!!! note
    The demos and examples simulate processes and machines; they are not
    meant to control real equipment (see the [safety notice](safety.md)).

Grouped by industry sector. The local notebooks (source on GitHub) use
threads and need a local Jupyter or marimo; the in-browser demos run with
nothing to install, as marimo apps or JupyterLite notebooks (see
[Try it in the browser](try.md)).

| Sector | Local example | In the browser |
|---|---|---|
| All sectors (tour) | <a href="https://github.com/s-celles/anywidget-instruments/blob/main/examples/gallery.ipynb">Gallery</a>, <a href="https://github.com/s-celles/anywidget-instruments/blob/main/examples/marimo_panel.py">marimo panel</a> | <a href="../marimo/gallery/">Gallery</a> (<a href="../lite/lab/index.html?path=gallery.ipynb">JupyterLite</a>) |
| Water and wastewater | <a href="https://github.com/s-celles/anywidget-instruments/blob/main/examples/tank_supervision.ipynb">Tank level supervision</a> | <a href="../marimo/lift_station/">Lift station</a> (<a href="../lite/lab/index.html?path=lift_station.ipynb">JupyterLite</a>) |
| Chemical and process control | <a href="https://github.com/s-celles/anywidget-instruments/blob/main/examples/pid_first_order.ipynb">First-order process with PID tuning</a> | <a href="../marimo/pid_tuning/">PID tuning</a> (<a href="../lite/lab/index.html?path=pid_tuning.ipynb">JupyterLite</a>) |
| Food, beverage and packaging | <a href="https://github.com/s-celles/anywidget-instruments/blob/main/examples/filling_line.ipynb">Filling line operator station</a> | <a href="../marimo/operator_station/">Operator station</a> (<a href="../lite/lab/index.html?path=operator_station.ipynb">JupyterLite</a>) |
| Laboratory, test and measurement | <a href="https://github.com/s-celles/anywidget-instruments/blob/main/examples/signal_acquisition.ipynb">Real-time signal acquisition</a> | <a href="../marimo/signal_analysis/">Signal analysis</a> (<a href="../lite/lab/index.html?path=signal_analysis.ipynb">JupyterLite</a>)<br><a href="../marimo/virtual_instrument/">Virtual instrument bench</a> (<a href="../lite/lab/index.html?path=virtual_instrument.ipynb">JupyterLite</a>) |
| Machine panels |  | <a href="../marimo/push_buttons/">Push buttons</a> (<a href="../lite/lab/index.html?path=push_buttons.ipynb">JupyterLite</a>)<br><a href="../marimo/switches/">Switches and selectors</a> (<a href="../lite/lab/index.html?path=switches.ipynb">JupyterLite</a>) |


## All sectors

### Gallery — `examples/gallery.ipynb`

Every widget in control and indicator modes.

![Gallery](img/gallery.png)

### marimo — `examples/marimo_panel.py`

```bash
marimo edit examples/marimo_panel.py
```


## Water and wastewater

### Tank level supervision with alarms — `examples/tank_supervision.ipynb`

Pump, tank and outflow valve on a synoptic; LO/HI/HIHI alarms with deadband
feed an ISA-18.2 alarm banner; AUTO hysteresis control or MANUAL operation
from the faceplates.

![Tank supervision](img/tank_supervision.png)


## Chemical and process control

### First-order process with PID tuning — `examples/pid_first_order.ipynb`

A plant $K/(\tau s + 1)$ with a PID controller (derivative on measurement,
anti-windup): tune Kp, Ti and Td live, step the setpoint, stop with the
emergency stop and measure the response with cursors.

![PID tuning](img/pid_first_order.png)


## Food, beverage and packaging

### Filling line operator station — `examples/filling_line.ipynb`

A bottle filling line driven by the ISA-TR88.00.02 state model, with a
HAND / OFF / AUTO selector, a stack light, a PID faceplate for the product
temperature, the fill weight on a high-performance indicator, an ISA-18.1
annunciator and an alarm list with shelving.

![Filling line](img/filling_line.png)


## Laboratory, test and measurement

### Real-time signal acquisition — `examples/signal_acquisition.ipynb`

Two channels at 1 kHz on a strip chart, a spectrogram of channel 0, RMS level
on a VU meter and the dominant frequency on a seven-segment display.

![Signal acquisition](img/signal_acquisition.png)
