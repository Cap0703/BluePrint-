// [AI COMMENT]
// ============================================================
// BLUEPRINT SCANNER SYSTEM
// Full system handling:
// - WiFi + WebSocket communication
// - Fingerprint authentication & enrollment
// - NFC scanning
// - Offline log buffering
// - LED state machine for status indication
// - Generative AI assisted in some debugging, for example; Websocket disconnecting after scanning fingerprint or nfc tag, Issues with LED status not updating.
//
// All comments marked [AI COMMENT] were added by AI.
// ============================================================

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

// [AI COMMENT] LED color constants for fingerprint module
#define FINGERPRINT_LED_YELLOW 0x05
#define FINGERPRINT_LED_CYAN 0x06
#define FINGERPRINT_LED_WHITE 0x07

// ========== CONFIGURATION ==========

// [AI COMMENT] WiFi credentials
const char ssid[] = "BraveWeb";
const char password[] = "Br@veW3b";

// [AI COMMENT] WebSocket client instance (persistent connection to backend)
WebSocketsClient webSocket;

// [AI COMMENT] Scanner identity for backend authentication
const char* SCANNER_ID = "1";
const char* SCANNER_LOCATION = "304";
const char* SCANNER_PASSWORD = "BluePrint";

// [AI COMMENT] Server endpoints (REST + WebSocket)
const char* serverEndpoint = "https://blueprint.boo";
const char* wsHost = "blueprint.boo";
const uint16_t wsPort = 443;
const char* wsPath = "/ws";

// [AI COMMENT] NTP time sync configuration
const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = -8 * 3600;
const int daylightOffset_sec = 3600;

// [AI COMMENT] Battery measurement pin and calibration
const int batteryPin = 34;
const float R1 = 38600.0;
const float R2 = 20870.0;
float calibrationFactor = 4.138 / 5.605;
const float VREF = 3.378;

// [AI COMMENT] LED state machine modes (system + error states)
enum LedState {
  LED_DISCONNECTED_WIFI,
  LED_DISCONNECTED_WS,
  LED_READY,
  LED_ENROLL,
  LED_SUCCESS,
  LED_AUTH,
  LED_OFFLINE
};

// [AI COMMENT] Tracks which error is currently displayed when cycling
int currentErrorIndex = 0;

// ========== LED STATE MACHINE VARIABLES ==========

// [AI COMMENT]
// modeBaseLedState = "normal mode LED" (READY or ENROLL)
// currentLedState = what is currently shown (may be error override)
LedState modeBaseLedState = LED_READY;
LedState currentLedState = LED_DISCONNECTED_WIFI;

// [AI COMMENT] Timing controls for LED state machine
unsigned long ledStatusCheckTime = 0;
unsigned long ledModeReturnTime = 0;

// [AI COMMENT] Durations for LED behavior
const unsigned long LED_ERROR_DURATION = 2000;
const unsigned long LED_NORMAL_DURATION = 10000;

// [AI COMMENT] Temporary override system (e.g. success flash)
unsigned long ledOverrideUntil = 0;
LedState ledOverrideState = LED_READY;
bool ledOverrideActive = false;

// [AI COMMENT] LED cycle phases (normal vs error display)
enum LedCyclePhase {
  LED_PHASE_NORMAL,
  LED_PHASE_ERROR
};

LedCyclePhase ledPhase = LED_PHASE_NORMAL;
unsigned long ledPhaseStart = 0;

// [AI COMMENT] Connection tracking for LED logic
bool websocketConnected = false;

// ========== FINGERPRINT HARDWARE ==========

// [AI COMMENT] UART pins for fingerprint sensor
#define RX_GPIO 16
#define TX_GPIO 17

HardwareSerial mySerial(2);

// [AI COMMENT] Fingerprint sensor instance
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&mySerial);

// ========== NFC HARDWARE ==========

// [AI COMMENT] PN532 config (I2C, no IRQ/reset used)
#define PN532_IRQ   -1
#define PN532_RESET -1

Adafruit_PN532 nfc(PN532_IRQ, PN532_RESET);

// ========== STORAGE ==========

// [AI COMMENT] File used for offline logs
#define OFFLINE_LOGS_FILE "/offline_logs.bin"
#define MAX_OFFLINE_LOGS 200

// [AI COMMENT] Structure for storing logs offline
struct OfflineLog {
  int studentID;
  char method[16];
  char date[11];
  char time[9];
};

// ========== BUTTON ==========

// [AI COMMENT] Button handling (short press = mode toggle, long press = reconnect)
#define BUTTON_PIN 25
unsigned long buttonPressStart = 0;
bool buttonLastState = HIGH;
bool buttonPressed = false;

const unsigned long SHORT_PRESS_TIME = 50;
const unsigned long LONG_PRESS_TIME  = 1500;

// ========== GLOBAL STATE ==========

// [AI COMMENT] Auth/session info
String authToken = "";
String scannerDbId = "";

// [AI COMMENT] Mode control
String mode = "scanner";

// [AI COMMENT] Hardware flags
bool WifiConnected = false;
bool fingerprintInitialized = false;
bool nfcInitialized = false;

// ========== ENROLLMENT CONTROL ==========

// [AI COMMENT] Controls blocking enrollment process
bool enrollmentActive = false;
bool enrollmentCancelled = false;
int enrollmentStudentID = 0;

// [AI COMMENT] Pending log buffer (used to avoid blocking in scan loop)
struct PendingLog {
  int studentID;
  char method[16];
  bool pending;
};

PendingLog pendingLog = {0, "", false};

// [AI COMMENT] Fingerprint slot mapping (slot → student ID)
#define MAX_FINGERPRINT_SLOTS 127
#define STUDENTS_BIN "/students.bin"

unsigned long lastNFCCheck = 0;
const unsigned long NFC_CHECK_INTERVAL = 200;

int students[MAX_FINGERPRINT_SLOTS + 1] = {0};

// ========== NON-BLOCKING LED FUNCTIONS ==========

// [AI COMMENT]
// Sets LED to a "breathing" animation (used for normal modes and some statuses).
// This is non-blocking and relies on the fingerprint sensor's built-in LED patterns.
void setLedBreathing(LedState state) {
  if (!fingerprintInitialized) return;

  uint8_t color = FINGERPRINT_LED_RED;
  
  switch (state) {
    case LED_DISCONNECTED_WIFI:
      // [AI COMMENT] Solid red = no WiFi
      color = FINGERPRINT_LED_RED;
      finger.LEDcontrol(FINGERPRINT_LED_ON, 0, color);
      break;

    case LED_DISCONNECTED_WS:
      // [AI COMMENT] Solid white = WiFi OK but WebSocket disconnected
      color = FINGERPRINT_LED_WHITE;
      finger.LEDcontrol(FINGERPRINT_LED_ON, 0, color);
      break;

    case LED_READY:
      // [AI COMMENT] Blue breathing = normal scanning mode
      color = FINGERPRINT_LED_BLUE;
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 3000, color);
      break;

    case LED_ENROLL:
      // [AI COMMENT] Cyan breathing = enrollment mode
      color = FINGERPRINT_LED_CYAN;
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 3000, color);
      break;

    case LED_SUCCESS:
      // [AI COMMENT] Green breathing = success feedback
      color = FINGERPRINT_LED_GREEN;
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 2000, color);
      break;

    case LED_AUTH:
      // [AI COMMENT] Yellow breathing = authentication in progress
      color = FINGERPRINT_LED_YELLOW;
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 1500, color);
      break;

    case LED_OFFLINE:
      // [AI COMMENT] Purple breathing = offline logging state
      color = FINGERPRINT_LED_PURPLE;
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 1500, color);
      break;
  }
}

// [AI COMMENT]
// Sets LED to a solid (non-breathing) flash for error indication.
void setLedSolidFlash(LedState state) {
  if (!fingerprintInitialized) return;

  uint8_t color = FINGERPRINT_LED_RED;
  
  switch (state) {
    case LED_DISCONNECTED_WIFI:
      color = FINGERPRINT_LED_RED;
      break;

    case LED_DISCONNECTED_WS:
      color = FINGERPRINT_LED_WHITE;
      break;

    default:
      color = FINGERPRINT_LED_RED;
      break;
  }

  finger.LEDcontrol(FINGERPRINT_LED_ON, 0, color);
}

// [AI COMMENT]
// Sets the "base" LED state (normal operating mode).
// This is what the LED returns to when no errors/overrides are active.
void setDesiredLedState(LedState state) {
  if (state == LED_READY || state == LED_ENROLL) {
    modeBaseLedState = state;
    currentLedState = state;

    ledStatusCheckTime = millis();
    ledModeReturnTime = millis() + LED_NORMAL_DURATION;

    setLedBreathing(state);
  }
}

// [AI COMMENT]
// Temporarily overrides LED state (used for success/error flashes).
// After 'duration', system returns to normal mode automatically.
void setLedTemporaryOverride(LedState state, unsigned long duration = LED_ERROR_DURATION) {
  ledOverrideActive = true;
  ledOverrideState = state;
  ledOverrideUntil = millis() + duration;

  setLedBreathing(state);
}

// [AI COMMENT]
// Core LED state machine:
// - Handles normal mode display
// - Cycles through errors if multiple exist
// - Handles temporary overrides
void updateLedStatus() {
  if (!fingerprintInitialized) return;

  // ----- Override handling -----
  if (ledOverrideActive) {
    if (millis() > ledOverrideUntil) {
      ledOverrideActive = false;

      // [AI COMMENT] Return to base mode after override
      setLedBreathing(modeBaseLedState);
      ledPhase = LED_PHASE_NORMAL;
      ledPhaseStart = millis();
    }
    return;
  }

  // ----- Build error list -----
  LedState errorStates[2];
  int errorCount = 0;

  if (!WifiConnected) {
    errorStates[errorCount++] = LED_DISCONNECTED_WIFI;
  }

  if (WifiConnected && !websocketConnected) {
    errorStates[errorCount++] = LED_DISCONNECTED_WS;
  }

  bool hasError = (errorCount > 0);

  // ----- No error: show normal mode -----
  if (!hasError) {
    currentErrorIndex = 0;

    if (currentLedState != modeBaseLedState) {
      currentLedState = modeBaseLedState;
      setLedBreathing(modeBaseLedState);
    }

    ledPhase = LED_PHASE_NORMAL;
    ledPhaseStart = millis();
    return;
  }

  // ----- Error cycling -----
  unsigned long now = millis();

  if (ledPhase == LED_PHASE_NORMAL) {

    if (currentLedState != modeBaseLedState) {
      currentLedState = modeBaseLedState;
      setLedBreathing(modeBaseLedState);
    }

    if (now - ledPhaseStart >= LED_NORMAL_DURATION) {
      ledPhase = LED_PHASE_ERROR;
      ledPhaseStart = now;
    }

  } else {

    LedState currentError = errorStates[currentErrorIndex];

    if (currentLedState != currentError) {
      currentLedState = currentError;
      setLedSolidFlash(currentError);
    }

    if (now - ledPhaseStart >= LED_ERROR_DURATION) {
      ledPhaseStart = now;

      currentErrorIndex++;

      if (currentErrorIndex >= errorCount) {
        currentErrorIndex = 0;
        ledPhase = LED_PHASE_NORMAL;
      }
    }
  }
}

// ========== BUTTON HANDLING ==========

// [AI COMMENT]
// Handles both short press and long press:
// - Short press: toggle mode OR cancel enrollment
// - Long press: reconnect WiFi + reauthenticate
void handleButton() {
  bool currentState = digitalRead(BUTTON_PIN);

  // Detect press start
  if (buttonLastState == HIGH && currentState == LOW) {
    buttonPressStart = millis();
    buttonPressed = true;
  }

  // Detect release
  if (buttonLastState == LOW && currentState == HIGH && buttonPressed) {
    unsigned long pressDuration = millis() - buttonPressStart;
    buttonPressed = false;

    // ----- SHORT PRESS -----
    if (pressDuration > SHORT_PRESS_TIME && pressDuration < LONG_PRESS_TIME) {

      // [AI COMMENT] Cancel enrollment if active
      if (enrollmentActive) {
        enrollmentCancelled = true;
        sendOutput("Enrollment cancelled (button).", -1);
        return;
      }

      // [AI COMMENT] Toggle mode
      if (mode == "scanner") {
        mode = "enroll";
        sendOutput("Mode set to enroll (button)", -1);
        setDesiredLedState(LED_ENROLL);
      } else {
        mode = "scanner";
        sendOutput("Mode set to scanner (button)", -1);
        setDesiredLedState(LED_READY);
      }
    }

    // ----- LONG PRESS -----
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

// [AI COMMENT]
// Initializes PN532 NFC module over I2C and verifies firmware presence.
// If not detected, NFC features are disabled gracefully.
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
  
  // [AI COMMENT] Put NFC chip into read mode
  nfc.SAMConfig();
  nfcInitialized = true;
  Serial.println("✓ NFC scanner initialized.");
}

// [AI COMMENT]
// Reads an NDEF text record from NTAG21x cards.
// This function manually parses low-level NDEF structure.
// Returns empty string if no valid text record is found.
String readNFCNDEFText() {
  uint8_t buf[16];
  int idx = 0;

  // [AI COMMENT] Read pages 4–7 (standard user memory area)
  for (int page = 4; page <= 7; page++) {
    uint8_t pageData[4];
    if (nfc.ntag2xx_ReadPage(page, pageData)) {
      for (int i = 0; i < 4; i++) buf[idx++] = pageData[i];
    } else {
      break;
    }
  }

  // [AI COMMENT] Scan for NDEF TLV marker (0x03)
  for (int i = 0; i < idx - 2; i++) {
    if (buf[i] == 0x03) {
      uint8_t msgLen = buf[i + 1];
      int start = i + 2;

      if (start + msgLen > idx) break;

      uint8_t* rec = &buf[start];

      uint8_t tnf = rec[0] & 0x07;
      bool sr = rec[0] & 0x10;
      uint8_t typeLen = rec[1];

      // [AI COMMENT] Expect Well-Known Type + Text record
      if (tnf == 0x01 && typeLen == 1) {
        uint8_t type = rec[sr ? 3 : 6];

        if (type == 'T') {
          uint8_t status = rec[(sr ? 4 : 7)];
          uint8_t langLen = status & 0x3F;

          uint32_t payloadLen = sr
            ? rec[2]
            : (rec[2] << 24 | rec[3] << 16 | rec[4] << 8 | rec[5]);

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

  return "";
}

// ========== LITTLEFS STORAGE ==========

// [AI COMMENT]
// Loads fingerprint slot → student ID mapping from flash.
// If file does not exist, initializes empty map.
void loadStudents() {
  File file = LittleFS.open(STUDENTS_BIN, FILE_READ);

  if (file) {
    file.read((uint8_t*)students, sizeof(students));
    file.close();
    Serial.println("[STORAGE] Student map loaded.");
  } else {
    Serial.println("[STORAGE] No map found, starting fresh.");
    memset(students, 0, sizeof(students));
  }
}

// [AI COMMENT]
// Saves current student mapping to flash.
// Called after enrollment or deletion.
void saveStudents() {
  File file = LittleFS.open(STUDENTS_BIN, FILE_WRITE);

  if (!file) {
    Serial.println("[STORAGE] ERROR writing map!");
    return;
  }

  file.write((uint8_t*)students, sizeof(students));
  file.close();

  Serial.println("[STORAGE] Map saved.");
}

// [AI COMMENT]
// Finds first empty fingerprint slot (1–127).
// Returns -1 if storage is full.
int getNextFreeSlot() {
  for (int slot = 1; slot <= MAX_FINGERPRINT_SLOTS; slot++) {
    if (students[slot] == 0) return slot;
  }
  return -1;
}

// [AI COMMENT]
// Handles full storage condition.
// Prompts via Serial to wipe entire fingerprint database.
void handleStorageFull() {
  Serial.println("[STORAGE] No free slots!");
  Serial.println("Delete ALL fingerprints? (y/n)");

  while (!Serial.available());

  char response = Serial.read();

  if (response == 'y' || response == 'Y') {
    if (finger.emptyDatabase() == FINGERPRINT_OK) {
      Serial.println("[STORAGE] Cleared.");
      memset(students, 0, sizeof(students));
      saveStudents();
    } else {
      Serial.println("[STORAGE] Failed to clear.");
    }
  } else {
    Serial.println("[STORAGE] Cancelled.");
  }
}

// [AI COMMENT]
// Returns student ID associated with fingerprint slot.
int findStudent(int fingerprintID) {
  if (fingerprintID < 1 || fingerprintID > MAX_FINGERPRINT_SLOTS) return -1;
  return students[fingerprintID];
}

// ========== FINGERPRINT SCAN ==========

// [AI COMMENT]
// Attempts to scan and match fingerprint.
// Returns fingerprint slot ID or -1 if no match.
int scanFingerprint() {
  uint8_t p = finger.getImage();
  if (p != FINGERPRINT_OK) return -1;

  p = finger.image2Tz();
  if (p != FINGERPRINT_OK) return -1;

  p = finger.fingerSearch();
  if (p != FINGERPRINT_OK) return -1;

  return finger.fingerID;
}

// [AI COMMENT]
// Utility function to keep WebSocket alive during blocking loops.
// Prevents connection drops during enrollment.
static inline void wsFlush() {
  for (int i = 0; i < 10; i++) {
    webSocket.loop();
    delay(10);
  }
}

// ========== FINGERPRINT ENROLLMENT ==========

// [AI COMMENT]
// Full multi-step fingerprint enrollment process.
// This is a blocking workflow, but carefully maintains:
// - WebSocket connection (via wsFlush + loop calls)
// - LED updates (via updateLedStatus())
// - Cancellation support (button or command)
//
// Steps:
// 1. First scan
// 2. Lift finger
// 3. Second scan (same finger)
// 4. Create model
// 5. Store model in sensor + map to student ID
uint8_t getFingerprintEnroll(int slot, int sID) {
  int p = -1;

  enrollmentActive = true;
  enrollmentCancelled = false;
  enrollmentStudentID = sID;

  // ── Step 1: first scan ───────────────────────────────
  sendOutput("Place finger on sensor for student " + String(sID) + "...", -1);
  sendOutput("Type 'cancel' to abort enrollment.", -1);
  wsFlush();

  while (p != FINGERPRINT_OK) {

    // [AI COMMENT] Maintain system responsiveness during blocking loop
    webSocket.loop();
    updateLedStatus();

    // [AI COMMENT] Allow cancellation mid-process
    if (enrollmentCancelled) {
      enrollmentActive = false;
      sendOutput("Enrollment cancelled.", -1);
      return 0xFF;
    }

    p = finger.getImage();
    webSocket.loop();

    if (p == FINGERPRINT_NOFINGER) continue;
    if (p != FINGERPRINT_OK) continue;
  }

  // Convert image to template buffer 1
  p = finger.image2Tz(1);

  if (p != FINGERPRINT_OK) {
    sendOutput("First scan failed — try again.", -1);
    wsFlush();
    delay(3000);
    enrollmentActive = false;
    return p;
  }

  // ── Step 2: lift finger ─────────────────────────────
  sendOutput("Good scan. Lift your finger.", -1);

  // [AI COMMENT] Temporary success feedback
  setLedTemporaryOverride(LED_SUCCESS);
  wsFlush();
  delay(1000);

  // Wait until finger is removed
  while (finger.getImage() != FINGERPRINT_NOFINGER) {
    updateLedStatus();
    webSocket.loop();
  }

  // ── Step 3: second scan ─────────────────────────────
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

    if (p == FINGERPRINT_NOFINGER) continue;
    if (p != FINGERPRINT_OK) continue;
  }

  // Convert image to template buffer 2
  p = finger.image2Tz(2);

  if (p != FINGERPRINT_OK) {
    sendOutput("Second scan failed. Try again.", -1);
    wsFlush();
    delay(3000);
    enrollmentActive = false;
    return p;
  }

  // ── Step 4: create model ────────────────────────────
  p = finger.createModel();

  // [AI COMMENT] Ensure both scans match
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

  // ── Step 5: store model ─────────────────────────────
  p = finger.storeModel(slot);

  if (p != FINGERPRINT_OK) {
    sendOutput("Failed to store fingerprint (error " + String(p) + ").", -1);
    wsFlush();
    delay(3000);
    enrollmentActive = false;
    return p;
  }

  // [AI COMMENT] Save mapping: slot → student ID
  students[slot] = sID;
  saveStudents();

  sendOutput("✓ Enrollment complete! Student " + String(sID) + " saved to slot " + String(slot) + ".", -1);

  // [AI COMMENT] Visual success feedback
  setLedTemporaryOverride(LED_SUCCESS);
  wsFlush();

  enrollmentActive = false;

  return FINGERPRINT_OK;
}

// ========== SERVER COMMUNICATION ==========

// [AI COMMENT]
// Authenticates scanner with backend.
// Returns true if login successful and stores authToken + scannerDbId.
bool signIn() {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.setTimeout(10000);

  // [AI COMMENT] Show "auth in progress" LED
  setDesiredLedState(LED_AUTH);

  String url = String(serverEndpoint) + "/api/scanner/auth/login";

  if (!http.begin(client, url)) {
    http.end();
    return false;
  }

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

    // [AI COMMENT] Save authentication data for future requests
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

// [AI COMMENT]
// Gets current date + time from NTP.
// Falls back to dummy values if not synced yet.
void getDateTime(String &dateStr, String &timeStr) {
  struct tm timeinfo;

  if (!getLocalTime(&timeinfo)) {
    Serial.println("[TIME] NTP not synced yet.");

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

// [AI COMMENT]
// Sends attendance log to backend.
// If offline or request fails → queues locally instead.
void sendLog(int studentID, String method) {

  // [AI COMMENT] If no connection, queue log
  if (WiFi.status() != WL_CONNECTED || authToken == "") {
    Serial.println("[LOG] Offline — queueing.");
    queueOfflineLog(studentID, method);
    setLedTemporaryOverride(LED_OFFLINE);
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.setTimeout(10000);

  if (!http.begin(client, String(serverEndpoint) + "/api/logs")) {
    Serial.println("[LOG] http.begin failed — queueing.");
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
    Serial.printf("[LOG] Server returned %d — queueing.\n", code);
    queueOfflineLog(studentID, method);
    setLedTemporaryOverride(LED_OFFLINE);
  }

  http.end();
}

// [AI COMMENT]
// Sends periodic heartbeat with battery level.
// If server rejects request → auth token is cleared (forces reauth).
void sendHeartbeat() {
  if (authToken == "" || scannerDbId == "") return;

  // [AI COMMENT] Read battery voltage
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

  // [AI COMMENT] If rejected → force re-authentication
  if (code != 200) {
    authToken = "";
  }

  http.end();
}

// [AI COMMENT]
// Sends output message to WebSocket (frontend / server).
void sendOutput(String msg, int commandId) {
  if (!webSocket.isConnected()) return;

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

// ========== OFFLINE LOGGING ==========

// [AI COMMENT]
// Stores log entry in LittleFS when offline.
// Uses a fixed-size queue (FIFO when full).
void queueOfflineLog(int studentID, String method) {

  String dateStr, timeStr;
  getDateTime(dateStr, timeStr);

  OfflineLog entry;

  entry.studentID = studentID;

  strncpy(entry.method, method.c_str(), sizeof(entry.method) - 1);
  entry.method[sizeof(entry.method) - 1] = '\\0';

  strncpy(entry.date, dateStr.c_str(), sizeof(entry.date) - 1);
  entry.date[sizeof(entry.date) - 1] = '\\0';

  strncpy(entry.time, timeStr.c_str(), sizeof(entry.time) - 1);
  entry.time[sizeof(entry.time) - 1] = '\\0';

  int count = 0;

  File rf = LittleFS.open(OFFLINE_LOGS_FILE, FILE_READ);
  if (rf) {
    count = rf.size() / sizeof(OfflineLog);
    rf.close();
  }

  // [AI COMMENT] If full → drop oldest entry
  if (count >= MAX_OFFLINE_LOGS) {
    Serial.println("[OFFLINE] Queue full — dropping oldest.");

    OfflineLog* buf = (OfflineLog*)malloc(sizeof(OfflineLog) * MAX_OFFLINE_LOGS);

    if (!buf) {
      Serial.println("[OFFLINE] malloc failed.");
      return;
    }

    File r2 = LittleFS.open(OFFLINE_LOGS_FILE, FILE_READ);
    if (r2) {
      r2.read((uint8_t*)buf, sizeof(OfflineLog) * MAX_OFFLINE_LOGS);
      r2.close();
    }

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

  if (!f) {
    Serial.println("[OFFLINE] ERROR opening file.");
    return;
  }

  f.write((uint8_t*)&entry, sizeof(OfflineLog));
  f.close();

  Serial.printf("[OFFLINE] Queued: student=%d method=%s\n",
                studentID, method.c_str());
}

// ========== COMMAND HANDLING ==========

// [AI COMMENT]
// Processes incoming commands from WebSocket.
// Supports:
// - mode switching
// - enrollment control
// - diagnostics
// - storage management
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

      // [AI COMMENT] Update LED to reflect mode
      if (newMode == "scanner") {
        setDesiredLedState(LED_READY);
      } else {
        setDesiredLedState(LED_ENROLL);
      }

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
    String msg = "Status:\\n";

    msg += "Mode: " + mode + "\\n";
    msg += "WiFi: " + String(WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected") + "\\n";
    msg += "IP: " + WiFi.localIP().toString() + "\\n";
    msg += "Fingerprint: " + String(fingerprintInitialized ? "OK" : "NOT FOUND") + "\\n";
    msg += "NFC: " + String(nfcInitialized ? "OK" : "NOT FOUND") + "\\n";
    msg += "Auth: " + String(authToken != "" ? "OK" : "NOT AUTHENTICATED");

    sendOutput(msg, commandId);
    return;
  }

  // ===== PING =====
  if (cmd == "ping") {
    sendOutput("pong", commandId);
    return;
  }

  // ===== WIFI INFO =====
  if (cmd == "wifi info") {
    String msg = "WiFi Info:\\n";

    msg += "SSID: " + String(WiFi.SSID()) + "\\n";
    msg += "IP: " + WiFi.localIP().toString() + "\\n";
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

      // [AI COMMENT] Re-send auth to WebSocket after reauth
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
    String msg = "Slots:\\n";
    int count = 0;

    for (int i = 1; i <= MAX_FINGERPRINT_SLOTS; i++) {
      if (students[i] != 0) {
        msg += "Slot " + String(i) + " → " + String(students[i]) + "\\n";
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

  // ===== NUMERIC INPUT =====
  // [AI COMMENT]
  // If command is purely numeric:
  // - In enroll mode → start enrollment
  // - In scanner mode → log manually
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

// [AI COMMENT]
// Handles all WebSocket events:
// - connection
// - disconnection
// - incoming commands
void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {

  switch (type) {

    case WStype_CONNECTED: {
      Serial.println("WebSocket connected.");
      websocketConnected = true;

      // [AI COMMENT] Send auth message immediately after connecting
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

      // [AI COMMENT] Only attempt reconnect if WiFi is still connected
      if (WifiConnected) {
        webSocket.beginSSL(wsHost, wsPort, wsPath);
        webSocket.onEvent(onWebSocketEvent);
        webSocket.setReconnectInterval(5000);
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

      // [AI COMMENT] Forward command to command handler
      if (command != "") {
        handleCommand(command, commandId);
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

// [AI COMMENT]
// Starts WiFi connection (non-blocking)
void connectWifi() {
  Serial.printf("[WIFI] Connecting to %s\n", ssid);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  WifiConnected = false;
}

// ========== SETUP ==========

// [AI COMMENT]
// Initializes all hardware and services
void setup() {

  Serial.begin(115200);
  delay(1000);

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  Serial.println("========== STARTUP ==========");

  initializeFingerprint();
  initializeNFC();

  if (!LittleFS.begin(true)) {
    Serial.println("[ERROR] LittleFS failed!");
    while (1) delay(1);
  }

  loadStudents();

  connectWifi();

  // [AI COMMENT] Start NTP time sync (non-blocking)
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
}

// ========== LOOP ==========

// [AI COMMENT]
// Main runtime loop — orchestrates everything
void loop() {

  // [AI COMMENT] Handle WebSocket background tasks
  webSocket.loop();

  // ===== WIFI MANAGEMENT =====
  static unsigned long lastWifiRetry = 0;
  static bool wifiJustConnected = false;

  if (WiFi.status() == WL_CONNECTED && !WifiConnected) {
    WifiConnected = true;
    wifiJustConnected = true;

    Serial.println("[WIFI] Connected. IP: " + WiFi.localIP().toString());
  }

  else if (WiFi.status() != WL_CONNECTED && WifiConnected) {
    WifiConnected = false;
  }

  else if (WiFi.status() != WL_CONNECTED && !WifiConnected) {
    if (millis() - lastWifiRetry > 300000) {
      lastWifiRetry = millis();
      connectWifi();
    }
  }

  // [AI COMMENT] On first WiFi connect → authenticate + start WebSocket
  if (wifiJustConnected) {
    wifiJustConnected = false;

    if (signIn()) {
      flushOfflineLogs();
    }

    webSocket.beginSSL(wsHost, wsPort, wsPath);
    webSocket.onEvent(onWebSocketEvent);
    webSocket.setReconnectInterval(5000);
  }

  // ===== LED STATE MACHINE =====
  if (mode == "enroll") {
    if (currentLedState == LED_READY) {
      setDesiredLedState(LED_ENROLL);
    }
  } else {
    if (currentLedState == LED_ENROLL) {
      setDesiredLedState(LED_READY);
    }
  }

  updateLedStatus();

  // ===== NFC HANDLING =====
  if (mode == "scanner" || mode == "enroll") {

    static unsigned long nfcWindowStart = 0;
    static bool nfcActive = true;

    if (nfcActive) {

      if (millis() - lastNFCCheck >= NFC_CHECK_INTERVAL) {
        lastNFCCheck = millis();
        handleNFCCardNonBlocking();
      }

      // [AI COMMENT] Periodically reset I2C to avoid PN532 lockups
      if (millis() - nfcWindowStart >= 500) {
        nfcActive = false;
        nfcWindowStart = millis();

        Wire.end();
        Wire.begin(21, 22);

        nfc.begin();
        nfc.SAMConfig();
      }

    } else {
      if (millis() - nfcWindowStart >= 2000) {
        nfcActive = true;
        nfcWindowStart = millis();
      }
    }
  }

  // ===== FINGERPRINT SCANNING =====
  if (fingerprintInitialized && (mode == "scanner" || mode == "enroll")) {

    int fingerID = scanFingerprint();

    if (fingerID >= 0) {
      int studentID = findStudent(fingerID);

      if (studentID > 0) {

        static unsigned long lastScanTime = 0;

        // [AI COMMENT] Prevent duplicate scans (3s cooldown)
        if (millis() - lastScanTime < 3000) return;
        lastScanTime = millis();

        setLedTemporaryOverride(LED_SUCCESS, 800);

        if (mode == "scanner") {
          pendingLog.studentID = studentID;
          strncpy(pendingLog.method, "fingerprint", sizeof(pendingLog.method) - 1);
          pendingLog.pending = true;

          sendOutput("Fingerprint Match - Logged attendance for Student " + String(studentID), -1);
        }
      }
    }
  }

  // ===== PROCESS LOG =====
  if (pendingLog.pending) {
    pendingLog.pending = false;
    sendLog(pendingLog.studentID, String(pendingLog.method));
  }

  // ===== BUTTON =====
  handleButton();

  // ===== HEARTBEAT =====
  static unsigned long lastHeartbeat = 0;

  if (millis() - lastHeartbeat > 5000) {
    sendHeartbeat();
    lastHeartbeat = millis();
  }

  delay(10);
}

// ========== NFC UTILITIES ==========

// [AI COMMENT]
// Clears NFC tag (erases stored data)
bool clearNFCTag() {

  uint8_t blank[4] = {0x00, 0x00, 0x00, 0x00};
  uint8_t term[4]  = {0xFE, 0x00, 0x00, 0x00};

  if (!nfc.ntag2xx_WritePage(4, term)) return false;

  for (int page = 5; page <= 7; page++) {
    if (!nfc.ntag2xx_WritePage(page, blank)) return false;
  }

  Serial.println("[NFC] Tag cleared.");
  return true;
}

// [AI COMMENT]
// Writes text (student ID) to NFC tag in NDEF format
bool writeNFCText(String text) {

  uint8_t textLen = text.length();
  uint8_t payloadLen = 3 + textLen;
  uint8_t msgLen = 3 + payloadLen;

  uint8_t buf[16] = {0};
  int i = 0;

  buf[i++] = 0x03;
  buf[i++] = msgLen;
  buf[i++] = 0xD1;
  buf[i++] = 0x01;
  buf[i++] = payloadLen;
  buf[i++] = 'T';
  buf[i++] = 0x02;
  buf[i++] = 'e';
  buf[i++] = 'n';

  for (int j = 0; j < textLen && i < 15; j++) {
    buf[i++] = text[j];
  }

  buf[i] = 0xFE;

  for (int page = 4; page <= 7; page++) {
    uint8_t pageData[4];
    memcpy(pageData, &buf[(page - 4) * 4], 4);

    if (!nfc.ntag2xx_WritePage(page, pageData)) {
      return false;
    }
  }

  Serial.println("[NFC] Wrote: " + text);
  return true;
}

// [AI COMMENT]
// Non-blocking NFC scanner
// Handles:
// - enrollment trigger
// - attendance logging
void handleNFCCardNonBlocking() {

  uint8_t uid[7];
  uint8_t uidLength;

  bool success = nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 100);

  if (success && uidLength == 7) {

    String nfcText = readNFCNDEFText();

    if (nfcText.length() > 0) {
      nfcText.trim();

      bool isNumeric = true;
      for (unsigned int i = 0; i < nfcText.length(); i++) {
        if (!isdigit(nfcText[i])) {
          isNumeric = false;
          break;
        }
      }

      // ===== ENROLL MODE =====
      if (mode == "enroll" && isNumeric) {

        if (enrollmentActive) return;

        int studentID = nfcText.toInt();
        int slot = getNextFreeSlot();

        if (slot == -1) {
          sendOutput("No free slots.", -1);
          return;
        }

        sendOutput("Starting NFC enrollment...", -1);
        wsFlush();

        uint8_t result = getFingerprintEnroll(slot, studentID);

        if (result == FINGERPRINT_OK) {
          clearNFCTag();
          sendOutput("✓ NFC enrollment complete!", -1);
        } else {
          sendOutput("✗ NFC enrollment failed.", -1);
        }

        delay(500);
        return;
      }

      // ===== SCANNER MODE =====
      if (mode == "scanner" && isNumeric) {

        int studentID = nfcText.toInt();

        clearNFCTag();

        setLedTemporaryOverride(LED_SUCCESS, 800);

        sendLog(studentID, "NFC");
        sendOutput("NFC Scan - Logged attendance for Student " + String(studentID), -1);
      }
    }

    delay(500); // prevent repeated reads
  }
}