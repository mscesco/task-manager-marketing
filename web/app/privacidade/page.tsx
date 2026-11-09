// /privacidade -- publica, sem login (Spec 064). Cada frase aqui descreve o que
// o codigo faz: mudou o tratamento de dados, muda este texto.

import TextoLegal, { Marcador } from "@/components/TextoLegal";

export default function PrivacidadePage() {
  return (
    <TextoLegal titulo="Política de privacidade">
      <p>
        Esta política explica como o Oniros, o gerenciador de tarefas e
        solicitações da UniFECAF, trata dados pessoais, nos termos da Lei Geral
        de Proteção de Dados (Lei nº 13.709/2018, LGPD).
      </p>

      <h2>1. Quem é o responsável</h2>
      <ul>
        <li>Controlador: UniFECAF, instituição do grupo Federal Educacional Ltda., CNPJ 17.238.945/0001-49, com sede na Avenida Vida Nova, 166, Jardim Maria Rosa, Taboão da Serra/SP, CEP 06764-045.</li>
        <li>Encarregado pelo tratamento de dados (DPO): <Marcador>nome</Marcador>, <Marcador>e-mail</Marcador>.</li>
        <li>Canal para exercer seus direitos: <Marcador>canal do titular</Marcador>.</li>
      </ul>

      <h2>2. A quem esta política se aplica</h2>
      <ul>
        <li>Às pessoas da equipe que têm conta no Oniros.</li>
        <li>A quem envia uma solicitação pelo formulário público, sem precisar de conta.</li>
      </ul>

      <h2>3. Quais dados tratamos</h2>
      <p><strong>Se você tem conta:</strong></p>
      <ul>
        <li>Nome, e-mail, papel na organização, times de que participa e data de entrada neles.</li>
        <li>Senha, guardada apenas em forma de hash, que não permite recuperar o texto original.</li>
        <li>Situação da conta: ativa ou desativada, e se a senha precisa ser trocada.</li>
        <li>O que você produz no trabalho: tarefas, projetos, descrições, links, comentários, reações, tarefas que segue e dados inseridos nas Bases.</li>
        <li>Histórico das tarefas: quem alterou, o que alterou, quando, e os valores anterior e novo, incluindo títulos e descrições completos.</li>
        <li>Notificações: quem recebe, quem causou o aviso, o tipo, o título da tarefa e se foi lida.</li>
      </ul>
      <p><strong>Se você envia o formulário público:</strong></p>
      <ul>
        <li>Nome e e-mail, sempre.</li>
        <li>Telefone, departamento e polo, quando o formulário pedir.</li>
        <li>O que você escreve: categoria, resumo e respostas às perguntas.</li>
        <li>Os dados da análise do pedido: protocolo, situação, observações e quem analisou.</li>
      </ul>
      <p><strong>Dados técnicos:</strong></p>
      <ul>
        <li>Registros de cada requisição à API: método, caminho, resultado, duração e um identificador da requisição. Eventos como entrar e sair da conta registram também o identificador do usuário.</li>
        <li>Registros de acesso do servidor, que podem conter a página acessada, inclusive termos de busca, e o endereço IP da conexão.</li>
        <li>Erros ocorridos no navegador: mensagem, detalhes técnicos, página e identificação do navegador.</li>
        <li>O endereço IP é usado para limitar o número de envios e tentativas. Ele não é gravado no banco de dados.</li>
      </ul>
      <p><strong>No seu navegador</strong> (armazenamento local):</p>
      <ul>
        <li>Os códigos de acesso da sua sessão.</li>
        <li>Preferências de tema e do menu.</li>
        <li>O rascunho do formulário público, com seus dados e respostas, até o envio. Ele é desconsiderado depois de 7 dias.</li>
      </ul>
      <p>
        O Oniros não usa cookies próprios, ferramentas de análise de audiência nem
        publicidade. Tarefas e comentários não recebem arquivos: links apontam para
        fora do sistema. Na importação de planilha, os dados viram linhas da Base e
        o arquivo não é guardado.
      </p>
      <p>
        <strong>Campos livres:</strong> não inclua dados pessoais sensíveis (saúde,
        religião, biometria e outros) nem dados de terceiros sem necessidade.
      </p>

      <h2>4. Para que usamos e com qual base legal</h2>
      <p>As bases legais abaixo são uma proposta, sujeita à revisão jurídica (art. 7º da LGPD).</p>
      <ul>
        <li>Permitir o acesso e organizar o trabalho dos times: execução de contrato e legítimo interesse.</li>
        <li>Receber, analisar e atender solicitações, e avisar o solicitante sobre o andamento: legítimo interesse e procedimentos preliminares ou execução de contrato.</li>
        <li>Manter histórico e registros técnicos, para segurança, auditoria e correção de falhas: legítimo interesse.</li>
        <li>Cumprir obrigações legais e atender autoridades: obrigação legal.</li>
      </ul>

      <h2>5. Quem acessa dentro do Oniros</h2>
      <ul>
        <li>Nome e e-mail de quem tem conta são visíveis a todas as pessoas autenticadas, inclusive os de contas desativadas.</li>
        <li>Tarefas e comentários seguem os times. Administrador e Gestor veem todos; Gerente vê o próprio time e os subtimes; Supervisor e Operador veem o próprio time e o time raiz.</li>
        <li>Solicitações recebidas: Administrador e Gestor veem todas; Gerente vê as dos formulários dos seus times; Supervisor e Operador não veem a fila.</li>
        <li>Quando uma solicitação vira tarefa, os dados do solicitante e as respostas são copiados para a descrição da tarefa e passam a ser visíveis a quem vê essa tarefa.</li>
        <li>Quem administra o servidor tem acesso técnico ao banco, aos registros e aos backups.</li>
      </ul>

      <h2>6. Com quem compartilhamos</h2>
      <p>Não vendemos dados pessoais. Eles chegam apenas a:</p>
      <ul>
        <li><strong>Hostinger:</strong> hospeda a aplicação, o banco de dados e os backups.</li>
        <li><strong>n8n:</strong> ferramenta de automação instalada no mesmo servidor. Quando a situação de uma solicitação muda, recebe nome, e-mail, telefone, departamento, polo, protocolo, resumo, categoria, prazo e, na recusa, o motivo. As respostas às perguntas não são enviadas.</li>
        <li><strong>Google (Gmail):</strong> envia ao solicitante o e-mail sobre a aprovação, o início, a conclusão ou a recusa do pedido.</li>
        <li><strong>GIPHY</strong>, quando o recurso de GIFs estiver ativo: o navegador consulta o serviço com o termo buscado e carrega as imagens diretamente de lá, o que expõe o endereço IP de quem busca ou vê o GIF.</li>
        <li><strong>Autoridades públicas</strong>, quando houver obrigação legal ou ordem judicial.</li>
      </ul>

      <h2>7. Transferência internacional</h2>
      <p>
        Os servidores da Hostinger usados pelo Oniros ficam em <Marcador>país da VPS</Marcador>.
        Google e GIPHY são empresas com operações fora do Brasil, e os dados tratados
        por elas podem ser transferidos para outros países (arts. 33 a 36 da LGPD).
      </p>

      <h2>8. Por quanto tempo guardamos</h2>
      <p>
        Hoje, a maior parte dos dados não tem eliminação automática: eles ficam
        enquanto forem necessários às finalidades acima, e a eliminação ou
        anonimização é feita manualmente, a pedido ou quando deixarem de ser
        necessários.
      </p>
      <ul>
        <li>Contas: não são excluídas pelo sistema. Quando desativadas, deixam de entrar, e os dados permanecem.</li>
        <li>Solicitações, histórico e notificações: sem prazo de eliminação automática.</li>
        <li>Tarefas concluídas: arquivadas após 20 dias, sem serem apagadas.</li>
        <li>Tarefas, projetos e comentários excluídos: deixam de aparecer, mas continuam no banco de dados.</li>
        <li>Bases excluídas: apagadas após 10 dias. Linhas e colunas excluídas de uma Base: após 1 dia.</li>
        <li>Backup do banco de dados: diário, mantido por 14 dias. Um dado apagado ainda pode existir nos backups até esse prazo.</li>
        <li>Backups semanais da Hostinger, com cópia do servidor inteiro: <Marcador>prazo de retenção</Marcador>.</li>
        <li>Execuções guardadas no n8n, com dados do solicitante: <Marcador>prazo de retenção</Marcador>.</li>
        <li>E-mails de aviso: permanecem nas contas Gmail que os enviaram e na caixa de quem os recebeu.</li>
        <li>Registros técnicos: sem prazo definido.</li>
        <li>Sessão: o acesso expira em 15 minutos e é renovado por até 7 dias. Sair da conta encerra as sessões.</li>
      </ul>

      <h2>9. Como protegemos</h2>
      <ul>
        <li>Conexão criptografada (HTTPS) e senhas guardadas em hash.</li>
        <li>Permissões por papel e por time, e limite de tentativas nos acessos públicos.</li>
        <li>Backups diários do banco de dados.</li>
        <li>Os códigos de sessão ficam no armazenamento do navegador. Em computador compartilhado, saia da conta ao terminar.</li>
      </ul>
      <p>
        Nenhum sistema é totalmente imune a falhas. Em incidente que possa causar
        risco ou dano relevante, os titulares e a Autoridade Nacional de Proteção
        de Dados (ANPD) serão comunicados, conforme o art. 48 da LGPD.
      </p>

      <h2>10. Seus direitos</h2>
      <p>Conforme o art. 18 da LGPD, você pode solicitar:</p>
      <ul>
        <li>Confirmação de que tratamos seus dados e acesso a eles.</li>
        <li>Correção de dados incompletos, inexatos ou desatualizados.</li>
        <li>Anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade com a lei.</li>
        <li>Portabilidade, nos termos da regulamentação.</li>
        <li>Informação sobre com quem seus dados foram compartilhados.</li>
        <li>Revisão de decisões automatizadas, se vierem a existir. Hoje o Oniros não toma decisões automatizadas sobre pessoas.</li>
        <li>Oposição a tratamento irregular.</li>
      </ul>
      <p>
        Faça o pedido pelo canal indicado na seção 1. Quem tem conta pode alterar o
        próprio nome e a senha na tela de perfil. Os demais pedidos, inclusive a
        exclusão de dados, são atendidos manualmente, porque o Oniros não tem essa
        função na tela. Alguns dados podem ser mantidos quando a lei permitir, como
        para cumprir obrigação legal. Você também pode peticionar à ANPD.
      </p>

      <h2>11. Mudanças nesta política</h2>
      <p>
        Esta página será atualizada sempre que o tratamento de dados mudar, com a
        data da nova versão indicada no topo.
      </p>
    </TextoLegal>
  );
}
