"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { changePassword, getToken, getMe, ApiError } from "@/lib/api";

export default function TrocarSenhaPage() {
  const router = useRouter();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  // Esta tela tem DOIS usos e so atendia um deles:
  //   1. primeiro acesso -- o AppShell joga a pessoa pra ca e ela NAO pode
  //      sair (must_change_password bloqueia o resto do produto);
  //   2. troca voluntaria -- ela clicou "Trocar senha" no /perfil.
  // No caso 2 nao havia saida nenhuma: sem AppShell, sem link, sem botao.
  // Quem abriu por engano ficava preso no Voltar do browser.
  //
  // `null` = ainda nao sei. Falha da chamada cai em `false` (mostra a saida)
  // de proposito: se a pessoa for mesmo obrigada, o AppShell do /perfil a
  // devolve pra ca -- errar pro lado da saida nao abre buraco, errar pro
  // lado da prisao sim.
  const [forcado, setForcado] = useState<boolean | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    let vivo = true;
    getMe()
      .then((u) => {
        if (vivo) setForcado(u.must_change_password);
      })
      .catch(() => {
        if (vivo) setForcado(false);
      });
    return () => {
      vivo = false;
    };
  }, [router]);

  async function trocar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (nova.length < 8) return setErro("A nova senha precisa de ao menos 8 caracteres.");
    if (nova !== confirma) return setErro("As senhas não conferem.");
    if (nova === atual) return setErro("A nova senha precisa ser diferente da atual.");
    setCarregando(true);
    try {
      await changePassword(atual, nova);
      // Volta pra onde a pessoa estava: primeiro acesso cai no quadro (era o
      // destino que o login queria); troca voluntaria volta pro perfil.
      router.replace(forcado === false ? "/perfil" : "/quadro");
    } catch (err) {
      const e = err as ApiError;
      setErro(
        e.status === 401 ? "Senha atual incorreta." : e.message || "Não foi possível trocar."
      );
      setCarregando(false);
    }
  }

  return (
    <div className="center-screen">
      <form
        onSubmit={trocar}
        style={{
          width: 380, background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 14, padding: 32, boxShadow: "var(--shadow)",
          display: "flex", flexDirection: "column", gap: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 20, letterSpacing: "-0.02em" }}>
            {forcado === false ? "Trocar senha" : "Defina sua senha"}
          </h1>
          {/* Enquanto nao sei (null), o texto do primeiro acesso e o palpite
              seguro: quem chega aqui obrigado e a maioria, e a frase some
              sozinha quando a resposta chega. */}
          {forcado !== false && (
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
              No primeiro acesso você precisa trocar a senha provisória por uma sua.
            </p>
          )}
        </div>

        {erro && <div className="error-box">{erro}</div>}

        <div className="field">
          <label className="label">
            {forcado === false ? "Senha atual" : "Senha atual (provisória)"}
          </label>
          <input className="input" type="password" value={atual}
            onChange={(e) => setAtual(e.target.value)} required autoComplete="current-password" />
        </div>
        <div className="field">
          <label className="label">Nova senha</label>
          <input className="input" type="password" value={nova}
            onChange={(e) => setNova(e.target.value)} required autoComplete="new-password"
            placeholder="ao menos 8 caracteres" />
        </div>
        <div className="field">
          <label className="label">Confirme a nova senha</label>
          <input className="input" type="password" value={confirma}
            onChange={(e) => setConfirma(e.target.value)} required autoComplete="new-password" />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* So aparece na troca VOLUNTARIA. Em primeiro acesso nao ha pra
              onde voltar -- o resto do produto esta bloqueado, e um "Cancelar"
              que nao cancela nada e pior que nenhum. */}
          {forcado === false && (
            <a
              href="/perfil"
              className="btn btn-ghost"
              style={{ textDecoration: "none", padding: "8px 14px" }}
            >
              Voltar
            </a>
          )}
          <button
            className="btn btn-primary"
            type="submit"
            disabled={carregando}
            style={{ marginLeft: "auto" }}
          >
            {carregando ? "Salvando…" : forcado === false ? "Salvar" : "Salvar e entrar"}
          </button>
        </div>
      </form>
    </div>
  );
}
