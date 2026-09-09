"use client";
// app/organizacao/page.tsx
// A tela da ORGANIZACAO (Spec 047, fatia B).
//
// ⚠️⚠️ NAO EXISTIA TELA DE ORGANIZACAO. Renomear o workspace era rota sem
// tela desde sempre; esta e a primeira que a expoe. O que muda de verdade
// nao e visual, e ONDE cada coisa e administrada:
//
//     a organizacao administra AREAS
//     o time administra PESSOAS      (fatia C)
//     o painel administra VINCULOS   (fatia D)
//
// ⚠️ TODA DECISAO MORA EM `lib/organization.ts`, testada -- aqui so desenha.
// `app/` esta FORA do `include` do vitest (§7 da spec), e o projeto ja pagou
// por esquecer isso duas vezes: `candidatosParaAdicionar` (Spec 044) e
// `computeLens`, que deixou passar a regressao de 09/09 ate alguem ver na
// tela.
//
// ⚠️ SEM `useSearchParams` AQUI, e e deliberado: esta rota e ESTATICA
// (`○ /organizacao` no build), e `useSearchParams` sem fronteira de
// `Suspense` derruba o `next build` em rota estatica -- o `npm run dev` NAO
// reclama (AGENTS.md §6, e a §7 desta spec avisa de novo). Se um dia esta
// tela precisar de estado na URL, ou envolve em `Suspense`, ou aceita virar
// dinamica.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Pencil, Plus, Search, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import Badge from "@/components/Badge";
import PageHeader from "@/components/PageHeader";
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
  areaCards,
  organizationManagers,
  peopleWithoutArea,
} from "@/lib/organization";

/**
 * Os papéis de ORGANIZAÇÃO, escritos como se lê.
 *
 * ⚠️ MAIÚSCULA INICIAL porque eles são substantivos que NOMEIAM um papel, e
 * não adjetivos soltos no meio da frase. Em pílula e em título de opção,
 * minúscula lê como rascunho.
 *
 * ⚠️⚠️ MASCULINO, POR DECISÃO DA CAMILA (09/09): *"quero tudo universal,
 * então tudo no masculino"*. É a mesma regra que ela deu para os nomes de
 * código -- o critério é UNIVERSALIDADE, não a composição da equipe de hoje.
 *
 * A primeira versão desta tela usava feminino ("Administradora"), porque a
 * prosa das specs escreve `SEO · supervisora` e o time é de mulheres. Isso
 * criava DUAS vozes no produto: a `/membros` sempre usou masculino
 * (`ROLE_LABEL`: "Administrador", "Gerente", "Supervisor", "Operador").
 *
 * ⚠️ A prosa das specs e os comentários FICAM como estão -- a decisão é
 * sobre o texto que o produto mostra, não sobre como escrevemos entre nós.
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
  // ⚠️ UM PAINEL POR VEZ. Ver o comentario no `PapelDeOrganizacao`.
  const [painelAberto, setPainelAberto] = useState<string | null>(null);
  // ⚠️ O AVISO DO QUE ACABOU DE ACONTECER. Sem ele, tirar o papel de alguem
  // faz a pessoa SUMIR da lista -- correto, ela nao administra mais --, e a
  // tela nao diz que foi isso. A Camila clicou, viu sumir e perguntou se
  // tinha apagado a pessoa.
  const [aviso, setAviso] = useState<string | null>(null);

  async function carregar() {
    setCarregando(true);
    try {
      const [w, t, m, u] = await Promise.all([
        getWorkspace(),
        listTeamsAll(),
        listMembers(),
        currentUser(),
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

  // ⚠️ Renomear exige `workspace.manage`; criar area exige `area.create`
  // (Spec 046, §4.1) -- e as duas SAO DIFERENTES: um GESTOR cria area e nao
  // renomeia a organizacao. Ler as duas separadas e o que impede a tela de
  // tratar "administra" como uma coisa so.
  const podeRenomear = me?.permissions.includes("workspace.manage") ?? false;
  const podeCriarArea = me?.permissions.includes("area.create") ?? false;

  const cards = useMemo(() => areaCards(teams, members), [teams, members]);
  const gestores = useMemo(() => organizationManagers(members), [members]);
  const semArea = useMemo(() => peopleWithoutArea(members), [members]);
  const achadas = useMemo(
    () => searchPeople(busca, members, teams),
    [busca, members, teams],
  );

  return (
    <AppShell>
      <PageHeader
        title={
          ws ? (
            <NomeDaOrganizacao
              nome={ws.name}
              canEdit={podeRenomear}
              onRenomear={async (novo) => {
                const atualizado = await renameWorkspace(novo);
                setWs(atualizado);
              }}
            />
          ) : (
            "Organização"
          )
        }
        actions={
          podeCriarArea ? (
            <CriarArea onCriada={carregar} />
          ) : null
        }
      />

      {/* ---- quem administra a ORGANIZAÇÃO -----------------------------
          ⚠️ Fica junto do NOME que eles administram, e não numa seção
          própria: é gente pouca, e o papel deles é sobre a organização
          inteira — não sobre um time. */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="muted text-xs">Administram a organização</span>
        {gestores.length === 0 ? (
          <span className="muted text-xs">Ninguém</span>
        ) : (
          gestores.map((g) => (
            <OrgRoleField
              key={g.id}
              member={g}
              canEdit={podeRenomear}
              isSelf={g.id === me?.id}
              // ⚠️ QUAL ESTA ABERTO E ESTADO DO PAI, e nao de cada pilula.
              // Com um `useState` por pilula, abrir a segunda nao fechava a
              // primeira e os dois paineis ficavam empilhados -- reportado
              // pela Camila em 09/09, com captura.
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

      {/* ⚠️ Operação BEM-SUCEDIDA que muda o que a tela mostra. `role="status"`
          e não `alert`: não há nada a corrigir, então anuncia sem interromper.
          Mesma decisão do aviso de rebaixamento na tela de membros. */}
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
        <div className="muted">Carregando…</div>
      ) : (
        <>
          {/* ---- busca por pessoa, atravessando as areas -------------------
              ⚠️ Não é enfeite: a grade é por ÁREA, então ela mostra o
              agregado e some com o indivíduo. "Onde está a Fulana?" não tem
              outra resposta nesta tela. */}
          {/* ⚠️⚠️ O RESULTADO MORA DENTRO DO MESMO BLOCO DA BUSCA, e nao solto
              embaixo dela. Reação da Camila à primeira versão: *"ficou meio
              estranho que ela só aparece assim solta na tela"* — e estava
              certa: o resultado flutuava entre o campo e a grade, sem
              container, então nada dizia a que ele pertencia nem onde ele
              acabava. Uma linha de texto no meio de uma página não se lê como
              "resultado de busca"; lê-se como conteúdo da página.

              A caixa resolve as três coisas de uma vez: agrupa o campo com o
              que ele produziu, delimita onde o resultado termina, e o separa
              da grade — que é OUTRA coisa (áreas, não pessoas). */}
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

            {/* ⚠️ A BUSCA AQUI É O ATALHO, e não a lista completa: esta tela é
                a grade de ÁREAS. Quem quer a tabela inteira vai para
                `/membros`, que a fatia E transformou na tabela de pessoas da
                organização -- e é a MESMA tabela da tela de time. */}
            {busca.trim() !== "" && (
              <div className="border-t border-border">
                {achadas.length === 0 ? (
                  <div className="muted p-3 text-xs">
                    Ninguém com esse nome ou e-mail.
                  </div>
                ) : (
                  <ul className="m-0 list-none p-0">
                    {achadas.map(({ member, areas }) => (
                      // ⚠️ DUAS COLUNAS, e não uma linha que embrulha. Na
                      // primeira versão tudo era `flex-wrap`: com nome longo
                      // ("Jaqueline Cristina Lopes dos Santos") o botão da
                      // direita caía sozinho numa segunda linha, e a linha da
                      // pessoa virava duas de altura irregular.
                      //
                      // Agora a esquerda ENCOLHE (`min-w-0`) e a ação é
                      // `shrink-0`: o que cede é o texto, não o layout.
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
                        {areas.length === 0 ? (
                          <Badge tone="outline" size="sm">
                            Sem área
                          </Badge>
                        ) : (
                          areas.map((a) => (
                            <Link
                              key={a.id}
                              href={`/times/${a.id}`}
                              className="tappable"
                            >
                              <Badge tone="soft" size="sm" color="var(--accent)">
                                {a.name}
                              </Badge>
                            </Link>
                          ))
                        )}
                        </span>
                        {/* ⚠️ A AÇÃO FICA À DIREITA, separada do que a linha
                            INFORMA. Misturada às cápsulas ela lia como mais um
                            rótulo — e "Tornar gestor" não é um fato sobre a
                            pessoa, é um botão.
                            ⚠️ `shrink-0`: quem cede espaço é o texto. */}
                        {podeRenomear && !member.org_role && (
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
                <div className="border-t border-border px-3 py-2">
                  <Link
                    href="/membros"
                    className="text-accent text-xs underline"
                  >
                    Ver todas as pessoas da organização
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* ---- a grade de áreas ---------------------------------------- */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 14,
            }}
          >
            {cards.map(({ area, pessoas, subteams }) => (
              <Link
                key={area.id}
                href={`/times/${area.id}`}
                className="tappable block rounded-lg border border-border bg-surface p-4"
              >
                <strong className="text-[15px]">{area.name}</strong>
                <div className="muted mt-1.5 text-xs">
                  {pessoas} {pessoas === 1 ? "pessoa" : "pessoas"} ·{" "}
                  {subteams} {subteams === 1 ? "subtime" : "subtimes"}
                </div>
              </Link>
            ))}

            {/* ⚠️ O CARD QUE IMPEDE GENTE INVISÍVEL. Sem ele, quem é
                cadastrado e nunca alocado não aparece em lugar nenhum do
                produto — a grade é feita de áreas. Some sozinho quando a
                lista está vazia. */}
            {semArea.length > 0 && (
              <div className="rounded-lg border border-dashed border-border p-4">
                <strong className="text-[15px]">Pessoas sem área</strong>
                <div className="muted mt-1.5 text-xs">
                  {semArea.length}{" "}
                  {semArea.length === 1 ? "pessoa" : "pessoas"} sem vínculo
                </div>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: "10px 0 0",
                    fontSize: 12.5,
                  }}
                >
                  {semArea.map((m) => (
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

/** O nome da organização, editável no lugar. */
function NomeDaOrganizacao({
  nome,
  canEdit,
  onRenomear,
}: {
  nome: string;
  canEdit: boolean;
  onRenomear: (novo: string) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [value, setValor] = useState(nome);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => setValor(nome), [nome]);

  if (!canEdit || !editando) {
    return (
      <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
        {nome}
        {canEdit && (
          <button
            className="btn btn-ghost"
            aria-label="Renomear a organização"
            onClick={() => {
              setErro(null);
              setEditando(true);
            }}
          >
            <Pencil size={14} aria-hidden="true" />
          </button>
        )}
      </span>
    );
  }

  async function salvar() {
    const novo = value.trim();
    // ⚠️ Vazio não é renomear -- e o backend recusaria com 422. Barrar aqui
    // evita a viagem; a recusa de verdade continua sendo dele.
    if (novo === "" || novo === nome) {
      setEditando(false);
      setValor(nome);
      return;
    }
    setSalvando(true);
    try {
      await onRenomear(novo);
      setEditando(false);
      setErro(null);
    } catch (e) {
      const a = e as ApiError;
      setErro(
        a.status === 403
          ? "Só quem administra a organização pode renomeá-la."
          : a.message || "Não consegui renomear.",
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input
        className="input"
        value={value}
        disabled={salvando}
        autoFocus
        maxLength={255}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void salvar();
          if (e.key === "Escape") {
            setEditando(false);
            setValor(nome);
          }
        }}
        style={{ fontSize: 18, width: 280 }}
      />
      <button className="btn btn-ghost" onClick={() => void salvar()} disabled={salvando}>
        <Check size={16} aria-hidden="true" />
      </button>
      <button
        className="btn btn-ghost"
        onClick={() => {
          setEditando(false);
          setValor(nome);
        }}
        disabled={salvando}
      >
        <X size={16} aria-hidden="true" />
      </button>
      {erro && (
        <span className="error-box" style={{ fontSize: 12 }}>
          {erro}
        </span>
      )}
    </span>
  );
}

/** Criar uma ÁREA — time sem pai (Spec 046). */
function CriarArea({ onCriada }: { onCriada: () => Promise<void> }) {
  const [isOpen, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar() {
    setSalvando(true);
    try {
      // ⚠️ `parent_team_id` AUSENTE é o que faz disto uma ÁREA, e não um
      // subtime — é o mesmo endpoint, e o corpo é que decide (Spec 046).
      // ⚠️ Ausente, e não `""`: o backend tipa `uuid | None`, e string vazia
      // é 422. Ver o comentário em `createTeam`.
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
          ? "Criar área exige papel de organização."
          : a.status === 409
          ? "Já existe um time com esse endereço."
          : a.message || "Não consegui criar a área.",
      );
    } finally {
      setSalvando(false);
    }
  }

  if (!isOpen) {
    return (
      <button className="btn btn-primary" onClick={() => setAberto(true)}>
        <Plus size={14} aria-hidden="true" /> Nova área
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
 * O papel de ORGANIZAÇÃO de uma pessoa — clicável, com confirmação.
 *
 * ⚠️⚠️ NÃO APLICA NO CLIQUE, ao contrário da pílula de prioridade que a
 * Camila usou como referência. A spec é explícita sobre a diferença
 * (§4.3): *"prioridade erra e você desfaz; cargo erra e a pessoa ganha
 * alcance no sistema inteiro, em silêncio, sem notificar ninguém."* Aqui é
 * ainda mais forte — é o papel que administra a organização toda.
 *
 * ⚠️ E o passo intermediário NOMEIA A CONSEQUÊNCIA, em vez de perguntar
 * "tem certeza?". Uma confirmação que não diz o que muda treina a pessoa a
 * clicar em "sim" sem ler.
 *
 * ⚠️ Nada de toggle por permissão: o que se ESCOLHE é o papel, o que se
 * MOSTRA é a consequência. Chave individual por permissão seria RBAC
 * editável entrando pela porta dos fundos, recusado em `decisoes.md` §10.1.
 */
function OrgRoleField({
  member,
  canEdit,
  isSelf,
  isOpen,
  onOpen,
  onClose,
  onChanged,
  onNotice,
}: {
  member: Member;
  canEdit: boolean;
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
  const wrapRef = useRef<HTMLSpanElement>(null);

  // ⚠️ FECHAR AO CLICAR FORA -- e este e o padrao de PAINEL SUSPENSO, com
  // `mousedown` no documento (o mesmo dos tres paineis do `TaskDetail`).
  //
  // ⚠️ E NAO o `useFecharAoClicarFora`, que resolve outro problema: aquele
  // pareia `mousedown` com `mouseup` porque em MODAL, selecionar texto dentro
  // e soltar fora fechava e apagava formulario. O comentario do `TaskDetail`
  // ja registra essa distincao, e eu a ignorei na primeira versao -- o painel
  // simplesmente nao fechava.
  useEffect(() => {
    if (!isOpen) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isOpen, onClose]);

  // Fechar zera a confirmacao pendente -- reabrir nao pode cair no meio dela.
  useEffect(() => {
    if (!isOpen) setConfirmandoSaida(false);
  }, [isOpen]);

  const label = ORG_ROLE_LABEL[member.org_role ?? ""] ?? "organização";

  if (!canEdit) {
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
      // ⚠️ DIZ O QUE ACONTECEU, porque o efeito visivel e a pessoa SUMIR
      // desta lista -- ela deixou de administrar a organizacao, entao nao
      // pertence mais ao cabecalho. Sem esta frase parece que foi apagada.
      onNotice(
        novo === null
          ? `${member.name} deixou de administrar a organização. A conta e os times dela continuam como estavam.`
          // ⚠️ MINÚSCULA AQUI, ao contrário da pílula: no meio da frase o
          // papel é substantivo comum ("agora é gestor"), e não o rótulo que
          // nomeia uma opção. Reusar `ORG_ROLE_LABEL` cru daria "agora é Gestora".
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
    // ⚠️ O `ref` AQUI E O QUE FAZ O CLICAR-FORA FUNCIONAR. A primeira versao
    // declarava `wrapRef` e nunca o pendurava: `wrapRef.current` ficava
    // `null`, a condicao `wrapRef.current && ...` curto-circuitava e o painel
    // nunca fechava. O `tsc` NAO acusa -- ref declarada e nao usada e valida.
    <span className="relative inline-flex" ref={wrapRef}>
      <button
        className="tappable"
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

      {isOpen && (
        <div className="absolute left-0 top-full z-20 mt-1 w-[290px] rounded-lg border border-border bg-surface p-3 shadow-lg">
          <div className="muted mb-2 text-xs">{member.email}</div>

          {/* ⚠️ A consequência de CADA papel, em texto. É o que a §4.3 pede no
              lugar de chaves por permissão. */}
          <Opcao
            active={member.org_role === "ADMIN"}
            title="Administradora"
            consequencia="Define a organização: renomeia, apaga área e promove gestores."
            onSelect={() => void aplicar("ADMIN")}
            disabled={salvando}
          />
          <Opcao
            active={member.org_role === "GESTOR"}
            title="Gestora"
            consequencia="Opera a organização: cria área, cadastra pessoas e distribui papéis de time. Não desfaz a organização."
            onSelect={() => void aplicar("GESTOR")}
            disabled={salvando}
          />

          {/* ---- deixar de administrar -------------------------------------
              ⚠️⚠️ ISTO ERA UM BOTAO SOLTO CHAMADO "Não administra a
              organização", e a Camila clicou nele sem saber o que fazia --
              a pessoa sumiu da lista e ela perguntou se tinha apagado.

              Dois defeitos ali, e nenhum era o comportamento (que estava
              certo): o rotulo descrevia um ESTADO ("não administra") em vez
              de uma AÇÃO, e nada dizia o que PERMANECE. Some da lista porque
              a lista é de quem administra -- mas isso só é óbvio para quem
              escreveu.

              ⚠️ Confirmação em dois passos porque é perda de autoridade, a
              mesma razão da §4.3 -- e o segundo passo nomeia o que fica. */}
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
              {/* ⚠️ O backend barra o último admin com 409; barrar o PRÓPRIO
                  papel aqui é anti-lockout de tela, e a mensagem diz por quê
                  em vez de só desabilitar. */}
              Você não pode tirar o próprio papel — peça a outro
              administrador.
            </div>
          )}

          {erro && (
            <div className="error-box mt-2 text-xs">{erro}</div>
          )}
        </div>
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
  return (
    <button
      className="tappable mb-1 block w-full rounded border border-border p-2 text-left"
      onClick={onSelect}
      disabled={disabled || active}
      aria-current={active}
    >
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
      // ⚠️ GESTOR, e não ADMIN: promover para o papel que OPERA é o passo
      // reversível. Quem precisa de administrador sobe depois, pela pílula
      // no cabeçalho — que mostra a consequência antes.
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
