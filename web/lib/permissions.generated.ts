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
  "base.create",
  "base.delete",
  "base.read",
  "base.restore",
  "base.update",
  "base_column.create",
  "base_column.delete",
  "base_column.update",
  "base_row.create",
  "base_row.delete",
  "base_row.update",
  "base_view.create",
  "base_view.delete",
  "base_view.update",
  "board.create",
  "board.create.root",
  "board.delete",
  "board.delete.root",
  "board.update",
  "board.update.root",
  "column.create",
  "column.delete",
  "column.update",
  "form.create",
  "form.delete",
  "form.publish",
  "form.read",
  "form.update",
  "membership.create",
  "membership.delete",
  "membership.move",
  "membership.update",
  "org_role.grant",
  "org_role.revoke",
  "organization.update",
  "person.create",
  "person.deactivate",
  "person.reactivate",
  "person.update",
  "project.archive",
  "project.create",
  "project.delete",
  "project.update",
  "solicitation.read",
  "solicitation.review",
  "subteam.create",
  "subteam.delete",
  "subteam.update",
  "task.archive",
  "task.assign",
  "task.create",
  "task.delete",
  "task.update",
  "team.create",
  "team.move",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
