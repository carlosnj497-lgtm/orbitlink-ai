import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Termos de uso" };

export default function Termos() {
  return (
    <LegalPage title="Termos de uso do ASTRYON" updated="15/11/2026">
      <p>
        Estes termos valem para o painel ASTRYON na nuvem e para os agentes que você conecta a ele. Ao criar uma conta, você concorda com eles.
        O ASTRYON é um projeto independente, sem afiliação com a Starlink ou a SpaceX.
      </p>
      <h2>1. O que o serviço faz</h2>
      <p>
        O agente instalado na sua rede lê a API local da sua antena Starlink e envia para a sua conta medições de consumo, latência, perda e quedas.
        O painel mostra essas medições e o histórico. Os números são estimativas feitas a partir do que a antena informa e podem diferir dos
        registros e da fatura oficiais da Starlink.
      </p>
      <h2>2. Sua conta</h2>
      <ul>
        <li>Você é responsável pelo seu e-mail e senha e pelos agentes que conecta à conta.</li>
        <li>Só conecte antenas e redes que você tem direito de monitorar.</li>
        <li>Você pode remover agentes, baixar seus dados e excluir a conta a qualquer momento, na página Conta.</li>
      </ul>
      <h2>3. Uso aceitável</h2>
      <p>Não use o serviço para tentar acessar dados de outras pessoas, sobrecarregar o sistema ou burlar as proteções de acesso.</p>
      <h2>4. Disponibilidade e garantias</h2>
      <p>
        O serviço é oferecido &ldquo;como está&rdquo;, sem garantia de funcionamento contínuo. Ele não substitui o suporte da Starlink nem alarmes de segurança.
        Não nos responsabilizamos por decisões tomadas apenas com base nas estimativas do painel.
      </p>
      <h2>5. Código aberto</h2>
      <p>O código do ASTRYON é distribuído sob a licença MIT. Você pode rodar o seu próprio painel sem usar este serviço.</p>
      <h2>6. Mudanças</h2>
      <p>Podemos atualizar estes termos. Mudanças relevantes serão avisadas no painel antes de valer.</p>
    </LegalPage>
  );
}
