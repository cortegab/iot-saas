#include "io.h"

#include <Wire.h>

#include <vector>

#include "drivers/registry.h"

namespace {

// Publish behaviour ported from the generated sketch (buildSketch in
// frontend/src/lib/firmware-sketch.ts); keep the two in step.
constexpr uint8_t MODE_PERIODIC = 0;
constexpr uint8_t MODE_ON_CHANGE = 1;
constexpr uint8_t MODE_STREAMING = 2;
constexpr unsigned long ON_CHANGE_MIN_GAP_MS = 100;

struct Metric {
  const char* key;
  String topic;
  bool isBool;
  uint8_t mode;
  unsigned long intervalMs;  // periodic: every; on_change: heartbeat; streaming: min gap
  float deadband;            // on_change, numeric: ignore changes up to this size
  InputDriver* source = nullptr;
  const char* channel = nullptr;
  float lastValue = NAN;  // NAN = nothing sent yet
  unsigned long lastPublishMs = 0;
};

struct Actuator {
  const char* key;
  String cmdTopic;
  String stateTopic;
  String ackTopic;
  OutputDriver* output;
};

String configTopic;
std::vector<InputDriver*> inputs;
std::vector<Metric> metrics;
std::vector<Actuator> actuators;

unsigned long defaultIntervalMs(uint8_t mode) {
  if (mode == MODE_ON_CHANGE) return 300000UL;  // heartbeat
  if (mode == MODE_STREAMING) return 1000UL;
  return 15000UL;
}

uint8_t parseMode(const char* publish) {
  if (strcmp(publish, "on_change") == 0) return MODE_ON_CHANGE;
  if (strcmp(publish, "streaming") == 0) return MODE_STREAMING;
  return MODE_PERIODIC;
}

Metric* findMetric(const char* key) {
  for (Metric& m : metrics)
    if (strcmp(m.key, key) == 0) return &m;
  return nullptr;
}

bool hasChannel(const InputDriver* driver, const char* channel) {
  for (const char* const* c = driver->channels(); *c != nullptr; c++)
    if (strcmp(*c, channel) == 0) return true;
  return false;
}

bool declaresActuator(JsonArrayConst declared, const char* key) {
  for (JsonObjectConst a : declared)
    if (strcmp(a["key"] | "", key) == 0) return true;
  return false;
}

bool beginMetrics(const DeviceConfig& cfg, const String& prefix, String& err) {
  for (JsonObjectConst item : cfg.metrics) {
    Metric m;
    m.key = item["key"] | "";
    if (strlen(m.key) == 0 || !strcmp(m.key, "status") || !strcmp(m.key, "config")) {
      err = String("metric key \"") + m.key + "\" isn't allowed";
      return false;
    }
    if (findMetric(m.key) != nullptr) {
      err = String("metric ") + m.key + " is declared twice";
      return false;
    }
    m.topic = prefix + m.key;
    m.isBool = item["bool"] | false;
    m.mode = parseMode(item["publish"] | "periodic");
    long interval = item["interval_s"] | 0L;
    m.intervalMs = interval > 0 ? (unsigned long)interval * 1000UL : defaultIntervalMs(m.mode);
    m.deadband = item["deadband"] | 0.0f;
    metrics.push_back(m);
  }
  return true;
}

bool beginInputs(const DeviceConfig& cfg, String& err) {
  for (JsonObjectConst binding : cfg.inputs) {
    const char* id = binding["driver"] | "";
    InputDriver* driver = makeInputDriver(id);
    if (driver == nullptr) {
      err = String("input driver \"") + id + "\" isn't in this firmware; update the firmware";
      return false;
    }
    if (!driver->begin(binding, err)) return false;
    inputs.push_back(driver);

    for (JsonPairConst pair : binding["channels"].as<JsonObjectConst>()) {
      const char* channel = pair.key().c_str();
      const char* key = pair.value() | "";
      if (!hasChannel(driver, channel)) {
        err = String(id) + " has no channel \"" + channel + "\"";
        return false;
      }
      Metric* m = findMetric(key);
      if (m == nullptr) {
        err = String(id) + "." + channel + " maps to \"" + key + "\", which isn't a metric of this device";
        return false;
      }
      if (m->source != nullptr) {
        err = String("metric ") + key + " is read by two inputs";
        return false;
      }
      m->source = driver;
      m->channel = channel;
    }
  }
  return true;
}

bool beginOutputs(const DeviceConfig& cfg, const String& prefix, String& err) {
  for (JsonObjectConst binding : cfg.outputs) {
    const char* id = binding["driver"] | "";
    const char* key = binding["channels"]["value"] | "";
    OutputDriver* driver = makeOutputDriver(id);
    if (driver == nullptr) {
      err = String("output driver \"") + id + "\" isn't in this firmware; update the firmware";
      return false;
    }
    if (!declaresActuator(cfg.actuators, key)) {
      err = String(id) + " drives \"" + key + "\", which isn't an actuator of this device";
      return false;
    }
    for (const Actuator& a : actuators) {
      if (strcmp(a.key, key) == 0) {
        err = String("actuator ") + key + " is driven by two outputs";
        return false;
      }
    }
    if (!driver->begin(binding, err)) return false;
    actuators.push_back({key, prefix + "cmd/" + key, prefix + "state/" + key, prefix + "ack/" + key, driver});
  }
  return true;
}

void applyProfile(const uint8_t* payload, unsigned int length) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.printf("[CONFIG] ignoring malformed config (%s)\n", err.c_str());
    return;
  }
  for (JsonObjectConst item : doc["metrics"].as<JsonArrayConst>()) {
    Metric* m = findMetric(item["key"] | "");
    if (m == nullptr) continue;
    m->mode = parseMode(item["publish"] | "periodic");
    long interval = item["interval_seconds"] | 0L;
    m->intervalMs = interval > 0 ? (unsigned long)interval * 1000UL : defaultIntervalMs(m->mode);
    m->deadband = item["deadband"] | 0.0f;
    Serial.printf("[CONFIG] %s -> %s, every %lus\n", m->key, item["publish"] | "periodic", m->intervalMs / 1000);
  }
}

// Command: {"value":..., "issued_at":..., "ttl":..., "command_id":...}. No RTC
// here, so issued_at/ttl aren't checked against wall-clock time (same as the
// generated sketch).
void handleCommand(PubSubClient& mqtt, Actuator& a, const uint8_t* payload, unsigned int length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) {
    Serial.printf("[CMD] %s: malformed payload, dropping\n", a.key);
    return;
  }
  String err;
  if (!a.output->apply(doc["value"], err)) {
    Serial.printf("[CMD] %s: %s, not acked\n", a.key, err.c_str());
    return;
  }
  Serial.printf("[ACTUATOR] %s <- command\n", a.key);
  const char* commandId = doc["command_id"] | "";
  if (strlen(commandId) == 0) return;
  JsonDocument ack;
  ack["command_id"] = commandId;
  char body[96];
  serializeJson(ack, body, sizeof(body));
  bool acked = mqtt.publish(a.ackTopic.c_str(), body);
  Serial.println(acked ? "  ack sent" : "  ack FAILED to publish");
}

// Retained desired state: delivered on every (re)connect, so the board
// converges to what the platform last asked for. Not acked.
void handleState(Actuator& a, const uint8_t* payload, unsigned int length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) return;
  String err;
  if (!a.output->apply(doc["value"], err)) Serial.printf("[STATE] %s: %s\n", a.key, err.c_str());
}

bool i2cReady = false;

}  // namespace

bool i2cBusReady() { return i2cReady; }

bool ioBegin(const DeviceConfig& cfg, String& err) {
  String prefix = String(cfg.tenant) + "/" + cfg.device + "/";
  configTopic = prefix + "config";

  if (!beginMetrics(cfg, prefix, err)) return false;
  // The I2C bus is shared by every I2C sensor, so it's set up once, here.
  if (cfg.i2cSda >= 0 || cfg.i2cScl >= 0) {
    if (!claimRawPin(cfg.i2cSda, PinUse::Bus, "i2c.sda", err)) return false;
    if (!claimRawPin(cfg.i2cScl, PinUse::Bus, "i2c.scl", err)) return false;
    i2cReady = Wire.begin(cfg.i2cSda, cfg.i2cScl);
    if (!i2cReady) {
      err = String("couldn't start the I2C bus on GPIO ") + cfg.i2cSda + "/" + cfg.i2cScl;
      return false;
    }
  }
  // Outputs first: they reach their safe boot state as early as possible.
  if (!beginOutputs(cfg, prefix, err)) return false;
  if (!beginInputs(cfg, err)) return false;

  for (const Metric& m : metrics)
    if (m.source == nullptr) Serial.printf("[IO] metric %s has no input bound; it won't be published\n", m.key);
  for (JsonObjectConst a : cfg.actuators) {
    bool bound = false;
    for (const Actuator& b : actuators) bound |= strcmp(b.key, a["key"] | "") == 0;
    if (!bound) Serial.printf("[IO] actuator %s has no output bound; its commands are ignored\n", a["key"] | "?");
  }
  return true;
}

void ioPoll(uint32_t nowMs) {
  for (InputDriver* d : inputs) d->poll(nowMs);
}

void ioSubscribe(PubSubClient& mqtt) {
  mqtt.subscribe(configTopic.c_str(), 1);
  for (const Actuator& a : actuators) {
    mqtt.subscribe(a.cmdTopic.c_str(), 1);
    mqtt.subscribe(a.stateTopic.c_str(), 1);
  }
}

void ioPublishMetrics(PubSubClient& mqtt) {
  unsigned long now = millis();
  for (Metric& m : metrics) {
    if (m.source == nullptr) continue;
    float value = m.source->read(m.channel);
    if (isnan(value)) continue;

    bool first = isnan(m.lastValue);
    unsigned long sinceLast = now - m.lastPublishMs;
    bool send = false;
    const char* reason = "periodic";
    if (first) {
      send = true;
      reason = "initial";
    } else if (m.mode == MODE_ON_CHANGE) {
      bool changed = m.isBool ? value != m.lastValue : fabsf(value - m.lastValue) > m.deadband;
      if (changed && sinceLast >= ON_CHANGE_MIN_GAP_MS) {
        send = true;
        reason = "change";
      } else if (sinceLast >= m.intervalMs) {
        send = true;
        reason = "heartbeat";
      }
    } else {
      send = sinceLast >= m.intervalMs;
    }
    if (!send) continue;

    char payload[48];
    snprintf(payload, sizeof(payload), "{\"value\": %.3f}", value);
    bool ok = mqtt.publish(m.topic.c_str(), payload);
    // Only record success, so a failed publish is retried next loop.
    if (ok) {
      m.lastValue = value;
      m.lastPublishMs = now;
    }
    Serial.printf("[TELEMETRY] %s = %.3f (%s) %s\n", m.key, value, reason, ok ? "ok" : "FAILED");
  }
}

void ioHandleMessage(PubSubClient& mqtt, const char* topic, const uint8_t* payload, unsigned int length) {
  if (configTopic == topic) {
    applyProfile(payload, length);
    return;
  }
  for (Actuator& a : actuators) {
    if (a.cmdTopic == topic) return handleCommand(mqtt, a, payload, length);
    if (a.stateTopic == topic) return handleState(a, payload, length);
  }
}
