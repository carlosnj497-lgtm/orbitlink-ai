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
    await _controller.start();
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
              return IconButton(
                tooltip: state.torchState == TorchState.on
                    ? 'Desligar lanterna'
                    : 'Ligar lanterna',
                onPressed: state.hasCameraPermission
                    ? _controller.toggleTorch
                    : null,
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
              errorBuilder: (context, error) => _ScannerError(
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
  final Future<void> Function() onRetry;

  const _ScannerError({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: const Color(0xFF102A43),
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.no_photography_outlined, color: Colors.white, size: 48),
              const SizedBox(height: 24),
              Text(
                'Não foi possível abrir a câmera',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  color: Colors.white,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                'Permita o acesso à câmera nas configurações do Android ou volte para digitar o código manualmente.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  color: const Color(0xFFCBD5E1),
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
