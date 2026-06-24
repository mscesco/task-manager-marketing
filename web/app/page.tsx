"use client";
// Rota raiz: decide pra onde mandar. Tem token -> quadro; senao -> login.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace(getToken() ? "/quadro" : "/login");
  }, [router]);
  return <div className="center-screen muted">Carregando…</div>;
}
