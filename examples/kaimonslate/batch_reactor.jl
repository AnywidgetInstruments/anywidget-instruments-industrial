try; import KaimonSlate; catch; error("This is a Kaimon Slate notebook — running it as plain Julia needs the KaimonSlate runtime in this environment. Add it with `import Pkg; Pkg.add(\"KaimonSlate\")`, or open it in Kaimon Slate."); end; KaimonSlate.standalone!(@__MODULE__; dir=@__DIR__)

#%% md id=intro
@md"""
# Batch reactor R-101 — anywidget-instruments in Julia

The same operator station as the Python showcase, driven by **Julia**: a jacketed batch reactor
(feed pump and valve, agitator, jacket heating under PID control, drain pump) runs a batch
through the phases of a **recipe** under a **PackML state machine**.

The widgets are the front-end modules of the Python package `anywidget-instruments`, hosted by
the **SlateAFM** extension: no Python kernel runs. Julia owns the process: it computes the level
and the temperature, runs the PI controller, completes the acting states, raises the alarms and
feeds the trend. The widgets apply the operator actions themselves (commands, recipe edits,
setpoint and mode changes, alarm acknowledgements), following the trait contract of the package.

1. Press **Run simulation**, then **Reset** and **Start** on the state diagram.
2. Edit the recipe while the reactor is **Idle** or **Complete**.
3. Press **AGITATOR TRIP**: an alarm is raised and the batch is held. Press **FAULT RESET**,
   then **Unhold**.

References: ISA-TR88.00.02 (PackML states), ISA-88 / IEC 61512-1 (recipe phases), ISA-101
(faceplate), ISA-18.2 / IEC 62682 (alarm list), IEC 60073 (stack light), IEC 62264 (equipment
hierarchy). They inspired the widgets; the library does not claim conformity with them. This is a
simulation, not a control system: see the safety notice of the documentation.
"""

#%% md id=setup_doc
@md"""
## Setup

`pypi_afm` installs the Python package with the system `pip`, reads each widget's front-end
module and trait defaults, and serves them; nothing Python runs afterwards. Until the package is
published, point `AWI_PACKAGE` at a wheel (built with `python -m build` in the repository, or the
one served with the documentation site).
"""

#%% code id=setup
using SlateAFM
import Dates

const AWI = get(ENV, "AWI_PACKAGE", "anywidget-instruments")
awi(class; traits...) = pypi_afm(AWI; import_as = "anywidget_instruments", class = class, traits...)

"Current traits of the bound widget `name` (a handle or a Dict), as a plain Dict."
traits(name::Symbol) = Dict{String,Any}(String(k) => v for (k, v) in getfield(@__MODULE__, name))

"Write some traits of the bound widget `name`: the widget redraws, the other traits are kept."
setw!(name::Symbol; kw...) = set_bind(name, merge(traits(name), Dict{String,Any}(String(k) => v for (k, v) in kw)))

# equipment modules of the plant model, with their status
const PLANT = [("feed", "Feed (P-101, XV-101)"), ("heat", "Heating (TIC-101)"),
               ("agit", "Agitator (M-101)"), ("drain", "Drain (P-102, XV-102)")]
plant_nodes(status) = [Dict("label" => "Plant", "level" => "site", "children" => [
    Dict("label" => "Reactors", "level" => "area", "children" => [
        Dict("id" => "R-101", "label" => "R-101 batch reactor", "level" => "unit", "children" => [
            Dict("id" => id, "label" => label, "level" => "equipment", "status" => get(status, id, "normal"))
            for (id, label) in PLANT])])])]

#%% md id=station_doc
@md"""
## Operator station
"""

#%% code id=machine
@bind machine awi("StateMachine"; label = "R-101 state (PackML)", size = [560, 250])

#%% code id=light
@bind light awi("StackLight"; tiers = ["red", "amber", "green"],
                labels = ["Fault", "Attention", "Running"], label = "Stack light")

#%% code id=batches
@bind batches awi("KPITile"; id = "batches", value = 0, unit = "batches", format = "%.0f",
                  target = 3, label = "Batches today", size = [240, 110])

#%% code id=recipe
@bind recipe awi("RecipeTable"; label = "Recipe PR-12 (edit while Idle)", size = [560, 170],
    columns = [
        Dict("name" => "phase", "title" => "Phase", "type" => "text", "readonly" => true),
        Dict("name" => "level", "title" => "Level", "unit" => "m", "min" => 0.5, "max" => 3.5, "step" => 0.1),
        Dict("name" => "temp", "title" => "Temperature", "unit" => "°C", "min" => 20, "max" => 90, "step" => 1),
        Dict("name" => "hold", "title" => "Hold", "unit" => "s", "min" => 0, "max" => 600, "step" => 5),
        Dict("name" => "agitator", "title" => "Agitator", "type" => "choice", "choices" => ["off", "on"]),
    ],
    value = [
        Dict("phase" => "Fill", "level" => 3.0, "temp" => 20, "hold" => 0, "agitator" => "off"),
        Dict("phase" => "Heat", "level" => 3.0, "temp" => 70, "hold" => 0, "agitator" => "on"),
        Dict("phase" => "React", "level" => 3.0, "temp" => 70, "hold" => 60, "agitator" => "on"),
        Dict("phase" => "Cool", "level" => 3.0, "temp" => 40, "hold" => 0, "agitator" => "on"),
    ])

#%% md id=process_doc
@md"""
## Process
"""

#%% code id=level
@bind level awi("Tank"; value = 0.0, max = 4, unit = "m", format = "%.2f", hi = 3.6,
                show_limits = true, label = "LT-101 level")

#%% code id=temp
@bind temp awi("Thermometer"; value = 20.0, min = 0, max = 100, unit = "°C", hi = 85,
               show_limits = true, label = "TT-101")

#%% code id=tic
@bind tic awi("PIDFaceplate"; tag = "TIC-101", unit = "°C", pv = 20.0, pv_max = 100, sp = 70.0,
              hi = 85, op_unit = "%", confirm_delta = 15, label = "Jacket temperature")

#%% code id=feed_valve
@bind feed_valve awi("Valve"; mode = "indicator", tag = "XV-101", label = "Feed valve")

#%% code id=feed_pump
@bind feed_pump awi("Pump"; mode = "indicator", tag = "P-101", label = "Feed pump")

#%% code id=agitator
@bind agitator awi("Motor"; mode = "indicator", tag = "M-101", label = "Agitator")

#%% code id=drain_valve
@bind drain_valve awi("Valve"; mode = "indicator", tag = "XV-102", label = "Drain valve")

#%% code id=drain_pump
@bind drain_pump awi("Pump"; mode = "indicator", tag = "P-102", label = "Drain pump")

#%% code id=trip
@bind trip awi("PushButton"; text = "AGITATOR TRIP", color = "yellow", label = "Simulate a fault",
               size = [170, 60])

#%% code id=reset
@bind reset awi("PushButton"; text = "FAULT RESET", lamp = false, lamp_color = "amber",
                label = "Fault reset", size = [170, 60])

#%% md id=supervision_doc
@md"""
## Supervision
"""

#%% code id=trend
@bind trend awi("TrendChart"; id = "trend", span = 180, label = "Trend", size = [560, 220],
    pens = [Dict("name" => "Level", "unit" => "m", "min" => 0, "max" => 4),
            Dict("name" => "Temperature", "unit" => "°C", "min" => 0, "max" => 100, "hi" => 85),
            Dict("name" => "Heater", "unit" => "%", "min" => 0, "max" => 100)])

#%% code id=alarms
@bind alarms awi("AlarmList"; label = "Alarms", size = [560, 160])

#%% code id=events
@bind events awi("EventLog"; label = "Event log", size = [560, 180])

#%% code id=plant
@bind plant awi("EquipmentTree"; nodes = plant_nodes(Dict()), show_level = false, label = "Plant model",
                expanded = ["Plant", "Plant/Reactors", "R-101"], size = [300, 220])

#%% md id=model_doc
@md"""
## Process model and control

One tick simulates `DT` seconds. Acting states (Resetting, Starting, Holding, …) complete after
two ticks by following the `SC` transitions of the PackML table the widget carries.
"""

#%% code id=model
const DT = 5.0                       # simulated seconds per tick
const AMBIENT = 20.0                 # °C
const FEED, DRAIN = 0.05, 0.06       # m/s
const HEAT_GAIN, LOSS, COOLING = 0.012, 0.004, 0.3
const LIGHT = Dict("Execute" => Dict("green" => "on"), "Starting" => Dict("green" => "blink"),
    "Completing" => Dict("green" => "blink"), "Held" => Dict("amber" => "on"),
    "Holding" => Dict("amber" => "blink"), "Suspended" => Dict("amber" => "blink"),
    "Complete" => Dict("amber" => "on"), "Aborted" => Dict("red" => "blink"), "Aborting" => Dict("red" => "on"))
const ACTING = ("Resetting", "Holding", "Suspending", "Stopping", "Aborting", "Clearing")
const RESTARTING = ("Starting", "Unholding", "Unsuspending")

mutable struct Reactor
    state::String; since::Int; phase::Int; held::Float64; fault::Bool
    level::Float64; temp::Float64; integral::Float64; count::Int; samples::Int; next_event::Int
end
R = Reactor("", 0, 1, 0.0, false, 0.0, AMBIENT, 0.0, 0, 0, 1)

bytes(x::AbstractVector) = collect(reinterpret(UInt8, x))   # little-endian on usual hosts

function log_event(message, source, category)
    rows = Vector{Any}(get(traits(:events), "value", []))
    push!(rows, Dict("id" => R.next_event, "time" => time(), "source" => source,
                     "category" => category, "message" => message))
    R.next_event += 1
    setw!(:events; value = rows)
end

function alarm(id, on, message)
    rows = Vector{Any}(get(traits(:alarms), "value", []))
    i = findfirst(r -> r["id"] == id, rows)
    active = i !== nothing && startswith(String(rows[i]["state"]), "active")
    if on && !active
        row = Dict("id" => id, "timestamp" => string(round(Dates.now(), Dates.Second)), "source" => split(id, ".")[1],
                   "priority" => "high", "message" => message, "state" => "active_unacknowledged",
                   "shelved_until" => nothing, "suppressed" => false, "out_of_service" => false)
        i === nothing ? push!(rows, row) : (rows[i] = row)
        setw!(:alarms; value = rows)
        log_event(message, id, "alarm")
    elseif !on && active
        # cleared: an acknowledged alarm leaves the list, an unacknowledged one waits for the operator
        if rows[i]["state"] == "active_acknowledged"
            deleteat!(rows, i)
        else
            rows[i] = merge(rows[i], Dict("state" => "cleared_unacknowledged"))
        end
        setw!(:alarms; value = rows)
    end
end

"Complete the current acting state: follow its SC transition in the widget's own table."
function complete!()
    m = traits(:machine)
    state = String(m["value"])
    for tr in m["machine"]["transitions"]
        if tr[1] == state && tr[2] == "SC"
            setw!(:machine; value = tr[3], last_command = "SC")
            return tr[3]
        end
    end
    return state
end

"PI controller of TIC-101 (AUTO: output from the SP; MAN: the operator's OP)."
function controller(pv, heating)
    t = traits(:tic)
    heating || return 0.0
    t["loop_mode"] == "MAN" && return Float64(t["op"])
    err = Float64(t["sp"]) - pv
    op = 10.0 * (err + R.integral / 60.0)
    if 0.0 < op < 100.0
        R.integral += err * DT               # anti-windup: integrate only when not saturated
    end
    return clamp(op, 0.0, 100.0)
end

function tick!()
    m = traits(:machine)
    state = String(get(m, "value", ""))
    if state != R.state
        R.state, R.since = state, 0
        log_event("State $state", "R-101", "state")
    end
    R.since += 1
    # operator buttons (latched in the browser, reset here)
    if get(traits(:trip), "value", false) == true
        setw!(:trip; value = false)
        if !R.fault
            R.fault = true
            setw!(:reset; lamp = true, lamp_blink = true)
            alarm("M-101.TRIP", true, "Agitator M-101 overload trip")
            state in ("Execute", "Starting", "Unholding") && setw!(:machine; value = "Holding", last_command = "Hold")
        end
    end
    if get(traits(:reset), "value", false) == true
        setw!(:reset; value = false, lamp = false, lamp_blink = false)
        if R.fault
            R.fault = false
            alarm("M-101.TRIP", false, "")
            log_event("Agitator fault reset", "M-101", "operator")
        end
    end
    rows = traits(:recipe)["value"]
    feeding = draining = heating = cooling = stirring = false
    if R.since >= 2 && (state in ACTING || (state in RESTARTING && !R.fault))
        state == "Resetting" && (R.phase = 1; R.integral = 0.0)
        complete!()
    elseif state == "Execute" && R.phase <= length(rows)
        p = rows[R.phase]
        stirring = p["agitator"] == "on"
        setw!(:tic; sp = Float64(p["temp"]))
        name = p["phase"]
        if name == "Fill"
            feeding = R.level < p["level"]; done = !feeding
        elseif name == "Heat"
            heating = true; done = R.temp >= p["temp"] - 1.0
        elseif name == "React"
            heating = true; R.held += DT; done = R.held >= p["hold"]
        else
            cooling = true; done = R.temp <= p["temp"]
        end
        if done
            log_event("Phase $name done", "R-101", "state")
            R.phase += 1; R.held = 0.0
            R.phase > length(rows) && complete!()      # Execute -> Completing
        end
    elseif state == "Completing"
        draining = R.level > 0.05
        if !draining
            complete!()
            R.count += 1
            setw!(:batches; value = R.count)
            afm_emit("batches", Dict("type" => "append", "n" => 1); buffers = [bytes(Float32[R.count])])
        end
    end
    stirring &= !R.fault
    op = controller(R.temp, heating)
    R.temp += DT * (HEAT_GAIN * op * (stirring ? 1.0 : 0.5) - LOSS * (R.temp - AMBIENT)) - (cooling ? DT * COOLING : 0.0)
    R.temp = max(R.temp, AMBIENT - 5)
    R.level = clamp(R.level + DT * ((feeding ? FEED : 0.0) - (draining ? DRAIN : 0.0)), 0.0, 4.0)
    # indicators
    setw!(:level; value = R.level)
    setw!(:temp; value = R.temp)
    setw!(:tic; pv = R.temp, op = op)
    setw!(:feed_valve; value = feeding ? "open" : "closed")
    setw!(:feed_pump; value = feeding ? "running" : "stopped")
    setw!(:drain_valve; value = draining ? "open" : "closed")
    setw!(:drain_pump; value = draining ? "running" : "stopped")
    setw!(:agitator; value = R.fault ? "fault" : (stirring ? "forward" : "stopped"))
    pattern = get(LIGHT, String(traits(:machine)["value"]), Dict{String,String}())
    R.fault && (pattern = merge(pattern, Dict("red" => "blink")))
    setw!(:light; value = [get(pattern, c, "off") for c in ("red", "amber", "green")])
    setw!(:recipe; mode = String(traits(:machine)["value"]) in ("Idle", "Stopped", "Complete") ? "control" : "indicator")
    setw!(:plant; nodes = plant_nodes(Dict("feed" => feeding ? "running" : "normal",
        "heat" => heating ? "running" : "normal",
        "agit" => R.fault ? "fault" : (stirring ? "running" : "normal"),
        "drain" => draining ? "running" : "normal")))
    # trend: one sample per pen, times as float64 and values as float32 (see contract.json)
    R.samples += 1
    now = time()
    afm_emit("trend", Dict("type" => "append", "pens" => [[k, 1, R.samples] for k in 0:2]);
             buffers = [b for v in (R.level, R.temp, op) for b in (bytes([now]), bytes(Float32[v]))])
    setw!(:trend; value = Dict("Level" => R.level, "Temperature" => R.temp, "Heater" => op))   # legend
    alarm("TT-101.HI", R.temp > 85, "Reactor temperature high")
    alarm("LT-101.HI", R.level > 3.6, "Reactor level high")
end

#%% md id=run_doc
@md"""
## Run

The simulation runs while the button's handler runs; press it again to restart it.
"""

#%% code id=run
@bind run Button("Run simulation")

#%% code id=loop
@onclick run for _ in 1:3600
    tick!()
    pause(1.0)
end
