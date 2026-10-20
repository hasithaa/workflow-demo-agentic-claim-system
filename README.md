# An agent that follows the policy: an agentic expense claim demo

An expense claim run by a durable AI agent built in WSO2 Integrator. Ann files a claim and uploads the bill; the agent
reads the bill, checks it against the company's expense policy written in plain language, asks Ann for anything
missing, and asks her manager, Jane, with its own assessment. Payment waits for Ivy in finance to release it.

The agent decides the path; the workflow runtime keeps it durable. It waits for Ann's answer for days if it has to,
survives restarts, and never pays without a person releasing it.

This is the follow-up to [workflow-demo-simple-claim-app](https://github.com/hasithaa/workflow-demo-simple-claim-app),
where a fixed workflow ran the same claim. Same app, same people, same stack; an agent instead of a fixed flow.

## The use case

Ann claims 420.50 for a team dinner with a customer. The bill shows four set menus, a sea bass, sparkling water, two
bottles of house wine (78.00), service, and a total of 420.50. The expense policy says:

- Client entertainment needs the names of everyone who attended and the client's company; up to 120 per person.
- Alcohol is not reimbursed.
- Taxis for business travel are reimbursed with no further detail.
- The bill's total must match the amount claimed.

The agent reads the bill image line by line and asks Ann who attended and which client they were from. Once she
answers, Jane gets the approval task with the agent's assessment: 342.50 to pay (the wine left out), the per-person
amount against the 120 limit, and the bill's total against the claim. Jane approves; Ivy releases 342.50.

## Run it

You need Docker with Compose (about 6 GB of memory for Docker), and a WSO2 model provider token for the agent.

1. **Configure the model.** In WSO2 Integrator, open the `integration/` folder and run **Configure default WSO2
   Model Provider**. Copy `config/model.toml.example` to `config/model.toml`, and fill in `serviceUrl` and
   `accessToken` from the Config.toml the Integrator wrote. `config/model.toml` is not committed. The token
   expires; refresh it the same way.
2. **Start the stack:**

   ```sh
   docker compose up -d --build
   ```

   The first start builds the integration and pulls the images, so it takes a few minutes. When `docker compose ps`
   shows everything running, open **http://localhost:8080**.

Sign-in goes through **Thunder**, the identity provider, at https://localhost:8095. The first time, open
https://localhost:8095 and accept its self-signed certificate (the demo's own), then come back.

| User | Password | Groups | Can use |
|---|---|---|---|
| `ann@example.com` | `demo12345` | EMPLOYEE | **Expenses** (`/claims/`): file claims, upload bills, answer the agent |
| `jane@example.com` | `demo12345` | EMPLOYEE, MANAGER | **Expenses**, and **Approvals** (`/admin/`): approve or reject claims |
| `ivy@example.com` | `demo12345` | FINANCE | **Payments** (`/payments/`): release or hold payments |

The ICP console is at **https://localhost:9446**: **Sign in with SSO** as Jane or Ivy to see the agent's runs and
their tasks.

To start over with empty data: `docker compose down -v`. To keep the stack but clear the demo claims:
`scripts/reset.sh`. This demo uses the same ports as workflow-demo-simple-claim-app; stop that stack first if it is
running.

## Try it

1. Sign in as Ann at http://localhost:8080/claims/ and click **+ New claim**: "Team dinner with a customer",
   420.50. The claim shows **Bill required**, and on the right, what the expense assistant has done so far.
2. Drop the bill on the claim and click **Upload bill**. Watch the assistant work: it reads the bill (the line items
   appear as it read them), works out the amount to pay, and asks a question.
3. Answer the question in the box under it, for example "Ann Lee, Tom Reed and Priya Shah from Acme Corp, and Leo
   Park from our sales team." The claim moves to **Waiting for approval**.
4. In a private window, sign in as Jane at http://localhost:8080/admin/. The task shows the bill beside the lines the
   assistant read (the wine struck through), its policy checks and figures, and how it got there. Approve it.
5. In another private window, sign in as Ivy at http://localhost:8080/payments/: who is paid, who approved it and how
   the amount was worked out. Click **Release $342.50**. Ann's claim shows **Paid**.

Every page reads the assistant's steps from the Workflow Management API (the run's activity tree): nothing about
the agent is stored by the apps themselves. The **Progress** panel beside a claim is the apps' own reading of that tree
(`web/html/shared/agent.js`): it knows this integration's activities (`createClaim`, `readBill`, `subtract`,
`perPerson`, `updateClaim`, `askEmployee`, `payClaim`), its events (`bill`, `reply`), the manager's task and the payment review, and
words them for people. A step it does not know, for example an activity you named differently, still shows, by its
name. The claim's status and outcome are in the claims database; once the workflow runtime removes a finished run
(its retention period), the claim still shows its outcome and Progress says the history is no longer kept.

## What is inside

| Service | What it is | Port |
|---|---|---|
| `web` | nginx: Expenses (`/claims/`), Approvals (`/admin/`), Payments (`/payments/`), bill storage, and the gateway to the APIs | 8080 |
| `integration` | The expense integration from `integration/`: the Claims API, the `expenseAgent` durable agent, and the Workflow Management API | internal |
| `thunder` | Thunder 1.0.1, the identity provider: sign-in for the apps and the ICP console (`seed/thunder/`) | 8095 |
| `icp` | WSO2 Integration Control Plane 2.1.0 (`wso2/wso2-integration-control-plane`), with `icp/deployment.toml` | 9446 |
| `icp-seed` | Mints the secret the integration registers with ICP, on first start | |
| `temporal` | Temporal 1.29.7, the durable workflow runtime | 7233 |
| `mysql` | MySQL 8.4: claims, ICP and Temporal data (`db/` runs on first start) | 3306 |

### Versions

| Component | Version |
|---|---|
| Ballerina (the integration's build) | 2201.14.1 |
| `ballerina/workflow` | 1.0.0 |
| `ballerina/ai` (the WSO2 model provider) | 1.16.0 |
| WSO2 Integration Control Plane | 2.1.0 |
| Thunder | 1.0.1 |
| Temporal (`temporalio/auto-setup`) | 1.29.7 |
| MySQL | 8.4 |
| nginx | 1.30 |

### How sign-in works

As in the first demo: Thunder is the identity provider, the apps sign in with OpenID Connect (authorization code
with PKCE) and send the access token, a JWT, on every call. The Claims API validates it and takes the employee from
it; the Workflow Management API validates it and takes the user and roles from its claims, so Jane, in `MANAGER`,
sees the approval task and Ivy, in `FINANCE`, sees the payment review. Thunder's groups map to ICP roles in
`db/05-icp-sso.sql`. `scripts/token.sh ann@example.com` prints a token for scripts and API tests.

## The integration

`integration/` is the WSO2 Integrator project: open the folder in WSO2 Integrator to see the agent, its activities,
the HTTP service and the connection.

- **`expenseAgent`** (`agents.bal`) is a durable agent, and it is the workflow for each claim: every model call,
  activity, wait and task is recorded history. Its instructions carry the expense policy.
- **Activities** (`functions.bal`): `readBill` reads the bill image with the model (`ai:ImageDocument`) into the
  vendor, the date, the total and every line item; `updateClaim` records the status and note Ann sees; `askEmployee`
  puts the agent's question to Ann (the claim waits for her `reply` event); `payClaim` pays the claim, and is gated:
  the Workflow Management API holds it as a review for the `FINANCE` role until a person releases it.
- **Calculations:** `subtract` and `perPerson` are activities too, so every amount is computed in code (and
  recorded); the model never does the arithmetic.
- **Events:** `bill` (the uploaded bill) and `reply` (Ann's answers), which the agent waits for durably.
- **Human task:** `managerApproval` for the `MANAGER` role, carrying the agent's assessment.
- **The Claims API** (`main.bal`): `POST /claims` starts the agent and records the claim under the run's id;
  `POST /claims/{id}/bill` and `POST /claims/{id}/reply` send the bill and Ann's answers to that claim's agent run;
  `GET /claims` lists the signed-in employee's claims.

`prototype/expense_agent` is the in-memory prototype the integration grew from: the same agent with a driver that
plays Ann, Jane and Ivy.

## Known issues (ballerina/workflow 1.0.0)

- Activity arguments are not converted to their declared parameter types
  ([ballerina-library#9320](https://github.com/ballerina-platform/ballerina-library/issues/9320)). This integration's
  activities take plain values, so it is not affected.
- A human task's `taskInputType` is not shown to the model, and a mismatch is rejected without saying why
  ([ballerina-library#9323](https://github.com/ballerina-platform/ballerina-library/issues/9323)), so the agent can
  loop until it fails. `managerApproval` describes its fields in its description instead.
- Events arriving close together on a one-way agent channel log false failures
  ([ballerina-library#9321](https://github.com/ballerina-platform/ballerina-library/issues/9321)). Cosmetic.
