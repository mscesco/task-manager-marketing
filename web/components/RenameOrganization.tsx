"use client";
// components/RenameOrganization.tsx
// Renomear a organização, no lugar -- o lápis ao lado do título de
// `/organizacao`, e o campo que ele abre.
//
// ⚠️ MORA AO LADO DO `<h1>`, E NÃO DENTRO (revisão de títulos, 21/09). Até aqui
// o lápis, o campo, o ✓, o ✕ e a mensagem de erro eram o `title` do
// `PageHeader` -- tudo dentro do `<h1>`. O leitor de tela anunciava o título
// como "UniFECAF Renomear a organização", e no modo de edição o título virava
// um campo, dois botões e às vezes um erro. Agora a página passa o nome como
// `title` e este componente como `titleAddon`.
//
// ⚠️ O ESTADO "EDITANDO" É DA PÁGINA, e não daqui: enquanto o campo está
// aberto, o título visível some (o campo mostra o nome), mas o `<h1>` continua
// lá para o leitor de tela. Quem decide o que o título mostra precisa saber se
// se está editando -- por isso `editing` entra como prop.
//
// ⚠️ MORA EM `components/`, e não em `app/`, para ter guardião: o `include` do
// vitest não lê `app/`.

import { useEffect, useState } from "react";
import { Check, Pencil, X } from "lucide-react";

import type { ApiError } from "@/lib/api";

export default function RenameOrganization({
  name,
  editing,
  onEditingChange,
  onRename,
}: {
  name: string;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onRename: (next: string) => Promise<void>;
}) {
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setValue(name), [name]);

  function close() {
    onEditingChange(false);
    setValue(name);
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="btn btn-ghost"
        aria-label="Renomear a organização"
        onClick={() => {
          setError(null);
          onEditingChange(true);
        }}
      >
        <Pencil size={14} aria-hidden="true" />
      </button>
    );
  }

  async function save() {
    const next = value.trim();
    // ⚠️ Vazio não é renomear -- e o backend recusaria com 422. Barrar aqui
    // evita a viagem; a recusa de verdade continua sendo dele.
    if (next === "" || next === name) {
      close();
      return;
    }
    setSaving(true);
    try {
      await onRename(next);
      onEditingChange(false);
      setError(null);
    } catch (e) {
      const a = e as ApiError;
      setError(
        a.status === 403
          ? "Só quem administra a organização pode renomeá-la."
          : a.message || "Não consegui renomear.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input
        className="input"
        aria-label="Nome da organização"
        value={value}
        disabled={saving}
        autoFocus
        maxLength={255}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") close();
        }}
        style={{ fontSize: 18, width: 280 }}
      />
      {/* ⚠️ OS DOIS BOTÕES SÃO SÓ ÍCONE, e até 21/09 não tinham nome nenhum:
          o leitor de tela anunciava "botão" e mais nada (WCAG 4.1.2). */}
      <button
        type="button"
        className="btn btn-ghost"
        aria-label="Salvar o nome"
        onClick={() => void save()}
        disabled={saving}
      >
        <Check size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        aria-label="Cancelar"
        onClick={close}
        disabled={saving}
      >
        <X size={16} aria-hidden="true" />
      </button>
      {error && (
        <span className="error-box" role="alert" style={{ fontSize: 12 }}>
          {error}
        </span>
      )}
    </span>
  );
}
