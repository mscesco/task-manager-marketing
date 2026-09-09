"use client";
// components/MembersTable.tsx
// A tabela de pessoas — Spec 047, fatias C e E; redesenhada em 09/09.
//
// ⚠️⚠️ UMA TABELA SÓ, USADA PELAS DUAS TELAS. A §5 deixou a fatia E aberta com
// este aviso literal: *"duas telas listando pessoas, com regras diferentes, é
// o começo do próximo defeito de contador."* Compartilhar o componente é o que
// torna esse defeito impossível — não há duas regras para divergirem.
//
//     /times/[id]   -> as pessoas daquela árvore, com o cargo de cada uma
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
import TemporaryPassword from "@/components/TemporaryPassword";
import MemberDrawer from "@/components/MemberDrawer";
import {
  type CurrentUser,
  type Member,
  type MemberRole,
  type Team,
} from "@/lib/api";
import { type TeamRow } from "@/lib/teamScreen";
import { alcanceDe } from "@/lib/permissoesMembros";

export const ROLE_LABEL: Record<MemberRole, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gerente",
  SUPERVISOR: "Supervisor",
  OPERATOR: "Operador",
};

type RevealedPassword = { title: string; email: string; password: string };

export default function MembersTable({
  rows,
  teams,
  me,
  middleColumn,
  count,
  onChanged,
}: {
  rows: TeamRow[];
  teams: Team[];
  me: CurrentUser | null;
  /** O título e o conteúdo da coluna do meio — o que muda entre as telas. */
  middleColumn: { title: string; render: (row: TeamRow) => ReactNode };
  /** Texto do contador. ⚠️ Diz o TOTAL — ver o comentário no `<caption>`. */
  count?: string;
  onChanged: (aviso: string) => Promise<void>;
}) {
  const [gavetaDe, setGavetaDe] = useState<Member | null>(null);
  const [revelado, setRevelado] = useState<RevealedPassword | null>(null);
  const scope = alcanceDe(me);

  return (
    <>
      {/* ⚠️ O reveal-once fica AQUI e não dentro da gaveta: fechar a gaveta
          levaria o segredo junto, e não há rota para relê-lo (ADR 0021). */}
      {revelado && (
        <TemporaryPassword
          title={revelado.title}
          email={revelado.email}
          password={revelado.password}
          onClose={() => setRevelado(null)}
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
            {count ??
              `${rows.length} ${rows.length === 1 ? "pessoa" : "pessoas"}`}
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
                {middleColumn.title}
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
            {rows.map((row) => (
              <Linha
                key={row.member.id}
                row={row}
                middleColumn={middleColumn}
                onOpen={() => setGavetaDe(row.member)}
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
          <MemberDrawer
            key={gavetaDe.id}
            member={gavetaDe}
            teams={teams}
            scope={scope}
            isAdmin={me?.roles.includes("ADMIN") ?? false}
            canManageOrg={
              me?.permissions.includes("workspace.manage") ?? false
            }
            isSelf={gavetaDe.id === me?.id}
            onClose={() => setGavetaDe(null)}
            onRevealPassword={setRevelado}
            onChanged={async (texto) => {
              setGavetaDe(null);
              await onChanged(texto);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function Linha({
  row,
  middleColumn,
  onOpen,
}: {
  row: TeamRow;
  middleColumn: { title: string; render: (row: TeamRow) => ReactNode };
  onOpen: () => void;
}) {
  const { member, subteams, outrasAreas } = row;

  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-3 py-2 align-middle">
        <strong className="font-semibold">{member.name}</strong>
      </td>

      <td className="muted px-3 py-2 align-middle text-xs">{member.email}</td>

      <td className="px-3 py-2 align-middle">{middleColumn.render(row)}</td>

      {/* ⚠️ CÁPSULA COM O CARGO JUNTO (`SEO · Supervisor`). Sem o cargo, a
          coluna mostra ONDE e esconde O QUÊ, numa tela cujo assunto é
          permissão. */}
      <td className="px-3 py-2 align-middle">
        <span className="flex flex-wrap gap-1.5">
          {subteams.length === 0 && outrasAreas === 0 && (
            <span className="muted text-xs">—</span>
          )}
          {subteams.map((c) => (
            <Badge key={c.team.id} tone="soft" size="sm" color="var(--accent)">
              {c.team.name} · {ROLE_LABEL[c.role]}
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
          aria-label={`Editar ${member.name}`}
          onClick={onOpen}
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
// ele PRECISA carregar junto está registrado em `lib/teamScreen.ts`:
// `rolesLostOnUnpick` (desmarcar apaga o cargo, e remarcar traz a pessoa como
// operadora), `pickerOptions` (quem já está marcado nunca some da lista) e
// `membershipPlan` (adicionar ANTES de remover, senão trocar o único time de
// alguém é impossível). As três continuam testadas.
