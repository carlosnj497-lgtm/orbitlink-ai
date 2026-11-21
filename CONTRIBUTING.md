# Contribuindo com o ASTRYON

Obrigado pelo interesse! O ASTRYON é um projeto independente, sem afiliação com a Starlink ou a SpaceX. Contribuições de código, documentação, testes e validação em hardware são bem-vindas.

> English speakers: the detailed guides are currently in Portuguese, but you can open issues and pull requests in English.

## Antes de abrir uma issue

- Procure issues existentes para não duplicar.
- Para bugs, use o template **🐛 Bug** e inclua versão, modelo/firmware, passos e diagnóstico **sem segredos**.
- Para vulnerabilidades, use a aba **Security** (relato privado). Não abra issue pública.

## Ambiente de desenvolvimento

**Pré-requisitos:** Python 3.11+ e Node.js 20+.

```bash
git clone https://github.com/carlosnj497-lgtm/orbitlink-ai.git ~/astryon
cd ~/astryon
npm ci
npm run dev
```

O painel abre em `http://localhost:3000`. A rota `/demo` funciona com dados fictícios, sem antena.

Para instalar o agente e os serviços do seu sistema, siga o guia correspondente:

- [Linux / Ubuntu Server](docs/LINUX_SERVER.md)
- [Windows 10/11](docs/WINDOWS_SETUP.md)

## Testes e verificações

Antes de enviar um pull request, rode:

```bash
npm run test
npm run test:e2e
npm run lint
npm run typecheck
```

Para mudanças no README ou nos docs:

```bash
npm run check:links
```

Para regenerar as capturas de tela do `/demo` (com o painel rodando):

```bash
npm run screenshots
```

O CI também roda auditoria de vulnerabilidades, testes dos scripts Linux e uma instalação real no Ubuntu 24.04.

## Estilo de commit

Use [Conventional Commits](https://www.conventionalcommits.org/), com uma descrição curta em português ou inglês:

```text
feat: adiciona filtro por período em Eventos
fix: corrige cálculo de cobertura quando faltam amostras
docs: atualiza o guia de instalação no Windows
ci: adiciona verificação de links do README
```

Evite commits gigantes com assuntos não relacionados. Se possível, inclua testes para a mudança.

## Documentação

- O README é bilíngue: português primeiro, inglês no final.
- Os guias detalhados em `docs/` estão em português.
- Toda afirmação deve ter lastro no código ou na documentação. Não invente métricas, causas ou compatibilidade.
- Métricas devem manter a origem (`real`, `calculada`, `estimada`, `importada`, `sensor_esp32`, `indisponível`, `demonstração`) e as lacunas de observação.
- Ao mudar comportamento visível, atualize o README, os docs e as capturas de tela.

## Áreas que precisam de ajuda

- Validação em antenas Starlink reais, por modelo e firmware.
- Firmware ESP32 em placa real.
- Instalador Windows em um Windows real.
- Aparelho Raspberry Pi em hardware real.
- Tradução e revisão da documentação.
- Testes de acessibilidade e do painel no celular.

## Segurança

O modelo completo está em [docs/SECURITY.md](docs/SECURITY.md). Para reportar uma vulnerabilidade, use a aba **Security** do GitHub (relato privado).

## Mantenedores

Checklist de configurações do GitHub (descrição, topics, social preview, branch protection e relato privado de vulnerabilidades): [docs/REPO_SETTINGS.md](docs/REPO_SETTINGS.md).

## Licença

Ao contribuir, você concorda que a contribuição é distribuída sob a [licença MIT](LICENSE) do projeto.
