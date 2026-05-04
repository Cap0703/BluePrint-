import UIKit
import Flutter

@main
@objc class AppDelegate: FlutterAppDelegate {

    private var nfcWriter = NFCWriter()
    private var nfcChannel: FlutterMethodChannel?

    override func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        let flutterEngine = FlutterEngine(name: "main engine")
        flutterEngine.run()
        GeneratedPluginRegistrant.register(with: flutterEngine)
        registerNFCChannel(messenger: flutterEngine.binaryMessenger)
        let flutterViewController = FlutterViewController(engine: flutterEngine, nibName: nil, bundle: nil)
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = flutterViewController
        window?.makeKeyAndVisible()
        return super.application(application, didFinishLaunchingWithOptions: launchOptions)
    }

    private func registerNFCChannel(messenger: FlutterBinaryMessenger) {
        nfcChannel = FlutterMethodChannel(name: "nfc/writer", binaryMessenger: messenger)
        nfcChannel?.setMethodCallHandler { [weak self] call, result in
            guard call.method == "writeNFC" else {
                result(FlutterMethodNotImplemented)
                return
            }
            guard let message = call.arguments as? String else {
                result(FlutterError(
                    code: "INVALID_ARG",
                    message: "Expected a String argument",
                    details: nil
                ))
                return
            }
            self?.nfcWriter.write(text: message) { success, error in
                DispatchQueue.main.async {
                    if success {
                        result("success")
                    } else {
                        result(FlutterError(
                            code: "NFC_ERROR",
                            message: error ?? "Unknown NFC error",
                            details: nil
                        ))
                    }
                }
            }
        }
        print("NFC channel registered on nfc/writer")
    }
}