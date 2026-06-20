import { SentryCli } from "@sentry/cli";

const ORG     = "kyru-advisory";
const PROJECT = "kyru-backend";
const release = process.env.npm_package_version || "dev";

async function uploadSourceMaps() {
  const cli = new SentryCli(null, {
    authToken: process.env.SENTRY_AUTH_TOKEN,
    org:       ORG,
    project:   PROJECT,
  });

  console.log(`[sentry] Creating release ${release}…`);
  await cli.releases.new(release, { projects: [PROJECT] });

  console.log("[sentry] Uploading source maps from dist/…");
  await cli.releases.uploadSourceMaps(release, {
    include:   ["./dist"],
    urlPrefix: "~/dist",
  });

  await cli.releases.finalize(release);
  console.log(`[sentry] Release ${release} finalized.`);
}

uploadSourceMaps().catch((err) => {
  console.error("[sentry] Source map upload failed:", err);
  process.exit(1);
});
