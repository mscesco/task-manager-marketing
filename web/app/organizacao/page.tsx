"use client";
// Tela da organização: renomear, quem administra, busca de pessoa e grade de times.
// As regras moram em `lib/organization.ts` (app/ fica fora do vitest).
// Rota estática: `useSearchParams` sem `Suspense` quebraria o `next build`.

import AnchoredPanel, { useAnchoredPanel } from "@/components/AnchoredPanel";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import AppShell from "@/components/AppShell";
import Badge from "@/components/Badge";
import PageHeader from "@/components/PageHeader";
import RenameOrganization from "@/components/RenameOrganization";
import Loading from "@/components/Loading";
import { useDrawnOutline } from "@/components/AnimatedOutline";
import {
  ApiError,
  changeOrganizationRole,
  createTeam,
  currentUser,
  getWorkspace,
  listMembers,
  listTeamsAll,
  renameWorkspace,
  type CurrentUser,
  type Member,
  type OrgRole,
  type Team,
  type Workspace,
} from "@/lib/api";
import {
  searchPeople,
  rootTeamCards,
  organizationManagers,
  papeisDeOrganizacaoAtribuiveis,
  peopleWithoutRoot,
  podeAbrirOrganizacao,
  type RootTeamCard,
} from "@/lib/organization";

/**
 * Rótulos dos papéis de organização: maiúscula inicial, no masculino.
 */
const ORG_ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrador",
  GESTOR: "Gestor",
};

export default function OrganizacaoPage() {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [teams, setTimes] = useState<Team[]>([]);
  const [members, setMembros] = useState<Member[]>([]);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  // Um painel aberto por vez.
  const [painelAberto, setPainelAberto] = useState<string | null>(null);
  // Aviso do que acabou de acontecer: tirar o papel faz a pessoa sumir da lista.
  const [aviso, setAviso] = useState<string | null>(null);
  const [renomeando, setRenomeando] = useState(false);

  const router = useRouter();
  // Guarda: só libera com o `me` carregado e papel de organização.
  const [liberada, setLiberada] = useState(false);

  async function carregar() {
    setCarregando(true);
    try {
      // O `me` primeiro: quem não pode ver a tela não dispara as outras leituras.
      const u = await currentUser();
      if (!podeAbrirOrganizacao(u)) {
        router.replace("/");
        return;
      }
      setLiberada(true);
      const [w, t, m] = await Promise.all([
        getWorkspace(),
        listTeamsAll(),
        listMembers(),
      ]);
      setWs(w);
      setTimes(t);
      setMembros(m);
      setMe(u);
      setErro(null);
    } catch (e) {
      setErro((e as ApiError).message || "Não consegui carregar a organização.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  // Três permissões distintas; o teto do GESTOR está em `papeisDeOrganizacaoAtribuiveis`.
  const podeRenomear = me?.permissions.includes("organization.update") ?? false;
  const podeCriarTimeRaiz = me?.permissions.includes("team.create") ?? false;
  const podeDarPapel = me?.permissions.includes("org_role.grant") ?? false;

  const cards = useMemo(() => rootTeamCards(teams, members), [teams, members]);
  const gestores = useMemo(() => organizationManagers(members), [members]);
  const semRaiz = useMemo(() => peopleWithoutRoot(members), [members]);
  const achadas = useMemo(
    () => searchPeople(busca, members, teams),
    [busca, members, teams],
  );

  // Depois dos hooks: um `return` antes do `useMemo` mudaria a ordem deles.
  if (!liberada) {
    return (
      <AppShell>
        <Loading />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        // Só o nome no `<h1>`; o lápis e o campo vão no `titleAddon`, senão entram no título lido.
        title={
          ws ? (
            renomeando ? <span className="sr-only">{ws.name}</span> : ws.name
          ) : (
            "Organização"
          )
        }
        titleAddon={
          ws && podeRenomear ? (
            <RenameOrganization
              name={ws.name}
              editing={renomeando}
              onEditingChange={setRenomeando}
              onRename={async (novo) => {
                const atualizado = await renameWorkspace(novo);
                setWs(atualizado);
              }}
            />
          ) : null
        }
        actions={
          podeCriarTimeRaiz ? (
            <CriarTimeRaiz onCriada={carregar} />
          ) : null
        }
      />

      {/* ---- quem administra a organização ---- */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="muted text-xs">Administram a organização</span>
        {gestores.length === 0 ? (
          <span className="muted text-xs">Ninguém</span>
        ) : (
          gestores.map((g) => (
            <OrgRoleField
              key={g.id}
              member={g}
              // Por pessoa: o GESTOR mexe na pílula de outro gestor, não na de um admin.
              opcoes={me ? papeisDeOrganizacaoAtribuiveis(me, g.org_role ?? null) : null}
              isSelf={g.id === me?.id}
              // Qual está aberto é estado do pai, e abrir um fecha o outro.
              isOpen={painelAberto === g.id}
              onOpen={() => setPainelAberto(painelAberto === g.id ? null : g.id)}
              onClose={() => setPainelAberto(null)}
              onChanged={async () => {
                setPainelAberto(null);
                await carregar();
              }}
              onNotice={setAviso}
            />
          ))
        )}
      </div>

      {erro && <div className="error-box">{erro}</div>}

      {/* `role="status"`, não `alert`: anuncia sem interromper. */}
      {aviso && (
        <div
          role="status"
          className="muted mb-4 flex items-start gap-2 text-xs"
        >
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
        <Loading />
      ) : (
        <>
          {/* ---- busca por pessoa, atravessando os times ---- */}
          {/* O resultado fica na mesma caixa da busca, separado da grade. */}
          <div className="mb-6 max-w-[560px] overflow-hidden rounded-lg border border-border bg-surface">
            <label className="block p-3">
              <span className="label flex items-center gap-1.5">
                <Search size={14} aria-hidden="true" /> Encontrar pessoa
              </span>
              <input
                className="input mt-1.5 w-full"
                value={busca}
                placeholder="Nome ou e-mail"
                onChange={(e) => setBusca(e.target.value)}
              />
            </label>

            {/* Atalho: a lista completa de pessoas fica na tela de cada time. */}
            {busca.trim() !== "" && (
              <div className="border-t border-border">
                {achadas.length === 0 ? (
                  <div className="muted p-3 text-xs">
                    Ninguém com esse nome ou e-mail.
                  </div>
                ) : (
                  <ul className="m-0 list-none p-0">
                    {achadas.map(({ member, roots }) => (
                      // Duas colunas: o texto encolhe (`min-w-0`), a ação não (`shrink-0`).
                      <li
                        key={member.id}
                        className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
                      >
                        <span className="flex min-w-0 flex-wrap items-baseline gap-2">
                          <strong className="truncate text-sm">
                            {member.name}
                          </strong>
                          <span className="muted truncate text-xs">
                            {member.email}
                          </span>
                        {member.org_role && (
                          <Badge tone="soft" size="sm" color="var(--accent)">
                            {ORG_ROLE_LABEL[member.org_role]}
                          </Badge>
                        )}
                        {roots.length === 0 ? (
                          <Badge tone="outline" size="sm">
                            Sem time
                          </Badge>
                        ) : (
                          roots.map((a) => (
                            <Link
                              key={a.id}
                              href={`/times/${a.id}`}
                              // `pill-target`: o anel de foco segue o raio do `<a>`, não do `Badge`.
                              className="tappable pill-target"
                            >
                              <Badge tone="soft" size="sm" color="var(--accent)">
                                {a.name}
                              </Badge>
                            </Link>
                          ))
                        )}
                        </span>
                        {/* A ação fica à direita, separada das cápsulas. */}
                        {podeDarPapel && !member.org_role && (
                          <span className="ml-auto shrink-0">
                            <PromoverNaOrganizacao
                              member={member}
                              onChanged={carregar}
                              onNotice={setAviso}
                            />
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* ---- a grade de times ---- */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 16,
            }}
          >
            {cards.map((card) => (
              <CartaoDeTimeRaiz key={card.root.id} card={card} />
            ))}

            {/* Pessoas sem time: sem este cartão elas não aparecem em lugar nenhum. */}
            {semRaiz.length > 0 && (
              <div className="rounded-xl border border-dashed border-border p-[18px]">
                <strong className="text-md font-bold">Pessoas sem time</strong>
                <div className="muted mt-2 text-sm">
                  {semRaiz.length}{" "}
                  {semRaiz.length === 1 ? "pessoa" : "pessoas"} sem vínculo
                </div>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: "10px 0 0",
                    fontSize: 12.5,
                  }}
                >
                  {semRaiz.map((m) => (
                    <li key={m.id} className="muted">
                      {m.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}

/**
 * Um cartão da grade de times. É componente para poder usar `useDrawnOutline`.
 */
function CartaoDeTimeRaiz({ card }: { card: RootTeamCard }) {
  const { root, pessoas, subteams } = card;
  const { target, outline } = useDrawnOutline();
  return (
    <Link
      href={`/times/${root.id}`}
      // `relative`: o contorno mede este cartão, não o ancestral posicionado.
      className="relative block cursor-pointer rounded-xl border border-border border-t-[3px] border-t-teal bg-surface p-[18px]"
      {...target}
    >
      {outline}
      <span className="flex items-center gap-2">
        <strong className="min-w-0 flex-1 truncate text-md font-bold">{root.name}</strong>
        <Badge tone="neutral" size="sm" weight="semibold" className="shrink-0 bg-surface-2 text-ink-soft">
          {pessoas} {pessoas === 1 ? "pessoa" : "pessoas"}
        </Badge>
      </span>
      <div className="muted mt-2 text-sm">
        {subteams} {subteams === 1 ? "subtime" : "subtimes"}
      </div>
    </Link>
  );
}

/** Criar um time raiz (sem pai). */
function CriarTimeRaiz({ onCriada }: { onCriada: () => Promise<void> }) {
  const [isOpen, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar() {
    setSalvando(true);
    try {
      // Sem `parent_team_id` (ausente, não `""`, que dá 422) cria um time raiz.
      await createTeam({ name: nome.trim(), slug: slug.trim() });
      setAberto(false);
      setNome("");
      setSlug("");
      setErro(null);
      await onCriada();
    } catch (e) {
      const a = e as ApiError;
      setErro(
        a.status === 403
          ? "Criar um time exige papel de organização."
          : a.status === 409
          ? "Já existe um time com esse endereço."
          : a.message || "Não consegui criar o time.",
      );
    } finally {
      setSalvando(false);
    }
  }

  if (!isOpen) {
    return (
      <button className="btn btn-primary" onClick={() => setAberto(true)}>
        <Plus size={14} aria-hidden="true" /> Novo time
      </button>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
      <input
        className="input"
        placeholder="Nome"
        value={nome}
        autoFocus
        disabled={salvando}
        maxLength={255}
        onChange={(e) => setNome(e.target.value)}
        style={{ width: 160 }}
      />
      <input
        className="input"
        placeholder="endereco"
        value={slug}
        disabled={salvando}
        onChange={(e) => setSlug(e.target.value)}
        style={{ width: 140 }}
      />
      <button
        className="btn btn-primary"
        onClick={() => void criar()}
        disabled={salvando || nome.trim() === "" || slug.trim() === ""}
      >
        Criar
      </button>
      <button className="btn btn-ghost" onClick={() => setAberto(false)} disabled={salvando}>
        Cancelar
      </button>
      {erro && <div className="error-box">{erro}</div>}
    </div>
  );
}

/**
 * O papel de organização de uma pessoa. Não aplica no clique: abre um painel
 * que escreve a consequência de cada papel antes de aplicar.
 */
function OrgRoleField({
  member,
  opcoes,
  isSelf,
  isOpen,
  onOpen,
  onClose,
  onChanged,
  onNotice,
}: {
  member: Member;
  /** Os destinos que o ator pode dar a esta pessoa; `null` = não mexe nela. */
  opcoes: readonly (OrgRole | null)[] | null;
  isSelf: boolean;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onNotice: (texto: string) => void;
}) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmandoSaida, setConfirmandoSaida] = useState(false);
  // Painel fixo que se desloca para caber na tela e fecha ao clicar fora.
  const { anchorRef, panelRef, box } = useAnchoredPanel<HTMLButtonElement>(
    isOpen,
    () => onClose(),
    { larguraPainel: 290 },
  );

  // Fechar zera a confirmacao pendente -- reabrir nao pode cair no meio dela.
  useEffect(() => {
    if (!isOpen) setConfirmandoSaida(false);
  }, [isOpen]);

  const label = ORG_ROLE_LABEL[member.org_role ?? ""] ?? "organização";

  if (opcoes === null) {
    return (
      <Badge tone="soft" size="sm" color="var(--accent)">
        {member.name} · {label}
      </Badge>
    );
  }

  async function aplicar(novo: OrgRole | null) {
    setSalvando(true);
    try {
      await changeOrganizationRole(member.id, novo);
      setErro(null);
      // Diz o que aconteceu: quem sai da administração some desta lista.
      onNotice(
        novo === null
          ? `${member.name} deixou de administrar a organização. A conta e os times dela continuam como estavam.`
          // Minúscula no meio da frase.
          : `${member.name} agora é ${ORG_ROLE_LABEL[novo].toLowerCase()}.`,
      );
      await onChanged();
    } catch (e) {
      const a = e as ApiError;
      setErro(
        a.status === 409
          ? "A organização precisa de pelo menos um administrador. Promova outra pessoa antes."
          : a.status === 403
          ? "Só quem administra a organização pode mudar isto."
          : a.message || "Não consegui mudar o papel.",
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <span className="inline-flex">
      <button
        ref={anchorRef}
        // `pill-target`: o anel de foco segue o raio da pílula.
        className="tappable pill-target"
        onClick={() => {
          setErro(null);
          onOpen();
        }}
        aria-expanded={isOpen}
      >
        <Badge tone="soft" size="sm" color="var(--accent)">
          {member.name} · {label}
        </Badge>
      </button>

      {isOpen && box && (
        <AnchoredPanel box={box} panelRef={panelRef} role="dialog" aria-label={`Papel de ${member.name} na organização`} minWidth={290}>
        <div className="p-1.5">
          <div className="muted mb-2 text-xs">{member.email}</div>

          {/* A consequência de cada papel, em texto. */}
          {/* ADMIN só aparece para quem pode dar ADMIN. */}
          {opcoes.includes("ADMIN") && (
            <Opcao
              active={member.org_role === "ADMIN"}
              title="Administradora"
              consequencia="Define a organização: renomeia, apaga time e promove gestores."
              onSelect={() => void aplicar("ADMIN")}
              disabled={salvando}
            />
          )}
          <Opcao
            active={member.org_role === "GESTOR"}
            title="Gestora"
            consequencia="Opera a organização: cria time, cadastra pessoas e distribui papéis. Não desfaz a organização."
            onSelect={() => void aplicar("GESTOR")}
            disabled={salvando}
          />

          {/* ---- deixar de administrar: dois passos, e o segundo diz o que permanece ---- */}
          {!confirmandoSaida ? (
            <button
              className="btn btn-ghost mt-2 w-full justify-start text-left"
              disabled={salvando || isSelf}
              onClick={() => setConfirmandoSaida(true)}
            >
              Tirar da administração
            </button>
          ) : (
            <div className="mt-2 rounded border border-border p-2">
              <div className="text-xs">
                <strong>{member.name}</strong> deixa de administrar a
                organização.
              </div>
              <div className="muted mt-1 text-xs">
                A conta continua ativa e os times dela não mudam — ela só
                perde o papel de organização. Some deste cabeçalho porque ele
                lista quem administra.
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  className="btn btn-danger"
                  disabled={salvando}
                  onClick={() => void aplicar(null)}
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
          {isSelf && (
            <div className="muted mt-1 text-xs">
              {/* O backend barra o último admin (409); aqui a tela impede tirar o próprio papel. */}
              Você não pode tirar o próprio papel — peça a outro
              administrador.
            </div>
          )}

          {erro && (
            <div className="error-box mt-2 text-xs">{erro}</div>
          )}
        </div>
        </AnchoredPanel>
      )}
    </span>
  );
}

/** Uma escolha de papel, com a consequência escrita embaixo. */
function Opcao({
  active,
  title,
  consequencia,
  onSelect,
  disabled,
}: {
  active: boolean;
  title: string;
  consequencia: string;
  onSelect: () => void;
  disabled: boolean;
}) {
  const { target, outline } = useDrawnOutline();
  return (
    <button
      className="relative mb-1 block w-full cursor-pointer rounded border border-border p-2 text-left"
      onClick={onSelect}
      disabled={disabled || active}
      aria-current={active}
      {...target}
    >
      {outline}
      <span className="text-sm font-semibold">
        {title}
        {active && <span className="muted font-normal"> · atual</span>}
      </span>
      <span className="muted mt-0.5 block text-xs">{consequencia}</span>
    </button>
  );
}

/** Promove alguém que ainda não administra a organização. */
function PromoverNaOrganizacao({
  member,
  onChanged,
  onNotice,
}: {
  member: Member;
  onChanged: () => Promise<void>;
  onNotice: (texto: string) => void;
}) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function promover() {
    setSalvando(true);
    try {
      // Promove para GESTOR (reversível); ADMIN só pela pílula do cabeçalho.
      await changeOrganizationRole(member.id, "GESTOR");
      setErro(null);
      onNotice(
        `${member.name} agora é gestor e aparece no topo da organização. ` +
          "Para tornar administrador, clique no nome lá.",
      );
      await onChanged();
    } catch (e) {
      const a = e as ApiError;
      setErro(a.message || "Não consegui promover.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <button
        className="btn btn-ghost text-xs"
        onClick={() => void promover()}
        disabled={salvando}
      >
        Tornar gestor
      </button>
      {erro && <span className="error-text text-xs">{erro}</span>}
    </>
  );
}
