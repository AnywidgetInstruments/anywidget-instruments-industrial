# Widget catalog

![Widget gallery, system style in a dark host](img/gallery-dark.png)

## Numeric controls and indicators

| Widget | Default mode | Notes |
|---|---|---|
| `Knob` | control | `angle_range` |
| `Dial` | control | `turns` for multi-turn operation |
| `Gauge` | indicator | `variant="circular"/"semicircular"`, colored `ranges`, `peak_hold` |
| `Meter` | indicator | sector scale, `peak_hold` |
| `VUMeter` | indicator | `segments`, `peak_hold`, `peak_decay` |
| `Tank` | indicator | `markers`, `fill_color` |
| `Thermometer` | indicator | bulb and fluid column |
| `FillSlide` | control | `orientation` horizontal / vertical |
| `SevenSegment` | indicator | `digits`, `decimals`, `color` |
| `Compass` | indicator | heading in degrees |

## Boolean controls and indicators

`LED` (round/square, `blink`), `ToggleSwitch`, `RockerSwitch`,
`SlideSwitch`, `PushButton`, `EmergencyStop` (latches, `reset()`), all with
`mechanical_action`, `confirm` (two-step confirmation) and `latch_timeout`.

## Graphs

All graphs share cursors (`add_cursor`, `cursor_values`), annotations
(`annotate`), zoom (toolbar, wheel, double-click reset) and export
(CSV / PNG / SVG).

```python
chart = ai.WaveformChart(
    n_traces=2, history=2000, dt=1e-3, x_unit="s", update_mode="strip", autoscale_y=True
)
chart.append(samples)  # (n_points, n_traces), sent as binary float32

spec = ai.IntensityChart(n_bins=256, y_max=fs / 2, colormap="inferno")
spec.append(np.abs(np.fft.rfft(block))[:256])

logic = ai.DigitalWaveformGraph(buses=[{"name": "DATA", "lines": [7, 6, 5, 4, 3, 2, 1, 0]}])
logic.set_data(bytes_read, n_bits=8)

mixed = ai.MixedSignalGraph(dt=1e-6)
mixed.set_analog(v)
mixed.set_data(trigger)
```

## Specialized displays

```python
polar = ai.PolarPlot(zero="N", direction="cw")
polar.plot(gain_db, angles_deg, name="pattern")

smith = ai.SmithChart(z0=50)
smith.plot(impedances, name="S11")  # complex ohms, or kind="reflection"

radar = ai.RadarChart(axes=["speed", "power", "cost"])
radar.plot([4, 3, 5], name="A")

pic = ai.PictureControl(size=(320, 200))
pic.rect(10, 10, 100, 50, fill="#3b82f6").text(20, 40, "hello").flush()
pic.on_click(lambda e: print(e["x"], e["y"]))
```

## Supervisory objects

`Valve`, `Pump`, `Motor` (state feedback, faceplate commands with
`on_command`, `auto`/manual, optional `simulate`), `Pipe` segments,
`AlarmIndicator`, `AlarmBanner` and `SynopticCanvas`, which places widgets and
animated pipe runs on a background image.

![Tank supervision](img/tank_supervision.png)
