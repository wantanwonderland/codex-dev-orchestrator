export type RiskTrigger =
  | "schema/migrations"
  | "auth/RBAC/tenancy"
  | "privacy/security"
  | "billing"
  | "concurrency/queues"
  | "public APIs"
  | "external integrations"
  | "customer-visible UI";

const RULES: Array<[RiskTrigger, RegExp]> = [
  ["schema/migrations", /\b(schema|migration|database|table|column)\b/i],
  ["auth/RBAC/tenancy", /\b(auth|rbac|permission|tenant|tenancy)\b/i],
  ["privacy/security", /\b(privacy|security|secret|credential|encryption|pii)\b/i],
  ["billing", /\b(billing|payment|invoice|subscription|price|stripe)\b/i],
  ["concurrency/queues", /\b(concurren|queue|worker|lease|race|atomic)\w*/i],
  ["public APIs", /\b(public api|api contract|webhook|sdk)\b/i],
  ["external integrations", /\b(integration|oauth|provider|stripe|github|slack)\b/i],
  ["customer-visible UI", /\b(customer-visible|customer facing|dashboard|frontend|ui|ux|page|screen)\b/i],
];

export function classifyRisk(inputs: string[]): {
  level: "normal" | "high";
  requiresTaskReview: boolean;
  triggers: RiskTrigger[];
} {
  const text = inputs.join("\n");
  const triggers = RULES.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  return {
    level: triggers.length > 0 ? "high" : "normal",
    requiresTaskReview: triggers.length > 0,
    triggers,
  };
}
