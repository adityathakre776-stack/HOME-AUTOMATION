# 🏠 Smart Home IoT Automation

A full-stack IoT home automation system with a **3D room visualization**, real-time device control via **MQTT**, a **PHP + MySQL** backend, and an **ESP32** firmware.

---

## 📸 Features

- 🌐 **3D Room View** — Interactive Three.js scene with TV, AC, lights & fan
- 📱 **Real-time Dashboard** — Control all devices from browser
- 📡 **MQTT Protocol** — Instant on/off via Mosquitto broker
- 🔐 **Auth System** — Secure login with bcrypt password hashing
- 🤖 **ESP32 Firmware** — Stable WiFi + MQTT with watchdog & auto-reconnect
- 💾 **MySQL Logging** — Stores device state history
- 📺 **4K Display Panels** — Netflix-style TV + Daikin-style AC LCD in 3D

---

## 📁 Project Structure

```
IOT/
├── index.html                  # Login page
├── frontend/
│   ├── dashboard.html          # Main control dashboard
│   ├── dashboard.css           # Styles
│   └── dashboard.js            # MQTT + API logic
├── 3d_ui/
│   └── room.html               # Three.js 3D room visualization
├── backend_php/
│   ├── config/config.php       # DB + MQTT config
│   ├── api/
│   │   ├── auth.php            # Login / logout / session
│   │   ├── control.php         # Device toggle API
│   │   └── devices.php         # Device state API
│   ├── database/schema.sql     # MySQL schema
│   └── setup.php               # One-time DB initializer
└── esp32_code/
    ├── main.cpp                # ESP32 firmware (PlatformIO)
    └── platformio.ini          # Build config
```

---

## 🔧 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| 3D Visualization | Three.js r134 |
| MQTT Client | MQTT.js (WebSocket) |
| Backend | PHP 8+ |
| Database | MySQL (via XAMPP) |
| MQTT Broker | Mosquitto |
| Microcontroller | ESP32 (PlatformIO) |
| Protocol | MQTT over WiFi |

---

## 🚀 Setup Instructions

### 1. Prerequisites
- [XAMPP](https://www.apachefriends.org/) (Apache + PHP + MySQL)
- [Mosquitto MQTT Broker](https://mosquitto.org/download/)
- [PlatformIO](https://platformio.org/) (for ESP32)

### 2. Database Setup
1. Start XAMPP → Start **Apache** and **MySQL**
2. Visit: `http://localhost/IOT/backend_php/setup.php`
3. Login with: **admin / admin123**

### 3. Mosquitto Config
Add to `mosquitto.conf`:
```
listener 1883 0.0.0.0
listener 9001
protocol websockets
allow_anonymous true
```
Then restart: `net stop mosquitto && net start mosquitto`

### 4. ESP32 Firmware
Edit `esp32_code/main.cpp`:
```cpp
const char* WIFI_SSID     = "YOUR_WIFI";
const char* WIFI_PASSWORD = "YOUR_PASS";
const char* MQTT_SERVER   = "YOUR_PC_IP";  // run: ipconfig
```
Flash via PlatformIO.

---

## 📡 MQTT Topics

| Device | Command Topic | Status Topic |
|---|---|---|
| Light 1 | `home/light1/set` | `home/light1/status` |
| Light 2 | `home/light2/set` | `home/light2/status` |
| Fan | `home/fan/set` | `home/fan/status` |
| TV | `home/tv/set` | `home/tv/status` |
| AC | `home/ac/set` | `home/ac/status` |

Payload: `ON` / `OFF`

---

## 🔌 ESP32 GPIO Pinout

| GPIO | Device |
|---|---|
| 23 | Light 1 |
| 19 | Light 2 |
| 22 | Fan |
| 18 | TV |
| 21 | AC |

---

## 📜 License
MIT — free to use and modify.
