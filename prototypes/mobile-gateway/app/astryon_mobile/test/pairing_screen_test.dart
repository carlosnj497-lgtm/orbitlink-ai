import 'package:material_ui/material_ui.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:astryon_mobile/main.dart';
import 'package:astryon_mobile/screens/pairing_screen.dart';

void main() {
  Future<void> pumpPairing(WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(home: PairingScreen()));
  }

  testWidgets('explica o erro quando o código está vazio', (tester) async {
    await pumpPairing(tester);
    await tester.tap(find.text('Continuar'));
    await tester.pump();

    expect(find.textContaining('Digite um código válido'), findsOneWidget);
  });

  testWidgets('avança por código, nome e revisão sem registrar', (tester) async {
    await pumpPairing(tester);

    await tester.enterText(find.byType(TextField), 'a3b7-x9k2');
    await tester.tap(find.text('Continuar'));
    await tester.pumpAndSettle();

    expect(find.text('Identifique seu aparelho'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'Celular do Carlos');
    await tester.tap(find.text('Continuar'));
    await tester.pumpAndSettle();

    expect(find.text('Revise o pareamento'), findsOneWidget);
    expect(find.text('A3B7-X9K2'), findsOneWidget);
    expect(find.text('Celular do Carlos'), findsOneWidget);
    expect(find.text('Parear dispositivo'), findsOneWidget);
  });

  testWidgets('volta da revisão para o nome', (tester) async {
    await pumpPairing(tester);

    await tester.enterText(find.byType(TextField), 'A3B7-X9K2');
    await tester.tap(find.text('Continuar'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Celular do Carlos');
    await tester.tap(find.text('Continuar'));
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Voltar'));
    await tester.pumpAndSettle();

    expect(find.text('Identifique seu aparelho'), findsOneWidget);
    expect(find.text('Celular do Carlos'), findsOneWidget);
  });

  for (final brightness in Brightness.values) {
    testWidgets(
      'percorre as etapas em phone compacto, teclado e fonte ampliada (${brightness.name})',
      (tester) async {
        tester.view.physicalSize = const Size(360 * 3, 640 * 3);
        tester.view.devicePixelRatio = 3;
        tester.view.viewInsets = const FakeViewPadding(bottom: 280 * 3);
        addTearDown(tester.view.reset);

        await tester.pumpWidget(
          MaterialApp(
            theme: buildASTRYONTheme(brightness),
            home: Builder(
              builder: (context) => MediaQuery(
                data: MediaQuery.of(context).copyWith(
                  textScaler: const TextScaler.linear(1.3),
                ),
                child: const PairingScreen(),
              ),
            ),
          ),
        );

        await tester.enterText(find.byType(TextField), 'A3B7-X9K2');
        await tester.tap(find.text('Continuar'));
        await tester.pumpAndSettle();
        expect(find.text('Identifique seu aparelho'), findsOneWidget);

        await tester.enterText(find.byType(TextField), 'Gateway da varanda');
        await tester.tap(find.text('Continuar'));
        await tester.pumpAndSettle();

        expect(find.text('Revise o pareamento'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
