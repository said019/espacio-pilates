import { defineRailway, github, preserve, project, service } from "railway/iac";

// Remote IDs are bound by the reviewed provider plan, not by the service name alone.
export const partial = "espacio-frontend";
export const target = Object.freeze({
  projectId: "2a511edb-99c9-47ec-bc7d-7bfea61fadb6",
  projectName: "espacio-pilates",
  environmentId: "10871e83-5c64-4f94-8601-66e527b6c8aa",
  environment: "production",
  serviceId: "e36c414c-21b9-4f86-8548-5a741b523dac",
});

export default defineRailway((ctx) => {
  for (const key of ["projectId", "projectName", "environmentId", "environment"] as const) {
    if (ctx[key] !== target[key]) {
      throw new Error("This partial is restricted to the existing Espacio production frontend");
    }
  }
  return project(target.projectName, { resources: [
    service("frontend", {
      source: github("said019/espacio-pilates", { branch: "main", checkSuites: false }),
      root: "/",
      build: {
        builder: "DOCKERFILE",
        dockerfilePath: "deploy/static-nginx/Dockerfile",
        buildEnvironment: "V3",
      },
      deploy: {
        startCommand: "/usr/local/bin/start-static-nginx",
        // These two values currently come from the selected legacy JSON.
        restartPolicyType: "ON_FAILURE",
        restartPolicyMaxRetries: 3,
        useLegacyStacker: false,
        ipv6EgressEnabled: false,
        runtime: "V2",
        multiRegionConfig: { "europe-west4-drams3a": { numReplicas: 1 } },
      },
      // SDK 3.12.0 serializes customDomains from this high-level field.
      domains: [{ domain: "www.tuespaciopilates.com.mx", port: 8080 }],
      networking: { serviceDomains: { "frontend-production-dcb15.up.railway.app": {} } },
      env: {
        SERVE_MODE: preserve(),
        VITE_API_URL: preserve(),
        VITE_MP_PUBLIC_KEY: preserve(),
      },
    }),
  ] });
});
