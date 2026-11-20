import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../pairing_code.dart';

class PairingScannerScreen extends StatefulWidget {
  const PairingScannerScreen({super.key});

  @override
  State<PairingScannerScreen> createState() => _PairingScannerScreenState();
}

class _PairingScannerScreenState extends State<PairingScannerScreen>
    with WidgetsBindingObserver {
  final MobileScannerController _controller = MobileScannerController(
    autoStart: false,
    detectionSpeed: DetectionSpeed.noDuplicates,
    formats: [BarcodeFormat.qrCode],
  );

  StreamSubscription<Object?>? _subscription;
  bool _handlingCode = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _subscription = _controller.barcodes.listen(_handleBarcode);
    unawaited(_controller.start());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!_controller.value.hasCameraPermission) return;

    switch (state) {
      case AppLifecycleState.detached:
      case AppLifecycleState.hidden:
      case AppLifecycleState.paused:
        return;
      case AppLifecycleState.resumed:
        _subscription = _controller.barcodes.listen(_handleBarcode);
        unawaited(_controller.start());
      case AppLifecycleState.inactive:
        unawaited(_subscription?.cancel());
        _subscription = null;
        unawaited(_controller.stop());
    }
  }

  void _handleBarcode(BarcodeCapture capture) {
    if (_handlingCode || !mounted) return;

    for (final barcode in capture.barcodes) {
      final rawValue = barcode.rawValue;
      if (rawValue == null) continue;
      final code = parsePairingCode(rawValue);
      if (code != null) {
        _handlingCode = true;
        Navigator.of(context).pop(code);
        return;
      }
    }

    if (capture.barcodes.isNotEmpty) {
      _handlingCode = true;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(
            content: Text(
              'QR Code não reconhecido. Use o código exibido no dashboard ASTRYON.',
            ),
          ),
        );
      Timer(const Duration(seconds: 2), () => _handlingCode = false);
    }
  }

  Future<void> _restartScanner() async {
    setState(() => _handlingCode = false);
    try {
      await _controller.start();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(
            content: Text('Não foi possível reiniciar a câmera. Tente novamente.'),
          ),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF102A43),
      appBar: AppBar(
        title: const Text('Ler QR Code'),
        actions: [
          ValueListenableBuilder<MobileScannerState>(
            valueListenable: _controller,
            builder: (context, state, child) {
              final torchAvailable =
                  state.isRunning && state.torchState != TorchState.unavailable;
              return IconButton(
                tooltip: state.torchState == TorchState.on
                    ? 'Desligar lanterna'
                    : 'Ligar lanterna',
                onPressed: torchAvailable ? _controller.toggleTorch : null,
                icon: Icon(
                  state.torchState == TorchState.on
                      ? Icons.flash_on
                      : Icons.flash_off_outlined,
                ),
              );
            },
          ),
        ],
      ),
      body: SafeArea(
        top: false,
        child: Stack(
          fit: StackFit.expand,
          children: [
            MobileScanner(
              controller: _controller,
              placeholderBuilder: (context) => const ColoredBox(
                color: Color(0xFF102A43),
                child: Center(
                  child: CircularProgressIndicator(color: Colors.white),
                ),
              ),
              errorBuilder: (context, error) => _ScannerError(
                error: error,
                onRetry: _restartScanner,
              ),
            ),
            IgnorePointer(
              child: Center(
                child: Container(
                  width: 248,
                  height: 248,
                  decoration: BoxDecoration(
                    border: Border.all(color: const Color(0xFFF2C94C), width: 3),
                    borderRadius: BorderRadius.circular(28),
                  ),
                ),
              ),
            ),
            Positioned(
              left: 24,
              right: 24,
              bottom: 28,
              child: Material(
                color: const Color(0xFF102A43),
                borderRadius: BorderRadius.circular(16),
                child: const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 20, vertical: 18),
                  child: Text(
                    'Aponte a câmera para o QR Code exibido no dashboard. O código será revisado antes do registro.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.white, height: 1.4),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Future<void> dispose() async {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_subscription?.cancel());
    _subscription = null;
    super.dispose();
    await _controller.dispose();
  }
}

class _ScannerError extends StatelessWidget {
  final MobileScannerException error;
  final Future<void> Function() onRetry;

  const _ScannerError({required this.error, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final isPermissionDenied =
        error.errorCode == MobileScannerErrorCode.permissionDenied;
    final isUnsupported = error.errorCode == MobileScannerErrorCode.unsupported;

    return ColoredBox(
      color: const Color(0xFF102A43),
      child: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  isPermissionDenied
                      ? Icons.no_photography_outlined
                      : Icons.camera_outlined,
                  color: Colors.white,
                  size: 48,
                ),
                const SizedBox(height: 24),
                Text(
                  isUnsupported
                      ? 'Este aparelho não oferece leitura por câmera'
                      : 'Não foi possível abrir a câmera',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  isPermissionDenied
                      ? 'Permita o acesso à câmera nas configurações do Android ou volte para digitar o código manualmente.'
                      : isUnsupported
                          ? 'Volte e digite o código de pareamento exibido no dashboard.'
                          : 'Feche outros aplicativos que usam a câmera e tente novamente, ou volte para digitar o código.',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    color: const Color(0xFFCBD5E1),
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 24),
                FilledButton.icon(
                  onPressed: isUnsupported ? null : onRetry,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Tentar novamente'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
