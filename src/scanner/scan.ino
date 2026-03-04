/***************************************************
  This is an example sketch for our optical Fingerprint sensor

  Designed specifically to work with the Adafruit BMP085 Breakout
  ----> http://www.adafruit.com/products/751

  These displays use TTL Serial to communicate, 2 pins are required to
  interface
  Adafruit invests time and resources providing this open source code,
  please support Adafruit and open-source hardware by purchasing
  products from Adafruit!

  Written by Limor Fried/Ladyada for Adafruit Industries.
  BSD license, all text above must be included in any redistribution
 ****************************************************/


#include <Adafruit_Fingerprint.h>
#include <WiFi.h> 
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "LittleFS.h"
#include <time.h>

#define FINGERPRINT_LED_GREEN 0x04

const char* ssid = "BraveWeb";
const char* password = "Br@veW3b";
const char* SCANNER_ID = "1";
const char* SCANNER_LOCATION = "204";
const char* SCANNER_PASSWORD = "BluePrint";
const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 8;
const int daylightOffset_sec = 3600;
String authToken = "";
String pendingCommand = "";
String lastCommandOutput = "";
unsigned long lastCommandCheck = 0;
const unsigned long COMMAND_CHECK_INTERVAL = 5000;

String serverEndpoint = "blueprint-tm.ddns.net";


#if (defined(__AVR__) || defined(ESP8266)) && !defined(__AVR_ATmega2560__)
// For UNO and others without hardware serial, we must use software serial...
// pin #2 is IN from sensor (GREEN wire)
// pin #3 is OUT from arduino  (WHITE wire)
// Set up the serial port to use softwareserial..
SoftwareSerial mySerial(2, 3);

#else
// On Leonardo/M0/etc, others with hardware serial, use hardware serial!
// #0 is green wire, #1 is white
#define mySerial Serial1

#endif

Adafruit_Fingerprint finger = Adafruit_Fingerprint(&mySerial);

void setup()
{
  Serial.begin(9600);
  while (!Serial);  // For Yun/Leo/Micro/Zero/...
  delay(100);
  Serial.println("\n\nAdafruit finger detect test");

  WiFi.begin(ssid, password);
  Serial.println("Connecting...");
  while(WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.print("Connected to WiFi network with IP Address: ");
  Serial.println(WiFi.localIP());
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  struct tm timeinfo;

  if(!getLocalTime(&timeinfo)){
    Serial.println("Failed to obtain time");
    return;
  }
  Serial.println("Signing in to the Website");
  String token = signIn();
  // set the data rate for the sensor serial port
  finger.begin(57600);
  delay(5);
  if (finger.verifyPassword()) {
    Serial.println("Found fingerprint sensor!");
  } else {
    Serial.println("Did not find fingerprint sensor :(");
    while (1) { delay(1); }
  }

  Serial.println(F("Reading sensor parameters"));
  finger.getParameters();
  Serial.print(F("Status: 0x")); Serial.println(finger.status_reg, HEX);
  Serial.print(F("Sys ID: 0x")); Serial.println(finger.system_id, HEX);
  Serial.print(F("Capacity: ")); Serial.println(finger.capacity);
  Serial.print(F("Security level: ")); Serial.println(finger.security_level);
  Serial.print(F("Device address: ")); Serial.println(finger.device_addr, HEX);
  Serial.print(F("Packet len: ")); Serial.println(finger.packet_len);
  Serial.print(F("Baud rate: ")); Serial.println(finger.baud_rate);

  finger.getTemplateCount();

  if (finger.templateCount == 0) {
    Serial.print("Sensor doesn't contain any fingerprint data. Please enroll students.");
  }
  else {
    Serial.println("Waiting for valid finger...");
      Serial.print("Sensor contains "); Serial.print(finger.templateCount); Serial.println(" templates");
  }
}

int findStudent(int fingerprintID) {
    int students[128] = {0};
    File file = LittleFS.open("/students.bin", FILE_READ);
    if (file) {
        file.read((uint8_t*)students, sizeof(students));
        file.close();
    }
    return students[fingerprintID];
}

void loop()                     // run over and over again
{
  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 4000, FINGERPRINT_LED_BLUE);
  getFingerprintID();
  delay(50);            //don't ned to run this at full speed.
}

uint8_t getFingerprintID() {
  uint8_t p = finger.getImage();
  switch (p) {
    case FINGERPRINT_OK:
      Serial.println("Image taken");
      break;
    case FINGERPRINT_NOFINGER:
      Serial.println("No finger detected");
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
      return p;
    case FINGERPRINT_PACKETRECIEVEERR:
      Serial.println("Communication error");
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
      return p;
    case FINGERPRINT_IMAGEFAIL:
      Serial.println("Imaging error");
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
      return p;
    default:
      Serial.println("Unknown error");
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
      return p;
  }

  // OK success!

  p = finger.image2Tz();
  switch (p) {
    case FINGERPRINT_OK:
      Serial.println("Image converted");
      break;
    case FINGERPRINT_IMAGEMESS:
      Serial.println("Image too messy");
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
      return p;
    case FINGERPRINT_PACKETRECIEVEERR:
      Serial.println("Communication error");
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
      return p;
    case FINGERPRINT_FEATUREFAIL:
      Serial.println("Could not find fingerprint features");
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
      return p;
    case FINGERPRINT_INVALIDIMAGE:
      Serial.println("Could not find fingerprint features");
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
      return p;
    default:
      Serial.println("Unknown error");
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
      return p;
  }

  // OK converted!
  p = finger.fingerSearch();
  if (p == FINGERPRINT_OK) {
    Serial.println("Found a print match!");
  } else if (p == FINGERPRINT_PACKETRECIEVEERR) {
    Serial.println("Communication error");
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    return p;
  } else if (p == FINGERPRINT_NOTFOUND) {
    Serial.println("Did not find a match");
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    return p;
  } else {
    Serial.println("Unknown error");
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    return p;
  }

  // found a match!
  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 4000, FINGERPRINT_LED_GREEN);
  Serial.print("Found ID #"); Serial.print(finger.fingerID);
  Serial.print(" with confidence of "); Serial.println(finger.confidence);
  sendLog(findStudent(finger.fingerID));
  delay(3000);
  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 4000, FINGERPRINT_LED_BLUE);

  return finger.fingerID;
}

// returns -1 if failed, otherwise returns ID #
int getFingerprintIDez() {
  uint8_t p = finger.getImage();
  if (p != FINGERPRINT_OK)  return -1;

  p = finger.image2Tz();
  if (p != FINGERPRINT_OK)  return -1;

  p = finger.fingerFastSearch();
  if (p != FINGERPRINT_OK)  return -1;

  // found a match!
  Serial.print("Found ID #"); Serial.print(finger.fingerID);
  Serial.print(" with confidence of "); Serial.println(finger.confidence);
  return finger.fingerID;
}

void getDateTime(String dateStr, String timeStr){
 struct tm timeinfo;
  
  if(!getLocalTime(&timeinfo)){
    Serial.println("Failed to obtain time");
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

bool signIn(){
  HTTPClient http;
  http.begin(serverEndpoint + "/api/scanner/auth/login");
  http.addHeader("Content-Type", "application/json");
  StaticJsonDocument<256> doc;
  doc["SCANNER_ID"] = SCANNER_ID;
  doc["SCANNER_LOCATION"] = SCANNER_LOCATION;
  doc["SCANNER_PASSWORD"] = SCANNER_PASSWORD;
  String requestBody;
  serializeJson(doc, requestBody);
  int httpResponseCode = http.POST(requestBody);
  if (httpResponseCode == 200) {
    String response = http.getString();
    StaticJsonDocument<512> responseDoc;
    authToken = responseDoc["token"].as<String>();
    Serial.println("Successfully signed in to the website!");
    http.end();
    return true;
  } else {
    Serial.print("Failed to sign in. HTTP Response code: ");
    Serial.println(httpResponseCode);
    return false;
  }
}

void sendLog(int studentID) {
  if(authToken == "") {
    Serial.println("Not authenticated with the website. Cannot send log.");
    return;
  }
  HTTPClient http;
  String dateScanned;
  String timeScanned;
  getDateTime(dateScanned, timeScanned);
  String serverPath = serverEndpoint + "/api/logs";
  http.begin(String(serverEndpoint) + "/api/logs");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + authToken);
  StaticJsonDocument<512> doc;
  doc["period"] = "";
  doc["scanner_location"] = SCANNER_LOCATION;
  doc["scanner_id"] = SCANNER_ID;
  doc["student_id"] = studentID;
  doc["first_name"] = "";
  doc["last_name"] = "";
  doc["time_scanned"] = timeScanned;
  doc["date_scanned"] = dateScanned;
  doc["status"] = "present";
  String requestBody;
  serializeJson(doc, requestBody);
  int httpResponseCode = http.POST(requestBody);
  if (httpResponseCode == 201) {
    Serial.println("Log sent successfully!");
  }
  else {
    Serial.print("Failed to send log: ");
    Serial.println(httpResponseCode);
  }
}

void checkForCommands() {
  if (millis() - lastCommandCheck < COMMAND_CHECK_INTERVAL) {
    return;
  }
  lastCommandCheck = millis();
  if (authToken == "") {
    return;
  }
  HTTPClient http;
  String commandEndpoint = serverEndpoint + "/api/scanners/" + SCANNER_ID + "/terminal";
  http.begin(commandEndpoint);
  http.addHeader("Authorization", "Bearer " + authToken);
  int httpResponseCode = http.GET();
  if (httpResponseCode == 200) {
    String response = http.getString();
    StaticJsonDocument<256> responseDoc;
    DeserializationError error = deserializeJson(responseDoc, response);
    if (!error && responseDoc.containsKey("command")) {
      const char* cmdPtr = responseDoc["command"];
      if (cmdPtr != nullptr) {
        pendingCommand = String(cmdPtr);
        if (pendingCommand.length() > 0) {
          Serial.println("Received command: " + pendingCommand);
          executeCommand(pendingCommand);
        }
      }
    }
  }
  http.end();
}

void sendCommandOutput(String output) {
  if (authToken == "") {
    Serial.println("Not authenticated. Cannot send command output.");
    return;
  }
  HTTPClient http;
  String outputEndpoint = serverEndpoint + "/api/scanners/" + SCANNER_ID + "/terminal/output";
  http.begin(outputEndpoint);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + authToken);
  StaticJsonDocument<512> doc;
  doc["output"] = output;
  doc["timestamp"] = String(millis());
  String requestBody;
  serializeJson(doc, requestBody);
  int httpResponseCode = http.POST(requestBody);
  if (httpResponseCode == 200) {
    Serial.println("Command output sent successfully");
  } else {
    Serial.print("Failed to send command output: ");
    Serial.println(httpResponseCode);
  }
  http.end();
}

void executeCommand(String command) {
  command = command.toLowerCase();
  lastCommandOutput = "";
  if (command == "status") {
    lastCommandOutput = "Scanner Status: Active. Fingerprints enrolled: ";
    lastCommandOutput += String(finger.templateCount);
  } else if (command == "restart") {
    lastCommandOutput = "Restarting scanner...";
    delay(1000);
    ESP.restart();
  } else if (command == "wifi_info") {
    lastCommandOutput = "WiFi SSID: ";
    lastCommandOutput += String(ssid);
    lastCommandOutput += " | IP: ";
    lastCommandOutput += WiFi.localIP().toString();
  } else if (command == "sync_time") {
    struct tm timeinfo;
    if (getLocalTime(&timeinfo)) {
      char buffer[30];
      strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M:%S", &timeinfo);
      lastCommandOutput = "Current time: ";
      lastCommandOutput += String(buffer);
    } else {
      lastCommandOutput = "Failed to get time";
    }
  } else if (command == "clear_fingerprints") {
    if (finger.deleteModel(0) == FINGERPRINT_OK) {
      lastCommandOutput = "All fingerprints cleared";
    } else {
      lastCommandOutput = "Failed to clear fingerprints";
    }
  } else if (command.startsWith("set_location:")) {
    String newLocation = command.substring(13);
    lastCommandOutput = "Location set to: " + newLocation;
  } else {
    lastCommandOutput = "Unknown command: " + command;
  }
  sendCommandOutput(lastCommandOutput);
}
