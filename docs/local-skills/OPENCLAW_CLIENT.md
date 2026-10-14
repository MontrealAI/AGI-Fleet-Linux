# Pinned assistant client / Client assistant vérifié

The adapter targets **OpenClaw 2026.9.5**, verified against all 11,428 files in the repository's pinned artifact inventory. One fresh Gateway serves one Fleet actor. Its only offered tool is `fleet_local`; filesystem, shell, browser, scheduling, session exchange and memory tools are denied. The Gateway is a planner/client, and actual task execution remains in the isolated local backend. This is not a hostile multi-tenant boundary or protection against the host administrator.

The plugin accepts no model-supplied actor ID, URL, path or credential. It loads an operator-provisioned private actor credential, checks its server-side scope and role before every operation, and refuses an operator credential. Allowed operations are `status`, `inspect`, `prepare`, `run`, `cancel` and `output`. A model cannot authorize its own work, grant permissions, create actors, install software or read another actor. Revocation is enforced by the supervisor. A failed transport may hide a completed effect: inspect state rather than replaying a consumed grant.

## Development setup

Start the local supervisor, add and activate an actor, and issue a `client` credential for that actor through the operator CLI/API. Save the returned token in a caller-owned 0600 file outside the checkout. Never give the assistant an operator credential. Use a separately inspected fresh OpenClaw installation matching the existing runtime lock; no unrelated OAuth store or old profile is imported.

Create a private 0600 setup JSON with these fields. Replace every placeholder with an observed value; `model` must be a route selected by the operator, not an assumed subscription entitlement:

```json
{
  "client": {
    "actor": "ACTOR_UUID",
    "role": "agent",
    "agentId": "fleet-ACTOR_UUID",
    "origin": "http://127.0.0.1:OBSERVED_SUPERVISOR_PORT",
    "tokenFile": "/absolute/private/actor-client.token"
  },
  "directory": "/absolute/fresh-actor-assistant",
  "model": "APPROVED_PROVIDER/APPROVED_MODEL",
  "port": 19123,
  "openclaw": "/absolute/verified/node_modules/openclaw/openclaw.mjs"
}
```

```sh
node local-runtime/clients/openclaw/provision.mjs /absolute/private/setup.json --confirm
```

Provisioning observes the real local client scope, verifies the pinned OpenClaw inventory, creates a fresh home/workspace/state configuration, copies only the scoped client credential, and writes a private launch receipt. It starts nothing and performs no model call. Automatic updates, catalog refresh, telemetry, heartbeats and cron are disabled. It never imports provider sessions. Each actor needs its own profile and unused Gateway port; the verified code installation is shared.

The receipt distinguishes **local execution** from the selected **inference route** and says `inferenceQualified:false`. Live-provider authentication, availability, privacy, retry/call accounting and spending commissioning are still open gates; this source adapter does not qualify a paid inference route. Inspect the profile and follow the supported provider setup under that fresh profile only. No generic live route is advertised as ready. The CI example uses a local synthetic model transport with zero external inference charges.

When an assistant prepares work, open the local dashboard and refresh **Requests awaiting your decision**. Inspect the exact inputs, action, budget and expiry. Authorize that single request. The originating scoped assistant executes it; the operator dashboard cannot impersonate that client. Review real returned artifacts and retain failure evidence. STOP and client revocation remain available outside the assistant.

## Qualification

`qualification/openclaw-journey.mjs` verifies the pinned artifact, provisions a fresh profile, loads the actual role skill and plugin through the actual Gateway, then makes the assistant prepare and execute a real supervisor request with a separate operator approval. It requires exactly one offered tool and reopens actual report artifacts. CI runs it against the **saved extracted package and native sandbox**, asserting `actualSandbox:true` and `NATIVE_LOCAL_RUNTIME` evidence. The local troubleshooting flag `--synthetic-worker-boundary` is explicitly reported as `actualSandbox:false` and cannot satisfy that CI assertion. The model transport is synthetic in both cases; neither proves live model judgment or independent review.

## Français

Le client cible OpenClaw 2026.9.5 et vérifie son inventaire exact. Un profil Gateway neuf correspond à un acteur Fleet. Son seul outil est `fleet_local`; il ne reçoit ni shell, ni fichiers hôtes, ni mémoire d’autres acteurs, ni autorisation opérateur. Le serveur vérifie l’acteur et le rôle avant chaque opération. Une réponse de modèle ne peut pas élargir les permissions.

Après création et activation de l’acteur, fournissez uniquement son identifiant client privé. La commande ci-dessus crée un profil distinct et un reçu de lancement privé; elle ne démarre rien et n’appelle aucun modèle. N’importez pas un ancien profil ni les sessions OAuth d’un autre acteur. Le code vérifié peut être partagé, mais les profils, espaces de travail, sessions et identifiants restent distincts.

L’inférence payante, ses droits d’accès, sa confidentialité et ses limites restent à qualifier séparément. Le parcours CI utilise un transport de modèle synthétique local et l’exécution réelle du bac à sable; il ne prouve pas le jugement d’un fournisseur réel. L’exécution locale n’implique pas qu’un futur fournisseur d’inférence traitera les données localement.

Dans le tableau de bord, actualisez **Demandes en attente de votre décision**, examinez la portée exacte, puis autorisez une seule exécution. L’assistant d’origine peut alors exécuter la tâche. Examinez les résultats réels. En cas d’incertitude, inspectez l’état; ne répétez pas aveuglément la requête. L’ARRÊT et la révocation restent sous votre contrôle.
