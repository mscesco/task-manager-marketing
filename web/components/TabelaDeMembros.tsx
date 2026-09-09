"use client";
// components/TabelaDeMembros.tsx
// A tabela de pessoas — Spec 047, fatias C e E.
//
// ⚠️⚠️ UMA TABELA SÓ, USADA PELAS DUAS TELAS. A §5 deixou a fatia E aberta com
// este aviso literal: *"duas telas listando pessoas, com regras diferentes, é
// o começo do próximo defeito de contador."* Compartilhar o componente é o que
// torna esse defeito impossível — não há duas regras para divergirem.
//
//     /times/[id]   -> as pessoas daquela árvore, coluna do meio "Cargo aqui"
//     /membros      -> a organização inteira, coluna do meio "Áreas"
//
// ⚠️ MORA EM `components/`, e não em `app/`: o `include` do vitest cobre
// `components/**`, então este arquivo PODE ganhar teste. A §7 da spec pede
// isso — `app/` fica de fora, e é lá que a tela some do alcance dos portões.
//
// A divisão da §4.4: a tabela mostra · o lápis define em QUAIS subtimes · o
// painel define COM QUE CARGO em cada um.

import { useMemo, useState, type ReactNode } from "react";
import { MoreHorizontal, Pencil } from "lucide-react";
import Badge from "@/components/Badge";
import PainelDoMembro from "@/components/PainelDoMembro";
import {
  ApiError,
  assignMemberToTeam,
  removeMemberFromTeam,
  type CurrentUser,
  type Member,
  type MemberRole,
  type Team,
} from "@/lib/api";
import {
  cargosQueSePerdem,
  opcoesDoSeletor,
  planoDeVinculos,
  type CapsulaDeSubtime,
  type LinhaDoTime,
} from "@/lib/telaDoTime";
import { alcanceDe } from "@/lib/permissoesMembros";

export const PAPEL: Record<MemberRole, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gerente",
  SUPERVISOR: "Supervisor",
  OPERATOR: "Operador",
};

export default function TabelaDeMembros({
  linhas,
  times,
  me,
  oferecidos,
  podeMexer,
  colunaDoMeio,
  contagem,
  onMudou,
}: {
  linhas: LinhaDoTime[];
  times: Team[];
  me: CurrentUser | null;
  /** Subtimes que o lápis oferece. Vazio = sem lápis. */
  oferecidos: Team[];
  podeMexer: boolean;
  /** O título e o conteúdo da coluna do meio — o que muda entre as telas. */
  colunaDoMeio: { titulo: string; render: (linha: LinhaDoTime) => ReactNode };
  /** Texto do contador. ⚠️ Diz o TOTAL — ver o comentário no `<caption>`. */
  contagem?: string;
  onMudou: (aviso: string) => Promise<void>;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [painelDe, setPainelDe] = useState<Member | null>(null);
  const alcance = alcanceDe(me);

  return (
    <>
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
                Status
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
                oferecidos={oferecidos}
                podeMexer={podeMexer && oferecidos.length > 0}
                colunaDoMeio={colunaDoMeio}
                editando={editando === linha.membro.id}
                onEditar={() =>
                  setEditando(
                    editando === linha.membro.id ? null : linha.membro.id,
                  )
                }
                onAbrirPainel={() => setPainelDe(linha.membro)}
                onFechar={() => setEditando(null)}
                onMudou={async (texto) => {
                  setEditando(null);
                  await onMudou(texto);
                }}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* ⚠️ O PAINEL mostra TODOS os vínculos e edita só os do escopo, com o
          `can_edit_role` que a fatia A pôs na rota. A tela NÃO recalcula
          escopo: a Spec 034 já desfez essa tentativa uma vez. */}
      {painelDe && (
        <PainelDoMembro
          membro={painelDe}
          times={times}
          alcance={alcance}
          souAdmin={me?.roles.includes("ADMIN") ?? false}
          podeMexerNaOrganizacao={
            me?.permissions.includes("workspace.manage") ?? false
          }
          souEu={painelDe.id === me?.id}
          onFechar={() => setPainelDe(null)}
          onMudou={async (texto) => {
            setPainelDe(null);
            await onMudou(texto);
          }}
        />
      )}
    </>
  );
}

function Linha({
  linha,
  oferecidos,
  podeMexer,
  colunaDoMeio,
  editando,
  onEditar,
  onAbrirPainel,
  onFechar,
  onMudou,
}: {
  linha: LinhaDoTime;
  oferecidos: Team[];
  podeMexer: boolean;
  colunaDoMeio: { titulo: string; render: (linha: LinhaDoTime) => ReactNode };
  editando: boolean;
  onEditar: () => void;
  onAbrirPainel: () => void;
  onFechar: () => void;
  onMudou: (aviso: string) => Promise<void>;
}) {
  const { membro, subtimes, outrasAreas } = linha;

  return (
    <>
      <tr className="border-b border-border last:border-b-0">
        <td className="px-3 py-2 align-middle">
          <strong className="font-semibold">{membro.name}</strong>
        </td>

        {/* ⚠️ O status é NA ORGANIZAÇÃO, e não neste time: desativar desliga a
            conta inteira (ver o painel). Mostra os DOIS estados — coluna que
            às vezes fica vazia não se lê como coluna. */}
        <td className="px-3 py-2 align-middle">
          <Badge
            tone={membro.is_active ? "soft" : "outline"}
            size="sm"
            color={membro.is_active ? "var(--accent)" : undefined}
          >
            {membro.is_active ? "Ativo" : "Inativo"}
          </Badge>
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

        {/* ⚠️ Na linha ficam só cargo e subtime, que é o que se mexe toda
            semana. Desativar e trocar cargo vão para o painel. */}
        <td className="whitespace-nowrap px-3 py-2 text-right align-middle">
          {podeMexer && (
            <button
              className="btn btn-ghost"
              aria-label={`Editar times de ${membro.name}`}
              onClick={onEditar}
            >
              <Pencil size={14} aria-hidden="true" />
            </button>
          )}
          <button
            className="btn btn-ghost"
            aria-label={`Ver detalhes de ${membro.name}`}
            onClick={onAbrirPainel}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
        </td>
      </tr>

      {/* ⚠️ Linha PRÓPRIA com `colSpan`, e não conteúdo dentro de uma célula:
          dentro, o seletor herdaria a largura da coluna e espremeria os
          checkboxes. */}
      {editando && (
        <tr className="border-b border-border">
          <td colSpan={6} className="bg-surface-2 p-0">
            <SeletorDeSubtimes
              membro={membro}
              atuais={subtimes}
              oferecidos={oferecidos}
              onCancelar={onFechar}
              onMudou={onMudou}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * O seletor do lápis: em QUAIS times a pessoa está.
 *
 * ⚠️⚠️ DESMARCAR APAGA O CARGO, e é o defeito que nenhum portão pega. Se a
 * pessoa era supervisora no SEO, desmarcar e remarcar a traz de volta como
 * Operador — perda silenciosa por um checkbox. Por isso a confirmação é
 * SELETIVA: livre quando o cargo é operador, nomeada quando não é.
 */
function SeletorDeSubtimes({
  membro,
  atuais,
  oferecidos,
  onCancelar,
  onMudou,
}: {
  membro: Member;
  atuais: CapsulaDeSubtime[];
  oferecidos: Team[];
  onCancelar: () => void;
  onMudou: (aviso: string) => Promise<void>;
}) {
  const opcoes = useMemo(
    () => opcoesDoSeletor(oferecidos, atuais),
    [oferecidos, atuais],
  );
  const [marcados, setMarcados] = useState<string[]>(
    atuais.map((c) => c.team.id),
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const perdidos = cargosQueSePerdem(atuais, marcados);

  async function salvar() {
    // ⚠️ A CONFIRMAÇÃO VEM ANTES DE QUALQUER ESCRITA, e nomeia o que se perde.
    if (perdidos.length > 0 && !confirmando) {
      setConfirmando(true);
      return;
    }
    setSalvando(true);
    // ⚠️⚠️ A ORDEM VEM DE `planoDeVinculos`: ADICIONAR ANTES DE REMOVER.
    // Removendo primeiro, trocar o ÚNICO time de alguém era impossível -- o
    // backend recusa remover o último vínculo, então desmarcar Marketing e
    // marcar SEO batia em 409 antes de o SEO existir, mesmo com o estado
    // final perfeitamente válido. A regra tem teste próprio.
    const plano = planoDeVinculos(atuais, marcados);
    let escreveu = false;
    try {
      for (const id of plano.adicionar) {
        // ⚠️ OPERADOR É O PADRÃO, por um motivo estrutural: operador é o
        // piso do modelo, então adicionar alguém NUNCA viola a regra da
        // Spec 044 §4.1-bis ("o papel na raiz não pode ser menor").
        await assignMemberToTeam(membro.id, id, "OPERATOR");
        escreveu = true;
      }
      for (const id of plano.remover) {
        await removeMemberFromTeam(membro.id, id);
        escreveu = true;
      }
      await onMudou(
        perdidos.length > 0
          ? `${membro.name}: times atualizados. O cargo em ${perdidos
              .map((c) => c.team.name)
              .join(", ")} foi perdido.`
          : `${membro.name}: times atualizados.`,
      );
    } catch (e) {
      const a = e as ApiError;
      const motivo = a.message || "Não consegui salvar.";

      // ⚠️⚠️ NÃO HÁ TRANSAÇÃO: cada time é uma requisição. Se alguma já
      // passou antes da falha, o banco mudou e a tabela na tela está
      // MENTINDO -- mostrando times que a pessoa não tem mais, ou escondendo
      // os que ganhou. A primeira versão só chamava `setErro` e deixava a
      // tela como estava.
      //
      // Recarregar no erro é o que devolve a verdade. E a mensagem diz que a
      // mudança foi PARCIAL, porque "não consegui salvar" faria a pessoa
      // supor que nada aconteceu.
      if (escreveu) {
        await onMudou(
          `${membro.name}: a mudança foi aplicada só em parte — ${motivo} ` +
            "A lista abaixo já mostra como ficou.",
        );
        return;
      }
      setErro(motivo);
      setConfirmando(false);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="px-3 py-3">
      <div className="label mb-2">Times de {membro.name}</div>

      {opcoes.length === 0 ? (
        <div className="muted text-xs">Não há times para escolher aqui.</div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {opcoes.map((t) => (
            <label key={t.id} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={marcados.includes(t.id)}
                disabled={salvando}
                onChange={(e) => {
                  setConfirmando(false);
                  setMarcados((atual) =>
                    e.target.checked
                      ? [...atual, t.id]
                      : atual.filter((x) => x !== t.id),
                  );
                }}
              />
              {t.name}
            </label>
          ))}
        </div>
      )}

      {confirmando && (
        <div className="mt-3 rounded border border-border p-2">
          <div className="text-xs">
            {membro.name} deixa de ser{" "}
            {perdidos
              .map((c) => `${PAPEL[c.role].toLowerCase()} em ${c.team.name}`)
              .join(", ")}
            .
          </div>
          <div className="muted mt-1 text-xs">
            Se você marcar de volta depois, a pessoa entra como Operador — o
            cargo não volta sozinho.
          </div>
        </div>
      )}

      {erro && <div className="error-box mt-2 text-xs">{erro}</div>}

      <div className="mt-3 flex gap-2">
        <button
          className={confirmando ? "btn btn-danger" : "btn btn-primary"}
          disabled={salvando}
          onClick={() => void salvar()}
        >
          {confirmando ? "Salvar assim mesmo" : "Salvar"}
        </button>
        <button className="btn btn-ghost" disabled={salvando} onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
