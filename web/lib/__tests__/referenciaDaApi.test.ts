import { describe, expect, it } from "vitest";

import type { OpenApi } from "@/lib/api";
import { filtrar, rotasPorAssunto, tipoDe } from "@/lib/referenciaDaApi";

const API: OpenApi = {
  paths: {
    "/api/v1/tasks": {
      get: {
        tags: ["tasks"],
        description: "Lista tarefas.\nRespeita a lente de time.",
        parameters: [{ name: "q", in: "query", schema: { anyOf: [{ type: "string" }, { type: "null" }] } }],
      },
      post: {
        tags: ["tasks"],
        summary: "Create Task",
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Criar" } } } },
      },
    },
    "/api/v1/tasks/{task_id}": {
      patch: {
        tags: ["tasks"],
        description: "Edita.",
        parameters: [{ name: "task_id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      },
    },
    "/api/v1/bases": { get: { tags: ["bases"], description: "Lista as Bases." } },
    "/health": { get: { tags: ["health"] } },
  },
  components: {
    schemas: {
      Criar: {
        properties: {
          title: { type: "string" },
          status: { $ref: "#/components/schemas/Status" },
          assignee_ids: { type: "array", items: { type: "string", format: "uuid" } },
        },
        required: ["title"],
      },
      Status: { enum: ["BACKLOG", "DONE"] },
    },
  },
};

describe("rotasPorAssunto", () => {
  const assuntos = rotasPorAssunto(API);

  it("agrupa por assunto, tarefas primeiro, e deixa de fora o health", () => {
    expect(assuntos.map((a) => a.nome)).toEqual(["Tarefas", "Bases"]);
  });

  it("resumo da docstring, ou do nome da função quando não há docstring", () => {
    const [listar, criar] = assuntos[0].rotas;
    expect(listar).toMatchObject({ metodo: "GET", resumo: "Lista tarefas.", descricao: "Respeita a lente de time." });
    expect(criar.resumo).toBe("Create Task");
  });

  it("campos do caminho, da query e do corpo, com o tipo em português", () => {
    const [listar, criar, editar] = assuntos[0].rotas;
    expect(listar.campos).toEqual([
      { nome: "q", tipo: "texto (ou null)", obrigatorio: false, descricao: undefined, onde: "query" },
    ]);
    expect(editar.campos[0]).toMatchObject({ nome: "task_id", tipo: "id", obrigatorio: true, onde: "caminho" });
    expect(criar.campos.map((c) => [c.nome, c.tipo, c.obrigatorio])).toEqual([
      ["title", "texto", true],
      ["status", "um destes: BACKLOG, DONE", false],
      ["assignee_ids", "lista de id", false],
    ]);
  });
});

describe("filtrar", () => {
  it("casa caminho e resumo sem acento; assunto vazio some", () => {
    const so = filtrar(rotasPorAssunto(API), "BASES");
    expect(so.map((a) => a.nome)).toEqual(["Bases"]);
    expect(filtrar(rotasPorAssunto(API), "edita")[0].rotas.map((r) => r.metodo)).toEqual(["PATCH"]);
  });
});

describe("tipoDe", () => {
  it("objeto referenciado diz o nome", () => {
    expect(tipoDe({ $ref: "#/components/schemas/Criar" }, API)).toBe("objeto Criar");
  });
});
