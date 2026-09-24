"""Instrumentation widgets for computational notebooks."""

from ._alarm_logic import ALARM_LEVELS, compute_alarm_level, eng_scale
from ._base import InstrumentWidget
from ._boolean import (
    LED,
    MECHANICAL_ACTIONS,
    BooleanWidget,
    EmergencyStop,
    PushButton,
    RockerSwitch,
    SlideSwitch,
    ToggleSwitch,
)
from ._chart import WaveformChart
from ._dispatch import batch
from ._graph import GraphWidget
from ._graphs import (
    COLORMAPS,
    DigitalWaveformGraph,
    IntensityChart,
    MixedSignalGraph,
    unpack_bits,
)
from ._liveness import get_heartbeat, set_heartbeat
from ._numeric import (
    Compass,
    Dial,
    FillSlide,
    Gauge,
    Knob,
    Meter,
    NumericWidget,
    SevenSegment,
    Tank,
    Thermometer,
    VUMeter,
)
from ._panel import Panel
from ._picture import PictureControl
from ._polar import PolarPlot, RadarChart, SmithChart
from ._process import PIPE_SHAPES, Motor, Pipe, ProcessObject, Pump, SynopticCanvas, Valve
from ._sanitize import sanitize_svg
from ._scada import ALARM_PRIORITIES, ALARM_STATES, AlarmBanner, AlarmIndicator, alarm_transition
from ._style import STYLES, get_default_style, set_default_style

__version__ = "0.1.0.dev0"

__all__ = [
    "ALARM_LEVELS",
    "ALARM_PRIORITIES",
    "ALARM_STATES",
    "COLORMAPS",
    "LED",
    "MECHANICAL_ACTIONS",
    "PIPE_SHAPES",
    "STYLES",
    "AlarmBanner",
    "AlarmIndicator",
    "BooleanWidget",
    "Compass",
    "Dial",
    "DigitalWaveformGraph",
    "EmergencyStop",
    "FillSlide",
    "Gauge",
    "GraphWidget",
    "InstrumentWidget",
    "IntensityChart",
    "Knob",
    "Meter",
    "MixedSignalGraph",
    "Motor",
    "NumericWidget",
    "Panel",
    "PictureControl",
    "Pipe",
    "PolarPlot",
    "ProcessObject",
    "Pump",
    "PushButton",
    "RadarChart",
    "RockerSwitch",
    "SevenSegment",
    "SlideSwitch",
    "SmithChart",
    "SynopticCanvas",
    "Tank",
    "Thermometer",
    "ToggleSwitch",
    "VUMeter",
    "Valve",
    "WaveformChart",
    "alarm_transition",
    "batch",
    "compute_alarm_level",
    "eng_scale",
    "get_default_style",
    "get_heartbeat",
    "sanitize_svg",
    "set_default_style",
    "set_heartbeat",
    "unpack_bits",
]
