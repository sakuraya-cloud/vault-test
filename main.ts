#!/usr/bin/env /home/vscode/.deno/bin/zx

import "zx/globals";

$.verbose = true;

await $`echo Hello, world!`;

try {
  await $`minikube status`;
} catch {
  await $`minikube start`;
}

await $`helmfile sync`;

const kv = $({
  prefix: "set -euo pipefail; kubectl exec -n vault vault-0 -- ",
});

try {
  await kv`vault status --format=json`;
} catch (e) {
  if (e.exitCode === 2) {
    const status = JSON.parse(e.stdout);

    if (status.initialized === false) {
      await kv`vault operator init -key-shares=1 -key-threshold=1 -format=json > /tmp/vault-init.json`;
      const init = JSON.parse((await $`cat /tmp/vault-init.json`).stdout);
      console.log(init);
      console.log("Unseal key: ", init.unseal_keys_b64[0]);
      console.log("Root token: ", init.root_token);
    }

    const init = JSON.parse((await $`cat /tmp/vault-init.json`).stdout);
    await kv`vault operator unseal ${init.unseal_keys_b64[0]}`;
  }
}
const init = JSON.parse((await $`cat /tmp/vault-init.json`).stdout);
await kv`vault login ${init.root_token}`;

const secrets = JSON.parse((await kv`vault secrets list --format=json`).stdout);
if (!secrets.hasOwnProperty("database/")) {
  await kv`vault secrets enable database`;
}
if (
  JSON.parse((await kv`vault list  --format=json database/config`).stdout).find(
    (v: string) =>
      v === "vault-postgres"
  ) === undefined
) {
  await kv`vault write database/config/vault-postgres \
    plugin_name="postgresql-database-plugin" \
    allowed_roles="vault-postgres" \
    connection_url="postgresql://{{username}}:{{password}}@postgres-postgresql.vault.svc.cluster.local:5432/postgres" \
    username="vaultuser" \
    password="vaultpass" \
    password_authentication="scram-sha-256"`;
}

if (
  JSON.parse((await kv`vault list  --format=json database/roles`).stdout).find(
    (v: string) =>
      v === "vault-postgres"
  ) === undefined
) {
await kv`vault write database/roles/vault-postgres \
  db_name="vault-postgres" \
  creation_statements="CREATE ROLE \\\"{{name}}\\\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; \
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO \\\"{{name}}\\\";" \
  default_ttl="1h" \
  max_ttl="24h"`;
}