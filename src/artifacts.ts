import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArtifact } from "./frontmatter.js";
import { WorkflowIdSchema } from "./types.js";
import { StateStore } from "./state-store.js";
import { workflowArtifactRoot } from "./worktree.js";

export async function validateWorkflowArtifacts(projectRoot: string, workflowId: string): Promise<string[]> {
  workflowId = WorkflowIdSchema.parse(workflowId);
  let artifactRoot = projectRoot;
  try { artifactRoot = workflowArtifactRoot(await new StateStore(projectRoot, workflowId).load(), projectRoot); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const root = join(artifactRoot, ".codex", "workflows", workflowId);
  const paths = await markdownFiles(root);
  if (!paths.some((path) => path.endsWith("/index.md"))) throw new Error("Workflow index.md is missing");
  for (const path of paths) {
    const parsed = parseArtifact(await readFile(path, "utf8"));
    if (parsed.frontmatter.workflow_id !== workflowId) {
      throw new Error(`${path} belongs to workflow ${parsed.frontmatter.workflow_id}, expected ${workflowId}`);
    }
  }
  return paths;
}

export async function persistWorkflowArtifact(
  projectRoot: string,
  workflowId: string,
  relativePath: string,
  markdown: string,
): Promise<string> {
  workflowId = WorkflowIdSchema.parse(workflowId);
  let root = projectRoot;
  try { root = workflowArtifactRoot(await new StateStore(projectRoot, workflowId).load(), projectRoot); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const workflowRoot = resolve(root, ".codex", "workflows", workflowId);
  const target = resolve(workflowRoot, relativePath);
  const relation = relative(workflowRoot, target);
  if (!relativePath.endsWith(".md") || isAbsolute(relativePath) || relation.startsWith("..") || isAbsolute(relation)) {
    throw new Error("Artifact path must stay inside the workflow directory and end in .md");
  }
  const parsed = parseArtifact(markdown);
  if (parsed.frontmatter.workflow_id !== workflowId) throw new Error("Artifact workflow identity mismatch");
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, markdown);
  await rename(temporary, target);
  return target;
}

/** Validate the whole handoff before writing any file, avoiding partial workflow artifacts. */
export async function persistWorkflowArtifactBundle(
  projectRoot: string,
  workflowId: string,
  artifacts: Array<{ relativePath: string; markdown: string }>,
): Promise<string[]> {
  if (!artifacts.length) throw new Error("Artifact bundle cannot be empty");
  const seen = new Set<string>();
  for (const artifact of artifacts) {
    if (seen.has(artifact.relativePath)) throw new Error(`Duplicate artifact path: ${artifact.relativePath}`);
    seen.add(artifact.relativePath);
    const parsed = parseArtifact(artifact.markdown);
    if (parsed.frontmatter.workflow_id !== WorkflowIdSchema.parse(workflowId)) throw new Error("Artifact workflow identity mismatch");
  }
  return Promise.all(artifacts.map((artifact) => persistWorkflowArtifact(projectRoot, workflowId, artifact.relativePath, artifact.markdown)));
}

async function markdownFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await markdownFiles(path)));
    else if (entry.name.endsWith(".md")) result.push(path);
  }
  return result.sort();
}
