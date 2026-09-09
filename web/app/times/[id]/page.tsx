"use client";
// app/times/[id]/page.tsx
// A tela de UM TIME (Spec 047, fatia C) — onde se administra PESSOAS.
//
// A divisão que a spec estabelece (§4.4), e vale ter em mente ao mexer aqui:
//
//     a tabela  mostra
//     o lápis   define em QUAIS subtimes
//     o painel  define COM QUE CARGO em cada um   (fatia D)
//
// ⚠️ UMA TELA SÓ PARA ÁREA E SUBTIME, e a decisão é explícita: gerir uma área
// e gerir um subtime são públicos diferentes, mas duas telas divergem com o
// tempo — e separar depois é mais fácil do que reunificar.
//
// ⚠️ TODA DECISÃO MORA EM `lib/telaDoTime.ts`, testada. `app/` está fora do
// `include` do vitest, e nesta fatia isso é crítico: as duas regras mais
// delicadas (quem aparece, e o que se perde ao desmarcar) são justamente as
// que não dão erro quando saem erradas.
//
// ⚠️ SEM `useSearchParams` — a rota é dinâmica (`ƒ /times/[id]`, por causa do
// `[id]`), então o `next build` passaria de qualquer forma; mas não há estado
// de URL aqui e não vale inventar um.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { MoreHorizontal, Pencil } from "lucide-react";
import AppShell from "@/components/AppShell";
import Badge from "@/components/Badge";
import PageHeader from "@/components/PageHeader";
import {
  ApiError,
  assignMemberToTeam,
  currentUser,
  deactivateMember,
  listMembers,
  listTeamsAll,
  removeMemberFromTeam,
  type CurrentUser,
  type Member,
  type MemberRole,
  type Team,
} from "@/lib/api";
import {
  cargosQueSePerdem,
  linhasDoTime,
  opcoesDoSeletor,
  subtimesOferecidos,
  type CapsulaDeSubtime,
  type LinhaDoTime,
} from "@/lib/telaDoTime";
import { alcanceDe, podeDesativarConta, podeMoverSubtime } from "@/lib/permissoesMembros";

// ⚠️ MASCULINO, por decisão da Camila (09/09): *"quero tudo universal, então
// tudo no masculino"*. Espelha o `PAPEL_LABEL` da tela de membros.
const PAPEL: Record<MemberRole, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gerente",
  SUPERVISOR: "Supervisor",
  OPERATOR: "Operador",
};

export default function TimePage() {
  const params = useParams<{ id: string }>();
  const teamId = params.id;

  const [times, setTimes] = useState<Team[]>([]);
  const [membros, setMembros] = useState<Member[]>([]);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [menuAberto, setMenuAberto] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [t, m, u] = await Promise.all([
        listTeamsAll(),
        listMembers(),
        currentUser(),
      ]);
      setTimes(t);
      setMembros(m);
      setMe(u);
      setErro(null);
    } catch (e) {
      setErro((e as ApiError).message || "Não consegui carregar o time.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const time = times.find((t) => t.id === teamId) ?? null;
  const linhas = useMemo(
    () => linhasDoTime(teamId, times, membros),
    [teamId, times, membros],
  );
  const oferecidos = useMemo(
    () => subtimesOferecidos(teamId, times),
    [teamId, times],
  );

  const alcance = alcanceDe(me);
  const podeMexer = podeMoverSubtime(alcance);
  const podeDesativar = podeDesativarConta(alcance);

  if (!carregando && !time) {
    return (
      <AppShell>
        <div className="muted">
          Time não encontrado. Volte para a{" "}
          <Link href="/organizacao" className="text-accent underline">
            organização
          </Link>
          .
        </div>
      </AppShell>
    );
  }

  const ehArea = time?.parent_team_id === null;

  return (
    <AppShell>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            {time ? time.name : "Time"}
            {time && (
              // ⚠️ Diz o NÍVEL, porque a tela é a mesma para os dois e o
              // conteúdo muda: numa área aparece todo mundo da árvore; num
              // subtime, só quem está nele e abaixo.
              <Badge tone="outline" size="sm">
                {ehArea ? "Área" : "Subtime"}
              </Badge>
            )}
          </span>
        }
      />

      {erro && <div className="error-box">{erro}</div>}

      {aviso && (
        <div role="status" className="muted mb-4 flex items-start gap-2 text-xs">
          <span>{aviso}</span>
          <button
            className="btn btn-ghost px-1.5 text-xs"
            onClick={() => setAviso(null)}
          >
            Entendi
          </button>
        </div>
      )}

      {carregando ? (
        <div className="muted">Carregando…</div>
      ) : linhas.length === 0 ? (
        <div className="muted">Ninguém neste time ainda.</div>
      ) : (
        // ⚠️⚠️ TABELA DE VERDADE, com `<thead>` e colunas alinhadas -- e não
        // uma lista onde tudo flui na mesma linha. A primeira versão era uma
        // lista, e a Camila comparou com a referência que ela mesma tinha
        // mandado: *"tá vendo a diferença? quero que seja separado igual está
        // no modelo"*. Estava certa -- sem colunas, nada alinha
        // verticalmente, e a tela deixa de ser consultável: você não consegue
        // correr o olho por "quem está inativo" ou "quem é supervisor".
        //
        // ⚠️ `<table>` semântica, e não `div`s com `grid`: são dados
        // tabulares, e leitor de tela anuncia coluna e linha só com a marcação
        // certa (`<th scope="col">`).
        //
        // ⚠️ `overflow-x-auto` no wrapper: a coluna de cápsulas cresce com o
        // número de subtimes, e sem isso a página inteira ganha barra
        // horizontal (a §7 avisa que largura de texto não tem guardião).
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-sm">
            <caption className="muted border-b border-border px-3 py-2 text-left text-xs">
              {/* ⚠️ O CONTADOR DIZ O TOTAL, sempre. A §3.2: esconder linha já
                  causou o defeito de 27/07, com o cabeçalho divergindo do
                  corpo. Se um dia filtrar, aqui vira "12 de 15". */}
              {linhas.length} {linhas.length === 1 ? "pessoa" : "pessoas"}
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
                  Cargo aqui
                </th>
                <th scope="col" className="label px-3 py-2 text-left">
                  Subtimes
                </th>
                {/* Coluna de ações: sem rótulo visível, mas anunciada. */}
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((linha) => (
                <LinhaDeMembro
                  key={linha.membro.id}
                  linha={linha}
                  teamId={teamId}
                  oferecidos={oferecidos}
                  podeMexer={podeMexer}
                  podeDesativar={podeDesativar}
                  souEu={linha.membro.id === me?.id}
                  editando={editando === linha.membro.id}
                  menuAberto={menuAberto === linha.membro.id}
                  onEditar={() =>
                    setEditando(
                      editando === linha.membro.id ? null : linha.membro.id,
                    )
                  }
                  onMenu={() =>
                    setMenuAberto(
                      menuAberto === linha.membro.id ? null : linha.membro.id,
                    )
                  }
                  onFechar={() => {
                    setEditando(null);
                    setMenuAberto(null);
                  }}
                  onMudou={async (texto) => {
                    setEditando(null);
                    setMenuAberto(null);
                    setAviso(texto);
                    await carregar();
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

/** Uma linha da tabela. */
function LinhaDeMembro({
  linha,
  teamId,
  oferecidos,
  podeMexer,
  podeDesativar,
  souEu,
  editando,
  menuAberto,
  onEditar,
  onMenu,
  onFechar,
  onMudou,
}: {
  linha: LinhaDoTime;
  teamId: string;
  oferecidos: Team[];
  podeMexer: boolean;
  podeDesativar: boolean;
  souEu: boolean;
  editando: boolean;
  menuAberto: boolean;
  onEditar: () => void;
  onMenu: () => void;
  onFechar: () => void;
  onMudou: (aviso: string) => Promise<void>;
}) {
  const { membro, cargoAqui, subtimes, outrasAreas } = linha;

  return (
    <>
      <tr className="border-b border-border last:border-b-0">
        {/* MEMBRO */}
        <td className="px-3 py-2 align-middle">
          <strong className="font-semibold">{membro.name}</strong>
        </td>

        {/* STATUS -- ⚠️ NA ORGANIZAÇÃO, e não neste time. Desativar desliga a
            conta inteira; ver o menu `⋯`. Mostra os DOIS estados, e não só o
            inativo: uma coluna que às vezes está vazia não se lê como coluna. */}
        <td className="px-3 py-2 align-middle">
          <Badge
            tone={membro.is_active ? "soft" : "outline"}
            size="sm"
            color={membro.is_active ? "var(--accent)" : undefined}
          >
            {membro.is_active ? "Ativo" : "Inativo"}
          </Badge>
        </td>

        {/* E-MAIL */}
        <td className="muted px-3 py-2 align-middle text-xs">{membro.email}</td>

        {/* CARGO NESTE TIME -- vazio quando a pessoa só está num subtime. */}
        <td className="px-3 py-2 align-middle">
          {cargoAqui ? (
            <Badge tone="neutral" size="sm" className="border">
              {PAPEL[cargoAqui]}
            </Badge>
          ) : (
            <span className="muted text-xs">—</span>
          )}
        </td>

        {/* SUBTIMES -- ⚠️ CÁPSULA COM O CARGO JUNTO (`SEO · Supervisor`).
            Sem o cargo, a coluna mostra ONDE e esconde O QUÊ, numa tela cujo
            assunto é permissão. */}
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
            {/* ⚠️ Avisa que há vínculo em OUTRA área sem poluir a coluna com
                times que não são desta tela. O detalhe fica no painel. */}
            {outrasAreas > 0 && (
              <Badge tone="outline" size="sm">
                +{outrasAreas} {outrasAreas === 1 ? "área" : "áreas"}
              </Badge>
            )}
          </span>
        </td>

        {/* AÇÕES -- ⚠️ na linha ficam só cargo e subtime, que é o que se mexe
            toda semana. Remover e desativar vão para o `⋯`. */}
        <td className="whitespace-nowrap px-3 py-2 text-right align-middle">
          {podeMexer && (
            <button
              className="btn btn-ghost"
              aria-label={`Editar subtimes de ${membro.name}`}
              onClick={onEditar}
            >
              <Pencil size={14} aria-hidden="true" />
            </button>
          )}
          <button
            className="btn btn-ghost"
            aria-label={`Mais ações para ${membro.name}`}
            onClick={onMenu}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
        </td>
      </tr>

      {/* ⚠️ O painel expandido é uma LINHA PRÓPRIA que atravessa as colunas
          (`colSpan`), e não algo dentro de uma célula: dentro, ele herdaria a
          largura da coluna e espremeria os checkboxes. */}
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

      {menuAberto && (
        <tr className="border-b border-border">
          <td colSpan={6} className="bg-surface-2 p-0">
            <MenuDaLinha
              membro={membro}
              teamId={teamId}
              cargoAqui={cargoAqui}
              podeDesativar={podeDesativar}
              souEu={souEu}
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
 * O seletor do lápis: em QUAIS subtimes a pessoa está.
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
    try {
      const antes = new Set(atuais.map((c) => c.team.id));
      const depois = new Set(marcados);
      for (const c of atuais) {
        if (!depois.has(c.team.id)) {
          await removeMemberFromTeam(membro.id, c.team.id);
        }
      }
      for (const id of marcados) {
        if (!antes.has(id)) {
          // ⚠️ OPERADOR É O PADRÃO, e por um motivo estrutural: operador é o
          // piso do modelo, então adicionar alguém NUNCA viola a regra da
          // Spec 044 §4.1-bis ("o papel na raiz não pode ser menor").
          await assignMemberToTeam(membro.id, id, "OPERATOR");
        }
      }
      await onMudou(
        perdidos.length > 0
          ? `${membro.name}: subtimes atualizados. O cargo em ${perdidos
              .map((c) => c.team.name)
              .join(", ")} foi perdido.`
          : `${membro.name}: subtimes atualizados.`,
      );
    } catch (e) {
      const a = e as ApiError;
      setErro(a.message || "Não consegui salvar.");
      setConfirmando(false);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="px-3 py-3">
      <div className="label mb-2">Subtimes de {membro.name}</div>

      {opcoes.length === 0 ? (
        <div className="muted text-xs">Este time não tem subtimes.</div>
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
            {perdidos.map((c) => `${PAPEL[c.role].toLowerCase()} em ${c.team.name}`).join(", ")}.
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

/**
 * O menu `⋯` da linha.
 *
 * ⚠️⚠️ REMOVER DO TIME ≠ DESATIVAR PESSOA, e as duas moram aqui justamente
 * por isso: numa tela com o nome de UM time no topo, "desativar" lê como
 * "tirar deste time" — e desliga a pessoa da organização inteira. São duas
 * rotas diferentes no backend, e a spec (§4.2) manda separá-las do que se
 * mexe toda semana.
 */
function MenuDaLinha({
  membro,
  teamId,
  cargoAqui,
  podeDesativar,
  souEu,
  onCancelar,
  onMudou,
}: {
  membro: Member;
  teamId: string;
  cargoAqui: MemberRole | null;
  podeDesativar: boolean;
  souEu: boolean;
  onCancelar: () => void;
  onMudou: (aviso: string) => Promise<void>;
}) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<"remover" | "desativar" | null>(
    null,
  );

  async function executar() {
    setSalvando(true);
    try {
      if (confirmando === "remover") {
        // ⚠️ O TIME É O DESTA TELA, e a primeira versão passava
        // `membro.id` nos dois argumentos -- o id da pessoa como id do time.
        // O `tsc` NÃO acusa: os dois são `string`. Daria 404 no clique.
        await removeMemberFromTeam(membro.id, teamId);
      } else {
        await deactivateMember(membro.id);
      }
      await onMudou(
        confirmando === "remover"
          ? `${membro.name} saiu deste time. A conta continua ativa.`
          : `${membro.name} foi desativado na organização inteira.`,
      );
    } catch (e) {
      const a = e as ApiError;
      setErro(a.message || "Não consegui concluir.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="px-3 py-3">
      {confirmando === null ? (
        <div className="flex flex-wrap gap-2">
          {cargoAqui && (
            <button
              className="btn btn-ghost"
              onClick={() => setConfirmando("remover")}
            >
              Tirar deste time
            </button>
          )}
          {podeDesativar && (
            <button
              className="btn btn-ghost"
              disabled={souEu}
              onClick={() => setConfirmando("desativar")}
            >
              Desativar na organização
            </button>
          )}
          <button className="btn btn-ghost" onClick={onCancelar}>
            Fechar
          </button>
          {souEu && (
            <span className="muted self-center text-xs">
              Você não pode desativar a própria conta.
            </span>
          )}
        </div>
      ) : (
        <div>
          <div className="text-xs">
            {confirmando === "remover" ? (
              <>
                <strong>{membro.name}</strong> sai deste time. A conta continua
                ativa e os outros times dela não mudam.
              </>
            ) : (
              <>
                <strong>{membro.name}</strong> deixa de acessar o sistema — em
                TODOS os times, não só neste. As tarefas dela ficam.
              </>
            )}
          </div>
          {erro && <div className="error-box mt-2 text-xs">{erro}</div>}
          <div className="mt-2 flex gap-2">
            <button
              className="btn btn-danger"
              disabled={salvando}
              onClick={() => void executar()}
            >
              {confirmando === "remover" ? "Tirar do time" : "Desativar"}
            </button>
            <button
              className="btn btn-ghost"
              disabled={salvando}
              onClick={() => setConfirmando(null)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
