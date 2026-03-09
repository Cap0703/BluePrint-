import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:uuid/uuid.dart';
import 'package:flutter_nfc_kit/flutter_nfc_kit.dart';

void main() {
  runApp(const MyApp());
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
      backgroundColor: Colors.indigo,

      body: SingleChildScrollView(
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
      );
  }
}

class HomeScreen extends StatelessWidget {
  final String token;
  const HomeScreen({super.key, required this.token});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.indigo,

      body: SingleChildScrollView(
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
          )
        ),
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
    return const Icon(
      Icons.fingerprint,
      size: 100,
      color: Colors.indigo,
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
        } // Added missing closing brace for the 'if' statement
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
        } // Added missing closing brace for the 'if' statement
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
  final uuid = Uuid();

  Future<void> authenticateUser(BuildContext context) async {
    String studentID = sIDController.text;
    String password = passwordController.text;
    String uuID = uuid.v4();

    final url = Uri.parse("https://blueprint-tm.ddns.net/api/app/auth/login");
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
          MaterialPageRoute(builder: (context) => HomeScreen(token: token)),
        );
      } else {
        print("Token missing in response");
      }
    } else {
        print("Login failed: ${response.statusCode}");
    }
  }
    catch(e) {
      print("Error $e");
    }
  }
  @override
  Widget build(BuildContext context) {
    return ElevatedButton(
      onPressed: () {
        if (formKey.currentState!.validate()){
          String studentID = sIDController.text;
          String password = passwordController.text;
          String uuID = uuid.v4();
          authenticateUser(context);
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

