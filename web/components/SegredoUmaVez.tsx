"use client";
// Um segredo que o servidor mostra uma vez só (a chave de API), com copiar.

import { useState } from "react";
import { Copy } from "lucide-react";

export default function SegredoUmaVez({
  titulo,
  rotulo,
  valor,
  onPronto,
}: {
  titulo: string;
  /** Nome acessível do campo. */
  rotulo: string;
  valor: string;
  onPronto: () => void;
}) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-accent bg-accent-soft p-4" role="status">
      <strong className="text-sm">{titulo}</strong>
      <div className="flex flex-wrap gap-2">
        <input
          className="input min-w-0 flex-1 font-mono text-xs"
          readOnly
          value={valor}
          aria-label={rotulo}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" className="btn" onClick={() => void copiar()}>
          <Copy size={14} aria-hidden />
          {copiado ? "Copiado" : "Copiar"}
        </button>
      </div>
      <div>
        <button type="button" className="btn btn-ghost" onClick={onPronto} style={{ padding: "2px 0" }}>
          Pronto, já guardei
        </button>
      </div>
    </div>
  );
}
