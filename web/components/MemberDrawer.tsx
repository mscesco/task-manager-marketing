"use client";
// components/MemberDrawer.tsx
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
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, X } from "lucide-react";
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
  removeMemberFromTeam,
  resetMemberPassword,
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
  podeDesativarConta,
  podeRemoverDoTime,
  podeResetarSenha,
  timesParaAdicionar,
  type Alcance,
} from "@/lib/permissoesMembros";

const ROLE_LABEL: Record<MemberRole, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gerente",
  SUPERVISOR: "Supervisor",
  OPERATOR: "Operador",
};

const ORG_ROLE_LABEL: Record<OrgRole, string> = {
  ADMIN: "Administrador",
  GESTOR: "Gestor",
};

/**
 * Papéis que mandam na ÁRVORE inteira, e não só no time onde estão.
 *
 * ⚠️ Espelha `COMMAND_ROLES` de `auth/domain/team_scope.py`. Vira a bolinha
 * cheia do seletor — ver `PillOption.comanda`.
 */
const COMMAND_ROLES: MemberRole[] = ["ADMIN", "MANAGER"];

export default function MemberDrawer({
  member,
  teams,
  scope,
  isAdmin,
  canManageOrg,
  isSelf,
  onClose,
  onChanged,
}: {
  member: Member;
  teams: Team[];
  scope: Alcance;
  isAdmin: boolean;
  canManageOrg: boolean;
  isSelf: boolean;
  onClose: () => void;
  onChanged: (aviso: string) => Promise<void>;
}) {
  const [vinculos, setVinculos] = useState<MemberTeamComCadeado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [adicionando, setAdicionando] = useState(false);
  // ⚠️⚠️ A SENHA PROVISORIA MORA AQUI DENTRO desde 09/09, a pedido dela:
  // *"essa tela em azul deve aparecer (...) dentro dessa sobreposição, não na
  // tela comum"*. Antes ela subia para a página e aparecia atrás da gaveta.
  //
  // ⚠️ E ENQUANTO ELA ESTA NA TELA, A GAVETA NAO FECHA -- nem pelo X, nem pelo
  // scrim, nem pelo Esc. O segredo volta UMA vez (ADR 0021) e não há rota para
  // relê-lo: fechar por engano o perderia, e a saída é o "Concluir".
  const [revelado, setRevelado] = useState<{
    title: string;
    email: string;
    password: string;
  } | null>(null);
  const podeFechar = revelado === null;

  useEffect(() => {
    let vivo = true;
    listMemberTeams(member.id)
      .then((v) => vivo && setVinculos(v))
      .catch((e) =>
        vivo ? setErro((e as ApiError).message || "Não consegui carregar.") : null,
      );
    return () => {
      vivo = false;
    };
  }, [member.id]);

  const rows = vinculos ? drawerMemberships(vinculos, teams) : [];
  // ⚠️ DOIS FILTROS, e nenhum é dispensável: `jaEsta` espelha o
  // `UNIQUE (user_id, team_id)` do banco (oferecer daria 409), e
  // `timesParaAdicionar` corta pelo ALCANCE — o supervisor só puxa gente para
  // os próprios subtimes (D1 da Spec 028).
  const jaEsta = new Set(rows.map((l) => l.team.id));
  const availableTeams = timesParaAdicionar(
    scope,
    teams.filter((t) => !jaEsta.has(t.id)),
  ).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <>
      {/* ⚠️ O scrim é clicável para fechar, mas SEM escurecer forte: a tabela
          atrás é o contexto do que se edita, e apagá-la contradiz a escolha
          de gaveta em vez de modal. */}
      <div
        className="fixed inset-0 z-40 bg-black/10"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && podeFechar) onClose();
        }}
      />
      <motion.aside
        // ⚠️ Entra deslizando da direita. `prefers-reduced-motion` é honrado
        // pelo bloco global do `globals.css` e pelo próprio motion.
        initial={{ x: 24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 24, opacity: 0 }}
        transition={{ type: "spring", duration: 0.28, bounce: 0 }}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col border-l border-border bg-surface"
        role="dialog"
        aria-modal="true"
        aria-label={`Editar ${member.name}`}
        onKeyDown={(e) => {
          if (e.key === "Escape" && podeFechar) onClose();
        }}
      >
        {/* ⚠️ `items-center`, e não `items-start`: o nome e o e-mail são
            duas linhas, e alinhando pelo topo o X encostava no primeiro pixel
            do nome em vez de acompanhar o par. */}
        <div className="flex items-center gap-3 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{member.name}</h2>
            <div className="muted truncate text-xs">{member.email}</div>
          </div>
          <button
            className="btn btn-ghost"
            aria-label="Fechar"
            disabled={!podeFechar}
            title={podeFechar ? undefined : "Copie a senha e clique em Concluir"}
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* ⚠️ Entra deslizando de cima: o bloco aparece DEPOIS de um clique
              em "Resetar senha", e sem transição ele lê-se como um erro. */}
          <AnimatePresence>
            {revelado && (
              <motion.div
                initial={{ opacity: 0, y: -8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -8, height: 0 }}
                transition={{ type: "spring", duration: 0.32, bounce: 0 }}
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

          {/* ---- AÇÕES DA CONTA ------------------------------------------
              ⚠️ As duas são sobre a ORGANIZAÇÃO, não sobre um time — por isso
              ficam no topo, longe da relação de times. Numa tela com o nome de
              um time acima, "Desativar" lido junto dos vínculos parece "tirar
              deste time" (§4.2). */}
          <div className="mb-5 flex flex-wrap gap-2">
            {podeResetarSenha(scope) && (
              <ResetPassword member={member} onReveal={setRevelado} />
            )}
            {member.is_active && podeDesativarConta(scope) && !isSelf && (
              <Deactivate member={member} onChanged={onChanged} />
            )}
          </div>

          {canManageOrg && (
            <section className="mb-5">
              <h3 className="label mb-2">Na organização</h3>
              <OrgRoleField
                member={member}
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
                    onChanged={onChanged}
                  />
                ))}
              </ul>
            )}

            {/* ⚠️ ADICIONAR A UM TIME MORA AQUI, e é o que antes era o lápis.
                Uma porta só para "o vínculo": em quais times, e com que cargo
                em cada um. */}
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
function MembershipRow({
  row,
  member,
  scope,
  isAdmin,
  isSelf,
  onChanged,
}: {
  row: ReturnType<typeof drawerMemberships>[number];
  member: Member;
  scope: Alcance;
  isAdmin: boolean;
  /** É a própria pessoa que está olhando? Ver o `!isSelf` no "Tirar". */
  isSelf: boolean;
  onChanged: (aviso: string) => Promise<void>;
}) {
  const [escolhido, setEscolhido] = useState<MemberRole>(row.role);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmandoSaida, setConfirmandoSaida] = useState(false);

  const options = papeisAtribuiveis(scope, isAdmin, row.ehArea);
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
      // ⚠️⚠️ A MENSAGEM VEM DO SERVIDOR, e não de um palpite meu sobre o 409.
      // Eu traduzia TODO 409 para "é o único time da pessoa" -- e a rota tem
      // pelo menos três razões para recusar: o último vínculo, o PRÓPRIO
      // vínculo (anti-lockout) e deixar tarefa órfã. A Camila levou a mensagem
      // errada estando em DOIS times, duas vezes.
      //
      // ⚠️ Inventar a razão a partir do status é o espelho do "botão que a
      // tela oferece e o servidor recusa": aqui a tela EXPLICA uma recusa que
      // ela não tem como explicar.
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
        {row.ehArea && (
          <Badge tone="outline" size="sm">
            Área
          </Badge>
        )}

        {/* ⚠️⚠️ QUANDO O ROLE_LABEL VEM DE CIMA, SOME O SELETOR. Para quem tem
            comando na área, a linha do subtime não é cargo — é ALOCAÇÃO, e
            pela invariante de nível ela nunca conseguirá repetir ali o papel
            da raiz. Foi este detalhe que fez a Camila querer apagar o próprio
            vínculo, olhando a tela antiga. */}
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
          // ⚠️ O CADEADO VEM DO BACKEND (`can_edit_role`). A tela NÃO
          // recalcula escopo — a Spec 034 já desfez essa tentativa uma vez.
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

      {/* ---- TIRAR DO TIME ---------------------------------------------
          ⚠️ Pedido dela em 09/09. Fica DENTRO da linha do vínculo, e não num
          menu à parte: a ação é sobre ESTE time, e o nome dele está ali.
          ⚠️ A pergunta é `podeRemoverDoTime` e NÃO `podeEditarCargo`: são
          permissões diferentes. O supervisor tira gente do próprio subtime
          (D1 da Spec 028) sem poder trocar cargo de ninguém (D2). Usar o
          cadeado de cargo aqui esconderia dele a única ação que tem. */}
      {!mudou && podeRemoverDoTime(scope, row.team.id, row.role) && (
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
                // ⚠️ O CARGO SE PERDE, e remarcar depois traz a pessoa como
                // Operador. É a mesma perda silenciosa que o seletor antigo
                // avisava — a gaveta não pode ser mais frouxa que ele.
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
      {/* ⚠️ MENU PRÓPRIO, e não `<select>` nativo: o nativo desenha a lista
          pelo sistema operacional, e a dica "(área)" só cabe aqui. */}
      <MenuSelect
        aria-label="Time"
        placeholder="— escolha o time —"
        value={alvo === "" ? null : alvo}
        disabled={salvando}
        onSelect={setAlvo}
        options={availableTeams.map((t) => ({
          id: t.id,
          label: t.name,
          hint: t.parent_team_id === null ? "área" : undefined,
        }))}
      />
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
  isSelf,
  onChanged,
}: {
  member: Member;
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
      {/* ⚠️ O MESMO SELETOR do cargo de time, e não um `<select>`: são as duas
          permissões da mesma pessoa, lado a lado na mesma gaveta. Dois
          desenhos diferentes seriam duas coisas para aprender onde há uma só.
          ⚠️ A ordem vai do maior para o menor, como a de prioridade. */}
      <PillSelect
        value={escolhido}
        disabled={salvando || isSelf}
        label="Papel na organização"
        options={[
          { id: "ADMIN", label: ORG_ROLE_LABEL.ADMIN, commands: true },
          { id: "GESTOR", label: ORG_ROLE_LABEL.GESTOR, commands: true },
          { id: "", label: "Não administra a organização" },
        ]}
        onSelect={setEscolhido}
      />
      <div className="muted mt-1 text-xs">
        {escolhido === "ADMIN"
          ? "Define a organização: renomeia, apaga área e promove gestores."
          : escolhido === "GESTOR"
          ? "Opera a organização: cria área, cadastra pessoas e distribui papéis de time."
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
          // ⚠️ O segredo volta UMA vez (ADR 0021) e sobe UM nível, para a
          // gaveta -- que o desenha por cima do conteúdo dela e se recusa a
          // fechar enquanto ele estiver na tela. Até 09/09 ele subia para a
          // PÁGINA, e o bloco aparecia atrás da gaveta aberta.
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
