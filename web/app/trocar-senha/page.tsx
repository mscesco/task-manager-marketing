"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { changePassword, getToken, getMe, ApiError } from "@/lib/api";

export default function TrocarSenhaPage() {
  const router = useRouter();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  // Dois usos: primeiro acesso (obrigado, sem saída) e troca voluntária pelo
  // /perfil. `null` = ainda não sei. Falha da chamada cai em `false` (mostra a
  // saída) de propósito: se a pessoa for obrigada, o AppShell do /perfil a devolve.
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
      // Primeiro acesso cai na tela inicial; troca voluntária volta pro perfil.
      router.replace(forcado === false ? "/perfil" : "/inicio");
    } catch (err) {
      const e = err as ApiError;
      // Senha atual errada vem como 422 com o texto do servidor; 401 aqui so
      // e a provisoria vencida, que tambem traz a propria mensagem.
      setErro(e.message || "Não foi possível trocar.");
      setCarregando(false);
    }
  }

  return (
    <div className="center-screen">
      <form
        onSubmit={trocar}
        className="login-rise flex w-full max-w-[440px] flex-col gap-5 rounded-2xl border border-border bg-surface p-9 shadow-[var(--shadow)]"
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
            <Lock size={18} aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <h1 className="m-0 text-[22px] font-extrabold tracking-[-0.02em]">
              {forcado === false ? "Trocar senha" : "Defina sua senha"}
            </h1>
            {/* Enquanto não sei (null), o texto do primeiro acesso é o palpite seguro. */}
            {forcado !== false && (
              <p className="muted m-0 text-base">
                Troque a senha provisória por uma sua para continuar.
              </p>
            )}
          </div>
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
          {/* Só na troca voluntária: em primeiro acesso não há para onde voltar. */}
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
