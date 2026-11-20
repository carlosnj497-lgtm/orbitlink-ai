import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../models/app_release.dart';
import '../services/api_exception.dart';
import '../services/api_service.dart';
import '../services/app_config.dart';
import '../services/app_updater.dart';
import '../services/token_store.dart';

/// Configurações locais: URL do backend, atualização e pareamento do aparelho.
///
/// Devolve `true` em `Navigator.pop` quando o aparelho foi despareado.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final TextEditingController _urlController = TextEditingController();
  bool _loading = true;
  bool _saving = false;
  String? _deviceId;
  String? _error;

  String? _appVersion;
  AppRelease? _availableUpdate;
  bool _checkingUpdate = false;
  bool _installing = false;
  double? _updateProgress;
  String? _updateMessage;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final url = await AppConfig.apiBaseUrl();
    final deviceId = await TokenStore.readDeviceId();
    final version = await _readAppVersion();
    if (!mounted) return;
    setState(() {
      _urlController.text = url;
      _deviceId = deviceId;
      _appVersion = version;
      _loading = false;
    });
  }

  Future<String?> _readAppVersion() async {
    try {
      return await AppUpdater.currentVersion();
    } catch (_) {
      return null;
    }
  }

  Future<void> _save() async {
    if (!isValidApiBaseUrl(_urlController.text)) {
      setState(() {
        _error = 'Informe uma URL http(s) válida, como https://servidor/api/v1.';
      });
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    await AppConfig.setApiBaseUrl(_urlController.text);
    if (!mounted) return;
    setState(() {
      _saving = false;
      _urlController.text = normalizeApiBaseUrl(_urlController.text);
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('URL do servidor salva.')),
    );
  }

  Future<void> _reset() async {
    await AppConfig.setApiBaseUrl('');
    if (!mounted) return;
    setState(() => _urlController.text = defaultApiBaseUrl);
  }

  Future<void> _unpair() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Desparear dispositivo?'),
        content: const Text(
          'O token será apagado deste aparelho e você voltará à tela de pareamento.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Desparear'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    await ApiService.clearCredentials();
    if (!mounted) return;
    Navigator.of(context).pop(true);
  }

  Future<void> _checkUpdate() async {
    setState(() {
      _checkingUpdate = true;
      _availableUpdate = null;
      _updateMessage = null;
    });
    try {
      final release = await AppUpdater.checkForUpdate();
      if (!mounted) return;
      setState(() {
        if (release == null) {
          _updateMessage = 'Você já está na versão mais recente.';
        } else {
          _availableUpdate = release;
          _updateMessage = 'Nova versão ${release.version} disponível.';
        }
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _updateMessage = error.message);
    } catch (error) {
      if (!mounted) return;
      setState(() => _updateMessage = 'Não foi possível verificar: $error');
    } finally {
      if (mounted) setState(() => _checkingUpdate = false);
    }
  }

  Future<void> _installUpdate() async {
    final release = _availableUpdate;
    if (release == null) return;

    setState(() {
      _installing = true;
      _updateProgress = 0;
      _updateMessage = 'Baixando a versão ${release.version}...';
    });
    try {
      await AppUpdater.downloadAndInstall(
        release,
        onProgress: (progress) {
          if (mounted) setState(() => _updateProgress = progress);
        },
      );
      if (!mounted) return;
      setState(() {
        _updateMessage =
            'Download concluído. Confirme a instalação na tela do Android.';
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _updateMessage = error.message);
    } catch (error) {
      if (!mounted) return;
      setState(() => _updateMessage = 'Falha ao instalar: $error');
    } finally {
      if (mounted) {
        setState(() {
          _installing = false;
          _updateProgress = null;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Configurações')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
              children: [
                _SectionTitle('Servidor', theme: theme),
                const SizedBox(height: 8),
                Text(
                  'Endereço do backend ASTRYON. Use http na rede local ou https fora dela.',
                  style: theme.textTheme.bodyMedium,
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _urlController,
                  keyboardType: TextInputType.url,
                  autocorrect: false,
                  decoration: const InputDecoration(
                    labelText: 'URL do backend',
                    hintText: 'https://servidor/api/v1',
                    prefixIcon: Icon(Icons.dns_outlined),
                  ),
                  onChanged: (_) {
                    if (_error != null) setState(() => _error = null);
                  },
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  _FieldError(message: _error!),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton(
                        onPressed: _saving ? null : _save,
                        child: _saving
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Text('Salvar'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    OutlinedButton(
                      onPressed: _saving ? null : _reset,
                      child: const Text('Padrão'),
                    ),
                  ],
                ),
                const SizedBox(height: 32),
                Divider(color: theme.colorScheme.outlineVariant),
                const SizedBox(height: 16),
                _SectionTitle('Atualizações', theme: theme),
                const SizedBox(height: 8),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.system_update_outlined),
                  title: const Text('Versão instalada'),
                  subtitle: Text(_appVersion ?? 'indisponível'),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: (_checkingUpdate || _installing) ? null : _checkUpdate,
                    icon: _checkingUpdate
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.refresh),
                    label: const Text('Verificar atualização'),
                  ),
                ),
                if (_availableUpdate != null) ...[
                  const SizedBox(height: 16),
                  _UpdateCard(release: _availableUpdate!),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _installing ? null : _installUpdate,
                      icon: const Icon(Icons.download_outlined),
                      label: Text(
                        'Baixar e instalar ${_availableUpdate!.version}',
                      ),
                    ),
                  ),
                ],
                if (_installing) ...[
                  const SizedBox(height: 16),
                  LinearProgressIndicator(value: _updateProgress),
                ],
                if (_updateMessage != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    _updateMessage!,
                    style: theme.textTheme.bodyMedium?.copyWith(height: 1.4),
                  ),
                ],
                const SizedBox(height: 32),
                Divider(color: theme.colorScheme.outlineVariant),
                const SizedBox(height: 16),
                _SectionTitle('Aparelho', theme: theme),
                const SizedBox(height: 8),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.smartphone_outlined),
                  title: const Text('Identificador'),
                  subtitle: Text(_deviceId ?? 'indisponível'),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: _unpair,
                    icon: const Icon(Icons.link_off),
                    label: const Text('Desparear dispositivo'),
                  ),
                ),
              ],
            ),
    );
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text, {required this.theme});

  final String text;
  final ThemeData theme;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
    );
  }
}

class _UpdateCard extends StatelessWidget {
  const _UpdateCard({required this.release});

  final AppRelease release;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final notes = release.notes;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.colorScheme.primaryContainer.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Versão ${release.version}',
            style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
          ),
          if (notes != null) ...[
            const SizedBox(height: 6),
            Text(notes, style: theme.textTheme.bodyMedium?.copyWith(height: 1.4)),
          ],
        ],
      ),
    );
  }
}

class _FieldError extends StatelessWidget {
  const _FieldError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colorScheme.errorContainer,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_outline,
              size: 20, color: colorScheme.onErrorContainer),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style:
                  TextStyle(color: colorScheme.onErrorContainer, height: 1.35),
            ),
          ),
        ],
      ),
    );
  }
}
