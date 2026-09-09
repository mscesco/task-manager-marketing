"use client";
import { useEffect, useState } from "react";
import {
  alcanceDe,
  podeCadastrarMembro,
  papeisAtribuiveis,
} from "@/lib/permissoesMembros";
import AppShell from "@/components/AppShell";
import EmptyState from "@/components/EmptyState";
import Tabs from "@/components/Tabs";
import Badge from "@/components/Badge";
import Card from "@/components/Card";
import PageHeader from "@/components/PageHeader";
import TemporaryPassword from "@/components/TemporaryPassword";
import MembersTable from "@/components/MembersTable";
import { organizationRows } from "@/lib/teamScreen";
import { matchesSearch } from "@/lib/organization";
import {
  countByState,
  memberState,
  type MemberState,
} from "@/lib/memberState";
import { Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  listMembers,
  listTeamsAll,
  createMember,
  currentUser,
  ApiError,
  type Member,
  type Team,
  type MemberRole,
  type CurrentUser,
} from "@/lib/api";

// Membros: lista + cadastro (4a) + resetar senha / desativar (4b), gated por
// team.manage. Reset e cadastro compartilham o reveal-once da senha (ADR 0008).
const ROLE_LABEL: Record<MemberRole, string> = {
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

type RevealedPassword = { title: string; email: string; password: string };

export default function MembrosPage() {
  return (
    <AppShell>
      <Membros />
    </AppShell>
  );
}

function Membros() {
  const [members, setMembros] = useState<Member[] | null>(null);
  const [teams, setTimes] = useState<Team[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [me, setMe] = useState<CurrentUser | null>(null);

  // reveal-once compartilhado por cadastro e reset (ADR 0008).
  const [revelado, setRevelado] = useState<RevealedPassword | null>(null);

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
  // ⚠️ AS MESMAS TRÊS ABAS da tela de time, e pela mesma razão da tabela
  // compartilhada: são duas telas sobre pessoas, e recortes diferentes nas
  // duas fariam o mesmo cadastro contar histórias diferentes.
  const [aba, setAba] = useState<MemberState>("active");

  // Spec 028: o gate deixou de ser "tem team.manage?" e virou um ALCANCE.
  // A regra mora em lib/permissoesMembros (pura, testada); aqui so lemos.
  const scope = alcanceDe(me);
  const isAdmin = me?.roles.includes("ADMIN") ?? false;
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
        scope,
        isAdmin,
        teams.find((t) => t.id === timeId)?.parent_team_id == null,
      )
    : [];

  // ⚠️ AQUI MORAVAM `nomeSubtime` e `nomeSubtimes`, que montavam o rótulo
  // "Pai › Filho" da coluna de subtimes. Ficaram sem uso quando `LinhaMembro`
  // saiu (fatia E): a coluna de times é da `MembersTable` agora, e ela
  // mostra `Nome · Cargo` -- o cargo importa mais que o caminho na árvore
  // numa tela cujo assunto é permissão. O `tsc` não acusa função morta, e por
  // isso vale dizer que a remoção foi deliberada.

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
        title: `Membro cadastrado: ${novo.name}`,
        email: novo.email,
        password: novo.temporary_password,
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
  if (!members) return <div className="muted">Carregando members…</div>;

  // ⚠️ AS LINHAS SAEM DE `organizationRows`, a MESMA função que alimenta a
  // tela de time -- é o que garante que as duas telas contem a mesma história
  // sobre a mesma pessoa.
  const todas = organizationRows(teams, members);
  // ⚠️ A MESMA FUNÇÃO que a busca da `/organizacao` usa. Ela nasceu aqui com
  // `toLowerCase()` puro, e "jose" achava "José" lá e ninguém aqui — mesma
  // pessoa, mesmo termo, duas respostas. Achado no code review de 09/09, e é
  // exatamente a divergência de regra que a §5 previu para a fatia E.
  // ⚠️ DOIS RECORTES, e a ordem importa para os números: a BUSCA define o
  // universo em que as abas contam. Contando as abas sobre todo mundo, buscar
  // "ana" mostraria "Convidados 7" com uma Ana só na tela.
  const filtrando = busca.trim() !== "";
  const buscadas = filtrando
    ? todas.filter((l) => matchesSearch(busca, l.member))
    : todas;
  const count = countByState(buscadas.map((l) => l.member));
  const linhasVisiveis = buscadas.filter(
    (l) => memberState(l.member) === aba,
  );

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
          linhasVisiveis.length === members.length
            ? members.length
            : `${linhasVisiveis.length} de ${members.length}`
        }
        actions={
          podeCadastrarMembro(scope) && !criando && !revelado && (
            <button
              className="btn btn-primary ml-auto"
              onClick={() => setCriando(true)}
              style={{ padding: "8px 14px" }}
            >
              + Cadastrar member
            </button>
          )
        }
      />

      {revelado && (
        <TemporaryPassword
          title={revelado.title}
          email={revelado.email}
          password={revelado.password}
          onClose={() => setRevelado(null)}
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
                <option value="">— selecione o team —</option>
                {teams.map((t) => (
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
                  <option key={p} value={p}>{ROLE_LABEL[p]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>
            Hoje todo member do Marketing enxerga o quadro geral inteiro. O team
            escolhido alimenta o filtro por team no quadro — não esconde tarefas.
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

      {members.length === 0 ? (
        <EmptyState title="Nenhum membro" />
      ) : buscadas.length === 0 ? (
        <div className="muted">Ninguém com esse nome ou e-mail.</div>
      ) : (
        <>
          {/* ⚠️ As contagens são do que a BUSCA deixou passar — ver o
              comentário no cálculo. E `0` aparece: uma aba sem número
              lê-se como "não sei". */}
          <div className="mb-3">
            <Tabs
              aria-label="Estado das pessoas"
              group="estado"
              active={aba}
              onSelect={setAba}
              tabs={[
                { id: "active", label: "Ativos", count: count.active },
                {
                  id: "invited",
                  label: "Convidados",
                  count: count.invited,
                },
                {
                  id: "inactive",
                  label: "Inativos",
                  count: count.inactive,
                },
              ]}
            />
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={aba}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              {linhasVisiveis.length === 0 ? (
                <div className="muted rounded-lg border border-border bg-surface p-4 text-sm">
                  {emptyStateText(aba)}
                </div>
              ) : (
        // ⚠️ A MESMA TABELA da tela de time. Uma tabela só, uma regra só -- a
        // §5 avisa que duas telas listando pessoas com regras diferentes é o
        // começo do próximo defeito de contador.
        <MembersTable
          rows={linhasVisiveis}
          teams={teams}
          me={me}
          middleColumn={{
            title: "Áreas",
            render: (l) => {
              const areas = (l.member.area_ids ?? [])
                .map((id) => teams.find((t) => t.id === id))
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
          // ⚠️ O CONTADOR DIZ OS DOIS NÚMEROS sempre que há recorte — busca,
          // aba, ou os dois. A §3.2: o defeito de 27/07 foi exatamente o
          // cabeçalho divergindo do corpo, e mostrar só o filtrado apaga a
          // informação de que existe mais.
          count={
            linhasVisiveis.length === members.length
              ? `${members.length} ${members.length === 1 ? "pessoa" : "pessoas"}`
              : `${linhasVisiveis.length} de ${members.length} pessoas`
          }
          onChanged={async (texto) => {
            setAviso(texto);
            await carregar();
          }}
        />
              )}
            </motion.div>
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

/**
 * O vazio de cada aba diz POR QUE está vazio.
 *
 * ⚠️ "Nenhum resultado" numa aba filtrada é a mensagem que faz a pessoa achar
 * que perdeu registros — o mesmo mal-estar do defeito de contador de 27/07,
 * numa forma mais barata.
 */
function emptyStateText(aba: MemberState): string {
  switch (aba) {
    case "active":
      return "Ninguém ativo neste recorte — veja as outras abas.";
    case "invited":
      return "Ninguém pendente: todo mundo já entrou pelo menos uma vez.";
    case "inactive":
      return "Ninguém desativado neste recorte.";
  }
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
// ⚠️ O QUE **NÃO** SAIU: cadastrar membro. É a única capacidade que ainda
// mora só aqui -- este é o formulário que escolhe o TIME, e por isso serve
// quem não veio de nenhuma tela de time.
//
// ⚠️ O bloco reveal-once da senha (ADR 0021) virou `components/TemporaryPassword`
// em 09/09, quando a gaveta do membro ganhou "Resetar senha" e passou a
// precisar dele também. Duas cópias divergiriam no AVISO -- e o aviso é a
// parte que evita a perda do segredo.
