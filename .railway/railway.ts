import { bucket, defineRailway, github, group, project, service, volume } from "railway/iac";

// money-mcp in this Railway project belongs to the money-app repo, so this file
// owns only TREK's resources. Without the partial, an apply would delete it.
export const partial = "TREK-railway";

export default defineRailway(() => {
  const trekRailwayVolume = volume("trek-railway-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "europe-west4-drams3a", sizeMB: 5000 });
  const integratedDuffel = bucket("integrated-duffel", { region: "ams" });
  const TREKRailway = service("TREK-railway", {
    source: github("jaksiri/TREK-railway", { branch: "main", checkSuites: false }),
    // Dockerfile.railway adds the entrypoint that links data/ and uploads/ into the volume.
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile.railway" },
    healthcheck: "/api/health",
    healthcheckTimeout: 10,
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 3 },
    replicas: { "europe-west4-drams3a": 1 },
    domains: ["trek.jaksiri.com"],
    networking: { privateNetworkEndpoint: "trek-railway" },
    volumeMounts: { "/app/storage": trekRailwayVolume },
  });
  const TREKRailway2 = group("TREK-railway", [TREKRailway, integratedDuffel]);

  return project("Side Projects", {
    variables: { managed: false },
    resources: [trekRailwayVolume, TREKRailway2],
  });
});
