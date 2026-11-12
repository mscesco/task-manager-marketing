"use client";
// Renomear a organização no lugar: o lápis ao lado do título de `/organizacao` e o
// campo que ele abre. Entra como `titleAddon`, fora do `<h1>`. O estado "editando"
// é da página (prop `editing`), que esconde o título visível enquanto o campo está aberto.

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
    // Vazio: o backend recusaria com 422; barrar aqui só evita a viagem.
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
