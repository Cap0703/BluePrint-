#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include "FS.h"
#include "LittleFS.h"

// ========== CONFIGURATION ==========
const char ssid[] = "NETGEAR54";
const char password[] = "silentbird445";

const char* SCANNER_ID = "1";
const char* SCANNER_LOCATION = "204";
const char* SCANNER_PASSWORD = "BluePrint";

const char* serverEndpoint = "http://192.168.1.146:3000";   // Change to your server URL

const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 8;
const int daylightOffset_sec = 3600;

// ========== GLOBALS ==========
String authToken = "";
String scannerDbId = "";        // internal DB id of this scanner (from login)
String mode = "scanner";        // "scanner" or "enroll"
bool WifiConnected = false;

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
int mockScan(int &studentID);   // returns slot, fills studentID
void sendOutput(String msg, int commandId);
void sendHeartbeat();
void checkForCommand();
void handleCommand(String cmd, int commandId);
void sendLog(int studentID);
void getDateTime(String &dateStr, String &timeStr);
bool signIn();

// ========== FINGERPRINT HARDWARE (commented out – uncomment when hardware is available) ==========
/*
#include <Adafruit_Fingerprint.h>
#define RX_GPIO 16
#define TX_GPIO 17
HardwareSerial mySerial(2);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&mySerial);
#define FINGERPRINT_LED_GREEN 0x04
// ... all original fingerprint functions would go here
*/

// ========== MOCK FUNCTIONS (replace with real ones later) ==========

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
    // In real hardware: finger.emptyDatabase()
    Serial.println("[MOCK] All fingerprints deleted.");
    memset(students, 0, sizeof(students));
    saveStudents();
  } else {
    Serial.println("[MOCK] Deletion cancelled. Halting.");
    while (1) delay(1000);
  }
}

// Mock enrollment: just store studentID in the next free slot
void mockEnroll(int slot, int studentID) {
  students[slot] = studentID;
  saveStudents();
  Serial.printf("[MOCK] Enrolled Student ID %d into virtual slot %d\n", studentID, slot);
}

// Mock scan: returns slot number and fills studentID.
// In this mock, we don't have a real sensor; instead we'll simulate
// by using a global variable that holds the "scanned" student ID.
// But we'll rely on commands to trigger a scan. For simplicity, we'll
// have a separate function that is called from command handling.
// The mockScan() below just looks up a studentID from a given slot.
int mockScan(int &studentID) {
  // This is not used directly – scanning is simulated via commands.
  // We'll keep it for compatibility but the real logic will be in handleCommand.
  studentID = -1;
  return -1;
}

// ========== SERVER COMMUNICATION (from your working test) ==========

bool signIn() {
  HTTPClient http;
  String url = String(serverEndpoint) + "/api/scanner/auth/login";
  http.begin(url);
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
    scannerDbId = resp["user"]["id"].as<String>();   // get internal DB id
    Serial.println("✓ Scanner authenticated.");
    http.end();
    return true;
  } else {
    Serial.printf("✗ Authentication failed, HTTP %d\n", code);
    http.end();
    return false;
  }
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
  HTTPClient http;
  http.begin(String(serverEndpoint) + "/api/logs");
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
  HTTPClient http;
  http.begin(String(serverEndpoint) + "/api/scanners/" + scannerDbId + "/heartbeat");
  http.addHeader("Authorization", "Bearer " + authToken);
  int code = http.POST("");
  if (code != 200) {
    Serial.printf("Heartbeat failed: %d\n", code);
    connectWifi();
  }
  http.end();
}

void sendOutput(String msg, int commandId) {
  if (authToken == "" || scannerDbId == "") return;
  HTTPClient http;
  String url = String(serverEndpoint) + "/api/scanners/" + scannerDbId + "/terminal/output";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + authToken);

  StaticJsonDocument<256> doc;
  doc["output"] = msg;
  doc["mode"] = mode;
  doc["commandId"] = commandId;

  String body;
  serializeJson(doc, body);
  http.POST(body);
  http.end();
}

void checkForCommand() {
  if (authToken == "" || scannerDbId == "") return;
  HTTPClient http;
  String url = String(serverEndpoint) + "/api/scanners/" + scannerDbId + "/terminal";
  http.begin(url);
  http.addHeader("Authorization", "Bearer " + authToken);
  http.setTimeout(3000);

  int code = http.GET();
  if (code == 200) {
    String response = http.getString();
    StaticJsonDocument<512> doc;
    DeserializationError err = deserializeJson(doc, response);
    if (err) {
      Serial.printf("JSON parse error: %s\n", err.c_str());
      http.end();
      return;
    }
    if (!doc["command"].isNull()) {
      String command = doc["command"].as<String>();
      int commandId = doc["commandId"] | 0;
      handleCommand(command, commandId);
    }
  } else if (code != 200 && code > 0) {
    // ignore – no command or server error
  }
  http.end();
}

// ========== COMMAND HANDLING (supports mode switching, enrollment, simulated scanning) ==========

void handleCommand(String cmd, int commandId) {
  Serial.printf("[CMD] %s (id=%d)\n", cmd.c_str(), commandId);

  // ------------------------------------------------------------------
  // Mode switching
  // ------------------------------------------------------------------
  if (cmd == "scanner") {
    mode = "scanner";
    sendOutput("Switched to scanner mode. Send a student ID (number) to simulate fingerprint scan.", commandId);
    return;
  }
  else if (cmd == "enroll") {
    mode = "enroll";
    sendOutput("Switched to enroll mode. Send a student ID (number) to enroll that student into next free virtual slot.", commandId);
    return;
  }

  // ------------------------------------------------------------------
  // Administrative / utility commands
  // ------------------------------------------------------------------
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
    // Reset mode to scanner (no slot clearing)
    mode = "scanner";
    sendOutput("Scanner reset to scanner mode. All pending state cleared.", commandId);
    return;
  }
  else if (cmd == "reauth") {
    if (signIn()) {
      sendOutput("Re-authentication successful.", commandId);
    } else {
      sendOutput("Re-authentication FAILED. Check network or server.", commandId);
    }
    return;
  }

  // ------------------------------------------------------------------
  // Reset specific slot: e.g., "reset 5"
  // ------------------------------------------------------------------
  if (cmd.startsWith("slots reset ")) {
    String slotStr = cmd.substring(12); // after "reset "
    slotStr.trim();
    int slot = slotStr.toInt();
    if (slot >= 1 && slot <= MAX_FINGERPRINT_SLOTS) {
      if (students[slot] != 0) {
        int oldStudent = students[slot];
        students[slot] = 0;
        saveStudents();
        String msg = "Slot " + String(slot) + " (Student ID " + String(oldStudent) + ") has been cleared.";
        sendOutput(msg, commandId);
      } else {
        String msg = "Slot " + String(slot) + " was already empty.";
        sendOutput(msg, commandId);
      }
    } else {
      String msg = "Invalid slot number. Use 1-" + String(MAX_FINGERPRINT_SLOTS) + ".";
      sendOutput(msg, commandId);
    }
    return;
  }

  // ------------------------------------------------------------------
  // Numeric command handling (enrollment or scanning)
  // ------------------------------------------------------------------
  bool isNumeric = true;
  for (unsigned int i = 0; i < cmd.length(); i++) {
    if (!isdigit(cmd[i])) {
      isNumeric = false;
      break;
    }
  }

  if (isNumeric) {
    int studentID = cmd.toInt();

    if (mode == "enroll") {
      // Enroll mode: store this student ID in the next free slot
      int slot = getNextFreeSlot();
      if (slot == -1) {
        handleStorageFull();
        sendOutput("ERROR: No free fingerprint slots available!", commandId);
        return;
      }
      mockEnroll(slot, studentID);
      String msg = "Enrolled Student ID " + String(studentID) + " into virtual slot " + String(slot);
      sendOutput(msg, commandId);
    }
    else { // scanner mode
      // Look up if studentID exists in any slot
      int foundSlot = -1;
      for (int i = 1; i <= MAX_FINGERPRINT_SLOTS; i++) {
        if (students[i] == studentID) {
          foundSlot = i;
          break;
        }
      }
      if (foundSlot == -1) {
        String msg = "Student ID " + String(studentID) + " not enrolled in any fingerprint slot.";
        sendOutput(msg, commandId);
        return;
      }
      // Log attendance
      sendLog(studentID);
      String msg = "Fingerprint matched slot " + String(foundSlot) + " → Logged attendance for Student " + String(studentID);
      sendOutput(msg, commandId);
    }
  }
  else {
    // Unknown command
    sendOutput("Unknown command: " + cmd, commandId);
  }
}

void connectWifi(){
  // Connect to WiFi with timeout
  Serial.printf("Connecting to %s", ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {  // 40 * 500ms = 20 seconds
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected.");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
    WifiConnected = true;
  } else {
    Serial.println("\nWiFi connection FAILED!");
    Serial.print("Status code: ");
    Serial.println(WiFi.status());
    WifiConnected = false;
    // You can decide to halt or retry later
    while (1) delay(1000);
  }
}

// ========== SETUP ==========
void setup() {
  Serial.begin(115200);
  delay(1000);
  // Initialize LittleFS
  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS mount failed!");
    while (1) delay(1);
  }
  loadStudents();

  Serial.println(WifiConnected);

  while(!WifiConnected) {
    connectWifi();
  }
  // NTP for timestamps
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);

  Serial.println(WifiConnected);

  // Authenticate with server
  if (!signIn()) {
    Serial.println("Fatal: cannot authenticate with server.");
    while (1) delay(1000);
  }

  delay(1500);

  if (!signIn()) {
    Serial.println("Fatal: cannot authenticate with server.");
    while (1) delay(1000);
  }

  Serial.println("Ready. Mode: " + mode);
  Serial.println("Use web terminal to send commands.");
}

// ========== LOOP ==========
void loop() {
  checkForCommand();
  static unsigned long lastHeartbeat = 0;
  if (millis() - lastHeartbeat > 5000) {
    sendHeartbeat();
    lastHeartbeat = millis();
  }
  delay(750);
}   