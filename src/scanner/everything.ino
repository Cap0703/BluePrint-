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

String serverEndpoint = "http://blueprint.boo";

const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 8;
const int daylightOffset_sec = 3600;

int students[MAX_FINGERPRINT_SLOTS + 1] = {0};
char* mode = "enroll";

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

int getNextFreeSlot() {
  for (int slot = 1; slot <= MAX_FINGERPRINT_SLOTS; slot++) {
    if (students[slot] == 0) return slot;
  }
  return -1;
}

void saveStudents() {
  File file = LittleFS.open(STUDENTS_BIN, FILE_WRITE);
  if (!file) {
    Serial.println("ERROR: Could not open student map for writing!");
    return;
  }
  file.write((uint8_t*)students, sizeof(students));
  file.close();
  Serial.println("Student map saved.");
}

void handleStorageFull() {
  Serial.println("\nNo free fingerprint slots!");
  Serial.println("Delete ALL stored fingerprints? (y/n)");

  while (!Serial.available());
  char response = Serial.read();

  if (response == 'y' || response == 'Y') {
    if (finger.emptyDatabase() == FINGERPRINT_OK) {
      Serial.println("All fingerprints deleted from sensor.");
      memset(students, 0, sizeof(students));
      saveStudents();
      id = 1;
    } else {
      Serial.println("Failed to delete sensor database.");
    }
  } else {
    Serial.println("Deletion cancelled. Halting.");
    while (1) delay(1000);
  }
}

int readPositiveInt() {
  int num = 0;
  while (num <= 0) {
    while (!Serial.available());
    num = Serial.parseInt();
    if (num <= 0) Serial.println("Please enter a number greater than 0.");
  }
  return num;
}

uint8_t getFingerprintEnroll(int slot, int sID) {
  int p = -1;

  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 4000, FINGERPRINT_LED_BLUE);
  Serial.println("Place finger on sensor...");
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    if (p == FINGERPRINT_NOFINGER) { Serial.print("."); continue; }
    if (p != FINGERPRINT_OK)       { Serial.println("\nImaging error, try again."); }
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
    if (p != FINGERPRINT_OK)       { Serial.println("\nImaging error, try again."); }
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

  Serial.print("\nEnrolled Student #");
  Serial.print(sID);
  Serial.print(" at fingerprint slot #");
  Serial.println(slot);
  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_GREEN);
  delay(3000);
  return FINGERPRINT_OK;
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

char* getCommand() {
  if (authToken =="") return;

  HTTPClient http;

  http.begin(serverEndpoint + $"/api/scanners/{SCANNER_ID}/terminal");

  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + authToken);
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
    //save for syncing here?
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
    Serial.println("Fingerprint sensor not found! Check wiring.");
    while (1) delay(1);
  }
  Serial.println("Fingerprint sensor OK.");

  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS mount failed!");
    while (1) delay(1);
  }
  Serial.println("LittleFS ready.");
  loadStudents();

  id = getNextFreeSlot();
  if (id == -1) {
    handleStorageFull();
  }
  Serial.print("Next free slot: #");
  Serial.println(id);

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
  if(mode.equals("enroll")){
    id = getNextFreeSlot();
    if (id == -1) {
      handleStorageFull();
      return;
    }

    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 4000, FINGERPRINT_LED_BLUE);
    Serial.println("\n--- Ready to enroll ---");
    Serial.print("Free slots remaining: ");
    Serial.println(MAX_FINGERPRINT_SLOTS - (id - 1));
    Serial.println("Enter Student ID to enroll:");

    studentID = readPositiveInt();
    Serial.print("Enrolling Student ID #");
    Serial.print(studentID);
    Serial.print(" into slot #");
    Serial.println(id);

    while (getFingerprintEnroll(id, studentID) != FINGERPRINT_OK) {
      Serial.println("Retrying enrollment...");
    }

  } else {
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
}