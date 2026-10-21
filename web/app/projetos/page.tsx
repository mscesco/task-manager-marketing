"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import Card from "@/components/Card";
import PageHeader from "@/components/PageHeader";
import { Esqueleto } from "@/components/Loading";
import Entrada from "@/components/Entrada";
import { useActiveTeam, useActiveTeamId } from "@/lib/useActiveTeam";
import { CalendarClock, Plus } from "lucide-react";
import { dataParaTela } from "@/lib/baseTable";
import { diaNoWorkspace } from "@/lib/prazo";
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
import { semMarcacao } from "@/lib/markdown";

import { PROJECT_STATUS, PROJECT_STATUS_COLOR, PROJECT_STATUS_LABEL } from "@/lib/status";

// Projeto e "pasta" -- tudo no time raiz, todos veem. Designar e so nas tasks.

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

  // ⚠⚠ O TIME ATIVO VEM DA BARRA (fatia C), e nao de um `useSearchParams`
  // aqui: esta rota e ESTATICA (`○ /projetos` no build) e o hook derrubaria o
  // portao. Quem le a query e o `TeamParamReader`, atras da unica fronteira de
  // `Suspense` do produto. Ver `lib/useActiveTeam.tsx`.
  const timeAtivo = useActiveTeamId();
  // ⚠⚠ `active === null` ("a barra ainda não resolveu") e `kind: "none"` ("ela
  // resolveu, e não há time") são COISAS DIFERENTES. `listTeamsAll()` falha em
  // silêncio no `AppShell`: sem a distinção, uma falha de rede ali deixaria esta
  // tela em `Loading` para sempre, sem erro nenhum.
  // ⚠️ O NOME VEM DA BARRA (`teamName`), e não de `areas`. As duas respostas
  // coincidem quando a lista de áreas já chegou -- mas `areas` é buscada POR
  // ESTA TELA e só contém as raizes que a pessoa alcança, enquanto o `teamName`
  // sai da mesma árvore que resolveu o time ativo. Uma fonte, e não duas que
  // podem divergir.
  const { active, teamName: nomeDoTime } = useActiveTeam();

  useEffect(() => {
    // ⚠⚠ ESPERA A BARRA RESOLVER, em vez de buscar sem recorte. Buscar antes
    // mostraria os projetos de todos os times por um instante -- o defeito que
    // a spec veio matar, piscando.
    if (active === null) return;
    listProjects({ size: 100, teamId: timeAtivo })
      .then((r) => setItems(r.items))
      .catch((e: ApiError) => setErro(e.message));
    // ⚠️ `timeAtivo` NAS DEPENDENCIAS: trocar de time reescreve a query e esta
    // tela tem de rebuscar. Sem isso o seletor mudaria a URL e a lista ficaria a
    // mesma -- pior que nao recortar, porque a tela passaria a mentir.
    // ⚠️ `active === null` E NÃO `active`: o objeto é NOVO a cada render da
    // barra, e depender dele refazia o pedido a cada render -- vários pedidos
    // em voo, e o último a responder vencia (defeito de 14/09).
  }, [timeAtivo, active === null]);

  useEffect(() => {
    // ⚠️ As duas juntas porque `rootsForPerson` precisa das DUAS: a árvore e os
    // vínculos de quem está olhando. Um operador do Marketing não escolhe TI.
    Promise.all([currentUser(), listTeamsAll()])
      .then(([me, times]) => {
        // ⚠️⚠️ Spec 051, fatia A: SÓ AS ÁREAS EM QUE ELA CRIA, e não todas as
        // que alcança. Quem é gerente no Marketing e operador no Comercial
        // alcança as duas, e cria só no Marketing -- o seletor ofereceria o
        // Comercial e o POST daria 403. Quem sabe "onde" é o servidor
        // (`can_create_project`); `me.permissions` só diz "o que".
        const minhas = rootsForPerson(
          times,
          me,
          (me.org_role ?? null) !== null,
        ).filter((t) => t.can_create_project === true);
        setPodeCriar(minhas.length > 0);
        setAreas(minhas);
        // ⚠️ COM UMA ÁREA SÓ, NÃO HÁ PERGUNTA: pré-seleciona e o campo nem
        // aparece. É o cadastro da maioria, e um seletor de um item é ruído.
        if (minhas.length === 1) setAreaId(minhas[0].id);
      })
      .catch(() => {});
  }, []);

  // ⚠⚠ O TIME ATIVO PREENCHE O CAMPO (14/09). O bloco de `areaId` no topo já
  // tinha escrito a decisão, antes de haver time ativo: *"quando a área
  // ambiente existir, este seletor deixa de ser pergunta e passa a ser
  // confirmação do lugar onde a pessoa já está. O campo continua; muda quem o
  // preenche."* Até aqui ele só se preenchia com UMA área -- com duas ficava
  // vazio, e a tela ignorava que a pessoa estava no Comercial.
  //
  // ⚠️ NÃO É O CHUTE QUE O BLOCO DO `<select>` PROÍBE. Aquele aviso é contra
  // pré-selecionar "a primeira área" por acaso. O time ativo não é acaso: é
  // onde ela está, e o nome dele está no cabeçalho.
  //
  // ⚠️ `atual || timeAtivo`, e não `setAreaId(timeAtivo)`: o efeito roda de novo
  // quando o time muda, e sobrescrever apagaria a escolha já feita no
  // formulário aberto. Mesmo desenho do `/formularios`.
  useEffect(() => {
    if (!timeAtivo) return;
    setAreaId((atual) => atual || timeAtivo);
  }, [timeAtivo]);

  async function criar() {
    const t = titulo.trim();
    if (!t || !areaId) return;
    setSalvando(true);
    setErroForm(null);
    try {
      const novo = await createProject({ title: t, status, team_id: areaId });
      // ⚠️ SÓ ENTRA NA LISTA SE FOR DO TIME MOSTRADO (14/09). A lista é recortada
      // pelo time ativo; um projeto criado para OUTRO time apareceria aqui até
      // recarregar -- dizendo "em Comercial" sobre um projeto do Marketing.
      // `areaId` é sempre uma raiz (`rootsForPerson`), então a igualdade basta.
      if (timeAtivo === null || areaId === timeAtivo) {
        setItems((prev) => [novo, ...(prev ?? [])]);
      }
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
  if (!items) return <Esqueleto forma="linhas" rotulo="Carregando projetos" />;

  return (
    <div>
      <PageHeader
        title="Projetos"
        /* ⚠⚠ O NOME DO TIME ENTRA NA CONTAGEM (fatia C), e isso não é
           enfeite: a lista agora é RECORTADA, e uma lista recortada que não
           diz pelo quê parece a lista inteira. A §7 da spec nomeia esse risco
           para a fila de solicitações -- *"a tela precisa dizer 'a fila do
           Marketing está vazia', e não mostrar um vazio sem contexto"* -- e ele
           é o mesmo aqui. Sem o nome do time, quem trocou de contexto e não
           encontra um projeto conclui que ele foi apagado. */
        count={
          nomeDoTime
            ? `${items.length} projetos em ${nomeDoTime}`
            : `${items.length} projetos`
        }
        actions={
          podeCriar && !criando && (
            <button type="button" className="btn btn-primary ml-auto" onClick={() => setCriando(true)}>
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
              {/* ⚠️ O `aria-label` É O NOME DO CAMPO para leitor de tela (14/09): o
                  "Time" acima é um `<span>` sem ligação com o `<select>`, e o campo
                  era anunciado só como "caixa de seleção". É também por esse nome
                  que o teste o acha. */}
              <select
                className="input"
                aria-label="Time do projeto"
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
          title={
            nomeDoTime ? `Nenhum projeto em ${nomeDoTime}` : "Nenhum projeto ainda"
          }
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
        /* Redesign (fatia 7): grade de cards com o filete do status no topo,
           como a prancha. As faixas de 22/08 saem; o que elas carregavam (nome,
           resumo e status) continua, agora com o prazo e a data da última
           mudança. ⚠️ Sem barra de progresso nem avatares: a lista de projetos
           não traz contagem de tarefas nem responsáveis -- é backend. */
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          <Entrada>
            {items.map((p) => (
              <CartaoDeProjeto key={p.id} p={p} />
            ))}
          </Entrada>
          {podeCriar && !criando && (
            <button
              type="button"
              onClick={() => setCriando(true)}
              className="flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-border bg-transparent text-sm font-semibold text-ink-faint transition-colors duration-200 hover:border-accent hover:bg-accent-soft hover:text-accent"
            >
              <Plus size={22} aria-hidden />
              Novo projeto
            </button>
          )}
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
/** Um card da grade de projetos (redesign, fatia 7). */
function CartaoDeProjeto({ p }: { p: Project }) {
  const resumo = p.description?.trim() ? semMarcacao(p.description) : "";
  return (
    <a
      href={`/projetos/${p.id}`}
      className="flex min-h-[150px] flex-col gap-3 rounded-xl border border-border bg-surface p-[18px] text-ink no-underline transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--glow)]"
      // So a COR do filete e inline: ela vem do status (web/AGENTS.md §11).
      style={{ borderTop: `3px solid ${PROJECT_STATUS_COLOR[p.status] || "var(--border)"}` }}
    >
      <span className="flex items-start gap-2.5">
        {/* `min-w-0` + truncagem: nome longo nao empurra o selo para fora. */}
        <strong className="min-w-0 flex-1 text-md font-bold leading-snug [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
          {p.title}
        </strong>
        <Badge tone="soft" size="sm" color={PROJECT_STATUS_COLOR[p.status]} className="shrink-0">
          {PROJECT_STATUS_LABEL[p.status] || p.status}
        </Badge>
      </span>
      {/* Spec 052, fatia C: o resumo sai SEM a marcação -- `**` e `##` numa
          linha cortada parecem defeito. */}
      {resumo && (
        <span
          className="muted text-sm leading-snug [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden"
          title={resumo}
        >
          {resumo}
        </span>
      )}
      <span className="mt-auto flex items-center gap-3 text-xs text-ink-faint">
        {p.due_date && (
          <span className="inline-flex items-center gap-1">
            <CalendarClock size={12} aria-hidden />
            até {dataParaTela(p.due_date)}
          </span>
        )}
        <span className="ml-auto">atualizado em {dataParaTela(diaNoWorkspace(p.updated_at))}</span>
      </span>
    </a>
  );
}
