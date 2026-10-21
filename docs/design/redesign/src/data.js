/* Mock workspace for demo H. */
const NOW = Date.now();
const WORKSPACE = { name: "IO Driven", slug: "io-driven", user: "Cesar Ortega", role: "Owner", recipients: ["alerts@iodriven.tech"], tz: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } })() };
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;

const BOARDS = [
  { id: "esp32-30", chip: "ESP32", name: "ESP32 DevKit (30-pin)", desc: "The common DevKit V1; 30 header pins.", caps: ["ble"] },
  { id: "esp32-38", chip: "ESP32", name: "ESP32 DevKit (38-pin)", desc: "DevKitC; adds GPIO 6–11 (flash, don't use).", caps: ["ble"] },
  { id: "c3-mini", chip: "ESP32-C3", name: "ESP32-C3 Super Mini", desc: "Tiny single-core board, USB-C.", caps: ["ble"] },
  { id: "s3-devkit", chip: "ESP32-S3", name: "ESP32-S3 DevKitC-1", desc: "Dual-core with an RGB LED on GPIO 48.", caps: ["ble", "rgb_led"] },
  { id: "s2-mini", chip: "ESP32-S2", name: "ESP32-S2 Mini", desc: "No Bluetooth: Wi-Fi is typed in.", caps: [] },
];
const PINS = {
  "esp32-30": [4, 5, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39],
  "esp32-38": [4, 5, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39],
  "c3-mini": [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 20, 21],
  "s3-devkit": [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 38, 39, 40, 41, 42],
  "s2-mini": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 33, 34, 35, 36, 37, 38, 39, 40],
};
const PIN_LABEL = { 36: "GPIO 36 (VP)", 39: "GPIO 39 (VN)" };
const INPUT_ONLY = { "esp32-30": [34, 35, 36, 39], "esp32-38": [34, 35, 36, 39] };
const ADC1 = { "esp32-30": [32, 33, 34, 35, 36, 39], "esp32-38": [32, 33, 34, 35, 36, 39], "c3-mini": [0, 1, 2, 3, 4], "s3-devkit": [1, 2, 4, 5, 6, 7, 8, 9, 10], "s2-mini": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };
const I2C_DEFAULT = { "esp32-30": [21, 22], "esp32-38": [21, 22], "c3-mini": [8, 9], "s3-devkit": [8, 9], "s2-mini": [33, 35] };

/* Driver catalog, as the published firmware would describe it. */
const DRIVERS = {
  dht22: { name: "DHT22", kind: "inputs", desc: "Temperature and humidity", pins: [{ role: "data", label: "Data" }],
    channels: [{ key: "temperature", label: "Temperature", type: "number", unit: "°C", decimals: 1 }, { key: "humidity", label: "Humidity", type: "number", unit: "%", decimals: 0 }], params: [] },
  soil: { name: "Soil moisture (capacitive)", kind: "inputs", desc: "Analog, needs an ADC1 pin", pins: [{ role: "analog", label: "Analog", adc: true }],
    channels: [{ key: "soil_moisture", label: "Moisture", type: "number", unit: "%", decimals: 0 }],
    params: [{ key: "dry", label: "Reading when dry", def: 3200 }, { key: "wet", label: "Reading when wet", def: 1400 }] },
  flame: { name: "Flying fish IR flame", kind: "inputs", desc: "Digital flame detector", pins: [{ role: "signal", label: "Signal" }],
    channels: [{ key: "flame", label: "Flame", type: "bool" }], params: [{ key: "invert", label: "Active low", bool: true, def: true }] },
  button: { name: "Button / contact", kind: "inputs", desc: "Door contact, push button", pins: [{ role: "signal", label: "Signal" }],
    channels: [{ key: "contact", label: "Contact", type: "bool" }], params: [{ key: "pullup", label: "Internal pull-up", bool: true, def: true }] },
  bh1750: { name: "BH1750", kind: "inputs", desc: "Light level, I2C", i2c: true, address: "0x23",
    channels: [{ key: "light", label: "Light", type: "number", unit: "lx", decimals: 0 }], params: [] },
  mpu6050: { name: "MPU6050", kind: "inputs", desc: "Accelerometer + gyro, I2C", i2c: true, address: "0x68",
    channels: [
      { key: "accel_x", label: "Accel X", type: "number", unit: "g", decimals: 2, common: true },
      { key: "accel_y", label: "Accel Y", type: "number", unit: "g", decimals: 2, common: true },
      { key: "accel_z", label: "Accel Z", type: "number", unit: "g", decimals: 2, common: true },
      { key: "gyro_x", label: "Gyro X", type: "number", unit: "°/s", decimals: 1 },
      { key: "gyro_y", label: "Gyro Y", type: "number", unit: "°/s", decimals: 1 },
      { key: "gyro_z", label: "Gyro Z", type: "number", unit: "°/s", decimals: 1 },
      { key: "chip_temp", label: "Chip temperature", type: "number", unit: "°C", decimals: 1 },
    ], params: [] },
  relay: { name: "Relay", kind: "outputs", desc: "Switches a load on and off", pins: [{ role: "signal", label: "Signal" }],
    channels: [{ key: "relay", label: "Relay", type: "onoff" }], params: [{ key: "active_low", label: "Active low", bool: true, def: true }] },
  led: { name: "LED / buzzer", kind: "outputs", desc: "A digital output", pins: [{ role: "signal", label: "Signal" }],
    channels: [{ key: "led", label: "Output", type: "onoff" }], params: [] },
};

const ZONES = [
  { id: "z1", name: "Taller", notes: "Workshop, ground floor." },
  { id: "z2", name: "Invernadero", notes: "Greenhouse behind the workshop." },
  { id: "z3", name: "Cámara fría", notes: "" },
];

/* Templates. `hardware` is set for Our firmware ones. */
const TEMPLATES = [
  { id: "t-gh", name: "Greenhouse node", runsOn: "our", enabled: true, board: "esp32-30",
    parts: [
      { uid: "p1", driver: "dht22", pins: { data: 4 }, params: {}, channels: { temperature: "m1", humidity: "m2" } },
      { uid: "p2", driver: "soil", pins: { analog: 34 }, params: { dry: 3200, wet: 1400 }, channels: { soil_moisture: "m3" } },
      { uid: "p3", driver: "relay", pins: { signal: 26 }, params: { active_low: true }, channels: { relay: "a1" } },
    ],
    metrics: [
      { uid: "m1", key: "temperature", name: "Temperature", type: "number", unit: "°C", decimals: 1, min: -10, max: 60, publish: "periodic", interval: 30 },
      { uid: "m2", key: "humidity", name: "Humidity", type: "number", unit: "%", decimals: 0, min: 0, max: 100, publish: "periodic", interval: 30 },
      { uid: "m3", key: "soil_moisture", name: "Soil moisture", type: "number", unit: "%", decimals: 0, min: 0, max: 100, publish: "on_change", deadband: 2 },
    ],
    actuators: [{ uid: "a1", key: "fan1", name: "Fan", control: "onoff", on: "1", off: "0" }] },
  { id: "t-in", name: "ESP32 Inputs", runsOn: "our", enabled: true, board: "esp32-30",
    parts: [
      { uid: "p1", driver: "button", pins: { signal: 18 }, params: { pullup: true }, channels: { contact: "m1" } },
      { uid: "p2", driver: "bh1750", pins: {}, params: {}, channels: { light: "m2" } },
    ],
    metrics: [
      { uid: "m1", key: "door", name: "Door", type: "bool", publish: "on_change" },
      { uid: "m2", key: "light", name: "Light", type: "number", unit: "lx", decimals: 0, publish: "periodic", interval: 60 },
    ], actuators: [] },
  { id: "t-out", name: "ESP32 Output", runsOn: "our", enabled: true, board: "esp32-30",
    parts: [{ uid: "p1", driver: "relay", pins: { signal: 26 }, params: { active_low: true }, channels: { relay: "a1" } }, { uid: "p2", driver: "relay", pins: { signal: 27 }, params: { active_low: true }, channels: { relay: "a2" } }],
    metrics: [], actuators: [{ uid: "a1", key: "light_bar", name: "Light bar", control: "onoff", on: "1", off: "0" }, { uid: "a2", key: "siren", name: "Siren", control: "onoff", on: "1", off: "0" }] },
  { id: "t-ff", name: "Flying fish template", runsOn: "our", enabled: true, board: "c3-mini",
    parts: [{ uid: "p1", driver: "flame", pins: { signal: 3 }, params: { invert: true }, channels: { flame: "m1" } }],
    metrics: [{ uid: "m1", key: "flame", name: "Flame", type: "bool", publish: "on_change" }], actuators: [] },
  { id: "t-tilt", name: "Tilt sensor", runsOn: "our", enabled: true, board: "esp32-30",
    parts: [{ uid: "p1", driver: "mpu6050", pins: {}, params: {}, channels: { accel_x: "m1", accel_y: "m2", accel_z: "m3" } }],
    metrics: [
      { uid: "m1", key: "accel_x", name: "Accel X", type: "number", unit: "g", decimals: 2, publish: "streaming" },
      { uid: "m2", key: "accel_y", name: "Accel Y", type: "number", unit: "g", decimals: 2, publish: "streaming" },
      { uid: "m3", key: "accel_z", name: "Accel Z", type: "number", unit: "g", decimals: 2, publish: "streaming" },
    ], actuators: [] },
  { id: "t-pump", name: "Pump relay", runsOn: "our", enabled: true, board: "esp32-30",
    parts: [{ uid: "p1", driver: "relay", pins: { signal: 25 }, params: { active_low: true }, channels: { relay: "a1" } }],
    metrics: [{ uid: "m1", key: "flow", name: "Flow", type: "number", unit: "L/min", decimals: 1, publish: "periodic", interval: 15 }],
    actuators: [{ uid: "a1", key: "pump", name: "Pump", control: "onoff", on: "1", off: "0" }] },
  { id: "t-cold", name: "Cold room probe", runsOn: "custom", enabled: true,
    metrics: [
      { uid: "m1", key: "temperature", name: "Temperature", type: "number", unit: "°C", decimals: 1, min: -30, max: 10, publish: "periodic", interval: 60 },
      { uid: "m2", key: "door", name: "Door", type: "bool", publish: "on_change" },
    ], actuators: [{ uid: "a1", key: "defrost", name: "Defrost mode", control: "values", allowed: "off, auto, force" }] },
  { id: "t-gw", name: "Line gateway", runsOn: "custom", enabled: true,
    metrics: [
      { uid: "m1", key: "line_speed", name: "Line speed", type: "number", unit: "m/min", decimals: 1, publish: "periodic", interval: 5 },
      { uid: "m2", key: "motor_current", name: "Motor current", type: "number", unit: "A", decimals: 2, publish: "periodic", interval: 5 },
      { uid: "m3", key: "e_stop", name: "E-stop", type: "bool", publish: "on_change" },
    ], actuators: [] },
  { id: "t-legacy", name: "Legacy / Uncategorized", runsOn: "custom", enabled: false, metrics: [], actuators: [] },
];

const DEVICES = [
  { id: "d1", slug: "greenhouse-a", name: "Greenhouse node A", tpl: "t-gh", zone: "z2", status: "online", seen: NOW - 8e3, rssi: -58, battery: null, fw: "1.4.2", uptime: 3 * DAY + 5 * HOUR },
  { id: "d2", slug: "greenhouse-b", name: "Greenhouse node B", tpl: "t-gh", zone: "z2", status: "online", seen: NOW - 21e3, rssi: -71, battery: null, fw: "1.4.2", uptime: 19 * HOUR, ownWiring: true },
  { id: "d3", slug: "esp32-i1", name: "ESP32-I1", tpl: "t-in", zone: "z1", status: "offline", seen: NOW - 3 * DAY, rssi: -80, battery: 34, fw: "1.3.0", uptime: 0 },
  { id: "d4", slug: "esp32-o1", name: "ESP32-O1", tpl: "t-out", zone: "z1", status: "offline", seen: NOW - 39 * DAY, rssi: -75, battery: null, fw: "1.2.0", uptime: 0 },
  { id: "d5", slug: "flying-fish-detector", name: "Flying fish detector", tpl: "t-ff", zone: "z1", status: "never", seen: null },
  { id: "d6", slug: "flying-fish2", name: "Flying fish2", tpl: "t-ff", zone: "z1", status: "never", seen: null },
  { id: "d7", slug: "pump-controller", name: "Pump controller", tpl: "t-pump", zone: "z2", status: "online", seen: NOW - 4e3, rssi: -62, battery: null, fw: "1.4.2", uptime: 6 * DAY },
  { id: "d8", slug: "tilt-press-3", name: "Tilt sensor, press 3", tpl: "t-tilt", zone: "z1", status: "offline", seen: NOW - 2 * HOUR, rssi: -66, battery: 81, fw: "1.4.0", uptime: 0 },
  { id: "d9", slug: "cold-room-probe", name: "Cold room probe", tpl: "t-cold", zone: "z3", status: "online", seen: NOW - 33e3, rssi: -69, battery: 92, fw: "custom", uptime: 12 * DAY },
  { id: "d10", slug: "line-2-gateway", name: "Line 2 gateway", tpl: "t-gw", zone: "z1", status: "disabled", seen: NOW - 9 * DAY, fw: "custom" },
];

/* Latest readings (online devices); stale ones carry an old timestamp. */
const READINGS = {
  d1: { temperature: [31.4, NOW - 8e3], humidity: [64, NOW - 8e3], soil_moisture: [41, NOW - 12 * MIN] },
  d2: { temperature: [27.9, NOW - 21e3], humidity: [58, NOW - 21e3], soil_moisture: [null, null] },
  d3: { door: [false, NOW - 3 * DAY], light: [312, NOW - 3 * DAY] },
  d7: { flow: [12.6, NOW - 4e3] },
  d8: { accel_x: [0.02, NOW - 2 * HOUR], accel_y: [-0.01, NOW - 2 * HOUR], accel_z: [0.99, NOW - 2 * HOUR] },
  d9: { temperature: [-18.3, NOW - 33e3], door: [false, NOW - 33e3] },
};

/* Actuator state: requested (last command) vs reported (what the device says). */
const ACTUATORS = {
  d1: { fan1: { requested: true, reported: true, at: NOW - 6 * MIN, by: "rule:r1" } },
  d2: { fan1: { requested: false, reported: false, at: NOW - 2 * HOUR, by: "user:Cesar Ortega" } },
  d4: { light_bar: { requested: true, reported: null, at: NOW - 39 * DAY, by: "user:Cesar Ortega" }, siren: { requested: false, reported: null, at: NOW - 40 * DAY, by: "user:Cesar Ortega" } },
  d7: { pump: { requested: true, reported: false, at: NOW - 12e3, by: "user:Cesar Ortega", pending: true } },
  d9: { defrost: { requested: "auto", reported: "auto", at: NOW - DAY, by: "user:Cesar Ortega" } },
};
const COMMANDS = [
  { id: "c1", device: "d7", actuator: "pump", value: true, at: NOW - 12e3, by: "Cesar Ortega", status: "pending" },
  { id: "c2", device: "d1", actuator: "fan1", value: true, at: NOW - 6 * MIN, by: "rule:r1", status: "confirmed" },
  { id: "c3", device: "d1", actuator: "fan1", value: false, at: NOW - 3 * HOUR, by: "rule:r1", status: "confirmed" },
  { id: "c4", device: "d2", actuator: "fan1", value: false, at: NOW - 2 * HOUR, by: "Cesar Ortega", status: "confirmed" },
  { id: "c5", device: "d1", actuator: "fan1", value: true, at: NOW - 5 * HOUR, by: "rule:r1", status: "confirmed" },
  { id: "c6", device: "d4", actuator: "siren", value: true, at: NOW - 39 * DAY, by: "Cesar Ortega", status: "no_response" },
];

/* Rules hold the editor's draft shape (lib/rule-draft.ts): a WHEN trigger, an
   AND/OR condition tree of leaves, actions, and behaviour. core-rules.js adds
   the derived fields older pages read (device, metric, threshold, action). */
const leafD = (uid, dev, metric, op, value, extra = {}) => ({ uid, kind: "leaf", dev, metric, op, value, low: null, high: null, set: "", rhs: "static", rhsDev: "", rhsMetric: "", hyst: 0, ...extra });
const RULES = [
  { id: "r1", state: "fired", fired24: 4, strip: "....ttff..........ttttff.......tttf.......ttf...",
    draft: { name: "Greenhouse too hot", enabled: true, when: { type: "metric", mode: "daily", cron: "0 8 * * *", tz: WORKSPACE.tz, dev: "", status: "disconnected" },
      condition: { uid: "g1", kind: "group", op: "all", children: [
        leafD("l1", "d1", "temperature", ">", 30, { hyst: 2 }),
        { uid: "g2", kind: "group", op: "any", children: [leafD("l2", "d1", "humidity", ">", 60, { hyst: 3 }), leafD("l3", "d2", "humidity", ">", 60, { hyst: 3 })] },
      ] },
      behaviour: "rearm", hold: 10, cooldown: 60, clearDelay: 30,
      actions: [{ uid: "x1", type: "actuator", dev: "d1", act: "fan1", value: true, revert: true, clearValue: null }],
      clearNotify: false, clearMessage: "" } },
  { id: "r2", state: "armed", fired24: 0, strip: "",
    draft: { name: "Cold room door open", enabled: true, when: { type: "metric", mode: "daily", cron: "0 8 * * *", tz: WORKSPACE.tz, dev: "", status: "disconnected" },
      condition: leafD("l4", "d9", "door", "==", true),
      behaviour: "rearm", hold: 120, cooldown: 600, clearDelay: 0,
      actions: [{ uid: "x2", type: "email", to: "", subject: "Cold room door open", body: "The cold room door has been open for 2 minutes." }],
      clearNotify: true, clearMessage: "Cold room door closed again." } },
  { id: "r3", state: "latched", fired24: 1, strip: "...............................................f", health: "cant",
    draft: { name: "Flame detected", enabled: true, when: { type: "metric", mode: "daily", cron: "0 8 * * *", tz: WORKSPACE.tz, dev: "", status: "disconnected" },
      condition: leafD("l5", "d5", "flame", "==", true),
      behaviour: "latch", hold: 0, cooldown: 30, clearDelay: 0,
      actions: [{ uid: "x3", type: "actuator", dev: "d4", act: "siren", value: true, revert: false, clearValue: null }, { uid: "x4", type: "notification", message: "Flame on Flying fish detector. The siren is on until someone resets the latch." }],
      clearNotify: false, clearMessage: "" } },
  { id: "r4", state: "armed", fired24: 1, strip: ".............................f..................",
    draft: { name: "Morning irrigation", enabled: true, when: { type: "schedule", mode: "days", cron: "0 7 * * 1-5", tz: WORKSPACE.tz, dev: "", status: "disconnected" },
      condition: leafD("l6", "d1", "soil_moisture", "<", 45),
      behaviour: "rearm", hold: 0, cooldown: 3600, clearDelay: 0,
      actions: [{ uid: "x5", type: "actuator", dev: "d7", act: "pump", value: true, revert: false, clearValue: null }],
      clearNotify: false, clearMessage: "" } },
  { id: "r5", state: "armed", fired24: 0, strip: "",
    draft: { name: "Press 3 sensor offline", enabled: true, when: { type: "device_status", mode: "daily", cron: "0 8 * * *", tz: WORKSPACE.tz, dev: "d8", status: "disconnected" },
      condition: null, behaviour: "rearm", hold: 0, cooldown: 300, clearDelay: 0,
      actions: [{ uid: "x6", type: "notification", message: "Tilt sensor, press 3 stopped reporting." }, { uid: "x7", type: "webhook", url: "https://hooks.example.com/maintenance", body: '{"text": "Press 3 sensor offline"}' }],
      clearNotify: false, clearMessage: "" } },
  { id: "r6", state: "disabled", fired24: 0, strip: "",
    draft: { name: "Cold room too warm", enabled: false, when: { type: "metric", mode: "daily", cron: "0 8 * * *", tz: WORKSPACE.tz, dev: "", status: "disconnected" },
      condition: leafD("l7", "d9", "temperature", "between", null, { low: -15, high: 4, op: "between" }),
      behaviour: "rearm", hold: 60, cooldown: 900, clearDelay: 0,
      actions: [{ uid: "x8", type: "actuator", dev: "d9", act: "defrost", value: "force", revert: true, clearValue: "auto" }],
      clearNotify: false, clearMessage: "" } },
];

const SEV = ["critical", "warning", "info"];
/* Alarms: a lifecycle (active → acknowledged → cleared), repeats grouped. */
const tl = (ago, what) => ({ at: NOW - ago, what });
const ALARMS = [
  { id: "a1", sev: "critical", title: "Greenhouse too hot", detail: "Temperature on Greenhouse node A is 31.4 °C (above 30 °C for 10 s). Fan turned On.", device: "d1", rule: "r1", state: "active", count: 4, first: NOW - 5 * HOUR, last: NOW - 6 * MIN,
    timeline: [tl(5 * HOUR, "Raised: temperature 30.6 °C"), tl(3 * HOUR, "Cleared by itself, then raised again"), tl(6 * MIN, "Repeated: temperature 31.4 °C")] },
  { id: "a2", sev: "critical", title: "Flame detected (latched)", detail: "Flame on Flying fish detector. Siren turned On; it stays latched until someone resets it.", device: "d5", rule: "r3", state: "active", count: 1, first: NOW - 7 * HOUR, last: NOW - 7 * HOUR,
    timeline: [tl(7 * HOUR, "Raised: flame On"), tl(7 * HOUR - 2000, "Siren turned On · confirmed")] },
  { id: "a3", sev: "critical", title: "Tilt sensor, press 3 is offline", detail: "No message for 2 h. Its Last-Will reported it offline.", device: "d8", rule: "r5", state: "active", count: 1, first: NOW - 2 * HOUR, last: NOW - 2 * HOUR,
    timeline: [tl(2 * HOUR, "Raised: device went offline")] },
  { id: "a4", sev: "warning", title: "Pump command not confirmed yet", detail: "Pump controller hasn't acknowledged “Pump On”.", device: "d7", rule: null, state: "active", count: 1, first: NOW - 12e3, last: NOW - 12e3,
    timeline: [tl(12e3, "Raised: command sent, waiting for the device")] },
  { id: "a5", sev: "warning", title: "Soil moisture is stale", detail: "Greenhouse node A hasn't published soil moisture for 12 min; rules using it can't evaluate.", device: "d1", rule: null, state: "acknowledged", count: 2, first: NOW - 40 * MIN, last: NOW - 12 * MIN, ackBy: "Lucía Méndez", ackAt: NOW - 10 * MIN, ackNote: "Sensor out for recalibration until 14:00.",
    timeline: [tl(40 * MIN, "Raised: no reading for 10 min"), tl(12 * MIN, "Repeated"), tl(10 * MIN, "Acknowledged by Lucía Méndez: Sensor out for recalibration until 14:00.")] },
  { id: "a6", sev: "critical", title: "ESP32-I1 is offline", detail: "No message for 3 days.", device: "d3", rule: null, state: "acknowledged", count: 1, first: NOW - 3 * DAY, last: NOW - 3 * DAY, ackBy: "Cesar Ortega", ackAt: NOW - 2 * DAY, ackNote: "Moved to storage.",
    timeline: [tl(3 * DAY, "Raised: device went offline"), tl(2 * DAY, "Acknowledged by Cesar Ortega: Moved to storage.")] },
  { id: "a7", sev: "warning", title: "Cold room door open", detail: "The door was open for more than 2 min.", device: "d9", rule: "r2", state: "cleared", count: 1, first: NOW - 26 * HOUR, last: NOW - 26 * HOUR, clearedAt: NOW - 25.8 * HOUR,
    timeline: [tl(26 * HOUR, "Raised: door On for 2 min · email sent"), tl(25.8 * HOUR, "Cleared: door Off")] },
  { id: "a8", sev: "critical", title: "Greenhouse too hot", detail: "Temperature on Greenhouse node A was above 30 °C.", device: "d1", rule: "r1", state: "cleared", count: 2, first: NOW - 30 * HOUR, last: NOW - 29 * HOUR, clearedAt: NOW - 28.5 * HOUR,
    timeline: [tl(30 * HOUR, "Raised"), tl(29 * HOUR, "Repeated"), tl(28.5 * HOUR, "Cleared: below 28 °C for 30 s · Fan turned Off")] },
  { id: "a9", sev: "info", title: "Pump controller back online", detail: "Reconnected after 4 min.", device: "d7", rule: null, state: "cleared", count: 1, first: NOW - 2 * DAY, last: NOW - 2 * DAY, clearedAt: NOW - 2 * DAY,
    timeline: [tl(2 * DAY, "Reconnected")] },
];
const NOTIFS = (() => {
  const base = [
    ["critical", "Greenhouse too hot fired", "Temperature on Greenhouse node A is 31.4 °C (above 30 °C for 10 s). Fan turned On.", "d1", "r1", 6 * MIN],
    ["warning", "Pump command not confirmed yet", "Pump controller hasn't acknowledged “Pump On” (sent 12 s ago).", "d7", null, 12e3 / MIN * MIN],
    ["critical", "Tilt sensor, press 3 went offline", "Last message 2 h ago.", "d8", null, 2 * HOUR],
    ["info", "Greenhouse too hot cleared", "Temperature back below 28 °C. Fan turned Off.", "d1", "r1", 3 * HOUR],
    ["critical", "Flame detected fired (latched)", "Flame on Flying fish detector. Siren turned On. Stays latched until reset.", "d5", "r3", 7 * HOUR],
    ["warning", "Soil moisture is stale", "Greenhouse node A hasn't published soil moisture for 12 min.", "d1", null, 12 * MIN],
    ["critical", "ESP32-I1 went offline", "Last message 3 days ago.", "d3", null, 3 * DAY],
  ];
  const out = [];
  for (let i = 0; i < 21; i++) {
    const b = base[i % base.length];
    out.push({ id: "n" + i, sev: b[0], title: b[1], body: b[2], device: b[3], rule: b[4], at: NOW - b[5] - Math.floor(i / base.length) * DAY, read: i > 6 });
  }
  return out;
})();

const DASHBOARDS = [
  { id: "db1", name: "Greenhouse", widgets: [
    { id: "w1", type: "value", device: "d1", metric: "temperature", span: 3 },
    { id: "w2", type: "value", device: "d1", metric: "humidity", span: 3 },
    { id: "w3", type: "status", device: "d1", span: 3 },
    { id: "w4", type: "actuator", device: "d1", actuator: "fan1", span: 3 },
    { id: "w5", type: "trend", device: "d1", metric: "temperature", span: 8 },
    { id: "w6", type: "gauge", device: "d1", metric: "soil_moisture", span: 4 },
  ] },
  { id: "db2", name: "Cold room", widgets: [{ id: "w1", type: "value", device: "d9", metric: "temperature", span: 4 }, { id: "w2", type: "trend", device: "d9", metric: "temperature", span: 8 }] },
  { id: "db3", name: "Workshop", widgets: [{ id: "w1", type: "status", device: "d3", span: 4 }, { id: "w2", type: "status", device: "d8", span: 4 }] },
  { id: "db4", name: "Pumps", widgets: [{ id: "w1", type: "actuator", device: "d7", actuator: "pump", span: 4 }, { id: "w2", type: "trend", device: "d7", metric: "flow", span: 8 }] },
];

const MEMBERS = [
  { id: "u1", name: "Cesar Ortega", email: "owner@iodriven.tech", role: "Owner", active: NOW - 2 * MIN },
  { id: "u2", name: "Lucía Méndez", email: "lucia@iodriven.tech", role: "Admin", active: NOW - 3 * HOUR },
  { id: "u3", name: "Ops screen", email: "ops@iodriven.tech", role: "Viewer", active: NOW - DAY },
];
const KEYS = [
  { id: "k1", name: "Grafana read-only", scope: "Viewer", created: NOW - 40 * DAY, used: NOW - 5 * MIN, expires: NOW + 50 * DAY },
  { id: "k2", name: "ERP sync", scope: "Admin", created: NOW - 12 * DAY, used: NOW - 2 * DAY, expires: null },
  { id: "k3", name: "Old test key", scope: "Viewer", created: NOW - 200 * DAY, used: null, expires: NOW - 20 * DAY },
];
