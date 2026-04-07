/**
 * IoT Smart Home — Dashboard Controller (dashboard.js)
 * - MQTT over WebSocket (real-time updates)
 * - REST API polling fallback
 * - Multi-page SPA navigation
 * - History chart with Chart.js
 */

'use strict';

/* ── Configuration ──────────────────────────────────────── */
const CONFIG = {
    // MQTT WebSocket broker (Mosquitto ws port, usually 9001 or 9883)
    mqttBroker: 'ws://localhost:9001',
    mqttOptions: {
        clientId: 'WebDash_' + Math.random().toString(16).slice(2, 8),
        username: '',   // Set if broker requires auth
        password: '',
        reconnectPeriod: 3000,
        connectTimeout: 5000,
        clean: true,
    },
    // Topics
    topics: {
        light1: { set: 'home/light1/set', status: 'home/light1/status' },
        light2: { set: 'home/light2/set', status: 'home/light2/status' },
        fan: { set: 'home/fan/set', status: 'home/fan/status' },
        tv: { set: 'home/tv/set', status: 'home/tv/status' },
        ac: { set: 'home/ac/set', status: 'home/ac/status' },
    },
    // Backend API
    api: {
        control: '../backend_php/api/control.php',
        status: '../backend_php/api/status.php',
        auth: '../backend_php/api/auth.php',
    },
    pollInterval: 30000,  // ms fallback poll (longer = less conflict with 3D room)
};

/* ── Device definitions ─────────────────────────────────── */
const DEVICES = [
    { key: 'light1', name: 'Light 1', type: 'light', icon: '💡', state: 'OFF' },
    { key: 'light2', name: 'Light 2', type: 'light', icon: '💡', state: 'OFF' },
    { key: 'fan', name: 'Ceiling Fan', type: 'fan', icon: '🌀', state: 'OFF' },
    { key: 'tv', name: 'Smart TV', type: 'tv', icon: '📺', state: 'OFF' },
    { key: 'ac', name: 'Air Conditioner', type: 'ac', icon: '❄️', state: 'OFF' },
];

/* ── State ───────────────────────────────────────────────── */
let mqttClient = null;
let mqttConnected = false;
let pollTimer = null;
let usageChart = null;
let uptime = 0;

/* ── DOM helpers ─────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

/* ===========================================================
   INIT
=========================================================== */
document.addEventListener('DOMContentLoaded', () => {
    initClock();
    initNav();
    checkAuth();
    renderDeviceGrid();
    renderDeviceDetailList();
    fetchStatus();
    connectMQTT();
    startPollFallback();
    initHistory();

    $('btnAllOff').addEventListener('click', () => {
        DEVICES.forEach(d => sendCommand(d.key, 'OFF'));
    });
    $('btnLogout').addEventListener('click', logout);
    $('sidebarToggle').addEventListener('click', toggleSidebar);
});

/* ===========================================================
   CLOCK
=========================================================== */
function initClock() {
    const update = () => {
        const now = new Date();
        $('timeDisplay').textContent = now.toLocaleTimeString('en-IN', {
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
    };
    update();
    setInterval(update, 1000);
}

/* ===========================================================
   AUTH
=========================================================== */
async function checkAuth() {
    try {
        const res = await fetch(CONFIG.api.auth + '?action=check');
        const data = await res.json();
        if (!data.loggedIn) {
            window.location.href = '../index.html';
            return;
        }
        $('userName').textContent = data.user.username;
        $('userRole').textContent = data.user.role;
    } catch {
        // Offline mode: skip auth redirect
        $('userName').textContent = 'Admin';
    }
}

async function logout() {
    await fetch(CONFIG.api.auth + '?action=logout', { method: 'POST' }).catch(() => { });
    window.location.href = '../index.html';
}

/* ===========================================================
   SIDEBAR NAV
=========================================================== */
function initNav() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = link.dataset.page;
            navigateTo(page);
            // close on mobile
            document.getElementById('sidebar').classList.remove('open');
        });
    });
}

function navigateTo(page) {
    document.querySelectorAll('.nav-link').forEach(l =>
        l.classList.toggle('active', l.dataset.page === page));
    document.querySelectorAll('.page').forEach(p =>
        p.classList.toggle('active', p.id === `page-${page}`));

    const titles = { overview: 'Overview', devices: 'Devices', '3d': '3D Room View', history: 'History' };
    $('pageTitle').textContent = titles[page] || page;

    if (page === 'history') loadHistory();
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

/* ===========================================================
   DEVICE GRID (Overview)
=========================================================== */
function renderDeviceGrid() {
    const grid = $('deviceGrid');
    grid.innerHTML = '';
    DEVICES.forEach(dev => {
        const card = document.createElement('div');
        card.className = `device-card ${dev.type} ${dev.state === 'ON' ? 'on' : ''}`;
        card.id = `card-${dev.key}`;
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', `Toggle ${dev.name}`);
        card.innerHTML = `
      <div class="device-icon-wrap" id="icon-${dev.key}">${dev.icon}</div>
      <div class="device-name">${dev.name}</div>
      <div class="device-type">${dev.type.toUpperCase()}</div>
      <div class="device-toggle">
        <div class="toggle-switch ${dev.state === 'ON' ? 'checked' : ''}" id="toggle-${dev.key}">
          <div class="toggle-knob"></div>
        </div>
        <span class="state-badge ${dev.state === 'ON' ? 'on' : ''}" id="badge-${dev.key}">
          ${dev.state}
        </span>
      </div>
    `;
        card.addEventListener('click', () => {
            const newState = dev.state === 'ON' ? 'OFF' : 'ON';
            sendCommand(dev.key, newState);
        });
        grid.appendChild(card);
    });
}

function renderDeviceDetailList() {
    const list = $('deviceDetailList');
    list.innerHTML = '';
    DEVICES.forEach(dev => {
        const row = document.createElement('div');
        row.className = 'device-row';
        row.id = `row-${dev.key}`;
        row.innerHTML = `
      <div class="device-row-icon">${dev.icon}</div>
      <div class="device-row-body">
        <div class="device-row-name">${dev.name}</div>
        <div class="device-row-meta" id="rowmeta-${dev.key}">
          Type: ${dev.type} &nbsp;|&nbsp; Status: <span id="rowstate-${dev.key}">${dev.state}</span>
        </div>
      </div>
      <div class="device-row-actions">
        <button class="btn-on"  id="btnOn-${dev.key}"  onclick="sendCommand('${dev.key}','ON')">Turn ON</button>
        <button class="btn-off" id="btnOff-${dev.key}" onclick="sendCommand('${dev.key}','OFF')">Turn OFF</button>
      </div>
    `;
        list.appendChild(row);
    });
}

/* ===========================================================
   UPDATE DEVICE UI
=========================================================== */
function updateDeviceUI(key, state) {
    const dev = DEVICES.find(d => d.key === key);
    if (!dev) return;
    dev.state = state;
    const isOn = state === 'ON';

    // Overview card
    const card = $(`card-${key}`);
    const toggle = $(`toggle-${key}`);
    const badge = $(`badge-${key}`);

    if (card) {
        card.className = `device-card ${dev.type} ${isOn ? 'on' : ''}`;
    }
    if (toggle) toggle.className = `toggle-switch ${isOn ? 'checked' : ''}`;
    if (badge) {
        badge.textContent = state;
        badge.className = `state-badge ${isOn ? 'on' : ''}`;
    }

    // Detail row
    const rowState = $(`rowstate-${key}`);
    if (rowState) rowState.textContent = state;

    // Stats
    updateStats();

    // TV stat card
    if (key === 'tv' && $('statTV')) {
        $('statTV').textContent = state;
        $('statTV').style.color = state === 'ON' ? 'var(--green)' : '';
    }

    // Sync 3D room
    sync3D(key, state);
}

function updateStats() {
    const active = DEVICES.filter(d => d.state === 'ON').length;
    $('statActive').textContent = active;
}

/* ===========================================================
   SEND COMMAND
=========================================================== */
async function sendCommand(deviceKey, state) {
    // Optimistic update
    updateDeviceUI(deviceKey, state);

    // MQTT preferred
    if (mqttConnected && mqttClient) {
        const topic = CONFIG.topics[deviceKey].set;
        mqttClient.publish(topic, state, { retain: true, qos: 1 });
    }

    // Also call REST API for DB logging
    try {
        const res = await fetch(CONFIG.api.control, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device: deviceKey, state }),
        });
        const data = await res.json();
        if (!data.success) toast(`⚠️ ${data.error}`, 'error');
    } catch {
        toast('⚡ Offline mode – MQTT only', 'error');
    }

    toast(
        `${DEVICES.find(d => d.key === deviceKey)?.name} → ${state}`,
        state === 'ON' ? 'success' : 'info'
    );

    uptime++;
    $('statUptime').textContent = uptime;
}

/* ===========================================================
   STATUS FETCH
=========================================================== */
async function fetchStatus() {
    try {
        const res = await fetch(CONFIG.api.status);
        const data = await res.json();
        if (!data.success) return;

        data.devices.forEach(dev => {
            updateDeviceUI(dev.device_key, dev.current_state);
        });

        $('metaLastSync') && ($('metaLastSync').textContent = new Date().toLocaleTimeString());

    } catch { /* offline */ }
}

function startPollFallback() {
    pollTimer = setInterval(fetchStatus, CONFIG.pollInterval);
}

/* ===========================================================
   MQTT
=========================================================== */
function connectMQTT() {
    const badge = $('mqttBadge');
    const statusText = $('mqttStatus');

    try {
        mqttClient = mqtt.connect(CONFIG.mqttBroker, CONFIG.mqttOptions);
    } catch {
        statusText.textContent = 'MQTT unavailable';
        $('statMqtt').textContent = 'N/A';
        return;
    }

    mqttClient.on('connect', () => {
        mqttConnected = true;
        badge.classList.add('connected');
        badge.classList.remove('error');
        statusText.textContent = 'Connected';
        $('statMqtt').textContent = 'Online';
        $('metaMqttHost').textContent = CONFIG.mqttBroker;

        // Subscribe to all status topics
        Object.values(CONFIG.topics).forEach(t => {
            mqttClient.subscribe(t.status, { qos: 1 });
        });

        toast('📡 MQTT connected', 'success');
    });

    mqttClient.on('message', (topic, payload) => {
        const state = payload.toString().trim().toUpperCase();
        // Map topic → device key
        for (const [key, topics] of Object.entries(CONFIG.topics)) {
            if (topic === topics.status) {
                updateDeviceUI(key, state);
                break;
            }
        }
    });

    mqttClient.on('disconnect', () => {
        mqttConnected = false;
        badge.classList.remove('connected');
        statusText.textContent = 'Disconnected';
        $('statMqtt').textContent = 'Offline';
    });

    mqttClient.on('error', () => {
        mqttConnected = false;
        badge.classList.add('error');
        statusText.textContent = 'Error';
        $('statMqtt').textContent = 'Error';
    });

    mqttClient.on('reconnect', () => {
        statusText.textContent = 'Reconnecting…';
    });
}

/* ===========================================================
   SYNC 3D ROOM (iframe postMessage)
=========================================================== */
function sync3D(key, state) {
    const frame = $('roomFrame');
    if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage({ type: 'deviceState', device: key, state }, '*');
    }
}

/* ===========================================================
   HANDLE TOGGLE EVENTS FROM 3D ROOM IFRAME
   (Fixes: devices turning OFF after a few seconds)
   When user clicks inside the 3D room, it sends deviceToggle
   to parent. We must forward it to the REST API + MQTT so
   the DB state is updated — otherwise fetchStatus() will
   reset everything back to OFF on next poll.
=========================================================== */
window.addEventListener('message', (ev) => {
    try {
        const d = ev.data;
        if (d && d.type === 'deviceToggle' && d.device && d.state) {
            // Forward to REST API + MQTT (no optimistic UI update here —
            // the 3D room already updated itself)
            sendCommand(d.device, d.state);
        }
    } catch (_) { }
});

/* ===========================================================
   HISTORY
=========================================================== */
function initHistory() {
    $('btnRefreshHistory').addEventListener('click', loadHistory);
    $('historyDevice').addEventListener('change', loadHistory);
}

async function loadHistory() {
    const device = $('historyDevice').value;
    const url = CONFIG.api.status + `?history=1&limit=100${device ? `&device=${device}` : ''}`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        if (!data.success) return;

        renderLogTable(data.logs);
        renderUsageChart(data.chart_data);
    } catch { /* offline */ }
}

function renderLogTable(logs) {
    const body = $('logBody');
    body.innerHTML = '';
    if (!logs.length) {
        body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-dim);padding:24px">No events found</td></tr>';
        return;
    }
    logs.forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
      <td>${log.device_name}</td>
      <td><span class="state-badge ${log.state === 'ON' ? 'on' : ''}">${log.state}</span></td>
      <td style="color:var(--text-dim)">${log.triggered_by}</td>
      <td style="color:var(--text-dim)">${new Date(log.timestamp).toLocaleString('en-IN')}</td>
    `;
        body.appendChild(tr);
    });
}

function renderUsageChart(data) {
    const ctx = document.getElementById('usageChart').getContext('2d');

    // Group by device
    const devices = [...new Set(data.map(d => d.device_key))];
    const hours = [...new Set(data.map(d => d.hour))].sort();

    const colors = {
        light1: 'rgba(79,142,247,0.8)',
        light2: 'rgba(245,158,11,0.8)',
        fan: 'rgba(124,92,252,0.8)',
        tv: 'rgba(229,9,20,0.8)',
    };

    const datasets = devices.map(key => ({
        label: DEVICES.find(d => d.key === key)?.name || key,
        data: hours.map(h => {
            const row = data.find(d => d.device_key === key && d.hour === h);
            return row ? row.on_count : 0;
        }),
        backgroundColor: colors[key] || 'rgba(200,200,200,0.7)',
        borderRadius: 4,
        borderSkipped: false,
    }));

    if (usageChart) usageChart.destroy();

    usageChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: hours.map(h => new Date(h).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })), datasets },
        options: {
            responsive: true,
            plugins: {
                legend: { labels: { color: 'rgba(232,234,246,0.7)', font: { family: 'Inter', size: 12 } } },
                tooltip: { mode: 'index' },
            },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(232,234,246,0.5)' } },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: 'rgba(232,234,246,0.5)', stepSize: 1 },
                    beginAtZero: true,
                },
            },
        },
    });
}

/* ===========================================================
   TOAST NOTIFICATIONS
=========================================================== */
function toast(message, type = 'info') {
    const container = $('toastContainer');
    const el = document.createElement('div');
    const icons = { success: '✅', error: '❌', info: '💬', warning: '⚠️' };
    el.className = `toast toast-${type === 'info' ? 'success' : type}`;
    el.innerHTML = `<span>${icons[type] || '💬'}</span><span>${message}</span>`;
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; }, 3500);
    setTimeout(() => el.remove(), 3800);
}

/* ================================================================
   AC CONTROLLER
   Real temperature simulation + full remote control UI
================================================================ */
const AC = {
    on: false,
    setTemp: 24,          // °C set point
    roomTemp: 28.5,        // °C simulated room temperature
    mode: 'cool',      // cool | heat | fan | auto | dry
    fan: 'auto',      // auto | low | medium | high
    swing: false,
    sleep: false,
    eco: false,
    ambient: 28.5,        // baseline room temp (drifts back here when off)
    _timer: null,        // simulation interval handle
};

/* ── Simulation: room temperature changes every 3 seconds ── */
function acStartSim() {
    if (AC._timer) return;
    AC._timer = setInterval(() => {
        if (AC.on) {
            const diff = AC.setTemp - AC.roomTemp;
            let rate = 0;
            if (AC.mode === 'cool') rate = diff > 0 ? 0.04 : 0.12;   // cool faster
            else if (AC.mode === 'heat') rate = diff < 0 ? 0.04 : 0.12;
            else if (AC.mode === 'auto') rate = Math.sign(diff) * 0.1;
            else if (AC.mode === 'dry') rate = diff > 0 ? 0.02 : 0.06;
            else rate = 0; // fan only — no temp change

            // Eco slows the rate
            if (AC.eco) rate *= 0.6;

            AC.roomTemp = Math.round((AC.roomTemp + rate * Math.sign(diff)) * 10) / 10;
            // Clamp room temp movement
            if (Math.abs(AC.roomTemp - AC.setTemp) < 0.1) AC.roomTemp = AC.setTemp;
        } else {
            // Drift back to ambient
            const diff = AC.ambient - AC.roomTemp;
            if (Math.abs(diff) > 0.1)
                AC.roomTemp = Math.round((AC.roomTemp + diff * 0.05) * 10) / 10;
        }
        acRefreshLCD();
    }, 3000);
}

/* ── Open modal ── */
function openAcModal() {
    const overlay = $('acOverlay');
    if (!overlay) return;
    overlay.classList.add('open');
    acRefreshLCD();
    acRefreshAll();
}

/* ── Close modal ── */
function closeAcModal() {
    const overlay = $('acOverlay');
    if (overlay) overlay.classList.remove('open');
}

/* ── LCD display refresh ── */
function acRefreshLCD() {
    const modeLabel = { cool: '❄ COOLING', heat: '🔥 HEATING', fan: '💨 FAN ONLY', auto: '🔄 AUTO', dry: '💧 DRY' };
    const fanLabel = { auto: 'FAN: AUTO', low: 'FAN: LOW', medium: 'FAN: MED', high: 'FAN: HIGH' };

    if ($('acRoomTemp')) $('acRoomTemp').textContent = AC.roomTemp.toFixed(1) + '°C';
    if ($('acSetTempBig')) $('acSetTempBig').textContent = AC.setTemp + '°C';
    if ($('acLcdStatus')) $('acLcdStatus').textContent = AC.on ? (AC.mode === 'cool' ? 'COOLING' : AC.mode.toUpperCase()) : 'STANDBY';
    if ($('acLcdMode')) $('acLcdMode').textContent = modeLabel[AC.mode] || AC.mode.toUpperCase();
    if ($('acLcdFan')) $('acLcdFan').textContent = fanLabel[AC.fan] || 'FAN: AUTO';
    if ($('acLcdTimer')) $('acLcdTimer').textContent = 'TIMER: OFF';
    if ($('acSetTempNum')) $('acSetTempNum').textContent = AC.setTemp;
    if ($('acHeaderSub')) $('acHeaderSub').textContent = AC.on
        ? `${modeLabel[AC.mode]} · ${AC.roomTemp.toFixed(1)}°C`
        : 'Standby';

    // LCD digits color: blue when cooling, orange when heating
    const lcdColor = AC.on
        ? (AC.mode === 'cool' ? '#00e5ff' : AC.mode === 'heat' ? '#ff9a00' : '#00e5ff')
        : '#00e5ff';
    document.querySelectorAll('.ac-lcd-val, .ac-lcd-big').forEach(el => {
        el.style.color = lcdColor;
        el.style.textShadow = `0 0 14px ${lcdColor}66`;
    });

    // Track bar: set temp position (16–30 range)
    const pct = ((AC.setTemp - 16) / (30 - 16)) * 100;
    if ($('acTrackFill')) $('acTrackFill').style.width = pct + '%';
    if ($('acTrackCursor')) $('acTrackCursor').style.left = pct + '%';
}

/* ── Refresh all button states ── */
function acRefreshAll() {
    // Mode buttons
    document.querySelectorAll('.ac-mode-btn').forEach(b => b.classList.remove('active'));
    const mBtn = $('acMode-' + AC.mode);
    if (mBtn) mBtn.classList.add('active');

    // Fan buttons
    document.querySelectorAll('.ac-fan-btn').forEach(b => b.classList.remove('active'));
    const fBtn = $('acFan-' + AC.fan);
    if (fBtn) fBtn.classList.add('active');

    // Extras
    const swingBtn = $('acSwingBtn');
    const sleepBtn = $('acSleepBtn');
    const ecoBtn = $('acEcoBtn');
    if (swingBtn) { swingBtn.textContent = `↕ Swing: ${AC.swing ? 'ON' : 'OFF'}`; swingBtn.classList.toggle('active', AC.swing); }
    if (sleepBtn) { sleepBtn.textContent = `🌙 Sleep: ${AC.sleep ? 'ON' : 'OFF'}`; sleepBtn.classList.toggle('active', AC.sleep); }
    if (ecoBtn) { ecoBtn.textContent = `🌿 Eco: ${AC.eco ? 'ON' : 'OFF'}`; ecoBtn.classList.toggle('active', AC.eco); }

    // Power button
    const pwrBtn = $('acPowerBtn');
    const pwrLbl = $('acPowerLabel');
    if (pwrBtn) pwrBtn.classList.toggle('on', AC.on);
    if (pwrLbl) pwrLbl.textContent = AC.on ? 'POWER OFF' : 'POWER ON';
}

/* ── Set temperature ── */
function acChangeTemp(delta) {
    AC.setTemp = Math.max(16, Math.min(30, AC.setTemp + delta));
    acRefreshLCD();
    if (AC.on) {
        const payload = JSON.stringify({ state: 'ON', setTemp: AC.setTemp, mode: AC.mode, fan: AC.fan });
        sendCommand('ac', 'ON'); // keep ON with updated setTemp
    }
}

/* ── Set mode ── */
function acSetMode(mode) {
    AC.mode = mode;
    acRefreshLCD();
    acRefreshAll();
}

/* ── Set fan speed ── */
function acSetFan(speed) {
    AC.fan = speed;
    acRefreshLCD();
    acRefreshAll();
}

/* ── Toggle extras ── */
function acToggleSwing() { AC.swing = !AC.swing; acRefreshAll(); }
function acToggleSleep() { AC.sleep = !AC.sleep; acRefreshAll(); }
function acToggleEco() { AC.eco = !AC.eco; acRefreshAll(); }

/* ── Power toggle ── */
function acTogglePower() {
    AC.on = !AC.on;
    const newState = AC.on ? 'ON' : 'OFF';

    // Update device card
    updateDeviceUI('ac', newState);

    // Send MQTT + REST command
    sendCommand('ac', newState);

    // Refresh UI
    acRefreshLCD();
    acRefreshAll();

    // Start/stop temp simulation
    if (AC.on) {
        acStartSim();
        toast(`❄️ AC ON · ${AC.mode.toUpperCase()} · Set ${AC.setTemp}°C`, 'success');
    } else {
        toast('❄️ AC turned OFF', 'info');
    }
}

/* ── Override device card click for AC → open modal ── */
document.addEventListener('DOMContentLoaded', () => {
    // Install AC-specific card click listener after cards are rendered
    const origRenderGrid = window._origRenderGrid;
    setTimeout(() => {
        document.querySelectorAll('.device-card[data-key="ac"]').forEach(card => {
            // Remove the default toggle click and replace with modal open
            card.onclick = (e) => {
                e.stopPropagation();
                openAcModal();
            };
        });
    }, 800);
});

// Intercept sendCommand to open modal when user clicks AC card generated by renderDeviceGrid
// We patch this after the grid renders
function acInstallCardClick() {
    document.querySelectorAll('[data-key="ac"]').forEach(el => {
        el.onclick = (e) => { e.stopPropagation(); openAcModal(); };
    });
}

// Re-install every time the device grid is rendered (called inside renderDeviceGrid)
// Hook: patch renderDeviceGrid to call acInstallCardClick after render
const _origRenderGrid = window.renderDeviceGrid;
if (typeof renderDeviceGrid === 'function') {
    const __rg = renderDeviceGrid;
    window.renderDeviceGrid = function (...args) {
        __rg.apply(this, args);
        setTimeout(acInstallCardClick, 50);
    };
}

/* Start ambient temperature simulation immediately */
acStartSim();

/* Subscribe to AC temperature topic from MQTT */
function acHandleMqttMessage(topic, payload) {
    if (topic === 'home/ac/temp') {
        const t = parseFloat(payload);
        if (!isNaN(t)) {
            AC.roomTemp = t; // real sensor value overrides simulation
            acRefreshLCD();
        }
    }
    if (topic === 'home/ac/status') {
        const state = payload.toString().trim().toUpperCase();
        AC.on = (state === 'ON');
        updateDeviceUI('ac', state);
        acRefreshAll();
    }
}
// Expose for MQTT message handler in connectMQTT
window.acHandleMqttMessage = acHandleMqttMessage;
