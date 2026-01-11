/**************************************************************************/
/*!
    @file     readntag203_esp32_i2c_ascii.ino
    @author   KTOWN (modified for ESP32 I2C)
    @license  BSD
    Reads NTAG203/215/213 cards and prints readable English text.
*/
/**************************************************************************/
#include <Wire.h>
#include <Adafruit_PN532.h>
#define LED 2

#define PN532_IRQ   2
#define PN532_RESET 3

Adafruit_PN532 nfc(PN532_IRQ, PN532_RESET);

void setup(void) {
  Serial.begin(115200);
  while (!Serial) delay(100);

  pinMode(LED, OUTPUT);

  Serial.println("Hello ESP32 + PN532 over I2C! (ASCII Reader)");

  nfc.begin();
  nfc.SAMConfig(); // Required for I2C

  uint32_t versiondata = nfc.getFirmwareVersion();
  if (!versiondata) {
    Serial.println("Didn't find PN532 board");
    while (1);
  }

  Serial.print("Found chip PN5"); Serial.println((versiondata >> 24) & 0xFF, HEX);
  Serial.print("Firmware ver. "); Serial.print((versiondata >> 16) & 0xFF, DEC);
  Serial.print('.'); Serial.println((versiondata >> 8) & 0xFF, DEC);

  Serial.println("Waiting for an ISO14443A Card ...");
}

void loop(void) {
  uint8_t success;
  uint8_t uid[7];
  uint8_t uidLength;

  // Wait for an NTAG card
  success = nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength);

  if (success) {
    digitalWrite(LED, HIGH);
    Serial.println("Found an ISO14443A card");
    Serial.print("  UID Length: "); Serial.print(uidLength, DEC); Serial.println(" bytes");
    Serial.print("  UID Value: "); nfc.PrintHex(uid, uidLength); Serial.println();

    if (uidLength == 7) {
      uint8_t data[4];
      Serial.println("Reading NTAG2xx tag (ASCII output)...");

      // NTAG215 = 135 pages, NTAG203 = 42 pages
      uint8_t maxPages = 135;

      String asciiText = ""; // collect readable text

      for (uint8_t i = 4; i < maxPages; i++) { // start at page 4 = user memory
        success = nfc.ntag2xx_ReadPage(i, data);

        if (success) {
          for (int j = 0; j < 4; j++) {
            if (data[j] >= 0x20 && data[j] <= 0x7E) { // printable ASCII
              asciiText += (char)data[j];
            } else {
              asciiText += ' '; // replace non-printable with space
            }
          }
        }
      }

      Serial.println("\n----- ASCII DATA -----");
      Serial.println(asciiText);
      Serial.println("--------------------");
    }

    // Wait before scanning again
    Serial.println("\nSend a character to scan another tag!");
    Serial.flush();
    while (!Serial.available());
    while (Serial.available()) Serial.read();
    Serial.flush();
    digitalWrite(LED, LOW);
  }
}
