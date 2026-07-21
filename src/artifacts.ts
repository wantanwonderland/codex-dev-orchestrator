import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArtifact } from "./frontmatter.js";
import { WorkflowIdSchema } from "./types.js";

export async function validateWorkflowArtifacts(projectRoot: string, workflowId: string): Promise<string[]> {
  workflowId = WorkflowIdSchema.parse(workflowId);
  const root = join(projectRoot, ".codex", "workflows", workflowId);
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
  const workflowRoot = resolve(projectRoot, ".codex", "workflows", workflowId);
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

async function markdownFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await markdownFiles(path)));
    else if (entry.name.endsWith(".md")) result.push(path);
  }
  return result.sort();
}
