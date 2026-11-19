import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'screens/dashboard_screen.dart';
import 'screens/pairing_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  final hasToken = prefs.getString('device_token') != null;

  runApp(ASTRYONMobileApp(isPaired: hasToken));
}

class ASTRYONMobileApp extends StatelessWidget {
  final bool isPaired;

  const ASTRYONMobileApp({super.key, required this.isPaired});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ASTRYON Mobile Gateway',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.teal),
        useMaterial3: true,
      ),
      home: isPaired ? const DashboardScreen() : const PairingScreen(),
    );
  }
}
