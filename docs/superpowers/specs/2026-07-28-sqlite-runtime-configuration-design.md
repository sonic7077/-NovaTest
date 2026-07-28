# SQLite Runtime Configuration Design

## Goal

Make SQLite the single source of business runtime configuration so code can be deployed through the normal Git workflow and a separately delivered data package can make the server runnable without an environment configuration file.

## Scope

- Store Midscene model, CMS API, and Lighthouse login configuration in `data/novatest.db`.
- Keep code deployment in Git; do not create a code archive.
- Create one data archive containing `data/novatest.db` for server deployment.
- Do not add a new configuration UI, environment fallback chain, external secret service, or extra deployment modes.

## Storage

`platform_settings` gains one `runtime_config` record. Its JSON value contains three named groups:

```json
{
  "model": {
    "baseUrl": "https://model.example/api",
    "modelName": "vision-model",
    "modelFamily": "",
    "apiKey": "..."
  },
  "cms": {
    "baseUrl": "https://cms.example/api.php",
    "key": "...",
    "iv": "...",
    "appKey": "...",
    "username": "...",
    "password": "...",
    "googleSecret": "...",
    "oauthId": "...",
    "oauthType": "...",
    "version": "...",
    "bundleId": "...",
    "language": "...",
    "via": "..."
  },
  "lighthouse": {
    "projectName": "默认项目",
    "email": "...",
    "password": "...",
    "totpSecret": "..."
  }
}
```

The database therefore contains sensitive values. It is the sole data deployment artifact and must be transferred and stored only on the controlled test server. API responses, reports, logs, and the model page continue to redact values.

## Data Flow

1. A one-time bootstrap command reads the current local environment and saves a complete `runtime_config` record in SQLite.
2. Normal server startup reads only this SQLite record.
3. The entry point builds the Midscene Web runner, CMS runner, and Lighthouse login credentials from that record.
4. Missing configuration is reported as a missing SQLite configuration group or field, never as `missing CMS_*` environment variables.
5. The existing model page reads and updates the `model` section in the same SQLite record. It does not require a deployment environment key.

## Deployment And Packaging

Code is committed and deployed through the existing Git and Docker workflow. The data handoff command creates `artifacts/novatest-data-<timestamp>.tar.gz` containing only `data/novatest.db` and a short checksum manifest. It excludes `.env`, source files, `node_modules`, evidence, and reports.

The server operator replaces `/opt/auto_test/data/novatest.db` with the data package's database, then uses the normal code deployment/start command. No business configuration variables are required in `deploy/test.env`.

## Error Handling

- Bootstrap rejects incomplete model, CMS, or Lighthouse groups and leaves the database unchanged.
- Startup keeps the application available when a runtime configuration group is missing, but marks its affected runner unavailable with a SQLite-focused message.
- Saving invalid model data validates and initializes a candidate runner before changing the stored configuration or active runner.
- The data archive command fails if `data/novatest.db` does not exist and never packages ignored runtime directories.

## Verification

- Unit tests cover bootstrap, persistence, runner construction, redaction, and incomplete SQLite configuration.
- Existing Web UI, CMS API, and Lighthouse tests continue to pass without business environment values.
- Packaging test verifies the archive includes only the database and manifest.
- Final verification runs the full test suite, starts the service from SQLite-only data, checks `/api/health`, and inspects the produced archive.
