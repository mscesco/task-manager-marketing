// ⚠️ GERADO por `backend/scripts/gen_permissions_ts.py` -- NAO EDITE A MAO.
//
// A lista vem de `ALL_PERMISSIONS` (backend/app/modules/auth/domain/
// permissions.py). Mudou o mapa? Rode, de `backend/`:
//
//     docker compose run --rm api-dev python -m scripts.gen_permissions_ts
//
// e o `tsc` aponta cada tela que ainda usa um nome que saiu. O teste
// `backend/tests/test_permissions_generated_ts.py` falha se este arquivo
// estiver atrasado em relacao ao mapa.

export const PERMISSIONS = [
  "area.create",
  "board.manage.root",
  "board.manage.subteam",
  "member.manage.subteam",
  "project.create",
  "project.delete",
  "project.update",
  "solicitation.review",
  "solicitation_form.manage",
  "task.assign",
  "task.create",
  "task.delete",
  "task.update",
  "team.manage",
  "workspace.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
