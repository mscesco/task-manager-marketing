"use client";
// Gaveta do membro: vínculos (em quais times, com que cargo) e ações da conta.
// Gaveta, não modal, para a tabela continuar visível.

import Gaveta from "@/components/Gaveta";
import { useAvisar } from "@/components/Toasts";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DUR } from "@/lib/motion";
import { ChevronRight } from "lucide-react";
import Badge from "@/components/Badge";
import MenuSelect from "@/components/MenuSelect";
import PillSelect from "@/components/PillSelect";
import Reveal from "@/components/Reveal";
import TemporaryPassword from "@/components/TemporaryPassword";
import {
  ApiError,
  assignMemberToTeam,
  changeMemberRole,
  changeOrganizationRole,
  deactivateMember,
  listMemberTeams,
  memberAccountActions,
  reactivateMember,
  removeMemberFromTeam,
  resetMemberPassword,
  type AcoesDaConta,
  type Member,
  type MemberRole,
  type MemberTeamComCadeado,
  type OrgRole,
  type Team,
} from "@/lib/api";
import { roleConsequence, drawerMemberships } from "@/lib/memberDrawer";
import Loading from "@/components/Loading";
import {
  papeisAtribuiveis,
  podeRemoverDoTime,
  timesParaAdicionar,
  type Alcance,
} from "@/lib/permissoesMembros";
import type { Permission } from "@/lib/permissions.generated";

const ROLE_LABEL: Record<MemberRole, string> = {
  MANAGER: "Gerente",
  SUPERVISOR: "Supervisor",
  OPERATOR: "Operador",
};

const ORG_ROLE_LABEL: Record<OrgRole, string> = {
  ADMIN: "Administrador",
  GESTOR: "Gestor",
};

/** Papéis que mandam na árvore inteira (espelha `COMMAND_ROLES` de `team_scope.py`). */
const COMMAND_ROLES: MemberRole[] = ["MANAGER"];

export default function MemberDrawer({
  member,
  teams,
  scope,
  isAdmin,
  opcoesDeOrganizacao,
  isSelf,
  permissoes,
  onClose,
  onChanged,
}: {
  member: Member;
  teams: Team[];
  scope: Alcance;
  isAdmin: boolean;
  /** Papéis de organização que quem olha pode dar a esta pessoa; `null` = a seção não aparece. */
  opcoesDeOrganizacao: readonly (OrgRole | null)[] | null;
  isSelf: boolean;
  /** "Tirar de…" pergunta o verbo `membership.delete`; alcance amplo não basta. */
  permissoes: readonly Permission[];
  onClose: () => void;
  onChanged: (aviso: string) => Promise<void>;
}) {
  const [vinculos, setVinculos] = useState<MemberTeamComCadeado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [adicionando, setAdicionando] = useState(false);
  // Enquanto a senha provisória está na tela, a gaveta não fecha: ela volta uma vez só.
  const [revelado, setRevelado] = useState<{
    title: string;
    email: string;
    password: string;
  } | null>(null);
  const podeFechar = revelado === null;
  // Botões da conta vêm do servidor, por pessoa; `null` enquanto não chegou.
  const [acoes, setAcoes] = useState<AcoesDaConta | null>(null);

  useEffect(() => {
    let vivo = true;
    listMemberTeams(member.id)
      .then((v) => vivo && setVinculos(v))
      .catch((e) =>
        vivo ? setErro((e as ApiError).message || "Não consegui carregar.") : null,
      );
    // Falhar aqui só deixa os botões fechados; o resto da gaveta segue útil.
    memberAccountActions(member.id)
      .then((a) => vivo && setAcoes(a))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [member.id]);

  const rows = vinculos ? drawerMemberships(vinculos, teams) : [];
  // `jaEsta` espelha o `UNIQUE (user_id, team_id)`; `timesParaAdicionar` corta pelo alcance.
  const jaEsta = new Set(rows.map((l) => l.team.id));
  const availableTeams = timesParaAdicionar(
    scope,
    teams.filter((t) => !jaEsta.has(t.id)),
  ).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <Gaveta
      ariaLabel={`Editar ${member.name}`}
      titulo={member.name}
      subtitulo={member.email}
      onClose={onClose}
      podeFechar={podeFechar}
      motivoParaNaoFechar="Copie a senha e clique em Concluir"
    >
          {/* Entra deslizando: sem transição, lê-se como erro. */}
          <AnimatePresence>
            {revelado && (
              <motion.div
                initial={{ opacity: 0, y: -8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -8, height: 0 }}
                transition={{ type: "spring", duration: DUR[3], bounce: 0 }}
                style={{ overflow: "hidden" }}
              >
                <TemporaryPassword
                  title={revelado.title}
                  email={revelado.email}
                  password={revelado.password}
                  onClose={() => setRevelado(null)}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {erro && <div className="error-box mb-3 text-xs">{erro}</div>}

          {/* Ações da conta: são da organização, por isso longe dos vínculos. */}
          <div className="mb-5 flex flex-wrap gap-2">
            {acoes?.can_reset_password && (
              <ResetPassword member={member} onReveal={setRevelado} />
            )}
            {/* O servidor já recusa a própria conta e a desativada; a tela repete as condições. */}
            {member.is_active && acoes?.can_deactivate && !isSelf && (
              <Deactivate member={member} onChanged={onChanged} />
            )}
            {/* Conta desativada só tem "Reativar". */}
            {!member.is_active && acoes?.can_reactivate && (
              <Reactivate member={member} onChanged={onChanged} />
            )}
          </div>
          {!member.is_active && (
            <div className="muted mb-5 text-xs">
              Conta desativada: {member.name} não consegue entrar. Para gerar
              uma senha nova, reative a conta primeiro.
            </div>
          )}

          {opcoesDeOrganizacao && (
            <section className="mb-5">
              <h3 className="label mb-2">Na organização</h3>
              <OrgRoleField
                member={member}
                opcoes={opcoesDeOrganizacao}
                isSelf={isSelf}
                onChanged={onChanged}
              />
            </section>
          )}

          <section>
            <h3 className="label mb-2">Relação de times e subtimes</h3>
            {vinculos === null ? (
              <Loading tamanho="linha" rotulo="Carregando os vínculos" />
            ) : rows.length === 0 ? (
              <div className="muted text-xs">
                Sem vínculo de time. A pessoa existe na organização, mas não
                está em nenhum time.
              </div>
            ) : (
              <ul className="m-0 list-none space-y-2 p-0">
                {rows.map((row) => (
                  <MembershipRow
                    key={row.team.id}
                    row={row}
                    member={member}
                    scope={scope}
                    isAdmin={isAdmin}
                    isSelf={isSelf}
                    permissoes={permissoes}
                    onChanged={onChanged}
                  />
                ))}
              </ul>
            )}

            {availableTeams.length > 0 && (
              <div className="mt-3">
                <Reveal show={!adicionando}>
                  <button
                    className="btn btn-ghost flex items-center gap-1 text-sm"
                    onClick={() => setAdicionando(true)}
                  >
                    Adicionar a um time
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </Reveal>
                <Reveal show={adicionando}>
                  <AddToTeam
                    member={member}
                    availableTeams={availableTeams}
                    onCancel={() => setAdicionando(false)}
                    onChanged={onChanged}
                  />
                </Reveal>
              </div>
            )}
          </section>
    </Gaveta>
  );
}

/** Um vínculo: time e cargo. O dropdown não grava; mostra a consequência e Salvar aplica. */
function MembershipRow({
  row,
  member,
  scope,
  isAdmin,
  isSelf,
  permissoes,
  onChanged,
}: {
  row: ReturnType<typeof drawerMemberships>[number];
  member: Member;
  scope: Alcance;
  isAdmin: boolean;
  /** É a própria pessoa que está olhando? Ver o `!isSelf` no "Tirar". */
  isSelf: boolean;
  /** Ver a prop homônima do `MemberDrawer`. */
  permissoes: readonly Permission[];
  onChanged: (aviso: string) => Promise<void>;
}) {
  const [escolhido, setEscolhido] = useState<MemberRole>(row.role);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmandoSaida, setConfirmandoSaida] = useState(false);

  const options = papeisAtribuiveis(scope, isAdmin, row.isRoot);
  const mudou = escolhido !== row.role;

  async function salvar() {
    setSalvando(true);
    try {
      await changeMemberRole(member.id, row.team.id, escolhido);
      await onChanged(
        `${member.name} agora é ${ROLE_LABEL[escolhido].toLowerCase()} em ${row.team.name}.`,
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
      await removeMemberFromTeam(member.id, row.team.id);
      await onChanged(`${member.name} saiu de ${row.team.name}.`);
    } catch (e) {
      const a = e as ApiError;
      // A mensagem vem do servidor: o 409 tem mais de uma razão.
      setErro(a.message || "Não consegui tirar do time.");
      setConfirmandoSaida(false);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <li className="rounded border border-border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm">{row.team.name}</strong>
        {row.isRoot && (
          <Badge tone="outline" size="sm">
            Time
          </Badge>
        )}

        {/* Com comando no time raiz, a linha do subtime é alocação: sem seletor. */}
        {row.autoridadeVemDe ? (
          <span className="muted ml-auto text-xs">
            Alocado · autoridade de {row.autoridadeVemDe.name}
          </span>
        ) : row.podeEditarCargo ? (
          <span className="ml-auto">
            <PillSelect
              value={escolhido}
              disabled={salvando}
              label={`Cargo em ${row.team.name}`}
              options={options.map((p) => ({
                id: p,
                label: ROLE_LABEL[p],
                commands: COMMAND_ROLES.includes(p),
              }))}
              onSelect={setEscolhido}
            />
          </span>
        ) : (
          // O cadeado vem do backend (`can_edit_role`); a tela não recalcula.
          <span className="ml-auto" title="Você não administra este vínculo">
            <Badge tone="neutral" size="sm" className="border">
              {ROLE_LABEL[row.role]}
            </Badge>
          </span>
        )}
      </div>

      <Reveal show={mudou}>
        <div className="mt-2 border-t border-border pt-2">
          <div className="muted text-xs">
            {roleConsequence(escolhido, row.team.name)}
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
              onClick={() => setEscolhido(row.role)}
            >
              Cancelar
            </button>
          </div>
        </div>
      </Reveal>

      {/* Tirar do time: `podeRemoverDoTime` (`membership.delete`), não o cadeado de cargo. */}
      {!mudou && podeRemoverDoTime(scope, row.team.id, row.role, permissoes) && (
        <div className="mt-2">
          <Reveal show={!confirmandoSaida}>
            <button
              className="btn btn-ghost px-0 text-xs"
              onClick={() => setConfirmandoSaida(true)}
            >
              Tirar de {row.team.name}
            </button>
          </Reveal>
          <Reveal show={confirmandoSaida}>
            <div className="rounded border border-border p-2">
              <div className="text-xs">
                {member.name} sai de <strong>{row.team.name}</strong>. A
                conta continua ativa e os outros times não mudam.
              </div>
              {row.role !== "OPERATOR" && (
                // O cargo se perde: remarcar traz a pessoa como Operador.
                <div className="muted mt-1 text-xs">
                  Ela deixa de ser {ROLE_LABEL[row.role].toLowerCase()} ali. Se
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
          </Reveal>
        </div>
      )}

      {erro && <div className="error-box mt-2 text-xs">{erro}</div>}
    </li>
  );
}

/** Adicionar a pessoa a mais um time. Nasce como Operador. */
function AddToTeam({
  member,
  availableTeams,
  onCancel,
  onChanged,
}: {
  member: Member;
  availableTeams: Team[];
  onCancel: () => void;
  onChanged: (aviso: string) => Promise<void>;
}) {
  const [alvo, setAlvo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  return (
    <div className="rounded border border-border p-2">
      {/* Menu próprio para caber a dica por linha. */}
      <MenuSelect
        aria-label="Time"
        placeholder="— escolha o time —"
        value={alvo === "" ? null : alvo}
        disabled={salvando}
        onSelect={setAlvo}
        options={availableTeams.map((t) => ({
          id: t.id,
          label: t.name,
          hint: t.parent_team_id === null ? undefined : "subtime",
        }))}
      />
      {/* Operador é o piso, então adicionar nunca viola a regra de nível. */}
      <div className="muted mt-1 text-xs">Entra como Operador.</div>
      {erro && <div className="error-box mt-2 text-xs">{erro}</div>}
      <div className="mt-2 flex gap-2">
        <button
          className="btn btn-primary"
          disabled={salvando || alvo === ""}
          onClick={async () => {
            setSalvando(true);
            try {
              await assignMemberToTeam(member.id, alvo, "OPERATOR");
              const nome = availableTeams.find((t) => t.id === alvo)?.name ?? "";
              await onChanged(`${member.name} entrou em ${nome} como operador.`);
            } catch (e) {
              setErro((e as ApiError).message || "Não consegui adicionar.");
            } finally {
              setSalvando(false);
            }
          }}
        >
          Adicionar
        </button>
        <button className="btn btn-ghost" disabled={salvando} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function OrgRoleField({
  member,
  opcoes,
  isSelf,
  onChanged,
}: {
  member: Member;
  /** Ver a prop `opcoesDeOrganizacao` do `MemberDrawer`. */
  opcoes: readonly (OrgRole | null)[];
  isSelf: boolean;
  onChanged: (aviso: string) => Promise<void>;
}) {
  const [escolhido, setEscolhido] = useState<OrgRole | "">(
    member.org_role ?? "",
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const mudou = escolhido !== (member.org_role ?? "");

  return (
    <div>
      <PillSelect
        value={escolhido}
        disabled={salvando || isSelf}
        label="Papel na organização"
        options={[
          ...(opcoes.includes("ADMIN")
            ? [{ id: "ADMIN" as const, label: ORG_ROLE_LABEL.ADMIN, commands: true }]
            : []),
          { id: "GESTOR", label: ORG_ROLE_LABEL.GESTOR, commands: true },
          { id: "", label: "Não administra a organização" },
        ]}
        onSelect={setEscolhido}
      />
      <div className="muted mt-1 text-xs">
        {escolhido === "ADMIN"
          ? "Define a organização: renomeia, apaga time e promove gestores."
          : escolhido === "GESTOR"
          ? "Opera a organização: cria time, cadastra pessoas e distribui papéis."
          : "Só os times em que está."}
      </div>
      {isSelf && (
        <div className="muted mt-1 text-xs">
          Você não muda o próprio papel — peça a outro administrador.
        </div>
      )}
      {erro && <div className="error-box mt-2 text-xs">{erro}</div>}
      <Reveal show={mudou && !isSelf}>
        <div className="mt-2 flex gap-2">
          <button
            className="btn btn-primary"
            disabled={salvando}
            onClick={async () => {
              setSalvando(true);
              try {
                await changeOrganizationRole(
                  member.id,
                  escolhido === "" ? null : escolhido,
                );
                await onChanged(
                  escolhido === ""
                    ? `${member.name} deixou de administrar a organização.`
                    : `${member.name} agora é ${ORG_ROLE_LABEL[escolhido].toLowerCase()} da organização.`,
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
            onClick={() => setEscolhido(member.org_role ?? "")}
          >
            Cancelar
          </button>
        </div>
      </Reveal>
    </div>
  );
}

function ResetPassword({
  member,
  onReveal,
}: {
  member: Member;
  onReveal: (r: { title: string; email: string; password: string }) => void;
}) {
  const [salvando, setSalvando] = useState(false);
  return (
    <button
      className="btn btn-ghost text-xs"
      disabled={salvando}
      onClick={async () => {
        setSalvando(true);
        try {
          const r = await resetMemberPassword(member.id);
          // O segredo volta uma vez e sobe para a gaveta, que não fecha enquanto ele está na tela.
          onReveal({
            title: `Senha nova de ${member.name}`,
            email: member.email,
            password: r.temporary_password,
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

function Deactivate({
  member,
  onChanged,
}: {
  member: Member;
  onChanged: (aviso: string) => Promise<void>;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const avisar = useAvisar();

  return (
    <>
      <Reveal show={!confirmando}>
        <button
          className="btn btn-ghost text-xs"
          onClick={() => setConfirmando(true)}
        >
          Desativar
        </button>
      </Reveal>
      <Reveal show={confirmando}>
    <div className="w-full rounded border border-border p-2">
      <div className="text-xs">
        <strong>{member.name}</strong> deixa de acessar o sistema — em TODOS os
        times, não só neste. As tarefas dela ficam.
      </div>
      <div className="mt-2 flex gap-2">
        <button
          className="btn btn-danger"
          disabled={salvando}
          onClick={async () => {
            setSalvando(true);
            try {
              await deactivateMember(member.id);
              await onChanged(`${member.name} foi desativado na organização.`);
            } catch (e) {
              avisar((e as ApiError).message || "Não consegui desativar.");
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
      </Reveal>
    </>
  );
}

/** Sem confirmação: reativar devolve o acesso que a pessoa já tinha. */
function Reactivate({
  member,
  onChanged,
}: {
  member: Member;
  onChanged: (aviso: string) => Promise<void>;
}) {
  const [salvando, setSalvando] = useState(false);
  const avisar = useAvisar();
  return (
    <button
      className="btn btn-ghost text-xs"
      disabled={salvando}
      onClick={async () => {
        setSalvando(true);
        try {
          await reactivateMember(member.id);
          await onChanged(`${member.name} foi reativado na organização.`);
        } catch (e) {
          // Sem isto, um 403/409 vira rejeição não tratada. O mesmo no `Deactivate`.
          avisar((e as ApiError).message || "Não consegui reativar.");
        } finally {
          setSalvando(false);
        }
      }}
    >
      Reativar
    </button>
  );
}
