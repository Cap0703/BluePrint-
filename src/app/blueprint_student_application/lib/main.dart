import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:uuid/uuid.dart';
import 'package:nfc_manager/nfc_manager.dart';
import 'package:shared_preferences/shared_preferences.dart';
void main() {
  runApp(const MyApp());
}

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
                          child:Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                nfcScannerButtonEnable(studentID: studentID, token: token),
                nfcScannerButtonDisable(),
                const SizedBox(height: 40),
                const loginInstructionText(),
                const loginInstructionImage(),

              ],
            ),
          )
        ),
      )
      )
    )
    )
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
    ); // breakpoint here

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
Future<String> getNFCMessage (String studentID, String token) async{
  final url = Uri.parse("https://blueprint.boo/api/app/encrypt_student_id");
  final response = await http.post(url,
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer $token"
    },
    body: jsonEncode({
      "student_id": studentID
    }),
    );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        String? encryptedID = data["encryptedData"];
        if (encryptedID != null && encryptedID.isNotEmpty) {
          print("Encrypted ID received: $encryptedID");
          return encryptedID;
        } else {
          print("Encrypted ID missing in response");
          return '';
        }
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


Future<void> writeNFCTag(String message) async {
  resetCancelCall();
  isScanning = true;

  await NfcManager.instance.startSession(
    pollingOptions: {
      NfcPollingOption.iso14443,
    },
    onDiscovered: (NfcTag tag) async {
      if (cancelRequested) {
        print("Close Scanner stopped the session");
        await NfcManager.instance.stopSession();
        isScanning = false;
        return;
      }

      try {
        Ndef? ndef = Ndef.from(tag);

        if (ndef == null) {
          // Tag may be blank — try formatting it
          final ndefFormatable = NdefFormatable.from(tag);
          if (ndefFormatable == null) {
            print('Tag does not support NDEF or formatting');
            await NfcManager.instance.stopSession();
            isScanning = false;
            return;
          }
          final record = NdefRecord.createText(message);
          final messageNdef = NdefMessage([record]);
          await ndefFormatable.format(messageNdef);
          print('Successfully formatted and wrote to NFC tag');
        } else {
          if (!ndef.isWritable) {
            print('Tag is read-only');
            await NfcManager.instance.stopSession();
            isScanning = false;
            return;
          }
          final record = NdefRecord.createText(message);
          final messageNdef = NdefMessage([record]);
          await ndef.write(messageNdef);
          print('Successfully wrote to NFC tag');
        }
      } catch (e) {
        print('Write failed: $e');
      }

      await NfcManager.instance.stopSession();
      isScanning = false;
    },
  );
}

class nfcScannerButtonEnable extends StatelessWidget {
  const nfcScannerButtonEnable({super.key, required this.studentID, required this.token});
  
  final String studentID;
  final String token;

  @override
  Widget build(BuildContext context) {
    return ElevatedButton(
      onPressed: () async {
        if(isScanning) {
          print ("Scanner already active");
          return;
          
        }

        String message = await getNFCMessage(studentID, token);
        
        if (message.isNotEmpty){
          await writeNFCTag(message);
        }
        else {
          print("Message write request failed");
        }
        
      },
      style: ElevatedButton.styleFrom(
        backgroundColor: const Color.fromARGB(255, 57, 242, 16),
        padding: const EdgeInsets.symmetric(
          horizontal: 40,
          vertical: 20,
        ),
        textStyle: const TextStyle(fontSize: 18, color: Color.fromARGB(255, 5, 88, 7)),
      ),
      child: const Text('Open Scanner'),
    );
}




}

class nfcScannerButtonDisable extends StatelessWidget {
  const nfcScannerButtonDisable({super.key});
  
  @override
  Widget build(BuildContext context) {
    return ElevatedButton(
      onPressed: () {
        if (isScanning) {
          cancelRequested = true;
          isScanning = false;
          NfcManager.instance.stopSession();

          
          print("Close Scanner Button Pressed: Stop Requested");
        }
        
      },
      style: ElevatedButton.styleFrom(
        backgroundColor: const Color.fromARGB(255, 255, 0, 0),
        padding: const EdgeInsets.symmetric(
          horizontal: 40,
          vertical: 20,
        ),
        textStyle: const TextStyle(fontSize: 18, color: Color.fromARGB(255, 92, 9, 9)),
         
      ),
      child: const Text('Close Scanner'),
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