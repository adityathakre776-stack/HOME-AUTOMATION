<?php
/**
 * IoT Home Automation - Status API
 * GET /api/status.php              → all devices
 * GET /api/status.php?device=fan   → single device
 * GET /api/status.php?history=1&device=light1&limit=50 → history log
 */

require_once __DIR__ . '/../config/config.php';

setApiHeaders();

$pdo = getDB();

// ── History logs mode ─────────────────────────────────────
if (isset($_GET['history'])) {
    $device = $_GET['device'] ?? null;
    $limit  = min((int)($_GET['limit'] ?? 100), 500);

    if ($device) {
        $stmt = $pdo->prepare(
            'SELECT device_key, device_name, state, triggered_by, timestamp
             FROM device_logs WHERE device_key = ?
             ORDER BY timestamp DESC LIMIT ?'
        );
        $stmt->execute([$device, $limit]);
    } else {
        $stmt = $pdo->prepare(
            'SELECT device_key, device_name, state, triggered_by, timestamp
             FROM device_logs
             ORDER BY timestamp DESC LIMIT ?'
        );
        $stmt->execute([$limit]);
    }

    $logs = $stmt->fetchAll();

    // Prepare chart data: hourly ON counts per device
    $chartStmt = $pdo->prepare(
        "SELECT device_key,
                DATE_FORMAT(timestamp, '%Y-%m-%d %H:00:00') AS hour,
                SUM(state = 'ON') AS on_count,
                COUNT(*) AS total
         FROM device_logs
         WHERE timestamp >= NOW() - INTERVAL 24 HOUR
         GROUP BY device_key, hour
         ORDER BY hour ASC"
    );
    $chartStmt->execute();
    $chartData = $chartStmt->fetchAll();

    jsonResponse([
        'success'    => true,
        'logs'       => $logs,
        'chart_data' => $chartData,
        'count'      => count($logs),
    ]);
}

// ── Single device status ──────────────────────────────────
if (isset($_GET['device'])) {
    $device = strtolower(trim($_GET['device']));
    $stmt   = $pdo->prepare(
        'SELECT device_key, device_name, device_type, current_state, updated_at
         FROM devices WHERE device_key = ? AND is_active = 1'
    );
    $stmt->execute([$device]);
    $dev = $stmt->fetch();

    if (!$dev) {
        jsonResponse(['success' => false, 'error' => 'Device not found'], 404);
    }

    jsonResponse(['success' => true, 'device' => $dev]);
}

// ── All devices status ────────────────────────────────────
$stmt = $pdo->query(
    'SELECT device_key, device_name, device_type, gpio_pin,
            topic_set, topic_status, current_state, updated_at
     FROM devices WHERE is_active = 1 ORDER BY id'
);
$devices = $stmt->fetchAll();

// Simulated battery/UPS status
$batteryStatus = [
    'percentage' => rand(75, 100),
    'voltage'    => number_format(12.2 + (rand(0, 16) / 10), 1),
    'charging'   => true,
    'status'     => 'Healthy',
];

jsonResponse([
    'success'   => true,
    'devices'   => $devices,
    'battery'   => $batteryStatus,
    'server_time' => date('c'),
    'count'     => count($devices),
]);
