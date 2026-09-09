"use client";
// components/SubteamDrawer.tsx
// A gaveta do subtime — Spec 047, redesenho de 09/09.
//
// ⚠️ MESMO FORMATO da gaveta do membro, e isso é intencional: o alternador
// Membros|Subtimes troca O QUE a tela lista, e a gaveta responde "detalhe
// disto" nos dois lados. Duas formas diferentes para a mesma posição na tela
// obrigariam a pessoa a reaprender a interface ao virar a chave.
//
// ⚠️ ELA NÃO SUBSTITUI A TELA `/times`, e a diferença importa: lá se mexe na
// ÁRVORE inteira do workspace; aqui se mexe no subtime que está aberto. As
// duas chamam as MESMAS funções (`updateTeam`, `previaRemocaoTeam`,
// `esvaziarERemoverTeam`) e a MESMA confirmação por digitação --
// `confirmacaoValida`, testada em `lib/gestaoTimes.ts`. Reescrever a
// confirmação aqui criaria uma porta mais frouxa para a operação mais
// destrutiva do produto.
//
// ⚠️ MORA EM `components/` -- `app/` fica fora do `include` do vitest.

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import Badge from "@/components/Badge";
import MenuSelect from "@/components/MenuSelect";
import {
  ApiError,
  assignMemberToTeam,
  deleteTeam,
  esvaziarERemoverTeam,
  previaRemocaoTeam,
  removeMemberFromTeam,
  updateTeam,
  type Member,
  type PreviaRemocao,
  type Team,
} from "@/lib/api";
import { confirmacaoValida, descreveConteudo } from "@/lib/gestaoTimes";
import { ROLE_LABEL } from "@/components/MembersTable";
import { directMembers, subteamCandidates } from "@/lib/teamScreen";

export default function SubteamDrawer({
  team,
  members,
  isAdmin,
  canManage,
  onClose,
  onChanged,
  onOpenMember,
}: {
  team: Team;
  /** Todo mundo da árvore do time PAI — de onde saem os candidatos. */
  members: Member[];
  /** Só administrador remove time (Spec 029, D1). */
  isAdmin: boolean;
  canManage: boolean;
  onClose: () => void;
  onChanged: (aviso: string) => Promise<void>;
  /** Abre a gaveta DA PESSOA — é lá que o cargo se troca. */
  onOpenMember: (member: Member) => void;
}) {
  // ⚠️ A GAVETA ATENDE OS DOIS NÍVEIS desde a unificação de 09/09: da tela
  // da organização ela abre uma ÁREA; da tela de um time, um subtime. Chamar
  // tudo de "subtime" mentiria para metade dos casos.
  const ehArea = team.parent_team_id === null;
  const dentro = directMembers(team.id, members);
  const candidates = subteamCandidates(team.id, members);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/10"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      />
      <motion.aside
        initial={{ x: 24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 24, opacity: 0 }}
        transition={{ type: "spring", duration: 0.28, bounce: 0.1 }}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col border-l border-border bg-surface"
        role="dialog"
        aria-modal="true"
        aria-label={`Editar ${team.name}`}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        {/* Ver o comentário gêmeo em `MemberDrawer`. */}
        <div className="flex items-center gap-3 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{team.name}</h2>
            <div className="muted truncate text-xs">
              {ehArea ? "Área" : "Subtime"} · {dentro.length}{" "}
              {dentro.length === 1 ? "pessoa" : "pessoas"}
            </div>
          </div>
          <button className="btn btn-ghost" aria-label="Fechar" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {canManage && <Identity team={team} onChanged={onChanged} />}

          <section className="mt-5">
            <h3 className="label mb-2">Quem está aqui</h3>
            {dentro.length === 0 ? (
              <div className="muted text-xs">
                Ninguém {ehArea ? "nesta área" : "neste subtime"} ainda.
              </div>
            ) : (
              <ul className="m-0 list-none space-y-1.5 p-0">
                {dentro.map(({ member, role }) => (
                  <li
                    key={member.id}
                    className="flex flex-wrap items-center gap-2 rounded border border-border p-2"
                  >
                    {/* ⚠️⚠️ O NOME ABRE A GAVETA DA PESSOA, e esta linha é
                        o conserto de 09/09: *"não estou conseguindo mudar as
                        permissões da galera"*. O cargo continua sem se editar
                        AQUI -- decidi-lo exige ver os OUTROS vínculos da
                        pessoa, por causa da invariante de nível (Spec 045) --
                        mas antes não havia caminho nenhum daqui para lá, e a
                        lista de cargos ficava sendo um beco.
                        ⚠️ Não é uma segunda porta de ESCRITA: é a mesma
                        gaveta, alcançada de outro lugar. */}
                    <button
                      type="button"
                      className="tappable text-left text-sm font-semibold hover:underline"
                      onClick={() => onOpenMember(member)}
                    >
                      {member.name}
                    </button>
                    <button
                      type="button"
                      className="tappable"
                      title={`Mudar o cargo de ${member.name}`}
                      onClick={() => onOpenMember(member)}
                    >
                      <Badge tone="neutral" size="sm" className="border">
                        {ROLE_LABEL[role]}
                      </Badge>
                    </button>
                    {canManage && (
                      <RemoveFromTeam
                        member={member}
                        team={team}
                        onChanged={onChanged}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {canManage && candidates.length > 0 && (
            <AddMember
              team={team}
              candidates={candidates}
              onChanged={onChanged}
            />
          )}

          {/* ⚠️ SÓ ADMINISTRADOR, e a trava é da Spec 029 (D1): remover time
              exige `workspace.manage`. Mostrar o botão a um gerente daria
              403 depois que ele já digitou o nome do time para confirmar.

              ⚠️⚠️ E **NUNCA PARA ÁREA**: o backend responde 409 *"se for a
              raiz"* nas DUAS rotas (`delete_team` e `esvaziar-e-remover`).
              Oferecer aqui seria pedir que a pessoa digitasse o nome da área
              para confirmar e só então levar o erro -- o padrão "botão que a
              tela oferece e o servidor recusa" que a Spec 044 registrou.
              Quem quer apagar uma área move ou apaga os subtimes e fala com
              quem administra o workspace. */}
          {isAdmin && !ehArea && <DeleteTeam team={team} onChanged={onChanged} />}
          {isAdmin && ehArea && (
            <div className="muted mt-6 border-t border-border pt-3 text-xs">
              Área não se exclui por aqui — ela é a raiz de uma árvore, e o
              servidor recusa. Esvazie os subtimes primeiro.
            </div>
          )}
        </div>
      </motion.aside>
    </>
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

      {/* ⚠️⚠️ O IDENTIFICADOR É SÓ LEITURA, e não é limitação de tela: o
          `updateTeam` do backend aceita `name` e `description`, e mais nada.
          Um campo editável aqui prometeria uma escrita que a rota não faz --
          o padrão "botão que a tela oferece e o servidor recusa" que a Spec
          044 registrou. */}
      <div className="muted mt-2 text-xs">
        Identificador: <code>{team.slug}</code> — fixo desde a criação.
      </div>

      {erro && <div className="error-box mt-2 text-xs">{erro}</div>}

      {mudou && (
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
      )}
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

  if (!confirmando) {
    return (
      <button
        className="btn btn-ghost ml-auto px-1.5 text-xs"
        onClick={() => setConfirmando(true)}
      >
        Tirar
      </button>
    );
  }
  return (
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
              setErro(
                a.status === 409
                  ? "Este é o único time da pessoa — ela ficaria sem nenhum."
                  : a.message || "Não consegui tirar do time.",
              );
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
      {/* ⚠️ SÓ QUEM JÁ ESTÁ NA ÁRVORE, e não a organização inteira: cadastrar
          pessoa nova dispara senha provisória e é outra ação (D3 da Spec 028).
          Misturar as duas num mesmo seletor faria o "adicionar" às vezes criar
          uma conta sem avisar. */}
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

/**
 * Excluir o subtime.
 *
 * ⚠️⚠️ A CONFIRMAÇÃO POR DIGITAÇÃO É A MESMA DA TELA `/times`
 * (`confirmacaoValida`, testada), e a prévia vem do servidor. Uma versão mais
 * curta aqui seria uma porta mais frouxa para a operação mais destrutiva do
 * produto — e seria a porta que fica mais perto do dedo de quem administra o
 * time todo dia.
 */
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
      })
    : "";
  const temFilhos = (previa?.filhos ?? 0) > 0;

  return (
    <div className="mt-6 rounded border border-border p-3">
      <div className="text-sm font-semibold">Excluir {team.name}</div>

      {carregandoPrevia ? (
        <div className="muted mt-1 text-xs">Conferindo o que há dentro…</div>
      ) : temFilhos ? (
        // ⚠️ O backend recusa apagar time com filho (409). Dizer isso ANTES
        // evita que a pessoa digite o nome para depois levar erro.
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
              // ⚠️ Vazio -> DELETE simples; com conteúdo -> esvazia e remove
              // numa transação. É a mesma escolha de rota da tela `/times`.
              const vazio =
                previa !== null &&
                previa.tarefas_vivas === 0 &&
                previa.projetos === 0 &&
                previa.membros === 0;
              if (vazio) {
                await deleteTeam(team.id);
              } else {
                await esvaziarERemoverTeam(team.id);
              }
              await onChanged(`${team.name} foi excluído.`);
            } catch (e) {
              const a = e as ApiError;
              // O 409 do backend já vem com os números — e ele é a fonte da
              // verdade: a prévia da tela pode ter envelhecido.
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
