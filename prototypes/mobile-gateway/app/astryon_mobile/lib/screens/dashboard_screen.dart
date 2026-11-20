import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../models/telemetry.dart';
import '../services/api_exception.dart';
import '../services/api_service.dart';
import '../services/app_config.dart';
import '../services/background_service.dart';
import '../services/starlink_service.dart';
import '../services/token_store.dart';
import 'pairing_screen.dart';
import 'settings_screen.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key, this.onUnpaired});

  /// Chamado quando o aparelho deixa de estar pareado (token inválido ou
  /// despareamento manual). Sem callback, volta para a tela de pareamento.
  final VoidCallback? onUnpaired;

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  bool _checking = false;
  bool _sending = false;
  bool _backgroundEnabled = false;
  bool _loading = true;
  bool _reachable = false;
  String _apiBaseUrl = defaultApiBaseUrl;
  String? _lastResult;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final url = await AppConfig.apiBaseUrl();
    final background = await AppConfig.backgroundEnabled();
    final hasToken = await TokenStore.hasToken();
    if (!mounted) return;
    if (!hasToken) {
      _unpair();
      return;
    }
    setState(() {
      _apiBaseUrl = url;
      _backgroundEnabled = background;
      _loading = false;
    });
  }

  void _unpair() {
    final onUnpaired = widget.onUnpaired;
    if (onUnpaired != null) {
      onUnpaired();
      return;
    }
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const PairingScreen()),
      (route) => false,
    );
  }

  Future<void> _handleUnauthorized() async {
    await ApiService.clearCredentials();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Sessão expirada. Pareie o aparelho novamente.'),
      ),
    );
    _unpair();
  }

  Future<void> _checkAntenna() async {
    setState(() => _checking = true);
    final reachable = await StarlinkService.isReachable();
    if (!mounted) return;
    setState(() {
      _reachable = reachable;
      _checking = false;
    });
  }

  Future<void> _sendDemoTelemetry() async {
    setState(() {
      _sending = true;
      _lastResult = null;
    });
    try {
      final sample = StarlinkService.readDemoTelemetry();
      await ApiService.sendTelemetry(sample);
      if (!mounted) return;
      setState(() {
        _lastResult =
            'Amostra de demonstração enviada (origem: ${sample.origin.label}).';
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      if (error.isUnauthorized) {
        await _handleUnauthorized();
        return;
      }
      setState(() => _lastResult = 'Erro: ${error.message}');
    } catch (error) {
      if (!mounted) return;
      setState(() => _lastResult = 'Erro: $error');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _toggleBackground(bool enabled) async {
    setState(() => _backgroundEnabled = enabled);
    await AppConfig.setBackgroundEnabled(enabled);
    if (enabled) {
      await BackgroundService.startPeriodic();
    } else {
      await BackgroundService.stop();
    }
  }

  Future<void> _openSettings() async {
    final unpaired = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const SettingsScreen()),
    );
    if (!mounted) return;
    if (unpaired == true) {
      _unpair();
      return;
    }
    final url = await AppConfig.apiBaseUrl();
    if (!mounted) return;
    setState(() => _apiBaseUrl = url);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('ASTRYON Mobile Gateway'),
        actions: [
          IconButton(
            tooltip: 'Configurações',
            onPressed: _loading ? null : _openSettings,
            icon: const Icon(Icons.settings_outlined),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
              children: [
                Text(
                  'Status da antena',
                  style: theme.textTheme.headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 12),
                _StatusCard(reachable: _reachable),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: _checking ? null : _checkAntenna,
                    icon: _checking
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.search),
                    label: const Text('Verificar conexão com a antena'),
                  ),
                ),
                const SizedBox(height: 24),
                const _NoticeCard(
                  icon: Icons.info_outline,
                  text: 'A leitura real da antena via gRPC ainda não está '
                      'integrada. A telemetria enviada aqui é uma amostra de '
                      'demonstração, sempre marcada como demonstração.',
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed:
                        (_sending || !_reachable) ? null : _sendDemoTelemetry,
                    icon: _sending
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.send_outlined),
                    label: const Text('Enviar amostra de demonstração'),
                  ),
                ),
                const SizedBox(height: 24),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Coleta automática em background'),
                  subtitle: const Text(
                    'Só envia quando há leitura real da antena '
                    '(mínimo de 15 min do Android).',
                  ),
                  value: _backgroundEnabled,
                  onChanged: _toggleBackground,
                ),
                if (_lastResult != null) ...[
                  const SizedBox(height: 8),
                  _NoticeCard(
                    icon: Icons.receipt_long_outlined,
                    text: _lastResult!,
                  ),
                ],
                const SizedBox(height: 24),
                Text(
                  'Servidor: $_apiBaseUrl',
                  style: theme.textTheme.bodySmall,
                ),
              ],
            ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.reachable});

  final bool reachable;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = reachable ? Colors.green.shade700 : theme.colorScheme.error;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border.all(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Icon(reachable ? Icons.wifi : Icons.wifi_off, color: color),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              reachable
                  ? 'Antena acessível em '
                      '${StarlinkService.defaultStarlinkIp}:'
                      '${StarlinkService.defaultGrpcPort}'
                  : 'Antena não acessível. Verifique se o celular está na '
                      'Wi-Fi da antena.',
              style:
                  theme.textTheme.bodyLarge?.copyWith(color: color, height: 1.35),
            ),
          ),
        ],
      ),
    );
  }
}

class _NoticeCard extends StatelessWidget {
  const _NoticeCard({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.colorScheme.primaryContainer.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: theme.colorScheme.primary),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              text,
              style: theme.textTheme.bodyMedium?.copyWith(height: 1.4),
            ),
          ),
        ],
      ),
    );
  }
}
