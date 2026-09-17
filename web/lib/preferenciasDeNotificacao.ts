// lib/preferenciasDeNotificacao.ts
// As regras do cartão "Notificações" do Meu perfil (Spec 054, §6.6).
//
// ⚠️ `lib/` DECIDE (Spec 027): quais linhas a grade tem, que colunas cada linha
// oferece, o que cada toggle se chama e o que a ausência de resposta significa.
// O componente (`components/PreferenciasDeNotificacao.tsx`) só desenha.
//
// ⚠️ ESTE ARQUIVO ESPELHA O CATÁLOGO DO BACKEND
// (`notifications/domain/preferences.py`). Os rótulos são daqui -- o servidor
// manda `type_group`, e nunca texto de tela --, mas as CHAVES e os PAPÉIS têm
// de casar: uma linha com chave que o servidor não conhece é um toggle que
// devolve 422 no primeiro clique.

import type { NotificationToggle } from "./api";

/** Os papéis da Spec 054 (D2). `none` = a linha não se divide por papel. */
export type Papel = "watcher" | "assignee" | "creator" | "none";

/** As colunas da grade, na ordem da spec (§5). */
export const COLUNAS: readonly { readonly papel: Papel; readonly rotulo: string }[] = [
  { papel: "watcher", rotulo: "Seguidor" },
  { papel: "assignee", rotulo: "Responsável" },
  { papel: "creator", rotulo: "Criador" },
];

export type LinhaDePreferencia = {
  /** `type_group` do contrato da API. */
  readonly grupo: string;
  readonly rotulo: string;
  /** Quais colunas esta linha tem. `["none"]` = um toggle só. */
  readonly papeis: readonly Papel[];
  readonly travada: boolean;
  /** Por que é travada (§5). Só nas travadas. */
  readonly ajuda?: string;
};

export type SecaoDePreferencias = {
  readonly titulo: string;
  readonly linhas: readonly LinhaDePreferencia[];
};

const POR_PAPEL: readonly Papel[] = ["watcher", "assignee", "creator"];
/** ⚠️ Prazo não tem coluna de seguidor: o aviso nunca chega por seguir (§5). */
const SO_RESPONSAVEL_E_CRIADOR: readonly Papel[] = ["assignee", "creator"];
const UM_SO: readonly Papel[] = ["none"];

export const SECOES: readonly SecaoDePreferencias[] = [
  {
    titulo: "Comentários",
    linhas: [
      { grupo: "comment", rotulo: "Comentário novo", papeis: POR_PAPEL, travada: false },
    ],
  },
  {
    titulo: "Andamento da tarefa",
    linhas: [
      { grupo: "column", rotulo: "Mudança de coluna", papeis: POR_PAPEL, travada: false },
      { grupo: "due", rotulo: "Mudança de prazo", papeis: POR_PAPEL, travada: false },
      {
        grupo: "description",
        rotulo: "Edição da descrição",
        papeis: POR_PAPEL,
        travada: false,
      },
      {
        grupo: "archive",
        rotulo: "Arquivar e desarquivar",
        papeis: POR_PAPEL,
        travada: false,
      },
      { grupo: "deleted", rotulo: "Exclusão", papeis: POR_PAPEL, travada: false },
    ],
  },
  {
    titulo: "Prazos",
    linhas: [
      {
        grupo: "due_soon",
        rotulo: "Prazo chegando",
        papeis: SO_RESPONSAVEL_E_CRIADOR,
        travada: false,
      },
      {
        grupo: "overdue",
        rotulo: "Prazo vencido",
        papeis: SO_RESPONSAVEL_E_CRIADOR,
        travada: false,
      },
    ],
  },
  {
    titulo: "Sobre você",
    linhas: [
      {
        grupo: "reaction",
        rotulo: "Reação ao seu comentário",
        papeis: UM_SO,
        travada: false,
      },
      {
        grupo: "watch",
        rotulo: "Alguém pôr ou tirar você como seguidor",
        papeis: UM_SO,
        travada: false,
      },
    ],
  },
  {
    titulo: "Sempre ligados",
    linhas: [
      {
        grupo: "mention",
        rotulo: "Menção",
        papeis: UM_SO,
        travada: true,
        ajuda: "Alguém chamou você com @ — sempre avisa.",
      },
      {
        grupo: "assigned",
        rotulo: "Designação",
        papeis: UM_SO,
        travada: true,
        ajuda: "Você virou responsável — sempre avisa.",
      },
      {
        grupo: "access_lost",
        rotulo: "Perda de acesso",
        papeis: UM_SO,
        travada: true,
        ajuda: "Você deixou de ver tarefas — sempre avisa.",
      },
    ],
  },
];

export const LINHAS: readonly LinhaDePreferencia[] = SECOES.flatMap((s) => s.linhas);

/** A grade indexada por `grupo:papel`, para achar cada célula em O(1). */
export type MapaDeToggles = ReadonlyMap<string, NotificationToggle>;

export function chave(grupo: string, papel: Papel): string {
  return `${grupo}:${papel}`;
}

export function mapear(toggles: readonly NotificationToggle[]): MapaDeToggles {
  return new Map(toggles.map((t) => [chave(t.type_group, t.role as Papel), t]));
}

/**
 * O toggle está ligado?
 *
 * ⚠️ AUSENTE CONTA COMO LIGADO, e isso não é descuido: no servidor a ausência
 * de linha em `notification_mute` já SIGNIFICA ligado (D11). Se a resposta não
 * trouxer uma célula -- servidor mais antigo, grupo novo no front --, mostrar
 * "ligado" diz a verdade sobre o que a pessoa vai receber. Mostrar "desligado"
 * inventaria um silêncio que não existe.
 */
export function estaLigado(mapa: MapaDeToggles, grupo: string, papel: Papel): boolean {
  return mapa.get(chave(grupo, papel))?.enabled ?? true;
}

/** Quantos toggles estão desligados -- o resumo do cabeçalho do cartão. */
export function quantosDesligados(toggles: readonly NotificationToggle[]): number {
  return toggles.filter((t) => !t.enabled && !t.locked).length;
}

/** O texto do resumo. Nada desligado = frase que diz isso, e não "0". */
export function resumo(toggles: readonly NotificationToggle[]): string {
  const n = quantosDesligados(toggles);
  if (n === 0) return "Você recebe todos os avisos.";
  return n === 1 ? "1 aviso desligado." : `${n} avisos desligados.`;
}

/**
 * O nome acessível do interruptor. É o que o leitor de tela anuncia, então
 * carrega a linha E a coluna: numa grade de 24, "Ligado" sozinho não diz nada.
 */
export function rotuloDoToggle(linha: LinhaDePreferencia, papel: Papel): string {
  const coluna = COLUNAS.find((c) => c.papel === papel);
  return coluna ? `${linha.rotulo}, como ${coluna.rotulo.toLowerCase()}` : linha.rotulo;
}
