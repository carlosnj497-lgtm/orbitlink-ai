import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../services/background_service.dart';
import '../services/starlink_service.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  bool _reachable = false;
  bool _checking = false;
  bool _sending = false;
  bool _backgroundEnabled = false;
  String? _lastResult;

  Future<void> _checkAntenna() async {
    setState(() => _checking = true);
    final reachable = await StarlinkService.isReachable();
    setState(() {
      _reachable = reachable;
      _checking = false;
    });
  }

  Future<void> _sendTelemetry() async {
    setState(() => _sending = true);
    try {
      final telemetry = StarlinkService.readTelemetryStub();
      final result = await ApiService.sendTelemetry(telemetry);
      setState(() => _lastResult = 'Enviado: ${result.toString()}');
    } catch (e) {
      setState(() => _lastResult = 'Erro: $e');
    } finally {
      setState(() => _sending = false);
    }
  }

  Future<void> _toggleBackground(bool enabled) async {
    setState(() => _backgroundEnabled = enabled);
    if (enabled) {
      await BackgroundService.startPeriodic();
    } else {
      await BackgroundService.stop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('ASTRYON Mobile Gateway')),
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Status da antena:',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Icon(
                  _reachable ? Icons.wifi : Icons.wifi_off,
                  color: _reachable ? Colors.green : Colors.red,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _reachable
                        ? 'Antena acessível em 192.168.100.1:9200'
                        : 'Antena não acessível. Verifique o Wi-Fi.',
                    style: TextStyle(
                      color: _reachable ? Colors.green : Colors.red,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _checking ? null : _checkAntenna,
                icon: _checking
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.search),
                label: const Text('Verificar conexão com a antena'),
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _sending || !_reachable ? null : _sendTelemetry,
                icon: _sending
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.send),
                label: const Text('Enviar telemetria de teste'),
              ),
            ),
            const SizedBox(height: 24),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Coleta automática em background'),
              subtitle: const Text(
                'Envia dados a cada 15 minutos (mínimo do Android).',
              ),
              value: _backgroundEnabled,
              onChanged: _toggleBackground,
            ),
            const SizedBox(height: 16),
            if (_lastResult != null)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  'Último resultado:\n$_lastResult',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
            const Spacer(),
            const Text(
              '💡 Para leitura real via gRPC, gere os protobufs com tool/gen_protos.sh '
              'e importe o StarlinkGrpcService.',
              style: TextStyle(color: Colors.grey),
            ),
          ],
        ),
      ),
    );
  }
}
