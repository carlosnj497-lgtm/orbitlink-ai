# releases — APKs publicados para atualização automática

Coloque aqui o APK do app mobile a ser distribuído. O backend publica o mais
recente (por data de modificação) em:

- `GET /api/v1/app/latest` — manifesto `{version, url, sha256, size, filename, notes}`
- `GET /api/v1/app/download` — baixa o APK

A versão vem de `ASTRYON_APP_VERSION` ou do nome do arquivo (ex.:
`astryon-mobile-1.2.0.apk` → `1.2.0`). O `sha256` é calculado pelo backend e
conferido pelo app antes de instalar.

Os `.apk` não são versionados no repositório (arquivos grandes). Copie o APK
gerado pelo workflow "Build Mobile Gateway APK" para esta pasta antes de subir
o backend, ou aponte `ASTRYON_APK_DIR` para um volume montado.
