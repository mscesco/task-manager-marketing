"use client";
// components/SidebarDoMembro.tsx
// A gaveta do membro — Spec 047, redesenho de 09/09.
//
// ⚠️⚠️ ELA SUBSTITUI O `⋯` **E** O MODAL, e isso foi decisão da Camila
// olhando a tela: *"o ponto agora é tirar os três pontos e editar, deixar só
// o editar, que traz uma side bar"*. Antes havia DUAS portas para o mesmo
// assunto — o lápis mexia em QUAIS times, o `⋯` mexia no cargo — e a pessoa
// precisava lembrar qual abria o quê.
//
// Uma porta. A gaveta faz as duas coisas, porque as duas são "o vínculo".
//
// ⚠️ GAVETA, e não modal centralizado: a tabela continua visível à esquerda,
// e é ela o contexto do que se está editando. Um modal centralizado tapa
// justamente a linha que a pessoa clicou.
//
// ⚠️ MORA EM `components/` -- o `include` do vitest cobre isso, e `app/` não.

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ChevronRight, X } from "lucide-react";
import Badge from "@/components/Badge";
import {
  ApiError,
  assignMemberToTeam,
  changeMemberRole,
  changeOrganizationRole,
  deactivateMember,
  listMemberTeams,
  removeMemberFromTeam,
  resetMemberPassword,
  type Member,
  type MemberRole,
  type MemberTeamComCadeado,
  type OrgRole,
  type Team,
} from "@/lib/api";
import { consequenciaDoCargo, vinculosDoPainel } from "@/lib/painelDoMembro";
import {
  papeisAtribuiveis,
  podeDesativarConta,
  podeRemoverDoTime,
  podeResetarSenha,
  timesParaAdicionar,
  type Alcance,
} from "@/lib/permissoesMembros";

const PAPEL: Record<MemberRole, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gerente",
  SUPERVISOR: "Supervisor",
  OPERATOR: "Operador",
};

const PAPEL_ORG: Record<OrgRole, string> = {
  ADMIN: "Administrador",
  GESTOR: "Gestor",
};

export default function SidebarDoMembro({
  membro,
  times,
  alcance,
  souAdmin,
  podeMexerNaOrganizacao,
  souEu,
  onFechar,
  onMudou,
  onRevelarSenha,
}: {
  membro: Member;
  times: Team[];
  alcance: Alcance;
  souAdmin: boolean;
  podeMexerNaOrganizacao: boolean;
  souEu: boolean;
  onFechar: () => void;
  onMudou: (aviso: string) => Promise<void>;
  onRevelarSenha: (r: { titulo: string; email: string; senha: string }) => void;
}) {
  const [vinculos, setVinculos] = useState<MemberTeamComCadeado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [adicionando, setAdicionando] = useState(false);

  useEffect(() => {
    let vivo = true;
    listMemberTeams(membro.id)
      .then((v) => vivo && setVinculos(v))
      .catch((e) =>
        vivo ? setErro((e as ApiError).message || "Não consegui carregar.") : null,
      );
    return () => {
      vivo = false;
    };
  }, [membro.id]);

  const linhas = vinculos ? vinculosDoPainel(vinculos, times) : [];
  // ⚠️ DOIS FILTROS, e nenhum é dispensável: `jaEsta` espelha o
  // `UNIQUE (user_id, team_id)` do banco (oferecer daria 409), e
  // `timesParaAdicionar` corta pelo ALCANCE — o supervisor só puxa gente para
  // os próprios subtimes (D1 da Spec 028).
  const jaEsta = new Set(linhas.map((l) => l.team.id));
  const disponiveis = timesParaAdicionar(
    alcance,
    times.filter((t) => !jaEsta.has(t.id)),
  ).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <>
      {/* ⚠️ O scrim é clicável para fechar, mas SEM escurecer forte: a tabela
          atrás é o contexto do que se edita, e apagá-la contradiz a escolha
          de gaveta em vez de modal. */}
      <div
        className="fixed inset-0 z-40 bg-black/10"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onFechar();
        }}
      />
      <motion.aside
        // ⚠️ Entra deslizando da direita. `prefers-reduced-motion` é honrado
        // pelo bloco global do `globals.css` e pelo próprio motion.
        initial={{ x: 24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 24, opacity: 0 }}
        transition={{ type: "spring", duration: 0.28, bounce: 0.1 }}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col border-l border-border bg-surface"
        role="dialog"
        aria-modal="true"
        aria-label={`Editar ${membro.name}`}
        onKeyDown={(e) => {
          if (e.key === "Escape") onFechar();
        }}
      >
        <div className="flex items-start gap-3 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{membro.name}</h2>
            <div className="muted truncate text-xs">{membro.email}</div>
          </div>
          <button className="btn btn-ghost" aria-label="Fechar" onClick={onFechar}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {erro && <div className="error-box mb-3 text-xs">{erro}</div>}

          {/* ---- AÇÕES DA CONTA ------------------------------------------
              ⚠️ As duas são sobre a ORGANIZAÇÃO, não sobre um time — por isso
              ficam no topo, longe da relação de times. Numa tela com o nome de
              um time acima, "Desativar" lido junto dos vínculos parece "tirar
              deste time" (§4.2). */}
          <div className="mb-5 flex flex-wrap gap-2">
            {podeResetarSenha(alcance) && (
              <ResetarSenha membro={membro} onRevelar={onRevelarSenha} />
            )}
            {membro.is_active && podeDesativarConta(alcance) && !souEu && (
              <Desativar membro={membro} onMudou={onMudou} />
            )}
          </div>

          {podeMexerNaOrganizacao && (
            <section className="mb-5">
              <h3 className="label mb-2">Na organização</h3>
              <PapelDeOrganizacao
                membro={membro}
                souEu={souEu}
                onMudou={onMudou}
              />
            </section>
          )}

          <section>
            <h3 className="label mb-2">Relação de times e subtimes</h3>
            {vinculos === null ? (
              <div className="muted text-xs">Carregando…</div>
            ) : linhas.length === 0 ? (
              <div className="muted text-xs">
                Sem vínculo de time. A pessoa existe na organização, mas não
                está em nenhum time.
              </div>
            ) : (
              <ul className="m-0 list-none space-y-2 p-0">
                {linhas.map((linha) => (
                  <LinhaDeVinculo
                    key={linha.team.id}
                    linha={linha}
                    membro={membro}
                    alcance={alcance}
                    souAdmin={souAdmin}
                    onMudou={onMudou}
                  />
                ))}
              </ul>
            )}

            {/* ⚠️ ADICIONAR A UM TIME MORA AQUI, e é o que antes era o lápis.
                Uma porta só para "o vínculo": em quais times, e com que cargo
                em cada um. */}
            {disponiveis.length > 0 && (
              <div className="mt-3">
                {!adicionando ? (
                  <button
                    className="btn btn-ghost flex items-center gap-1 text-sm"
                    onClick={() => setAdicionando(true)}
                  >
                    Adicionar a um time
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                ) : (
                  <AdicionarATime
                    membro={membro}
                    disponiveis={disponiveis}
                    onCancelar={() => setAdicionando(false)}
                    onMudou={onMudou}
                  />
                )}
              </div>
            )}
          </section>
        </div>
      </motion.aside>
    </>
  );
}

/**
 * Um vínculo: o time e o cargo, com dropdown + Salvar.
 *
 * ⚠️⚠️ O DROPDOWN NÃO GRAVA AO ESCOLHER, e a Camila confirmou isso em 09/09
 * (*"pode ter o salvar e isso aí"*). A regra da §4.3: prioridade erra e você
 * desfaz; cargo erra e a pessoa ganha alcance no sistema inteiro, em
 * silêncio. Escolher mostra a CONSEQUÊNCIA; Salvar aplica.
 *
 * ⚠️ E a consequência NOMEIA O TIME — "Administra os operadores do SEO" diz
 * algo; "tem permissões de supervisor" não diz nada a quem está decidindo.
 */
function LinhaDeVinculo({
  linha,
  membro,
  alcance,
  souAdmin,
  onMudou,
}: {
  linha: ReturnType<typeof vinculosDoPainel>[number];
  membro: Member;
  alcance: Alcance;
  souAdmin: boolean;
  onMudou: (aviso: string) => Promise<void>;
}) {
  const [escolhido, setEscolhido] = useState<MemberRole>(linha.role);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmandoSaida, setConfirmandoSaida] = useState(false);

  const opcoes = papeisAtribuiveis(alcance, souAdmin, linha.ehArea);
  const mudou = escolhido !== linha.role;

  async function salvar() {
    setSalvando(true);
    try {
      await changeMemberRole(membro.id, linha.team.id, escolhido);
      await onMudou(
        `${membro.name} agora é ${PAPEL[escolhido].toLowerCase()} em ${linha.team.name}.`,
      );
    } catch (e) {
      const a = e as ApiError;
      setErro(
        a.status === 403
          ? "Você não administra este vínculo."
          : a.message || "Não consegui trocar o cargo.",
      );
    } finally {
      setSalvando(false);
    }
  }

  async function tirar() {
    setSalvando(true);
    try {
      await removeMemberFromTeam(membro.id, linha.team.id);
      await onMudou(`${membro.name} saiu de ${linha.team.name}.`);
    } catch (e) {
      const a = e as ApiError;
      setErro(
        a.status === 409
          ? "Este é o único time da pessoa — ela ficaria sem nenhum. Adicione a outro antes."
          : a.message || "Não consegui tirar do time.",
      );
      setConfirmandoSaida(false);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <li className="rounded border border-border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm">{linha.team.name}</strong>
        {linha.ehArea && (
          <Badge tone="outline" size="sm">
            Área
          </Badge>
        )}

        {/* ⚠️⚠️ QUANDO O PAPEL VEM DE CIMA, SOME O SELETOR. Para quem tem
            comando na área, a linha do subtime não é cargo — é ALOCAÇÃO, e
            pela invariante de nível ela nunca conseguirá repetir ali o papel
            da raiz. Foi este detalhe que fez a Camila querer apagar o próprio
            vínculo, olhando a tela antiga. */}
        {linha.autoridadeVemDe ? (
          <span className="muted ml-auto text-xs">
            Alocado · autoridade de {linha.autoridadeVemDe.name}
          </span>
        ) : linha.podeEditarCargo ? (
          <select
            className="input ml-auto w-auto py-1 text-sm"
            value={escolhido}
            disabled={salvando}
            aria-label={`Cargo em ${linha.team.name}`}
            onChange={(e) => setEscolhido(e.target.value as MemberRole)}
          >
            {opcoes.map((p) => (
              <option key={p} value={p}>
                {PAPEL[p]}
              </option>
            ))}
          </select>
        ) : (
          // ⚠️ O CADEADO VEM DO BACKEND (`can_edit_role`). A tela NÃO
          // recalcula escopo — a Spec 034 já desfez essa tentativa uma vez.
          <span className="ml-auto" title="Você não administra este vínculo">
            <Badge tone="neutral" size="sm" className="border">
              {PAPEL[linha.role]}
            </Badge>
          </span>
        )}
      </div>

      {mudou && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="muted text-xs">
            {consequenciaDoCargo(escolhido, linha.team.name)}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              className="btn btn-primary"
              disabled={salvando}
              onClick={() => void salvar()}
            >
              Salvar
            </button>
            <button
              className="btn btn-ghost"
              disabled={salvando}
              onClick={() => setEscolhido(linha.role)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ---- TIRAR DO TIME ---------------------------------------------
          ⚠️ Pedido dela em 09/09. Fica DENTRO da linha do vínculo, e não num
          menu à parte: a ação é sobre ESTE time, e o nome dele está ali.
          ⚠️ A pergunta é `podeRemoverDoTime` e NÃO `podeEditarCargo`: são
          permissões diferentes. O supervisor tira gente do próprio subtime
          (D1 da Spec 028) sem poder trocar cargo de ninguém (D2). Usar o
          cadeado de cargo aqui esconderia dele a única ação que tem. */}
      {!mudou && podeRemoverDoTime(alcance, linha.team.id, linha.role) && (
        <div className="mt-2">
          {!confirmandoSaida ? (
            <button
              className="btn btn-ghost px-0 text-xs"
              onClick={() => setConfirmandoSaida(true)}
            >
              Tirar de {linha.team.name}
            </button>
          ) : (
            <div className="rounded border border-border p-2">
              <div className="text-xs">
                {membro.name} sai de <strong>{linha.team.name}</strong>. A
                conta continua ativa e os outros times não mudam.
              </div>
              {linha.role !== "OPERATOR" && (
                // ⚠️ O CARGO SE PERDE, e remarcar depois traz a pessoa como
                // Operador. É a mesma perda silenciosa que o seletor antigo
                // avisava — a gaveta não pode ser mais frouxa que ele.
                <div className="muted mt-1 text-xs">
                  Ela deixa de ser {PAPEL[linha.role].toLowerCase()} ali. Se
                  voltar depois, entra como Operador.
                </div>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  className="btn btn-danger"
                  disabled={salvando}
                  onClick={() => void tirar()}
                >
                  Tirar
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={salvando}
                  onClick={() => setConfirmandoSaida(false)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {erro && <div className="error-box mt-2 text-xs">{erro}</div>}
    </li>
  );
}

/** Adicionar a pessoa a mais um time. Nasce como Operador. */
function AdicionarATime({
  membro,
  disponiveis,
  onCancelar,
  onMudou,
}: {
  membro: Member;
  disponiveis: Team[];
  onCancelar: () => void;
  onMudou: (aviso: string) => Promise<void>;
}) {
  const [alvo, setAlvo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  return (
    <div className="rounded border border-border p-2">
      <select
        className="input w-full text-sm"
        value={alvo}
        disabled={salvando}
        aria-label="Time"
        onChange={(e) => setAlvo(e.target.value)}
      >
        <option value="">— escolha o time —</option>
        {disponiveis.map((t) => (
          <option key={t.id} value={t.id}>
            {t.parent_team_id === null ? `${t.name} (área)` : t.name}
          </option>
        ))}
      </select>
      {/* ⚠️ OPERADOR É O PADRÃO, por um motivo estrutural: operador é o piso
          do modelo, então adicionar alguém NUNCA viola a regra da Spec 044
          §4.1-bis ("o papel na raiz não pode ser menor"). O cargo se ajusta
          depois, no dropdown acima. */}
      <div className="muted mt-1 text-xs">Entra como Operador.</div>
      {erro && <div className="error-box mt-2 text-xs">{erro}</div>}
      <div className="mt-2 flex gap-2">
        <button
          className="btn btn-primary"
          disabled={salvando || alvo === ""}
          onClick={async () => {
            setSalvando(true);
            try {
              await assignMemberToTeam(membro.id, alvo, "OPERATOR");
              const nome = disponiveis.find((t) => t.id === alvo)?.name ?? "";
              await onMudou(`${membro.name} entrou em ${nome} como operador.`);
            } catch (e) {
              setErro((e as ApiError).message || "Não consegui adicionar.");
            } finally {
              setSalvando(false);
            }
          }}
        >
          Adicionar
        </button>
        <button className="btn btn-ghost" disabled={salvando} onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function PapelDeOrganizacao({
  membro,
  souEu,
  onMudou,
}: {
  membro: Member;
  souEu: boolean;
  onMudou: (aviso: string) => Promise<void>;
}) {
  const [escolhido, setEscolhido] = useState<OrgRole | "">(
    membro.org_role ?? "",
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const mudou = escolhido !== (membro.org_role ?? "");

  return (
    <div>
      <select
        className="input w-full text-sm"
        value={escolhido}
        disabled={salvando || souEu}
        aria-label="Papel na organização"
        onChange={(e) => setEscolhido(e.target.value as OrgRole | "")}
      >
        <option value="">Não administra a organização</option>
        <option value="GESTOR">{PAPEL_ORG.GESTOR}</option>
        <option value="ADMIN">{PAPEL_ORG.ADMIN}</option>
      </select>
      <div className="muted mt-1 text-xs">
        {escolhido === "ADMIN"
          ? "Define a organização: renomeia, apaga área e promove gestores."
          : escolhido === "GESTOR"
          ? "Opera a organização: cria área, cadastra pessoas e distribui papéis de time."
          : "Só os times em que está."}
      </div>
      {souEu && (
        <div className="muted mt-1 text-xs">
          Você não muda o próprio papel — peça a outro administrador.
        </div>
      )}
      {erro && <div className="error-box mt-2 text-xs">{erro}</div>}
      {mudou && !souEu && (
        <div className="mt-2 flex gap-2">
          <button
            className="btn btn-primary"
            disabled={salvando}
            onClick={async () => {
              setSalvando(true);
              try {
                await changeOrganizationRole(
                  membro.id,
                  escolhido === "" ? null : escolhido,
                );
                await onMudou(
                  escolhido === ""
                    ? `${membro.name} deixou de administrar a organização.`
                    : `${membro.name} agora é ${PAPEL_ORG[escolhido].toLowerCase()} da organização.`,
                );
              } catch (e) {
                const a = e as ApiError;
                setErro(
                  a.status === 409
                    ? "A organização precisa de pelo menos um administrador."
                    : a.message || "Não consegui mudar o papel.",
                );
              } finally {
                setSalvando(false);
              }
            }}
          >
            Salvar
          </button>
          <button
            className="btn btn-ghost"
            disabled={salvando}
            onClick={() => setEscolhido(membro.org_role ?? "")}
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

function ResetarSenha({
  membro,
  onRevelar,
}: {
  membro: Member;
  onRevelar: (r: { titulo: string; email: string; senha: string }) => void;
}) {
  const [salvando, setSalvando] = useState(false);
  return (
    <button
      className="btn btn-ghost text-xs"
      disabled={salvando}
      onClick={async () => {
        setSalvando(true);
        try {
          const r = await resetMemberPassword(membro.id);
          // ⚠️ O segredo volta UMA vez (ADR 0021) e sobe para a página, que é
          // quem desenha o bloco reveal-once. Guardá-lo aqui o perderia ao
          // fechar a gaveta.
          onRevelar({
            titulo: `Senha nova de ${membro.name}`,
            email: membro.email,
            senha: r.temporary_password,
          });
        } finally {
          setSalvando(false);
        }
      }}
    >
      Resetar senha
    </button>
  );
}

function Desativar({
  membro,
  onMudou,
}: {
  membro: Member;
  onMudou: (aviso: string) => Promise<void>;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  if (!confirmando) {
    return (
      <button
        className="btn btn-ghost text-xs"
        onClick={() => setConfirmando(true)}
      >
        Desativar
      </button>
    );
  }
  return (
    <div className="w-full rounded border border-border p-2">
      <div className="text-xs">
        <strong>{membro.name}</strong> deixa de acessar o sistema — em TODOS os
        times, não só neste. As tarefas dela ficam.
      </div>
      <div className="mt-2 flex gap-2">
        <button
          className="btn btn-danger"
          disabled={salvando}
          onClick={async () => {
            setSalvando(true);
            try {
              await deactivateMember(membro.id);
              await onMudou(`${membro.name} foi desativado na organização.`);
            } finally {
              setSalvando(false);
            }
          }}
        >
          Desativar
        </button>
        <button
          className="btn btn-ghost"
          disabled={salvando}
          onClick={() => setConfirmando(false)}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
