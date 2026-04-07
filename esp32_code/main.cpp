/*
 * ╔══════════════════════════════════════════════════════════╗
 * ║   IoT Home Automation — ESP32 Firmware  v2.0            ║
 * ║   Devices : Light1 (GPIO23) · Light2 (GPIO19) ·        ║
 * ║             Fan (GPIO22)                                ║
 * ║   Protocol: MQTT over WiFi                              ║
 * ╚══════════════════════════════════════════════════════════╝
 */

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <esp_task_wdt.h>   // Watchdog timer

// ╔══════════════════════════════════════╗
// ║          CONFIGURATION               ║
// ╚══════════════════════════════════════╝
const char* WIFI_SSID     = "Thakre";
const char* WIFI_PASSWORD = "KRISHNA2277";

const char* MQTT_SERVER   = "LAPTOP-5LJI46P9.local";  // hostname — works on any WiFi
const int   MQTT_PORT     = 1883;
const char* MQTT_USER     = "";               // No auth
const char* MQTT_PASS     = "";               // No auth
const char* CLIENT_ID     = "ESP32_HomeAuto";

// ╔══════════════════════════════════════╗
// ║             GPIO PINS                ║
// ╚══════════════════════════════════════╝
#define PIN_LIGHT1  23
#define PIN_LIGHT2  19
#define PIN_FAN     22
#define PIN_TV      18

// ╔══════════════════════════════════════╗
// ║           MQTT TOPICS               ║
// ╚══════════════════════════════════════╝
// Commands (subscribe — dashboard → ESP32)
#define T_LIGHT1_SET    "home/light1/set"
#define T_LIGHT2_SET    "home/light2/set"
#define T_FAN_SET       "home/fan/set"
#define T_TV_SET        "home/tv/set"

// Status (publish — ESP32 → dashboard)
#define T_LIGHT1_STATUS "home/light1/status"
#define T_LIGHT2_STATUS "home/light2/status"
#define T_FAN_STATUS    "home/fan/status"
#define T_TV_STATUS     "home/tv/status"

// Heartbeat
#define T_HEARTBEAT     "home/esp32/heartbeat"
#define T_ONLINE        "home/esp32/online"

// ╔══════════════════════════════════════╗
// ║           TIMING CONSTANTS          ║
// ╚══════════════════════════════════════╝
#define WDT_TIMEOUT_SEC     30      // Watchdog resets ESP32 if stuck > 30s
#define MQTT_RECONNECT_MS   3000    // Try MQTT reconnect every 3s (non-blocking)
#define HEARTBEAT_MS        30000   // Send heartbeat every 30s
#define WIFI_RETRY_LIMIT    40      // ~20 seconds max for WiFi connect

// ╔══════════════════════════════════════╗
// ║           DEVICE STATE              ║
// ╚══════════════════════════════════════╝
bool stateLight1 = false;
bool stateLight2 = false;
bool stateFan    = false;
bool stateTV     = false;

// ╔══════════════════════════════════════╗
// ║           GLOBAL OBJECTS            ║
// ╚══════════════════════════════════════╝
WiFiClient   espClient;
PubSubClient mqtt(espClient);

// Timers (millis-based, non-blocking)
unsigned long lastReconnectAttempt = 0;
unsigned long lastHeartbeat        = 0;

// ╔══════════════════════════════════════════════════════════╗
// ║   FORWARD DECLARATIONS                                   ║
// ╚══════════════════════════════════════════════════════════╝
void connectWiFi();
void connectMQTT();
bool mqttReconnect();
void mqttCallback(char* topic, byte* payload, unsigned int length);
void setDevice(uint8_t pin, bool state, const char* label);
void publishStatus(const char* statusTopic, bool state);
void publishAllStatus();
void sendHeartbeat();

// ╔══════════════════════════════════════════════════════════╗
// ║   SETUP                                                  ║
// ╚══════════════════════════════════════════════════════════╝
void setup() {
    Serial.begin(115200);
    delay(400);
    Serial.println("\n\n╔══════════════════════════════╗");
    Serial.println(  "║  IoT Home Auto  — Starting   ║");
    Serial.println(  "╚══════════════════════════════╝");

    // ── Watchdog: resets ESP32 if it hangs > WDT_TIMEOUT_SEC
    esp_task_wdt_init(WDT_TIMEOUT_SEC, true);
    esp_task_wdt_add(NULL);

    // ── GPIO setup
    const uint8_t pins[] = { PIN_LIGHT1, PIN_LIGHT2, PIN_FAN, PIN_TV };
    for (uint8_t p : pins) {
        pinMode(p, OUTPUT);
        digitalWrite(p, HIGH);   // Active LOW relay: HIGH = OFF at boot
    }
    Serial.println("[GPIO] Pins initialised — all OFF");

    // ── WiFi
    connectWiFi();

    // ── MQTT client config
    mqtt.setServer(MQTT_SERVER, MQTT_PORT);
    mqtt.setCallback(mqttCallback);
    mqtt.setKeepAlive(30);          // Send PINGREQ every 30s to keep alive
    mqtt.setSocketTimeout(10);      // Timeout if broker unresponsive after 10s

    // ── First MQTT connect
    connectMQTT();
}

// ╔══════════════════════════════════════════════════════════╗
// ║   MAIN LOOP  (fully non-blocking)                        ║
// ╚══════════════════════════════════════════════════════════╝
void loop() {
    // ── Feed the watchdog
    esp_task_wdt_reset();

    // ── WiFi dropout recovery
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[WiFi] Lost connection! Reconnecting...");
        connectWiFi();
    }

    // ── MQTT non-blocking reconnect
    if (!mqtt.connected()) {
        unsigned long now = millis();
        if (now - lastReconnectAttempt >= MQTT_RECONNECT_MS) {
            lastReconnectAttempt = now;
            if (mqttReconnect()) {
                lastReconnectAttempt = 0;
            }
        }
    } else {
        mqtt.loop();   // Process incoming messages

        // ── Heartbeat
        unsigned long now = millis();
        if (now - lastHeartbeat >= HEARTBEAT_MS) {
            lastHeartbeat = now;
            sendHeartbeat();
        }
    }
}

// ╔══════════════════════════════════════════════════════════╗
// ║   WiFi CONNECTION                                        ║
// ╚══════════════════════════════════════════════════════════╝
void connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;

    Serial.printf("[WiFi] Connecting to \"%s\"", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);    // Auto-reconnect on dropout
    WiFi.persistent(false);         // Don't write to flash every connect
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int tries = 0;
    while (WiFi.status() != WL_CONNECTED && tries < WIFI_RETRY_LIMIT) {
        delay(500);
        Serial.print(".");
        tries++;
        esp_task_wdt_reset();       // Keep feeding watchdog during wait
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("\n[WiFi] ✅ Connected! IP: %s  RSSI: %d dBm\n",
                      WiFi.localIP().toString().c_str(), WiFi.RSSI());
    } else {
        Serial.println("\n[WiFi] ❌ Failed to connect — restarting ESP32");
        delay(1000);
        ESP.restart();
    }
}

// ╔══════════════════════════════════════════════════════════╗
// ║   MQTT — First Connect (called from setup)               ║
// ╚══════════════════════════════════════════════════════════╝
void connectMQTT() {
    Serial.printf("[MQTT] Connecting to %s:%d\n", MQTT_SERVER, MQTT_PORT);
    int retries = 0;
    while (!mqttReconnect() && retries < 5) {
        retries++;
        Serial.printf("[MQTT] Retry %d/5... waiting 2s\n", retries);
        delay(2000);
        esp_task_wdt_reset();
    }
    if (!mqtt.connected()) {
        Serial.println("[MQTT] ⚠️  Could not connect at boot — will retry in loop");
    }
}

// ╔══════════════════════════════════════════════════════════╗
// ║   MQTT — Reconnect  (returns true on success)            ║
// ╚══════════════════════════════════════════════════════════╝
bool mqttReconnect() {
    Serial.printf("[MQTT] Attempting connect to %s:%d ...\n", MQTT_SERVER, MQTT_PORT);

    // Last Will: publish "offline" if ESP32 disconnects unexpectedly
    bool ok;
    if (strlen(MQTT_USER) > 0) {
        ok = mqtt.connect(CLIENT_ID, MQTT_USER, MQTT_PASS,
                          T_ONLINE, 1, true, "offline");
    } else {
        ok = mqtt.connect(CLIENT_ID, nullptr, nullptr,
                          T_ONLINE, 1, true, "offline");
    }

    if (ok) {
        Serial.println("[MQTT] ✅ Connected!");
        // ── Mark device online
        mqtt.publish(T_ONLINE, "online", true);

        // ── Subscribe to all command topics
        mqtt.subscribe(T_LIGHT1_SET, 1);
        mqtt.subscribe(T_LIGHT2_SET, 1);
        mqtt.subscribe(T_FAN_SET,    1);
        mqtt.subscribe(T_TV_SET,     1);
        Serial.println("[MQTT] Subscribed: light1/set · light2/set · fan/set · tv/set");

        // ── Publish current state (so dashboard syncs immediately)
        publishAllStatus();

    } else {
        Serial.printf("[MQTT] ❌ Failed — rc=%d\n", mqtt.state());
        /*
         * MQTT state codes:
         * -4 TIMEOUT      -3 CONN_LOST   -2 CONN_FAILED
         * -1 DISCONNECTED  1 BAD_PROTOCOL  2 BAD_CLIENT_ID
         *  3 UNAVAILABLE   4 BAD_CREDS     5 UNAUTHORISED
         */
    }
    return ok;
}

// ╔══════════════════════════════════════════════════════════╗
// ║   MQTT CALLBACK — incoming command from dashboard        ║
// ╚══════════════════════════════════════════════════════════╝
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    // Safe null-terminated string from payload
    char msg[24] = { 0 };
    memcpy(msg, payload, min((unsigned int)23, length));

    Serial.printf("[MQTT] ◀ %s  →  \"%s\"\n", topic, msg);

    bool turnOn  = (strcmp(msg, "ON")  == 0 || strcmp(msg, "1") == 0);
    bool turnOff = (strcmp(msg, "OFF") == 0 || strcmp(msg, "0") == 0);
    if (!turnOn && !turnOff) {
        Serial.println("[MQTT] Unknown payload — ignored");
        return;
    }
    bool newState = turnOn;

    if (strcmp(topic, T_LIGHT1_SET) == 0) {
        stateLight1 = newState;
        setDevice(PIN_LIGHT1, stateLight1, "Light1");
        publishStatus(T_LIGHT1_STATUS, stateLight1);

    } else if (strcmp(topic, T_LIGHT2_SET) == 0) {
        stateLight2 = newState;
        setDevice(PIN_LIGHT2, stateLight2, "Light2");
        publishStatus(T_LIGHT2_STATUS, stateLight2);

    } else if (strcmp(topic, T_FAN_SET) == 0) {
        stateFan = newState;
        setDevice(PIN_FAN, stateFan, "Fan");
        publishStatus(T_FAN_STATUS, stateFan);

    } else if (strcmp(topic, T_TV_SET) == 0) {
        stateTV = newState;
        setDevice(PIN_TV, stateTV, "TV");
        publishStatus(T_TV_STATUS, stateTV);
    }
}

// ╔══════════════════════════════════════════════════════════╗
// ║   DEVICE CONTROL                                         ║
// ╚══════════════════════════════════════════════════════════╝
void setDevice(uint8_t pin, bool state, const char* label) {
    /*
     * ✅ Active LOW relay (most blue relay boards):
     *    LOW  = Relay ON  (coil energised)
     *    HIGH = Relay OFF (coil released)
     */
    digitalWrite(pin, state ? LOW : HIGH);
    Serial.printf("[GPIO] %-7s → %s (pin %d = %s)\n",
                  label, state ? "ON" : "OFF", pin, state ? "LOW" : "HIGH");
}

// ╔══════════════════════════════════════════════════════════╗
// ║   PUBLISH STATUS                                         ║
// ╚══════════════════════════════════════════════════════════╝
void publishStatus(const char* topic, bool state) {
    const char* msg = state ? "ON" : "OFF";
    bool ok = mqtt.publish(topic, msg, true);  // retained = true
    Serial.printf("[MQTT] ▶ %-30s  %s  %s\n", topic, msg, ok ? "✅" : "❌");
}

void publishAllStatus() {
    Serial.println("[MQTT] Publishing full status snapshot...");
    publishStatus(T_LIGHT1_STATUS, stateLight1);
    publishStatus(T_LIGHT2_STATUS, stateLight2);
    publishStatus(T_FAN_STATUS,    stateFan);
    publishStatus(T_TV_STATUS,     stateTV);
}

// ╔══════════════════════════════════════════════════════════╗
// ║   HEARTBEAT                                              ║
// ╚══════════════════════════════════════════════════════════╝
void sendHeartbeat() {
    char buf[64];
    snprintf(buf, sizeof(buf), "{\"ip\":\"%s\",\"rssi\":%d,\"uptime\":%lu}",
             WiFi.localIP().toString().c_str(),
             WiFi.RSSI(),
             millis() / 1000UL);
    mqtt.publish(T_HEARTBEAT, buf, false);   // not retained
    Serial.printf("[HB] %s\n", buf);
}
