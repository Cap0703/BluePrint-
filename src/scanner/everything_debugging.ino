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
const char* SCANNER_LOCATION = "204";
const char* SCANNER_PASSWORD = "BluePrint";

const char* serverEndpoint = "https://blueprint.boo";
const char* wsHost = "blueprint.boo";
const uint16_t wsPort = 443;
const char* wsPath = "/ws";

const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 8 * 3600;
const int daylightOffset_sec = 0;

// ========== FINGERPRINT HARDWARE ==========
#define RX_GPIO 16
#define TX_GPIO 17
HardwareSerial mySerial(2);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&mySerial);

// ========== NFC HARDWARE ==========
#define PN532_IRQ   -1
#define PN532_RESET -1

Adafruit_PN532 nfc(PN532_IRQ, PN532_RESET);

// ========== GLOBALS ==========
String authToken = "";
String scannerDbId = "";
String mode = "scanner";  // scanner, enroll, nfc
bool WifiConnected = false;
bool fingerprintInitialized = false;
bool nfcInitialized = false;
uint8_t lastLedColor = FINGERPRINT_LED_RED;

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
void sendOutput(String msg, int commandId);
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
    Serial.println("✗ Did not find PN532 NFC board");
    nfcInitialized = false;
    return;
  }
  
  Serial.print("✓ Found PN5");
  Serial.println((versiondata >> 24) & 0xFF, HEX);
  Serial.print("  Firmware ver. ");
  Serial.print((versiondata >> 16) & 0xFF, DEC);
  Serial.print('.');
  Serial.println((versiondata >> 8) & 0xFF, DEC);
  
  nfc.SAMConfig();
  nfcInitialized = true;
  Serial.println("✓ NFC scanner initialized.");
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

void handleNFCCard() {
  uint8_t success;
  uint8_t uid[7];
  uint8_t uidLength;

  success = nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 1000);

  if (success) {
    Serial.println("✓ Found an ISO14443A card");
    Serial.print("  UID Length: ");
    Serial.print(uidLength, DEC);
    Serial.println(" bytes");
    Serial.print("  UID Value: ");
    nfc.PrintHex(uid, uidLength);
    Serial.println();

    if (uidLength == 7) {
      Serial.println("Reading NDEF text record from NTAG2xx...");
      String nfcText = readNFCNDEFText();

      if (nfcText.length() > 0) {
        Serial.println("\n----- NFC TEXT DATA -----");
        Serial.println(nfcText);
        Serial.println("------------------------");

        // Try to extract numeric student ID
        nfcText.trim();
        bool isNumeric = true;
        for (unsigned int i = 0; i < nfcText.length(); i++) {
          if (!isdigit(nfcText[i])) {
            isNumeric = false;
            break;
          }
        }

        if (isNumeric && nfcText.length() > 0) {
          int studentID = nfcText.toInt();
          sendLog(studentID, "NFC");
          sendOutput("NFC Scan - Logged attendance for Student " + String(studentID), -1);
        } else {
          sendOutput("NFC Scan - Text on tag is not a numeric student ID: " + nfcText, -1);
        }
      } else {
        sendOutput("NFC Scan - No valid NDEF text record found on tag.", -1);
      }
    }
  }
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

uint8_t getFingerprintEnroll(int slot, int sID) {
  int p = -1;
  
  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 4000, FINGERPRINT_LED_BLUE);
  Serial.println("Place finger on sensor...");
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    if (p == FINGERPRINT_NOFINGER) { Serial.print("."); continue; }
    if (p != FINGERPRINT_OK) { Serial.println("\nImaging error, try again."); }
  }
  
  p = finger.image2Tz(1);
  if (p != FINGERPRINT_OK) {
    Serial.println("Conversion failed. Try again.");
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    delay(3000);
    return p;
  }
  
  Serial.println("\nFirst scan OK. Remove finger.");
  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 4000, FINGERPRINT_LED_GREEN);
  delay(2000);
  while (finger.getImage() != FINGERPRINT_NOFINGER);
  
  p = -1;
  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 10000, FINGERPRINT_LED_BLUE);
  Serial.println("Place the SAME finger again...");
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    if (p == FINGERPRINT_NOFINGER) { Serial.print("."); continue; }
    if (p != FINGERPRINT_OK) { Serial.println("\nImaging error, try again."); }
  }
  
  p = finger.image2Tz(2);
  if (p != FINGERPRINT_OK) {
    Serial.println("Conversion failed. Try again.");
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    delay(3000);
    return p;
  }
  
  p = finger.createModel();
  if (p == FINGERPRINT_ENROLLMISMATCH) {
    Serial.println("Fingers did not match! Try again.");
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    delay(3000);
    return p;
  }
  if (p != FINGERPRINT_OK) {
    Serial.println("Model creation error.");
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    delay(3000);
    return p;
  }
  
  p = finger.storeModel(slot);
  if (p != FINGERPRINT_OK) {
    Serial.println("Failed to store model on sensor.");
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    delay(3000);
    return p;
  }
  
  students[slot] = sID;
  saveStudents();
  
  Serial.print("\n✓ Enrolled Student #");
  Serial.print(sID);
  Serial.print(" at fingerprint slot #");
  Serial.println(slot);
  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_GREEN);
  delay(3000);
  return FINGERPRINT_OK;
}

// ========== SERVER COMMUNICATION ==========
bool signIn() {
  const int maxRetries = 3;
  int retryCount = 0;
  while (retryCount < maxRetries) {
    Serial.printf("Auth attempt %d/%d...\n", retryCount + 1, maxRetries);
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    http.setTimeout(15000);
    String url = String(serverEndpoint) + "/api/scanner/auth/login";
    if (!http.begin(client, url)) {
      Serial.println("  ✗ Failed to begin HTTP connection");
      http.end();
      delay(3000);
      retryCount++;
      continue;
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
      authToken = resp["token"].as<String>();
      scannerDbId = resp["user"]["id"].as<String>();
      Serial.println("✓ Scanner authenticated.");
      http.end();
      return true;
    } else {
      Serial.printf("  ✗ HTTP %d\n", code);
      http.end();
      delay(3000);
      retryCount++;
    }
  }
  Serial.println("✗ Authentication failed after all retries");
  return false;
}

void getDateTime(String &dateStr, String &timeStr) {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
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

void sendLog(int studentID, String method = "fingerprint") {
  if (authToken == "") return;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(10000);
  if (!http.begin(client, String(serverEndpoint) + "/api/logs")) {
    Serial.println("Failed to begin sendLog HTTP");
    http.end();
    return;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + authToken);
  String dateStr, timeStr;
  getDateTime(dateStr, timeStr);
  StaticJsonDocument<256> doc;
  doc["scanner_location"] = SCANNER_LOCATION;
  doc["scanner_id"] = SCANNER_ID;
  doc["student_id"] = studentID;
  doc["date_scanned"] = dateStr;
  doc["time_scanned"] = timeStr;
  doc["status"] = "present";
  doc["method"] = method;  // fingerprint, NFC, etc.
  String body;
  serializeJson(doc, body);
  int code = http.POST(body);
  if (code == 201) {
    Serial.printf("✓ Attendance logged via %s.\n", method.c_str());
  } else {
    Serial.printf("✗ Log failed, HTTP %d\n", code);
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
    Serial.println("Failed to begin heartbeat HTTP");
    http.end();
    return;
  }
  http.addHeader("Authorization", "Bearer " + authToken);
  int code = http.POST("");
  if (code != 200) {
    Serial.printf("Heartbeat failed: %d\n", code);
    authToken = "";
  }
  http.end();
}

void sendOutput(String msg, int commandId) {
  if (!webSocket.isConnected()) {
    Serial.println("WebSocket not connected, cannot send output.");
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
  Serial.printf("[CMD] Received: '%s' (id=%d)\n", cmd.c_str(), commandId);
  
  if (cmd == "scanner") {
    mode = "scanner";
    sendOutput("Switched to FINGERPRINT SCANNER mode.", commandId);
    return;
  }
  else if (cmd == "enroll") {
    mode = "enroll";
    sendOutput("Switched to FINGERPRINT ENROLL mode. Send a student ID to enroll.", commandId);
    return;
  }
  
  if (cmd == "slots show") {
    String msg = "Stored fingerprints: ";
    int count = 0;
    for (int i = 1; i <= MAX_FINGERPRINT_SLOTS; i++) {
      if (students[i] != 0) {
        msg += "slot" + String(i) + "=" + String(students[i]) + " ";
        count++;
      }
    }
    if (count == 0) msg = "No fingerprints stored.";
    sendOutput(msg, commandId);
    return;
  }
  else if (cmd == "slots reset") {
    memset(students, 0, sizeof(students));
    if (finger.emptyDatabase() == FINGERPRINT_OK) {
      saveStudents();
      sendOutput("All fingerprint slots have been erased.", commandId);
    } else {
      sendOutput("Failed to erase fingerprint sensor database.", commandId);
    }
    return;
  }
  else if (cmd == "reset") {
    mode = "scanner";
    sendOutput("Scanner reset to SCANNER mode.", commandId);
    return;
  }
  else if (cmd == "reauth") {
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
  
  if (cmd.startsWith("slots reset ")) {
    String slotStr = cmd.substring(12);
    slotStr.trim();
    int slot = slotStr.toInt();
    if (slot >= 1 && slot <= MAX_FINGERPRINT_SLOTS) {
      if (students[slot] != 0) {
        int oldStudent = students[slot];
        students[slot] = 0;
        saveStudents();
        sendOutput("Slot " + String(slot) + " (Student ID " + String(oldStudent) + ") cleared.", commandId);
      } else {
        sendOutput("Slot " + String(slot) + " was already empty.", commandId);
      }
    } else {
      sendOutput("Invalid slot number. Use 1-" + String(MAX_FINGERPRINT_SLOTS) + ".", commandId);
    }
    return;
  }
  
  // Handle numeric commands (student IDs for enrollment or fingerprint lookup)
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
        sendOutput("ERROR: No free fingerprint slots available!", commandId);
        return;
      }
      sendOutput("Enrolling Student ID " + String(studentID) + " into slot " + String(slot) + ". Waiting for fingerprint...", commandId);
      uint8_t result = getFingerprintEnroll(slot, studentID);
      if (result == FINGERPRINT_OK) {
        sendOutput("✓ Successfully enrolled Student ID " + String(studentID) + " into slot " + String(slot), commandId);
      } else {
        sendOutput("✗ Enrollment failed for Student ID " + String(studentID), commandId);
      }
    } else if (mode == "scanner") {
      int foundSlot = -1;
      for (int i = 1; i <= MAX_FINGERPRINT_SLOTS; i++) {
        if (students[i] == studentID) { foundSlot = i; break; }
      }
      if (foundSlot == -1) {
        sendOutput("Student ID " + String(studentID) + " not enrolled.", commandId);
        return;
      }
      sendLog(studentID, "fingerprint");
      sendOutput("Matched slot " + String(foundSlot) + " → Logged attendance for Student " + String(studentID), commandId);
    }
  } else {
    sendOutput("Unknown command: " + cmd, commandId);
  }
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
      Serial.printf("[WS] Received: %s\n", data.c_str());
      StaticJsonDocument<256> doc;
      DeserializationError err = deserializeJson(doc, data);
      if (err) { Serial.printf("JSON parse error: %s\n", err.c_str()); break; }
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
  Serial.printf("Connecting to %s", ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
    updateLedStatus();
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected.");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
    WifiConnected = true;
    updateLedStatus();
    delay(2000);
  } else {
    Serial.println("\nWiFi connection FAILED!");
    WifiConnected = false;
    updateLedStatus();
  }
}

// ========== SETUP ==========
void setup() {
  Serial.begin(115200);
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
  while (!WifiConnected) {
    delay(2000);
    connectWifi();
  }

  Serial.println("[INIT] Syncing time with NTP...");
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);

  Serial.println("[INIT] Authenticating with server...");
  if (!signIn()) {
    Serial.println("[ERROR] Fatal: cannot authenticate with server.");
    while (1) delay(1000);
  }

  Serial.println("[INIT] Connecting to WebSocket...");
  webSocket.beginSSL(wsHost, wsPort, wsPath);
  delay(500);
  for (int i = 0; i < 5; i++) {
      webSocket.loop();
      delay(10);
  }
  webSocket.onEvent(onWebSocketEvent);
  webSocket.setReconnectInterval(5000);

  Serial.println("\n========== READY ==========");
  Serial.println("Mode: " + mode);
  Serial.println("Use web terminal to send commands:");
  Serial.println("  - 'scanner'  : Switch to fingerprint scanner mode");
  Serial.println("  - 'enroll'   : Switch to enrollment mode");
  Serial.println("  - 'nfc'      : Switch to NFC scan mode");
  Serial.println("  - 'slots show' : Display stored fingerprints");
  Serial.println("  - 'slots reset' : Clear all fingerprints");
  Serial.println("=========================================\n");
}

// ========== LOOP ==========
void loop() {
    webSocket.loop();

    // Only poll for NFC when in scanner mode
    if (mode == "scanner" && millis() - lastNFCCheck >= NFC_CHECK_INTERVAL) {
        lastNFCCheck = millis();
        handleNFCCardNonBlocking();
    }

    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("WiFi lost – reconnecting...");
        WifiConnected = false;
        connectWifi();
    }

    updateLedStatus();

    // Fingerprint scanning in scanner or enroll mode
    if (fingerprintInitialized && (mode == "scanner" || mode == "enroll")) {
        int fingerID = scanFingerprint();
        if (fingerID >= 0) {
            int studentID = findStudent(fingerID);
            if (studentID > 0) {
                finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 2000, FINGERPRINT_LED_GREEN);
                Serial.print("Fingerprint matched slot #");
                Serial.print(fingerID);
                Serial.print(" → Student ID ");
                Serial.println(studentID);
                
                if (mode == "scanner") {
                    sendLog(studentID, "fingerprint");
                    sendOutput("Fingerprint Match - Logged attendance for Student " + String(studentID), -1);
                }
                delay(3000);
            }
        }
    }

    static unsigned long lastHeartbeat = 0;
    if (millis() - lastHeartbeat > 5000) {
        sendHeartbeat();
        lastHeartbeat = millis();
    }

    delay(10);
}

void handleNFCCardNonBlocking() {
    uint8_t uid[7];
    uint8_t uidLength;
    // Very short timeout (20 ms) – just polls, never blocks the loop
    bool success = nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 100);
    if (success) {
        Serial.println("✓ Found an ISO14443A card");
        Serial.print("  UID Length: "); Serial.print(uidLength, DEC); Serial.println(" bytes");
        Serial.print("  UID Value: "); nfc.PrintHex(uid, uidLength); Serial.println();

        if (uidLength == 7) {   // NTAG21x series
            Serial.println("Reading NDEF text record...");
            String nfcText = readNFCNDEFText();   // your existing function
            if (nfcText.length() > 0) {
                Serial.println("\n----- NFC TEXT DATA -----");
                Serial.println(nfcText);
                Serial.println("------------------------");

                nfcText.trim();
                bool isNumeric = true;
                for (unsigned int i = 0; i < nfcText.length(); i++) {
                    if (!isdigit(nfcText[i])) { isNumeric = false; break; }
                }
                if (isNumeric && nfcText.length() > 0) {
                    int studentID = nfcText.toInt();
                    sendLog(studentID, "NFC");
                    sendOutput("NFC Scan - Logged attendance for Student " + String(studentID), -1);
                } else {
                    sendOutput("NFC Scan - Text on tag is not a numeric student ID: " + nfcText, -1);
                }
            } else {
                sendOutput("NFC Scan - No valid NDEF text record found on tag.", -1);
            }
        }
        // Optional: add a short delay to avoid reading the same card repeatedly
        delay(500);   // prevents multiple logs for one tap
    }
}