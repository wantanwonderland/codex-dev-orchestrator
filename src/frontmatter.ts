import { parse, stringify } from "yaml";
import { ArtifactFrontmatterSchema, type ArtifactFrontmatter } from "./types.js";

export function renderArtifact(frontmatter: ArtifactFrontmatter, body: string): string {
  const validated = ArtifactFrontmatterSchema.parse(frontmatter);
  return `---\n${stringify(validated).trim()}\n---\n${body.trim()}\n`;
}

export function parseArtifact(markdown: string): { frontmatter: ArtifactFrontmatter; body: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error("Artifact must begin with YAML front matter");
  return {
    frontmatter: ArtifactFrontmatterSchema.parse(parse(match[1])),
    body: match[2],
  };
}
