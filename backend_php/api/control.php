<?php
/**
 * IoT Home Automation - Device Control API
 * POST /api/control.php
 *
 * Body (JSON):
 * {
 *   "device": "light1" | "light2" | "fan" | "tv" | "ac",
 *   "state":  "ON" | "OFF"
 * }
 *
 * Response:
 * { "success": true, "device": "light1", "state": "ON", "mqtt_sent": true }
 */

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../includes/mqtt_helper.php';

setApiHeaders();
// requireAuth();  // Uncomment to enforce login

// ── Only POST allowed ─────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(['success' => false, 'error' => 'Method not allowed'], 405);
}

// ── Parse JSON body ───────────────────────────────────────
$raw  = file_get_contents('php://input');
$body = json_decode($raw, true);

$device = strtolower(trim($body['device'] ?? ''));
$state  = strtoupper(trim($body['state']  ?? ''));

// ── Validate ──────────────────────────────────────────────
$validDevices = ['light1', 'light2', 'fan', 'tv', 'ac'];
$validStates  = ['ON', 'OFF'];

if (!in_array($device, $validDevices, true)) {
    jsonResponse(['success' => false, 'error' => 'Invalid device. Use: light1, light2, fan, tv, ac'], 400);
}
if (!in_array($state, $validStates, true)) {
    jsonResponse(['success' => false, 'error' => 'Invalid state. Use: ON or OFF'], 400);
}

// ── Load device from DB ───────────────────────────────────
$pdo  = getDB();
$stmt = $pdo->prepare('SELECT * FROM devices WHERE device_key = ? AND is_active = 1');
$stmt->execute([$device]);
$dev  = $stmt->fetch();

if (!$dev) {
    jsonResponse(['success' => false, 'error' => 'Device not found'], 404);
}

// ── Publish MQTT command ──────────────────────────────────
$topicSet = $dev['topic_set'];
$mqttSent = mqttPublish($topicSet, $state, retain: true);

// ── Update device state in DB ─────────────────────────────
$updStmt = $pdo->prepare('UPDATE devices SET current_state = ? WHERE device_key = ?');
$updStmt->execute([$state, $device]);

// ── Log the event ─────────────────────────────────────────
$userId = $_SESSION['user_id'] ?? null;
$logStmt = $pdo->prepare(
    'INSERT INTO device_logs (device_key, device_name, state, triggered_by, user_id) VALUES (?, ?, ?, ?, ?)'
);
$logStmt->execute([$device, $dev['device_name'], $state, 'dashboard', $userId]);

// ── Success response ──────────────────────────────────────
jsonResponse([
    'success'   => true,
    'device'    => $device,
    'name'      => $dev['device_name'],
    'state'     => $state,
    'topic'     => $topicSet,
    'mqtt_sent' => $mqttSent,
    'timestamp' => date('c'),
]);
