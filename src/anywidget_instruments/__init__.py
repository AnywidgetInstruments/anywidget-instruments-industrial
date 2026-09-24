"""Instrumentation widgets for computational notebooks."""

from ._alarm_logic import ALARM_LEVELS, compute_alarm_level, eng_scale
from ._alarmlist import AlarmList
from ._annunciator import ANN_COLORS, ANN_SEQUENCES, ANN_STATES, Annunciator, annunciator_transition
from ._base import InstrumentWidget
from ._boolean import (
    BUTTON_COLORS,
    LAMP_COLORS,
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
from ._eventlog import EVENT_CATEGORIES, EventLog
from ._graph import GraphWidget
from ._graphs import (
    COLORMAPS,
    DigitalWaveformGraph,
    IntensityChart,
    MixedSignalGraph,
    unpack_bits,
)
from ._industrial import STACK_COLORS, STACK_STATES, AnalogIndicator, SelectorSwitch, StackLight
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
from ._pid import PID, PID_MODES, PIDFaceplate
from ._polar import PolarPlot, RadarChart, SmithChart
from ._process import PIPE_SHAPES, Motor, Pipe, ProcessObject, Pump, SynopticCanvas, Valve
from ._sanitize import sanitize_svg
from ._scada import ALARM_PRIORITIES, ALARM_STATES, AlarmBanner, AlarmIndicator, alarm_transition
from ._statemachine import PACKML_COMMANDS, PACKML_MODEL, StateMachine
from ._style import (
    STYLES,
    THEMES,
    get_default_style,
    get_default_theme,
    set_default_style,
    set_theme,
    theme_switch,
)
from ._themeswitch import THEME_SWITCH_POSITIONS, ThemeSwitch
from ._transmitter import DEVICE_STATUSES, Transmitter
from ._trend import TrendChart

__version__ = "0.1.0.dev0"

__all__ = [
    "ALARM_LEVELS",
    "ALARM_PRIORITIES",
    "ALARM_STATES",
    "ANN_COLORS",
    "ANN_SEQUENCES",
    "ANN_STATES",
    "BUTTON_COLORS",
    "COLORMAPS",
    "DEVICE_STATUSES",
    "EVENT_CATEGORIES",
    "LAMP_COLORS",
    "LED",
    "MECHANICAL_ACTIONS",
    "PACKML_COMMANDS",
    "PACKML_MODEL",
    "PID",
    "PID_MODES",
    "PIPE_SHAPES",
    "STACK_COLORS",
    "STACK_STATES",
    "STYLES",
    "THEMES",
    "THEME_SWITCH_POSITIONS",
    "AlarmBanner",
    "AlarmIndicator",
    "AlarmList",
    "AnalogIndicator",
    "Annunciator",
    "BooleanWidget",
    "Compass",
    "Dial",
    "DigitalWaveformGraph",
    "EmergencyStop",
    "EventLog",
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
    "PIDFaceplate",
    "Panel",
    "PictureControl",
    "Pipe",
    "PolarPlot",
    "ProcessObject",
    "Pump",
    "PushButton",
    "RadarChart",
    "RockerSwitch",
    "SelectorSwitch",
    "SevenSegment",
    "SlideSwitch",
    "SmithChart",
    "StackLight",
    "StateMachine",
    "SynopticCanvas",
    "Tank",
    "ThemeSwitch",
    "Thermometer",
    "ToggleSwitch",
    "Transmitter",
    "TrendChart",
    "VUMeter",
    "Valve",
    "WaveformChart",
    "alarm_transition",
    "annunciator_transition",
    "batch",
    "compute_alarm_level",
    "eng_scale",
    "get_default_style",
    "get_default_theme",
    "get_heartbeat",
    "sanitize_svg",
    "set_default_style",
    "set_heartbeat",
    "set_theme",
    "theme_switch",
    "unpack_bits",
]
