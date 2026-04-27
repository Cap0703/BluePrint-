#include <PN532_I2C.h>

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include "FS.h"
#include "LittleFS.h"
#include <WiFiClientSecure.h>
#include <Adafruit_Fingerprint.h>
#include <Adafruit_PN532.h>
#include <Wire.h>
#include <WebSocketsClient.h>

// ========== CONFIGURATION ==========
const char ssid[] = "NETGEAR54";
const char password[] = "silentbird445";

WebSocketsClient webSocket;

const char* SCANNER_ID = "1";
const char* SCANNER_LOCATION = "304";
const char* SCANNER_PASSWORD = "BluePrint";

const char* serverEndpoint = "https://blueprint.boo";
const char* wsHost = "blueprint.boo";
const uint16_t wsPort = 443;
const char* wsPath = "/ws";

const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 16 * 3600;
const int daylightOffset_sec = 3600;

const int batteryPin = 34;

const float R1 = 38600.0;
const float R2 = 20870.0;

int count = 0;

float calibrationFactor = 4.138 / 5.605;
const float VREF = 3.278;

#define BOARD_LED 2

// ========== FINGERPRINT HARDWARE ==========
#define RX_GPIO 16
#define TX_GPIO 17
HardwareSerial mySerial(2);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&mySerial);

// ========== NFC HARDWARE ==========
#define PN532_IRQ   -1
#define PN532_RESET -1

Adafruit_PN532 nfc(PN532_IRQ, PN532_RESET);

// ========== SD HARDWARE ==========

#define OFFLINE_LOGS_FILE "/offline_logs.bin"
#define MAX_OFFLINE_LOGS 200

struct OfflineLog {
  int studentID;
  char method[16];
  char date[11];
  char time[9];
};

// ========== GLOBALS ==========
String authToken = "";
String scannerDbId = "";
String mode = "scanner";  // scanner, enroll, nfc
bool WifiConnected = false;
bool fingerprintInitialized = false;
bool nfcInitialized = false;
uint8_t lastLedColor = FINGERPRINT_LED_RED;

//log pending
struct PendingLog {
  int studentID;
  char method[16];
  bool pending;
};
PendingLog pendingLog = {0, "", false};

// Virtual fingerprint mapping: slot -> student ID
#define MAX_FINGERPRINT_SLOTS 127
#define STUDENTS_BIN "/students.bin"
#define FINGERPRINT_LED_GREEN 0x04

unsigned long lastNFCCheck = 0;
const unsigned long NFC_CHECK_INTERVAL = 200; // ms

int students[MAX_FINGERPRINT_SLOTS + 1] = {0};

// ========== FORWARD DECLARATIONS ==========
void loadStudents();
void saveStudents();
int getNextFreeSlot();
void handleStorageFull();
void sendOutput(String msg, int commandId = -1);
void sendHeartbeat();
void handleCommand(String cmd, int commandId);
void sendLog(int studentID, String method);
void getDateTime(String &dateStr, String &timeStr);
bool signIn();
void connectWifi();
void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length);
void initializeFingerprint();
void initializeNFC();
void updateLedStatus();
uint8_t getFingerprintEnroll(int slot, int sID);
int scanFingerprint();
int findStudent(int fingerprintID);
void handleNFCCard();
String readNFCASCII();
void queueOfflineLog(int studentID, String method);
void flushOfflineLogs();


void flashBoardLED(unsigned long durationMs) {
  digitalWrite(BOARD_LED, HIGH);
  delay(durationMs);
  digitalWrite(BOARD_LED, LOW);
}
// ========== FINGERPRINT ==========
void initializeFingerprint() {
  mySerial.begin(57600, SERIAL_8N1, RX_GPIO, TX_GPIO);
  delay(5);
  finger.begin(57600);
  delay(100);
  if (finger.verifyPassword()) {
    Serial.println("✓ Found fingerprint sensor!");
    fingerprintInitialized = true;
    finger.LEDcontrol(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_RED);
    lastLedColor = FINGERPRINT_LED_RED;
  } else {
    Serial.println("✗ Did not find fingerprint sensor :(");
    fingerprintInitialized = false;
  }
}

void updateLedStatus() {
  if (!fingerprintInitialized) return;
  uint8_t newColor = (WiFi.status() == WL_CONNECTED) ? FINGERPRINT_LED_BLUE : FINGERPRINT_LED_RED;
  if (newColor != lastLedColor) {
    finger.LEDcontrol(FINGERPRINT_LED_ON, 0, newColor);
    lastLedColor = newColor;
  }
}

// ========== NFC ==========
void initializeNFC() {
  Wire.begin(33, 32);
  nfc.begin();
  
  uint32_t versiondata = nfc.getFirmwareVersion();
  if (!versiondata) {
    //Serial.println("✗ Did not find PN532 NFC board");
    nfcInitialized = false;
    return;
  }
  if(count == 1) {
    Serial.print("✓ Found PN5");
    nfc.SAMConfig();
    nfcInitialized = true;
    Serial.println("✓ NFC scanner initialized.");
    count = 2;
  }
  else {
    nfc.SAMConfig();
    nfcInitialized = true;
  }
}

String readNFCNDEFText() {
  // Read pages 4-7 (NDEF message area on NTAG21x)
  uint8_t buf[16];
  int idx = 0;
  for (int page = 4; page <= 7; page++) {
    uint8_t pageData[4];
    if (nfc.ntag2xx_ReadPage(page, pageData)) {
      for (int i = 0; i < 4; i++) buf[idx++] = pageData[i];
    } else {
      break;
    }
  }
  // Look for NDEF TLV (type 0x03)
  for (int i = 0; i < idx - 2; i++) {
    if (buf[i] == 0x03) {
      uint8_t msgLen = buf[i + 1];
      int start = i + 2;
      if (start + msgLen > idx) break;  // safety check
      uint8_t* rec = &buf[start];

      uint8_t tnf = rec[0] & 0x07;      // Type Name Format
      bool sr = rec[0] & 0x10;          // Short Record flag
      uint8_t typeLen = rec[1];

      // We expect Well-Known Type (tnf=0x01) and type='T' (text)
      if (tnf == 0x01 && typeLen == 1) {
        // Position of the type field depends on SR flag
        uint8_t type = rec[sr ? 3 : 6];
        if (type == 'T') {
          // Status byte offset
          uint8_t status = rec[(sr ? 4 : 7)];
          uint8_t langLen = status & 0x3F;
          uint32_t payloadLen = sr ? rec[2] : (rec[2] << 24 | rec[3] << 16 | rec[4] << 8 | rec[5]);
          uint8_t* textStart = &rec[(sr ? 4 : 7) + 1 + langLen];
          uint32_t textLen = payloadLen - (1 + langLen);

          String result;
          for (uint32_t j = 0; j < textLen; j++) {
            result += (char)textStart[j];
          }
          return result;
        }
      }
      break;
    }
  }
  return "";  // no valid text record found
}

// ========== LITTLEFS ==========
void loadStudents() {
  File file = LittleFS.open(STUDENTS_BIN, FILE_READ);
  if (file) {
    file.read((uint8_t*)students, sizeof(students));
    file.close();
    Serial.println("[STORAGE] Student map loaded from LittleFS.");
  } else {
    Serial.println("[STORAGE] No student map found, starting fresh.");
    memset(students, 0, sizeof(students));
  }
}

void saveStudents() {
  File file = LittleFS.open(STUDENTS_BIN, FILE_WRITE);
  if (!file) {
    Serial.println("[STORAGE] ERROR: Could not write student map!");
    return;
  }
  file.write((uint8_t*)students, sizeof(students));
  file.close();
  Serial.println("[STORAGE] Student map saved to LittleFS.");
}

int getNextFreeSlot() {
  for (int slot = 1; slot <= MAX_FINGERPRINT_SLOTS; slot++) {
    if (students[slot] == 0) return slot;
  }
  return -1;
}

void handleStorageFull() {
  Serial.println("[STORAGE] No free fingerprint slots!");
  Serial.println("Would you like to delete ALL stored fingerprints? (y/n)");
  while (!Serial.available());
  char response = Serial.read();
  if (response == 'y' || response == 'Y') {
    if (finger.emptyDatabase() == FINGERPRINT_OK) {
      Serial.println("[STORAGE] All fingerprints deleted from sensor.");
      memset(students, 0, sizeof(students));
      saveStudents();
    } else {
      Serial.println("[STORAGE] Failed to delete sensor database.");
    }
  } else {
    Serial.println("[STORAGE] Deletion cancelled.");
  }
}

int findStudent(int fingerprintID) {
  if (fingerprintID < 1 || fingerprintID > MAX_FINGERPRINT_SLOTS) return -1;
  return students[fingerprintID];
}

// ========== FINGERPRINT SCANNING & ENROLLMENT ==========
int scanFingerprint() {
  uint8_t p = finger.getImage();
  if (p != FINGERPRINT_OK) return -1;
  p = finger.image2Tz();
  if (p != FINGERPRINT_OK) return -1;
  p = finger.fingerSearch();
  if (p != FINGERPRINT_OK) return -1;
  return finger.fingerID;
}

// Flush WS send buffer — call after every sendOutput inside blocking loops
static inline void wsFlush() {
  for (int i = 0; i < 10; i++) { webSocket.loop(); delay(10); }
}

uint8_t getFingerprintEnroll(int slot, int sID) {
  int p = -1;

  // ── Step 1: first scan ───────────────────────────────────────────────────
  sendOutput("Place finger on sensor for student " + String(sID) + "...", -1);
  wsFlush();
  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 4000, FINGERPRINT_LED_BLUE);

  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    webSocket.loop();
    if (p == FINGERPRINT_NOFINGER) { continue; }
    if (p != FINGERPRINT_OK) { continue; }
  }

  p = finger.image2Tz(1);
  if (p != FINGERPRINT_OK) {
    sendOutput("First scan failed — try again.", -1);
    wsFlush();
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    delay(3000);
    return p;
  }

  // ── Step 2: lift finger ──────────────────────────────────────────────────
  sendOutput("Good scan. Lift your finger.", -1);
  wsFlush();
  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 4000, FINGERPRINT_LED_GREEN);
  delay(2000);
  while (finger.getImage() != FINGERPRINT_NOFINGER) { webSocket.loop(); }

  // ── Step 3: second scan ──────────────────────────────────────────────────
  p = -1;
  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 10000, FINGERPRINT_LED_BLUE);
  sendOutput("Place the SAME finger again to confirm...", -1);
  wsFlush();

  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    webSocket.loop();
    if (p == FINGERPRINT_NOFINGER) { continue; }
    if (p != FINGERPRINT_OK) { continue; }
  }

  p = finger.image2Tz(2);
  if (p != FINGERPRINT_OK) {
    sendOutput("Second scan failed. Try again.", -1);
    wsFlush();
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    delay(3000);
    return p;
  }

  // ── Step 4: create & store model ────────────────────────────────────────
  p = finger.createModel();
  if (p == FINGERPRINT_ENROLLMISMATCH) {
    sendOutput("Fingerprints did not match — please retry.", -1);
    wsFlush();
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    delay(3000);
    return p;
  }
  if (p != FINGERPRINT_OK) {
    sendOutput("Model creation failed (error " + String(p) + ").", -1);
    wsFlush();
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    delay(3000);
    return p;
  }

  p = finger.storeModel(slot);
  if (p != FINGERPRINT_OK) {
    sendOutput("Failed to store fingerprint (error " + String(p) + ").", -1);
    wsFlush();
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    delay(3000);
    return p;
  }

  students[slot] = sID;
  saveStudents();
  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_GREEN);
  sendOutput("Enrollment complete! Student " + String(sID) + " saved to slot " + String(slot) + ".", -1);
  wsFlush();
  unsigned long start = millis();
  while (millis() - start < 3000) {
    webSocket.loop();
    delay(10);
  }
  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 2000, FINGERPRINT_LED_BLUE);
  return FINGERPRINT_OK;
}

// ========== SERVER COMMUNICATION ==========
bool signIn() {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(10000);
  String url = String(serverEndpoint) + "/api/scanner/auth/login";
  if (!http.begin(client, url)) { http.end(); return false; }
  http.addHeader("Content-Type", "application/json");
  StaticJsonDocument<256> doc;
  doc["SCANNER_ID"] = SCANNER_ID;
  doc["SCANNER_LOCATION"] = SCANNER_LOCATION;
  doc["SCANNER_PASSWORD"] = SCANNER_PASSWORD;
  String body;
  serializeJson(doc, body);
  int code = http.POST(body);
  if (code == 200) {
    String response = http.getString();
    StaticJsonDocument<512> resp;
    deserializeJson(resp, response);
    authToken = resp["token"].as<String>();
    scannerDbId = resp["user"]["id"].as<String>();
    Serial.println("✓ Scanner authenticated.");
    http.end();
    return true;
  }
  Serial.printf("[AUTH] Sign in failed, HTTP %d\n", code);
  http.end();
  return false;
}

void getDateTime(String &dateStr, String &timeStr) {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    Serial.println("[TIME] NTP not synced yet -- using fallback timestamp.");
    dateStr = "0000-00-00";
    timeStr = "00:00:00";
    return;
  }
  char dateBuffer[11];
  char timeBuffer[9];
  strftime(dateBuffer, sizeof(dateBuffer), "%Y-%m-%d", &timeinfo);
  strftime(timeBuffer, sizeof(timeBuffer), "%H:%M:%S", &timeinfo);
  dateStr = String(dateBuffer);
  timeStr = String(timeBuffer);
}

void sendLog(int studentID, String method) {
  if (WiFi.status() != WL_CONNECTED || authToken == "") {
    Serial.println("[LOG] Offline -- queuing log locally.");
    queueOfflineLog(studentID, method);
    // Flash purple twice to show the scan was queued offline
    for (int i = 0; i < 2; i++) {
      finger.LEDcontrol(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_PURPLE);
      delay(200);
      finger.LEDcontrol(FINGERPRINT_LED_OFF, 0, 0);
      delay(150);
    }
    finger.LEDcontrol(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_RED);
    lastLedColor = FINGERPRINT_LED_RED;
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(10000);

  if (!http.begin(client, String(serverEndpoint) + "/api/logs")) {
    Serial.println("[LOG] http.begin failed -- queuing offline.");
    queueOfflineLog(studentID, method);
    http.end();
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + authToken);

  String dateStr, timeStr;
  getDateTime(dateStr, timeStr);

  StaticJsonDocument<256> doc;
  doc["scanner_location"] = SCANNER_LOCATION;
  doc["scanner_id"]       = SCANNER_ID;
  doc["student_id"]       = studentID;
  doc["date_scanned"]     = dateStr;
  doc["time_scanned"]     = timeStr;
  doc["status"]           = "present";
  doc["method"]           = method;

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  if (code != 201) {
    Serial.printf("[LOG] Server returned %d -- queuing offline.\n", code);
    queueOfflineLog(studentID, method);
  }
  http.end();
}

void sendHeartbeat() {
  if (authToken == "" || scannerDbId == "") return;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(10000);
  if (!http.begin(client, String(serverEndpoint) + "/api/scanners/" + scannerDbId + "/heartbeat")) {
    http.end();
    return;
  }
  http.addHeader("Authorization", "Bearer " + authToken);
  int code = http.POST("");
  if (code != 200) {
    authToken = "";
  }
  http.end();
}

void sendOutput(String msg, int commandId) {
  if (!webSocket.isConnected()) {
    return;
  }
  StaticJsonDocument<256> doc;
  doc["type"] = "output";
  doc["scannerId"] = scannerDbId;
  doc["output"] = msg;
  doc["mode"] = mode;
  doc["commandId"] = commandId;
  String body;
  serializeJson(doc, body);
  webSocket.sendTXT(body);
}

// ========== COMMAND HANDLING ==========
void handleCommand(String cmd, int commandId) {

  cmd.trim();

  // ===== MODE =====
  if (cmd.startsWith("set mode ")) {
    String newMode = cmd.substring(9);
    newMode.trim();

    if (newMode == "scanner" || newMode == "enroll") {
      mode = newMode;
      sendOutput("Mode set to " + newMode, commandId);
    } else {
      sendOutput("Invalid mode. Use 'scanner' or 'enroll'.", commandId);
    }
    return;
  }

  // ===== STATUS =====
  if (cmd == "status") {
    String msg = "Status:\n";
    msg += "Mode: " + mode + "\n";
    msg += "WiFi: " + String(WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected") + "\n";
    msg += "IP: " + WiFi.localIP().toString() + "\n";
    msg += "Fingerprint: " + String(fingerprintInitialized ? "OK" : "NOT FOUND") + "\n";
    msg += "NFC: " + String(nfcInitialized ? "OK" : "NOT FOUND") + "\n";
    msg += "Auth: " + String(authToken != "" ? "OK" : "NOT AUTHENTICATED");
    sendOutput(msg, commandId);
    return;
  }

  // ===== PING =====
  if (cmd == "ping") {
    sendOutput("pong", commandId);
    return;
  }

  // ===== WIFI =====
  if (cmd == "wifi info") {
    String msg = "WiFi Info:\n";
    msg += "SSID: " + String(WiFi.SSID()) + "\n";
    msg += "IP: " + WiFi.localIP().toString() + "\n";
    msg += "RSSI: " + String(WiFi.RSSI()) + " dBm";
    sendOutput(msg, commandId);
    return;
  }

  // ===== RESTART =====
  if (cmd == "restart") {
    sendOutput("Restarting device...", commandId);
    delay(500);
    ESP.restart();
  }

  // ===== REAUTH =====
  if (cmd == "reauth") {
    if (signIn()) {
      sendOutput("Re-authentication successful.", commandId);

      if (webSocket.isConnected()) {
        StaticJsonDocument<256> doc;
        doc["type"] = "auth";
        doc["scannerId"] = scannerDbId;
        doc["token"] = authToken;
        String msg;
        serializeJson(doc, msg);
        webSocket.sendTXT(msg);
      }

    } else {
      sendOutput("Re-authentication FAILED.", commandId);
    }
    return;
  }

  // ===== SLOT LIST =====
  if (cmd == "slots list") {
    String msg = "Slots:\n";
    int count = 0;

    for (int i = 1; i <= MAX_FINGERPRINT_SLOTS; i++) {
      if (students[i] != 0) {
        msg += "Slot " + String(i) + " → " + String(students[i]) + "\n";
        count++;
      }
    }

    if (count == 0) msg = "No fingerprints stored.";

    sendOutput(msg, commandId);
    return;
  }

  // ===== SLOT CLEAR ALL =====
  if (cmd == "slots clear all") {
    memset(students, 0, sizeof(students));

    if (finger.emptyDatabase() == FINGERPRINT_OK) {
      saveStudents();
      sendOutput("All slots cleared.", commandId);
    } else {
      sendOutput("Failed to clear sensor.", commandId);
    }
    return;
  }

  // ===== SLOT CLEAR ONE =====
  if (cmd.startsWith("slots clear ")) {
    int slot = cmd.substring(12).toInt();

    if (slot >= 1 && slot <= MAX_FINGERPRINT_SLOTS) {
      if (students[slot] != 0) {
        int oldID = students[slot];
        students[slot] = 0;
        saveStudents();
        sendOutput("Cleared slot " + String(slot) + " (Student " + String(oldID) + ")", commandId);
      } else {
        sendOutput("Slot already empty.", commandId);
      }
    } else {
      sendOutput("Invalid slot number.", commandId);
    }
    return;
  }

  // ===== SLOT GET =====
  if (cmd.startsWith("slots get ")) {
    int slot = cmd.substring(10).toInt();

    if (slot >= 1 && slot <= MAX_FINGERPRINT_SLOTS) {
      if (students[slot] != 0) {
        sendOutput("Slot " + String(slot) + " → Student " + String(students[slot]), commandId);
      } else {
        sendOutput("Slot is empty.", commandId);
      }
    } else {
      sendOutput("Invalid slot.", commandId);
    }
    return;
  }

  // ===== DELETE STUDENT =====
  if (cmd.startsWith("student delete ")) {
    int studentID = cmd.substring(15).toInt();
    bool found = false;

    for (int i = 1; i <= MAX_FINGERPRINT_SLOTS; i++) {
      if (students[i] == studentID) {
        students[i] = 0;
        saveStudents();
        sendOutput("Deleted student " + String(studentID) + " from slot " + String(i), commandId);
        found = true;
        break;
      }
    }

    if (!found) sendOutput("Student not found.", commandId);
    return;
  }

  // ===== TEST =====
  if (cmd == "test scan") {
    sendOutput("Testing fingerprint...", commandId);

    int fingerID = scanFingerprint();
    if (fingerID >= 0) {
      sendOutput("Fingerprint detected! ID: " + String(fingerID), commandId);
    } else {
      sendOutput("No fingerprint detected.", commandId);
    }

    sendOutput("Tap NFC card...", commandId);
    return;
  }

  // ===== NUMERIC =====
  bool isNumeric = true;
  for (unsigned int i = 0; i < cmd.length(); i++) {
    if (!isdigit(cmd[i])) { isNumeric = false; break; }
  }

  if (isNumeric) {
    int studentID = cmd.toInt();

    if (mode == "enroll") {
      int slot = getNextFreeSlot();

      if (slot == -1) {
        handleStorageFull();
        sendOutput("No free slots.", commandId);
        return;
      }

      // Send this BEFORE entering the blocking enrollment function so it
      // goes out while the WS library is still in a clean state.
      sendOutput("Starting enrollment for student " + String(studentID) + "...", commandId);
      wsFlush();

      uint8_t result = getFingerprintEnroll(slot, studentID);

      if (result == FINGERPRINT_OK) {
        sendOutput("Enrollment successful (slot " + String(slot) + ")", commandId);
      } else {
        sendOutput("Enrollment failed.", commandId);
      }

    } else {
      sendLog(studentID, "manual");
      sendOutput("Manual log for student " + String(studentID), commandId);
    }

    return;
  }

  // ===== UNKNOWN =====
  sendOutput("Unknown command: " + cmd, commandId);
}

// ========== WEBSOCKET EVENT HANDLER ==========
void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      Serial.println("WebSocket connected.");
      StaticJsonDocument<256> doc;
      doc["type"] = "auth";
      doc["scannerId"] = scannerDbId;
      doc["token"] = authToken;
      String msg;
      serializeJson(doc, msg);
      webSocket.sendTXT(msg);
      break;
    }
    case WStype_DISCONNECTED:
      Serial.println("WebSocket disconnected.");
      mode = "scanner";
      break;
    case WStype_TEXT: {
      String data = (char*)payload;
      StaticJsonDocument<256> doc;
      DeserializationError err = deserializeJson(doc, data);
      if (err) { break; }
      String command = doc["command"] | "";
      int commandId = doc["commandId"] | 0;
      if (command != "") handleCommand(command, commandId);
      break;
    }
    case WStype_ERROR:
      Serial.println("WebSocket error.");
      break;
    default:
      break;
  }
}

// ========== WIFI ==========
void connectWifi() {
  Serial.printf("[WIFI] Starting connection attempt to %s\n", ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  WifiConnected = false;
  // No waiting — just fires off the connection and returns immediately.
  // WiFi.status() will become WL_CONNECTED on its own in the background.
}

// ========== Offline Logging ==========

void queueOfflineLog(int studentID, String method) {
  String dateStr, timeStr;
  getDateTime(dateStr, timeStr);

  OfflineLog entry;
  entry.studentID = studentID;
  strncpy(entry.method, method.c_str(), sizeof(entry.method) - 1);
  entry.method[sizeof(entry.method) - 1] = '\0';
  strncpy(entry.date, dateStr.c_str(), sizeof(entry.date) - 1);
  entry.date[sizeof(entry.date) - 1] = '\0';
  strncpy(entry.time, timeStr.c_str(), sizeof(entry.time) - 1);
  entry.time[sizeof(entry.time) - 1] = '\0';

  int count = 0;
  File rf = LittleFS.open(OFFLINE_LOGS_FILE, FILE_READ);
  if (rf) {
    count = rf.size() / sizeof(OfflineLog);
    rf.close();
  }

  if (count >= MAX_OFFLINE_LOGS) {
    Serial.println("[OFFLINE] Queue full -- dropping oldest log.");
    OfflineLog* buf = (OfflineLog*)malloc(sizeof(OfflineLog) * MAX_OFFLINE_LOGS);
    if (!buf) { Serial.println("[OFFLINE] malloc failed."); return; }
    File r2 = LittleFS.open(OFFLINE_LOGS_FILE, FILE_READ);
    if (r2) { r2.read((uint8_t*)buf, sizeof(OfflineLog) * MAX_OFFLINE_LOGS); r2.close(); }
    File w2 = LittleFS.open(OFFLINE_LOGS_FILE, FILE_WRITE);
    if (w2) {
      w2.write((uint8_t*)&buf[1], sizeof(OfflineLog) * (MAX_OFFLINE_LOGS - 1));
      w2.write((uint8_t*)&entry, sizeof(OfflineLog));
      w2.close();
    }
    free(buf);
    return;
  }

  File f = LittleFS.open(OFFLINE_LOGS_FILE, FILE_APPEND);
  if (!f) { Serial.println("[OFFLINE] ERROR: Could not open offline log file."); return; }
  f.write((uint8_t*)&entry, sizeof(OfflineLog));
  f.close();
  Serial.printf("[OFFLINE] Queued log: student=%d method=%s date=%s time=%s\n",
                studentID, method.c_str(), dateStr.c_str(), timeStr.c_str());
}

void flushOfflineLogs() {
  if (!LittleFS.exists(OFFLINE_LOGS_FILE)) return;

  File f = LittleFS.open(OFFLINE_LOGS_FILE, FILE_READ);
  if (!f) return;

  int count = f.size() / sizeof(OfflineLog);
  if (count == 0) { f.close(); return; }

  Serial.printf("[OFFLINE] Flushing %d queued log(s) to server...\n", count);
  sendOutput("Flushing " + String(count) + " offline log(s)...", -1);

  int sent = 0, failed = 0;

  for (int i = 0; i < count; i++) {
    OfflineLog entry;
    f.read((uint8_t*)&entry, sizeof(OfflineLog));

    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    http.setTimeout(10000);

    if (!http.begin(client, String(serverEndpoint) + "/api/logs")) {
      failed++; http.end(); continue;
    }

    http.addHeader("Content-Type", "application/json");
    http.addHeader("Authorization", "Bearer " + authToken);

    StaticJsonDocument<256> doc;
    doc["scanner_location"] = SCANNER_LOCATION;
    doc["scanner_id"]       = SCANNER_ID;
    doc["student_id"]       = entry.studentID;
    doc["date_scanned"]     = entry.date;
    doc["time_scanned"]     = entry.time;
    doc["status"]           = "present";
    doc["method"]           = entry.method;

    String body;
    serializeJson(doc, body);

    int code = http.POST(body);
    if (code == 201) { sent++; }
    else {
      Serial.printf("[OFFLINE] Failed for student %d (HTTP %d)\n", entry.studentID, code);
      failed++;
    }
    http.end();
    webSocket.loop();
  }

  f.close();

  if (failed == 0) {
    LittleFS.remove(OFFLINE_LOGS_FILE);
    Serial.println("[OFFLINE] All queued logs sent. File cleared.");
    sendOutput("All offline logs flushed successfully.", -1);
  } else {
    Serial.printf("[OFFLINE] %d sent, %d failed -- will retry on next reconnect.\n", sent, failed);
    sendOutput(String(sent) + " sent, " + String(failed) + " failed -- will retry.", -1);
  }
}

int readStableADC() {
  int sum = 0;
  for (int i = 0; i < 30; i++) {
    sum += analogRead(batteryPin);
    delayMicroseconds(500);
  }
  return sum / 30;
}

// ========== SETUP ==========
void setup() {
  Serial.begin(115200);
  count = 1;
  analogReadResolution(12);
  analogSetPinAttenuation(batteryPin, ADC_11db);
  
  for(int i = 0; i < 10; i++) {
    analogRead(batteryPin);  // Prime the ADC
  }
  delay(1000);

  Serial.println("\n========== BLUEPRINT SCANNER STARTUP ==========");
  
  Serial.println("\n[INIT] Initializing fingerprint sensor...");
  initializeFingerprint();
  
  Serial.println("[INIT] Initializing NFC scanner...");
  initializeNFC();

  if (!LittleFS.begin(true)) {
    Serial.println("[ERROR] LittleFS mount failed!");
    while (1) delay(1);
  }
  loadStudents();

  Serial.println("[INIT] Connecting to WiFi...");
  connectWifi();

  Serial.println("[INIT] Syncing time with NTP (non-blocking)...");
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  // Don't wait -- NTP will sync in the background.
  // getDateTime() already returns "0000-00-00" / "00:00:00" if time isn't ready,
  // so offline logs queued before sync will just have fallback timestamps.

  Serial.println("[INIT] Auth and flush will happen once WiFi connects.");
}

// ========== LOOP ========== 
void loop() {
    webSocket.loop();

    initializeNFC();

    if (mode == "scanner" && millis() - lastNFCCheck >= NFC_CHECK_INTERVAL) {
        lastNFCCheck = millis();
        handleNFCCardNonBlocking();
    }

    static unsigned long lastWifiRetry = 0;
    static bool wifiJustConnected = false;

    if (WiFi.status() == WL_CONNECTED && !WifiConnected) {
        WifiConnected = true;
        wifiJustConnected = true;
        Serial.println("[WIFI] Connected. IP: " + WiFi.localIP().toString());
        updateLedStatus();
    } else if (WiFi.status() != WL_CONNECTED && WifiConnected) {
        WifiConnected = false;
        updateLedStatus();
    } else if (WiFi.status() != WL_CONNECTED && !WifiConnected) {
        if (millis() - lastWifiRetry > 300000) {
            lastWifiRetry = millis();
            Serial.println("[WIFI] Attempting reconnect...");
            connectWifi();
        }
    }

    if (wifiJustConnected) {
        wifiJustConnected = false;
        if (signIn()) {
            flushOfflineLogs();
        }
        webSocket.beginSSL(wsHost, wsPort, wsPath);
        webSocket.onEvent(onWebSocketEvent);
        webSocket.setReconnectInterval(5000);
    }

    updateLedStatus();

    if (fingerprintInitialized && (mode == "scanner" || mode == "enroll")) {
        int fingerID = scanFingerprint();
        if (fingerID >= 0) {
            int studentID = findStudent(fingerID);
            if (studentID != 0) {
                finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 2000, FINGERPRINT_LED_GREEN);
                if (mode == "scanner") {
                    // Queue the log, don't block here
                    pendingLog.studentID = studentID;
                    strncpy(pendingLog.method, "fingerprint", sizeof(pendingLog.method) - 1);
                    pendingLog.pending = true;
                    unsigned long start = millis();
                    while (millis() - start < 1000) {
                      webSocket.loop();
                      delay(10);
                    };
                    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 2000, FINGERPRINT_LED_BLUE);
                    sendOutput("Fingerprint Match - Logged attendance for Student " + String(studentID), -1);
                }
                unsigned long start = millis();
                while (millis() - start < 3000) {
                  webSocket.loop();
                  delay(10);
                };
            }
        }
    }

    // Process pending log separately so it doesn't block scanning
    if (pendingLog.pending) {
        pendingLog.pending = false;
        sendLog(pendingLog.studentID, String(pendingLog.method));
    }

    static unsigned long lastHeartbeat = 0;
    if (millis() - lastHeartbeat > 5000) {
        sendHeartbeat();
        lastHeartbeat = millis();
    }

    if(!nfcInitialized) {
      flashBoardLED(2000);
    }

  int raw = analogRead(batteryPin);
  float voltageAtPin = (raw / 4095.0) * VREF;
  float batteryVoltage = voltageAtPin * ((R1 + R2)/R2) * calibrationFactor;
  delay(10);
}

bool writeNFCText(String text) {
    // Build NDEF text record
    uint8_t textLen = text.length();
    uint8_t payloadLen = 3 + textLen; // status byte + "en" lang + text
    uint8_t msgLen = 3 + payloadLen;  // record header + payload

    // Full NDEF message buffer (pages 4-7 = 16 bytes)
    uint8_t buf[16] = {0};
    int i = 0;
    buf[i++] = 0x03;        // NDEF TLV type
    buf[i++] = msgLen;      // message length
    buf[i++] = 0xD1;        // MB ME SR=1, TNF=0x01 (Well Known)
    buf[i++] = 0x01;        // type length = 1
    buf[i++] = payloadLen;  // payload length
    buf[i++] = 'T';         // type = Text
    buf[i++] = 0x02;        // status: UTF-8, lang length = 2
    buf[i++] = 'e';         // lang: "en"
    buf[i++] = 'n';
    for (int j = 0; j < textLen && i < 15; j++) {
        buf[i++] = text[j];
    }
    buf[i] = 0xFE;          // TLV terminator

    // Write 4 bytes per page starting at page 4
    for (int page = 4; page <= 7; page++) {
        uint8_t pageData[4];
        memcpy(pageData, &buf[(page - 4) * 4], 4);
        if (!nfc.ntag2xx_WritePage(page, pageData)) {
            Serial.println("[NFC] Write failed on page " + String(page));
            return false;
        }
    }
    Serial.println("[NFC] Wrote \"" + text + "\" to tag.");
    return true;
}

void handleNFCCardNonBlocking() {
    uint8_t uid[7];
    uint8_t uidLength;
    // Very short timeout (20 ms) – just polls, never blocks the loop
    bool success = nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 100);
    if (success) {
        if (uidLength == 7) {   // NTAG21x series
            String nfcText = readNFCNDEFText();   // your existing function
            if (nfcText.length() > 0) {
                nfcText.trim();
                bool isNumeric = true;
                for (unsigned int i = 0; i < nfcText.length(); i++) {
                  if (!isdigit(nfcText[i])) { isNumeric = false; break; }
                }
                if (isNumeric && nfcText.length() > 0) {
                  int studentID = nfcText.toInt();
                  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 2000, FINGERPRINT_LED_GREEN);
                  delay(500);
                  writeNFCText("Successfully emptied NFC Payload!");
                  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 2000, FINGERPRINT_LED_BLUE);
                  if(!fingerprintInitialized) {
                    flashBoardLED(1000);
                  }
                  sendLog(studentID, "NFC");
                  sendOutput("NFC Scan - Logged attendance for Student " + String(studentID), -1);
                  
                } else {
                  sendOutput("NFC Scan - Text on tag is not a numeric student ID: " + nfcText, -1);
                }
            } else {
              //sendOutput("NFC Scan - No valid NDEF text record found on tag.", -1);
            }
        }
        // Optional: add a short delay to avoid reading the same card repeatedly

        unsigned long start = millis();
      while (millis() - start < 500) {
        webSocket.loop();
        delay(10);
      }  // prevents multiple logs for one tap
    }
}