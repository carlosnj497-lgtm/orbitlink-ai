import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'screens/dashboard_screen.dart';
import 'screens/pairing_screen.dart';
import 'services/background_service.dart';
import 'services/token_store.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await BackgroundService.init();

  final isPaired = await TokenStore.hasToken();

  runApp(ASTRYONMobileApp(initiallyPaired: isPaired));
}

ThemeData buildASTRYONTheme(Brightness brightness) {
  final isDark = brightness == Brightness.dark;
  final colorScheme = ColorScheme.fromSeed(
    seedColor: const Color(0xFF2F80ED),
    brightness: brightness,
  ).copyWith(
    secondary: const Color(0xFFF2C94C),
    onSecondary: const Color(0xFF102A43),
  );

  return ThemeData(
    colorScheme: colorScheme,
    useMaterial3: true,
    scaffoldBackgroundColor:
        isDark ? colorScheme.surface : const Color(0xFFF5F7FA),
    appBarTheme: const AppBarTheme(
      backgroundColor: Color(0xFF102A43),
      foregroundColor: Colors.white,
      centerTitle: false,
      elevation: 0,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: isDark ? colorScheme.surfaceContainerHighest : Colors.white,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: colorScheme.outlineVariant),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: colorScheme.primary, width: 2),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(64, 56),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(64, 52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        side: BorderSide(color: colorScheme.primary.withValues(alpha: 0.55)),
        textStyle: const TextStyle(fontWeight: FontWeight.w600),
      ),
    ),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
  );
}

class ASTRYONMobileApp extends StatefulWidget {
  const ASTRYONMobileApp({super.key, required this.initiallyPaired});

  final bool initiallyPaired;

  @override
  State<ASTRYONMobileApp> createState() => _ASTRYONMobileAppState();
}

class _ASTRYONMobileAppState extends State<ASTRYONMobileApp> {
  late bool _paired;

  @override
  void initState() {
    super.initState();
    _paired = widget.initiallyPaired;
  }

  void _showPairing() {
    if (!_paired) return;
    setState(() => _paired = false);
  }

  void _showDashboard() {
    if (_paired) return;
    setState(() => _paired = true);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ASTRYON Mobile Gateway',
      debugShowCheckedModeBanner: false,
      theme: buildASTRYONTheme(Brightness.light),
      darkTheme: buildASTRYONTheme(Brightness.dark),
      themeMode: ThemeMode.system,
      home: _paired
          ? DashboardScreen(onUnpaired: _showPairing)
          : PairingScreen(onPaired: _showDashboard),
    );
  }
}
