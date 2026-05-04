import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:uuid/uuid.dart';
//import 'package:nfc_manager/nfc_manager.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter/services.dart';
void main() {
  runApp(const MyApp());
}

const _nfcChannel = MethodChannel('nfc/writer');

Future<String> getUUID() async {
  final prefs  = await SharedPreferences.getInstance();
  String? storedUUID = prefs.getString('device_uuid');
  
  if (storedUUID != null && storedUUID.isNotEmpty) {
    return storedUUID;
  }

  final uuid = Uuid();
  String newUUID = uuid.v4();

  await prefs.setString('device_uuid', newUUID);

  return newUUID;
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false, 
      theme: ThemeData(
        primarySwatch: Colors.indigo,
      ),
      home: const LoginScreen(),
    );
  }
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
    
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}
class _LoginScreenState extends State<LoginScreen> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  
  final TextEditingController sIDController = TextEditingController();
  final TextEditingController passwordController = TextEditingController();
  
  @override 
  // protects information entered from being leaked 
  void dispose() {
    sIDController.dispose();
    passwordController.dispose();
    super.dispose();
  }
  @override
  Widget build(BuildContext context) {
    return Scaffold(

      body: SizedBox.expand (
        child:Container(
        decoration: const BoxDecoration(
          image: DecorationImage(
            image: AssetImage("assets/boo_background.png"),
            fit: BoxFit.cover,
          ),
        ),
      
      child: SingleChildScrollView(
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.grey.withAlpha(80),
              border: Border.all(
                width: 2,
                color: Colors.deepPurple.shade900,
              ),
              borderRadius: BorderRadius.circular(12),
            ),

            child: Form(
              key: _formKey,
              child:Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                const FingerprintIcon(),
                const SizedBox(height: 16),
                const InstructionText(),
                const SizedBox(height: 20),
                StudentIDField(controller: sIDController),
                PasswordField(controller: passwordController),
                ContinueButton(formKey: _formKey, sIDController: sIDController, passwordController: passwordController),
              ],
            ),
          ),
          ),
        ),
      ),
    )
    )
  )
  );
  }
}

class HomeScreen extends StatelessWidget {
  final String token;
  final String studentID;
  const HomeScreen({super.key, required this.token, required this.studentID});

  Future<void> _logout(BuildContext context) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('device_uuid');
    if (context.mounted) {
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const LoginScreen()),
        (_) => false,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SizedBox.expand(
        child: Container(
          decoration: const BoxDecoration(
            image: DecorationImage(
              image: AssetImage("assets/boo_background.png"),
              fit: BoxFit.cover,
            ),
          ),
          child: SingleChildScrollView(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: Colors.grey.withAlpha(80),
                    border: Border.all(
                      width: 2,
                      color: Colors.deepPurple.shade900,
                    ),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      nfcScannerButtonEnable(studentID: studentID, token: token),
                      const SizedBox(height: 20),
                      ElevatedButton(
                        onPressed: () => _logout(context),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.red.shade700,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 40,
                            vertical: 12,
                          ),
                          textStyle: const TextStyle(fontSize: 16),
                        ),
                        child: const Text('Logout'),
                      ),
                      const SizedBox(height: 40),
                      const loginInstructionText(),
                      const loginInstructionImage(),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
///FingerprintLogoWidget
class FingerprintIcon extends StatelessWidget { 
  const FingerprintIcon({super.key});

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      "assets/blueprint_logo.png",
      width: 100,
      height: 100,
    );
  }
}

/// Welcome message text widget
class InstructionText extends StatelessWidget {
  const InstructionText({super.key});

  @override
  Widget build(BuildContext context) {
    return const Text(
      'Welcome To BluePrint\nPlease Enter Your Login Info',
      textAlign: TextAlign.center,
      style: TextStyle(
        fontSize: 24,
        color: Colors.white,
      ),
    );
  }
}
/// Text Box For Student ID
class StudentIDField extends StatelessWidget {
  final TextEditingController controller;
  const StudentIDField({super.key, required this.controller});
  
  @override
  Widget build(BuildContext context){
    return TextFormField(
  // The validator receives the text that the user has entered.
      controller: controller,
      decoration: const InputDecoration(
        labelText: 'Student ID',
        border: OutlineInputBorder(),
        contentPadding: EdgeInsets.symmetric(
          vertical: 18,
          horizontal: 12,
        ),
      ),
      validator: (value) {
        if (value == null || value.isEmpty) {
          return 'Please enter some text';
        } 
        return null;
      }, 
    ); 
  }
}

/// Text Box For Password
class PasswordField extends StatelessWidget {
  final TextEditingController controller;
  const PasswordField({super.key, required this.controller});
  
  @override
  Widget build(BuildContext context){
    return TextFormField(
      // The validator receives the text that the user has entered.
      controller: controller,
      obscureText: true,
      decoration: const InputDecoration(
        labelText: 'Password',
        border: OutlineInputBorder(),
        contentPadding: EdgeInsets.symmetric(
          vertical: 18,
          horizontal: 12,
        ),
      ),
      validator: (value) {
        if (value == null || value.isEmpty) {
          return 'Please enter some text';
        } 
        return null;
      }, 
    ); 
  }
}

/// Continue button widget
class ContinueButton extends StatelessWidget {
  final GlobalKey<FormState> formKey;
  final TextEditingController sIDController;
  final TextEditingController passwordController;
  ContinueButton({super.key, required this.formKey, required this.sIDController, required this.passwordController});
  

  Future<String> authenticateUser(BuildContext context) async {
    String studentID = sIDController.text;
    String password = passwordController.text;
    String uuID = await getUUID();

    final url = Uri.parse("https://blueprint.boo/api/app/auth/login");
  try {
    final response = await http.post(url,
    headers: {
      "Content-Type": "application/json",
    },
    body: jsonEncode({
      "student_id": studentID,
      "password": password,
      "uuid": uuID,
    }),
    );

    if (response.statusCode == 200){
      final data = jsonDecode(response.body);

      String? token = data["token"];

      if (token != null && token.isNotEmpty) {
        print("Token received: $token");
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (context) => HomeScreen(
              token: token,
              studentID: studentID,
            ),
          ),
        );
        return token;
      } else {
        print("Token missing in response");
        return "";
      }
    } else {
        print("Login failed: ${response.statusCode}");
        return "";
    }
  }
    catch(e, stack) {
      print("Error $e");
      print(stack);
      return "";
    }
  }
  @override
  Widget build(BuildContext context) {
    return ElevatedButton(
      onPressed: () async {
        if (formKey.currentState!.validate()){
          String studentID = sIDController.text;
          String password = passwordController.text;
          String uuID = await getUUID();
          await authenticateUser(context);
          print("Student ID: $studentID");
          print("Password: $password");
          print("UUID:  $uuID");
          
        }
      },
      style: ElevatedButton.styleFrom(
        backgroundColor: Colors.indigo.shade700,
        padding: const EdgeInsets.symmetric(
          horizontal: 32,
          vertical: 12,
        ),
        textStyle: const TextStyle(fontSize: 18),
      ),
      child: const Text('Continue'),
    );
  }
}
Future<String> getNFCMessage(String studentID, String token) async {
  final url = Uri.parse("https://blueprint.boo/api/app/encrypt_student_id");
  final response = await http.post(
    url,
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer $token",
    },
    body: jsonEncode({"student_id": studentID}),
  );

  if (response.statusCode == 200) {
    final data = jsonDecode(response.body);

    final encryptedData = data["encryptedData"] as String?;
    final iv            = data["iv"]            as String?;
    final authTag       = data["authTag"]       as String?;
    final date          = data["date"]          as String?;

    if ([encryptedData, iv, authTag, date].any((f) => f == null || f.isEmpty)) {
      print("Incomplete payload from server");
      return '';
    }

    final tagString = "$encryptedData|$iv|$authTag|$date";
    print("Tag payload ready: $tagString");
    return tagString;

  } else {
    print("Failed to get NFC message: ${response.statusCode}");
    return '';
  }
}
bool isScanning = false;
bool cancelRequested = false;

void resetCancelCall(){
  cancelRequested = false;
}

class nfcScannerButtonEnable extends StatefulWidget {
  const nfcScannerButtonEnable({super.key, required this.studentID, required this.token});
  final String studentID;
  final String token;

  @override
  State<nfcScannerButtonEnable> createState() => _nfcScannerButtonEnableState();
}

class _nfcScannerButtonEnableState extends State<nfcScannerButtonEnable> {
  bool _isWriting = false;
  String _buttonLabel = 'Write NFC Tag';

  Future<void> _handleScan() async {
    if (_isWriting) return;
    setState(() {
      _isWriting = true;
      _buttonLabel = 'Waiting...';
    });
    try {
      final message = await getNFCMessage(widget.studentID, widget.token);
      if (message.isEmpty) {
        _showSnack('Failed to get NFC message from server');
        return;
      }
      final result = await _nfcChannel.invokeMethod<String>('writeNFC', message);
      _showSnack(result == 'success' ? 'NFC tag written!' : 'Unexpected result');
    } on PlatformException catch (e) {
      final msg = e.message ?? '';
      if (msg.toLowerCase().contains('cancel') || 
          msg.toLowerCase().contains('invalidat') ||
          msg.toLowerCase().contains('session')) {
        _showSnack('NFC cancelled — tap the button to try again');
      } else {
        _showSnack('NFC Error: $msg');
      }
    } catch (e) {
      _showSnack('Error: $e');
    } finally {
      setState(() {
        _isWriting = false;
        _buttonLabel = 'Write NFC Tag';
      });
    }
  }

  void _showSnack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ElevatedButton(
      onPressed: _isWriting ? null : _handleScan,
      style: ElevatedButton.styleFrom(
        backgroundColor: _isWriting
            ? Colors.grey
            : const Color.fromARGB(255, 57, 242, 16),
        padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 20),
        textStyle: const TextStyle(fontSize: 18),
      ),
      child: Text(_buttonLabel),
    );
  }
}

class loginInstructionText extends StatelessWidget {
  const loginInstructionText({super.key});

  @override
  Widget build(BuildContext context) {
    return const Text(
      "Tutorial for Use",
      style: TextStyle(
        fontSize: 24,
        color: Colors.white,
        fontWeight: FontWeight.bold,
      ),
      textAlign: TextAlign.center,
     );
  }

}

class loginInstructionImage extends StatelessWidget {
  const loginInstructionImage({super.key});

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      "assets/scanner_tutorial.png",
      width: 300,
      height: 300,
    );

  }
}