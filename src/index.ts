// ---------------------------------------------------------------------------
// Finance-Tracker MCP Server
// ---------------------------------------------------------------------------

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PolicyAuthorizer, SafeAuditLogger, assertRuntimeMode, createAuthenticator, createCredentialProvider } from "./auth.js";
import { getRequestContext, runInvocationWithContext, type RequestContext } from "./request-context.js";
import { requireToolPolicy } from "./policies.js";
import * as api from "./client.js";

export function createFinanceTrackerServer(options: { invocationContext?: RequestContext } = {}): McpServer {
const rawServer = new McpServer({ name: "finance-tracker", version: "1.0.0" });
const authorizer = new PolicyAuthorizer();
const audit = new SafeAuditLogger();
const server = new Proxy(rawServer, {
  get(target, property, receiver) {
    if (property !== "tool") return Reflect.get(target, property, receiver);
    return (name: string, ...args: unknown[]) => {
      const policy = requireToolPolicy(name);
      const handlerIndex = args.length - 1;
      const handler = args[handlerIndex] as (...values: unknown[]) => unknown;
      args[handlerIndex] = async (...values: unknown[]) => runInvocationWithContext(options.invocationContext, async () => {
        const { auth } = getRequestContext();
        try {
          authorizer.authorize(auth, policy);
          audit.record({ action: name, principal: auth.principal, decision: "allowed" });
          return await handler(...values);
        } catch (error) {
          audit.record({ action: name, principal: auth.principal, decision: "denied", reason: error instanceof Error ? error.message : "denied" });
          throw error;
        }
      });
      return (target.tool as (...toolArgs: unknown[]) => unknown).call(target, name, ...args);
    };
  },
}) as McpServer;
const READ_ONLY = { readOnlyHint: true, destructiveHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

// helper – wrap handler so errors become MCP-friendly text responses
function wrap<T>(fn: () => Promise<T>) {
  return async () => {
    try {
      const data = await fn();
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
    }
  };
}


// ── Profile ─────────────────────────────────────────────────────────────────

server.tool(
  "get_profile",
  "Retrieve the current finance-tracker profile. Returns the profile id, name, and timestamps.",
  {},
  READ_ONLY,
  wrap(() => api.getProfile()),
);

server.tool(
  "create_profile",
  "Create a new finance-tracker profile. Use this on first setup. Requires a display name.",
  { name: z.string().describe("Display name for the profile") },
  (params) => wrap(() => api.createProfile({ name: params.name }))(),
);

server.tool(
  "update_profile",
  "Update the finance-tracker profile display name.",
  { name: z.string().optional().describe("New display name") },
  (params) => wrap(() => api.updateProfile({ name: params.name }))(),
);

// ── Profile Guests ──────────────────────────────────────────────────────────

server.tool(
  "list_guests",
  "List all guests who have been granted access to this finance-tracker profile. Returns email, permission level (VIEW or EDIT), and user info if they have an account.",
  {},
  READ_ONLY,
  wrap(() => api.listGuests()),
);

server.tool(
  "invite_guest",
  "Invite a guest to access this finance-tracker profile by email. Optionally set permission to VIEW (default) or EDIT.",
  {
    email: z.string().describe("Email address of the guest to invite"),
    permission: z.enum(["VIEW", "EDIT"]).optional().describe("Permission level: VIEW (read-only, default) or EDIT (read-write)"),
  },
  (params) => wrap(() => api.inviteGuest({ email: params.email, permission: params.permission }))(),
);

server.tool(
  "update_guest_permission",
  "Change a guest's permission level. Use list_guests first to get the guest ID.",
  {
    guestId: z.string().describe("ID of the guest to update"),
    permission: z.enum(["VIEW", "EDIT"]).describe("New permission level"),
  },
  (params) => wrap(() => api.updateGuestPermission(params.guestId, { permission: params.permission }))(),
);

server.tool(
  "remove_guest",
  "Revoke a guest's access to this finance-tracker profile. Use list_guests first to get the guest ID.",
  {
    guestId: z.string().describe("ID of the guest to remove"),
  },
  DESTRUCTIVE,
  (params) => wrap(() => api.removeGuest(params.guestId))(),
);

// ── People ──────────────────────────────────────────────────────────────────

server.tool(
  "list_people",
  "List all people in the household. Returns each person's name, role (self/spouse/dependent), their income sources, and expense count. Supports pagination via limit and offset.",
  {
    limit: z.number().int().min(1).max(100).default(25).describe("Max records (1-100; default 25)"),
    offset: z.number().int().min(0).optional().describe("Number of records to skip"),
    fields: z.array(z.string()).optional().describe("Fields to return; use ['*'] for all fields"),
  },
  READ_ONLY,
  (params) => wrap(() => api.listPeople({ ...params, fields: params.fields?.join(",") ?? "id,name,role" }))(),
);

server.tool(
  "create_person",
  "Add a person to the household. People are used to associate income and personal expenses. Set role to 'self', 'spouse', or 'dependent'.",
  {
    name: z.string().describe("Person's name"),
    role: z.enum(["self", "spouse", "dependent"]).optional().describe("Household role: self, spouse, or dependent"),
  },
  (params) => wrap(() => api.createPerson({ name: params.name, role: params.role }))(),
);

server.tool(
  "update_person",
  "Update a person's name or role.",
  {
    id: z.string().describe("ID of the person to update"),
    name: z.string().optional().describe("New name"),
    role: z.enum(["self", "spouse", "dependent"]).optional().describe("New role"),
  },
  (params) => wrap(() => api.updatePerson(params.id, { name: params.name, role: params.role }))(),
);

server.tool(
  "delete_person",
  "Permanently delete a person and cascade-delete their income. Associated personal expenses may also be affected. This cannot be undone.",
  {
    id: z.string().describe("ID of the person to delete"),
  },
  DESTRUCTIVE,
  (params) => wrap(() => api.deletePerson(params.id))(),
);

// ── Income ──────────────────────────────────────────────────────────────────

server.tool(
  "list_income",
  "List all income sources. Returns each income's name, amount, frequency (monthly/yearly/weekly/one_time), optional due month, notes, and the associated person. Supports pagination.",
  {
    limit: z.number().int().min(1).max(100).default(25).describe("Max records (1-100; default 25)"),
    offset: z.number().int().min(0).optional().describe("Number of records to skip"),
    fields: z.array(z.string()).optional().describe("Fields to return; use ['*'] for all fields"),
  },
  READ_ONLY,
  (params) => wrap(() => api.listIncome({ ...params, fields: params.fields?.join(",") ?? "id,name,amount,frequency,dueMonth,person.id,person.name" }))(),
);

server.tool(
  "create_income",
  "Add a new income source. Must be linked to a person (use list_people to get personId). Amount is a number, frequency is monthly/yearly/weekly/one_time. dueMonth (1-12) marks which month a yearly income is received.",
  {
    personId: z.string().describe("ID of the person this income belongs to"),
    name: z.string().describe("Name/description of the income source"),
    amount: z.number().describe("Income amount (numeric)"),
    frequency: z.enum(["monthly", "yearly", "weekly", "one_time"]).describe("How often this income is received"),
    dueMonth: z.number().min(1).max(12).optional().describe("Month (1-12) when yearly income is received"),
    notes: z.string().optional().describe("Optional notes"),
  },
  (params) =>
    wrap(() =>
      api.createIncome({
        personId: params.personId,
        name: params.name,
        amount: params.amount,
        frequency: params.frequency,
        dueMonth: params.dueMonth,
        notes: params.notes,
      }),
    )(),
);

server.tool(
  "update_income",
  "Update an existing income source. All fields are optional — only provided fields are changed.",
  {
    id: z.string().describe("ID of the income source to update"),
    personId: z.string().optional().describe("Move the income source to this household person"),
    name: z.string().optional().describe("New name"),
    amount: z.number().optional().describe("New amount"),
    frequency: z.enum(["monthly", "yearly", "weekly", "one_time"]).optional().describe("New frequency"),
    dueMonth: z.number().min(1).max(12).optional().describe("New due month (1-12)"),
    notes: z.string().optional().describe("New notes"),
  },
  (params) =>
    wrap(() =>
      api.updateIncome(params.id, {
        personId: params.personId,
        name: params.name,
        amount: params.amount,
        frequency: params.frequency,
        dueMonth: params.dueMonth,
        notes: params.notes,
      }),
    )(),
);

server.tool(
  "delete_income",
  "Delete an income source by ID.",
  {
    id: z.string().describe("ID of the income source to delete"),
  },
  DESTRUCTIVE,
  (params) => wrap(() => api.deleteIncome(params.id))(),
);

// ── Expenses ────────────────────────────────────────────────────────────────

server.tool(
  "list_expenses",
  "List all expenses. Returns each expense's name, amount, frequency, type (JOINT or PERSONAL), category, provider, and associated person. Supports pagination.",
  {
    limit: z.number().int().min(1).max(100).default(25).describe("Max records (1-100; default 25)"),
    offset: z.number().int().min(0).optional().describe("Number of records to skip"),
    fields: z.array(z.string()).optional().describe("Fields to return; use ['*'] for all fields"),
  },
  READ_ONLY,
  (params) => wrap(() => api.listExpenses({ ...params, fields: params.fields?.join(",") ?? "id,name,amount,frequency,type,person.id,person.name,category.id,category.name" }))(),
);

server.tool(
  "create_expense",
  "Add a new expense. Type is JOINT (shared household) or PERSONAL (requires personId). Frequency is monthly/yearly/weekly/one_time. spendingTier classifies priority: ESSENTIAL (must continue during unemployment), CORE (desired lifestyle), or DISCRETIONARY (first to cut). minimumAmount is only for ESSENTIAL expenses — the lowest realistic monthly amount after serious cuts. Optionally assign a category (use list_categories for categoryId), classification, provider, accountNumber, and notes.",
  {
    name: z.string().describe("Expense name/description"),
    amount: z.number().describe("Expense amount"),
    frequency: z.enum(["monthly", "yearly", "weekly", "one_time"]).describe("How often this expense recurs"),
    dueMonth: z.number().min(1).max(12).optional().describe("Month (1-12) when a yearly expense is due"),
    occurrenceDate: z.string().optional().describe("YYYY-MM-DD date for a one-time expense"),
    type: z.enum(["JOINT", "PERSONAL"]).describe("JOINT for shared expenses, PERSONAL for individual (requires personId)"),
    personId: z.string().optional().describe("Person ID — required when type is PERSONAL"),
    spendingTier: z.enum(["ESSENTIAL", "CORE", "DISCRETIONARY"]).optional().describe("Spending priority tier: ESSENTIAL, CORE, or DISCRETIONARY"),
    minimumAmount: z.number().optional().describe("Minimum monthly amount (only for ESSENTIAL tier) — the survival-level amount after serious cuts"),
    classification: z.string().optional().describe("Optional classification label"),
    categoryId: z.string().optional().describe("Category ID (use list_categories to find)"),
    notes: z.string().optional().describe("Optional notes"),
    provider: z.string().optional().describe("Service provider or vendor name"),
    accountNumber: z.string().optional().describe("Account or reference number"),
    taxCategory: z.enum(["charitable", "mortgage_interest", "property_tax", "medical", "childcare", "business", "other"]).optional(),
    deductiblePercent: z.number().min(0).max(100).optional(),
  },
  (params) =>
    wrap(() =>
      api.createExpense({
        name: params.name,
        amount: params.amount,
        frequency: params.frequency,
        dueMonth: params.dueMonth,
        occurrenceDate: params.occurrenceDate,
        type: params.type,
        personId: params.personId,
        spendingTier: params.spendingTier,
        minimumAmount: params.minimumAmount,
        classification: params.classification,
        categoryId: params.categoryId,
        notes: params.notes,
        provider: params.provider,
        accountNumber: params.accountNumber,
        taxCategory: params.taxCategory,
        deductiblePercent: params.deductiblePercent,
      }),
    )(),
);

server.tool(
  "update_expense",
  "Update an existing expense. All fields are optional — only provided fields are changed. Use clearSpendingTier to remove the spending classification and clearMinimumAmount to remove an ESSENTIAL minimum. Changing tier away from ESSENTIAL automatically clears minimumAmount.",
  {
    id: z.string().describe("ID of the expense to update"),
    name: z.string().optional().describe("New name"),
    amount: z.number().optional().describe("New amount"),
    frequency: z.enum(["monthly", "yearly", "weekly", "one_time"]).optional().describe("New frequency"),
    dueMonth: z.number().min(1).max(12).optional().describe("New due month"),
    occurrenceDate: z.string().optional().describe("New YYYY-MM-DD occurrence date"),
    clearOccurrenceDate: z.boolean().optional(),
    type: z.enum(["JOINT", "PERSONAL"]).optional().describe("New type"),
    personId: z.string().optional().describe("New person ID"),
    spendingTier: z.enum(["ESSENTIAL", "CORE", "DISCRETIONARY"]).optional().describe("New spending tier"),
    minimumAmount: z.number().optional().describe("New minimum monthly amount (only for ESSENTIAL)"),
    clearSpendingTier: z.boolean().optional().describe("Set true to remove the spending tier"),
    clearMinimumAmount: z.boolean().optional().describe("Set true to clear the minimum amount so the full expense amount is required"),
    classification: z.string().optional().describe("New classification"),
    categoryId: z.string().optional().describe("New category ID"),
    notes: z.string().optional().describe("New notes"),
    provider: z.string().optional().describe("New provider"),
    accountNumber: z.string().optional().describe("New account number"),
    taxCategory: z.enum(["charitable", "mortgage_interest", "property_tax", "medical", "childcare", "business", "other"]).optional(),
    clearTaxCategory: z.boolean().optional(),
    deductiblePercent: z.number().min(0).max(100).optional(),
    clearDeductiblePercent: z.boolean().optional(),
  },
  (params) =>
    wrap(() =>
      api.updateExpense(params.id, {
        name: params.name,
        amount: params.amount,
        frequency: params.frequency,
        dueMonth: params.dueMonth,
        occurrenceDate: params.clearOccurrenceDate ? null : params.occurrenceDate,
        type: params.type,
        personId: params.personId,
        spendingTier: params.clearSpendingTier ? null : params.spendingTier,
        minimumAmount: params.clearMinimumAmount ? null : params.minimumAmount,
        classification: params.classification,
        categoryId: params.categoryId,
        notes: params.notes,
        provider: params.provider,
        accountNumber: params.accountNumber,
        taxCategory: params.clearTaxCategory ? null : params.taxCategory,
        deductiblePercent: params.clearDeductiblePercent ? null : params.deductiblePercent,
      }),
    )(),
);

server.tool(
  "delete_expense",
  "Permanently delete an expense by ID. This cannot be undone.",
  {
    id: z.string().describe("ID of the expense to delete"),
  },
  DESTRUCTIVE,
  (params) => wrap(() => api.deleteExpense(params.id))(),
);

// ── Categories ──────────────────────────────────────────────────────────────

server.tool(
  "list_categories",
  "List all expense categories. Returns each category's name, optional budget target, and a count of associated expenses. Supports pagination.",
  {
    limit: z.number().int().min(1).max(100).default(25).describe("Max records (1-100; default 25)"),
    offset: z.number().int().min(0).optional().describe("Number of records to skip"),
    fields: z.array(z.string()).optional().describe("Fields to return; use ['*'] for all fields"),
  },
  READ_ONLY,
  (params) => wrap(() => api.listCategories({ ...params, fields: params.fields?.join(",") ?? "id,name,budgetTarget,_count" }))(),
);

server.tool(
  "create_category",
  "Create a new expense category. Optionally set a budgetTarget (numeric) to track spending against a goal.",
  {
    name: z.string().describe("Category name"),
    budgetTarget: z.number().optional().describe("Monthly budget target amount"),
  },
  (params) => wrap(() => api.createCategory({ name: params.name, budgetTarget: params.budgetTarget }))(),
);

server.tool(
  "update_category",
  "Update an expense category's name or budget target.",
  {
    id: z.string().describe("ID of the category to update"),
    name: z.string().optional().describe("New name"),
    budgetTarget: z.number().optional().describe("New budget target amount"),
  },
  (params) => wrap(() => api.updateCategory(params.id, { name: params.name, budgetTarget: params.budgetTarget }))(),
);

server.tool(
  "delete_category",
  "Delete an expense category by ID. Expenses in this category will become uncategorized.",
  {
    id: z.string().describe("ID of the category to delete"),
  },
  DESTRUCTIVE,
  (params) => wrap(() => api.deleteCategory(params.id))(),
);

// ── Loans (Borrowers) ───────────────────────────────────────────────────────

server.tool(
  "list_loans",
  "List all loan borrowers. Returns each borrower's name, notes, and all their loan transactions (loans given, payments received, write-offs). Supports pagination.",
  {
    limit: z.number().int().min(1).max(100).default(25).describe("Max records (1-100; default 25)"),
    offset: z.number().int().min(0).optional().describe("Number of records to skip"),
    fields: z.array(z.string()).optional().describe("Fields to return; use ['*'] for all fields"),
  },
  READ_ONLY,
  (params) => wrap(() => api.listLoans({ ...params, fields: params.fields?.join(",") ?? "id,name,notes" }))(),
);

server.tool(
  "create_loan",
  "Add a new loan borrower. This represents a person or entity you've lent money to. Use create_loan_transaction to record the actual loan, payment, or write-off amounts.",
  {
    name: z.string().describe("Borrower name"),
    notes: z.string().optional().describe("Optional notes about this borrower"),
  },
  (params) => wrap(() => api.createLoan({ name: params.name, notes: params.notes }))(),
);

server.tool(
  "update_loan",
  "Update a loan borrower's name or notes.",
  {
    id: z.string().describe("ID of the borrower to update"),
    name: z.string().optional().describe("New name"),
    notes: z.string().optional().describe("New notes"),
  },
  (params) => wrap(() => api.updateLoan(params.id, { name: params.name, notes: params.notes }))(),
);

server.tool(
  "delete_loan",
  "Delete a loan borrower and all associated transactions.",
  {
    id: z.string().describe("ID of the borrower to delete"),
  },
  DESTRUCTIVE,
  (params) => wrap(() => api.deleteLoan(params.id))(),
);

// ── Loan Transactions ───────────────────────────────────────────────────────

server.tool(
  "create_loan_transaction",
  "Record a transaction for a loan borrower. Type is 'loan' (money lent), 'payment' (money repaid), or 'writeoff' (forgiven debt). Date should be YYYY-MM-DD format.",
  {
    loanId: z.string().describe("ID of the borrower (loan) this transaction belongs to"),
    date: z.string().describe("Transaction date in YYYY-MM-DD format"),
    amount: z.number().describe("Transaction amount"),
    type: z.enum(["loan", "payment", "writeoff"]).describe("Transaction type: loan (lent), payment (repaid), writeoff (forgiven)"),
    description: z.string().optional().describe("Optional description of the transaction"),
  },
  (params) =>
    wrap(() =>
      api.createLoanTransaction(params.loanId, {
        date: params.date,
        amount: params.amount,
        type: params.type,
        description: params.description,
      }),
    )(),
);

server.tool(
  "update_loan_transaction",
  "Update an existing loan transaction. All fields except loanId and txId are optional.",
  {
    loanId: z.string().describe("ID of the borrower (loan)"),
    txId: z.string().describe("ID of the transaction to update"),
    date: z.string().optional().describe("New date (YYYY-MM-DD)"),
    amount: z.number().optional().describe("New amount"),
    type: z.enum(["loan", "payment", "writeoff"]).optional().describe("New transaction type"),
    description: z.string().optional().describe("New description"),
  },
  (params) =>
    wrap(() =>
      api.updateLoanTransaction(params.loanId, params.txId, {
        date: params.date,
        amount: params.amount,
        type: params.type,
        description: params.description,
      }),
    )(),
);

server.tool(
  "delete_loan_transaction",
  "Delete a loan transaction by its ID.",
  {
    loanId: z.string().describe("ID of the borrower (loan)"),
    txId: z.string().describe("ID of the transaction to delete"),
  },
  DESTRUCTIVE,
  (params) => wrap(() => api.deleteLoanTransaction(params.loanId, params.txId))(),
);

// ── Accounts ────────────────────────────────────────────────────────────────

server.tool(
  "list_accounts",
  "List all financial accounts with household owner, balance, emergency-fund designation, and continuity details. Supports pagination.",
  {
    limit: z.number().int().min(1).max(100).default(25).describe("Max records (1-100; default 25)"),
    offset: z.number().int().min(0).optional().describe("Number of records to skip"),
    fields: z.array(z.string()).optional().describe("Fields to return; use ['*'] for all fields"),
  },
  READ_ONLY,
  (params) => wrap(() => api.listAccounts({ ...params, fields: params.fields?.join(",") ?? "id,institution,purpose,category,balance,balanceAsOf,includeInEmergencyFund,person.id,person.name" }))(),
);

server.tool(
  "create_account",
  "Add a financial account. Use personId for an individual owner or omit it for joint ownership.",
  {
    institution: z.string().describe("Financial institution name (e.g., Chase, Fidelity)"),
    purpose: z.string().describe("Purpose or description of the account (e.g., Primary Checking, 401k)"),
    personId: z.string().optional().describe("Household person ID; omit for joint ownership"),
    category: z.enum(["banking", "investment", "retirement", "property", "insurance", "other"]).describe("Account category"),
    accountNumber: z.string().optional().describe("Account number (last 4 digits recommended for security)"),
    notes: z.string().optional().describe("Optional notes"),
    loginHint: z.string().optional().describe("Login hint or username for the account portal"),
    balance: z.number().optional(), balanceAsOf: z.string().optional(), includeInEmergencyFund: z.boolean().optional(),
    website: z.string().url().optional(), contactPhone: z.string().optional(), documentLocation: z.string().optional(),
    reviewDate: z.string().optional(), beneficiaryStatus: z.string().optional(), continuityNotes: z.string().optional(),
  },
  (params) =>
    wrap(() =>
      api.createAccount({
        institution: params.institution,
        purpose: params.purpose,
        personId: params.personId,
        category: params.category,
        accountNumber: params.accountNumber,
        notes: params.notes,
        loginHint: params.loginHint,
        balance: params.balance, balanceAsOf: params.balanceAsOf, includeInEmergencyFund: params.includeInEmergencyFund,
        website: params.website, contactPhone: params.contactPhone, documentLocation: params.documentLocation,
        reviewDate: params.reviewDate, beneficiaryStatus: params.beneficiaryStatus, continuityNotes: params.continuityNotes,
      }),
    )(),
);

server.tool(
  "update_account",
  "Update an existing financial account record. All fields are optional — only provided fields are changed.",
  {
    id: z.string().describe("ID of the account to update"),
    institution: z.string().optional().describe("New institution name"),
    purpose: z.string().optional().describe("New purpose/description"),
    personId: z.string().optional().describe("New person owner ID"), clearPerson: z.boolean().optional().describe("Set joint ownership"),
    category: z.enum(["banking", "investment", "retirement", "property", "insurance", "other"]).optional().describe("New category"),
    accountNumber: z.string().optional().describe("New account number"),
    notes: z.string().optional().describe("New notes"),
    loginHint: z.string().optional().describe("New login hint"),
    balance: z.number().optional(), balanceAsOf: z.string().optional(), includeInEmergencyFund: z.boolean().optional(),
    website: z.string().url().optional(), contactPhone: z.string().optional(), documentLocation: z.string().optional(),
    reviewDate: z.string().optional(), beneficiaryStatus: z.string().optional(), continuityNotes: z.string().optional(),
  },
  (params) =>
    wrap(() =>
      api.updateAccount(params.id, {
        institution: params.institution,
        purpose: params.purpose,
        personId: params.clearPerson ? null : params.personId,
        category: params.category,
        accountNumber: params.accountNumber,
        notes: params.notes,
        loginHint: params.loginHint,
        balance: params.balance, balanceAsOf: params.balanceAsOf, includeInEmergencyFund: params.includeInEmergencyFund,
        website: params.website, contactPhone: params.contactPhone, documentLocation: params.documentLocation,
        reviewDate: params.reviewDate, beneficiaryStatus: params.beneficiaryStatus, continuityNotes: params.continuityNotes,
      }),
    )(),
);

server.tool(
  "delete_account",
  "Delete a financial account record by ID.",
  {
    id: z.string().describe("ID of the account to delete"),
  },
  DESTRUCTIVE,
  (params) => wrap(() => api.deleteAccount(params.id))(),
);

server.tool("list_liabilities", "List stored household debts used for payoff planning and net-worth calculations.", { limit:z.number().int().min(1).max(100).default(25), offset:z.number().int().min(0).optional(), fields:z.array(z.string()).optional() }, READ_ONLY, (p) => wrap(() => api.listLiabilities({...p,fields:p.fields?.join(",")??"id,name,lender,balance,annualRate,minimumPayment,scheduledPayment,balanceAsOf"}))());
const liabilityFields = {
  name: z.string().min(1).max(100), lender: z.string().max(100).optional(), balance: z.number().positive(), annualRate: z.number().min(0).max(100),
  minimumPayment: z.number().positive(), scheduledPayment: z.number().positive().optional(), balanceAsOf: z.string().optional(), notes: z.string().max(500).optional(),
};
server.tool("create_liability", "Create a stored household liability.", liabilityFields, (p) => wrap(() => api.createLiability(p))());
server.tool("update_liability", "Update a stored household liability.", { id: z.string(), ...Object.fromEntries(Object.entries(liabilityFields).map(([k,v]) => [k, v.optional()])) }, (p) => { const { id, ...body } = p; return wrap(() => api.updateLiability(id, body))(); });
server.tool("delete_liability", "Permanently delete a stored liability.", { id: z.string() }, DESTRUCTIVE, (p) => wrap(() => api.deleteLiability(p.id))());

server.tool("list_scenarios", "List saved monthly what-if scenarios.", { limit:z.number().int().min(1).max(100).default(25), offset:z.number().int().min(0).optional(), fields:z.array(z.string()).optional() }, READ_ONLY, (p) => wrap(() => api.listScenarios({...p,fields:p.fields?.join(",")??"id,name,incomeAdjustment,expenseAdjustment"}))());
const scenarioFields = { name: z.string().min(1).max(100), incomeAdjustment: z.number(), expenseAdjustment: z.number(), notes: z.string().max(500).optional() };
server.tool("create_scenario", "Create a saved what-if scenario without changing the budget.", scenarioFields, (p) => wrap(() => api.createScenario(p))());
server.tool("update_scenario", "Update a saved what-if scenario.", { id: z.string(), name: z.string().min(1).max(100).optional(), incomeAdjustment: z.number().optional(), expenseAdjustment: z.number().optional(), notes: z.string().max(500).optional() }, (p) => { const { id, ...body } = p; return wrap(() => api.updateScenario(id, body))(); });
server.tool("delete_scenario", "Permanently delete a saved scenario.", { id: z.string() }, DESTRUCTIVE, (p) => wrap(() => api.deleteScenario(p.id))());

// ── Start server ────────────────────────────────────────────────────────────

return rawServer;
}

async function main() {
  if ((process.env.MCP_TRANSPORT || "stdio") !== "stdio" || process.env.NODE_ENV === "test") return;
  assertRuntimeMode("stdio", "local_api_key");
  const auth = await createAuthenticator("local_api_key").authenticate({});
  const server = createFinanceTrackerServer({ invocationContext: { auth, credentials: createCredentialProvider("local_api_key") } });
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
