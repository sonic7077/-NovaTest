# Lighthouse Project Login Design

## Goal

Give all Web UI test cases in the Lighthouse project a common, protected login
flow for `dt.chenmoyuan.tech` before their case-specific steps run.

## Scope

- Apply only to Web UI cases assigned to the Lighthouse project and targeting
  `https://dt.chenmoyuan.tech`.
- Read the account, password, and TOTP seed only from local environment
  variables.
- Generate a current six-digit TOTP code during every test run.
- Repair the long-lived Playwright browser when its connection becomes invalid.

## Non-Goals

- Do not persist website credentials in SQLite.
- Do not expose credentials or TOTP codes in case definitions, run variables,
  logs, screenshots, reports, or Git.
- Do not add a credentials editor to the platform UI.
- Do not share cookies or browser contexts between runs.

## Configuration

The ignored local `.env` file must define `LIGHTHOUSE_EMAIL`,
`LIGHTHOUSE_PASSWORD`, and `LIGHTHOUSE_TOTP_SECRET` with the values supplied
by the project owner.

The project configuration stores only a non-secret login policy identifier,
`lighthouse`, and its expected host. Missing or malformed local configuration
causes the run to fail before the target site is contacted, with a
credential-configuration error that contains no secret value.

## Runtime Flow

1. `RunService` builds a run context from the test case and its project login
   policy.
2. The Web Runner opens a fresh browser context and page for the run.
3. The Lighthouse login helper navigates to the case base URL, selects
   account-password login, fills the email and password with Playwright
   locators, generates a TOTP code with the existing TOTP service, and submits
   the form.
4. The helper verifies that the authenticated task view is present before the
   first case step begins.
5. Midscene receives only the case-specific instructions. It never receives
   credentials or an instruction containing the literal secret variable names.
6. The browser context is closed when the run finishes, whether it passes or
   fails.

Each test run performs its own login. Batch runs do not share authentication
state, so parallel and retried cases cannot inherit stale sessions.

## Browser Lifecycle

`ProductionRunner` owns a browser factory rather than an unchecked singleton.
Before creating a context, it checks whether the browser is connected. If the
browser has been closed, it launches one replacement browser and retries the
context creation once. The replacement covers the observed
`Target page, context or browser has been closed` failure without hiding other
browser errors.

## Evidence and Errors

- Successful login produces normal step evidence after authentication, but no
  login screenshot that could expose form content.
- Login failure is stored as a concise, secret-free error such as
  `Lighthouse login failed: authentication form was not accepted`.
- Reports retain the normal case result and evidence. They do not display a
  credential section or add secrets to run variables.

## Tests

- Project policy resolution matches the Lighthouse project and host only.
- Missing local credentials fail before navigation.
- The login helper fills the generated code and reaches the authenticated page
  using a mocked Playwright page.
- A non-Lighthouse Web UI case bypasses the login helper.
- A disconnected browser is relaunched and context creation succeeds.
- A rendered report does not contain any configured secret value.
