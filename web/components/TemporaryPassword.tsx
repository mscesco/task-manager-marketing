"use client";
// components/TemporaryPassword.tsx
// O bloco reveal-once da senha provisória (ADR 0008 / ADR 0021).
//
// ⚠️⚠️ O SEGREDO VOLTA UMA VEZ SÓ. Não há rota para relê-lo: quem fecha sem
// copiar precisa resetar de novo. Por isso o aviso é destacado e o botão de
// concluir é explícito -- fechar não pode ser acidental.
//
// ⚠️ MORA EM `components/` porque agora tem DOIS gatilhos em telas
// diferentes: o cadastro (em `/membros`) e o reset (na gaveta do membro, de
// qualquer tela que use a tabela). Duas cópias divergiriam no aviso -- e o
// aviso é a parte que evita a perda do segredo.

import { useState } from "react";

export default function TemporaryPassword({
  title,
  email,
  password,
  onClose,
}: {
  title: string;
  email: string;
  password: string;
  onClose: () => void;
}) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(password);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <div
      style={{
        border: "1px solid var(--accent)",
        borderRadius: 12,
        padding: 20,
        marginBottom: 16,
        background: "var(--accent-soft)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <strong style={{ fontSize: 14 }}>{title}</strong>
      <span className="muted" style={{ fontSize: 13 }}>
        {email}
      </span>
      <div style={{ fontSize: 13 }}>
        Senha provisória (o membro troca no 1º acesso):
      </div>
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
      >
        <code
          style={{
            fontSize: 15,
            fontWeight: 700,
            padding: "6px 12px",
            borderRadius: 8,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            userSelect: "all",
          }}
        >
          {password}
        </code>
        <button
          className="btn btn-ghost"
          onClick={copiar}
          style={{ padding: "6px 12px" }}
        >
          {copiado ? "Copiado!" : "Copiar"}
        </button>
      </div>
      <div
        style={{
          fontSize: 12.5,
          color: "var(--danger, #b42318)",
          fontWeight: 600,
        }}
      >
        Copie agora — esta senha não aparece de novo. Repasse ao membro pelo
        canal combinado.
      </div>
      <button
        className="btn btn-primary"
        onClick={onClose}
        style={{ alignSelf: "flex-start", padding: "6px 14px" }}
      >
        Concluir
      </button>
    </div>
  );
}
