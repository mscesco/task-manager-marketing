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
  papeisAtribuiveis,
  timesParaAdicionar as timesPermitidos,
  type Alcance,
} from "@/lib/permissoesMembros";
import AppShell from "@/components/AppShell";
import EmptyState from "@/components/EmptyState";
import Badge from "@/components/Badge";
import Avatar from "@/components/Avatar";
import Card from "@/components/Card";
import PageHeader from "@/components/PageHeader";
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

// Membros: lista + cadastro (4a) + resetar senha / desativar (4b), gated por
// team.manage. Reset e cadastro compartilham o reveal-once da senha (ADR 0008).
const PAPEL_LABEL: Record<MemberRole, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gerente",
  SUPERVISOR: "Supervisor",
  OPERATOR: "Operador",
};
const PAPEIS: MemberRole[] = ["OPERATOR", "SUPERVISOR", "MANAGER", "ADMIN"];

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

  // Spec 028: o gate deixou de ser "tem team.manage?" e virou um ALCANCE.
  // A regra mora em lib/permissoesMembros (pura, testada); aqui so lemos.
  const alcance = alcanceDe(me);
  const podeGerenciar = podeGerenciarAlgo(alcance);
  // Spec 014 (gate D2): so um ADMIN ve a opcao ADMIN no dropdown. O backend
  // trava de qualquer jeito -- isto e so conveniencia de UI.
  const souAdmin = me?.roles.includes("ADMIN") ?? false;
  const papeisDisponiveis = souAdmin ? PAPEIS : PAPEIS.filter((p) => p !== "ADMIN");

// Rotulo do time COM a hierarquia: se o time tem pai, mostra
  // "Pai › Filho" (ex.: "Marketing › CRM e Automacao"), deixando claro
  // que o subtime pertence ao time-pai. Time raiz mostra so o nome.
  // O parent_team_id ja vem do backend em cada Team; aqui so montamos o texto.
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
          ? "Dados inválidos (e-mail, ou a pessoa já está em outro subtime)."
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

  return (
    <div style={{ maxWidth: 720 }}>
      <PageHeader
        title="Membros"
        count={membros.length}
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

      {membros.length === 0 ? (
        <EmptyState title="Nenhum membro" />
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          {membros.map((m, i) => (
            <LinhaMembro
              key={m.id}
              m={m}
              subtime={nomeSubtime(m.team_id)}
              times={times}
              souAdmin={souAdmin}
              primeira={i === 0}
              alcance={alcance}
              podeGerenciar={podeGerenciar}
              isSelf={me?.id === m.id}
              onRevelar={setRevelado}
              onMudou={carregar}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Linha da lista + acoes de gestao (4b). Resetar/desativar so aparecem pra
// quem tem team.manage, em membro ATIVO que nao e voce mesmo. Confirmacao
// inline (sem dialog do browser). Reset alimenta o reveal-once do pai.
function LinhaMembro({
  m,
  subtime,
  times,
  souAdmin,
  primeira,
  alcance,
  podeGerenciar,
  isSelf,
  onRevelar,
  onMudou,
}: {
  m: Member;
  subtime: string;
  times: Team[];
  souAdmin: boolean;
  primeira: boolean;
  alcance: Alcance;
  podeGerenciar: boolean;
  isSelf: boolean;
  onRevelar: (r: Revelado) => void;
  onMudou: () => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDesativar, setConfirmDesativar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erroLinha, setErroLinha] = useState<string | null>(null);

  // painel de papel (Spec 015, F3) -- carregado sob demanda.
  const [editandoPapel, setEditandoPapel] = useState(false);
  const [vinculos, setVinculos] = useState<MemberTeam[] | null>(null);
  const [papelBusy, setPapelBusy] = useState<string | null>(null); // team_id salvando
  const [confirmRemover, setConfirmRemover] = useState<string | null>(null); // team_id
  // adicionar a um time (Spec 016)
  const [adicionando, setAdicionando] = useState(false);
  const [novoTimeId, setNovoTimeId] = useState("");
  const [novoPapel, setNovoPapel] = useState<MemberRole | "">("");
  const [addBusy, setAddBusy] = useState(false);

  // Spec 028: a linha aparece SEMPRE (lista completa do time). O que o
  // alcance decide e se ela tem botao -- para o supervisor, so em membro do
  // proprio subtime ou sem subtime. Para ADMIN/MANAGER nada muda.
  const mostraAcoes =
    podeGerenciar &&
    !isSelf &&
    m.is_active &&
    temAcaoPossivel(alcance, m.team_id);

  // Papeis atribuiveis pelo ator. Spec 028: sai do modulo puro -- supervisor
  // so oferece OPERATOR. Espelha a matriz C2 + a trava D2 do backend (que
  // travam de qualquer jeito; aqui e so para nao oferecer o que dara 403).
  const papeisDoAtor: MemberRole[] = papeisAtribuiveis(alcance, souAdmin);

  function nomeTime(id: string): string {
    return times.find((t) => t.id === id)?.name ?? "—";
  }

  // C2 (front): o ator so edita vinculo cujo papel atual ele alcanca.
  // Spec 028: trocar papel exige alcance amplo -- supervisor nao promove.
  function podeEditarVinculo(papelAtual: MemberRole): boolean {
    if (!podeTrocarPapel(alcance)) return false;
    return souAdmin || papelAtual === "SUPERVISOR" || papelAtual === "OPERATOR";
  }

  // Spec 028: remover vinculo -- amplo remove qualquer um; supervisor so
  // OPERATOR do proprio subtime.
  function podeRemoverVinculo(teamId: string, papelAtual: MemberRole): boolean {
    return podeRemoverDoTime(alcance, teamId, papelAtual);
  }

  function ehSubtime(teamId: string): boolean {
    return (times.find((t) => t.id === teamId)?.parent_team_id ?? null) !== null;
  }

  // Destinos de "mover": qualquer time onde a pessoa AINDA nao esta (exclui o
  // atual e os que ela ja tem). Inclui a raiz (Marketing geral) -> "tirar do
  // subtime" = mover pra raiz. Evita oferecer destino que daria 409.
  function destinosDeMover(exceto: string): Team[] {
    const jaEsta = new Set((vinculos ?? []).map((x) => x.team_id));
    return times.filter((t) => t.id !== exceto && !jaEsta.has(t.id));
  }

  // Times para ADICIONAR (Spec 016): onde a pessoa ainda nao esta. Se ela ja
  // tem um subtime, nao oferece outro (regra 1-subtime -> seria 422); a raiz
  // continua valida.
  function timesParaAdicionar(): Team[] {
    const jaEsta = new Set((vinculos ?? []).map((x) => x.team_id));
    const temSubtime = (vinculos ?? []).some((x) => ehSubtime(x.team_id));
    const candidatos = times.filter((t) => {
      if (jaEsta.has(t.id)) return false;
      if (temSubtime && t.parent_team_id !== null) return false;
      return true;
    });
    // Spec 028: o supervisor so enxerga aqui os subtimes onde ele e
    // supervisor -- nunca a raiz, nunca subtime alheio.
    return timesPermitidos(alcance, candidatos);
  }

  async function adicionarVinculo() {
    if (!novoTimeId || !novoPapel) return;
    setAddBusy(true);
    setErroLinha(null);
    try {
      await assignMemberToTeam(m.id, novoTimeId, novoPapel as MemberRole);
      setAdicionando(false);
      setNovoTimeId("");
      setNovoPapel("");
      await recarregarVinculos();
      onMudou();
    } catch (e) {
      const a = e as ApiError;
      setErroLinha(
        a.status === 403
          ? "Sem permissão para esse papel (a matriz do servidor recusou)."
          : a.status === 409
          ? "A pessoa já faz parte desse time."
          : a.status === 422
          ? "Inválido: a pessoa já está em outro subtime (regra: 1 subtime)."
          : a.message || "Não consegui adicionar."
      );
    } finally {
      setAddBusy(false);
    }
  }

  async function abrirPapel() {
    setErroLinha(null);
    setEditandoPapel(true);
    setVinculos(null);
    try {
      setVinculos(await listMemberTeams(m.id));
    } catch (e) {
      setErroLinha((e as ApiError).message || "Não consegui carregar os papéis.");
      setEditandoPapel(false);
    }
  }

  async function recarregarVinculos() {
    try {
      setVinculos(await listMemberTeams(m.id));
    } catch (e) {
      setErroLinha((e as ApiError).message || "Não consegui recarregar os papéis.");
    }
  }

  async function salvarPapel(teamId: string, novo: MemberRole) {
    setPapelBusy(teamId);
    setErroLinha(null);
    try {
      const r = await changeMemberRole(m.id, teamId, novo);
      setVinculos((vs) =>
        (vs ?? []).map((v) => (v.team_id === teamId ? { ...v, role: r.role } : v))
      );
    } catch (e) {
      const a = e as ApiError;
      setErroLinha(
        a.status === 403
          ? "Sem permissão para esse papel (a matriz do servidor recusou)."
          : a.status === 404
          ? "Vínculo não encontrado (a pessoa pode ter saído do time)."
          : a.message || "Não consegui alterar o papel."
      );
    } finally {
      setPapelBusy(null);
    }
  }

  async function removerVinculo(teamId: string) {
    setPapelBusy(teamId);
    setErroLinha(null);
    try {
      await removeMemberFromTeam(m.id, teamId);
      setConfirmRemover(null);
      await recarregarVinculos();
      onMudou(); // o subtime na lista pode ter mudado
    } catch (e) {
      const a = e as ApiError;
      setErroLinha(
        a.status === 403
          ? "Sem permissão para remover esse vínculo."
          : a.status === 409
          ? "Não dá pra remover: é o único time da pessoa (ela ficaria sem time)."
          : a.status === 404
          ? "Vínculo não encontrado (pode ter mudado)."
          : a.message || "Não consegui remover."
      );
    } finally {
      setPapelBusy(null);
    }
  }

  async function moverPara(fromTeamId: string, toTeamId: string) {
    setPapelBusy(fromTeamId);
    setErroLinha(null);
    try {
      await moveMemberSubteam(m.id, fromTeamId, toTeamId);
      await recarregarVinculos();
      onMudou(); // o subtime na lista mudou
    } catch (e) {
      const a = e as ApiError;
      setErroLinha(
        a.status === 403
          ? "Sem permissão para mover esse membro."
          : a.status === 409
          ? "Movimento inválido (mesmo time ou já faz parte do destino)."
          : a.status === 404
          ? "Time de origem ou destino não encontrado."
          : a.message || "Não consegui mover."
      );
    } finally {
      setPapelBusy(null);
    }
  }

  async function resetar() {
    setBusy(true);
    setErroLinha(null);
    try {
      const r = await resetMemberPassword(m.id);
      setConfirmReset(false);
      onRevelar({
        titulo: `Senha resetada: ${m.name}`,
        email: m.email,
        senha: r.temporary_password,
      });
    } catch (e) {
      const a = e as ApiError;
      setErroLinha(a.status === 403 ? "Sem permissão." : a.message || "Não consegui resetar.");
    } finally {
      setBusy(false);
    }
  }

  async function desativar() {
    setBusy(true);
    setErroLinha(null);
    try {
      await deactivateMember(m.id);
      setConfirmDesativar(false);
      onMudou(); // recarrega a lista (cache ja invalidado)
    } catch (e) {
      const a = e as ApiError;
      setErroLinha(a.status === 403 ? "Sem permissão." : a.message || "Não consegui desativar.");
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", gap: 8, padding: "12px 16px",
        borderTop: primeira ? "none" : "1px solid var(--border)",
        background: "var(--surface)", opacity: m.is_active ? 1 : 0.6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Avatar id={m.id} name={m.name} size="lg" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {m.name}{isSelf && <span className="muted" style={{ fontWeight: 400 }}> (você)</span>}
          </div>
          <div className="muted" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {m.email}
          </div>
        </div>
        <Badge tone="neutral" size="md" weight="normal" className="shrink-0 bg-surface-2 border border-border text-ink-faint">
          {subtime}
        </Badge>
        {!m.is_active && (
          <Badge tone="neutral" size="md" weight="bold" className="shrink-0 border border-border text-ink-faint">
            inativo
          </Badge>
        )}

        {mostraAcoes && !confirmReset && !confirmDesativar && !editandoPapel && (
          <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button className="btn btn-ghost" onClick={abrirPapel}
              style={{ padding: "4px 10px", fontSize: 12 }}>
              {podeTrocarPapel(alcance) ? "Alterar papel" : "Times"}
            </button>
            {podeResetarSenha(alcance) && (
              <button className="btn btn-ghost" onClick={() => { setErroLinha(null); setConfirmReset(true); }}
                style={{ padding: "4px 10px", fontSize: 12 }}>
                Resetar senha
              </button>
            )}
            {podeDesativarConta(alcance) && (
              <button className="btn btn-ghost" onClick={() => { setErroLinha(null); setConfirmDesativar(true); }}
                style={{ padding: "4px 10px", fontSize: 12, color: "var(--danger, #b42318)" }}>
                Desativar
              </button>
            )}
          </span>
        )}
      </div>

      {/* confirmacao: resetar senha */}
      {confirmReset && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: 44 }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Gerar nova senha provisoria para {m.name}? A senha atual dele deixa de valer.
          </span>
          <button className="btn btn-primary" onClick={resetar} disabled={busy}
            style={{ padding: "4px 12px", fontSize: 12 }}>
            {busy ? "…" : "Resetar"}
          </button>
          <button className="btn btn-ghost" onClick={() => setConfirmReset(false)} disabled={busy}
            style={{ padding: "4px 12px", fontSize: 12 }}>
            Cancelar
          </button>
        </div>
      )}

      {/* confirmacao: desativar */}
      {confirmDesativar && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: 44, flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Desativar {m.name}? Hoje <strong>não tem como reativar pela tela</strong>.
          </span>
          <button className="btn btn-primary" onClick={desativar} disabled={busy}
            style={{ padding: "4px 12px", fontSize: 12, background: "var(--danger, #b42318)", borderColor: "transparent" }}>
            {busy ? "…" : "Desativar"}
          </button>
          <button className="btn btn-ghost" onClick={() => setConfirmDesativar(false)} disabled={busy}
            style={{ padding: "4px 12px", fontSize: 12 }}>
            Cancelar
          </button>
        </div>
      )}

      {/* painel: alterar papel (Spec 015, F3) */}
      {editandoPapel && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 44 }}>
          {vinculos === null ? (
            <span className="muted" style={{ fontSize: 12.5 }}>Carregando papéis…</span>
          ) : vinculos.length === 0 ? (
            <span className="muted" style={{ fontSize: 12.5 }}>
              Este membro não tem vínculo de time.
            </span>
          ) : (
            vinculos.map((v) => {
              const editavel = podeEditarVinculo(v.role);
              const destinos = destinosDeMover(v.team_id);
              const podeMover =
                podeMoverSubtime(alcance) &&
                editavel &&
                ehSubtime(v.team_id) &&
                destinos.length > 0;
              // Spec 028: remover tem gate PROPRIO. Nao pode sair de
              // `editavel` -- o supervisor nao edita papel (D2) mas remove
              // OPERATOR do proprio subtime (D1), que e o objetivo da spec.
              const podeRemover =
                podeRemoverVinculo(v.team_id, v.role) && vinculos.length > 1;
              const ocupada = papelBusy === v.team_id;
              return (
                <div key={v.team_id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12.5, minWidth: 120 }}>{nomeTime(v.team_id)}</span>
                    {editavel ? (
                      <select
                        className="input"
                        value={v.role}
                        disabled={ocupada}
                        onChange={(ev) => salvarPapel(v.team_id, ev.target.value as MemberRole)}
                        style={{ padding: "4px 8px", fontSize: 12, width: "auto" }}
                      >
                        {papeisDoAtor.map((p) => (
                          <option key={p} value={p}>{PAPEL_LABEL[p]}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="muted" style={{ fontSize: 12.5 }}>
                        {PAPEL_LABEL[v.role]} <span style={{ fontStyle: "italic" }}>(so um ADMIN altera)</span>
                      </span>
                    )}
                    {podeMover && (
                      <select
                        className="input"
                        value=""
                        disabled={ocupada}
                        onChange={(ev) => { if (ev.target.value) moverPara(v.team_id, ev.target.value); }}
                        style={{ padding: "4px 8px", fontSize: 12, width: "auto" }}
                      >
                        <option value="">Mover para…</option>
                        {destinos.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.parent_team_id === null ? `${t.name} (geral)` : t.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {podeRemover && confirmRemover !== v.team_id && (
                      <button className="btn btn-ghost" disabled={ocupada}
                        onClick={() => { setErroLinha(null); setConfirmRemover(v.team_id); }}
                        style={{ padding: "4px 10px", fontSize: 12, color: "var(--danger, #b42318)" }}>
                        Remover
                      </button>
                    )}
                    {ocupada && <span className="muted" style={{ fontSize: 12 }}>salvando…</span>}
                  </div>

                  {confirmRemover === v.team_id && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span className="muted" style={{ fontSize: 12 }}>
                        Tirar {m.name} de <strong>{nomeTime(v.team_id)}</strong>? Perde o acesso a esse time; as tarefas dele ficam.
                      </span>
                      <button className="btn btn-primary" disabled={ocupada}
                        onClick={() => removerVinculo(v.team_id)}
                        style={{ padding: "4px 12px", fontSize: 12, background: "var(--danger, #b42318)", borderColor: "transparent" }}>
                        {ocupada ? "…" : "Remover"}
                      </button>
                      <button className="btn btn-ghost" disabled={ocupada}
                        onClick={() => setConfirmRemover(null)}
                        style={{ padding: "4px 12px", fontSize: 12 }}>
                        Cancelar
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
          {/* adicionar a um time (Spec 016) */}
          {vinculos !== null && mostraAcoes && timesParaAdicionar().length > 0 && (
            adicionando ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <select className="input" value={novoTimeId} disabled={addBusy}
                  onChange={(ev) => setNovoTimeId(ev.target.value)}
                  style={{ padding: "4px 8px", fontSize: 12, width: "auto" }}>
                  <option value="">— time —</option>
                  {timesParaAdicionar().map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.parent_team_id === null ? `${t.name} (geral)` : t.name}
                    </option>
                  ))}
                </select>
                <select className="input" value={novoPapel} disabled={addBusy}
                  onChange={(ev) => setNovoPapel(ev.target.value as MemberRole | "")}
                  style={{ padding: "4px 8px", fontSize: 12, width: "auto" }}>
                  <option value="">— papel —</option>
                  {papeisDoAtor.map((p) => (
                    <option key={p} value={p}>{PAPEL_LABEL[p]}</option>
                  ))}
                </select>
                <button className="btn btn-primary" onClick={adicionarVinculo}
                  disabled={
                    addBusy ||
                    !novoTimeId ||
                    !novoPapel ||
                    // Spec 028: ultima checagem antes de disparar. Os selects
                    // ja sao filtrados, mas a combinacao (time, papel) so e
                    // valida junta -- e o backend recusa com 403 se passar.
                    !podeAdicionarAoTime(
                      alcance, novoTimeId, novoPapel as MemberRole,
                    )
                  }
                  style={{ padding: "4px 12px", fontSize: 12 }}>
                  {addBusy ? "…" : "Adicionar"}
                </button>
                <button className="btn btn-ghost" disabled={addBusy}
                  onClick={() => { setAdicionando(false); setNovoTimeId(""); setNovoPapel(""); }}
                  style={{ padding: "4px 12px", fontSize: 12 }}>
                  Cancelar
                </button>
              </div>
            ) : (
              <button className="btn btn-ghost" onClick={() => { setErroLinha(null); setAdicionando(true); }}
                style={{ padding: "4px 10px", fontSize: 12, alignSelf: "flex-start" }}>
                + Adicionar a um time
              </button>
            )
          )}
          <div>
            <button className="btn btn-ghost" onClick={() => { setEditandoPapel(false); setVinculos(null); setConfirmRemover(null); setAdicionando(false); }}
              disabled={papelBusy !== null || addBusy} style={{ padding: "4px 12px", fontSize: 12 }}>
              Fechar
            </button>
          </div>
        </div>
      )}

      {erroLinha && <div className="error-box" style={{ marginLeft: 44 }}>{erroLinha}</div>}
    </div>
  );
}

// Bloco reveal-once: a senha provisoria so existe aqui (nao volta). Mostra
// com aviso, botao copiar, e some ao fechar.
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
