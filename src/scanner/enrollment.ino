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
  Small bug-fix by Michael cochez

  BSD license, all text above must be included in any redistribution
 ****************************************************/

#include <Adafruit_Fingerprint.h>
#include <vector>
#include "FS.h"
#include "SD.h"
#include "SPI.h"
#include "FS.h"
#include "LittleFS.h"


#if (defined(__AVR__) || defined(ESP8266)) && !defined(__AVR_ATmega2560__)
// For UNO and others without hardware serial, we must use software serial...
// pin #2 is IN from sensor (GREEN wire)
// pin #3 is OUT from arduino  (WHITE wire)
// Set up the serial port to use softwareserial..
SoftwareSerial mySerial(2, 3);

#else
// On Leonardo/M0/etc, others with hardware serial, use hardware serial!
// #0 is green wire, #1 is white

#endif

#define RX_GPIO 16
#define TX_GPIO 17
#define SD_CS 5

// Explicit SPI pins for ESP32 VSPI
#define SPI_SCK  18
#define SPI_MISO 19
#define SPI_MOSI 23

#define FINGERPRINT_LED_PINK 0x01
#define FINGERPRINT_LED_GREEN 0x04

std::vector<std::vector<int>> idMatrix;
// only holds 127 prints?
int id = 0;
int studentID;
// the above are to only be used for translating student id's to fingerprint id range

int fingerID = 0;
int studentNum = 1;
// the above are used to more intuitively index through the matrix


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
  configSD("/students.csv");
}

int getNextFreeID() {
  for (int i = 1; i <= 127; i++) {
    if (finger.loadModel(i) != FINGERPRINT_OK) {
      return i;  // slot is empty
    }
  }
  return -1; // no free slots
}

void configSD(const char * path) {
  Serial.println("Checking LittleFS file...");

  if (!LittleFS.exists(path)) {
    File file = LittleFS.open(path, FILE_WRITE);
    if (!file) {
      Serial.println("ERROR: Could not create file!");
      return;
    }
    Serial.println("New file detected. Writing header...");
    file.println("FingerprintID,StudentID");
    file.close();
  } else {
    Serial.println("File already contains data.");
  }

  Serial.println("LittleFS file ready.");
}

void isStorageFull() {
  if (id == -1) {
    Serial.println("No free fingerprint slots.");
    Serial.println("Delete all stored fingerprints? (y/n)");

    while (!Serial.available());
    char response = Serial.read();

    if (response == 'y' || response == 'Y') {
      if (finger.emptyDatabase() == FINGERPRINT_OK) {
        Serial.println("All fingerprints deleted.");
        idMatrix.clear();   // clear your local mapping too
      } else {
        Serial.println("Failed to delete database.");
        return;
      }
    } else {
      Serial.println("Enrollment cancelled. \n CAPACITY REACHED: CONTINUING TO ENROLL WILL DELETE DATA");
      return;
    }
  }
}

void saveStudent(int fingerprintID, int studentID) {
  Serial.println("Saving to LittleFS...");

  File file = LittleFS.open("/students.csv", FILE_APPEND);
  if (!file) {
    Serial.println("Failed to open file.");
    return;
  }

  file.print(fingerprintID);
  file.print(",");
  file.println(studentID);
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

void loop()                     // run over and over again
{
  isStorageFull();
  Serial.println("Ready to enroll a fingerprint!");
  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 4000, FINGERPRINT_LED_BLUE);
  Serial.println("Please type the Student ID you want to save this finger as...");

  studentID = readnumber();

  id++;
  idMatrix.push_back({id, studentID});

  if (id == 0) {// ID #0 not allowed, try again!
     return;
  }
  Serial.print("Enrolling ID #");
  Serial.println(studentID);
  id--;
  while (!getFingerprintEnroll() );
}

uint8_t getFingerprintEnroll() {

  int p = -1;
  Serial.print("Waiting for valid finger to enroll as Student #"); Serial.println(idMatrix.back()[studentNum]);
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    switch (p) {
    case FINGERPRINT_OK:
      Serial.println("Image taken");
      break;
    case FINGERPRINT_NOFINGER:
      Serial.print(".");
      break;
    case FINGERPRINT_PACKETRECIEVEERR:
      Serial.println("Communication error");
      break;
    case FINGERPRINT_IMAGEFAIL:
      Serial.println("Imaging error");
      break;
    default:
      Serial.println("Unknown error");
      break;
    }
  }

  // OK success!

  p = finger.image2Tz(1);
  switch (p) {
    case FINGERPRINT_OK:
      Serial.println("Image converted");
      break;
    case FINGERPRINT_IMAGEMESS:
      Serial.println("Image too messy");
      return p;
    case FINGERPRINT_PACKETRECIEVEERR:
      Serial.println("Communication error");
      return p;
    case FINGERPRINT_FEATUREFAIL:
      Serial.println("Could not find fingerprint features");
      return p;
    case FINGERPRINT_INVALIDIMAGE:
      Serial.println("Could not find fingerprint features");
      return p;
    default:
      Serial.println("Unknown error");
      return p;
  }

  Serial.println("Remove finger");
  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 4000, FINGERPRINT_LED_GREEN);
  delay(2000);
  p = 0;
  while (p != FINGERPRINT_NOFINGER) {
    p = finger.getImage();
  }

  Serial.print("\nStudent ID: ");
  Serial.print(idMatrix.back()[studentNum]);
  Serial.print("\nBluePrints Stored: "); 
  Serial.println(id);
  p = -1;

  finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 10000, FINGERPRINT_LED_BLUE);
  Serial.println("Place same finger again");
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    switch (p) {
    case FINGERPRINT_OK:
      //Serial.println("Image taken");
      break;
    case FINGERPRINT_NOFINGER:
      Serial.print(".");
      break;
    case FINGERPRINT_PACKETRECIEVEERR:
      Serial.println("Communication error");
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
      delay(5000);
      break;
    case FINGERPRINT_IMAGEFAIL:
      Serial.println("Imaging error");
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
      delay(5000);
      break;
    default:
      Serial.println("Unknown error");
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
      delay(5000);
      break;
    }
  }

  p = finger.image2Tz(2);
  switch (p) {
    case FINGERPRINT_OK:
      //Serial.println("Image converted");
      break;
    case FINGERPRINT_IMAGEMESS:
      Serial.println("Image too messy");
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
      delay(5000);
      return p;
    case FINGERPRINT_PACKETRECIEVEERR:
      Serial.println("Communication error");
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
      delay(5000);
      return p;
    case FINGERPRINT_FEATUREFAIL:
      Serial.println("Could not find fingerprint features");
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
      delay(5000);
      return p;
    case FINGERPRINT_INVALIDIMAGE:
      Serial.println("Could not find fingerprint features");
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
      delay(5000);
      return p;
    default:
      Serial.println("Unknown error");
      finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
      delay(5000);
      return p;
  }

  Serial.print("Creating model for #");  Serial.println(id + 1);

  p = finger.createModel();
  if (p == FINGERPRINT_OK) {
    Serial.println("Prints matched!");
  } else if (p == FINGERPRINT_PACKETRECIEVEERR) {
    Serial.println("Communication error");
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    delay(5000);
    return p;
  } else if (p == FINGERPRINT_ENROLLMISMATCH) {
    Serial.println("Fingerprints did not match");
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    delay(5000);
    return p;
  } else {
    Serial.println("Unknown error");
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    delay(5000);
    return p;
  }

  Serial.print("ID "); Serial.println(id + 1);
  p = finger.storeModel(id);
  if (p == FINGERPRINT_OK) {
    Serial.println("Stored!");
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_GREEN);
    id++;
    saveStudent(id, studentID);
    delay(5000);
  } else if (p == FINGERPRINT_PACKETRECIEVEERR) {
    Serial.println("Communication error");
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    delay(5000);
    return p;
  } else if (p == FINGERPRINT_BADLOCATION) {
    Serial.println("Could not store in that location");
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    delay(5000);
    return p;
  } else if (p == FINGERPRINT_FLASHERR) {
    Serial.println("Error writing to flash");
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    delay(5000);
    return p;
  } else {
    Serial.println("Unknown error");
    finger.LEDcontrol(FINGERPRINT_LED_BREATHING, 47, FINGERPRINT_LED_RED);
    delay(5000);
    return p;
  }

  return true;
}