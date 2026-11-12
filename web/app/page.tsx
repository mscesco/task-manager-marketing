"use client";
// Rota raiz: com token vai para a tela inicial, sem token para o login.
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
