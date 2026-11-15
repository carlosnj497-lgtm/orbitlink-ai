# Aparelho pronto (Raspberry Pi)

Um Raspberry Pi já preparado vira o jeito mais simples de usar o ASTRYON: a pessoa liga na tomada e na rede da
Starlink, abre uma página no celular e digita o código da conta. Pronto.

## Para quem prepara (uma vez por aparelho)

1. Grave o **Raspberry Pi OS Lite (64 bits)** num cartão com o Raspberry Pi Imager. Nas opções do Imager, ligue o
   SSH e, se a pessoa for usar Wi-Fi, já configure a rede Wi-Fi da Starlink dela (ou deixe para o cabo).
2. No Pi:

   ```bash
   sudo apt-get install -y git
   git clone https://github.com/<você>/astryon.git ~/astryon && cd ~/astryon
   sudo bash deploy/appliance/prepare-pi.sh --supabase-url https://xxxx.supabase.co --anon-key <chave anon>
   ```

   O script dá o nome `astryon.local`, instala o ASTRYON (systemd, Nginx, firewall), liga o **modo aparelho** e
   aponta para a sua nuvem. Leva de 15 a 30 minutos num Pi 4.
3. Confira no fim: `http://astryon.local/aparelho` deve abrir a tela "Conectar à sua conta".
4. Desligue (`sudo poweroff`) e entregue.

Requisitos: Raspberry Pi 4 ou 5 com 2 GB de RAM ou mais e cartão de 16 GB+. Outros computadores ARM64/x86-64 com
Debian também servem. **Ainda não foi testado em hardware real**: faça o primeiro aparelho com calma.

## Para quem recebe

1. Ligue o aparelho na tomada e no cabo do roteador da Starlink (ou ele entra no Wi-Fi configurado).
2. No celular, conectado na mesma rede, abra **http://astryon.local/aparelho**.
3. No painel da sua conta, vá em **Conta → Conectar a antena → Gerar código** e digite o código no aparelho.

Pronto: os dados aparecem na conta em alguns minutos.

## Segurança

- A página sem login só existe em **modo aparelho** e só **enquanto ele não está pareado**. Depois de conectado à
  conta, ela fecha; para trocar de conta é preciso entrar no painel local como administrador.
- Ela só responde na rede local (a ACL do Nginx e o firewall bloqueiam o resto).
- O código da conta vale 15 minutos e uma única vez.
- O painel completo do aparelho continua disponível em `https://astryon.local` (certificado próprio) com o
  administrador local, cujo código de criação fica em `/etc/astryon/setup-code`.
