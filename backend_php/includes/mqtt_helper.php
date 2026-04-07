<?php
/**
 * IoT Home Automation - MQTT Helper (using phpMQTT)
 * Publishes commands to Mosquitto broker via socket-level MQTT.
 * No external library required – pure PHP MQTT v3.1 implementation.
 */

class SimpleMQTT {
    private string $host;
    private int    $port;
    private string $clientId;
    private string $username;
    private string $password;
    private $socket  = null;
    private bool   $connected = false;

    public function __construct(
        string $host     = '127.0.0.1',
        int    $port     = 1883,
        string $clientId = 'phpMQTT',
        string $username = '',
        string $password = ''
    ) {
        $this->host     = $host;
        $this->port     = $port;
        $this->clientId = $clientId;
        $this->username = $username;
        $this->password = $password;
    }

    public function connect(int $timeout = 5): bool {
        $this->socket = @fsockopen($this->host, $this->port, $errno, $errstr, $timeout);
        if (!$this->socket) {
            error_log("[MQTT] Connect failed: $errstr ($errno)");
            return false;
        }
        stream_set_timeout($this->socket, $timeout);

        // Build CONNECT packet
        $clientIdLen = strlen($this->clientId);
        $payload  = chr(0x00) . chr(0x04) . 'MQTT'; // Protocol Name
        $payload .= chr(0x04);                        // Protocol Level (v3.1.1)

        $connectFlags = 0x02; // Clean Session
        if ($this->username !== '') $connectFlags |= 0x80;
        if ($this->password !== '') $connectFlags |= 0x40;
        $payload .= chr($connectFlags);
        $payload .= chr(0x00) . chr(0x3C);            // Keep-alive: 60s

        // Client ID
        $payload .= chr($clientIdLen >> 8) . chr($clientIdLen & 0xFF) . $this->clientId;

        // Credentials
        if ($this->username !== '') {
            $uLen = strlen($this->username);
            $payload .= chr($uLen >> 8) . chr($uLen & 0xFF) . $this->username;
        }
        if ($this->password !== '') {
            $pLen = strlen($this->password);
            $payload .= chr($pLen >> 8) . chr($pLen & 0xFF) . $this->password;
        }

        $header  = chr(0x10); // CONNECT
        $header .= $this->encodeLength(strlen($payload));
        fwrite($this->socket, $header . $payload);

        // Read CONNACK
        $response = fread($this->socket, 4);
        if (strlen($response) < 4 || ord($response[0]) !== 0x20) {
            error_log('[MQTT] CONNACK not received');
            return false;
        }
        $returnCode = ord($response[3]);
        if ($returnCode !== 0x00) {
            error_log("[MQTT] Connection refused, code: $returnCode");
            return false;
        }

        $this->connected = true;
        return true;
    }

    public function publish(string $topic, string $message, bool $retain = false, int $qos = 0): bool {
        if (!$this->connected) return false;

        $topicLen = strlen($topic);
        $payload  = chr($topicLen >> 8) . chr($topicLen & 0xFF) . $topic . $message;

        $header  = chr(0x30 | ($retain ? 0x01 : 0x00) | ($qos << 1));
        $header .= $this->encodeLength(strlen($payload));

        $written = fwrite($this->socket, $header . $payload);
        return $written !== false;
    }

    public function disconnect(): void {
        if ($this->socket) {
            fwrite($this->socket, chr(0xE0) . chr(0x00));
            fclose($this->socket);
            $this->socket    = null;
            $this->connected = false;
        }
    }

    private function encodeLength(int $length): string {
        $result = '';
        do {
            $byte    = $length % 128;
            $length  = intdiv($length, 128);
            if ($length > 0) $byte |= 0x80;
            $result .= chr($byte);
        } while ($length > 0);
        return $result;
    }
}

/**
 * Convenience helper: publish and disconnect
 */
function mqttPublish(string $topic, string $message, bool $retain = true): bool {
    $mqtt = new SimpleMQTT(
        MQTT_HOST, MQTT_PORT, MQTT_CLIENT, MQTT_USER, MQTT_PASS
    );
    if (!$mqtt->connect(3)) return false;
    $ok = $mqtt->publish($topic, $message, $retain);
    $mqtt->disconnect();
    return $ok;
}
