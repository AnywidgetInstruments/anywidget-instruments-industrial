# Examples

The notebooks live in the `examples/` folder of the repository. Each one runs a
live simulation in a background thread (set the environment variable
`AWI_EXAMPLE_SECONDS` to limit its duration).

## Gallery — `examples/gallery.ipynb`

Every widget in control and indicator modes.

![Gallery](img/gallery.png)

## First-order process with PID tuning — `examples/pid_first_order.ipynb`

A plant $K/(\tau s + 1)$ with a PID controller (derivative on measurement,
anti-windup): tune Kp, Ti and Td live, step the setpoint, stop with the
emergency stop and measure the response with cursors.

![PID tuning](img/pid_first_order.png)

## Tank level supervision with alarms — `examples/tank_supervision.ipynb`

Pump, tank and outflow valve on a synoptic; LO/HI/HIHI alarms with deadband
feed an ISA-18.2 alarm banner; AUTO hysteresis control or MANUAL operation
from the faceplates.

![Tank supervision](img/tank_supervision.png)

## Real-time signal acquisition — `examples/signal_acquisition.ipynb`

Two channels at 1 kHz on a strip chart, a spectrogram of channel 0, RMS level
on a VU meter and the dominant frequency on a seven-segment display.

![Signal acquisition](img/signal_acquisition.png)

## marimo — `examples/marimo_panel.py`

```bash
marimo edit examples/marimo_panel.py
```
