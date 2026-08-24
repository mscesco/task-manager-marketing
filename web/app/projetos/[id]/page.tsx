"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import AppShell from "@/components/AppShell";
import Board from "@/components/Board";
import Card from "@/components/Card";
import {
  getProject,
  updateProject,
  deleteProject,
  currentUser,
  ApiError,
  type Project,
  type ProjectStatus,
  type ProjectUpdateInput,
} from "@/lib/api";
import { PRIORITY_LABEL } from "@/lib/status";

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
  const [podeEditar, setPodeEditar] = useState(false);
  // Bug relatado em 22/08: "não dá pra excluir projeto". A rota existia; a
  // tela não. ⚠️ PERMISSÃO PRÓPRIA -- `project.delete` não vem junto com
  // `project.update`, e quem pode editar não necessariamente pode apagar.
  const [podeExcluir, setPodeExcluir] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);

  useEffect(() => {
    getProject(id)
      .then(setProject)
      .catch((e: ApiError) =>
        setErro(e.status === 404 ? "Projeto não encontrado." : e.message)
      );
  }, [id]);

  useEffect(() => {
    currentUser()
      .then((me) => {
        setPodeEditar(me.permissions.includes("project.update"));
        setPodeExcluir(me.permissions.includes("project.delete"));
      })
      .catch(() => {
        setPodeEditar(false);
        setPodeExcluir(false);
      });
  }, []);

  if (erro) return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  if (!project) return <div className="muted">Carregando…</div>;

  // Pessoal nunca edita por aqui (backend devolve 409). A lista ja filtra
  // pessoal; guardamos defensivamente tambem na detalhe.
  const editavel = podeEditar && !project.is_personal;
  // ⚠️ PESSOAL NUNCA, e o backend também recusa (409). A trava dupla é de
  // propósito: sem ela a tela ofereceria um botão que sempre falha.
  const excluivel = podeExcluir && !project.is_personal;

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
      router.replace("/projetos");
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
  // ⚠️ A DESCRIÇÃO FICA, TRUNCADA EM UMA LINHA. "Linha discreta" não cabe um
  // parágrafo, mas apagar a descrição da tela seria decidir mais do que foi
  // pedido -- ela vira uma linha com reticências, e o texto inteiro segue no
  // painel de edição.
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
      {project.description && project.description.trim().length > 0 && (
        <span
          title={project.description}
          style={{
            maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          · {project.description}
        </span>
      )}
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
        href="/projetos"
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
                onSaved={(p) => {
                  setProject(p);
                  setEditando(false);
                }}
              />
            ) : (
              metaDoProjeto
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
  onSaved: (p: Project) => void;
}) {
  const [title, setTitle] = useState(project.title);
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
      onSaved(atualizado);
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
