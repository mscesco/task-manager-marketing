"use client";
// components/TabelaDeMembros.tsx
// A tabela de pessoas — Spec 047, fatias C e E; redesenhada em 09/09.
//
// ⚠️⚠️ UMA TABELA SÓ, USADA PELAS DUAS TELAS. A §5 deixou a fatia E aberta com
// este aviso literal: *"duas telas listando pessoas, com regras diferentes, é
// o começo do próximo defeito de contador."* Compartilhar o componente é o que
// torna esse defeito impossível — não há duas regras para divergirem.
//
//     /times/[id]   -> as pessoas daquela árvore, coluna do meio "Cargo aqui"
//     /membros      -> a organização inteira, coluna do meio "Áreas"
//
// ⚠️⚠️ UMA AÇÃO SÓ NA LINHA, e essa é a mudança de 09/09. Antes havia DUAS
// portas para o mesmo assunto: o lápis abria um seletor de checkboxes ("em
// quais times") e o `⋯` abria o painel ("com que cargo"). Quem administra
// precisava lembrar qual delas abria o quê — e a Camila, olhando a tela,
// pediu: *"tirar o três pontos e editar, deixar só o editar, que traz uma
// side bar"*.
//
// Agora o lápis abre a GAVETA, e ela responde as duas perguntas, porque as
// duas são "o vínculo".
//
// ⚠️ O SELETOR DE CHECKBOXES SAIU JUNTO. O que ele tinha de bom não se
// perdeu: o aviso de que desmarcar APAGA O CARGO virou a confirmação de
// "Tirar de X" dentro da gaveta. O que ele tinha de ruim -- escrever N
// vínculos sem transação, e mentir na tela quando uma das escritas falhava no
// meio -- deixou de existir, porque a gaveta escreve um vínculo por vez.
//
// ⚠️ MORA EM `components/`, e não em `app/`: o `include` do vitest cobre
// `components/**`, então este arquivo PODE ganhar teste. A §7 da spec pede
// isso — `app/` fica de fora, e é lá que a tela some do alcance dos portões.

import { useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { Pencil } from "lucide-react";
import Badge from "@/components/Badge";
import SenhaProvisoria from "@/components/SenhaProvisoria";
import SidebarDoMembro from "@/components/SidebarDoMembro";
import {
  type CurrentUser,
  type Member,
  type MemberRole,
  type Team,
} from "@/lib/api";
import { type LinhaDoTime } from "@/lib/telaDoTime";
import { alcanceDe } from "@/lib/permissoesMembros";

export const PAPEL: Record<MemberRole, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gerente",
  SUPERVISOR: "Supervisor",
  OPERATOR: "Operador",
};

type Revelado = { titulo: string; email: string; senha: string };

export default function TabelaDeMembros({
  linhas,
  times,
  me,
  colunaDoMeio,
  contagem,
  onMudou,
}: {
  linhas: LinhaDoTime[];
  times: Team[];
  me: CurrentUser | null;
  /** O título e o conteúdo da coluna do meio — o que muda entre as telas. */
  colunaDoMeio: { titulo: string; render: (linha: LinhaDoTime) => ReactNode };
  /** Texto do contador. ⚠️ Diz o TOTAL — ver o comentário no `<caption>`. */
  contagem?: string;
  onMudou: (aviso: string) => Promise<void>;
}) {
  const [gavetaDe, setGavetaDe] = useState<Member | null>(null);
  const [revelado, setRevelado] = useState<Revelado | null>(null);
  const alcance = alcanceDe(me);

  return (
    <>
      {/* ⚠️ O reveal-once fica AQUI e não dentro da gaveta: fechar a gaveta
          levaria o segredo junto, e não há rota para relê-lo (ADR 0021). */}
      {revelado && (
        <SenhaProvisoria
          titulo={revelado.titulo}
          email={revelado.email}
          senha={revelado.senha}
          onFechar={() => setRevelado(null)}
        />
      )}

      {/* ⚠️ `<table>` semântica, e não `div`s com `grid`: são dados tabulares,
          e leitor de tela só anuncia coluna e linha com `<th scope="col">`.
          ⚠️ `overflow-x-auto` no wrapper: a coluna de cápsulas cresce com o
          número de vínculos, e sem isso a página inteira ganha barra
          horizontal (a §7 avisa que largura de texto não tem guardião). */}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-sm">
          <caption className="muted border-b border-border px-3 py-2 text-left text-xs">
            {/* ⚠️ O CONTADOR DIZ O TOTAL, sempre. A §3.2: esconder linha já
                causou o defeito de 27/07, com o cabeçalho divergindo do corpo.
                Quem FILTRA passa um texto do tipo "12 de 15" — nunca só o
                número do que sobrou. */}
            {contagem ??
              `${linhas.length} ${linhas.length === 1 ? "pessoa" : "pessoas"}`}
          </caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="label px-3 py-2 text-left">
                Membro
              </th>
              <th scope="col" className="label px-3 py-2 text-left">
                E-mail
              </th>
              <th scope="col" className="label px-3 py-2 text-left">
                {colunaDoMeio.titulo}
              </th>
              <th scope="col" className="label px-3 py-2 text-left">
                Times
              </th>
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => (
              <Linha
                key={linha.membro.id}
                linha={linha}
                colunaDoMeio={colunaDoMeio}
                onAbrir={() => setGavetaDe(linha.membro)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* ⚠️ `AnimatePresence` é o que permite a gaveta SAIR animada: sem ele o
          React desmonta o nó na hora e o `exit` nunca roda. Entrar suave e
          sumir seco é pior que não animar -- a saída é justamente quando a
          pessoa precisa perceber que a tabela voltou a ser o assunto. */}
      <AnimatePresence>
        {gavetaDe && (
          <SidebarDoMembro
            key={gavetaDe.id}
            membro={gavetaDe}
            times={times}
            alcance={alcance}
            souAdmin={me?.roles.includes("ADMIN") ?? false}
            podeMexerNaOrganizacao={
              me?.permissions.includes("workspace.manage") ?? false
            }
            souEu={gavetaDe.id === me?.id}
            onFechar={() => setGavetaDe(null)}
            onRevelarSenha={setRevelado}
            onMudou={async (texto) => {
              setGavetaDe(null);
              await onMudou(texto);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function Linha({
  linha,
  colunaDoMeio,
  onAbrir,
}: {
  linha: LinhaDoTime;
  colunaDoMeio: { titulo: string; render: (linha: LinhaDoTime) => ReactNode };
  onAbrir: () => void;
}) {
  const { membro, subtimes, outrasAreas } = linha;

  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-3 py-2 align-middle">
        <strong className="font-semibold">{membro.name}</strong>
      </td>

      <td className="muted px-3 py-2 align-middle text-xs">{membro.email}</td>

      <td className="px-3 py-2 align-middle">{colunaDoMeio.render(linha)}</td>

      {/* ⚠️ CÁPSULA COM O CARGO JUNTO (`SEO · Supervisor`). Sem o cargo, a
          coluna mostra ONDE e esconde O QUÊ, numa tela cujo assunto é
          permissão. */}
      <td className="px-3 py-2 align-middle">
        <span className="flex flex-wrap gap-1.5">
          {subtimes.length === 0 && outrasAreas === 0 && (
            <span className="muted text-xs">—</span>
          )}
          {subtimes.map((c) => (
            <Badge key={c.team.id} tone="soft" size="sm" color="var(--accent)">
              {c.team.name} · {PAPEL[c.role]}
            </Badge>
          ))}
          {outrasAreas > 0 && (
            <Badge tone="outline" size="sm">
              +{outrasAreas} {outrasAreas === 1 ? "área" : "áreas"}
            </Badge>
          )}
        </span>
      </td>

      {/* ⚠️⚠️ UM BOTÃO SÓ. E ele aparece para TODO MUNDO, inclusive para quem
          não administra nada: a gaveta também RESPONDE "onde esta pessoa
          está", e essa leitura vale para qualquer um. Quem não pode escrever
          não vê os controles — a gaveta trava ação por ação, com o
          `can_edit_role` que vem do backend. */}
      <td className="whitespace-nowrap px-3 py-2 text-right align-middle">
        <button
          className="btn btn-ghost"
          aria-label={`Editar ${membro.name}`}
          onClick={onAbrir}
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
}

// ⚠️⚠️ A COLUNA "STATUS" SAIU DAQUI, e não foi por espaço: ela virou as ABAS
// (Ativos · Convidados · Inativos). Um selo repetido em toda linha dizia o
// estado de cada pessoa e não respondia a pergunta real -- *"quem ainda não
// entrou?"* --, que exigia varrer a tabela com os olhos. A aba responde, e o
// número ao lado dela responde antes mesmo do clique.
//
// ⚠️ E o filtro NÃO esconde gente em silêncio: a aba ativa está sempre
// visível, cada aba mostra a própria contagem, e o `<caption>` diz "N de M".
// É o que a §3.2 exige de quem filtra -- o defeito de 27/07 foi o cabeçalho
// divergindo do corpo, não o filtro em si.
//
// ⚠️⚠️ E AQUI MORAVA `SeletorDeSubtimes`, o painel de checkboxes do lápis.
// Ele saiu com o redesenho de 09/09. Se for reintroduzido algum dia, o que
// ele PRECISA carregar junto está registrado em `lib/telaDoTime.ts`:
// `cargosQueSePerdem` (desmarcar apaga o cargo, e remarcar traz a pessoa como
// operadora), `opcoesDoSeletor` (quem já está marcado nunca some da lista) e
// `planoDeVinculos` (adicionar ANTES de remover, senão trocar o único time de
// alguém é impossível). As três continuam testadas.
