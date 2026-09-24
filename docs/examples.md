# Examples

The notebooks live in the `examples/` folder of the repository. Each one runs a
live simulation in a background thread (set the environment variable
`AWI_EXAMPLE_SECONDS` to limit its duration).

!!! note
    The demos and examples simulate processes and machines; they are not
    meant to control real equipment (see the [safety notice](safety.md)).

Grouped by industry sector. Each example has an in-browser counterpart
(no install) where one exists; the local notebooks use threads and need a
local Jupyter or marimo.

| Sector | Local example | In the browser |
|---|---|---|
| All sectors (tour) | Gallery, marimo panel | [Gallery](try.md) |
| Water and wastewater | Tank level supervision | |
| Chemical and process control | First-order process with PID tuning | [PID tuning](try.md) |
| Food, beverage and packaging | Filling line operator station | [Operator station](try.md) |
| Laboratory, test and measurement | Real-time signal acquisition | [Signal analysis](try.md) |


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
