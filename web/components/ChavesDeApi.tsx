"use client";
// Aba "Chaves de API" da página de desenvolvedor (Spec 065): criar, ver uma vez, revogar.

import { useEffect, useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import Loading from "@/components/Loading";
import SegredoUmaVez from "@/components/SegredoUmaVez";
import { useAvisar } from "@/components/Toasts";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  type ApiError,
  type ApiKey,
  type ApiKeyDays,
} from "@/lib/api";
import { dataParaTela } from "@/lib/baseTable";
import { dataHoraCurta, diaNoWorkspace } from "@/lib/prazo";

const VALIDADES: { dias: ApiKeyDays; rotulo: string }[] = [
  { dias: 30, rotulo: "30 dias" },
  { dias: 90, rotulo: "90 dias" },
  { dias: 365, rotulo: "1 ano" },
  { dias: null, rotulo: "Sem validade" },
];

export default function ChavesDeApi() {
  const avisar = useAvisar();
  const [chaves, setChaves] = useState<ApiKey[] | null>(null);
  const [criando, setCriando] = useState(false);
  const [nova, setNova] = useState<string | null>(null);

  useEffect(() => {
    listApiKeys()
      .then(setChaves)
      .catch((e: ApiError) => {
        setChaves([]);
        avisar(e.message || "Não consegui carregar as chaves.");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function revogar(k: ApiKey) {
    if (!window.confirm(`Revogar a chave “${k.name}”?\n\nO que usa esta chave para de funcionar na hora.`)) return;
    try {
      await revokeApiKey(k.id);
      setChaves((l) => l && l.filter((x) => x.id !== k.id));
    } catch (e) {
      avisar((e as ApiError).message || "Não consegui revogar a chave.");
    }
  }

  if (!chaves) return <Loading />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <p className="muted m-0 max-w-[620px] flex-1 text-sm">
          Use uma chave para chamar a API por fora: n8n, planilhas, scripts. Ela age como você,
          com as suas permissões, e para de funcionar se a sua conta for desativada.
        </p>
        {!criando && !nova && (
          <button type="button" className="btn btn-primary" onClick={() => setCriando(true)}>
            <Plus size={14} aria-hidden />
            Nova chave
          </button>
        )}
      </div>

      {criando && (
        <FormularioDeChave
          onCancelar={() => setCriando(false)}
          onCriada={(k) => {
            setCriando(false);
            setNova(k.key);
            const { key: _, ...semAChave } = k;
            setChaves((l) => [semAChave, ...(l ?? [])]);
          }}
        />
      )}

      {nova && (
        <SegredoUmaVez
          titulo="Sua chave nova. Guarde agora: depois ela não aparece de novo."
          rotulo="Chave de API"
          valor={nova}
          onPronto={() => setNova(null)}
        />
      )}

      {chaves.length === 0 ? (
        !criando && (
          <EmptyState
            title="Nenhuma chave ainda."
            description="Crie uma para começar a usar a API. O guia mostra o primeiro passo."
          />
        )
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-lg border border-border p-0">
          {chaves.map((k) => (
            <LinhaDaChave key={k.id} chave={k} onRevogar={() => void revogar(k)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FormularioDeChave({
  onCancelar,
  onCriada,
}: {
  onCancelar: () => void;
  onCriada: (k: ApiKey & { key: string }) => void;
}) {
  const [nome, setNome] = useState("");
  const [soLeitura, setSoLeitura] = useState(true);
  const [dias, setDias] = useState<ApiKeyDays>(90);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar() {
    if (!nome.trim()) {
      setErro("Dê um nome à chave, para lembrar onde ela é usada.");
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      onCriada(await createApiKey({ name: nome.trim(), read_only: soLeitura, days: dias }));
    } catch (e) {
      setErro((e as ApiError).message || "Não consegui criar a chave.");
      setEnviando(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3.5 rounded-lg border border-border bg-surface-2 p-4"
      aria-label="Nova chave de API"
      onSubmit={(e) => {
        e.preventDefault();
        void criar();
      }}
    >
      <div className="field">
        <label className="label" htmlFor="chave-nome">
          Nome
        </label>
        <input
          id="chave-nome"
          className="input max-w-[360px]"
          placeholder="Ex.: Painel no Looker"
          value={nome}
          maxLength={80}
          autoFocus
          onChange={(e) => setNome(e.target.value)}
        />
      </div>
      <fieldset className="field m-0 border-0 p-0">
        <legend className="label mb-1.5">O que ela pode fazer</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="chave-poder" checked={soLeitura} onChange={() => setSoLeitura(true)} />
            Só ler
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="chave-poder" checked={!soLeitura} onChange={() => setSoLeitura(false)} />
            Ler e alterar
          </label>
        </div>
      </fieldset>
      <div className="field">
        <label className="label" htmlFor="chave-validade">
          Validade
        </label>
        <select
          id="chave-validade"
          className="input w-[180px]"
          value={dias === null ? "" : String(dias)}
          onChange={(e) => setDias(e.target.value === "" ? null : (Number(e.target.value) as ApiKeyDays))}
        >
          {VALIDADES.map((v) => (
            <option key={v.rotulo} value={v.dias === null ? "" : String(v.dias)}>
              {v.rotulo}
            </option>
          ))}
        </select>
      </div>
      {erro && (
        <div className="error-box text-xs" role="alert">
          {erro}
        </div>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={enviando}>
          Criar chave
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function LinhaDaChave({ chave: k, onRevogar }: { chave: ApiKey; onRevogar: () => void }) {
  const expirada = k.expires_at !== null && new Date(k.expires_at) <= new Date();
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3">
      <KeyRound size={15} aria-hidden className="shrink-0 text-ink-faint" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <strong className="truncate text-sm">{k.name}</strong>
          <code className="text-xs text-ink-faint">{k.prefix}…</code>
          <Badge tone="soft" size="sm" color={k.read_only ? "var(--teal)" : "var(--accent)"}>
            {k.read_only ? "Só ler" : "Ler e alterar"}
          </Badge>
          {expirada && <span className="text-xs font-semibold text-danger">Expirada</span>}
        </span>
        <span className="text-xs text-ink-faint">
          {k.expires_at === null
            ? "Sem validade"
            : `${expirada ? "Expirou" : "Expira"} em ${dataParaTela(diaNoWorkspace(k.expires_at))}`}
          {" · "}
          {k.last_used_at ? `Usada por último em ${dataHoraCurta(k.last_used_at)}` : "Nunca usada"}
        </span>
      </div>
      <button
        type="button"
        className="btn btn-ghost text-danger"
        onClick={onRevogar}
        aria-label={`Revogar a chave ${k.name}`}
      >
        Revogar
      </button>
    </li>
  );
}
