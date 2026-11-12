"use client";
// Editar a lista de links com nome de um projeto ou tarefa. Controlado: quem
// usa guarda o rascunho e salva junto com o resto do formulário. As regras
// moram em `lib/links.ts`.

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import {
  completarEndereco,
  errosDosLinks,
  linhaVazia,
  MAX_LINKS,
  moverLink,
  paraEnvio,
  TITULO_MAXIMO,
  type RascunhoLink,
} from "@/lib/links";

export default function EditorDeLinks({
  valor,
  onChange,
  desabilitado = false,
  mostrarErros,
  nomeOpcional = false,
}: {
  valor: RascunhoLink[];
  onChange: (novo: RascunhoLink[]) => void;
  desabilitado?: boolean;
  /** Os erros só aparecem depois de tentar salvar. */
  mostrarErros: boolean;
  /** Ver `errosDosLinks`: a célula da Base aceita link sem nome. */
  nomeOpcional?: boolean;
}) {
  const erros = errosDosLinks(valor, { nomeOpcional });
  const cheio = paraEnvio(valor).length >= MAX_LINKS;

  function trocar(i: number, campo: "title" | "url", texto: string) {
    onChange(valor.map((l, j) => (j === i ? { ...l, [campo]: texto } : l)));
  }

  return (
    <div className="flex flex-col gap-2">
      {valor.length === 0 && (
        <p className="muted text-xs">Nenhum link. Pasta do Drive, banco de imagens…</p>
      )}
      {valor.map((l, i) => {
        const erro = mostrarErros ? erros[i] : {};
        const idNome = `link-nome-${l.chave}`;
        const idUrl = `link-url-${l.chave}`;
        return (
          <div key={l.chave} className="flex flex-wrap items-start gap-2">
            <div className="flex min-w-[140px] flex-1 flex-col">
              <label className="sr-only" htmlFor={idNome}>
                Nome do link {i + 1}
              </label>
              <input
                id={idNome}
                className="input"
                placeholder={nomeOpcional ? "Nome (opcional)" : "Nome (ex.: Pasta principal)"}
                value={l.title}
                maxLength={TITULO_MAXIMO}
                disabled={desabilitado}
                aria-invalid={erro.title ? true : undefined}
                onChange={(e) => trocar(i, "title", e.target.value)}
              />
              {erro.title && <span className="mt-1 text-xs text-danger">{erro.title}</span>}
            </div>
            <div className="flex min-w-[180px] flex-[2] flex-col">
              <label className="sr-only" htmlFor={idUrl}>
                Endereço do link {i + 1}
              </label>
              <input
                id={idUrl}
                className="input"
                placeholder="drive.google.com/…"
                value={l.url}
                inputMode="url"
                disabled={desabilitado}
                aria-invalid={erro.url ? true : undefined}
                onChange={(e) => trocar(i, "url", e.target.value)}
                // Completa o https:// ao sair do campo, e não enquanto digita:
                // mexer no texto sob o cursor atrapalha quem está escrevendo.
                onBlur={() => {
                  const completo = completarEndereco(l.url);
                  if (completo !== l.url.trim()) trocar(i, "url", completo);
                }}
              />
              {erro.url && <span className="mt-1 text-xs text-danger">{erro.url}</span>}
            </div>
            <div className="flex items-center gap-1 pt-1">
              <button
                type="button"
                className="btn btn-ghost p-1"
                aria-label={`Subir o link ${i + 1}`}
                disabled={desabilitado || i === 0}
                onClick={() => onChange(moverLink(valor, i, -1))}
              >
                <ArrowUp size={14} aria-hidden />
              </button>
              <button
                type="button"
                className="btn btn-ghost p-1"
                aria-label={`Descer o link ${i + 1}`}
                disabled={desabilitado || i === valor.length - 1}
                onClick={() => onChange(moverLink(valor, i, 1))}
              >
                <ArrowDown size={14} aria-hidden />
              </button>
              <button
                type="button"
                className="btn btn-ghost p-1"
                aria-label={`Remover o link ${i + 1}`}
                disabled={desabilitado}
                onClick={() => onChange(valor.filter((_, j) => j !== i))}
              >
                <X size={14} aria-hidden />
              </button>
            </div>
          </div>
        );
      })}
      <div>
        <button
          type="button"
          className="btn btn-ghost inline-flex items-center gap-1 text-xs"
          disabled={desabilitado || cheio}
          title={cheio ? `No máximo ${MAX_LINKS} links.` : undefined}
          onClick={() => onChange([...valor, linhaVazia()])}
        >
          <Plus size={14} aria-hidden /> Adicionar link
        </button>
      </div>
    </div>
  );
}
