import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../pairing_code.dart';
import '../services/api_exception.dart';
import '../services/api_service.dart';
import 'dashboard_screen.dart';
import 'pairing_scanner_screen.dart';

class PairingScreen extends StatefulWidget {
  const PairingScreen({super.key, this.onPaired});

  /// Chamado quando o registro termina com sucesso. Sem callback, o app navega
  /// para o dashboard diretamente.
  final VoidCallback? onPaired;

  @override
  State<PairingScreen> createState() => _PairingScreenState();
}

class _PairingScreenState extends State<PairingScreen> {
  final TextEditingController _codeController = TextEditingController();
  final TextEditingController _nameController = TextEditingController();
  int _currentStep = 0;
  int _attempt = 0;
  bool _forward = true;
  bool _loading = false;
  String? _error;

  static const _titles = [
    'Conecte seu gateway',
    'Identifique seu aparelho',
    'Revise o pareamento',
  ];

  static const _descriptions = [
    'Use o QR Code exibido no dashboard ou digite o código de pareamento.',
    'Escolha um nome fácil de reconhecer depois na lista de dispositivos.',
    'Confira os dados. O registro só será feito depois da sua confirmação.',
  ];

  String get _code => normalizePairingCode(_codeController.text);
  String get _name => _nameController.text.trim();

  void _clearError() {
    if (_error != null) setState(() => _error = null);
  }

  void _goBack() {
    if (_currentStep == 0) return;
    _attempt += 1;
    setState(() {
      _forward = false;
      _currentStep -= 1;
      _error = null;
      _loading = false;
    });
  }

  void _continue() {
    _clearError();

    if (_currentStep == 0 && !isValidPairingCode(_code)) {
      setState(() {
        _error = 'Digite um código válido no formato A3B7-X9K2 ou leia o QR Code.';
      });
      return;
    }

    if (_currentStep == 1 && _name.isEmpty) {
      setState(() => _error = 'Digite um nome para identificar este aparelho.');
      return;
    }

    if (_currentStep < 2) {
      setState(() {
        _forward = true;
        _currentStep += 1;
        _error = null;
      });
      return;
    }

    _pair();
  }

  Future<void> _scanCode() async {
    final code = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const PairingScannerScreen()),
    );
    if (!mounted || code == null) return;

    _codeController.text = code;
    _codeController.selection = TextSelection.collapsed(offset: code.length);
    setState(() => _error = null);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Código lido. Confira os dados para continuar.')),
    );
  }

  Future<void> _pair() async {
    final attempt = ++_attempt;
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      await ApiService.registerDevice(pairingCode: _code, deviceName: _name);
      if (!mounted || attempt != _attempt) return;
      if (widget.onPaired != null) {
        widget.onPaired!();
      } else {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const DashboardScreen()),
        );
      }
    } on ApiException catch (error) {
      if (!mounted || attempt != _attempt) return;
      setState(() {
        _error = _messageFor(error);
        if (error.statusCode == 400 || error.statusCode == 404) {
          _forward = false;
          _currentStep = 0;
        }
      });
    } catch (error) {
      if (!mounted || attempt != _attempt) return;
      setState(() => _error = _messageFor(error));
    } finally {
      if (mounted && attempt == _attempt) {
        setState(() => _loading = false);
      }
    }
  }

  String _messageFor(Object error) {
    if (error is ApiTimeoutException) {
      return 'O servidor demorou para responder. Verifique a conexão e tente novamente.';
    }
    if (error is ApiNetworkException) {
      return 'Não foi possível alcançar o servidor. Confira a URL em Configurações e a rede do ASTRYON.';
    }
    if (error is ApiException) {
      if (error.statusCode == 404) {
        return 'Código não encontrado. Gere um novo código no dashboard e tente novamente.';
      }
      if (error.statusCode == 400) {
        return 'Este código expirou ou já foi usado. Gere um novo código no dashboard.';
      }
    }
    return 'Não foi possível concluir o registro. Verifique a conexão e tente novamente.';
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.of(context).disableAnimations;

    return PopScope<void>(
      canPop: _currentStep == 0,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) _goBack();
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('ASTRYON'),
          leading: _currentStep > 0 && !_loading
              ? IconButton(
                  tooltip: 'Voltar',
                  onPressed: _goBack,
                  icon: const Icon(Icons.arrow_back),
                )
              : null,
        ),
        body: SafeArea(
          top: false,
          child: Column(
            children: [
              _RouteProgress(currentStep: _currentStep),
              Expanded(
                child: SingleChildScrollView(
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
                  child: AnimatedSwitcher(
                    duration: reduceMotion
                        ? Duration.zero
                        : const Duration(milliseconds: 240),
                    switchInCurve: Curves.easeOutCubic,
                    switchOutCurve: Curves.easeInCubic,
                    transitionBuilder: (child, animation) {
                      if (reduceMotion) return child;
                      return FadeTransition(
                        opacity: animation,
                        child: SlideTransition(
                          position: Tween<Offset>(
                            begin: Offset(_forward ? 0.06 : -0.06, 0),
                            end: Offset.zero,
                          ).animate(animation),
                          child: child,
                        ),
                      );
                    },
                    child: _StepContent(
                      key: ValueKey(_currentStep),
                      step: _currentStep,
                      title: _titles[_currentStep],
                      description: _descriptions[_currentStep],
                      codeController: _codeController,
                      nameController: _nameController,
                      code: _code,
                      name: _name,
                      onScan: _scanCode,
                      onChanged: _clearError,
                      onSubmit: _continue,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        bottomNavigationBar: SafeArea(
          top: false,
          minimum: const EdgeInsets.fromLTRB(24, 12, 24, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: _ErrorMessage(message: _error!),
                ),
              Row(
                children: [
                  if (_currentStep > 0) ...[
                    OutlinedButton(
                      onPressed: _loading ? null : _goBack,
                      child: const Text('Voltar'),
                    ),
                    const SizedBox(width: 12),
                  ],
                  Expanded(
                    child: FilledButton(
                      onPressed: _loading ? null : _continue,
                      child: _loading
                          ? const Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                ),
                                SizedBox(width: 12),
                                Text('Registrando...'),
                              ],
                            )
                          : Text(
                              _currentStep == 2 ? 'Parear dispositivo' : 'Continuar',
                            ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    _codeController.dispose();
    _nameController.dispose();
    super.dispose();
  }
}

class _StepContent extends StatelessWidget {
  final int step;
  final String title;
  final String description;
  final TextEditingController codeController;
  final TextEditingController nameController;
  final String code;
  final String name;
  final VoidCallback onScan;
  final VoidCallback onChanged;
  final VoidCallback onSubmit;

  const _StepContent({
    super.key,
    required this.step,
    required this.title,
    required this.description,
    required this.codeController,
    required this.nameController,
    required this.code,
    required this.name,
    required this.onScan,
    required this.onChanged,
    required this.onSubmit,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: theme.textTheme.headlineMedium?.copyWith(
            color: theme.brightness == Brightness.light
                ? const Color(0xFF102A43)
                : theme.colorScheme.onSurface,
            fontWeight: FontWeight.w700,
            height: 1.15,
            letterSpacing: -0.5,
          ),
        ),
        const SizedBox(height: 12),
        Text(description, style: theme.textTheme.bodyLarge?.copyWith(height: 1.45)),
        const SizedBox(height: 28),
        if (step == 0) ...[
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: onScan,
              icon: const Icon(Icons.qr_code_scanner),
              label: const Text('Ler QR Code'),
            ),
          ),
          const SizedBox(height: 24),
          Row(
            children: [
              const Expanded(child: Divider()),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Text('ou digite', style: theme.textTheme.bodySmall),
              ),
              const Expanded(child: Divider()),
            ],
          ),
          const SizedBox(height: 24),
          TextField(
            controller: codeController,
            decoration: const InputDecoration(
              labelText: 'Código de pareamento',
              hintText: 'A3B7-X9K2',
              prefixIcon: Icon(Icons.key_outlined),
            ),
            textCapitalization: TextCapitalization.characters,
            textInputAction: TextInputAction.next,
            autocorrect: false,
            enableSuggestions: false,
            maxLength: 9,
            onChanged: (_) => onChanged(),
            onSubmitted: (_) => onSubmit(),
          ),
          const SizedBox(height: 12),
          Text(
            'O código tem 24 horas de validade e pode ser usado uma única vez.',
            style: theme.textTheme.bodySmall?.copyWith(height: 1.4),
          ),
        ] else if (step == 1) ...[
          TextField(
            controller: nameController,
            autofocus: true,
            decoration: const InputDecoration(
              labelText: 'Nome do dispositivo',
              hintText: 'Ex.: Celular do Carlos',
              prefixIcon: Icon(Icons.smartphone_outlined),
            ),
            textInputAction: TextInputAction.done,
            textCapitalization: TextCapitalization.sentences,
            maxLength: 60,
            onChanged: (_) => onChanged(),
            onSubmitted: (_) => onSubmit(),
          ),
          const SizedBox(height: 20),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: theme.colorScheme.primaryContainer.withValues(alpha: 0.55),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.badge_outlined, color: theme.colorScheme.primary),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Use algo como “Celular da sala” ou o seu nome. Isso facilita identificar a origem da telemetria.',
                    style: theme.textTheme.bodyMedium?.copyWith(height: 1.4),
                  ),
                ),
              ],
            ),
          ),
        ] else ...[
          Container(
            decoration: BoxDecoration(
              color: theme.colorScheme.surface,
              border: Border.all(color: theme.colorScheme.outlineVariant),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(
              children: [
                ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  leading: const Icon(Icons.key_outlined),
                  title: const Text('Código de pareamento'),
                  subtitle: Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(code, style: const TextStyle(fontWeight: FontWeight.w600)),
                  ),
                ),
                Divider(height: 1, color: theme.colorScheme.outlineVariant),
                ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  leading: const Icon(Icons.smartphone_outlined),
                  title: const Text('Nome do aparelho'),
                  subtitle: Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(name, style: const TextStyle(fontWeight: FontWeight.w600)),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.info_outline, size: 20, color: theme.colorScheme.primary),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Ao concluir, o código será validado e este aparelho será registrado. O teste de conexão com a antena continua disponível no dashboard.',
                  style: theme.textTheme.bodyMedium?.copyWith(height: 1.45),
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }
}

class _RouteProgress extends StatelessWidget {
  final int currentStep;

  const _RouteProgress({required this.currentStep});

  static const _labels = ['Código', 'Aparelho', 'Revisão'];

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      container: true,
      label: 'Etapa ${currentStep + 1} de 3: ${_labels[currentStep]}',
      child: Container(
        color: theme.colorScheme.surface,
        padding: const EdgeInsets.fromLTRB(24, 20, 24, 18),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var index = 0; index < _labels.length; index++) ...[
              Expanded(
                flex: 2,
                child: Column(
                  children: [
                    AnimatedContainer(
                      duration: MediaQuery.of(context).disableAnimations
                          ? Duration.zero
                          : const Duration(milliseconds: 200),
                      width: 32,
                      height: 32,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: index < currentStep
                            ? theme.colorScheme.primary
                            : index == currentStep
                                ? theme.colorScheme.secondary
                                : theme.colorScheme.surface,
                        border: Border.all(
                          color: index <= currentStep
                              ? theme.colorScheme.primary
                              : theme.colorScheme.outline,
                          width: 2,
                        ),
                      ),
                      child: Center(
                        child: index < currentStep
                            ? const Icon(Icons.check, size: 18, color: Colors.white)
                            : Text(
                                '${index + 1}',
                                style: TextStyle(
                                  color: index == currentStep
                                      ? theme.colorScheme.onSecondary
                                      : theme.colorScheme.onSurfaceVariant,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _labels[index],
                      maxLines: 2,
                      textAlign: TextAlign.center,
                      overflow: TextOverflow.visible,
                      style: theme.textTheme.labelMedium?.copyWith(
                        color: index == currentStep
                            ? theme.colorScheme.onSurface
                            : theme.colorScheme.onSurfaceVariant,
                        fontWeight: index == currentStep
                            ? FontWeight.w700
                            : FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
              if (index < _labels.length - 1)
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 15),
                    child: Container(
                      height: 2,
                      color: index < currentStep
                          ? theme.colorScheme.primary
                          : theme.colorScheme.outlineVariant,
                    ),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ErrorMessage extends StatelessWidget {
  final String message;

  const _ErrorMessage({required this.message});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Semantics(
      liveRegion: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: colorScheme.errorContainer,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.error_outline, size: 20, color: colorScheme.onErrorContainer),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                message,
                style: TextStyle(color: colorScheme.onErrorContainer, height: 1.35),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
