#include <Adafruit_Fingerprint.h>
#include "FS.h"
#include "LittleFS.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>

#define RX_GPIO 16
#define TX_GPIO 17

#define MAX_FINGERPRINT_SLOTS 127
#define STUDENTS_BIN "/students.bin"

#define FINGERPRINT_LED_GREEN 0x04

const char* ssid = "BraveWeb";
const char* password = "Br@veW3b";

const char* SCANNER_ID = "1";
const char* SCANNER_LOCATION = "204";
const char* SCANNER_PASSWORD = "BluePrint";

String serverEndpoint = "http://blueprint-tm.ddns.net";

const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 8;
const int daylightOffset_sec = 3600;

int students[MAX_FINGERPRINT_SLOTS + 1] = {0};

String authToken = "";

HardwareSerial mySerial(2);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&mySerial);

void loadStudents() {
  File file = LittleFS.open(STUDENTS_BIN, FILE_READ);

  if (file) {
    file.read((uint8_t*)students, sizeof(students));
    file.close();
    Serial.println("Student map loaded.");
  } else {
    Serial.println("No student map found.");
    memset(students, 0, sizeof(students));
  }
}

int findStudent(int fingerprintID) {
  if (fingerprintID < 1 || fingerprintID > MAX_FINGERPRINT_SLOTS) return -1;
  return students[fingerprintID];
}

bool signIn() {

  HTTPClient http;

  http.begin(serverEndpoint + "/api/scanner/auth/login");
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

    Serial.println("Scanner authenticated.");
    http.end();
    return true;
  }

  Serial.println("Authentication failed.");
  http.end();
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

  HTTPClient http;

  http.begin(serverEndpoint + "/api/logs");

  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + authToken);

  String dateStr;
  String timeStr;

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
    Serial.println("Attendance logged.");
  } else {
    Serial.print("Log failed: ");
    Serial.println(code);
  }

  http.end();
}

int scanFingerprint() {

  uint8_t p = finger.getImage();
  if (p != FINGERPRINT_OK) return -1;

  p = finger.image2Tz();
  if (p != FINGERPRINT_OK) return -1;

  p = finger.fingerSearch();
  if (p != FINGERPRINT_OK) return -1;

  return finger.fingerID;
}

void setup() {

  Serial.begin(115200);
  while (!Serial);
  delay(100);

  mySerial.begin(57600, SERIAL_8N1, RX_GPIO, TX_GPIO);
  finger.begin(57600);

  if (!finger.verifyPassword()) {
    Serial.println("Fingerprint sensor not found!");
    while (1) delay(1);
  }

  Serial.println("Fingerprint sensor ready.");

  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS mount failed!");
    while (1) delay(1);
  }

  Serial.println("LittleFS ready.");

  loadStudents();

  Serial.println("Connecting to WiFi...");

  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi connected.");
  Serial.println(WiFi.localIP());

  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);

  Serial.println("Signing into server...");

  signIn();
}

void loop() {

  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 1000, FINGERPRINT_LED_BLUE);

  int fingerID = scanFingerprint();

  if (fingerID < 0) return;

  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 2000, FINGERPRINT_LED_GREEN);

  Serial.print("Fingerprint matched slot #");
  Serial.println(fingerID);

  int studentID = findStudent(fingerID);

  if (studentID <= 0) {
    Serial.println("No student mapped to this fingerprint.");
    delay(2000);
    return;
  }

  Serial.print("Student ID: ");
  Serial.println(studentID);

  sendLog(studentID);

  delay(3000);
}