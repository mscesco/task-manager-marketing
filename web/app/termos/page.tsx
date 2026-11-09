// /termos -- publica, sem login (Spec 064).

import TextoLegal from "@/components/TextoLegal";

export default function TermosPage() {
  return (
    <TextoLegal titulo="Termos de uso">
      <p>
        Estes termos regem o uso do Oniros, o gerenciador de tarefas e solicitações
        mantido pela UniFECAF, instituição do grupo Federal Educacional Ltda., CNPJ
        17.238.945/0001-49, com sede em Taboão da Serra/SP.
        O tratamento de dados pessoais está descrito na{" "}
        <a href="/privacidade">Política de privacidade</a>.
      </p>

      <h2>1. O que é o Oniros</h2>
      <p>
        Uma ferramenta interna para organizar tarefas, projetos, bases de dados e
        solicitações dos times, com um formulário público para receber pedidos.
      </p>

      <h2>2. Para quem tem conta</h2>
      <ul>
        <li>Contas são criadas por quem tem permissão na organização. Não há cadastro aberto.</li>
        <li>A conta é pessoal. Não compartilhe sua senha e troque a senha provisória no primeiro acesso, dentro da validade de 72 horas.</li>
        <li>Use o Oniros apenas para atividades de trabalho e respeite as permissões do seu papel.</li>
        <li>Você responde pelo que publica. Não insira conteúdo ilegal, ofensivo ou que viole direitos de terceiros, nem dados pessoais além do necessário.</li>
        <li>Lembre que outras pessoas do time veem o que você escreve, e que o histórico guarda as alterações.</li>
        <li>É proibido tentar acessar dados sem permissão, burlar limites de segurança ou prejudicar o funcionamento do sistema.</li>
        <li>A conta pode ser desativada, por exemplo ao fim do vínculo ou em caso de descumprimento destes termos.</li>
      </ul>

      <h2>3. Para quem envia o formulário público</h2>
      <ul>
        <li>Informe dados verdadeiros e um e-mail que você acompanhe: os avisos sobre o pedido chegam por ele.</li>
        <li>Enviar um pedido não garante a aprovação. Ele será analisado pelo time responsável e pode ser recusado.</li>
        <li>Os prazos são estimados e contados a partir da aprovação.</li>
        <li>Não envie conteúdo ilegal ou ofensivo, nem dados pessoais sensíveis ou de terceiros sem necessidade.</li>
        <li>O envio automatizado ou abusivo pode ser bloqueado.</li>
      </ul>

      <h2>4. Disponibilidade</h2>
      <p>
        O Oniros é oferecido como está, sem garantia de funcionamento contínuo. O
        sistema pode ficar indisponível para manutenção ou atualização, e as funções
        podem mudar. Os avisos por e-mail podem falhar sem que a solicitação seja
        afetada.
      </p>

      <h2>5. Mudanças nestes termos</h2>
      <p>
        Esta página será atualizada quando os termos mudarem, com a data da nova
        versão indicada no topo.
      </p>

      <h2>6. Lei e foro</h2>
      <p>
        Estes termos seguem a legislação brasileira. Fica eleito o foro da Comarca
        de Taboão da Serra/SP.
      </p>
    </TextoLegal>
  );
}
