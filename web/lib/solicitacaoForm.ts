// lib/solicitacaoForm.ts
// Definição DECLARATIVA do formulário público de solicitações (FazAê).
// Fonte: PDF "Novo Fluxo de Solicitação | FazAê".
//
// Por que declarativo: o formulário tem 11 ramificações e vai mudar com
// frequência (texto de pergunta, opção nova, SLA ajustado). Mudança aqui
// NÃO exige migration nem deploy de backend — o backend guarda os pares
// pergunta/resposta como JSONB.
//
// ⚠️ SLAs "a definir": o PDF veio com "XX dias úteis" em evento, revisão
// e impressão. Preencha PRAZO_A_DEFINIR abaixo antes de divulgar o link,
// senão o formulário promete nada e o solicitante cobra ontem.
//
// Divergências do PDF corrigidas de propósito (documentadas):
//   - "Sessão de Fotos" tinha seção inteira mas NÃO estava no menu
//     inicial do PDF. Está no menu aqui.
//   - O título "e-mail ou WhatsApp" existia só dentro da seção; o menu
//     do PDF dizia apenas e-mail. Menu corrigido.

export type CampoTipo =
  | "texto"
  | "textoLongo"
  | "escolha"
  | "multi"
  | "data"
  | "link";

export type Campo = {
  id: string;
  label: string;
  tipo: CampoTipo;
  obrigatorio?: boolean;
  opcoes?: string[];
  placeholder?: string;
  ajuda?: string;
  // Exibição condicional: mostra o campo apenas quando outro campo
  // tem exatamente o valor indicado (ramificações "Se sim / Se não").
  mostrarSe?: { campo: string; igual: string };
};

export type Categoria = {
  slug: string;
  titulo: string;
  emoji: string;
  prazo: string | null; // SLA exibido ao solicitante. null = sem promessa.
  campos: Campo[];
  // id do campo cujo valor vira o `summary` na fila de triagem.
  resumoDe: string;
};

const PRAZO_A_DEFINIR = "Prazo em definição pelo time de marketing";

const SIM_NAO = ["Sim", "Não"];

export const CATEGORIAS: Categoria[] = [
  // ----------------------------------------------------------------
  {
    slug: "arte",
    titulo: "Criar uma arte",
    emoji: "🖼️",
    prazo: "Até 5 dias úteis",
    resumoDe: "uso",
    campos: [
      {
        id: "formato",
        label: "Formato da arte",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: ["Digital", "Impresso"],
      },
      {
        id: "tipo_arte",
        label: "O que você precisa?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: [
          "Banner",
          "Post para redes sociais",
          "Cartaz",
          "Folder/Flyer",
          "Apresentação",
          "Arte para TV interna",
          "Layout para polo",
          "Outro",
        ],
      },
      {
        id: "medidas_polo",
        label: "Medidas e foto do local de aplicação (link)",
        tipo: "link",
        obrigatorio: true,
        mostrarSe: { campo: "tipo_arte", igual: "Layout para polo" },
        ajuda:
          "Para fachada de polo ou ambientação interna é OBRIGATÓRIO informar as medidas e foto de onde a arte será aplicada. Suba os arquivos no Drive e cole o link com acesso liberado.",
      },
      {
        id: "uso",
        label: "Para que essa arte será utilizada?",
        tipo: "textoLongo",
        obrigatorio: true,
      },
      {
        id: "campanha",
        label: "Este material faz parte de uma campanha ou projeto?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: SIM_NAO,
      },
      {
        id: "campanha_qual",
        label: "Qual campanha ou projeto?",
        tipo: "texto",
        obrigatorio: true,
        mostrarSe: { campo: "campanha", igual: "Sim" },
      },
      {
        id: "conteudo_pronto",
        label: "O conteúdo já está pronto?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: SIM_NAO,
      },
      {
        id: "referencia",
        label: "Referência (link do Drive)",
        tipo: "link",
        ajuda:
          "Tem alguma referência visual? Suba no Google Drive e cole aqui o link com acesso liberado.",
      },
      {
        id: "objetivo",
        label: "Qual o objetivo desta solicitação?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: [
          "Divulgar",
          "Informar",
          "Atrair novos alunos",
          "Engajar alunos",
          "Apoiar um evento",
          "Outro",
        ],
      },
      { id: "obs", label: "Observações", tipo: "textoLongo" },
    ],
  },

  // ----------------------------------------------------------------
  {
    slug: "foto",
    titulo: "Sessão ou edição de fotos",
    emoji: "📸",
    prazo: "Sessão: 5 a 15 dias úteis · Edição: 3 a 7 dias úteis",
    resumoDe: "foto_objetivo",
    campos: [
      {
        id: "foto_tipo",
        label: "O que você precisa?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: ["Sessão de fotos", "Edição de fotos (cor / luz / finalização)"],
      },
      // --- Sessão ---
      {
        id: "foto_objetivo",
        label: "Qual o objetivo da sessão de fotos?",
        tipo: "textoLongo",
        obrigatorio: true,
        mostrarSe: { campo: "foto_tipo", igual: "Sessão de fotos" },
      },
      {
        id: "foto_formato",
        label: "Qual formato?",
        tipo: "escolha",
        opcoes: ["Horizontal", "Vertical", "Quadrado"],
        mostrarSe: { campo: "foto_tipo", igual: "Sessão de fotos" },
      },
      {
        id: "foto_ref_estilo",
        label:
          "Tem referência de sessão produzida anteriormente? (retrato, evento, produto, artístico, corporativo…)",
        tipo: "texto",
        mostrarSe: { campo: "foto_tipo", igual: "Sessão de fotos" },
      },
      {
        id: "foto_participantes",
        label: "Quem participará das fotos?",
        tipo: "texto",
        obrigatorio: true,
        mostrarSe: { campo: "foto_tipo", igual: "Sessão de fotos" },
      },
      {
        id: "foto_local",
        label: "Local das fotos",
        tipo: "texto",
        obrigatorio: true,
        mostrarSe: { campo: "foto_tipo", igual: "Sessão de fotos" },
      },
      {
        id: "foto_roteiro",
        label: "Existe roteiro ou direcional criativo?",
        tipo: "escolha",
        opcoes: SIM_NAO,
        mostrarSe: { campo: "foto_tipo", igual: "Sessão de fotos" },
      },
      {
        id: "foto_data_flag",
        label:
          "Existe alguma data que precisa ser considerada? (evento, lançamento, início de campanha)",
        tipo: "escolha",
        opcoes: SIM_NAO,
        mostrarSe: { campo: "foto_tipo", igual: "Sessão de fotos" },
      },
      {
        id: "foto_data",
        label: "Qual é essa data?",
        tipo: "data",
        obrigatorio: true,
        mostrarSe: { campo: "foto_data_flag", igual: "Sim" },
      },
      {
        id: "foto_refs",
        label: "Outras referências (link do Drive)",
        tipo: "link",
        mostrarSe: { campo: "foto_tipo", igual: "Sessão de fotos" },
      },
      // --- Edição ---
      {
        id: "fotoed_tiradas",
        label: "As fotos já foram tiradas?",
        tipo: "escolha",
        opcoes: SIM_NAO,
        mostrarSe: {
          campo: "foto_tipo",
          igual: "Edição de fotos (cor / luz / finalização)",
        },
      },
      {
        id: "fotoed_arquivos",
        label: "Arquivos e informações para edição (link do Drive)",
        tipo: "link",
        obrigatorio: true,
        mostrarSe: {
          campo: "foto_tipo",
          igual: "Edição de fotos (cor / luz / finalização)",
        },
        ajuda:
          "O prazo de edição só começa a contar após o recebimento de TODO o material.",
      },
      {
        id: "fotoed_oque",
        label: "O que precisa ser editado?",
        tipo: "textoLongo",
        obrigatorio: true,
        mostrarSe: {
          campo: "foto_tipo",
          igual: "Edição de fotos (cor / luz / finalização)",
        },
      },
      {
        id: "fotoed_data_flag",
        label: "Existe alguma data que precisa ser considerada?",
        tipo: "escolha",
        opcoes: SIM_NAO,
        mostrarSe: {
          campo: "foto_tipo",
          igual: "Edição de fotos (cor / luz / finalização)",
        },
      },
      {
        id: "fotoed_data",
        label: "Qual é essa data?",
        tipo: "data",
        obrigatorio: true,
        mostrarSe: { campo: "fotoed_data_flag", igual: "Sim" },
      },
      {
        id: "fotoed_refs",
        label: "Referências (link, opcional)",
        tipo: "link",
        mostrarSe: {
          campo: "foto_tipo",
          igual: "Edição de fotos (cor / luz / finalização)",
        },
      },
    ],
  },

  // ----------------------------------------------------------------
  {
    slug: "video",
    titulo: "Gravar ou editar um vídeo",
    emoji: "🎥",
    prazo: "Gravação + edição: 7 a 15 dias úteis · Só edição: 3 a 7 dias úteis",
    resumoDe: "video_objetivo",
    campos: [
      {
        id: "video_tipo",
        label: "O que você precisa?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: ["Gravar e editar um vídeo", "Apenas editar um vídeo já existente"],
      },
      // --- Gravar e editar ---
      {
        id: "video_objetivo",
        label: "Qual o objetivo do vídeo?",
        tipo: "textoLongo",
        obrigatorio: true,
        mostrarSe: { campo: "video_tipo", igual: "Gravar e editar um vídeo" },
      },
      {
        id: "video_formato",
        label: "Qual formato?",
        tipo: "escolha",
        opcoes: ["Horizontal", "Vertical", "Quadrado"],
        mostrarSe: { campo: "video_tipo", igual: "Gravar e editar um vídeo" },
      },
      {
        id: "video_ref_estilo",
        label:
          "Tem referência de vídeo produzido anteriormente? (lançamento, cobertura de evento, institucional…)",
        tipo: "texto",
        mostrarSe: { campo: "video_tipo", igual: "Gravar e editar um vídeo" },
      },
      {
        id: "video_participantes",
        label: "Quem participará da gravação?",
        tipo: "texto",
        obrigatorio: true,
        mostrarSe: { campo: "video_tipo", igual: "Gravar e editar um vídeo" },
      },
      {
        id: "video_local",
        label: "Local da gravação",
        tipo: "texto",
        obrigatorio: true,
        mostrarSe: { campo: "video_tipo", igual: "Gravar e editar um vídeo" },
      },
      {
        id: "video_roteiro",
        label: "Existe roteiro?",
        tipo: "escolha",
        opcoes: SIM_NAO,
        mostrarSe: { campo: "video_tipo", igual: "Gravar e editar um vídeo" },
      },
      // --- Apenas editar ---
      {
        id: "videoed_gravado",
        label: "O vídeo já foi gravado?",
        tipo: "escolha",
        opcoes: SIM_NAO,
        mostrarSe: {
          campo: "video_tipo",
          igual: "Apenas editar um vídeo já existente",
        },
      },
      {
        id: "videoed_arquivos",
        label:
          "Arquivos e informações que aparecerão em tela (link do Drive)",
        tipo: "link",
        obrigatorio: true,
        mostrarSe: {
          campo: "video_tipo",
          igual: "Apenas editar um vídeo já existente",
        },
        ajuda:
          "O prazo de edição só começa a contar após o recebimento de TODO o material.",
      },
      {
        id: "videoed_oque",
        label: "O que precisa ser editado?",
        tipo: "textoLongo",
        obrigatorio: true,
        mostrarSe: {
          campo: "video_tipo",
          igual: "Apenas editar um vídeo já existente",
        },
      },
      {
        id: "videoed_roteiro",
        label: "Existe roteiro?",
        tipo: "escolha",
        opcoes: SIM_NAO,
        mostrarSe: {
          campo: "video_tipo",
          igual: "Apenas editar um vídeo já existente",
        },
      },
      // --- Comuns ---
      {
        id: "video_data_flag",
        label:
          "Existe alguma data em que o vídeo precisa estar disponível? (evento, lançamento, início de campanha)",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: SIM_NAO,
      },
      {
        id: "video_data",
        label: "Qual é essa data?",
        tipo: "data",
        obrigatorio: true,
        mostrarSe: { campo: "video_data_flag", igual: "Sim" },
      },
      {
        id: "video_onde",
        label: "O vídeo será utilizado onde?",
        tipo: "multi",
        opcoes: [
          "Instagram",
          "TikTok",
          "YouTube",
          "Site",
          "TV interna",
          "Evento",
          "Outro",
        ],
      },
      {
        id: "video_refs",
        label: "Outras referências (link, opcional)",
        tipo: "link",
      },
    ],
  },

  // ----------------------------------------------------------------
  {
    slug: "divulgacao",
    titulo: "Divulgar uma ação, campanha ou comunicado",
    emoji: "📣",
    prazo: "Solicitar com no mínimo 10 dias úteis de antecedência",
    resumoDe: "div_nome",
    campos: [
      {
        id: "div_nome",
        label: "Nome da ação",
        tipo: "texto",
        obrigatorio: true,
      },
      {
        id: "div_desc",
        label: "Descreva resumidamente o que será divulgado",
        tipo: "textoLongo",
        obrigatorio: true,
      },
      {
        id: "div_tipo",
        label: "Qual é o tipo da ação?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: [
          "Evento de grande porte",
          "Evento de pequeno e médio porte",
          "Lançamento de curso",
          "Live",
          "Campanha",
          "Processo Seletivo",
          "Comunicado",
          "Projeto",
          "Parceria",
          "Mutirão de oportunidades",
          "Outro",
        ],
      },
      {
        id: "div_objetivo",
        label: "Qual é o principal objetivo desta comunicação?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: [
          "Informar",
          "Gerar inscrições",
          "Divulgar um lançamento",
          "Engajar a comunidade",
          "Fortalecer a marca",
          "Divulgar um resultado",
          "Captar lead",
          "Outro",
        ],
      },
      {
        id: "div_publico",
        label: "Quem precisa receber essa informação?",
        tipo: "multi",
        obrigatorio: true,
        opcoes: [
          "Alunos atuais",
          "Candidatos (Leads)",
          "Professores",
          "Colaboradores",
          "Polos",
          "Empresas parceiras",
          "Influenciadores",
          "Público externo",
          "Outro",
        ],
      },
      {
        id: "div_publico_pq",
        label: "Por que este é o público prioritário?",
        tipo: "texto",
        obrigatorio: true,
      },
      {
        id: "div_inicio",
        label: "Quando a comunicação precisa começar?",
        tipo: "data",
        obrigatorio: true,
      },
      {
        id: "div_limite",
        label: "Existe uma data limite ou evento principal? Qual data?",
        tipo: "data",
      },
      {
        id: "div_material_pronto",
        label: "Já existe algum material pronto (story, vídeo, banner)?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: SIM_NAO,
      },
      {
        id: "div_producao",
        label: "O Marketing precisa produzir algum material?",
        tipo: "multi",
        opcoes: [
          "Artes",
          "Vídeo",
          "Texto",
          "Roteiro",
          "Cobertura",
          "Fotografia",
          "Outro",
        ],
      },
      { id: "div_obs", label: "Observações", tipo: "textoLongo" },
    ],
  },

  // ----------------------------------------------------------------
  {
    slug: "evento",
    titulo: "Organizar um evento",
    emoji: "📅",
    prazo: PRAZO_A_DEFINIR,
    resumoDe: "ev_nome",
    campos: [
      { id: "ev_nome", label: "Nome do evento", tipo: "texto", obrigatorio: true },
      {
        id: "ev_briefing",
        label: "O evento já possui briefing ou planejamento?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: SIM_NAO,
      },
      {
        id: "ev_briefing_link",
        label: "Link do briefing/planejamento (Drive)",
        tipo: "link",
        obrigatorio: true,
        mostrarSe: { campo: "ev_briefing", igual: "Sim" },
      },
      {
        id: "ev_confirmado",
        label: "O evento já está confirmado?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: SIM_NAO,
      },
      {
        id: "ev_tipo",
        label: "Tipo",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: ["Presencial", "Online", "Híbrido"],
      },
      { id: "ev_data", label: "Data", tipo: "data", obrigatorio: true },
      { id: "ev_hora", label: "Horário", tipo: "texto", placeholder: "ex.: 19:00" },
      { id: "ev_local", label: "Local", tipo: "texto" },
      {
        id: "ev_publico",
        label: "Público esperado",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: [
          "Até 50 pessoas",
          "50 a 150 pessoas",
          "150 a 300 pessoas",
          "Mais de 300 pessoas",
        ],
      },
      {
        id: "ev_objetivo",
        label: "Qual é o objetivo do evento?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: ["Captação", "Relacionamento", "Institucional", "Acadêmico", "Outro"],
      },
      {
        id: "ev_divulgacao",
        label: "O evento precisa de divulgação?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: SIM_NAO,
      },
      {
        id: "ev_div_inicio",
        label: "Existe alguma data em que a divulgação precisa começar?",
        tipo: "data",
        mostrarSe: { campo: "ev_divulgacao", igual: "Sim" },
      },
      {
        id: "ev_cobertura",
        label: "Precisa de cobertura de foto ou vídeo?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: SIM_NAO,
      },
      {
        id: "ev_parceiros",
        label: "O evento possui parceiros?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: SIM_NAO,
      },
      {
        id: "ev_parceiros_quais",
        label: "Quais parceiros?",
        tipo: "texto",
        obrigatorio: true,
        mostrarSe: { campo: "ev_parceiros", igual: "Sim" },
      },
      {
        id: "ev_anexos",
        label: "Anexos (link do Drive)",
        tipo: "link",
      },
      { id: "ev_obs", label: "Observações", tipo: "textoLongo" },
    ],
  },

  // ----------------------------------------------------------------
  {
    slug: "site",
    titulo: "Criar ou atualizar uma página no site",
    emoji: "🌐",
    prazo: "Até 3 dias úteis após a solicitação completa e aprovada",
    resumoDe: "site_oque",
    campos: [
      {
        id: "site_tipo",
        label: "O que você precisa?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: [
          "Criar uma nova página",
          "Atualizar uma página existente",
          "Criar uma Landing Page (LP)",
          "Não tenho certeza",
        ],
      },
      {
        id: "site_objetivo",
        label: "Qual é o objetivo dessa página?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: [
          "Divulgar um curso",
          "Divulgar um evento",
          "Captar leads",
          "Disponibilizar informações",
          "Outro",
        ],
      },
      {
        id: "site_link",
        label: "Link da página existente",
        tipo: "link",
        obrigatorio: true,
        mostrarSe: { campo: "site_tipo", igual: "Atualizar uma página existente" },
      },
      {
        id: "site_oque",
        label: "O que precisa ser criado ou alterado?",
        tipo: "textoLongo",
        obrigatorio: true,
      },
      {
        id: "site_texto_pronto",
        label: "O conteúdo (texto) já está pronto?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: SIM_NAO,
      },
      {
        id: "site_imagens",
        label: "As imagens já estão disponíveis?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: SIM_NAO,
      },
      {
        id: "site_form",
        label: "A página precisa de formulário para captação de interessados?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: ["Sim", "Não", "Não sei"],
      },
      {
        id: "site_data",
        label: "Existe alguma data importante para publicação?",
        tipo: "data",
      },
      { id: "site_anexos", label: "Anexos (link do Drive)", tipo: "link" },
      { id: "site_obs", label: "Observações", tipo: "textoLongo" },
    ],
  },

  // ----------------------------------------------------------------
  {
    slug: "email",
    titulo: "Enviar comunicação por e-mail ou WhatsApp",
    emoji: "📧",
    prazo: "Solicitar com no mínimo 2 dias úteis de antecedência",
    resumoDe: "em_oque",
    campos: [
      {
        id: "em_oque",
        label: "O que deseja comunicar?",
        tipo: "textoLongo",
        obrigatorio: true,
      },
      { id: "em_paraquem", label: "Para quem?", tipo: "texto", obrigatorio: true },
      {
        id: "em_data",
        label: "Existe uma data limite para envio?",
        tipo: "data",
      },
      {
        id: "em_texto_pronto",
        label: "O texto já está pronto?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: SIM_NAO,
      },
      {
        id: "em_lista",
        label: "Existe lista de destinatários?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: SIM_NAO,
      },
      { id: "em_obs", label: "Observações", tipo: "textoLongo" },
    ],
  },

  // ----------------------------------------------------------------
  {
    slug: "lancamento",
    titulo: "Lançar um curso, campanha ou projeto",
    emoji: "🚀",
    prazo: "Até 15 dias úteis após a solicitação completa e aprovada",
    resumoDe: "lan_oque",
    campos: [
      {
        id: "lan_oque",
        label: "O que será lançado?",
        tipo: "textoLongo",
        obrigatorio: true,
      },
      {
        id: "lan_data",
        label: "Existe uma data prevista? Qual?",
        tipo: "data",
        obrigatorio: true,
      },
      {
        id: "lan_briefing",
        label: "Já existe planejamento / briefing?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: SIM_NAO,
      },
      {
        id: "lan_briefing_link",
        label: "Link do briefing (Drive)",
        tipo: "link",
        obrigatorio: true,
        mostrarSe: { campo: "lan_briefing", igual: "Sim" },
      },
      {
        id: "lan_obs",
        label: "Observações",
        tipo: "textoLongo",
        obrigatorio: true,
      },
    ],
  },

  // ----------------------------------------------------------------
  {
    slug: "revisao",
    titulo: "Revisar ou atualizar um material existente",
    emoji: "✏️",
    prazo: PRAZO_A_DEFINIR,
    resumoDe: "rev_oque",
    campos: [
      {
        id: "rev_oque",
        label: "O que deseja alterar?",
        tipo: "textoLongo",
        obrigatorio: true,
      },
      {
        id: "rev_material",
        label: "Material que precisa ser revisado (link do Drive)",
        tipo: "link",
        obrigatorio: true,
      },
      {
        id: "rev_detalhe",
        label: "O que precisa ser alterado (detalhe)?",
        tipo: "textoLongo",
      },
      {
        id: "rev_data",
        label: "Existe alguma data que obrigatoriamente precisa ser considerada?",
        tipo: "data",
      },
      { id: "rev_obs", label: "Observações", tipo: "textoLongo" },
    ],
  },

  // ----------------------------------------------------------------
  {
    slug: "impressao",
    titulo: "Solicitar impressão de um material",
    emoji: "📦",
    prazo: PRAZO_A_DEFINIR,
    resumoDe: "imp_oque",
    campos: [
      {
        id: "imp_aviso",
        label: "Atenção: impressão é atendida SOMENTE na sede.",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: ["Estou ciente"],
      },
      {
        id: "imp_oque",
        label: "O que será impresso?",
        tipo: "textoLongo",
        obrigatorio: true,
      },
      {
        id: "imp_finalizado",
        label: "O arquivo está finalizado?",
        tipo: "escolha",
        obrigatorio: true,
        opcoes: SIM_NAO,
      },
      {
        id: "imp_arquivo",
        label: "Arquivo para impressão (link do Drive)",
        tipo: "link",
        obrigatorio: true,
        mostrarSe: { campo: "imp_finalizado", igual: "Sim" },
      },
      { id: "imp_qtd", label: "Quantidade", tipo: "texto", obrigatorio: true },
      { id: "imp_tamanho", label: "Tamanho", tipo: "texto", obrigatorio: true },
      {
        id: "imp_data",
        label: "Existe alguma data que obrigatoriamente precisa ser considerada?",
        tipo: "data",
      },
      { id: "imp_obs", label: "Observações", tipo: "textoLongo" },
    ],
  },

  // ----------------------------------------------------------------
  {
    slug: "outro",
    titulo: "Outro assunto",
    emoji: "❓",
    prazo: null,
    resumoDe: "out_desc",
    campos: [
      {
        id: "out_desc",
        label: "Descreva sua solicitação",
        tipo: "textoLongo",
        obrigatorio: true,
      },
      {
        id: "out_objetivo",
        label: "Qual o objetivo da solicitação?",
        tipo: "textoLongo",
        obrigatorio: true,
      },
      {
        id: "out_data",
        label: "Existe alguma data que obrigatoriamente precisa ser considerada?",
        tipo: "data",
      },
      { id: "out_anexos", label: "Anexos (link do Drive)", tipo: "link" },
      { id: "out_obs", label: "Observações", tipo: "textoLongo" },
    ],
  },
];

export const CATEGORIA_POR_SLUG: Record<string, Categoria> = Object.fromEntries(
  CATEGORIAS.map((c) => [c.slug, c])
);

/** Um campo condicional está visível para o estado atual de respostas? */
export function campoVisivel(
  campo: Campo,
  valores: Record<string, string | string[]>
): boolean {
  if (!campo.mostrarSe) return true;
  const dep = valores[campo.mostrarSe.campo];
  return dep === campo.mostrarSe.igual;
}
