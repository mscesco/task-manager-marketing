"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import AppShell from "@/components/AppShell";
import Board from "@/components/Board";
import Card from "@/components/Card";
import SobreOProjeto from "@/components/SobreOProjeto";
import EditorDeLinks from "@/components/EditorDeLinks";
import LinksDoItem from "@/components/LinksDoItem";
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
  linksMudaram,
  MAX_LINKS,
  paraEnvio,
  passaDoTeto,
  rascunhoDe,
  temErro,
} from "@/lib/links";
import { PRIORITY_LABEL } from "@/lib/status";

import Loading from "@/components/Loading";
import { withTeam } from "@/lib/activeTeam";
// Status de PROJETO (proprio; difere do status de TASK em lib/status).
// Duplicado de app/projetos/page.tsx de proposito, para manter esta
// entrega em UM arquivo. Divida cosmetica: extrair para lib se desejado.
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
const PRIORITY_KEYS = ["LOW", "MEDIUM", "HIGH", "URGENT"];

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
  const [erro, setErro] = useState<string | null>(null);
  const router = useRouter();
  const [excluindo, setExcluindo] = useState(false);
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  // Spec 052, fatia B. `[]` até chegar: falhar em buscar os links não pode
  // derrubar a página do projeto -- ela continua útil sem eles.
  const [links, setLinks] = useState<LinkItem[]>([]);

  useEffect(() => {
    getProject(id)
      .then(setProject)
      .catch((e: ApiError) =>
        setErro(e.status === 404 ? "Projeto não encontrado." : e.message)
      );
    getProjectLinks(id)
      .then(setLinks)
      .catch(() => {});
  }, [id]);

  if (erro) return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  if (!project) return <Loading />;

  // ⚠️⚠️ Spec 051, fatia A: OS BOTÕES VÊM DO PROJETO, e não de `me.permissions`.
  // Até aqui a tela perguntava `project.update`/`project.delete` "em algum
  // lugar" -- e quem é gerente no Marketing e operador no Comercial via Editar
  // e Excluir num projeto do Comercial, que o servidor recusa. O servidor
  // calcula as duas no time do projeto, pela mesma pergunta da escrita.
  // ⚠️ E continuam SEPARADOS (bug de 22/08, "não dá pra excluir projeto"):
  // quem pode editar não necessariamente pode apagar.
  const editavel = project.can_update;
  const excluivel = project.can_delete;

  // ⚠⚠ O VOLTAR LEVA O TIME DO PROJETO (14/09, mesmo defeito do menu: com o
  // Comercial ativo, voltar abria os projetos do Marketing). Esta rota não tem
  // `?time=`, então o "time ativo" aqui seria a RESERVA -- quem sabe o time
  // certo é o próprio projeto. Se ele for de subtime, `activeTeam` sobe até a
  // raiz na chegada.
  const listaDoTime = project.team_id
    ? withTeam("/projetos", "", project.team_id)
    : "/projetos";

  async function excluir() {
    // ⚠️ O AVISO DIZ O QUE ACONTECE COM AS TAREFAS, e isso não é zelo: o
    // soft delete marca `deleted_at` no PROJETO e não toca nelas. Elas
    // continuam existindo e apenas perdem a tag na tela -- quem lê "excluir
    // projeto" costuma imaginar o contrário, e a diferença é grande.
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
      // ⚠️ `replace`, e não `push`: a página do projeto apagado não pode
      // sobrar no histórico -- o "voltar" cairia num 404.
      // ⚠️ VOLTA PARA A LISTA DO TIME DO PROJETO (14/09). O caminho puro
      // apagava o time e a lista caía na reserva.
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

  // ⚠️ A META VIRA UMA LINHA DISCRETA (decisão da Camila, 22/08). Ela morava
  // num bloco próprio com bolinha grande, título e descrição em parágrafo --
  // e o `Quadro Projeto.png` tem UMA linha. A escolha foi "vira uma linha
  // discreta abaixo": o desenho é respeitado e nenhum dado some da tela.
  //
  // ⚠️⚠️ A DESCRIÇÃO SAIU DESTA LINHA (Spec 052, fatia A). Ela ficava aqui
  // cortada em uma linha com reticências -- e com uma descrição longa não se
  // lia nada. Agora é o bloco "Sobre o projeto", logo abaixo, com o começo à
  // vista e "Ver mais". A linha discreta de 22/08 continua sendo a META.
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
            background: STATUS_COLOR[project.status] || "#999",
          }}
        />
        {STATUS_LABEL[project.status] || project.status}
      </span>
      <span>Prioridade: {PRIORITY_LABEL[project.priority] || project.priority}</span>
      {project.start_date && <span>Início: {dataBR(project.start_date)}</span>}
      {project.due_date && <span>Prazo: {dataBR(project.due_date)}</span>}
      {project.is_archived && <span>· arquivado</span>}
      {/* Spec 052, fatia B: os links do projeto, só com o nome, na mesma linha
          da meta -- é a primeira coisa que as pessoas abrem. */}
      <LinksDoItem links={links} rotulo="Links do projeto" />
    </div>
  );

  return (
    <div>
      {/* ⚠️ EU APAGUEI ESTE LINK AO REFAZER O CABEÇALHO, e a Camila pegou na
          tela no mesmo dia: "você tirou o 'voltar' da tela quando abre um
          projeto né". Foi regressão, não decisão -- ele morava no bloco de
          cabeçalho que a página deixou de desenhar, e saiu junto sem que eu
          percebesse.

          ⚠️ FICA ACIMA DO CABEÇALHO, e não dentro dele: "voltar" é sobre a
          NAVEGAÇÃO (de onde vim), e o cabeçalho é sobre o CONTEÚDO (o que
          estou vendo). Enfiá-lo entre o título e o contador misturaria as duas
          coisas -- é a mesma separação que o `acoesDoTitulo` respeita do outro
          lado. */}
      <a
        href={listaDoTime}
        className="muted"
        style={{ fontSize: 13, display: "inline-block", marginBottom: 10 }}
      >
        ‹ Projetos
      </a>

      {/* ⚠️ O NOME DO PROJETO APARECIA DUAS VEZES, e foi isso que o print da
          Camila mostrou. Esta página desenhava o próprio cabeçalho (bolinha +
          h1 de 19px + meta + descrição) e logo abaixo passava
          `title={project.title}` para o `Board`, que desenha o título DE NOVO,
          agora em 26px. O desenho tem uma linha só.

          Agora o cabeçalho é o do `Board`, e a página entrega a ele as duas
          peças que são do projeto: o lápis, junto do título, e a meta, abaixo.

          ⚠️ E NÃO HÁ LÁPIS DE COLUNAS AQUI -- nem antes havia. `podeEditarColunas`
          é `false` por omissão e esta página nunca o passou, o que já era a
          regra que a Camila confirmou em 22/08: "no quadro de projeto não é pra
          ser possível editar o quadro". Fica escrito para ninguém "corrigir" a
          ausência achando que é esquecimento. */}
      <Board
        podeEditarColunas={false}
        podeApagarColunas={false}
        acoesDoQuadro={null}
        projectId={id}
        title={project.title}
        acoesDoTitulo={
          editavel && !editando ? (
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
          ) : undefined
        }
        abaixoDoCabecalho={
          <div style={{ maxWidth: 860 }}>
            {erroExcluir && (
              <div className="error-box" style={{ marginBottom: 12 }} role="alert">
                {erroExcluir}
              </div>
            )}
            {editavel && editando ? (
              <EditPanel
                project={project}
                excluivel={excluivel}
                excluindo={excluindo}
                onExcluir={excluir}
                onCancel={() => setEditando(false)}
                links={links}
                onSaved={(p, salvos) => {
                  setProject(p);
                  setLinks(salvos);
                  setEditando(false);
                }}
              />
            ) : (
              <>
                {metaDoProjeto}
                {/* Sem descrição, sem bloco -- nada de "Sem descrição" ocupando
                    espaço acima do quadro. */}
                {project.description && project.description.trim().length > 0 && (
                  <SobreOProjeto texto={project.description} />
                )}
              </>
            )}
          </div>
        }
      />
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
}: {
  project: Project;
  /**
   * ⚠️ O EXCLUIR MORA AQUI DENTRO desde 22/08, por decisão da Camila: "só tem
   * um lápis de edição, que é pra editar o projeto e ali dentro já deixa o
   * excluir". Antes era um botão vermelho no cabeçalho, ao lado de "Editar" --
   * uma ação irreversível a um clique de distância, no meio da navegação.
   * Dentro do painel ela exige abrir a edição primeiro, e fica ao lado das
   * outras decisões sobre o projeto.
   */
  excluivel: boolean;
  excluindo: boolean;
  onExcluir: () => void;
  onCancel: () => void;
  onSaved: (p: Project, links: LinkItem[]) => void;
  /** Os links salvos -- o ponto de partida do editor. */
  links: LinkItem[];
}) {
  const [title, setTitle] = useState(project.title);
  // Spec 052, fatia B: os links entram no MESMO formulário e salvam no mesmo
  // botão. Só vai ao servidor se a lista mudou (`linksMudaram`).
  const [rascunhoLinks, setRascunhoLinks] = useState(() => rascunhoDe(links));
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [description, setDescription] = useState(project.description ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [priority, setPriority] = useState<string>(project.priority || "MEDIUM");
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
    if (temErro(errosDosLinks(rascunhoLinks))) {
      setErroForm("Confira os links marcados.");
      return;
    }
    if (passaDoTeto(rascunhoLinks)) {
      setErroForm(`No máximo ${MAX_LINKS} links.`);
      return;
    }
    setSalvando(true);
    setErroForm(null);
    try {
      // Datas: o PATCH do backend nao LIMPA (None = "nao mexer"). Por isso
      // so enviamos a data quando ha valor; campo esvaziado e OMITIDO e a
      // data atual permanece. Remover data exigiria backend -- fora daqui.
      const patch: ProjectUpdateInput = {
        title: t,
        description,
        status,
        priority,
        ...(startDate ? { start_date: startDate } : {}),
        ...(dueDate ? { due_date: dueDate } : {}),
      };
      const atualizado = await updateProject(project.id, patch);
      // ⚠️ DEPOIS do projeto, e só se mudou. Se o PUT dos links falhar, o
      // projeto já foi salvo: o erro aparece e o painel continua aberto com o
      // rascunho, para tentar de novo sem redigitar.
      const salvos = linksMudaram(links, rascunhoLinks)
        ? await putProjectLinks(project.id, paraEnvio(rascunhoLinks))
        : links;
      onSaved(atualizado, salvos);
    } catch (e) {
      setErroForm((e as ApiError).message || "Não consegui salvar o projeto.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className="mb-[18px] flex flex-col gap-3">
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
        <span className="label">Descrição</span>
        <textarea
          className="input"
          value={description}
          rows={3}
          disabled={salvando}
          style={{ resize: "vertical" }}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="field">
        <span className="label">Links</span>
        <EditorDeLinks
          valor={rascunhoLinks}
          onChange={setRascunhoLinks}
          desabilitado={salvando}
          mostrarErros={tentouSalvar}
        />
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
          <span className="label">Prioridade</span>
          <select
            className="input"
            value={priority}
            disabled={salvando}
            onChange={(e) => setPriority(e.target.value)}
          >
            {PRIORITY_KEYS.map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p] || p}</option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
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
      <span className="muted" style={{ fontSize: 12 }}>
        Datas só podem ser alteradas, não removidas (limitação atual do backend).
      </span>
      {erroForm && <div className="error-box">{erroForm}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* ⚠️ NA PONTA ESQUERDA, LONGE DO "Salvar". Destrutivo encostado no
            botão que a pessoa vai clicar é como se erra por milímetro -- o
            `marginRight: auto` empurra o par Cancelar/Salvar para a direita e
            deixa um vão entre eles. */}
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
          onClick={onCancel}
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
    </Card>
  );
}
