"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { Columns3, LayoutDashboard, Pencil, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import Board from "@/components/Board";
import CaixaDeDialogo from "@/components/CaixaDeDialogo";
import { useAvisar } from "@/components/Toasts";
import PageHeader from "@/components/PageHeader";
import ResumoDoProjeto from "@/components/ResumoDoProjeto";
import { useActiveTeam } from "@/lib/useActiveTeam";
import SobreOProjeto from "@/components/SobreOProjeto";
import EditorDeDescricao from "@/components/EditorDeDescricaoAdiado";
import EditorDeLinks from "@/components/EditorDeLinks";
import LinksDoItem from "@/components/LinksDoItem";
import CampoDeRotulos, { SeloDeRotulo } from "@/components/CampoDeRotulos";
import {
  getProject,
  getProjectLinks,
  putProjectLinks,
  updateProject,
  deleteProject,
  ApiError,
  type LinkItem,
  type Project,
  type ProjectStatus,
  type ProjectUpdateInput,
} from "@/lib/api";
import {
  errosDosLinks,
  linksParaEnviar,
  MAX_LINKS,
  passaDoTeto,
  rascunhoDe,
  temErro,
  type RascunhoLink,
} from "@/lib/links";
import {
  PROJECT_STATUS,
  PROJECT_STATUS_COLOR,
  PROJECT_STATUS_LABEL,
} from "@/lib/status";

import Loading from "@/components/Loading";
import { withTeam } from "@/lib/activeTeam";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

// YYYY-MM-DD -> DD/MM/YYYY sem passar por Date (evita o parse UTC que
// erra o dia em UTC-3). String pura, zero timezone.
function dataBR(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

export default function ProjetoPage() {
  return (
    <AppShell>
      <Projeto />
    </AppShell>
  );
}

function Projeto() {
  const params = useParams();
  const id = String(params.id);
  const [project, setProject] = useState<Project | null>(null);
  useDocumentTitle(project?.title);
  const [erro, setErro] = useState<string | null>(null);
  const router = useRouter();
  const [excluindo, setExcluindo] = useState(false);
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  // Falhar em buscar os links não derruba a página. `null` = ainda não sei, e
  // não "sem links": com `[]`, salvar cedo apagaria os links do projeto.
  const [links, setLinks] = useState<LinkItem[] | null>(null);
  const [falhouLinks, setFalhouLinks] = useState(false);
  // A página abre no resumo; o quadro fica a um clique. Sessão-only.
  const [vista, setVista] = useState<"resumo" | "quadro">("resumo");
  const { teams } = useActiveTeam();

  // A resposta só vale para o projeto que ainda está na tela.
  const idAtual = useRef(id);
  idAtual.current = id;
  function carregarLinks() {
    const alvo = id;
    setFalhouLinks(false);
    getProjectLinks(alvo)
      .then((l) => idAtual.current === alvo && setLinks(l))
      .catch(() => idAtual.current === alvo && setFalhouLinks(true));
  }

  useEffect(() => {
    getProject(id)
      .then(setProject)
      .catch((e: ApiError) =>
        setErro(e.status === 404 ? "Projeto não encontrado." : e.message)
      );
    setLinks(null);
    carregarLinks();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (erro) return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  if (!project) return <Loading />;

  // Os botões vêm do projeto (calculados pelo servidor no time dele), não de
  // `me.permissions`. Editar e apagar são separados.
  const editavel = project.can_update;
  const excluivel = project.can_delete;

  // O voltar leva o time do projeto: esta rota não tem `?time=`.
  const listaDoTime = project.team_id
    ? withTeam("/projetos", "", project.team_id)
    : "/projetos";

  async function excluir() {
    // O soft delete marca só o projeto: as tarefas continuam e perdem a tag.
    const ok = window.confirm(
      `Excluir o projeto “${project!.title}”?\n\n` +
        "As tarefas dele NÃO são apagadas: elas continuam no quadro e passam " +
        "a ficar sem projeto.",
    );
    if (!ok) return;
    setErroExcluir(null);
    setExcluindo(true);
    try {
      await deleteProject(project!.id);
      // `replace`: a página do projeto apagado não pode sobrar no histórico.
      // Volta para a lista do time do projeto.
      router.replace(listaDoTime);
    } catch (e) {
      const err = e as ApiError;
      setErroExcluir(
        err.status === 403
          ? "Você não pode excluir este projeto."
          : err.status === 409
            ? "Projeto pessoal não pode ser excluído."
            : err.message || "Não consegui excluir o projeto.",
      );
      setExcluindo(false);
    }
  }

  // A meta é uma linha discreta; a descrição fica no bloco "Sobre o projeto".
  const metaDoProjeto = (
    <div
      className="muted"
      style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        fontSize: 12.5, marginTop: -8, marginBottom: 16,
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span
          aria-hidden
          style={{
            width: 8, height: 8, borderRadius: 999, flexShrink: 0,
            background: PROJECT_STATUS_COLOR[project.status] || "var(--border)",
          }}
        />
        {PROJECT_STATUS_LABEL[project.status] || project.status}
      </span>
      {editavel && project.team_id ? (
        <RotulosNaMeta project={project} onSalvo={setProject} />
      ) : (
        <>
          {project.category && <SeloDeRotulo rotulo={project.category} />}
          {project.tags.map((t) => (
            <SeloDeRotulo key={t.id} rotulo={t} />
          ))}
        </>
      )}
      {project.start_date && <span>Início: {dataBR(project.start_date)}</span>}
      {project.due_date && <span>Prazo: {dataBR(project.due_date)}</span>}
      {/* Os links do projeto, só com o nome, na mesma linha da meta. */}
      <LinksDoItem links={links ?? []} rotulo="Links do projeto" />
    </div>
  );

  // O lápis e o que fica abaixo do cabeçalho são os mesmos nas duas vistas:
  // no resumo a página os desenha; no quadro, entrega ao `Board`.
  const lapis =
    editavel ? (
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setEditando(true)}
        aria-label="Editar projeto"
        title="Editar projeto"
        style={{ padding: 4, height: 28, lineHeight: 0 }}
      >
        <Pencil size={15} strokeWidth={2} aria-hidden />
      </button>
    ) : undefined;

  const abaixoDoCabecalho = (
    <div style={{ maxWidth: 860 }}>
      {erroExcluir && (
        <div className="error-box" style={{ marginBottom: 12 }} role="alert">
          {erroExcluir}
        </div>
      )}
      {metaDoProjeto}
      {/* Sem descrição, sem bloco. */}
      {project.description && project.description.trim().length > 0 && (
        <SobreOProjeto texto={project.description} />
      )}
      {editavel && editando && (
        <EditPanel
          project={project}
          excluivel={excluivel}
          excluindo={excluindo}
          onExcluir={excluir}
          onCancel={() => setEditando(false)}
          links={links}
          falhouLinks={falhouLinks}
          onRecarregarLinks={carregarLinks}
          onSaved={(p, salvos) => {
            setProject(p);
            setLinks(salvos);
            setEditando(false);
          }}
        />
      )}
    </div>
  );

  const alternarVista = (
    <button
      type="button"
      className="btn ml-auto"
      onClick={() => setVista((v) => (v === "resumo" ? "quadro" : "resumo"))}
    >
      {vista === "resumo" ? (
        <>
          <Columns3 size={15} aria-hidden /> Ver no quadro
        </>
      ) : (
        <>
          <LayoutDashboard size={15} aria-hidden /> Ver resumo
        </>
      )}
    </button>
  );

  return (
    <div>
      {/* O "voltar" fica acima do cabeçalho: é navegação, não conteúdo. */}
      <a
        href={listaDoTime}
        className="muted max-md:min-h-6"
        style={{ fontSize: 13, display: "inline-block", marginBottom: 10 }}
      >
        ‹ Projetos
      </a>

      {/* O cabeçalho é o do `Board`; a página entrega a ele o lápis e a meta.
          Sem lápis de colunas: o quadro de projeto não se edita. */}
      {vista === "resumo" ? (
        <>
          <PageHeader title={project.title} titleAddon={lapis} actions={alternarVista} />
          {abaixoDoCabecalho}
          <ResumoDoProjeto
            project={project}
            nomeDoTime={teams.find((t) => t.id === project.team_id)?.name}
          />
        </>
      ) : (
        <Board
          podeEditarColunas={false}
          podeApagarColunas={false}
          acoesDoQuadro={null}
          projectId={id}
          title={project.title}
          acoesDoTitulo={
            <>
              {lapis}
              {alternarVista}
            </>
          }
          abaixoDoCabecalho={abaixoDoCabecalho}
        />
      )}
    </div>
  );
}

function EditPanel({
  project,
  excluivel,
  excluindo,
  onExcluir,
  onCancel,
  onSaved,
  links,
  falhouLinks,
  onRecarregarLinks,
}: {
  project: Project;
  /** Painel de edição do projeto; o Excluir mora aqui dentro, não no cabeçalho. */
  excluivel: boolean;
  excluindo: boolean;
  onExcluir: () => void;
  onCancel: () => void;
  onSaved: (p: Project, links: LinkItem[] | null) => void;
  /** Os links salvos -- o ponto de partida do editor. `null` = ainda não chegaram. */
  links: LinkItem[] | null;
  /** A busca dos links falhou: o editor não aparece, e os links não são enviados. */
  falhouLinks: boolean;
  onRecarregarLinks: () => void;
}) {
  const [title, setTitle] = useState(project.title);
  // Os links salvam no mesmo botão, só se a lista mudou (`linksMudaram`). O
  // rascunho nasce da lista salva; `null` enquanto ela não chega.
  const [rascunhoLinks, setRascunhoLinks] = useState<RascunhoLink[] | null>(() =>
    links ? rascunhoDe(links) : null,
  );
  useEffect(() => {
    if (links && rascunhoLinks === null) setRascunhoLinks(rascunhoDe(links));
  }, [links, rascunhoLinks]);
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [description, setDescription] = useState(project.description ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [startDate, setStartDate] = useState(project.start_date ?? "");
  const [dueDate, setDueDate] = useState(project.due_date ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);

  async function salvar() {
    const t = title.trim();
    if (!t) {
      setErroForm("Título não pode ser vazio.");
      return;
    }
    setTentouSalvar(true);
    if (rascunhoLinks && temErro(errosDosLinks(rascunhoLinks))) {
      setErroForm("Confira os links marcados.");
      return;
    }
    if (rascunhoLinks && passaDoTeto(rascunhoLinks)) {
      setErroForm(`No máximo ${MAX_LINKS} links.`);
      return;
    }
    setSalvando(true);
    setErroForm(null);
    try {
      // O PATCH não limpa datas (None = "não mexer"): campo esvaziado é omitido.
      const patch: ProjectUpdateInput = {
        title: t,
        description,
        status,
        ...(startDate ? { start_date: startDate } : {}),
        ...(dueDate ? { due_date: dueDate } : {}),
      };
      const atualizado = await updateProject(project.id, patch);
      // Os links vão depois do projeto, e só se mudaram e a lista salva é
      // conhecida: sem ela, o rascunho substituiria links que a tela nunca viu.
      // Se o PUT falhar, o painel fica aberto com o rascunho.
      const envio = linksParaEnviar(links, rascunhoLinks);
      const salvos = envio ? await putProjectLinks(project.id, envio) : links;
      onSaved(atualizado, salvos);
    } catch (e) {
      setErroForm((e as ApiError).message || "Não consegui salvar o projeto.");
    } finally {
      setSalvando(false);
    }
  }

  // Fechar sem salvar pergunta antes de jogar fora o que foi digitado.
  const mudou =
    title !== project.title ||
    description !== (project.description ?? "") ||
    status !== project.status ||
    startDate !== (project.start_date ?? "") ||
    dueDate !== (project.due_date ?? "") ||
    linksParaEnviar(links, rascunhoLinks) !== null;
  function pedirFechar() {
    if (salvando) return;
    if (mudou && !window.confirm("Descartar as alterações do projeto?")) return;
    onCancel();
  }

  // Ao fechar, o foco volta para quem abriu (o lápis). Lido na renderização:
  // num efeito já seria o Título, que o `autoFocus` focou antes.
  const [quemAbriu] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => () => quemAbriu?.focus?.(), [quemAbriu]);

  const caixaRef = useRef<HTMLDivElement>(null);
  // O Tab circula dentro da caixa: sem isto, ele sai para a página escurecida atrás.
  function prenderTab(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !caixaRef.current) return;
    const focaveis = caixaRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
    );
    if (!focaveis.length) return;
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primeiro.focus();
    }
  }

  return (
    <CaixaDeDialogo
      ariaLabel="Editar projeto"
      largura={640}
      caixaRef={caixaRef}
      acimaDeModal={false}
      onEsc={pedirFechar}
      onFundo={pedirFechar}
    >
    <div className="flex flex-col gap-3" onKeyDown={prenderTab}>
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-lg font-bold">Editar projeto</h2>
        <button
          type="button"
          className="btn btn-ghost"
          aria-label="Fechar"
          onClick={pedirFechar}
          style={{ padding: 4, height: 28, lineHeight: 0 }}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="field">
        <span className="label">Título</span>
        <input
          className="input"
          value={title}
          maxLength={255}
          disabled={salvando}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="field">
        <span className="label" id="projeto-descricao-rotulo">Descrição</span>
        {/* O editor que já mostra formatado. */}
        <EditorDeDescricao
          rotuloId="projeto-descricao-rotulo"
          valor={description}
          onChange={setDescription}
          rows={5}
          desabilitado={salvando}
        />
      </div>
      <div className="field">
        <span className="label">Links</span>
        {rascunhoLinks ? (
          <EditorDeLinks
            valor={rascunhoLinks}
            onChange={setRascunhoLinks}
            desabilitado={salvando}
            mostrarErros={tentouSalvar}
          />
        ) : falhouLinks ? (
          <p className="text-xs text-danger" role="alert">
            Não consegui carregar os links -- eles não serão alterados ao salvar.{" "}
            <button type="button" className="font-semibold underline" onClick={onRecarregarLinks}>
              Tentar de novo
            </button>
          </p>
        ) : (
          <p className="muted text-xs">Carregando links…</p>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
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
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <span className="label">Início</span>
          <input
            className="input"
            type="date"
            value={startDate}
            disabled={salvando}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <span className="label">Prazo</span>
          <input
            className="input"
            type="date"
            value={dueDate}
            disabled={salvando}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
      </div>
      <span className="muted -mt-1 text-xs">
        Início e prazo podem ser trocados, mas ainda não apagados.
      </span>
      {erroForm && <div className="error-box">{erroForm}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Excluir na ponta esquerda, longe do "Salvar" (`marginRight: auto`). */}
        {excluivel && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onExcluir}
            disabled={salvando || excluindo}
            style={{ color: "var(--danger)", marginRight: "auto" }}
          >
            {excluindo ? "Excluindo…" : "Excluir projeto"}
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          disabled={salvando}
          onClick={pedirFechar}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={salvando || !title.trim()}
          onClick={salvar}
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
    </CaixaDeDialogo>
  );
}

/** Categoria e tags na linha de meta: quem edita o projeto troca ali mesmo, e salva ao escolher. */
function RotulosNaMeta({
  project,
  onSalvo,
}: {
  project: Project;
  onSalvo: (p: Project) => void;
}) {
  const avisar = useAvisar();
  const [salvando, setSalvando] = useState(false);
  async function salvar(patch: ProjectUpdateInput) {
    setSalvando(true);
    try {
      onSalvo(await updateProject(project.id, patch));
    } catch (e) {
      avisar((e as ApiError).message || "Não consegui salvar.");
    } finally {
      setSalvando(false);
    }
  }
  return (
    <>
      <CampoDeRotulos
        kind="categories"
        titulo="Categoria"
        teamId={project.team_id!}
        valor={project.category ? [project.category] : []}
        onChange={(v) => salvar({ category_id: v[0]?.id ?? null })}
        desabilitado={salvando}
      />
      <CampoDeRotulos
        kind="tags"
        titulo="Tags"
        teamId={project.team_id!}
        valor={project.tags}
        onChange={(v) => salvar({ tag_ids: v.map((t) => t.id) })}
        desabilitado={salvando}
      />
    </>
  );
}
