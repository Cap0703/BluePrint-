#include <Adafruit_Fingerprint.h>
#include "FS.h"
#include "LittleFS.h"
#include <vector>

#define RX_GPIO 16
#define TX_GPIO 17

#define FINGERPRINT_LED_PINK 0x01
#define FINGERPRINT_LED_GREEN 0x04

int id = 0;
int studentID;
int studentNum = 1;

std::vector<int> studentIDs;
std::vector<int> fingerprintIDs;

HardwareSerial mySerial(2);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&mySerial);

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

  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS Mount Failed");
    return;
  }

  Serial.println("LittleFS Ready");
  id = getNextFreeID();
  Serial.print("Starting at ID slot: ");
  Serial.println(id + 1);
  configSD("/students.csv");
}

int getNextFreeID() {
  finger.getTemplateCount();
  return finger.templateCount;
}

void configSD(const char* path) {
  Serial.println("Checking LittleFS file...");
  if (!LittleFS.exists(path)) {
    File file = LittleFS.open(path, FILE_WRITE);
    if (!file) {
      Serial.println("ERROR: Could not create file!");
      return;
    }
    Serial.println("New file created. Writing header...");
    file.println("FingerprintID,StudentID");
    file.close();
  } else {
    Serial.println("File already exists.");
  }
  Serial.println("LittleFS file ready.");
}

void isStorageFull() {
  if (id >= 127) {
    Serial.println("No free fingerprint slots.");
    Serial.println("Delete all stored fingerprints? (y/n)");

    while (!Serial.available());
    char response = Serial.read();

    if (response == 'y' || response == 'Y') {
      if (finger.emptyDatabase() == FINGERPRINT_OK) {
        Serial.println("All fingerprints deleted.");
        fingerprintIDs.clear();
        studentIDs.clear();
        id = 0;
      } else {
        Serial.println("Failed to delete database.");
      }
    } else {
      Serial.println("Enrollment cancelled.");
    }
  }
}

void saveStudent(int fingerprintID, int sID) {
    // Read existing array or create new one
    int students[128] = {0}; // adjust 128 to your max fingerprint count
    
    File file = LittleFS.open("/students.bin", FILE_READ);
    if (file) {
        file.read((uint8_t*)students, sizeof(students));
        file.close();
    }
    
    // Set the sID at the fingerprintID index
    students[fingerprintID] = sID;
    
    // Write back
    file = LittleFS.open("/students.bin", FILE_WRITE);
    if (!file) {
        Serial.println("Failed to open file.");
        return;
    }

    file.write((uint8_t*)students, sizeof(students));
    file.close();
    Serial.println("Saved successfully.");
}

int readnumber(void) {
  int num = 0;
  while (num == 0) {
    while (!Serial.available());
    num = Serial.parseInt();
  }
  return num;
}

void loop() {
  isStorageFull();
  Serial.println("Ready to enroll a fingerprint!");
  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 4000, FINGERPRINT_LED_BLUE);
  Serial.println("Please type the Student ID you want to save this finger as...");

  studentID = readnumber();
  fingerprintIDs.push_back(id + 1);
  studentIDs.push_back(studentID);

  Serial.print("Enrolling Student ID #");
  Serial.println(studentID);
  while (!getFingerprintEnroll());
}

uint8_t getFingerprintEnroll() {
  int p = -1;
  Serial.print("Waiting for valid finger to enroll as Student #");
  Serial.println(studentIDs.back());

  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    switch (p) {
      case FINGERPRINT_OK:      Serial.println("Image taken"); break;
      case FINGERPRINT_NOFINGER: Serial.print("."); break;
      case FINGERPRINT_PACKETRECIEVEERR: Serial.println("Communication error"); break;
      case FINGERPRINT_IMAGEFAIL: Serial.println("Imaging error"); break;
      default: Serial.println("Unknown error"); break;
    }
  }

  p = finger.image2Tz(1);
  switch (p) {
    case FINGERPRINT_OK: Serial.println("Image converted"); break;
    case FINGERPRINT_IMAGEMESS: Serial.println("Image too messy"); return p;
    case FINGERPRINT_PACKETRECIEVEERR: Serial.println("Communication error"); return p;
    case FINGERPRINT_FEATUREFAIL: Serial.println("Could not find fingerprint features"); return p;
    case FINGERPRINT_INVALIDIMAGE: Serial.println("Could not find fingerprint features"); return p;
    default: Serial.println("Unknown error"); return p;
  }

  Serial.println("Remove finger");
  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 4000, FINGERPRINT_LED_GREEN);
  delay(2000);
  p = 0;
  while (p != FINGERPRINT_NOFINGER) {
    p = finger.getImage();
  }

  Serial.print("\nStudent ID: "); Serial.println(fingerprintIDs.back());
  Serial.print("BluePrints Stored: "); Serial.println(id);
  p = -1;

  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 10000, FINGERPRINT_LED_BLUE);
  Serial.println("Place same finger again");
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    switch (p) {
      case FINGERPRINT_OK: break;
      case FINGERPRINT_NOFINGER: Serial.print("."); break;
      case FINGERPRINT_PACKETRECIEVEERR:
      case FINGERPRINT_IMAGEFAIL:
      default:
        Serial.println("Error, try again");
        finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
        delay(5000);
        break;
    }
  }

  p = finger.image2Tz(2);
  switch (p) {
    case FINGERPRINT_OK: break;
    case FINGERPRINT_IMAGEMESS: Serial.println("Image too messy"); finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED); delay(5000); return p;
    case FINGERPRINT_PACKETRECIEVEERR: Serial.println("Communication error"); finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED); delay(5000); return p;
    case FINGERPRINT_FEATUREFAIL:
    case FINGERPRINT_INVALIDIMAGE: Serial.println("Could not find features"); finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED); delay(5000); return p;
    default: Serial.println("Unknown error"); finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED); delay(5000); return p;
  }

  p = finger.createModel();
  if (p == FINGERPRINT_ENROLLMISMATCH) {
    Serial.println("Fingerprints did not match");
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    delay(5000);
    return p;
  } else if (p != FINGERPRINT_OK) {
    Serial.println("Error creating model");
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    delay(5000);
    return p;
  }
  Serial.println("Prints matched!");

  p = finger.storeModel(id + 1);
  if (p == FINGERPRINT_OK) {
    id++;
    Serial.print("Stored at slot #"); Serial.println(id);
    Serial.print("Total stored: "); Serial.println(id);
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_GREEN);
    saveStudent(id, studentID);
    delay(5000);
  } else {
    Serial.println("Failed to store");
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    delay(5000);
    return p;
  }

  return true;
}