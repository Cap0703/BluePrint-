#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include "FS.h"
#include "LittleFS.h"
#include <WiFiClientSecure.h>
#include <Adafruit_Fingerprint.h>
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

// ========== GLOBALS ==========
String authToken = "";
String scannerDbId = "";
String mode = "scanner";
bool WifiConnected = false;
bool fingerprintInitialized = false;
uint8_t lastLedColor = FINGERPRINT_LED_RED;

// Virtual fingerprint mapping: slot -> student ID
#define MAX_FINGERPRINT_SLOTS 127
#define STUDENTS_BIN "/students.bin"

int students[MAX_FINGERPRINT_SLOTS + 1] = {0};

// ========== FORWARD DECLARATIONS ==========
void loadStudents();
void saveStudents();
int getNextFreeSlot();
void handleStorageFull();
void mockEnroll(int slot, int studentID);
void sendOutput(String msg, int commandId);
void sendHeartbeat();
void handleCommand(String cmd, int commandId);
void sendLog(int studentID);
void getDateTime(String &dateStr, String &timeStr);
bool signIn();
void connectWifi();
void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length);
void initializeFingerprint();
void updateLedStatus();

// ========== FINGERPRINT ==========
void initializeFingerprint() {
  mySerial.begin(57600, SERIAL_8N1, RX_GPIO, TX_GPIO);
  delay(5);
  finger.begin(57600);
  delay(100);
  if (finger.verifyPassword()) {
    Serial.println("Found fingerprint sensor!");
    fingerprintInitialized = true;
    finger.LEDcontrol(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_RED);
    lastLedColor = FINGERPRINT_LED_RED;
  } else {
    Serial.println("Did not find fingerprint sensor :(");
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

// ========== LITTLEFS ==========
void loadStudents() {
  File file = LittleFS.open(STUDENTS_BIN, FILE_READ);
  if (file) {
    file.read((uint8_t*)students, sizeof(students));
    file.close();
    Serial.println("[MOCK] Student map loaded from LittleFS.");
  } else {
    Serial.println("[MOCK] No student map found, starting fresh.");
    memset(students, 0, sizeof(students));
  }
}

void saveStudents() {
  File file = LittleFS.open(STUDENTS_BIN, FILE_WRITE);
  if (!file) {
    Serial.println("[MOCK] ERROR: Could not write student map!");
    return;
  }
  file.write((uint8_t*)students, sizeof(students));
  file.close();
  Serial.println("[MOCK] Student map saved to LittleFS.");
}

int getNextFreeSlot() {
  for (int slot = 1; slot <= MAX_FINGERPRINT_SLOTS; slot++) {
    if (students[slot] == 0) return slot;
  }
  return -1;
}

void handleStorageFull() {
  Serial.println("[MOCK] No free fingerprint slots!");
  Serial.println("Would you like to delete ALL stored fingerprints? (y/n)");
  while (!Serial.available());
  char response = Serial.read();
  if (response == 'y' || response == 'Y') {
    Serial.println("[MOCK] All fingerprints deleted.");
    memset(students, 0, sizeof(students));
    saveStudents();
  } else {
    Serial.println("[MOCK] Deletion cancelled. Halting.");
    while (1) delay(1000);
  }
}

void mockEnroll(int slot, int studentID) {
  students[slot] = studentID;
  saveStudents();
  Serial.printf("[MOCK] Enrolled Student ID %d into virtual slot %d\n", studentID, slot);
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

void sendLog(int studentID) {
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
  String body;
  serializeJson(doc, body);
  int code = http.POST(body);
  if (code == 201) {
    Serial.println("✓ Attendance logged.");
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
    sendOutput("Switched to scanner mode.", commandId);
    return;
  }
  else if (cmd == "enroll") {
    mode = "enroll";
    sendOutput("Switched to enroll mode. Send a student ID to enroll.", commandId);
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
    saveStudents();
    sendOutput("All fingerprint slots have been erased.", commandId);
    return;
  }
  else if (cmd == "reset") {
    mode = "scanner";
    sendOutput("Scanner reset to scanner mode.", commandId);
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
      mockEnroll(slot, studentID);
      sendOutput("Enrolled Student ID " + String(studentID) + " into slot " + String(slot), commandId);
    } else {
      int foundSlot = -1;
      for (int i = 1; i <= MAX_FINGERPRINT_SLOTS; i++) {
        if (students[i] == studentID) { foundSlot = i; break; }
      }
      if (foundSlot == -1) {
        sendOutput("Student ID " + String(studentID) + " not enrolled.", commandId);
        return;
      }
      sendLog(studentID);
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

  Serial.println("Initializing fingerprint sensor...");
  initializeFingerprint();

  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS mount failed!");
    while (1) delay(1);
  }
  loadStudents();

  connectWifi();
  while (!WifiConnected) {
    delay(2000);
    connectWifi();
  }

  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);


  if (!signIn()) {
    Serial.println("Fatal: cannot authenticate with server.");
    while (1) delay(1000);
  }

  webSocket.beginSSL(wsHost, wsPort, wsPath); 
  webSocket.onEvent(onWebSocketEvent);
  webSocket.setReconnectInterval(5000);

  Serial.println("Ready. Mode: " + mode);
  Serial.println("Use web terminal to send commands.");
}

// ========== LOOP ==========
void loop() {
  webSocket.loop();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi lost – reconnecting...");
    WifiConnected = false;
    connectWifi();
  }

  updateLedStatus();

  static unsigned long lastHeartbeat = 0;
  if (millis() - lastHeartbeat > 5000) {
    sendHeartbeat();
    lastHeartbeat = millis();
  }

  delay(100);
}
