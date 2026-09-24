# Standards and references

The design of anywidget-instruments draws on the standards and methods listed
below: they shaped the behaviour, the colors and the vocabulary of the widgets.
This page names them so that readers can go to the original texts.

!!! warning "Disclaimer"
    * **No claim of conformity.** anywidget-instruments does not claim to
      conform to, comply with, or implement any of these standards, in whole
      or in part. It has not been assessed, tested or certified against them
      by anyone, and the organizations that publish them have neither reviewed
      nor endorsed it.
    * **Inspiration, not implementation.** The standards were used as design
      references. Where a widget follows a convention (a color, an alarm
      sequence, a state model), the behaviour is our own reading of publicly
      known principles and may be incomplete, simplified or outdated. It is
      not tied to a particular edition of any standard.
    * **Using the widgets does not make a system compliant.** Compliance of an
      HMI, an alarm system or a machine is a property of the whole system, its
      design process and its documentation, established by its owner.
    * **Safety.** The safety standards listed below are cited only to state
      what the library is *not*: it is not a safety function and must not be
      used as one (see the [safety notice](safety.md)).
    * **Copyright and trademarks.** The standards are copyrighted documents of
      their publishers; no text of them is reproduced here. Consult the
      official editions, available from the publishers. Names such as ISA,
      IEC, ISO, NAMUR, W3C, WCAG and PackML are trademarks or names of their
      respective owners and are used only to identify the documents.

## Human-machine interfaces and alarms

| Reference | Subject | How it informs the library | Requirements |
|---|---|---|---|
| ANSI/ISA-101.01 | Human-machine interfaces for process automation systems | Grey-scale presentation in normal operation, color reserved for abnormal situations; analog indicators with normal band, limits and target; operator faceplates | IND-001 .. IND-003, IND-030 .. IND-034 |
| ANSI/ISA-18.1 | Annunciator sequences and specifications | Annunciator window sequences A (automatic reset), M (manual reset) and R (ringback), first-out indication, silence / acknowledge / reset / test | IND-040 .. IND-043 |
| ANSI/ISA-18.2 and IEC 62682 | Management of alarm systems for the process industries | Alarm states (active / cleared, acknowledged / unacknowledged), priorities, shelving, suppression, out of service, alarm banner and alarm list | ALARM-001 .. , IND-050 .. IND-053 |
| ANSI/ISA-5.1 | Instrumentation symbols and identification | Tag naming (for example `TIC-101`, `LS-100`) and the general look of process symbols (valve, pump, motor) | SCADA-001 .. |
| ISA-TR88.00.02 (PackML) | Machine and unit states | Default state model of `StateMachine`: states, acting states and operator commands | IND-060 .. IND-063 |

## Controls, indicators and machines

| Reference | Subject | How it informs the library | Requirements |
|---|---|---|---|
| IEC 60073 | Coding principles for indicators and actuators (colors, shapes) | Colors of push button caps and lamps, stack light tiers and LEDs (green to start or run, red to stop or alarm, amber for attention), meaning conveyed by shape or text as well as color | BOOL-006, BOOL-015, IND-020 .. IND-022 |
| IEC 60204-1 and ISO 13850 | Electrical equipment of machines; emergency stop function | **Cited only to delimit scope**: the `EmergencyStop` widget borrows the familiar red-on-yellow look but is not an emergency stop device | BOOL-012, DOC-007 |

## Functional safety and security (scope only)

These documents are cited in the [safety notice](safety.md) to say that the
library is outside their scope; none of their requirements is implemented.

| Reference | Subject |
|---|---|
| IEC 61508 | Functional safety of electrical / electronic / programmable electronic safety-related systems |
| IEC 62061 and ISO 13849-1 | Functional safety of machinery control systems |
| ISO 12100 | Safety of machinery: risk assessment and risk reduction |
| IEC 62443 | Security for industrial automation and control systems |

## Accessibility, units and notation

| Reference | Subject | How it informs the library | Requirements |
|---|---|---|---|
| W3C WCAG 2.1 | Web content accessibility guidelines | Contrast targets (4.5:1 for text, 3:1 for graphical objects) checked by the test suite; keyboard operation; reduced motion | A11Y-001 .. |
| W3C WAI-ARIA | Accessible rich internet applications | Roles and states of the widgets (`meter`, `slider`, `switch`, `radiogroup`, …) | A11Y-002 .. |
| SI (BIPM SI Brochure) | International System of Units | Units and SI prefixes in engineering notation | UNIT-001 .. UNIT-004 |

## Requirements method

| Reference | Subject |
|---|---|
| EARS (Easy Approach to Requirements Syntax, A. Mavin et al., 2009) | Sentence patterns used to write the [specification](specification.md) |
