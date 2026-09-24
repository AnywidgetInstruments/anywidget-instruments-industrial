# Alarm color and blink conventions (SCADA-008)

The alarm objects follow the alarm-state model of **ANSI/ISA-18.2** and
**IEC 62682** (*Management of alarm systems for the process industries*). The
colors also follow common **ISA-101** HMI practice. These standards do not
require specific colors. They ask for colors that are **consistent**,
**reserved for alarms**, and backed up by **non-color cues** (text, shape).
This library follows that approach. The defaults below are CSS custom
properties, so you can adapt them to your site's HMI philosophy.

## States (`AlarmIndicator.value`)

| State | Meaning | Visual | Blink |
|---|---|---|---|
| `normal` | condition inactive, nothing to acknowledge | grey shape, text `NORMAL` | none |
| `active_unacknowledged` | condition active, operator not yet acknowledged | shape filled with the priority color, thick border in the priority color, text `ACTIVE · UNACK`, `ACK` button | **fast** (0.8 s period) |
| `active_acknowledged` | condition active, acknowledged | shape filled with the priority color, text `ACTIVE · ACK` | none (steady) |
| `cleared_unacknowledged` | condition returned to normal before acknowledgement | shape outlined in the priority color, text `CLEARED · UNACK`, `ACK` button | **slow** (2 s period) |

Transitions: `activate()` (normal/cleared → active unack), `clear()` (active
unack → cleared unack, active ack → normal) and `acknowledge()` (active unack →
active ack, cleared unack → normal). An acknowledgement from the front end
calls the `on_acknowledge` callbacks with the `alarm_id` (SCADA-007).

## Priorities (`AlarmIndicator.priority`)

| Priority | Label | Default color (`--awi-prio-*`) | Redundant shape |
|---|---|---|---|
| `critical` | P1 | red `#d10000` | diamond |
| `high` | P2 | orange `#f27b00` | triangle |
| `medium` | P3 | yellow `#e6c700` | square |
| `low` | P4 | cyan `#00a4c7` | circle |

## Numeric alarm levels (`alarm_level`)

| Level | Default color | Text badge |
|---|---|---|
| `lo`, `hi` | amber (`--awi-alarm-lo`, `--awi-alarm-hi`) | `LO`, `HI` |
| `lolo`, `hihi` | red, bold (`--awi-alarm-lolo`, `--awi-alarm-hihi`) | `LOLO`, `HIHI` |

With `deadband`, the level doesn't drop back until the value has moved back
past the limit by at least the deadband (ALARM-003).

## Reduced motion (A11Y-005)

When the user agent requests reduced motion (`prefers-reduced-motion: reduce`),
blinking is turned off. Instead, the alarm shapes (and blinking LEDs) get a
steady dashed outline, so an unacknowledged alarm still looks different from an
acknowledged one.
