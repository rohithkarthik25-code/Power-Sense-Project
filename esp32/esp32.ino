#include <Wire.h>
#include <WiFi.h>
#include <ArduinoWebsockets.h>
#include <Adafruit_ADS1X15.h>

using namespace websockets;

// ================= WIFI =================
const char* ssid = "IIITDM";
const char* password = "pendrive";

// Change to your PC/app server IP
const char* websockets_server = "ws://172.16.216.231:8080";

// ================= ADS1115 =================
Adafruit_ADS1115 ads;

float adcMultiplier = 0.1875 / 1000.0;

#define SAMPLES 300
#define SUPPLY_VOLTAGE 230.0

float calibration = 15.0;

// smoothing
float smoothPower = 0;
float alpha = 0.1;

// ================= WEBSOCKET =================
WebsocketsClient client;

unsigned long lastSendTime = 0;

// Reconnect timers
unsigned long previousMillisWiFi = 0;
unsigned long intervalWiFi = 30000;
unsigned long previousMillisWS = 0;
unsigned long intervalWS = 5000;

// ---------- RMS FUNCTION ----------
float computeRMS() {
  float sum = 0;
  float offset = 0;

  // OFFSET
  for (int i = 0; i < SAMPLES; i++) {
    int16_t adc = ads.readADC_SingleEnded(0);
    float voltage = adc * adcMultiplier;
    offset += voltage;
    delayMicroseconds(400);
  }

  offset /= SAMPLES;

  // RMS
  for (int i = 0; i < SAMPLES; i++) {
    int16_t adc = ads.readADC_SingleEnded(0);
    float voltage = adc * adcMultiplier;

    float centered = voltage - offset;
    sum += centered * centered;

    delayMicroseconds(400);
  }

  float rmsVoltage = sqrt(sum / SAMPLES);

  float current = rmsVoltage * calibration;

  return current;
}

// ---------- WIFI SETUP ----------
void setupWiFi() {
  WiFi.begin(ssid, password);
  Serial.print("Connecting WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi Connected!");
}

// ---------- SETUP ----------
void setup() {
  Serial.begin(115200);

  Wire.begin(21, 22);

  if (!ads.begin()) {
    Serial.println("ADS1115 not found!");
    while (1);
  }

  ads.setGain(GAIN_TWOTHIRDS);

  setupWiFi();

  if (client.connect(websockets_server)) {
    Serial.println("WebSocket Connected!");
  } else {
    Serial.println("WebSocket Failed!");
  }
}

// ---------- LOOP ----------
void loop() {
  unsigned long now = millis();

  // 1. Maintain WiFi Connection
  if ((WiFi.status() != WL_CONNECTED) && (now - previousMillisWiFi >= intervalWiFi)) {
    Serial.println("Reconnecting WiFi...");
    WiFi.disconnect();
    WiFi.reconnect();
    previousMillisWiFi = now;
  }

  // 2. Maintain WebSocket Connection
  if (WiFi.status() == WL_CONNECTED) {
    if (!client.available() && (now - previousMillisWS >= intervalWS)) {
      Serial.println("Reconnecting WebSocket...");
      client.connect(websockets_server);
      previousMillisWS = now;
    }
    
    // Keep WebSocket alive
    if (client.available()) {
      client.poll();
    }
  }

  float Irms = computeRMS();
  float power = SUPPLY_VOLTAGE * Irms;

  // SMOOTHING
  smoothPower = alpha * power + (1 - alpha) * smoothPower;

  // ================= SEND TO APP =================
  if (now - lastSendTime > 1000) {
    lastSendTime = now;

    // CRITICAL JSON FIX: The dashboard requires 'voltage' and 'current'.
    char payload[200];
    snprintf(payload, sizeof(payload),
             "{\"timestamp\":%lu, \"power\":%.2f, \"voltage\":%.2f, \"current\":%.2f}",
             now, smoothPower, SUPPLY_VOLTAGE, Irms);

    if (client.available()) {
      client.send(payload);
      Serial.print("Data Sent: ");
      Serial.println(payload);
    }
  }
}
