"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import EmptyState from "@/components/EmptyState";
import Card from "@/components/Card";
import PageHeader from "@/components/PageHeader";
import Loading from "@/components/Loading";
import { useDrawnOutline } from "@/components/AnimatedOutline";
import {
  listProjects,
  createProject,
  currentUser,
  listTeamsAll,
  ApiError,
  type Project,
  type ProjectStatus,
  type Team,
} from "@/lib/api";
import { rootsForPerson } from "@/lib/contextSwitcher";

// Projeto e "pasta" -- tudo no time raiz, todos veem. Designar e so nas tasks.
const PROJECT_STATUS: { key: ProjectStatus; label: string; color: string }[] = [
  { key: "PLANNING", label: "Planejamento", color: "#8b8f9a" },
  { key: "ACTIVE", label: "Ativo", color: "#2e7d32" },
  { key: "BLOCKED", label: "Bloqueado", color: "#c62828" },
  { key: "COMPLETED", label: "Concluído", color: "#1565c0" },
  { key: "CANCELLED", label: "Cancelado", color: "#9e9e9e" },
];
const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  PROJECT_STATUS.map((s) => [s.key, s.label])
);
const STATUS_COLOR: Record<string, string> = Object.fromEntries(
  PROJECT_STATUS.map((s) => [s.key, s.color])
);

export default function ProjetosPage() {
  return (
    <AppShell>
      <Projetos />
    </AppShell>
  );
}

function Projetos() {
  const [items, setItems] = useState<Project[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [criando, setCriando] = useState(false);
  const [podeCriar, setPodeCriar] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("PLANNING");
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  // ⚠️⚠️ A AREA DO PROJETO, e ela nasceu de um defeito de 10/09: criar projeto
  // parou de funcionar no dia em que a segunda area passou a existir.
  //
  // `createProject` sem `team_id` caía em `getRootTeamId()`, que a Spec 046
  // (fatia 1) fez LEVANTAR com mais de uma raiz -- de propósito, porque "a
  // raiz" deixou de ser uma pergunta com resposta. O erro subia como
  // `AreaIndefinidaError` e a tela mostrava "não consegui criar o projeto".
  //
  // ⚠️ A CORREÇÃO É PERGUNTAR, e não adivinhar. Escolher a primeira por nome
  // (o que `peopleEntry` faz para NAVEGAR) criaria o projeto no Comercial
  // porque "C" vem antes de "M" -- silenciosamente, na área errada.
  //
  // ⚠️ E ISTO NÃO É A ÁREA COMO CONTEXTO (a spec que vem): quando a área
  // ambiente existir, este seletor deixa de ser pergunta e passa a ser
  // confirmação do lugar onde a pessoa já está. O campo continua; muda quem o
  // preenche.
  const [areas, setAreas] = useState<Team[]>([]);
  const [areaId, setAreaId] = useState<string>("");

  useEffect(() => {
    listProjects({ size: 100 })
      // pasta = projeto comum; o pessoal do proprio usuario nao entra aqui.
      .then((r) => setItems(r.items))
      .catch((e: ApiError) => setErro(e.message));
    // ⚠️ As duas juntas porque `rootsForPerson` precisa das DUAS: a árvore e os
    // vínculos de quem está olhando. Um operador do Marketing não escolhe TI.
    Promise.all([currentUser(), listTeamsAll()])
      .then(([me, times]) => {
        setPodeCriar(me.permissions.includes("project.create"));
        const minhas = rootsForPerson(
          times,
          me,
          (me.org_role ?? null) !== null,
        );
        setAreas(minhas);
        // ⚠️ COM UMA ÁREA SÓ, NÃO HÁ PERGUNTA: pré-seleciona e o campo nem
        // aparece. É o cadastro da maioria, e um seletor de um item é ruído.
        if (minhas.length === 1) setAreaId(minhas[0].id);
      })
      .catch(() => {});
  }, []);

  async function criar() {
    const t = titulo.trim();
    if (!t || !areaId) return;
    setSalvando(true);
    setErroForm(null);
    try {
      const novo = await createProject({ title: t, status, team_id: areaId });
      setItems((prev) => [novo, ...(prev ?? [])]);
      setTitulo("");
      setStatus("PLANNING");
      setCriando(false);
    } catch (e) {
      setErroForm((e as ApiError).message || "Não consegui criar o projeto.");
    } finally {
      setSalvando(false);
    }
  }

  if (erro) return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  if (!items) return <Loading />;

  return (
    <div>
      <PageHeader
        title="Projetos"
        count={`${items.length} projetos`}
        actions={
          podeCriar && !criando && (
            <button type="button" className="btn btn-primary" onClick={() => setCriando(true)}>
              + Novo projeto
            </button>
          )
        }
      />

      {criando && (
        <Card className="mb-[18px] flex max-w-[860px] flex-col gap-3">
          <div className="field">
            <span className="label">Título do projeto</span>
            <input
              className="input"
              autoFocus
              placeholder="Ex.: Campanha Q3"
              value={titulo}
              maxLength={255}
              disabled={salvando}
              onChange={(e) => setTitulo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  criar();
                } else if (e.key === "Escape") {
                  setCriando(false);
                  setTitulo("");
                }
              }}
            />
          </div>
          <div className="field">
            <span className="label">Status</span>
            <select
              className="input"
              value={status}
              disabled={salvando}
              onChange={(e) => setStatus(e.target.value as ProjectStatus)}
            >
              {PROJECT_STATUS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
          {/* ⚠️ SÓ COM DUAS OU MAIS. Ver o bloco em `areaId`, no topo: com uma
              área a resposta é única e o campo seria uma pergunta retórica. */}
          {areas.length > 1 && (
            <div className="field">
              <span className="label">Time</span>
              <select
                className="input"
                value={areaId}
                disabled={salvando}
                onChange={(e) => setAreaId(e.target.value)}
              >
                {/* ⚠️ A VAZIA VEM PRIMEIRO E FICA: sem ela o `<select>` já
                    nasceria com a primeira área marcada, e criar projeto na
                    área errada por não ter olhado o campo é pior que o erro
                    que este seletor veio consertar. O botão fica desligado
                    enquanto nada foi escolhido. */}
                <option value="">— escolha o time —</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          )}
          {erroForm && <div className="error-box">{erroForm}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button" className="btn btn-ghost" disabled={salvando}
              onClick={() => { setCriando(false); setTitulo(""); setErroForm(null); }}
            >
              Cancelar
            </button>
            <button
              type="button" className="btn btn-primary"
              disabled={salvando || !titulo.trim() || !areaId}
              onClick={criar}
            >
              {salvando ? "Criando…" : "Criar projeto"}
            </button>
          </div>
        </Card>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="Nenhum projeto ainda"
          description="Crie um projeto para agrupar tarefas de um trabalho maior."
          action={
            podeCriar && (
              <button type="button" className="btn btn-primary" onClick={() => setCriando(true)}>
                + Novo projeto
              </button>
            )
          }
        />
      ) : (
        /* ⚠️ LINHAS DE LARGURA CHEIA, e não grade de cartões (22/08). O
           `Projetos.png` desenha faixas empilhadas, e a Camila confirmou o que
           elas carregam: "essas faixas é pra ter o nome do projeto e o status".
           O conteúdo já era esse -- o que mudou foi a forma.

           ⚠️ E A FORMA IMPORTA AQUI: em grade, o nome de um projeto longo
           quebrava em duas linhas dentro de 260px, e o olho comparava cartões
           de alturas diferentes. Em linha, os nomes ficam alinhados na mesma
           coluna e a lista se lê de cima para baixo, que é como se procura um
           projeto pelo nome. */
        <div
          style={{
            // ⚠️ 1100, e não 860 (22/08). A Camila viu na tela: "tá muito
            // pequeno". Em 860 a lista ficava um bloco estreito perdido numa
            // tela de 1440, e o desenho mostra a faixa ocupando quase toda a
            // largura útil. Continua com teto: largura cheia num monitor
            // grande jogaria o status a meio metro do nome.
            display: "flex", flexDirection: "column", gap: 0, maxWidth: 1100,
            border: "1px solid var(--border)", borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {items.map((p, i) => (
            <LinhaDeProjeto key={p.id} p={p} primeira={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Uma faixa da lista de projetos.
 *
 * ⚠️⚠️ VIROU COMPONENTE em 10/09 pelo CONTORNO: a faixa era um
 * `<a className="tappable">` dentro do `.map()`, e o anel duro do
 * `.tappable:hover` saiu do CSS global -- *"da para identificar e mudar
 * absolutamente todos para ficar com a animacao igual dos subtimes?"*. Gancho
 * nao se chama dentro de um `map`, entao a faixa passou a ter nome.
 *
 * ⚠️ `radius` 0: a faixa NAO tem raio proprio -- o raio de 12 mora no
 * contêiner, e as faixas se dividem por borda. Passar 12 aqui desenharia o
 * traco arredondado no meio de uma lista de cantos retos.
 */
function LinhaDeProjeto({ p, primeira }: { p: Project; primeira: boolean }) {
  const { target, outline } = useDrawnOutline();
  return (
            <a
              href={`/projetos/${p.id}`}
              {...target}
              style={{
                // ⚠️ `relative` e o que faz o contorno medir ESTA faixa.
                position: "relative",
                cursor: "pointer",
                background: "var(--surface)", textDecoration: "none", color: "inherit",
                // A borda de cima faz a divisória entre linhas; a primeira não
                // tem, senão dobraria com a borda do container.
                borderTop: primeira ? "none" : "1px solid var(--border)",
                // ⚠️ ALTURA MÍNIMA, e não só padding maior: sem ela a linha
                // encolhe de volta quando não há descrição, e a lista fica com
                // faixas de alturas diferentes -- que é justamente o que sair
                // da grade veio consertar.
                minHeight: 56, padding: "14px 20px",
                display: "flex", alignItems: "center", gap: 12,
                opacity: p.is_archived ? 0.6 : 1,
              }}
            >
              {outline}
              <span
                aria-hidden
                style={{
                  width: 10, height: 10, borderRadius: 999, flexShrink: 0,
                  background: STATUS_COLOR[p.status] || "#999",
                }}
              />
              {/* ⚠️ `minWidth: 0` no que encolhe: sem ele, um nome longo
                  empurra o status para fora da linha em vez de truncar. Mesma
                  armadilha do título do card, registrada no `web/AGENTS.md`. */}
              <span
                style={{
                  fontSize: 15, fontWeight: 600, minWidth: 0,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
              >
                {p.title}
              </span>
              {p.description && p.description.trim().length > 0 && (
                <span
                  className="muted"
                  title={p.description}
                  style={{
                    fontSize: 13, minWidth: 0, flex: 1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                >
                  {p.description}
                </span>
              )}
              {/* O status vai para a DIREITA e é o que a Camila nomeou junto do
                  título como o conteúdo da faixa. `marginLeft: auto` só quando
                  não há descrição ocupando o meio. */}
              <span
                className="muted"
                style={{
                  fontSize: 12.5, flexShrink: 0,
                  marginLeft: p.description?.trim() ? undefined : "auto",
                }}
              >
                {STATUS_LABEL[p.status] || p.status}
                {p.is_archived && " · arquivado"}
              </span>
            </a>
  );
}
