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
* there is no authentication, no authorization and no tamper-proof audit
  trail of operator actions: anyone who can use the notebook or the page
  can operate its controls, and `EventLog` records actions in a way any
  code of the kernel can change.

## Why there is no password field

The library deliberately provides no password, PIN or login widget, for
three reasons.

* **A widget cannot keep a secret.** Every trait of a widget is synchronized
  in clear text between the kernel and the browser. It can be read from the
  kernel (`widget.value`) by any code running in the notebook, from the
  widget model in the browser, and it is written into the notebook file when
  the widget state is saved. Masking the characters on screen would hide the
  secret from someone looking over the operator's shoulder, not from anyone
  with access to the notebook.
* **A check in a notebook protects nothing.** Whoever can use the notebook
  can run code in its kernel, and therefore read the expected password, set
  the values of the controls directly, or skip the check. A password prompt
  would suggest an access control that does not exist.
* **Access control belongs elsewhere.** Authentication and authorization are
  the job of the host (the notebook server, JupyterHub, the marimo server
  or the page that embeds the widgets, behind the organization's identity
  provider) and of the control system itself (user management of the
  controller or the supervisory system, zones and conduits of IEC 62443).

What to use instead:

* to type a secret needed by your code (the password of a database or an
  instrument), use `getpass.getpass()` in Jupyter or a password input of
  the notebook tool, or read it from an environment variable, a key ring or
  a secrets manager; never store it in a widget trait;
* to restrict who can open or run a notebook, use the authentication of the
  notebook server;
* to represent a local / remote or maintenance access right on a panel, use
  a keyed `SelectorSwitch` (`keyed=True, locked=True`): the kernel refuses
  the operator's changes while it is locked, but it is a simulation of a key
  switch, not a security measure.

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

The library is distributed under the BSD 3-Clause license, "as is", without warranty of
any kind (see the `LICENSE` file).

The standards cited in this notice, and those that inspired the widgets, are
listed with their disclaimer in [Standards and references](standards.md).
