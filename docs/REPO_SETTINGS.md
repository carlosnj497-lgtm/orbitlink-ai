# Configurações do repositório (manual)

Checklist de coisas que ficam nas configurações do GitHub e não em um arquivo versionado.

## About (card lateral)

1. Clique no ícone de engrenagem ao lado de **About**.
2. Cole a descrição:

   > Monitoramento local das antenas Starlink: histórico, painel em tempo real e alertas no Telegram.

3. Cole os topics (separados por espaço ou vírgula):

   ```text
   starlink starlink-mini starlink-monitoring self-hosted local-first fastapi nextjs sqlite telemetry telegram-bot home-assistant esp32 privacy python typescript
   ```

4. **Website:** deixe em branco (o card já mostra **Releases**) ou use a página de releases.
5. Salve.

**Social preview:** enviar `docs/screenshots/social-preview.png` (1280×640) em **Settings → Social preview**.

## Segurança

- Ativar **Private vulnerability reporting** em **Settings → Code security** para o caminho “Security → Report a vulnerability” funcionar.
- Confirmar que a política em `.github/SECURITY.md` aparece na aba **Security**.
- Ativar Dependabot alerts e security updates (o `dependabot.yml` já cobre atualizações semanais).

## Branches e CI

- Proteger `main`: exigir pull request, aprovação e CI verde antes do merge.
- Bloquear force push em `main`.
- Opcional: exigir que a branch esteja atualizada antes do merge.

## Issues e comunidade

- Os templates ficam em `.github/ISSUE_TEMPLATE/`.
- O template de PR fica em `.github/pull_request_template.md`.
- Opcional: ativar **Discussions** para dúvidas de instalação e ideias que ainda não são issues.
- Opcional: criar labels `hardware`, `windows`, `esp32`, `docs` e `good first issue`.

## Releases

- O badge do README mostra a última release.
- O workflow `windows-installer.yml` anexa o instalador à release e publica a atualização assinada no repositório público de releases, quando os secrets estão configurados.
