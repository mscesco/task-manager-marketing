"use client";
// Gaveta do time (raiz ou subtime): membros, cargos, renomear e excluir.
// Usa as mesmas funções e a mesma confirmação por digitação da tela `/times`.

import Gaveta from "@/components/Gaveta";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DUR } from "@/lib/motion";
import Badge from "@/components/Badge";
import MenuSelect from "@/components/MenuSelect";
import PillSelect from "@/components/PillSelect";
import Reveal from "@/components/Reveal";
import {
  ApiError,
  assignMemberToTeam,
  changeMemberRole,
  deleteTeam,
  esvaziarERemoverTeam,
  listTeamMembers,
  previaRemocaoTeam,
  removeMemberFromTeam,
  updateTeam,
  type Member,
  type MemberRole,
  type PreviaRemocao,
  type Team,
  type TeamMemberComCadeado,
} from "@/lib/api";
import {
  papeisAtribuiveis,
  podeRemoverDoTime,
  type Alcance,
} from "@/lib/permissoesMembros";
import type { Permission } from "@/lib/permissions.generated";
import {
  confirmacaoValida,
  descreveConteudo,
  estaVazio,
  podeApagarTime,
  podeEditar,
} from "@/lib/gestaoTimes";
import { ROLE_LABEL } from "@/components/MembersTable";
import { directMembers, subteamCandidates } from "@/lib/teamScreen";

export default function SubteamDrawer({
  team,
  members,
  isAdmin,
  canManage,
  scope,
  permissoes,
  onClose,
  onChanged,
  onRefresh,
}: {
  team: Team;
  /** Todo mundo da árvore do time PAI — de onde saem os candidatos. */
  members: Member[];
  /** Só administrador remove time. */
  isAdmin: boolean;
  canManage: boolean;
  scope: Alcance;
  /** "Tirar" pergunta o verbo `membership.delete`; alcance amplo não basta. */
  permissoes: readonly Permission[];
  onClose: () => void;
  /** Mudou algo que FECHA a gaveta (renomear, excluir). */
  onChanged: (aviso: string) => Promise<void>;
  /** Mudou algo que a gaveta continua mostrando; não fecha, para adicionar em série. */
  onRefresh: () => Promise<void>;
}) {
  // Atende os dois níveis: time raiz e subtime.
  const isRoot = team.parent_team_id === null;
  const dentro = directMembers(team.id, members);
  const candidates = subteamCandidates(team.id, members);

  // O cadeado vem do backend, por vínculo; a tela não recalcula escopo.
  const [doServidor, setDoServidor] = useState<
    Map<string, { canEdit: boolean; isActive: boolean }>
  >(new Map());
  useEffect(() => {
    let vivo = true;
    listTeamMembers(team.id)
      .then((linhas: TeamMemberComCadeado[]) => {
        if (vivo) {
          setDoServidor(
            new Map(
              linhas.map((l) => [
                l.user_id,
                { canEdit: l.can_edit_role, isActive: l.is_active },
              ]),
            ),
          );
        }
      })
      .catch(() => {
        // Falha fecha o cadeado: mapa vazio deixa tudo em leitura.
        if (vivo) setDoServidor(new Map());
      });
    return () => {
      vivo = false;
    };
    // `members` na dependência: o cadeado de quem acabou de entrar ainda não foi buscado.
  }, [team.id, members]);

  return (
    <Gaveta
      ariaLabel={`Editar ${team.name}`}
      titulo={team.name}
      subtitulo={
        <>
          {isRoot ? "Time" : "Subtime"} · {dentro.length}{" "}
          {dentro.length === 1 ? "pessoa" : "pessoas"}
        </>
      }
      onClose={onClose}
    >
          {/* Renomear pergunta ao servidor (`podeEditar`), não ao alcance. */}
          {podeEditar(team) && <Identity team={team} onChanged={onChanged} />}

          <section className="mt-5">
            <h3 className="label mb-2">Quem está aqui</h3>
            {dentro.length === 0 ? (
              <div className="muted text-xs">
                Ninguém {isRoot ? "neste time" : "neste subtime"} ainda.
              </div>
            ) : (
              // `AnimatePresence` + `layout`: quem entra desliza, quem sai some, sem a lista pular.
              <ul className="m-0 list-none space-y-1.5 p-0">
                <AnimatePresence initial={false}>
                  {dentro.map(({ member, role }) => (
                    <motion.li
                      key={member.id}
                      layout
                      initial={{ opacity: 0, x: 16 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -16 }}
                      transition={{ type: "spring", duration: DUR[3], bounce: 0 }}
                      className="flex flex-wrap items-center gap-2 rounded border border-border p-2"
                    >
                    <strong className="text-sm">{member.name}</strong>
                    {/* Cargo se edita aqui; sem cadeado é só selo. */}
                    {/* Inativo é filtrado em `directMembers`; `is_active` ainda chega porque o cadeado depende dele. */}
                    <RoleCell
                      member={member}
                      team={team}
                      role={role}
                      canEdit={doServidor.get(member.id)?.canEdit ?? false}
                      scope={scope}
                      isAdmin={isAdmin}
                      onRefresh={onRefresh}
                    />
                    {canManage &&
                      podeRemoverDoTime(scope, team.id, role, permissoes) && (
                      <RemoveFromTeam
                        member={member}
                        team={team}
                        onChanged={onRefresh}
                      />
                    )}
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </section>

          {canManage && candidates.length > 0 && (
            <AddMember
              team={team}
              candidates={candidates}
              onChanged={onRefresh}
            />
          )}

          {/* Quem apaga vem do servidor (`can_delete`). Time raiz nunca: o backend recusa com 409. */}
          {!isRoot && podeApagarTime(team) && (
            <DeleteTeam team={team} onChanged={onChanged} />
          )}
          {isAdmin && isRoot && (
            <div className="muted mt-6 border-t border-border pt-3 text-xs">
              Time raiz não se exclui por aqui — ele é a raiz de uma árvore, e o
              servidor recusa. Esvazie os subtimes primeiro.
            </div>
          )}
    </Gaveta>
  );
}

/** Nome e identificador. */
function Identity({
  team,
  onChanged,
}: {
  team: Team;
  onChanged: (aviso: string) => Promise<void>;
}) {
  const [nome, setNome] = useState(team.name);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const mudou = nome.trim() !== team.name && nome.trim() !== "";

  return (
    <section>
      <h3 className="label mb-2">Identidade</h3>
      <label className="label block text-xs" htmlFor="nome-do-subtime">
        Nome
      </label>
      <input
        id="nome-do-subtime"
        className="input w-full text-sm"
        value={nome}
        disabled={salvando}
        onChange={(e) => setNome(e.target.value)}
      />

      {/* Só leitura: `updateTeam` aceita só `name` e `description`. */}
      <div className="muted mt-2 text-xs">
        Identificador: <code>{team.slug}</code> — fixo desde a criação.
      </div>

      {erro && <div className="error-box mt-2 text-xs">{erro}</div>}

      <Reveal show={mudou}>
        <div className="mt-2 flex gap-2">
          <button
            className="btn btn-primary"
            disabled={salvando}
            onClick={async () => {
              setSalvando(true);
              setErro(null);
              try {
                await updateTeam(team.id, { name: nome.trim() });
                await onChanged(`O time agora se chama ${nome.trim()}.`);
              } catch (e) {
                const a = e as ApiError;
                setErro(
                  a.status === 403
                    ? "Você não administra este time."
                    : a.message || "Não consegui salvar.",
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
            onClick={() => setNome(team.name)}
          >
            Cancelar
          </button>
        </div>
      </Reveal>
    </section>
  );
}

function RemoveFromTeam({
  member,
  team,
  onChanged,
}: {
  member: Member;
  team: Team;
  onChanged: (aviso: string) => Promise<void>;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  return (
    <>
      <Reveal show={!confirmando}>
        <button
          className="btn btn-ghost ml-auto px-1.5 text-xs"
          onClick={() => setConfirmando(true)}
        >
          Tirar
        </button>
      </Reveal>
      <Reveal show={confirmando}>
    <div className="w-full">
      <div className="text-xs">
        {member.name} sai de {team.name}. A conta continua ativa.
      </div>
      {erro && <div className="error-box mt-1 text-xs">{erro}</div>}
      <div className="mt-1.5 flex gap-2">
        <button
          className="btn btn-danger"
          disabled={salvando}
          onClick={async () => {
            setSalvando(true);
            try {
              await removeMemberFromTeam(member.id, team.id);
              await onChanged(`${member.name} saiu de ${team.name}.`);
            } catch (e) {
              const a = e as ApiError;
              // A mensagem vem do servidor: o 409 tem mais de uma razão.
              setErro(a.message || "Não consegui tirar do time.");
              setSalvando(false);
            }
          }}
        >
          Tirar
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
      </Reveal>
    </>
  );
}

function AddMember({
  team,
  candidates,
  onChanged,
}: {
  team: Team;
  candidates: Member[];
  onChanged: (aviso: string) => Promise<void>;
}) {
  const [alvo, setAlvo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  return (
    <section className="mt-4">
      <h3 className="label mb-2">Adicionar membro</h3>
      {/* Só quem já está na árvore; cadastrar pessoa nova é outra ação. */}
      <MenuSelect
        aria-label="Pessoa"
        placeholder="— escolha a pessoa —"
        value={alvo === "" ? null : alvo}
        disabled={salvando}
        onSelect={setAlvo}
        options={candidates.map((m) => ({ id: m.id, label: m.name }))}
      />
      <div className="muted mt-1 text-xs">
        Entra como Operador. Para mudar o cargo, clique no nome da pessoa.
      </div>
      {erro && <div className="error-box mt-2 text-xs">{erro}</div>}
      <button
        className="btn btn-primary mt-2"
        disabled={salvando || alvo === ""}
        onClick={async () => {
          setSalvando(true);
          setErro(null);
          try {
            await assignMemberToTeam(alvo, team.id, "OPERATOR");
            const nome = candidates.find((m) => m.id === alvo)?.name ?? "";
            await onChanged(`${nome} entrou em ${team.name} como operador.`);
          } catch (e) {
            setErro((e as ApiError).message || "Não consegui adicionar.");
          } finally {
            setSalvando(false);
          }
        }}
      >
        Adicionar
      </button>
    </section>
  );
}

/** Excluir o subtime: mesma confirmação por digitação da tela `/times`; a prévia vem do servidor. */
function DeleteTeam({
  team,
  onChanged,
}: {
  team: Team;
  onChanged: (aviso: string) => Promise<void>;
}) {
  const [isOpen, setAberto] = useState(false);
  const [previa, setPrevia] = useState<PreviaRemocao | null>(null);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);
  const [digitado, setDigitado] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let vivo = true;
    setCarregandoPrevia(true);
    previaRemocaoTeam(team.id)
      .then((p) => vivo && setPrevia(p))
      .catch(() => vivo && setPrevia(null))
      .finally(() => vivo && setCarregandoPrevia(false));
    return () => {
      vivo = false;
    };
  }, [isOpen, team.id]);

  if (!isOpen) {
    return (
      <div className="mt-6 border-t border-border pt-3">
        <button
          className="btn btn-ghost px-0 text-xs"
          onClick={() => setAberto(true)}
        >
          Excluir {team.name}
        </button>
      </div>
    );
  }

  const conteudo = previa
    ? descreveConteudo({
        tarefas: previa.tarefas_vivas,
        projetos: previa.projetos,
        membros: previa.membros,
        filhos: previa.filhos,
        quadros: previa.quadros,
        formularios: previa.formularios,
      })
    : "";
  const temFilhos = (previa?.filhos ?? 0) > 0;

  return (
    <div className="mt-6 rounded border border-border p-3">
      <div className="text-sm font-semibold">Excluir {team.name}</div>

      {carregandoPrevia ? (
        <div className="muted mt-1 text-xs">Conferindo o que há dentro…</div>
      ) : temFilhos ? (
        // O backend recusa time com filho (409); avisar antes de digitar o nome.
        <div className="muted mt-1 text-xs">
          Este subtime tem {previa?.filhos}{" "}
          {previa?.filhos === 1 ? "subtime dentro" : "subtimes dentro"}. Apague
          ou mova os de dentro primeiro.
        </div>
      ) : (
        <div className="muted mt-1 text-xs">
          {conteudo
            ? `Vai junto: ${conteudo}. As tarefas vivas são ARQUIVADAS e o conteúdo passa para o time principal.`
            : "O subtime está vazio."}
        </div>
      )}

      {!temFilhos && !carregandoPrevia && (
        <>
          <label className="label mt-3 block text-xs" htmlFor="confirma-excluir">
            Digite <strong>{team.name}</strong> para confirmar
          </label>
          <input
            id="confirma-excluir"
            className="input w-full text-sm"
            value={digitado}
            disabled={salvando}
            onChange={(e) => setDigitado(e.target.value)}
          />
        </>
      )}

      {erro && <div className="error-box mt-2 text-xs">{erro}</div>}

      <div className="mt-3 flex gap-2">
        <button
          className="btn btn-danger"
          disabled={
            salvando ||
            carregandoPrevia ||
            temFilhos ||
            !confirmacaoValida(digitado, team.name)
          }
          onClick={async () => {
            setSalvando(true);
            setErro(null);
            try {
              // Vazio -> DELETE simples; com conteúdo -> esvazia e remove numa transação.
              // "Vazio" conta lixeira, quadros e formulários.
              const vazio =
                previa !== null &&
                estaVazio({
                  tarefas: previa.tarefas_vivas + previa.tarefas_na_lixeira,
                  projetos: previa.projetos,
                  membros: previa.membros,
                  filhos: previa.filhos,
                  quadros: previa.quadros,
                  formularios: previa.formularios,
                });
              if (vazio) {
                await deleteTeam(team.id);
              } else {
                await esvaziarERemoverTeam(team.id);
              }
              await onChanged(`${team.name} foi excluído.`);
            } catch (e) {
              const a = e as ApiError;
              // O 409 traz os números atuais; a prévia pode ter envelhecido.
              setErro(
                a.status === 403
                  ? "Só um administrador remove times."
                  : a.status === 404
                  ? "Este time não existe mais. Atualize a página."
                  : a.message || "Não consegui excluir.",
              );
              setSalvando(false);
            }
          }}
        >
          Excluir
        </button>
        <button
          className="btn btn-ghost"
          disabled={salvando}
          onClick={() => {
            setAberto(false);
            setDigitado("");
            setErro(null);
          }}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

/**
 * Cargo da pessoa neste time: aplica no clique (dropdown) ou selo se não edita.
 * As opções vêm de `papeisAtribuiveis`.
 */
function RoleCell({
  member,
  team,
  role,
  canEdit,
  scope,
  isAdmin,
  onRefresh,
}: {
  member: Member;
  team: Team;
  role: MemberRole;
  canEdit: boolean;
  scope: Alcance;
  isAdmin: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const options = papeisAtribuiveis(scope, isAdmin, team.parent_team_id === null);

  if (!canEdit || options.length === 0) {
    // Selo, não botão desabilitado: botão apagado convida ao clique.
    return (
      <span title="Você não administra este vínculo">
        <Badge tone="neutral" size="sm" className="border">
          {ROLE_LABEL[role]}
        </Badge>
      </span>
    );
  }

  return (
    <>
      <PillSelect
        value={role}
        disabled={salvando}
        label={`Cargo de ${member.name} em ${team.name}`}
        options={options.map((p) => ({ id: p, label: ROLE_LABEL[p] }))}
        onSelect={async (novo) => {
          if (novo === role) return;
          setSalvando(true);
          setErro(null);
          try {
            await changeMemberRole(member.id, team.id, novo);
            await onRefresh();
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
        }}
      />
      {erro && <span className="error-box w-full text-xs">{erro}</span>}
    </>
  );
}
