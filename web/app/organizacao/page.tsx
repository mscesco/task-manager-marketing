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
// ⚠️ TODA DECISAO MORA EM `lib/organizacao.ts`, testada -- aqui so desenha.
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
  buscarPessoas,
  cardsDeArea,
  gestoresDaOrganizacao,
  pessoasSemArea,
} from "@/lib/organizacao";

const ROTULO_ORG: Record<string, string> = {
  ADMIN: "administradora",
  GESTOR: "gestora",
};

export default function OrganizacaoPage() {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [times, setTimes] = useState<Team[]>([]);
  const [membros, setMembros] = useState<Member[]>([]);
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

  const cards = useMemo(() => cardsDeArea(times, membros), [times, membros]);
  const gestores = useMemo(() => gestoresDaOrganizacao(membros), [membros]);
  const semArea = useMemo(() => pessoasSemArea(membros), [membros]);
  const achadas = useMemo(
    () => buscarPessoas(busca, membros, times),
    [busca, membros, times],
  );

  return (
    <AppShell>
      <PageHeader
        title={
          ws ? (
            <NomeDaOrganizacao
              nome={ws.name}
              podeEditar={podeRenomear}
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
        <span className="muted text-xs">Administram a organização:</span>
        {gestores.length === 0 ? (
          <span className="muted text-xs">ninguém</span>
        ) : (
          gestores.map((g) => (
            <PapelDeOrganizacao
              key={g.id}
              membro={g}
              podeEditar={podeRenomear}
              souEu={g.id === me?.id}
              // ⚠️ QUAL ESTA ABERTO E ESTADO DO PAI, e nao de cada pilula.
              // Com um `useState` por pilula, abrir a segunda nao fechava a
              // primeira e os dois paineis ficavam empilhados -- reportado
              // pela Camila em 09/09, com captura.
              aberto={painelAberto === g.id}
              onAbrir={() => setPainelAberto(painelAberto === g.id ? null : g.id)}
              onFechar={() => setPainelAberto(null)}
              onMudou={async () => {
                setPainelAberto(null);
                await carregar();
              }}
              onAviso={setAviso}
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
                placeholder="nome ou e-mail"
                onChange={(e) => setBusca(e.target.value)}
              />
            </label>

            {busca.trim() !== "" && (
              <div className="border-t border-border">
                {achadas.length === 0 ? (
                  <div className="muted p-3 text-xs">
                    Ninguém com esse nome ou e-mail.
                  </div>
                ) : (
                  <ul className="m-0 list-none p-0">
                    {achadas.map(({ membro, areas }) => (
                      <li
                        key={membro.id}
                        className="flex flex-wrap items-baseline gap-2 border-b border-border px-3 py-2 last:border-b-0"
                      >
                        <strong className="text-sm">{membro.name}</strong>
                        <span className="muted text-xs">{membro.email}</span>
                        {membro.org_role && (
                          <Badge tone="soft" size="sm" color="var(--accent)">
                            {ROTULO_ORG[membro.org_role]}
                          </Badge>
                        )}
                        {areas.length === 0 ? (
                          <Badge tone="outline" size="sm">
                            sem área
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
                        {/* ⚠️ A AÇÃO VAI PARA A DIREITA (`ml-auto`), separada
                            do que a linha INFORMA. Misturada às cápsulas, ela
                            lia como mais um rótulo — e "tornar gestora" não é
                            um fato sobre a pessoa, é um botão. */}
                        {podeRenomear && !membro.org_role && (
                          <span className="ml-auto">
                            <PromoverNaOrganizacao
                              membro={membro}
                              onMudou={carregar}
                              onAviso={setAviso}
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

          {/* ---- a grade de áreas ---------------------------------------- */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 14,
            }}
          >
            {cards.map(({ area, pessoas, subtimes }) => (
              <Link
                key={area.id}
                href={`/times/${area.id}`}
                className="tappable block rounded-lg border border-border bg-surface p-4"
              >
                <strong className="text-[15px]">{area.name}</strong>
                <div className="muted mt-1.5 text-xs">
                  {pessoas} {pessoas === 1 ? "pessoa" : "pessoas"} ·{" "}
                  {subtimes} {subtimes === 1 ? "subtime" : "subtimes"}
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
  podeEditar,
  onRenomear,
}: {
  nome: string;
  podeEditar: boolean;
  onRenomear: (novo: string) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(nome);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => setValor(nome), [nome]);

  if (!podeEditar || !editando) {
    return (
      <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
        {nome}
        {podeEditar && (
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
    const novo = valor.trim();
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
        value={valor}
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
  const [aberto, setAberto] = useState(false);
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

  if (!aberto) {
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
function PapelDeOrganizacao({
  membro,
  podeEditar,
  souEu,
  aberto,
  onAbrir,
  onFechar,
  onMudou,
  onAviso,
}: {
  membro: Member;
  podeEditar: boolean;
  souEu: boolean;
  aberto: boolean;
  onAbrir: () => void;
  onFechar: () => void;
  onMudou: () => Promise<void>;
  onAviso: (texto: string) => void;
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
    if (!aberto) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onFechar();
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [aberto, onFechar]);

  // Fechar zera a confirmacao pendente -- reabrir nao pode cair no meio dela.
  useEffect(() => {
    if (!aberto) setConfirmandoSaida(false);
  }, [aberto]);

  const rotulo = ROTULO_ORG[membro.org_role ?? ""] ?? "organização";

  if (!podeEditar) {
    return (
      <Badge tone="soft" size="sm" color="var(--accent)">
        {membro.name} · {rotulo}
      </Badge>
    );
  }

  async function aplicar(novo: OrgRole | null) {
    setSalvando(true);
    try {
      await changeOrganizationRole(membro.id, novo);
      setErro(null);
      // ⚠️ DIZ O QUE ACONTECEU, porque o efeito visivel e a pessoa SUMIR
      // desta lista -- ela deixou de administrar a organizacao, entao nao
      // pertence mais ao cabecalho. Sem esta frase parece que foi apagada.
      onAviso(
        novo === null
          ? `${membro.name} deixou de administrar a organização. A conta e os times dela continuam como estavam.`
          : `${membro.name} agora é ${ROTULO_ORG[novo]}.`,
      );
      await onMudou();
    } catch (e) {
      const a = e as ApiError;
      setErro(
        a.status === 409
          ? "A organização precisa de pelo menos uma administradora. Promova outra pessoa antes."
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
          onAbrir();
        }}
        aria-expanded={aberto}
      >
        <Badge tone="soft" size="sm" color="var(--accent)">
          {membro.name} · {rotulo}
        </Badge>
      </button>

      {aberto && (
        <div className="absolute left-0 top-full z-20 mt-1 w-[290px] rounded-lg border border-border bg-surface p-3 shadow-lg">
          <div className="muted mb-2 text-xs">{membro.email}</div>

          {/* ⚠️ A consequência de CADA papel, em texto. É o que a §4.3 pede no
              lugar de chaves por permissão. */}
          <Opcao
            ativo={membro.org_role === "ADMIN"}
            titulo="Administradora"
            consequencia="Define a organização: renomeia, apaga área e promove gestoras."
            onEscolher={() => void aplicar("ADMIN")}
            desabilitado={salvando}
          />
          <Opcao
            ativo={membro.org_role === "GESTOR"}
            titulo="Gestora"
            consequencia="Opera a organização: cria área, cadastra pessoas e distribui papéis de time. Não desfaz a organização."
            onEscolher={() => void aplicar("GESTOR")}
            desabilitado={salvando}
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
              disabled={salvando || souEu}
              onClick={() => setConfirmandoSaida(true)}
            >
              Tirar da administração da organização
            </button>
          ) : (
            <div className="mt-2 rounded border border-border p-2">
              <div className="text-xs">
                <strong>{membro.name}</strong> deixa de administrar a
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
          {souEu && (
            <div className="muted mt-1 text-xs">
              {/* ⚠️ O backend barra o último admin com 409; barrar o PRÓPRIO
                  papel aqui é anti-lockout de tela, e a mensagem diz por quê
                  em vez de só desabilitar. */}
              Você não pode tirar o próprio papel — peça a outra
              administradora.
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
  ativo,
  titulo,
  consequencia,
  onEscolher,
  desabilitado,
}: {
  ativo: boolean;
  titulo: string;
  consequencia: string;
  onEscolher: () => void;
  desabilitado: boolean;
}) {
  return (
    <button
      className="tappable mb-1 block w-full rounded border border-border p-2 text-left"
      onClick={onEscolher}
      disabled={desabilitado || ativo}
      aria-current={ativo}
    >
      <span className="text-sm font-semibold">
        {titulo}
        {ativo && <span className="muted font-normal"> · atual</span>}
      </span>
      <span className="muted mt-0.5 block text-xs">{consequencia}</span>
    </button>
  );
}

/** Promove alguém que ainda não administra a organização. */
function PromoverNaOrganizacao({
  membro,
  onMudou,
  onAviso,
}: {
  membro: Member;
  onMudou: () => Promise<void>;
  onAviso: (texto: string) => void;
}) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function promover() {
    setSalvando(true);
    try {
      // ⚠️ GESTOR, e não ADMIN: promover para o papel que OPERA é o passo
      // reversível. Quem precisa de administradora sobe depois, pela pílula
      // no cabeçalho — que mostra a consequência antes.
      await changeOrganizationRole(membro.id, "GESTOR");
      setErro(null);
      onAviso(
        `${membro.name} agora é gestora e aparece no topo da organização. ` +
          "Para torná-la administradora, clique no nome dela lá.",
      );
      await onMudou();
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
        tornar gestora
      </button>
      {erro && <span className="error-text text-xs">{erro}</span>}
    </>
  );
}
