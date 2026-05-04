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

#define FINGERPRINT_LED_YELLOW 0x05
#define FINGERPRINT_LED_CYAN 0x06
#define FINGERPRINT_LED_WHITE 0x07

// ========== CONFIGURATION ==========
//const char ssid[] = "NETGEAR54TP-Link_003Ext";
//const char password[] = "PIN12205486";
//const char ssid[] = "NETGEAR54";
//const char password[] = "silentbird445";
const char ssid[] = "BraveWeb";
const char password[] = "Br@veW3b";

WebSocketsClient webSocket;

const char* SCANNER_ID = "1";
const char* SCANNER_LOCATION = "304";
const char* SCANNER_PASSWORD = "BluePrint";

const char* serverEndpoint = "https://blueprint.boo";
const char* wsHost = "blueprint.boo";
const uint16_t wsPort = 443;
const char* wsPath = "/ws";

const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = -8 * 3600;
const int daylightOffset_sec = 3600;

const int batteryPin = 34;

const float R1 = 38600.0;
const float R2 = 20870.0;

int count = 0;

float calibrationFactor = 4.138 / 5.605;
const float VREF = 3.378;

// ========== LED STATE MACHINE ==========
enum LedState {
  LED_DISCONNECTED_WIFI,       // RED Solid (no WiFi) - 2 sec
  LED_DISCONNECTED_WS,         // WHITE Solid (WiFi but no WS) - 2 sec
  LED_SCANNER_CONNECTED,       // BLUE Breathing (WiFi+WS, Scanner mode) - 10 sec
  LED_SCANNER_OFFLINE,         // CYAN Breathing (No WiFi, Scanner mode) - 10 sec
  LED_ENROLL_CONNECTED,        // YELLOW Breathing (WiFi+WS, Enroll mode) - 10 sec
  LED_ENROLL_OFFLINE,          // YELLOW Breathing (No WiFi, Enroll mode) - 10 sec
  LED_SUCCESS                  // GREEN Breathing (override) - 1 sec
};

// ========== LED PHASE TIMING ==========
const unsigned long LED_ERROR_DURATION = 2000;    // 2 seconds for RED/WHITE error states
const unsigned long LED_MODE_DURATION = 10000;    // 10 seconds for mode breathing states
const unsigned long LED_SUCCESS_DURATION = 250;  // 1 second for green success

enum LedPhase {
  PHASE_CHECK_ERROR,    // Check for WiFi/WS errors (show RED or WHITE if needed)
  PHASE_SHOW_MODE,      // Show mode-based LED (BLUE/YELLOW/CYAN breathing)
  PHASE_SUCCESS         // Show GREEN success (when overridden)
};

// ========== LED MANAGEMENT GLOBALS ==========
LedState currentLedState = LED_DISCONNECTED_WIFI;
LedPhase currentPhase = PHASE_CHECK_ERROR;
unsigned long phaseStartTime = 0;
bool successOverrideActive = false;
unsigned long successOverrideUntil = 0;

bool websocketConnected = false;

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
  int  studentID;
  char method[16];
  char date[11];
  char time[9];
  char encryptedData[256];
  char iv[64];
  char authTag[64];
  char nfcDate[11];
};

#define BUTTON_PIN 25
unsigned long buttonPressStart = 0;
bool buttonLastState = HIGH;
bool buttonPressed = false;

const unsigned long SHORT_PRESS_TIME = 50;     // debounce threshold
const unsigned long LONG_PRESS_TIME  = 1500;   // 1.5 seconds

// ========== GLOBALS ==========
String authToken = "";
String scannerDbId = "";
String mode = "scanner";  // scanner, enroll, nfc
bool WifiConnected = false;
bool fingerprintInitialized = false;
bool nfcInitialized = false;

// ========== ENROLLMENT CONTROL ==========
bool enrollmentActive = false;
bool enrollmentCancelled = false;
int enrollmentStudentID = 0;

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

// ========== LED CONTROL FUNCTIONS ==========
void setLedColor(LedState state) {
  if (!fingerprintInitialized) return;

  uint8_t color = FINGERPRINT_LED_RED;
  uint8_t mode = FINGERPRINT_LED_BREATHING;
  uint16_t speed = 3000;
  
  switch (state) {
    // ERROR STATES (Solid)
    case LED_DISCONNECTED_WIFI:
      color = FINGERPRINT_LED_RED;
      mode = FINGERPRINT_LED_ON;
      finger.LEDcontrol(mode, 0, color);
      break;
      
    case LED_DISCONNECTED_WS:
      color = FINGERPRINT_LED_WHITE;
      mode = FINGERPRINT_LED_ON;
      finger.LEDcontrol(mode, 0, color);
      break;
    
    // MODE STATES (Breathing)
    case LED_SCANNER_CONNECTED:
      color = FINGERPRINT_LED_BLUE;
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 3000, color);
      break;
      
    case LED_SCANNER_OFFLINE:
      color = FINGERPRINT_LED_CYAN;
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 1500, color);
      break;
      
    case LED_ENROLL_CONNECTED:
      color = FINGERPRINT_LED_YELLOW;
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 3000, color);
      break;
    
    case LED_SUCCESS:
      color = FINGERPRINT_LED_GREEN;
      mode = FINGERPRINT_LED_ON;
      finger.LEDcontrol(mode, 0, color);
      break;
      
    default:
      color = FINGERPRINT_LED_RED;
      finger.LEDcontrol(FINGERPRINT_LED_ON, 0, color);
      break;
  }
}

void setLedSuccess() {
  if (!fingerprintInitialized) return;
  successOverrideActive = true;
  successOverrideUntil = millis() + LED_SUCCESS_DURATION;
  currentLedState = LED_SUCCESS;
  currentPhase = PHASE_SUCCESS;
  setLedColor(LED_SUCCESS);
}

LedState getDesiredModeState() {
  // Determine which LED state based on WiFi/WS connectivity and mode
  if (WifiConnected && websocketConnected) {
    // Both connected: use bright, steady colors
    if (mode == "enroll") {
      return LED_ENROLL_CONNECTED;
    } else {
      return LED_SCANNER_CONNECTED;
    }
  } else if (WifiConnected && !websocketConnected) {
    // WiFi only (WS error): will be handled by PHASE_CHECK_ERROR
    return LED_DISCONNECTED_WS;
  } else {
    // No WiFi: use offline colors
    if (mode == "enroll") {
      return LED_ENROLL_OFFLINE;
    } else {
      return LED_SCANNER_OFFLINE;
    }
  }
}

void updateLedStatus() {
  if (!fingerprintInitialized) return;

  unsigned long now = millis();

  // ========== HANDLE SUCCESS OVERRIDE ==========
  if (successOverrideActive) {
    if (now >= successOverrideUntil) {
      // Success period over, return to normal cycle
      successOverrideActive = false;
      currentPhase = PHASE_CHECK_ERROR;
      phaseStartTime = now;
    }
    // Continue showing green breathing
    return;
  }

  // ========== PHASE MACHINE ==========
  
  if (currentPhase == PHASE_CHECK_ERROR) {
    // Check for WiFi or WebSocket errors
    if (!WifiConnected) {
      // No WiFi: show RED solid for 2 seconds
      if (currentLedState != LED_DISCONNECTED_WIFI) {
        currentLedState = LED_DISCONNECTED_WIFI;
        setLedColor(LED_DISCONNECTED_WIFI);
        phaseStartTime = now;
      }
      
      if (now - phaseStartTime >= LED_ERROR_DURATION) {
        // Error time over, move to mode phase
        currentPhase = PHASE_SHOW_MODE;
        phaseStartTime = now;
      }
    } 
    else if (WifiConnected && !websocketConnected) {
      // WiFi connected but WebSocket down: show WHITE solid for 2 seconds
      if (currentLedState != LED_DISCONNECTED_WS) {
        currentLedState = LED_DISCONNECTED_WS;
        setLedColor(LED_DISCONNECTED_WS);
        phaseStartTime = now;
      }
      
      if (now - phaseStartTime >= LED_ERROR_DURATION) {
        // Error time over, move to mode phase
        currentPhase = PHASE_SHOW_MODE;
        phaseStartTime = now;
      }
    } 
    else if (WifiConnected && websocketConnected) {
      // No errors, skip error phase and go straight to mode
      currentPhase = PHASE_SHOW_MODE;
      phaseStartTime = now;
    }
  }
  
  else if (currentPhase == PHASE_SHOW_MODE) {
    // Show mode-based LED (breathing)
    LedState desiredMode = getDesiredModeState();
    
    if (currentLedState != desiredMode) {
      currentLedState = desiredMode;
      setLedColor(desiredMode);
      phaseStartTime = now;
    }
    
    if (now - phaseStartTime >= LED_MODE_DURATION) {
      // Mode time over, return to error checking
      currentPhase = PHASE_CHECK_ERROR;
      phaseStartTime = now;
    }
  }
}

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
uint8_t getFingerprintEnroll(int slot, int sID);
int scanFingerprint();
int findStudent(int fingerprintID);
void handleNFCCardNonBlocking();
String readNFCNDEFText();
void queueOfflineLog(int studentID, String method);
void flushOfflineLogs();
void updateLedStatus();
int parseEnrollStudentID(String tagText);


// ========== FINGERPRINT ==========
void initializeFingerprint() {
  mySerial.begin(57600, SERIAL_8N1, RX_GPIO, TX_GPIO);
  delay(5);
  finger.begin(57600);
  delay(100);
  if (finger.verifyPassword()) {
    Serial.println("✓ Found fingerprint sensor!");
    fingerprintInitialized = true;
    currentPhase = PHASE_CHECK_ERROR;
    phaseStartTime = millis();
  } else {
    Serial.println("✗ Did not find fingerprint sensor :(");
    fingerprintInitialized = false;
  }
}

void handleButton() {
  bool currentState = digitalRead(BUTTON_PIN);

  // Button pressed (falling edge)
  if (buttonLastState == HIGH && currentState == LOW) {
    buttonPressStart = millis();
    buttonPressed = true;
  }

  // Button released (rising edge)
  if (buttonLastState == LOW && currentState == HIGH && buttonPressed) {
    unsigned long pressDuration = millis() - buttonPressStart;
    buttonPressed = false;

    // ---- SHORT PRESS ----
    if (pressDuration > SHORT_PRESS_TIME && pressDuration < LONG_PRESS_TIME) {
      // Cancel enrollment if active
      if (enrollmentActive) {
        enrollmentCancelled = true;
        sendOutput("Enrollment cancelled (button).", -1);
        return;
      }
      
      // Toggle mode – LED will be updated automatically by the state machine
      if (mode == "scanner") {
        mode = "enroll";
        sendOutput("Mode set to enroll (button)", -1);
      } else {
        mode = "scanner";
        sendOutput("Mode set to scanner (button)", -1);
      }
    }

    // ---- LONG PRESS ----
    else if (pressDuration >= LONG_PRESS_TIME) {
      sendOutput("Manual reconnect + reauth...", -1);
      connectWifi();
      if (signIn()) {
        flushOfflineLogs();
      }
    }
  }

  buttonLastState = currentState;
}

// ========== NFC ==========
void initializeNFC() {
  Wire.begin(21, 22);
  nfc.begin();
  
  uint32_t versiondata = nfc.getFirmwareVersion();
  if (!versiondata) {
    Serial.println("✗ Did not find PN532 NFC board");
    nfcInitialized = false;
    return;
  }
  
  Serial.print("✓ Found PN5");
  
  nfc.SAMConfig();
  nfcInitialized = true;
  Serial.println("✓ NFC scanner initialized.");
}

String readNFCNDEFText() {
  // Read pages 4-7 (NDEF message area on NTAG21x)
  uint8_t buf[96];
  int idx = 0;
  for (int page = 4; page <= 27; page++) {
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
  enrollmentActive = true;
  enrollmentCancelled = false;
  enrollmentStudentID = sID;

  // ── Step 1: first scan ───────────────────────────────────────────────────
  sendOutput("Place finger on sensor for student " + String(sID) + "...", -1);
  sendOutput("Type 'cancel' to abort enrollment.", -1);
  wsFlush();

  while (p != FINGERPRINT_OK) {
    webSocket.loop();
    updateLedStatus();
    
    // Check for cancellation
    if (enrollmentCancelled) {
      enrollmentActive = false;
      sendOutput("Enrollment cancelled.", -1);
      return 0xFF;
    }

    p = finger.getImage();
    webSocket.loop();
    if (p == FINGERPRINT_NOFINGER) { continue; }
    if (p != FINGERPRINT_OK) { continue; }
  }

  p = finger.image2Tz(1);
  if (p != FINGERPRINT_OK) {
    sendOutput("First scan failed — try again.", -1);
    wsFlush();
    delay(3000);
    enrollmentActive = false;
    return p;
  }

  // ── Step 2: lift finger ──────────────────────────────────────────────────
  sendOutput("Good scan. Lift your finger.", -1);
  setLedSuccess();
  wsFlush();
  delay(1000);
  
  while (finger.getImage() != FINGERPRINT_NOFINGER) {
    updateLedStatus();
    webSocket.loop();
  }

  // ── Step 3: second scan ──────────────────────────────────────────────────
  p = -1;
  sendOutput("Place the SAME finger again to confirm...", -1);
  wsFlush();

  while (p != FINGERPRINT_OK) {
    updateLedStatus();
    webSocket.loop();
    
    if (enrollmentCancelled) {
      enrollmentActive = false;
      sendOutput("Enrollment cancelled.", -1);
      return 0xFF;
    }

    p = finger.getImage();
    webSocket.loop();
    if (p == FINGERPRINT_NOFINGER) { continue; }
    if (p != FINGERPRINT_OK) { continue; }
  }

  p = finger.image2Tz(2);
  if (p != FINGERPRINT_OK) {
    sendOutput("Second scan failed. Try again.", -1);
    wsFlush();
    delay(3000);
    enrollmentActive = false;
    return p;
  }

  // ── Step 4: create & store model ────────────────────────────────────────
  p = finger.createModel();
  if (p == FINGERPRINT_ENROLLMISMATCH) {
    sendOutput("Fingerprints did not match — please retry.", -1);
    wsFlush();
    delay(3000);
    enrollmentActive = false;
    return p;
  }
  if (p != FINGERPRINT_OK) {
    sendOutput("Model creation failed (error " + String(p) + ").", -1);
    wsFlush();
    delay(3000);
    enrollmentActive = false;
    return p;
  }

  p = finger.storeModel(slot);
  if (p != FINGERPRINT_OK) {
    sendOutput("Failed to store fingerprint (error " + String(p) + ").", -1);
    wsFlush();
    delay(3000);
    enrollmentActive = false;
    return p;
  }

  students[slot] = sID;
  saveStudents();
  sendOutput("✓ Enrollment complete! Student " + String(sID) + " saved to slot " + String(slot) + ".", -1);
  setLedSuccess();
  delay(500);
  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 0, FINGERPRINT_LED_YELLOW);
  delay(500);
  setLedSuccess();
  wsFlush();
  
  enrollmentActive = false;
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
  if (!getLocalTime(&timeinfo, 0)) {
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
    queueOfflineLog(studentID, method);
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(5000);

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
  doc["status"]           = "null";
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
  if (WiFi.status() != WL_CONNECTED || authToken == "" || scannerDbId == "") return;

  // Read battery
  int raw = analogRead(batteryPin);
  float voltageAtPin = (raw / 4095.0) * VREF;
  float batteryVoltage = voltageAtPin * ((R1 + R2)/R2) * calibrationFactor;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(10000);

  if (!http.begin(client, String(serverEndpoint) + "/api/scanners/" + scannerDbId + "/heartbeat")) {
    http.end();
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + authToken);

  StaticJsonDocument<128> doc;
  doc["battery_level"] = batteryVoltage;

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  if (code != 200) {
    authToken = "";
  }
  /*if (code == 401) {
    Serial.println("[HEARTBEAT] 401 Unauthorized — clearing token, will reauth.");
    authToken = "";
  } else if (code != 200) {
    Serial.printf("[HEARTBEAT] Non-200 response (%d) — keeping token.\n", code);
  }*/

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
  Serial.printf("[CMD] Processing: '%s' (ID: %d)\n", cmd.c_str(), commandId);

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

  // ===== CANCEL ENROLLMENT =====
  if (cmd == "cancel") {
    if (enrollmentActive) {
      enrollmentCancelled = true;
      Serial.println("[CMD] Cancel flag set.");
    } else {
      sendOutput("No active enrollment to cancel.", commandId);
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
      websocketConnected = true;
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
      websocketConnected = false;
      webSocket.disconnect();
      delay(100);
      
      // Only reconnect if WiFi is active
      if (WifiConnected) {
        Serial.println("[WS] WiFi connected, attempting WebSocket reconnect...");
        webSocket.beginSSL(wsHost, wsPort, wsPath);
        webSocket.onEvent(onWebSocketEvent);
        webSocket.setReconnectInterval(5000);
      } else {
        Serial.println("[WS] WiFi not ready yet, will reconnect when WiFi available.");
      }
      break;
    case WStype_TEXT: {
      String data = (char*)payload;
      Serial.printf("[WS] Raw payload: %s\n", data.c_str());
      
      StaticJsonDocument<256> doc;
      DeserializationError err = deserializeJson(doc, data);
      
      if (err) {
        Serial.printf("[WS] JSON parse error: %s\n", err.c_str());
        break;
      }
      
      String command = doc["command"] | "";
      int commandId = doc["commandId"] | 0;
      
      Serial.printf("[WS] Parsed command: '%s' (ID: %d)\n", command.c_str(), commandId);
      
      if (command != "") {
        Serial.println("[WS] Calling handleCommand...");
        handleCommand(command, commandId);
      } else {
        Serial.println("[WS] Command was empty!");
      }
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

void queueOfflineNFCLog(String encryptedData, String iv, String authTag, String nfcDate,
                        String dateScanned, String timeScanned) {
  OfflineLog entry;
  memset(&entry, 0, sizeof(entry));
  entry.studentID = -1;
  strncpy(entry.method,        "nfc",               sizeof(entry.method) - 1);
  strncpy(entry.date,          dateScanned.c_str(),  sizeof(entry.date) - 1);
  strncpy(entry.time,          timeScanned.c_str(),  sizeof(entry.time) - 1);
  strncpy(entry.encryptedData, encryptedData.c_str(), sizeof(entry.encryptedData) - 1);
  strncpy(entry.iv,            iv.c_str(),            sizeof(entry.iv) - 1);
  strncpy(entry.authTag,       authTag.c_str(),        sizeof(entry.authTag) - 1);
  strncpy(entry.nfcDate,       nfcDate.c_str(),        sizeof(entry.nfcDate) - 1);

  // same append logic as queueOfflineLog — copy that block here
  int count = 0;
  File rf = LittleFS.open(OFFLINE_LOGS_FILE, FILE_READ);
  if (rf) { count = rf.size() / sizeof(OfflineLog); rf.close(); }

  if (count >= MAX_OFFLINE_LOGS) {
    OfflineLog* buf = (OfflineLog*)malloc(sizeof(OfflineLog) * MAX_OFFLINE_LOGS);
    if (!buf) return;
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
  if (!f) return;
  f.write((uint8_t*)&entry, sizeof(OfflineLog));
  f.close();
  Serial.println("[OFFLINE] Queued NFC log (encrypted).");
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

    bool isNFC = (strcmp(entry.method, "nfc") == 0);
    String endpoint = isNFC
    ? String(serverEndpoint) + "/api/scanner/log"
    : String(serverEndpoint) + "/api/logs";

    if (!http.begin(client, endpoint)) { failed++; http.end(); continue; }

    http.addHeader("Content-Type", "application/json");
    http.addHeader("Authorization", "Bearer " + authToken);

    String body;
    if (isNFC) {
      StaticJsonDocument<512> doc;
      doc["encryptedData"]    = entry.encryptedData;
      doc["iv"]               = entry.iv;
      doc["authTag"]          = entry.authTag;
      doc["date"]             = entry.nfcDate;
      doc["scanner_location"] = SCANNER_LOCATION;
      doc["scanner_id"]       = SCANNER_ID;
      doc["date_scanned"]     = entry.date;
      doc["time_scanned"]     = entry.time;
      serializeJson(doc, body);
    } else {
      StaticJsonDocument<256> doc;
      doc["scanner_location"] = SCANNER_LOCATION;
      doc["scanner_id"]       = SCANNER_ID;
      doc["student_id"]       = entry.studentID;
      doc["date_scanned"]     = entry.date;
      doc["time_scanned"]     = entry.time;
      doc["status"]           = "null";
      doc["method"]           = entry.method;
      serializeJson(doc, body);
    }

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

// ========== SETUP ==========
void setup() {
  Serial.begin(115200);
  delay(1000);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

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
}

// ========== LOOP ========== 
void loop() {
  // ========== WEBSOCKET & NETWORK MANAGEMENT ==========
  webSocket.loop();

  // ========== WiFi Status Management ==========
  static unsigned long lastWifiRetry = 0;
  static bool wifiJustConnected = false;

  if (WiFi.status() == WL_CONNECTED && !WifiConnected) {
    WifiConnected = true;
    wifiJustConnected = true;
    Serial.println("[WIFI] Connected. IP: " + WiFi.localIP().toString());
  } else if (WiFi.status() != WL_CONNECTED && WifiConnected) {
    WifiConnected = false;
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

  static unsigned long lastReauthAttempt = 0;
  if (WifiConnected && authToken == "" && (millis() - lastReauthAttempt > 15000)) {
    lastReauthAttempt = millis();
    Serial.println("[AUTH] Token missing — attempting automatic re-auth...");
    if (signIn()) {
      flushOfflineLogs();
      if (webSocket.isConnected()) {
        StaticJsonDocument<256> doc;
        doc["type"] = "auth";
        doc["scannerId"] = scannerDbId;
        doc["token"] = authToken;
        String msg;
        serializeJson(doc, msg);
        webSocket.sendTXT(msg);
      }
    }
  }

  // ========== LED STATUS UPDATE (NON-BLOCKING) ==========
  updateLedStatus();

  // ========== NFC SCANNING ==========
  if (mode == "scanner" || mode == "enroll") {
    static unsigned long nfcWindowStart = 0;
    static bool nfcActive = true;
    static bool nfcNeedsReinit = false;

    if (nfcActive) {
      handleNFCCardNonBlocking();
      if (millis() - nfcWindowStart >= 500) {
        nfcActive = false;
        nfcNeedsReinit = true;      // flag the reset, don't do it yet
        nfcWindowStart = millis();
      }
    } else {
      // Do the expensive I2C reset in small steps during the inactive window
      if (nfcNeedsReinit && millis() - nfcWindowStart >= 100) {
        Wire.end();
        Wire.begin(21, 22);
        nfc.begin();
        nfc.SAMConfig();
        nfcNeedsReinit = false;
      }
      if (millis() - nfcWindowStart >= 2000) {
        nfcActive = true;
        nfcWindowStart = millis();
      }
    }
  }

  // ========== FINGERPRINT SCANNING ==========
  if (fingerprintInitialized && (mode == "scanner" || mode == "enroll")) {
    int fingerID = scanFingerprint();
    if (fingerID >= 0) {
      int studentID = findStudent(fingerID);
      if (studentID > 0) {

        static unsigned long lastScanTime = 0;
        if (millis() - lastScanTime < 3000) return;
        lastScanTime = millis();

        setLedSuccess();

        if (mode == "scanner") {
          pendingLog.studentID = studentID;
          strncpy(pendingLog.method, "fingerprint", sizeof(pendingLog.method) - 1);
          pendingLog.pending = true;
          sendOutput("Fingerprint Match - Logged attendance for Student " + String(studentID), -1);
        }
      }
    }
  }

  // ========== PROCESS PENDING LOG ==========
  if (pendingLog.pending) {
    pendingLog.pending = false;
    sendLog(pendingLog.studentID, String(pendingLog.method));
  }

  // ========== BUTTON HANDLING ==========
  handleButton();

  // ========== HEARTBEAT ==========
  static unsigned long lastHeartbeat = 0;
  if (millis() - lastHeartbeat > 5000) {
    sendHeartbeat();
    lastHeartbeat = millis();
  }

  delay(10);
}

bool clearNFCTag() {
  // Overwrite pages 4-7 with zeroes, then place a TLV terminator
  uint8_t blank[4] = {0x00, 0x00, 0x00, 0x00};
  uint8_t term[4]  = {0xFE, 0x00, 0x00, 0x00}; // TLV terminator in page 4

  // Write terminator to page 4, blank to pages 5-7
  if (!nfc.ntag2xx_WritePage(4, term)) return false;
  for (int page = 5; page <= 7; page++) {
    if (!nfc.ntag2xx_WritePage(page, blank)) return false;
  }
  Serial.println("[NFC] Tag cleared.");
  return true;
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

int parseEnrollStudentID(String tagText) {
  tagText.trim();
  bool numeric = true;
  for (unsigned int i = 0; i < tagText.length(); i++) {
    if (!isdigit(tagText[i])) {
      numeric = false;
      break;
    }
  }
  if (numeric && tagText.length() > 0) return tagText.toInt();
  int colon = tagText.indexOf(':');
  if (colon >= 0) {
    String value = tagText.substring(colon + 1);
    value.trim();
    bool valueNumeric = true;
    for (unsigned int i = 0; i < value.length(); i++) {
      if (!isdigit(value[i])) {
        valueNumeric = false;
        break;
      }
    }
    if (valueNumeric && value.length() > 0) return value.toInt();
  }
  return -1;
}

void handleNFCCardNonBlocking() {
  unsigned long now = millis();
  if (now - lastNFCCheck < NFC_CHECK_INTERVAL) return;
  lastNFCCheck = now;

  uint8_t uid[7];
  uint8_t uidLen = 0;

  if (!nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLen, 50)) return;

  String tagText = readNFCNDEFText();
  if (tagText.length() == 0) {
    return;
  }
  tagText.trim();

  if (mode == "enroll") {
    if (enrollmentActive) return;

    int studentID = parseEnrollStudentID(tagText);
    if (studentID <= 0) {
      return;
    }

    int slot = getNextFreeSlot();
    if (slot == -1) {
      handleStorageFull();
      sendOutput("No free fingerprint slots.", -1);
      return;
    }

    sendOutput("NFC enroll tag read. Starting enrollment for student " + String(studentID) + "...", -1);

    // Clear/blank the tag so holding it near the reader does not retrigger another enrollment.
    writeNFCText(" ");

    uint8_t result = getFingerprintEnroll(slot, studentID);

    if (result == FINGERPRINT_OK) {
      sendOutput("Enrollment successful from NFC tag. Student " + String(studentID) + " saved to slot " + String(slot) + ".", -1);
    } else {
      sendOutput("Enrollment failed for NFC student " + String(studentID) + ".", -1);
    }

    return;
  }
  
  String parts[4];
  int partIndex = 0;
  int start = 0;

  for (int i = 0; i <= (int)tagText.length() && partIndex < 4; i++) {
    if (i == (int)tagText.length() || tagText[i] == '|') {
      parts[partIndex++] = tagText.substring(start, i);
      start = i + 1;
    }
  }

  if (partIndex < 4 || parts[0].length() == 0) {
    return;
  }

  String encryptedData = parts[0];
  String iv            = parts[1];
  String authTag       = parts[2];
  String date          = parts[3];

  Serial.printf("[NFC] Got encrypted payload for date %s\n", date.c_str());
  writeNFCText(" ");

  // ── Get current date/time for the log ──
  String dateStr, timeStr;
  getDateTime(dateStr, timeStr);

  // ── POST to /api/scanner/log ──
  if (WiFi.status() != WL_CONNECTED || authToken == "") {
    queueOfflineNFCLog(encryptedData, iv, authTag, date, dateStr, timeStr);
    setLedSuccess();
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(8000);

  if (!http.begin(client, String(serverEndpoint) + "/api/scanner/log")) {
    http.end();
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + authToken);

  StaticJsonDocument<512> doc;
  doc["encryptedData"]    = encryptedData;
  doc["iv"]               = iv;
  doc["authTag"]          = authTag;
  doc["date"]             = date;
  doc["scanner_location"] = SCANNER_LOCATION;
  doc["scanner_id"]       = SCANNER_ID;
  doc["date_scanned"]     = dateStr;
  doc["time_scanned"]     = timeStr;

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  if (code == 201) {
    Serial.println("[NFC] Log created successfully");
    setLedSuccess();
    sendOutput("NFC scan logged.", -1);
  } else {
    String resp = http.getString();
    Serial.printf("[NFC] Server returned %d: %s\n", code, resp.c_str());
    queueOfflineNFCLog(encryptedData, iv, authTag, date, dateStr, timeStr);
  }
  http.end();
}