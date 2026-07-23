# Project Test Asset Organization Design

## Goal

Introduce projects as the first-level owner of test assets. Every Web UI and API test case belongs to one project, and authors create, edit, select, and batch-run cases inside that project.

Existing saved cases must remain usable. Migration creates a single `默认项目` project and assigns all existing cases to it. Historical runs and reports remain associated with their original case IDs and are not deleted or rewritten.

## Data Model And Migration

SQLite gains a `projects` table containing `id`, `name`, `created_at`, and `updated_at`. Project names are trimmed, required, and unique under case-insensitive comparison.

`test_cases` gains a required `project_id`. Store initialization performs an idempotent migration:

1. Create the `projects` table and its name index when absent.
2. Add `project_id` to `test_cases` when absent.
3. Ensure the `默认项目` record exists.
4. Set every null or empty legacy `project_id` to that default project's ID.
5. Create an index on `test_cases.project_id`.

The in-memory and legacy file stores expose the same project-aware contract for tests and fallback compatibility. New cases require a valid project ID; an unknown project is rejected.

## API Contract

Project endpoints are added under `/api/projects`:

- `GET /api/projects` lists projects with their case totals.
- `POST /api/projects` creates a project from `{ name }`.
- `PUT /api/projects/:id` renames a project.
- `DELETE /api/projects/:id` deletes an empty project only; a non-empty project returns a conflict response and leaves its cases and reports intact.

Case APIs remain at `/api/cases`, preserving backward-compatible IDs and payloads. `GET /api/cases` accepts `projectId` in addition to `q`; its result contains only cases belonging to that project when supplied. Create and update validate `projectId`, and case responses include it.

Batch execution remains case-ID based. The API verifies that all requested cases share one project before scheduling a batch. A mixed-project request is rejected with a clear validation error. Existing single-case execution continues unchanged.

## User Experience

The Test Assets landing view becomes a project directory. It lists project name, Web UI/API case totals, last update time, and actions to open, rename, or delete an empty project. A prominent create-project action is the only way to begin a new asset tree.

Opening a project changes the asset context to that project and displays its existing type filter, search, case table, and batch selection. The header identifies the active project and provides a return-to-projects action. New Web UI/API actions use project-specific routes and assign the active project automatically.

Case editor metadata shows the owning project. It is a dropdown of available projects so a case can be moved deliberately; routes and save behavior preserve the selected project. The editor rejects saving until a valid project is selected.

The workbench stays execution and results focused. It does not gain project CRUD. Project is shown as supporting execution context where a selected batch has one, and mixed-project batch selection is prevented by the asset view and defended by the server.

## Routes

The project-aware routes are:

- `#/assets` - project directory.
- `#/projects/:projectId/assets` - cases in a project.
- `#/projects/:projectId/assets/new-web` - new Web UI case in that project.
- `#/projects/:projectId/assets/new-api` - new API case in that project.
- `#/projects/:projectId/assets/:caseId` - edit a case while retaining project context.

Legacy `#/assets/new-web`, `#/assets/new-api`, and `#/assets/:caseId` remain readable where practical and redirect to the case's project-aware route. They are not emitted by new navigation.

## Failure Handling

Empty, duplicate, and unknown project names show a validation error without changing stored data. Deleting a non-empty project is blocked and tells the user to move or remove cases first. Missing or deleted project IDs in a route return the user to the project directory with an error. A stale case URL is handled by the existing not-found editor state.

## Verification

Automated coverage verifies migration of legacy cases to `默认项目`, project CRUD validation, project-filtered case listing, project assignment on save, and rejection of mixed-project batches. Browser checks cover creating a project, creating both case types inside it, filtering its asset list, editing a case, and scheduling a batch from that project.
