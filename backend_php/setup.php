<?php
/**
 * IoT Home Automation — One-time Setup Script
 * Visit: http://localhost/IOT/backend_php/setup.php
 * 
 * This script:
 *  1. Creates the database and tables if they don't exist
 *  2. Creates/resets the admin user with the correct bcrypt hash
 *  3. Inserts default device definitions
 *
 * DELETE this file after first run in production!
 */

// ── Database credentials ─────────────────────────────────
$DB_HOST = 'localhost';
$DB_USER = 'root';
$DB_PASS = '';          // Change if you set a MySQL password
$DB_NAME = 'iot_home';

$errors  = [];
$success = [];

try {
    // Connect without selecting a database first
    $pdo = new PDO(
        "mysql:host=$DB_HOST;charset=utf8mb4",
        $DB_USER, $DB_PASS,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );

    // 1. Create database
    $pdo->exec("CREATE DATABASE IF NOT EXISTS `$DB_NAME` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    $pdo->exec("USE `$DB_NAME`");
    $success[] = "✅ Database '$DB_NAME' ready";

    // 2. Create tables
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS users (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            username    VARCHAR(50)  NOT NULL UNIQUE,
            password    VARCHAR(255) NOT NULL,
            email       VARCHAR(100),
            role        ENUM('admin','user') DEFAULT 'user',
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login  DATETIME,
            is_active   TINYINT(1) DEFAULT 1
        ) ENGINE=InnoDB
    ");
    $success[] = "✅ Table 'users' ready";

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS devices (
            id             INT AUTO_INCREMENT PRIMARY KEY,
            device_key     VARCHAR(30)  NOT NULL UNIQUE,
            device_name    VARCHAR(50)  NOT NULL,
            device_type    ENUM('light','fan','switch','sensor') DEFAULT 'switch',
            gpio_pin       INT,
            topic_set      VARCHAR(100),
            topic_status   VARCHAR(100),
            current_state  ENUM('ON','OFF') DEFAULT 'OFF',
            is_active      TINYINT(1) DEFAULT 1,
            created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
    ");
    $success[] = "✅ Table 'devices' ready";

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS device_logs (
            id           INT AUTO_INCREMENT PRIMARY KEY,
            device_key   VARCHAR(30) NOT NULL,
            device_name  VARCHAR(50) NOT NULL,
            state        ENUM('ON','OFF') NOT NULL,
            triggered_by VARCHAR(20) DEFAULT 'dashboard',
            user_id      INT,
            timestamp    DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_device    (device_key),
            INDEX idx_timestamp (timestamp)
        ) ENGINE=InnoDB
    ");
    $success[] = "✅ Table 'device_logs' ready";

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS user_sessions (
            id            INT AUTO_INCREMENT PRIMARY KEY,
            user_id       INT NOT NULL,
            session_token VARCHAR(128),
            ip_address    VARCHAR(45),
            created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at    DATETIME
        ) ENGINE=InnoDB
    ");
    $success[] = "✅ Table 'user_sessions' ready";

    // 3. Create/reset admin user with CORRECT hash
    $adminPassword = 'admin123';
    $adminHash     = password_hash($adminPassword, PASSWORD_BCRYPT, ['cost' => 10]);

    $stmt = $pdo->prepare("SELECT id FROM users WHERE username = 'admin'");
    $stmt->execute();
    $exists = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($exists) {
        $upd = $pdo->prepare("UPDATE users SET password = ?, is_active = 1 WHERE username = 'admin'");
        $upd->execute([$adminHash]);
        $success[] = "✅ Admin password reset to 'admin123'";
    } else {
        $ins = $pdo->prepare(
            "INSERT INTO users (username, password, email, role) VALUES ('admin', ?, 'admin@smarthome.local', 'admin')"
        );
        $ins->execute([$adminHash]);
        $success[] = "✅ Admin user created (username: admin / password: admin123)";
    }

    // 4. Insert default devices (skip if already exist)
    $devices = [
        ['light1', 'Light 1',         'light',  23, 'home/light1/set', 'home/light1/status'],
        ['light2', 'Light 2',         'light',  19, 'home/light2/set', 'home/light2/status'],
        ['fan',    'Ceiling Fan',     'fan',    22, 'home/fan/set',    'home/fan/status'],
        ['tv',     'Smart TV',        'switch', 18, 'home/tv/set',     'home/tv/status'],
        ['ac',     'Air Conditioner', 'switch', 21, 'home/ac/set',     'home/ac/status'],
    ];
    foreach ($devices as $d) {
        $chk = $pdo->prepare("SELECT id FROM devices WHERE device_key = ?");
        $chk->execute([$d[0]]);
        if (!$chk->fetch()) {
            $ins = $pdo->prepare(
                "INSERT INTO devices (device_key,device_name,device_type,gpio_pin,topic_set,topic_status) VALUES (?,?,?,?,?,?)"
            );
            $ins->execute($d);
        }
    }
    $success[] = "✅ Devices (Light 1, Light 2, Fan) configured";

    // 5. Verify hash works
    $check = $pdo->prepare("SELECT password FROM users WHERE username = 'admin'");
    $check->execute();
    $row = $check->fetch(PDO::FETCH_ASSOC);
    $valid = password_verify($adminPassword, $row['password']);
    $success[] = $valid
        ? "✅ Hash verification PASSED — login will work"
        : "❌ Hash verification FAILED — something went wrong";

} catch (PDOException $e) {
    $errors[] = "❌ Database error: " . $e->getMessage();
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>IoT Setup</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; background: #060b18; color: #e8eaf6; min-height: 100vh;
           display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
            border-radius: 20px; padding: 40px; max-width: 560px; width: 100%; }
    h1 { font-size: 22px; margin-bottom: 8px; }
    p.sub { color: rgba(232,234,246,0.5); font-size: 13px; margin-bottom: 28px; }
    .item { padding: 10px 16px; border-radius: 10px; margin-bottom: 8px; font-size: 14px; }
    .ok   { background: rgba(34,197,94,0.1);  border: 1px solid rgba(34,197,94,0.25);  color: #86efac; }
    .err  { background: rgba(239,68,68,0.1);  border: 1px solid rgba(239,68,68,0.25);  color: #fca5a5; }
    .box  { background: rgba(79,142,247,0.08); border: 1px solid rgba(79,142,247,0.2);
            border-radius: 12px; padding: 18px 20px; margin-top: 24px; }
    .box h3 { color: #93c5fd; font-size: 14px; margin-bottom: 12px; }
    .kv   { display: flex; justify-content: space-between; font-size: 13px;
            margin-bottom: 6px; color: rgba(232,234,246,0.7); }
    .kv strong { color: #e8eaf6; }
    .btn  { display: inline-block; margin-top: 20px; padding: 12px 28px;
            background: linear-gradient(135deg, #4f8ef7, #7c5cfc); border-radius: 10px;
            color: #fff; text-decoration: none; font-weight: 600; font-size: 14px; }
    .warn { margin-top: 16px; padding: 12px 16px; background: rgba(245,158,11,0.1);
            border: 1px solid rgba(245,158,11,0.25); border-radius: 10px;
            font-size: 12px; color: #fcd34d; }
  </style>
</head>
<body>
<div class="card">
  <h1>🏠 IoT Home — Setup Complete</h1>
  <p class="sub">Database initialisation results:</p>

  <?php foreach ($success as $msg): ?>
    <div class="item ok"><?= htmlspecialchars($msg) ?></div>
  <?php endforeach; ?>

  <?php foreach ($errors as $msg): ?>
    <div class="item err"><?= htmlspecialchars($msg) ?></div>
  <?php endforeach; ?>

  <?php if (empty($errors)): ?>
  <div class="box">
    <h3>🔑 Login Credentials</h3>
    <div class="kv"><span>Username</span><strong>admin</strong></div>
    <div class="kv"><span>Password</span><strong>admin123</strong></div>
    <div class="kv"><span>URL</span><strong>http://localhost/IOT/</strong></div>
  </div>
  <a class="btn" href="../index.html">Go to Login →</a>
  <div class="warn">
    ⚠️ Delete or restrict access to this file after setup:<br/>
    <code>backend_php/setup.php</code>
  </div>
  <?php endif; ?>
</div>
</body>
</html>
