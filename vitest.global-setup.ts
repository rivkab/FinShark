// Runs once before any test. Several server tests depend on Node 24 APIs (e.g. DatabaseSync.isTransaction);
// on other versions they fail with confusing transaction errors, so refuse up front.
export default function setup(): void {
  const major = Number(process.versions.node.split(".")[0]);
  if (major !== 24) {
    throw new Error(`FinShark's tests need Node 24, but this is Node ${process.versions.node}. Run \`nvm use\` in the FinShark folder first.`);
  }
}
