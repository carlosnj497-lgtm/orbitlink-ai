import 'package:flutter_test/flutter_test.dart';

import 'package:astryon_mobile/models/app_release.dart';

void main() {
  group('AppRelease.fromJson', () {
    test('lê um manifesto completo', () {
      final release = AppRelease.fromJson({
        'version': '0.3.0',
        'url': 'https://servidor/api/v1/app/download',
        'sha256': 'ABC123',
        'size': 4096,
        'filename': 'astryon-mobile-0.3.0.apk',
        'notes': 'Corrige o pareamento',
      });

      expect(release, isNotNull);
      expect(release!.version, '0.3.0');
      expect(release.sha256, 'abc123');
      expect(release.size, 4096);
      expect(release.filename, 'astryon-mobile-0.3.0.apk');
      expect(release.notes, 'Corrige o pareamento');
    });

    test('usa padrões quando faltam campos opcionais', () {
      final release = AppRelease.fromJson({
        'version': '1.0.0',
        'url': 'https://servidor/apk',
        'sha256': 'ff00',
      });

      expect(release!.size, 0);
      expect(release.filename, 'astryon-mobile.apk');
      expect(release.notes, isNull);
    });

    test('recusa manifesto sem campo essencial', () {
      expect(AppRelease.fromJson({'url': 'x', 'sha256': 'y'}), isNull);
      expect(AppRelease.fromJson({'version': '1.0.0', 'sha256': 'y'}), isNull);
      expect(AppRelease.fromJson({'version': '1.0.0', 'url': 'x'}), isNull);
    });
  });
}
