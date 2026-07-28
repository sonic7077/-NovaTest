# Midscene Replanning And Batch Focus Design

## Goal

Prevent Web UI cases from failing solely because Midscene reaches its implicit
20-cycle replanning limit, and take users directly from a project asset batch
submission to the corresponding selected execution task.

## Replanning Configuration

The production runner will resolve `MIDSCENE_REPLANNING_CYCLE_LIMIT` before it
creates a `PlaywrightAgent`.

- The default is 40 cycles.
- A configured value must be an integer from 1 through 80.
- Missing, non-numeric, fractional, or out-of-range values fall back to 40.
- The resolved number is passed as `replanningCycleLimit` in the agent options.
- `.env.example` documents the setting. Local `.env` values remain untracked.

The runner will not relabel Midscene's failure as a timeout. Reports retain the
original error so an actual timeout remains distinguishable from a planning
limit or a test-step problem.

## Batch Execution Navigation

After `POST /api/batches` returns a new batch, the assets page will navigate to
the execution center with both identifiers:

`#/executions?projectId=<project-id>&focus=<batch-id>`

On entering the execution center, the project filter will apply the requested
project when it still exists. The task list will then choose the requested
batch when present. Without a URL focus value, the existing behavior of
selecting the first visible task remains unchanged.

The same URL parsing is shared with the existing single-run focus behavior;
the project parameter is optional so existing deep links keep working.

## Tests And Verification

Tests will prove that the replanning resolver accepts valid values, falls back
for invalid input, and forwards the resolved option to the Midscene agent.
They will also prove that a successful batch submission creates an execution
URL containing its project and task IDs, and that execution filtering honors
the requested project before resolving the focused task.

After implementation, the complete automated test suite will run. The local
service will restart on port 4173, and a read-only Web UI case will be run to
confirm the produced report no longer fails at the implicit 20-cycle limit.
