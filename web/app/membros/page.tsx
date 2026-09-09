"use client";
import { useEffect, useState } from "react";
import {
  alcanceDe,
  podeGerenciarAlgo,
  podeCadastrarMembro,
  temAcaoPossivel,
  podeResetarSenha,
  podeDesativarConta,
  podeTrocarPapel,
  podeMoverSubtime,
  podeAdicionarAoTime,
  podeRemoverDoTime,
  avisoDeRebaixamento,
  papeisAtribuiveis,
  timesParaAdicionar as timesPermitidos,
  candidatosParaAdicionar,
  type Alcance,
} from "@/lib/permissoesMembros";
import AppShell from "@/components/AppShell";
import BloqueioAlcance from "@/components/BloqueioAlcance";
import EmptyState from "@/components/EmptyState";
import Badge from "@/components/Badge";
import Avatar from "@/components/Avatar";
import Card from "@/components/Card";
import PageHeader from "@/components/PageHeader";
import TabelaDeMembros from "@/components/TabelaDeMembros";
import { linhasDaOrganizacao } from "@/lib/telaDoTime";
import { casaComBusca } from "@/lib/organizacao";
import { Search } from "lucide-react";
import {
  listMembers,
  listTeamsAll,
  createMember,
  resetMemberPassword,
  deactivateMember,
  listMemberTeams,
  changeMemberRole,
  removeMemberFromTeam,
  moveMemberSubteam,
  assignMemberToTeam,
  currentUser,
  ApiError,
  type Member,
  type Team,
  type MemberRole,
  type MemberTeam,
  type CurrentUser,
} from "@/lib/api";
import { bloqueioDeAlcance, type ErroDeLinha } from "@/lib/erroAlcance";

// Membros: lista + cadastro (4a) + resetar senha / desativar (4b), gated por
// team.manage. Reset e cadastro compartilham o reveal-once da senha (ADR 0008).
const PAPEL_LABEL: Record<MemberRole, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gerente",
  SUPERVISOR: "Supervisor",
  OPERATOR: "Operador",
};
// ⚠️ AQUI MORAVA `PAPEIS = ["OPERATOR","SUPERVISOR","MANAGER","ADMIN"]`, a
// lista dos quatro papeis de time. Ela ficou sem uso na Spec 045 (fatia D):
// nao existe mais lugar que aceite os quatro, entao "todos os papeis" deixou
// de ser uma pergunta com resposta. Quem quer a lista pergunta
// `papeisAtribuiveis(alcance, souAdmin, ehRaiz)` -- que responde POR NIVEL.
// Nao recrie: uma lista fixa aqui e exatamente o que oferecia ADMIN.

type Revelado = { titulo: string; email: string; senha: string };

export default function MembrosPage() {
  return (
    <AppShell>
      <Membros />
    </AppShell>
  );
}

function Membros() {
  const [membros, setMembros] = useState<Member[] | null>(null);
  const [times, setTimes] = useState<Team[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [me, setMe] = useState<CurrentUser | null>(null);

  // reveal-once compartilhado por cadastro e reset (ADR 0008).
  const [revelado, setRevelado] = useState<Revelado | null>(null);

  // cadastro
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [timeId, setTimeId] = useState("");
  const [papel, setPapel] = useState<MemberRole | "">("");
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  // A busca da organização (fatia E) e o aviso do que acabou de mudar.
  const [busca, setBusca] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  // Spec 028: o gate deixou de ser "tem team.manage?" e virou um ALCANCE.
  // A regra mora em lib/permissoesMembros (pura, testada); aqui so lemos.
  const alcance = alcanceDe(me);
  const podeGerenciar = podeGerenciarAlgo(alcance);
  const souAdmin = me?.roles.includes("ADMIN") ?? false;
  // ⚠️⚠️ AQUI HAVIA `PAPEIS` INTEIRO, filtrado so por "sou admin?" (gate D2 da
  // Spec 014). A Spec 045 (fatia D) tornou isso errado em tres opcoes: ADMIN
  // saiu do nivel de time, MANAGER nao cabe em subtime e SUPERVISOR nao cabe
  // na raiz -- e o `create_member` do backend recusa os tres com 409.
  //
  // ⚠️ E ESTE FORMULARIO ERA O PIOR LUGAR PARA ISSO SOBRAR: ele cadastra
  // gente. Escolher "Administrador", preencher nome e e-mail e so entao levar
  // um 409 e a versao mais cara possivel de descobrir a regra.
  //
  // Sem time escolhido nao ha nivel -- e o proprio `<select>` ja comeca em
  // "— selecione o time —", entao a lista vazia e o estado honesto.
  const papeisDisponiveis: MemberRole[] = timeId
    ? papeisAtribuiveis(
        alcance,
        souAdmin,
        times.find((t) => t.id === timeId)?.parent_team_id == null,
      )
    : [];

// Rotulo do time COM a hierarquia: se o time tem pai, mostra
  // "Pai › Filho" (ex.: "Marketing › CRM e Automacao"), deixando claro
  // que o subtime pertence ao time-pai. Time raiz mostra so o nome.
  // O parent_team_id ja vem do backend em cada Team; aqui so montamos o texto.
  // ⚠️ Recebe LISTA desde a Spec 044 (fatia 1): a pessoa pode estar em mais
  // de um subtime. Vazia => "—". Varios => separados por vírgula, na ordem que
  // o backend mandou (alfabetica por nome do time, cravada no `array_agg`).
  function nomeSubtimes(ids: string[]): string {
    const nomes = ids.map(nomeSubtime).filter((n) => n !== "—");
    return nomes.length > 0 ? nomes.join(", ") : "—";
  }

  function nomeSubtime(id: string | null): string {
    if (!id) return "—";
    const t = times.find((x) => x.id === id);
    if (!t) return "—";
    if (t.parent_team_id === null) return t.name;
    const pai = times.find((x) => x.id === t.parent_team_id);
    return pai ? `${pai.name} › ${t.name}` : t.name;
  }

  async function carregar() {
    try {
      const ms = await listMembers();
      setMembros([...ms].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
    } catch (e) {
      setErro((e as ApiError).message || "Não consegui carregar os membros.");
    }
  }

  useEffect(() => {
    carregar();
    listTeamsAll().then(setTimes).catch(() => {});
    currentUser().then(setMe).catch(() => {});
  }, []);

  function limparForm() {
    setNome("");
    setEmail("");
    setTimeId("");
    setPapel("");
    setErroForm(null);
  }

  async function cadastrar() {
    const n = nome.trim();
    const e = email.trim();
    if (!n || !e) {
      setErroForm("Nome e e-mail são obrigatórios.");
      return;
    }
    if (!timeId || !papel) {
      setErroForm("Escolha o time e o papel.");
      return;
    }
    setSalvando(true);
    setErroForm(null);
    try {
      const novo = await createMember({
        name: n,
        email: e,
        teamId: timeId,
        role: papel as MemberRole,
      });
      setRevelado({
        titulo: `Membro cadastrado: ${novo.name}`,
        email: novo.email,
        senha: novo.temporary_password,
      });
      setCriando(false);
      limparForm();
      await carregar();
    } catch (err) {
      const a = err as ApiError;
      setErroForm(
        a.status === 409
          ? "Já existe um membro com esse e-mail."
          : a.status === 422
          ? "Dados inválidos — confira o e-mail."
          : a.status === 403
          ? "Sem permissão: criar membro ADMIN exige que você seja ADMIN."
          : a.message || "Não consegui cadastrar."
      );
    } finally {
      setSalvando(false);
    }
  }

  if (erro) return <div className="error-box" style={{ maxWidth: 560 }}>{erro}</div>;
  if (!membros) return <div className="muted">Carregando membros…</div>;

  // ⚠️ AS LINHAS SAEM DE `linhasDaOrganizacao`, a MESMA função que alimenta a
  // tela de time -- é o que garante que as duas telas contem a mesma história
  // sobre a mesma pessoa.
  const todas = linhasDaOrganizacao(times, membros);
  // ⚠️ A MESMA FUNÇÃO que a busca da `/organizacao` usa. Ela nasceu aqui com
  // `toLowerCase()` puro, e "jose" achava "José" lá e ninguém aqui — mesma
  // pessoa, mesmo termo, duas respostas. Achado no code review de 09/09, e é
  // exatamente a divergência de regra que a §5 previu para a fatia E.
  const filtrando = busca.trim() !== "";
  const linhasVisiveis = filtrando
    ? todas.filter((l) => casaComBusca(busca, l.membro))
    : todas;

  return (
    <div>
      <PageHeader
        title="Pessoas"
        // ⚠️⚠️ O CONTADOR DO CABEÇALHO SEGUE O QUE ESTÁ NA TELA. Ele mostrava
        // `membros.length` (o total) enquanto a tabela mostrava "12 de 15" —
        // dois números diferentes para a mesma lista, na mesma página. É a
        // forma exata do defeito de 27/07 que a §3.2 registra: cabeçalho
        // divergindo do corpo.
        //
        // ⚠️ E "12 de 15" em vez de "12": a §3.2 é explícita em nunca mostrar
        // só o número do que sobrou, senão some a informação de que há mais.
        count={
          filtrando
            ? `${linhasVisiveis.length} de ${membros.length}`
            : membros.length
        }
        actions={
          podeCadastrarMembro(alcance) && !criando && !revelado && (
            <button
              className="btn btn-primary ml-auto"
              onClick={() => setCriando(true)}
              style={{ padding: "8px 14px" }}
            >
              + Cadastrar membro
            </button>
          )
        }
      />

      {revelado && (
        <SenhaProvisoria
          titulo={revelado.titulo}
          email={revelado.email}
          senha={revelado.senha}
          onFechar={() => setRevelado(null)}
        />
      )}

      {criando && (
        <Card className="mb-4 flex flex-col gap-3">
          <div className="field">
            <span className="label">Nome</span>
            <input className="input" value={nome} disabled={salvando} autoFocus
              onChange={(ev) => setNome(ev.target.value)} maxLength={255} />
          </div>
          <div className="field">
            <span className="label">E-mail</span>
            <input className="input" type="email" value={email} disabled={salvando}
              onChange={(ev) => setEmail(ev.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: 1, minWidth: 180 }}>
              <span className="label">Time</span>
              <select className="input" value={timeId} disabled={salvando}
                onChange={(ev) => setTimeId(ev.target.value)}>
                <option value="">— selecione o time —</option>
                {times.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.parent_team_id === null ? `${t.name} (geral)` : t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 180 }}>
              <span className="label">Papel</span>
              <select className="input" value={papel} disabled={salvando}
                onChange={(ev) => setPapel(ev.target.value as MemberRole | "")}>
                <option value="">—</option>
                {papeisDisponiveis.map((p) => (
                  <option key={p} value={p}>{PAPEL_LABEL[p]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>
            Hoje todo membro do Marketing enxerga o quadro geral inteiro. O time
            escolhido alimenta o filtro por time no quadro — não esconde tarefas.
            O supervisor do subtime pode adicionar e remover operadores dele
            próprio (Spec 028).
          </div>

          {erroForm && <div className="error-box">{erroForm}</div>}

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={cadastrar}
              disabled={salvando || !nome.trim() || !email.trim() || !timeId || !papel}
              style={{ padding: "8px 14px" }}>
              {salvando ? "Cadastrando…" : "Cadastrar"}
            </button>
            <button className="btn btn-ghost" onClick={() => { setCriando(false); limparForm(); }}
              disabled={salvando} style={{ padding: "8px 14px" }}>
              Cancelar
            </button>
          </div>
        </Card>
      )}

      {/* ---- A BUSCA DA ORGANIZAÇÃO -------------------------------------
          ⚠️ É o que a fatia E decidiu que esta tela É: *"Membros vira a busca
          da organização"*. Antes o filtro não existia aqui, e achar alguém
          num workspace com dezenas de pessoas era rolar a lista. */}
      <label className="field mb-4 block max-w-[420px]">
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

      {aviso && (
        <div role="status" className="muted mb-4 flex items-start gap-2 text-xs">
          <span>{aviso}</span>
          <button
            className="btn btn-ghost px-1.5 text-xs"
            onClick={() => setAviso(null)}
          >
            Entendi
          </button>
        </div>
      )}

      {membros.length === 0 ? (
        <EmptyState title="Nenhum membro" />
      ) : linhasVisiveis.length === 0 ? (
        <div className="muted">Ninguém com esse nome ou e-mail.</div>
      ) : (
        // ⚠️ A MESMA TABELA da tela de time. Uma tabela só, uma regra só -- a
        // §5 avisa que duas telas listando pessoas com regras diferentes é o
        // começo do próximo defeito de contador.
        <TabelaDeMembros
          linhas={linhasVisiveis}
          times={times}
          me={me}
          // ⚠️ O lápis oferece TODOS os subtimes: aqui o recorte é a
          // organização, não uma árvore.
          oferecidos={times.filter((t) => t.parent_team_id !== null)}
          podeMexer={podeGerenciar}
          colunaDoMeio={{
            titulo: "Áreas",
            render: (l) => {
              const areas = (l.membro.area_ids ?? [])
                .map((id) => times.find((t) => t.id === id))
                .filter((t): t is Team => t !== undefined);
              return areas.length === 0 ? (
                <Badge tone="outline" size="sm">
                  Sem área
                </Badge>
              ) : (
                <span className="flex flex-wrap gap-1.5">
                  {areas.map((a) => (
                    <Badge key={a.id} tone="neutral" size="sm" className="border">
                      {a.name}
                    </Badge>
                  ))}
                </span>
              );
            },
          }}
          // ⚠️ O CONTADOR DIZ OS DOIS NÚMEROS quando há filtro. A §3.2: o
          // defeito de 27/07 foi exatamente o cabeçalho divergindo do corpo.
          contagem={
            filtrando
              ? `${linhasVisiveis.length} de ${membros.length} pessoas`
              : `${membros.length} ${membros.length === 1 ? "pessoa" : "pessoas"}`
          }
          onMudou={async (texto) => {
            setAviso(texto);
            await carregar();
          }}
        />
      )}
    </div>
  );
}
// ⚠️⚠️ AQUI MORAVA `LinhaMembro`, ~575 linhas com TODOS os controles de
// vínculo inline: adicionar time, remover, trocar papel, mover de subtime.
// Ela saiu na Spec 047 (fatia E), e não por gosto de refatorar.
//
// A decisão da Camila (09/09): *"Membros vira a busca da organização,
// aquela tela da tabela de membros que abre da tela da org."*
//
// ⚠️ E o que ela remove é DUPLICAÇÃO, não capacidade: cada um daqueles
// controles existe agora em lugar melhor -- o lápis define em QUAIS times, e
// o painel define COM QUE CARGO em cada um. Manter os dois seria manter duas
// portas para a mesma escrita, e a §5 avisa onde isso termina: *"duas telas
// listando pessoas, com regras diferentes, é o começo do próximo defeito de
// contador"*.
//
// ⚠️ O QUE **NÃO** SAIU, de propósito: cadastrar membro, resetar senha e o
// bloco de senha provisória revelada uma vez (ADR 0021). São capacidades
// desta tela, e nenhuma delas existe em outro lugar.

function SenhaProvisoria({
  titulo,
  email,
  senha,
  onFechar,
}: {
  titulo: string;
  email: string;
  senha: string;
  onFechar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(senha);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }
  return (
    <div
      style={{
        border: "1px solid var(--accent)", borderRadius: 12, padding: 20,
        marginBottom: 16, background: "var(--accent-soft)",
        display: "flex", flexDirection: "column", gap: 10,
      }}
    >
      <strong style={{ fontSize: 14 }}>{titulo}</strong>
      <span className="muted" style={{ fontSize: 13 }}>{email}</span>
      <div style={{ fontSize: 13 }}>Senha provisória (o membro troca no 1º acesso):</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <code style={{
          fontSize: 15, fontWeight: 700, padding: "6px 12px", borderRadius: 8,
          background: "var(--surface)", border: "1px solid var(--border)", userSelect: "all",
        }}>
          {senha}
        </code>
        <button className="btn btn-ghost" onClick={copiar} style={{ padding: "6px 12px" }}>
          {copiado ? "Copiado!" : "Copiar"}
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--danger, #b42318)", fontWeight: 600 }}>
        Copie agora — esta senha não aparece de novo. Repasse ao membro pelo canal combinado.
      </div>
      <button className="btn btn-primary" onClick={onFechar} style={{ alignSelf: "flex-start", padding: "6px 14px" }}>
        Concluir
      </button>
    </div>
  );
}
