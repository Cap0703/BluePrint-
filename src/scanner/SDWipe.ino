#include <Adafruit_Fingerprint.h>
#include "LittleFS.h"

HardwareSerial mySerial(2);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&mySerial);

void setup() {
  Serial.begin(115200);
  delay(1000);

  mySerial.begin(57600, SERIAL_8N1, 16, 17);
  finger.begin(57600);

  if (!finger.verifyPassword()) {
    Serial.println("❌ Sensor not found");
    while (true);
  }

  // Wipe fingerprints
  if (finger.emptyDatabase() == FINGERPRINT_OK) {
    Serial.println("✅ All fingerprints deleted");
  } else {
    Serial.println("❌ Failed to wipe fingerprints");
  }

  // Wipe LittleFS students.csv
  if (!LittleFS.begin(true)) {
    Serial.println("❌ LittleFS mount failed");
    return;
  }

  if (LittleFS.exists("/students.csv")) {
    LittleFS.remove("/students.csv");
    Serial.println("✅ students.csv deleted");
  } else {
    Serial.println("ℹ️ students.csv not found, nothing to delete");
  }

  // Recreate empty file with header
  File file = LittleFS.open("/students.csv", FILE_WRITE);
  if (file) {
    file.println("FingerprintID,StudentID");
    file.close();
    Serial.println("✅ Fresh students.csv created");
  } else {
    Serial.println("❌ Failed to recreate students.csv");
  }
}

void loop() {}