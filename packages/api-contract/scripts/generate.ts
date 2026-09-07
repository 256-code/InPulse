import {
  readCommittedFingerprints,
  renderArtifacts,
  writeArtifacts,
} from "../src/artifacts.js";

const fingerprints = await readCommittedFingerprints();
const artifacts = renderArtifacts(fingerprints);
await writeArtifacts(artifacts);
for (const artifact of artifacts) {
  process.stdout.write(`generated ${artifact.path}\n`);
}
