-- =============================================
-- IoT Home Automation - MySQL Database Schema
-- =============================================
-- Run this script in phpMyAdmin or MySQL CLI
-- charset: utf8mb4

CREATE DATABASE IF NOT EXISTS iot_home CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE iot_home;

-- =============================================
-- USERS TABLE (Authentication)
-- =============================================
CREATE TABLE IF NOT EXISTS users (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    username    VARCHAR(50)  NOT NULL UNIQUE,
    password    VARCHAR(255) NOT NULL,   -- bcrypt hashed
    email       VARCHAR(100),
    role        ENUM('admin','user') DEFAULT 'user',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login  DATETIME,
    is_active   TINYINT(1) DEFAULT 1
) ENGINE=InnoDB;

-- ⚠️  Do NOT insert admin here — use setup.php to generate
-- the correct bcrypt hash at runtime:
--   http://localhost/IOT/backend_php/setup.php

-- =============================================
-- DEVICES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS devices (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    device_key  VARCHAR(30) NOT NULL UNIQUE,    -- e.g. 'light1'
    device_name VARCHAR(50) NOT NULL,            -- e.g. 'Light 1'
    device_type ENUM('light','fan','switch','sensor') DEFAULT 'switch',
    gpio_pin    INT,
    topic_set   VARCHAR(100),
    topic_status VARCHAR(100),
    current_state ENUM('ON','OFF') DEFAULT 'OFF',
    is_active   TINYINT(1) DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Insert default devices
INSERT INTO devices (device_key, device_name, device_type, gpio_pin, topic_set, topic_status) VALUES
('light1', 'Light 1',         'light',  23, 'home/light1/set', 'home/light1/status'),
('light2', 'Light 2',         'light',  19, 'home/light2/set', 'home/light2/status'),
('fan',    'Ceiling Fan',     'fan',    22, 'home/fan/set',    'home/fan/status'),
('tv',     'Smart TV',        'switch', 18, 'home/tv/set',     'home/tv/status'),
('ac',     'Air Conditioner', 'switch', 21, 'home/ac/set',     'home/ac/status');

-- =============================================
-- DEVICE LOGS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS device_logs (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    device_key  VARCHAR(30) NOT NULL,
    device_name VARCHAR(50) NOT NULL,
    state       ENUM('ON','OFF') NOT NULL,
    triggered_by VARCHAR(20) DEFAULT 'dashboard',  -- 'dashboard', 'esp32', 'schedule'
    user_id     INT,
    timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_device   (device_key),
    INDEX idx_timestamp (timestamp),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- =============================================
-- SESSIONS TABLE (optional, PHP handles natively)
-- =============================================
CREATE TABLE IF NOT EXISTS user_sessions (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    session_token VARCHAR(128),
    ip_address  VARCHAR(45),
    user_agent  TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at  DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =============================================
-- SAMPLE LOGS (for testing graph)
-- =============================================
INSERT INTO device_logs (device_key, device_name, state, triggered_by) VALUES
('light1', 'Light 1', 'ON',  'dashboard'),
('light1', 'Light 1', 'OFF', 'dashboard'),
('light2', 'Light 2', 'ON',  'dashboard'),
('fan',    'Ceiling Fan', 'ON', 'esp32'),
('fan',    'Ceiling Fan', 'OFF', 'esp32');
