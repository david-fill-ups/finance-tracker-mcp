import type { OperationPolicy, ToolImpact } from "./auth.js";
const knownTools = new Set(`get_profile create_profile update_profile list_guests invite_guest update_guest_permission remove_guest list_people create_person update_person delete_person list_income create_income update_income delete_income list_expenses create_expense update_expense delete_expense list_categories create_category update_category delete_category list_loans create_loan update_loan delete_loan create_loan_transaction update_loan_transaction delete_loan_transaction list_accounts create_account update_account delete_account list_liabilities create_liability update_liability delete_liability list_scenarios create_scenario update_scenario delete_scenario`.split(" "));
const hostedDisabled = new Set<string>(["invite_guest","update_guest_permission","remove_guest"]);
const readPrefixes = ["get_", "list_", "search_", "export_"];
export function requireToolPolicy(name: string): OperationPolicy {
  if (!knownTools.has(name)) throw new Error("MCP tool has no explicit authorization policy: " + name);
  const destructive = /^(delete_|remove_|unlink_|import_)/.test(name) || hostedDisabled.has(name);
  const impact: ToolImpact = destructive ? "destructive" : readPrefixes.some((prefix) => name.startsWith(prefix)) ? "read" : "write";
  return { domain: "finance", impact, requiredScopes: ["finance:" + impact], hostedEnabled: !destructive };
}
