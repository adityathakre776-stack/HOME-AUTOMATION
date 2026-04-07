<?php
/**
 * IoT Home Automation - Authentication API
 * POST /api/auth.php?action=login
 * POST /api/auth.php?action=logout
 * GET  /api/auth.php?action=check
 */

require_once __DIR__ . '/../config/config.php';

setApiHeaders();
session_start();

$action = strtolower($_GET['action'] ?? 'check');

// ── CHECK ─────────────────────────────────────────────────
if ($action === 'check') {
    if (!empty($_SESSION['user_id'])) {
        jsonResponse([
            'success'  => true,
            'loggedIn' => true,
            'user'     => [
                'id'       => $_SESSION['user_id'],
                'username' => $_SESSION['username'],
                'role'     => $_SESSION['role'],
            ],
        ]);
    } else {
        jsonResponse(['success' => true, 'loggedIn' => false]);
    }
}

// ── LOGIN ─────────────────────────────────────────────────
if ($action === 'login') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        jsonResponse(['success' => false, 'error' => 'Method not allowed'], 405);
    }

    $body     = json_decode(file_get_contents('php://input'), true);
    $username = trim($body['username'] ?? '');
    $password = $body['password'] ?? '';

    if (empty($username) || empty($password)) {
        jsonResponse(['success' => false, 'error' => 'Username and password required'], 400);
    }

    $pdo  = getDB();
    $stmt = $pdo->prepare('SELECT * FROM users WHERE username = ? AND is_active = 1');
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password'])) {
        // Delay to prevent brute force
        sleep(1);
        jsonResponse(['success' => false, 'error' => 'Invalid credentials'], 401);
    }

    // Update last login
    $pdo->prepare('UPDATE users SET last_login = NOW() WHERE id = ?')->execute([$user['id']]);

    // Set session
    $_SESSION['user_id']  = $user['id'];
    $_SESSION['username'] = $user['username'];
    $_SESSION['role']     = $user['role'];

    jsonResponse([
        'success' => true,
        'message' => 'Login successful',
        'user'    => [
            'id'       => $user['id'],
            'username' => $user['username'],
            'role'     => $user['role'],
        ],
    ]);
}

// ── LOGOUT ────────────────────────────────────────────────
if ($action === 'logout') {
    $_SESSION = [];
    session_destroy();
    jsonResponse(['success' => true, 'message' => 'Logged out']);
}

jsonResponse(['success' => false, 'error' => 'Unknown action'], 400);
