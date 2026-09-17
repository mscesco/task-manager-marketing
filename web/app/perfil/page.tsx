"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Card from "@/components/Card";
import PageHeader from "@/components/PageHeader";
import NotificationPreferences from "@/components/NotificationPreferences";
import { currentUser, renameSelf, ApiError, type CurrentUser } from "@/lib/api";
import { NOME_MAXIMO, nomeParaSalvar } from "@/lib/nomeProprio";

import Loading from "@/components/Loading";
// Perfil: nome (editável), e-mail e papéis + atalho pra trocar senha.
//
// ⚠️ Spec 051, fatia E: O NOME PASSOU A SER EDITÁVEL AQUI, e só aqui -- decisão
// da Camila (16/09): *"liberar somente para próprio"*. Ninguém edita o nome de
// outra pessoa, admin incluído, e por isso a gaveta do membro não ganha campo.
// Avatar e e-mail seguem fora (ADR 0009).
const PAPEL_LABEL: Record<string, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gerente",
  SUPERVISOR: "Supervisor",
  OPERATOR: "Operador",
};

export default function PerfilPage() {
  return (
    <AppShell>
      <Perfil />
    </AppShell>
  );
}

function Perfil() {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erroNome, setErroNome] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  useEffect(() => {
    currentUser()
      .then((u) => {
        setMe(u);
        setNome(u.name);
      })
      .catch((e: ApiError) => setErro(e.message || "Não consegui carregar seu perfil."));
  }, []);

  if (erro) return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  if (!me) return <Loading />;

  const papeis =
    me.roles.length > 0
      ? me.roles.map((r) => PAPEL_LABEL[r] ?? r).join(", ")
      : "Sem papel atribuido";

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
    // ⚠️ 640 e nao os 480 de antes: o cartao de notificacoes e uma GRADE
    // (uma coluna por papel), e em 480 as tres colunas se esmagavam.
    <div style={{ maxWidth: 640 }}>
      <PageHeader title="Meu perfil" />

      <Card className="flex max-w-[480px] flex-col gap-4">
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
          <div style={{ fontSize: 14 }}>{me.email}</div>
        </div>
        <div className="field">
          <span className="label">Papeis</span>
          <div style={{ fontSize: 14 }}>{papeis}</div>
        </div>

        <a
          href="/trocar-senha"
          className="btn btn-primary"
          style={{ alignSelf: "flex-start", padding: "8px 14px", textDecoration: "none" }}
        >
          Trocar senha
        </a>
      </Card>

      {/* ⚠️ O `id` E O DESTINO DO "Configurar" de `/notificacoes`
          (`/perfil#notificacoes`, Spec 054 §9.6). Tirar o id nao quebra
          nada visivelmente -- so faz o link cair no topo da pagina. */}
      <section id="notificacoes" className="mt-4 scroll-mt-4">
        <Card>
          <NotificationPreferences />
        </Card>
      </section>
    </div>
  );
}
