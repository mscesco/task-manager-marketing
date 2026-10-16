"use client";
// components/bases/ImportWizard.tsx
// Importar planilha na Base (Spec 057, 15/10) -- o assistente.
//
//   1. ARQUIVO   .xlsx ou .csv; a aba e a linha do cabeçalho.
//   2. COLUNAS   uma por uma: criar coluna nova (com o tipo, sugerido pelo
//                servidor olhando os valores), juntar com uma coluna que já
//                existe, ir para o título, ou ignorar.
//   3. CONFERIR  o servidor valida SEM gravar e diz os problemas pela linha
//                do arquivo; aí importa tudo, ou só as válidas.
//
// Serve as duas entradas que ela pediu: numa base que já existe
// (`base`), e criando uma base nova (`newBase`: o time raiz e o nome).
//
// ⚠️ O ARQUIVO VAI DE NOVO a cada passo (prévia, validar, importar): o
// servidor não guarda nada entre eles. O que se valida é o que se importa.

import { useMemo, useState } from "react";
import CaixaDeDialogo from "@/components/CaixaDeDialogo";
import {
  ApiError,
  fileToBase64,
  previewImport,
  runImport,
  type BaseColumn,
  type BaseColumnType,
  type ImportColumnPlan,
  type ImportPreview,
  type ImportResult,
} from "@/lib/api";
import { NOME_DO_TIPO, TIPOS_ESCOLHIVEIS } from "@/lib/baseTable";

type Target =
  | { kind: "existing"; baseId: string; columns: BaseColumn[] }
  | { kind: "new"; teams: { id: string; name: string }[]; defaultTeamId: string | null };

type Choice = { action: ImportColumnPlan["action"]; type: BaseColumnType; columnId: string | null };

export default function ImportWizard({
  target,
  onClose,
  onDone,
}: {
  target: Target;
  onClose: () => void;
  /** Importou: quantas linhas, e em qual base. */
  onDone: (result: ImportResult) => void;
}) {
  const [file, setFile] = useState<{ filename: string; content_base64: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [headerRow, setHeaderRow] = useState(1);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [newName, setNewName] = useState("");
  const [teamId, setTeamId] = useState(target.kind === "new" ? target.defaultTeamId : null);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existing = target.kind === "existing" ? target.columns : [];
  const title = existing.find((c) => c.type === "title");

  async function loadPreview(
    f: { filename: string; content_base64: string },
    s: string | null,
    h: number
  ) {
    setBusy(true);
    setError(null);
    setCheck(null);
    try {
      const p = await previewImport({ ...f, sheet: s, header_row: h });
      setPreview(p);
      setSheet(p.sheet);
      // Sugestão: a 1ª coluna vai para o título; a que tem o MESMO NOME de uma
      // coluna da base junta com ela; o resto vira coluna nova do tipo sugerido.
      setChoices(
        p.columns.map((c, i) => {
          const igual = existing.find(
            (e) => e.type !== "title" && e.name.trim().toLowerCase() === c.name.trim().toLowerCase()
          );
          if (i === 0) return { action: "title", type: "text", columnId: null };
          if (igual) return { action: "existing", type: c.suggested_type, columnId: igual.id };
          return { action: "new", type: c.suggested_type, columnId: null };
        })
      );
    } catch (e) {
      setError((e as ApiError).message || "Não consegui ler a planilha.");
    } finally {
      setBusy(false);
    }
  }

  async function pickFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return setError("O arquivo passa de 5 MB.");
    const content_base64 = await fileToBase64(f);
    const novo = { filename: f.name, content_base64 };
    setFile(novo);
    setNewName(f.name.replace(/\.(xlsx|xlsm|csv|txt)$/i, ""));
    await loadPreview(novo, null, 1);
  }

  const plan: ImportColumnPlan[] = useMemo(
    () =>
      (preview?.columns ?? []).map((c, i) => {
        const ch = choices[i];
        if (!ch) return { index: c.index, action: "ignore" };
        if (ch.action === "new") return { index: c.index, action: "new", name: c.name, type: ch.type };
        if (ch.action === "existing") return { index: c.index, action: "existing", column_id: ch.columnId };
        return { index: c.index, action: ch.action };
      }),
    [preview, choices]
  );

  async function submit(dryRun: boolean, skipInvalid = false) {
    if (!file || !preview) return;
    if (target.kind === "new" && (!newName.trim() || !teamId)) {
      return setError("Dê um nome para a base nova e escolha o time.");
    }
    setBusy(true);
    setError(null);
    try {
      const r = await runImport({
        ...file,
        sheet,
        header_row: headerRow,
        base_id: target.kind === "existing" ? target.baseId : null,
        new_name: target.kind === "new" ? newName.trim() : null,
        new_team_id: target.kind === "new" ? teamId : null,
        columns: plan,
        dry_run: dryRun,
        skip_invalid: skipInvalid,
      });
      if (dryRun) setCheck(r);
      else onDone(r);
    } catch (e) {
      setError((e as ApiError).message || "Não consegui importar.");
    } finally {
      setBusy(false);
    }
  }

  function setChoice(i: number, value: string) {
    // O <select> guarda "new:<tipo>", "existing:<id>", "title" ou "ignore".
    setCheck(null);
    setChoices((cs) =>
      cs.map((c, j) => {
        if (j !== i) return c;
        if (value.startsWith("new:")) return { action: "new", type: value.slice(4) as BaseColumnType, columnId: null };
        if (value.startsWith("existing:")) return { action: "existing", type: c.type, columnId: value.slice(9) };
        return { action: value as Choice["action"], type: c.type, columnId: null };
      })
    );
  }

  const usaTitulo = choices.filter((c) => c.action === "title").length;

  return (
    <CaixaDeDialogo ariaLabel="Importar planilha" largura={760} onEsc={onClose} onFundo={onClose}>
      <h2 className="m-0 mb-1 text-xl font-semibold">Importar planilha</h2>
      <p className="muted m-0 mb-4 text-sm">
        {target.kind === "new"
          ? "Cria uma base nova a partir de um arquivo .xlsx ou .csv."
          : "Adiciona as linhas de um arquivo .xlsx ou .csv a esta base."}
      </p>

      {/* 1. arquivo */}
      <section className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          1. Arquivo
          <input
            type="file"
            accept=".xlsx,.xlsm,.csv,.txt"
            className="text-sm font-normal"
            onChange={(e) => void pickFile(e.target.files?.[0])}
          />
        </label>
        {preview && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {preview.sheets.length > 1 && (
              <label className="flex items-center gap-1.5">
                Aba
                <select
                  className="input"
                  style={{ width: "auto" }}
                  value={sheet ?? ""}
                  onChange={(e) => file && void loadPreview(file, e.target.value, headerRow)}
                >
                  {preview.sheets.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex items-center gap-1.5">
              Cabeçalho na linha
              <input
                type="number"
                min={1}
                max={100}
                className="input"
                style={{ width: 70 }}
                value={headerRow}
                onChange={(e) => {
                  const n = Math.max(1, Number(e.target.value) || 1);
                  setHeaderRow(n);
                  if (file) void loadPreview(file, sheet, n);
                }}
              />
            </label>
            <span className="muted">{preview.total_rows} linhas no arquivo</span>
          </div>
        )}
      </section>

      {/* base nova: nome e time */}
      {preview && target.kind === "new" && (
        <section className="mt-4 flex flex-wrap gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm font-semibold">
            Nome da base
            <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </label>
          {target.teams.length > 1 && (
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Time
              <select className="input" value={teamId ?? ""} onChange={(e) => setTeamId(e.target.value || null)}>
                <option value="">Escolha…</option>
                {target.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>
      )}

      {/* 2. colunas */}
      {preview && (
        <section className="mt-4">
          <p className="m-0 mb-2 text-sm font-semibold">2. Colunas</p>
          <div className="max-h-[300px] overflow-y-auto rounded-md border border-border">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-surface-2">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">No arquivo</th>
                  <th className="px-3 py-2 text-left font-semibold">Exemplo</th>
                  <th className="px-3 py-2 text-left font-semibold">Vai para</th>
                </tr>
              </thead>
              <tbody>
                {preview.columns.map((c, i) => {
                  const ch = choices[i];
                  const value =
                    ch?.action === "new"
                      ? `new:${ch.type}`
                      : ch?.action === "existing"
                        ? `existing:${ch.columnId}`
                        : (ch?.action ?? "ignore");
                  return (
                    <tr key={c.index} className="border-t border-border">
                      <td className="px-3 py-2 font-semibold">{c.name}</td>
                      <td className="max-w-[200px] truncate px-3 py-2 text-ink-faint">
                        {c.sample.filter(Boolean).slice(0, 3).join(" · ") || "—"}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className="input"
                          aria-label={`Destino de ${c.name}`}
                          value={value}
                          onChange={(e) => setChoice(i, e.target.value)}
                        >
                          <option value="title">Título{title ? ` (${title.name})` : ""}</option>
                          <optgroup label="Coluna nova">
                            {TIPOS_ESCOLHIVEIS.map((t) => (
                              <option key={t} value={`new:${t}`}>
                                Nova: {NOME_DO_TIPO[t]}
                                {t === c.suggested_type ? " (sugerido)" : ""}
                              </option>
                            ))}
                          </optgroup>
                          {existing.filter((e) => e.type !== "title").length > 0 && (
                            <optgroup label="Juntar com">
                              {existing
                                .filter((e) => e.type !== "title")
                                .map((e) => (
                                  <option key={e.id} value={`existing:${e.id}`}>
                                    {e.name} ({NOME_DO_TIPO[e.type]})
                                  </option>
                                ))}
                            </optgroup>
                          )}
                          <option value="ignore">Ignorar</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {usaTitulo > 1 && (
            <p className="m-0 mt-2 text-sm text-danger" role="alert">
              Só uma coluna pode ir para o título.
            </p>
          )}
          <p className="muted m-0 mt-2 text-xs">
            Vários valores numa célula (seleção múltipla, pessoa, link): separe com “;”. Pessoa
            pelo nome ou e-mail de alguém do time. Datas como 14/10/2026.
          </p>
        </section>
      )}

      {/* 3. conferir */}
      {check && (
        <section className="mt-4 rounded-md border border-border p-3 text-sm" aria-live="polite">
          <p className="m-0 font-semibold">
            {check.valid} de {check.total} linhas prontas para importar
            {check.error_count > 0 && `, ${check.error_count} com problema`}.
          </p>
          {check.errors.length > 0 && (
            <ul className="m-0 mt-2 max-h-[160px] list-none overflow-y-auto p-0">
              {check.errors.map((e, i) => (
                <li key={i} className="border-t border-border py-1 first:border-t-0">
                  <strong>Linha {e.line}</strong> · {e.column}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {error && (
        <div className="error-box mt-3" role="alert">
          {error}
        </div>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancelar
        </button>
        {preview && !check && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || usaTitulo > 1}
            onClick={() => void submit(true)}
          >
            {busy ? "Conferindo…" : "Conferir"}
          </button>
        )}
        {check && check.error_count > 0 && check.valid > 0 && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit(false, true)}>
            Importar só as {check.valid} válidas
          </button>
        )}
        {check && check.error_count === 0 && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit(false)}>
            {busy ? "Importando…" : `Importar ${check.valid} linhas`}
          </button>
        )}
      </div>
    </CaixaDeDialogo>
  );
}
