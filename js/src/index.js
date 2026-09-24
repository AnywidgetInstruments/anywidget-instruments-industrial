// anywidget-instruments front-end entry point (AFM module).
// A single bundle serves every widget; the `_kind` trait selects the view.
import { watchModel } from "./core/liveness.js";
import { AlarmView } from "./widgets/alarm.js";
import { AlarmListView } from "./widgets/alarmlist.js";
import { AnnunciatorView } from "./widgets/annunciator.js";
import { BooleanView } from "./widgets/boolean.js";
import { ChartView } from "./widgets/chart.js";
import { DigitalView } from "./widgets/digital.js";
import { AnalogIndicatorView, SelectorView, StackLightView } from "./widgets/industrial.js";
import { IntensityView } from "./widgets/intensity.js";
import { BannerView } from "./widgets/banner.js";
import { PIDView } from "./widgets/pid.js";
import { PictureView } from "./widgets/picture.js";
import { PolarView } from "./widgets/polar.js";
import { PipeView, ProcessView, SynopticView } from "./widgets/process.js";
import { LinearView } from "./widgets/linear.js";
import { RotaryView } from "./widgets/rotary.js";
import { SevenSegmentView } from "./widgets/sevensegment.js";
import { StateMachineView } from "./widgets/statemachine.js";
import { ThemeSwitchView } from "./widgets/themeswitch.js";
import { BarGraphView, DeviationView, KPITileView, SparklineView } from "./widgets/compact.js";
import { EventLogView } from "./widgets/eventlog.js";
import { KeypadView } from "./widgets/keypad.js";
import { TransmitterView } from "./widgets/transmitter.js";
import { TrendView } from "./widgets/trend.js";

const VIEWS = {
  knob: RotaryView,
  dial: RotaryView,
  gauge: RotaryView,
  meter: RotaryView,
  compass: RotaryView,
  tank: LinearView,
  thermometer: LinearView,
  fillslide: LinearView,
  vumeter: LinearView,
  sevensegment: SevenSegmentView,
  led: BooleanView,
  toggleswitch: BooleanView,
  rockerswitch: BooleanView,
  slideswitch: BooleanView,
  pushbutton: BooleanView,
  emergencystop: BooleanView,
  waveformchart: ChartView,
  intensitychart: IntensityView,
  digitalgraph: DigitalView,
  mixedgraph: DigitalView,
  alarmindicator: AlarmView,
  picture: PictureView,
  polar: PolarView,
  smith: PolarView,
  radar: PolarView,
  alarmbanner: BannerView,
  valve: ProcessView,
  pump: ProcessView,
  motor: ProcessView,
  pipe: PipeView,
  synoptic: SynopticView,
  analogindicator: AnalogIndicatorView,
  selectorswitch: SelectorView,
  stacklight: StackLightView,
  pidfaceplate: PIDView,
  annunciator: AnnunciatorView,
  alarmlist: AlarmListView,
  statemachine: StateMachineView,
  themeswitch: ThemeSwitchView,
  trendchart: TrendView,
  transmitter: TransmitterView,
  eventlog: EventLogView,
  deviation: DeviationView,
  sparkline: SparklineView,
  bargraph: BarGraphView,
  kpitile: KPITileView,
  numericentry: KeypadView,
};

function render({ model, el }) {
  const View = VIEWS[model.get("_kind")];
  if (!View) {
    el.textContent = `anywidget-instruments: unknown widget kind "${model.get("_kind")}"`;
    return undefined;
  }
  const view = new View(model, el);
  return () => view.destroy();
}

function initialize({ model }) {
  watchModel(model);
}

export default { initialize, render };
