import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Política de privacidade" };

export default function Privacidade() {
  return (
    <LegalPage title="Política de privacidade" updated="15/11/2026">
      <p>Esta política explica quais dados o ASTRYON na nuvem guarda, por quê, e como você controla isso, conforme a LGPD (Lei 13.709/2018).</p>
      <h2>Dados que guardamos</h2>
      <ul>
        <li><b>Conta:</b> e-mail e senha (a senha é guardada só como hash pelo provedor de autenticação).</li>
        <li><b>Agentes:</b> nome que você deu, datas de conexão e de último envio. O token do agente é guardado só como hash.</li>
        <li><b>Medições da antena:</b> consumo estimado, latência, perda e quedas por minuto, versão de firmware e modelo da antena.</li>
        <li>O identificador da antena é transformado em hash antes de sair da sua casa. Não guardamos localização da antena nem a lista de aparelhos da sua rede.</li>
      </ul>
      <h2>Para que usamos</h2>
      <p>Só para mostrar o painel e o histórico a você. Não vendemos nem compartilhamos dados com anunciantes.</p>
      <h2>Onde ficam</h2>
      <p>
        Num banco Postgres gerenciado pelo Supabase, com isolamento por conta: cada pessoa só enxerga os próprios dados, regra aplicada no próprio
        banco. O painel é hospedado na Vercel. As conexões usam HTTPS.
      </p>
      <h2>Por quanto tempo</h2>
      <p>As medições por minuto são guardadas por até 400 dias e depois apagadas automaticamente. Ao excluir a conta, tudo é apagado na hora.</p>
      <h2>Seus direitos</h2>
      <ul>
        <li><b>Acesso e portabilidade:</b> baixe seus dados em Conta → Baixar meus dados.</li>
        <li><b>Exclusão:</b> Conta → Excluir minha conta apaga a conta e todos os dados na nuvem.</li>
        <li><b>Revogação:</b> remova o acesso de qualquer agente em Conta → Agentes conectados.</li>
      </ul>
      <h2>Contato</h2>
      <p>Para dúvidas sobre privacidade, abra uma issue no repositório do projeto no GitHub.</p>
    </LegalPage>
  );
}
