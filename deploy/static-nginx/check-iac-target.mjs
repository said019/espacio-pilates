import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { target } from "../../.railway/railway.ts";

// Validate a fresh describe-service export without reading variable values.
// This tool never queries or mutates Railway and never deploys an application.
export function checkTarget(snapshot) {
  const value = snapshot.structuredContent ?? snapshot;
  assert.equal(snapshot.projectId ?? value.projectId, target.projectId, "wrong project ID");
  assert.equal(value.service.id, target.serviceId, "wrong service ID: never select the web/API service");
  assert.equal(value.service.name, "frontend");
  assert.equal(value.service.state, "live");
  assert.equal(value.environment.id, target.environmentId, "wrong environment ID");
  assert.equal(value.environment.name, target.environment);
  assert.equal(value.staged, null, "pending environment changes require review");
  assert.deepEqual(value.stagedChanges, []);
  assert.equal(value.latestDeployment.status, "SUCCESS");
  assert.deepEqual(value.volumes, []);
  assert.deepEqual(value.tcpProxies, []);
  const source = { ...value.config.source };
  assert.ok(source.rootDirectory == null || source.rootDirectory === "/", "frontend context must stay at repository root");
  delete source.rootDirectory;
  assert.deepEqual(source, { repo: "said019/espacio-pilates", branch: "main", checkSuites: false });
  assert.deepEqual(value.config.build, {
    builder: "DOCKERFILE", buildEnvironment: "V3", dockerfilePath: "deploy/static-nginx/Dockerfile",
  });
  assert.deepEqual(value.config.deploy, {
    startCommand: "/usr/local/bin/start-static-nginx",
    useLegacyStacker: false,
    ipv6EgressEnabled: false,
    runtime: "V2",
    multiRegionConfig: { "europe-west4-drams3a": { numReplicas: 1 } },
  });
  assert.deepEqual(value.tracing, {
    tracingEnabled: false, autoInstrumentationEnabled: false, autoInstrumentationActive: false,
  });
  assert.equal(value.config.configFile, "/deploy/static-nginx/railway.json", "legacy adoption state changed; obtain a new reviewed baseline");
  assert.deepEqual([...value.variableNames].sort(), ["SERVE_MODE", "VITE_API_URL", "VITE_MP_PUBLIC_KEY"]);
  assert.deepEqual(value.config.networking, {
    serviceDomains: { "frontend-production-dcb15.up.railway.app": {} },
    customDomains: { "www.tuespaciopilates.com.mx": { port: 8080 } },
  });
  return { status: "PASS", serviceId: target.serviceId, deploymentId: value.latestDeployment.id, mode: "read-only pre-adoption identity check" };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, "Usage: node deploy/static-nginx/check-iac-target.mjs fresh-describe-service.json");
  console.log(JSON.stringify(checkTarget(JSON.parse(readFileSync(process.argv[2], "utf8")))));
}
