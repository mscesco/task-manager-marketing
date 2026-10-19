"use client";
import { useEffect, useState } from "react";
import { KeyRound, Monitor, Moon, Sun } from "lucide-react";
import AppShell from "@/components/AppShell";
import Card from "@/components/Card";
import PageHeader from "@/components/PageHeader";
import NotificationPreferences from "@/components/NotificationPreferences";
import {
  currentUser,
  listTeamsAll,
  renameSelf,
  ApiError,
  type CurrentUser,
  type Team,
} from "@/lib/api";
import { NOME_MAXIMO, nomeParaSalvar } from "@/lib/nomeProprio";
import { corAvatar, iniciais } from "@/lib/people";
import { useTema } from "@/lib/useTema";
import type { Tema } from "@/lib/tema";

import Loading from "@/components/Loading";
// Perfil: nome (editável), e-mail e times + atalho pra trocar senha e o tema.
//
// ⚠️ Spec 051, fatia E: O NOME PASSOU A SER EDITÁVEL AQUI, e só aqui -- decisão
// da Camila (16/09): *"liberar somente para próprio"*. Ninguém edita o nome de
// outra pessoa, admin incluído, e por isso a gaveta do membro não ganha campo.
// Avatar e e-mail seguem fora (ADR 0009).
//
// Redesign (fatia 4): duas colunas -- dados à esquerda, preferências de
// notificação à direita -- e o personagem do Tibia no canto (só nesta tela).
const PAPEL_LABEL: Record<string, string> = {
  ADMIN: "Administrador",
  GESTOR: "Gestor",
  MANAGER: "Gerente",
  SUPERVISOR: "Supervisor",
  OPERATOR: "Operador",
};

const TEMAS: { id: Tema; rotulo: string; Icone: typeof Sun }[] = [
  { id: "claro", rotulo: "Claro", Icone: Sun },
  { id: "escuro", rotulo: "Escuro", Icone: Moon },
  { id: "sistema", rotulo: "Sistema", Icone: Monitor },
];

export default function PerfilPage() {
  return (
    <AppShell>
      <Perfil />
    </AppShell>
  );
}

function Perfil() {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [times, setTimes] = useState<Team[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erroNome, setErroNome] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const { tema, mudarTema } = useTema();

  useEffect(() => {
    currentUser()
      .then((u) => {
        setMe(u);
        setNome(u.name);
      })
      .catch((e: ApiError) => setErro(e.message || "Não consegui carregar seu perfil."));
    // Só para dar nome aos times das pílulas; sem a árvore, fica o papel.
    listTeamsAll().then(setTimes).catch(() => {});
  }, []);

  if (erro) return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  if (!me) return <Loading />;

  const paraSalvar = nomeParaSalvar(nome, me.name);

  async function salvarNome() {
    if (paraSalvar === null) return;
    setSalvando(true);
    setErroNome(null);
    setSalvo(false);
    try {
      const novo = await renameSelf(paraSalvar);
      setMe((atual) => (atual ? { ...atual, name: novo } : atual));
      setNome(novo);
      setSalvo(true);
    } catch (e) {
      setErroNome((e as ApiError).message || "Não consegui salvar o nome.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="max-w-[1100px]">
      <PageHeader title="Meu perfil" />

      <div className="grid items-start gap-[18px] min-[900px]:grid-cols-[480px_minmax(0,1fr)]">
        <Card className="flex flex-col gap-[18px]">
          <div className="flex items-center gap-3.5">
            {/* Cor de runtime (`corAvatar`): a excecao do inline. */}
            <span
              aria-hidden
              className="inline-flex h-14 w-14 shrink-0 select-none items-center justify-center rounded-2xl text-xl font-extrabold text-white"
              style={{ background: corAvatar(me.id) }}
            >
              {iniciais(me.name)}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <strong className="truncate text-[17px] font-bold">{me.name}</strong>
              {me.org_role && (
                <span className="flex gap-1.5">
                  <span className="inline-flex h-[22px] items-center rounded-full bg-accent-soft px-2.5 text-xs font-bold text-accent">
                    {PAPEL_LABEL[me.org_role] ?? me.org_role}
                  </span>
                </span>
              )}
            </div>
          </div>

          <form
            className="field"
            onSubmit={(e) => {
              e.preventDefault();
              void salvarNome();
            }}
          >
            <label className="label" htmlFor="perfil-nome">
              Nome
            </label>
            <div className="flex gap-2">
              <input
                id="perfil-nome"
                className="input flex-1"
                value={nome}
                maxLength={NOME_MAXIMO}
                disabled={salvando}
                autoComplete="name"
                onChange={(e) => {
                  setNome(e.target.value);
                  setSalvo(false);
                }}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={salvando || paraSalvar === null}
              >
                {salvando ? "Salvando…" : "Salvar"}
              </button>
            </div>
            <span className="muted text-sm">
              Só você edita o seu nome. Avatar e e-mail vêm do cadastro.
            </span>
            {erroNome && (
              <div className="error-box mt-2 text-xs" role="alert">
                {erroNome}
              </div>
            )}
            {salvo && (
              <div className="muted mt-2 text-xs" role="status">
                Nome atualizado.
              </div>
            )}
          </form>

          <div className="field">
            <span className="label">E-mail</span>
            <div className="text-md">{me.email}</div>
          </div>

          <div className="field">
            <span className="label">Times</span>
            {me.teams.length === 0 ? (
              <span className="muted text-md">Sem time atribuído</span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {me.teams.map((v) => (
                  <span
                    key={v.team_id}
                    className="inline-flex h-7 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-xs font-bold"
                  >
                    <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-teal" />
                    {times.find((t) => t.id === v.team_id)?.name ?? "Time"} ·{" "}
                    {PAPEL_LABEL[v.role] ?? v.role}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <a href="/trocar-senha" className="btn">
              <KeyRound size={14} aria-hidden />
              Trocar senha
            </a>
            {/* Seletor segmentado de tema: o mesmo estado da barra lateral. */}
            <div
              role="group"
              aria-label="Tema"
              className="ml-auto inline-flex gap-0.5 rounded-md border border-border bg-surface-2 p-[3px]"
            >
              {TEMAS.map(({ id, rotulo, Icone }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={tema === id}
                  onClick={() => mudarTema(id)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-sm border-0 px-3.5 text-base font-semibold ${
                    tema === id ? "bg-surface text-ink shadow-card" : "bg-transparent text-ink-faint"
                  }`}
                >
                  <Icone size={13} aria-hidden />
                  {rotulo}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* ⚠️ O `id` E O DESTINO DO "Configurar" de `/notificacoes`
            (`/perfil#notificacoes`, Spec 054 §9.6). Tirar o id nao quebra
            nada visivelmente -- so faz o link cair no topo da pagina. */}
        <section id="notificacoes" className="scroll-mt-4">
          <Card>
            <NotificationPreferences />
          </Card>
        </section>
      </div>

      {/* Easter egg (decisao dela): o personagem, parado no canto, marchando
          no lugar. Decoracao: `aria-hidden`, sem alt, sem clique. */}
      <div className="tibia-egg print:hidden" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/tibia.png" alt="" width={96} height={96} />
      </div>
    </div>
  );
}
