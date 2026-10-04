import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import { createRailwayContext } from "../../.railway/node_modules/railway/dist/iac/index.js";
import program, { partial, target } from "../../.railway/railway.ts";
import { checkTarget } from "./check-iac-target.mjs";

const current = JSON.parse(readFileSync(new URL("./frontend-current-redacted.json", import.meta.url)));
const imported = JSON.parse(readFileSync(new URL("./frontend-import-redacted.json", import.meta.url))).resources[0];
const rendered = JSON.parse(JSON.stringify(await program(createRailwayContext(target))));
const frontend = rendered.resources[0];
const legacy = JSON.parse(readFileSync(new URL("./railway.json", import.meta.url)));

test("named partial owns only frontend, with no API, DB or shared variables", () => {
  assert.equal(partial, "espacio-frontend");
  assert.deepEqual(Object.keys(rendered).sort(), ["name", "resources"]);
  assert.equal(rendered.name, target.projectName);
  assert.equal(rendered.resources.length, 1);
  assert.equal(frontend.address, "service.frontend");
  assert.equal(frontend.name, current.service.name);
  assert.equal(frontend.type, "service");
  assert.deepEqual(Object.keys(frontend).sort(), ["address", "build", "deploy", "kind", "name", "networking", "source", "type", "variables"]);
});

for (const key of ["projectId", "projectName", "environmentId", "environment"]) {
  test(`rejects a different ${key}`, () => {
    assert.throws(() => program(createRailwayContext({ ...target, [key]: "other" })), /restricted/);
  });
}

test("serialized source/build/launcher retain the existing root frontend runtime", () => {
  assert.deepEqual(frontend.source, { ...imported.source, rootDirectory: "/" });
  assert.deepEqual(frontend.build, imported.build);
  assert.deepEqual(frontend.deploy, { ...imported.deploy, ...legacy.deploy });
  assert.equal("configFile" in frontend, false, "IaC must not select deprecated Config as Code");
});

test("all existing variable names and both domains survive SDK serialization", () => {
  assert.deepEqual(Object.keys(frontend.variables).sort(), [...current.variableNames].sort());
  for (const value of Object.values(frontend.variables)) assert.deepEqual(value, { type: "preserve" });
  assert.deepEqual(frontend.variables, imported.variables);
  assert.deepEqual(frontend.networking, imported.networking);
});

test("pre-adoption guard accepts the reviewed provider identity and rejects API/drift", () => {
  assert.equal(checkTarget(current).status, "PASS");
  const cases = [
    value => { value.service.id = "d92cc314-bbfc-49b2-b92d-653b687e0958"; },
    value => { value.projectId = "other"; },
    value => { value.environment.id = "other"; },
    value => { value.staged = { status: "STAGED" }; },
    value => { value.variableNames.push("NEW_VARIABLE"); },
    value => { value.config.build.dockerfilePath = "Dockerfile"; },
    value => { value.config.networking.customDomains = {}; },
  ];
  for (const alter of cases) {
    const changed = structuredClone(current); alter(changed);
    assert.throws(() => checkTarget(changed));
  }
});

test("shared API defaults and published Docker recipe remain byte-identical", () => {
  const proof = JSON.parse(readFileSync(new URL("./iac-source-hashes.json", import.meta.url)));
  assert.equal(proof.sourceSHA, "1795086b24e35402e29925f0efa4f017971cd9a7");
  for (const [path, expected] of Object.entries(proof.sha256)) {
    const bytes = readFileSync(new URL(`../../${path}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, path);
  }
  assert.equal(existsSync(new URL("../../Dockerfile", import.meta.url)), false);
  assert.equal(JSON.parse(readFileSync(new URL("../../.railway/node_modules/railway/package.json", import.meta.url))).version, "3.12.0");
});
