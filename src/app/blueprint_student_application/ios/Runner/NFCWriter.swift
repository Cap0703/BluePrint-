import CoreNFC

class NFCWriter: NSObject, NFCNDEFReaderSessionDelegate {
    var session: NFCNDEFReaderSession?
    var messageToWrite: NFCNDEFMessage?
    var completion: ((Bool, String?) -> Void)?

    func write(text: String, completion: @escaping (Bool, String?) -> Void) {
        self.completion = completion
        let langCode = "en"
        let langData = langCode.data(using: .ascii)!
        let textData = text.data(using: .utf8)!
        var payload = Data([UInt8(langData.count)])
        payload.append(langData)
        payload.append(textData)
        let record = NFCNDEFPayload(
            format: .nfcWellKnown,
            type: "T".data(using: .utf8)!,
            identifier: Data(),
            payload: payload
        )
        messageToWrite = NFCNDEFMessage(records: [record])
        session = NFCNDEFReaderSession(delegate: self, queue: nil, invalidateAfterFirstRead: false)
        session?.alertMessage = "Hold your iPhone near the NFC tag to write."
        session?.begin()
    }

    func readerSession(_ session: NFCNDEFReaderSession, didDetect tags: [NFCNDEFTag]) {
        guard let tag = tags.first, let message = messageToWrite else {
            session.invalidate(errorMessage: "No tag or message found")
            completion?(false, "No tag or message found")
            return
        }
        session.connect(to: tag) { error in
            if let error = error {
                session.invalidate(errorMessage: error.localizedDescription)
                self.completion?(false, error.localizedDescription)
                return
            }
            tag.queryNDEFStatus { status, _, error in
                if let error = error {
                    session.invalidate(errorMessage: error.localizedDescription)
                    self.completion?(false, error.localizedDescription)
                    return
                }
                guard status == .readWrite else {
                    session.invalidate(errorMessage: "Tag is not writable")
                    self.completion?(false, "Tag is read-only")
                    return
                }
                tag.writeNDEF(message) { error in
                    if let error = error {
                        session.invalidate(errorMessage: "Write failed")
                        self.completion?(false, error.localizedDescription)
                    } else {
                        session.alertMessage = "Write successful!"
                        session.invalidate()
                        self.completion?(true, nil)
                    }
                }
            }
        }
    }

    func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {}

    func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        print("Session error:", error.localizedDescription)
        completion?(false, error.localizedDescription)
        completion = nil
    }
}