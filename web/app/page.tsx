"use client";
// Rota raiz: decide pra onde mandar. Tem token -> a tela inicial (Spec 058,
// §10.1: ela substituiu o quadro como entrada); senao -> login.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";

import { LoadingScreen } from "@/components/Loading";
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace(getToken() ? "/inicio" : "/login");
  }, [router]);
  return <LoadingScreen />;
}
