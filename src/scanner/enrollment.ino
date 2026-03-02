#include <Adafruit_Fingerprint.h>
#include "FS.h"
#include "LittleFS.h"

#define RX_GPIO 16
#define TX_GPIO 17

#define MAX_FINGERPRINT_SLOTS 127
#define STUDENTS_BIN "/students.bin"

#define FINGERPRINT_LED_PINK 0x01
#define FINGERPRINT_LED_GREEN 0x04

int students[MAX_FINGERPRINT_SLOTS + 1] = {0};
int id = 0;
int studentID = 0;

HardwareSerial mySerial(2);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&mySerial);

void loadStudents() {
  File file = LittleFS.open(STUDENTS_BIN, FILE_READ);
  if (file) {
    file.read((uint8_t*)students, sizeof(students));
    file.close();
    Serial.println("Student map loaded from flash.");
  } else {
    Serial.println("No student map found, starting fresh.");
    memset(students, 0, sizeof(students));
  }
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

int getNextFreeSlot() {
  for (int slot = 1; slot <= MAX_FINGERPRINT_SLOTS; slot++) {
    if (students[slot] == 0) return slot;
  }
  return -1;
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

void loop() {
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
}