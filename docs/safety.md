# Safety notice

!!! danger "Not a safety-related system"
    anywidget-instruments is a library for **visualization, teaching,
    simulation, prototyping and supervision in notebooks**. It is not designed,
    developed, verified or certified according to functional safety standards
    (IEC 61508, IEC 62061, ISO 13849-1) and **must not be used to perform a
    safety function**.

## The `EmergencyStop` widget is not an emergency stop

`EmergencyStop` draws an emergency stop button on a screen. It is **not an
emergency stop device** in the sense of ISO 13850 and IEC 60204-1. A real
emergency stop is a hardwired device, with direct opening action, that stops
the machine through a safety-rated circuit **independently of any software**.

Use the widget to represent or simulate an emergency stop (for example in a
training panel or a process simulation), or to record an operator request in
software, never as the means of stopping a machine.

## Limits of a notebook environment

A notebook is not a real-time control system:

* the kernel, the browser, the host or the network can freeze, restart or
  disconnect; operator actions and displayed values can then be delayed,
  lost, duplicated or stale. The stale-data indication (ROB-001) reduces the
  risk of acting on an old value but is not a guarantee;
* timing is not deterministic (callbacks, charts and simulations run on a
  best-effort basis);
* there is no authentication, authorization or audit trail of operator
  actions: anyone who can use the notebook or the page can operate its
  controls.

## Alarms, controllers and state models

* `AlarmIndicator`, `AlarmBanner`, `Annunciator` and `AlarmList` present
  alarms; they are not an alarm management system. An alarm system for a real
  plant is designed from an alarm philosophy and a rationalization
  (ISA-18.2, IEC 62682), and critical alarms need independent annunciation.
  Shelving and suppression can hide alarms: use them with procedures.
* `PID` and `PIDFaceplate` are meant for teaching, simulation and
  prototyping. Real processes are controlled by a validated controller, with
  output limits and independent protection (interlocks, trips, safety
  instrumented functions).
* `StateMachine` displays and enforces a machine state model in software. It
  does not replace the machine's control system nor its safety functions.

## Connecting to real equipment

Hardware drivers are outside the scope of the library. If you connect the
widgets to real equipment, you are responsible for:

* the risk assessment and risk reduction of the machine or process
  (ISO 12100), with safety functions implemented independently of the library;
* compliance with the regulations that apply to you (for example the
  Machinery Regulation (EU) 2023/1230 in the European Union);
* the cyber security of the installation (IEC 62443): a notebook server is a
  remote code execution service and must not be exposed to untrusted networks.

## No warranty

The library is distributed under the MIT license, "as is", without warranty of
any kind (see the `LICENSE` file).

The standards cited in this notice, and those that inspired the widgets, are
listed with their disclaimer in [Standards and references](standards.md).
