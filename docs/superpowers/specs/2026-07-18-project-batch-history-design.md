# Project Batch History Design

## Goal

Show recent batch execution records only for the project currently open in Test Assets. Batch history is a durable project record: moving or deleting a case later must not move or erase its existing batch history.

## Data Model And Migration

`test_batches` gains a `project_id` field. Every newly created batch stores the shared project ID of the selected cases after the existing same-project validation succeeds.

SQLite initialization performs an idempotent migration. It adds `project_id` when absent, ensures that `默认项目` exists, and assigns every legacy batch with a null or empty project ID to the default project. The field is indexed for project-history queries. The in-memory and file stores persist the same `projectId` property for batch fixtures and runtime compatibility.

Historical batch project ownership is immutable after creation. Deleting a case continues to preserve runs, reports, and batch records. Moving a case to another project changes only future executions; its prior batches retain the original project ID.

## API Contract

`POST /api/batches` continues to reject empty, duplicate, mixed-target, and mixed-project case selections. When successful it passes the resolved project ID to `BatchService.start`, which persists it with the batch.

`GET /api/batches` accepts optional `projectId`. With that query parameter it returns only batches whose persisted project ID matches it. Without a parameter it preserves the existing global history behavior for the workbench and backward compatibility.

`GET /api/batches/:id` remains unchanged and returns its existing run list. Project filtering is enforced on the collection endpoint; an individual historical batch remains reportable by ID.

## User Experience

The recent batch section inside `#/projects/:projectId/assets` requests `/api/batches?projectId=<activeProjectId>`. An empty project shows the existing empty-history state instead of records from other projects.

The workbench remains global and does not gain a project filter in this change. Its execution status and report links continue to operate for any run started by the current user interaction.

## Verification

Automated tests cover new batches storing a project ID, legacy batch migration to `默认项目`, repository filtering by project ID, and the API collection endpoint filtering without changing its unfiltered behavior. Browser verification opens a project with no batches and confirms it does not display default-project batch records, then opens the default project and confirms its historical records appear.
