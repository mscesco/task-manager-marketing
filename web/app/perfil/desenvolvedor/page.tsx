"use client";
// Página de desenvolvedor (Spec 065): guia da API, chaves, webhooks e referência.
// Mora dentro do perfil; a aba aberta fica no `#` do endereço, para dar link direto.

import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import AppShell from "@/components/AppShell";
import ChavesDeApi from "@/components/ChavesDeApi";
import PageHeader from "@/components/PageHeader";
import Tabs, { type Tab } from "@/components/Tabs";

type Aba = "chaves";

const ABAS: readonly Tab<Aba>[] = [{ id: "chaves", label: "Chaves de API" }];

function abaDoEndereco(): Aba {
  const h = window.location.hash.slice(1);
  return ABAS.some((a) => a.id === h) ? (h as Aba) : ABAS[0].id;
}

export default function DesenvolvedorPage() {
  const [aba, setAba] = useState<Aba>(ABAS[0].id);

  useEffect(() => {
    setAba(abaDoEndereco());
  }, []);

  function escolher(id: Aba) {
    setAba(id);
    history.replaceState(null, "", `#${id}`);
  }

  return (
    <AppShell>
      <div className="max-w-[1100px]">
        <a href="/perfil" className="btn btn-ghost mb-2" style={{ padding: "2px 8px", fontSize: 13 }}>
          <ChevronLeft size={13} aria-hidden />
          Meu perfil
        </a>
        <PageHeader title="Desenvolvedor" />
        <Tabs tabs={ABAS} active={aba} onSelect={escolher} aria-label="Seções" group="dev" />
        <div role="tabpanel" aria-label={ABAS.find((a) => a.id === aba)?.label} className="pt-5">
          {aba === "chaves" && <ChavesDeApi />}
        </div>
      </div>
    </AppShell>
  );
}
