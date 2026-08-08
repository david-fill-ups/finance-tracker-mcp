// ---------------------------------------------------------------------------
// Finance-Tracker API – typed HTTP client
// ---------------------------------------------------------------------------

const BASE_URL = process.env.FINANCE_TRACKER_URL ?? "http://localhost:3000";
import { getRequestContext } from "./request-context.js";

// ── String sanitization ──────────────────────────────────────────────────────

/** Unescape common HTML entities that LLM clients sometimes inject into tool inputs. */
function unescapeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

/** Recursively sanitize all string values in a request body (trim + unescape HTML entities). */
function sanitize<T>(obj: T): T {
  if (typeof obj === "string") return unescapeHtml(obj.trim()) as T;
  if (Array.isArray(obj)) return obj.map(sanitize) as T;
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, sanitize(v)])
    ) as T;
  }
  return obj;
}

// ── generic request helper ──────────────────────────────────────────────────

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const hdrs: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: await getRequestContext().credentials.getAuthorization(getRequestContext().auth),
  };
  const profileId = getRequestContext().auth.activeProfileId;
  if (profileId) hdrs["X-Profile-Id"] = profileId;
  const res = await fetch(url, {
    method,
    headers: hdrs,
    body: body !== undefined ? JSON.stringify(sanitize(body)) : undefined,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const err = (await res.json()) as { error?: string };
      detail = err.error ? `: ${err.error}` : "";
    } catch {
      /* ignore parse errors */
    }
    throw new Error(
      `finance-tracker ${method} ${path} → ${res.status}${detail}`,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function qs(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) parts.push(`${k}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileGuest {
  id: string;
  email: string;
  permission: "VIEW" | "EDIT";
  userId?: string;
  createdAt: string;
  user?: { name: string; image: string };
}

export interface Person {
  id: string;
  name: string;
  role?: "self" | "spouse" | "dependent";
  createdAt: string;
  updatedAt: string;
  incomes: IncomeSource[];
  _count: { expenses: number };
}

export interface IncomeSource {
  id: string;
  personId: string;
  name: string;
  amount: number;
  frequency: "monthly" | "yearly" | "weekly" | "one_time";
  dueMonth?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  person: { id: string; name: string };
}

export interface Expense {
  id: string;
  name: string;
  amount: number;
  frequency: "monthly" | "yearly" | "weekly" | "one_time";
  dueMonth?: number;
  occurrenceDate?: string;
  type: "JOINT" | "PERSONAL";
  personId?: string;
  classification?: string;
  categoryId?: string;
  spendingTier?: "ESSENTIAL" | "CORE" | "DISCRETIONARY" | null;
  minimumAmount?: number | null;
  notes?: string;
  provider?: string;
  accountNumber?: string;
  taxCategory?: "charitable" | "mortgage_interest" | "property_tax" | "medical" | "childcare" | "business" | "other";
  deductiblePercent?: number;
  createdAt: string;
  updatedAt: string;
  person?: { id: string; name: string };
  category?: { id: string; name: string };
}

export interface Category {
  id: string;
  name: string;
  budgetTarget?: number;
  createdAt: string;
  updatedAt: string;
  _count: { expenses: number };
}

export interface Borrower {
  id: string;
  name: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  transactions: LoanTransaction[];
}

export interface LoanTransaction {
  id: string;
  borrowerId: string;
  date: string;
  amount: number;
  type: "loan" | "payment" | "writeoff";
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccountRecord {
  id: string;
  institution: string;
  purpose: string;
  accountNumber?: string;
  personId?: string;
  person?: { id: string; name: string; role?: string };
  category: "banking" | "investment" | "retirement" | "property" | "insurance" | "other";
  notes?: string;
  loginHint?: string;
  balance?: number;
  balanceAsOf?: string;
  includeInEmergencyFund: boolean;
  website?: string;
  contactPhone?: string;
  documentLocation?: string;
  reviewDate?: string;
  beneficiaryStatus?: string;
  continuityNotes?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Profile ─────────────────────────────────────────────────────────────────

export function getProfile() {
  return request<Profile>("GET", "/api/profile");
}

export function createProfile(body: { name: string }) {
  return request<Profile>("POST", "/api/profile", body);
}

export function updateProfile(body: { name?: string }) {
  return request<Profile>("PATCH", "/api/profile", body);
}

// ── Profile Guests ──────────────────────────────────────────────────────────

export function listGuests() {
  return request<ProfileGuest[]>("GET", "/api/profile/guests");
}

export function inviteGuest(body: { email: string; permission?: "VIEW" | "EDIT" }) {
  return request<ProfileGuest>("POST", "/api/profile/guests", body);
}

export function updateGuestPermission(guestId: string, body: { permission: "VIEW" | "EDIT" }) {
  return request<ProfileGuest>("PATCH", `/api/profile/guests/${guestId}`, body);
}

export function removeGuest(guestId: string) {
  return request<void>("DELETE", `/api/profile/guests/${guestId}`);
}

// ── People ──────────────────────────────────────────────────────────────────

export function listPeople(params: { limit?: number; offset?: number } = {}) {
  return request<Person[]>("GET", `/api/people${qs(params)}`);
}

export function createPerson(body: { name: string; role?: "self" | "spouse" | "dependent" }) {
  return request<Person>("POST", "/api/people", body);
}

export function updatePerson(id: string, body: { name?: string; role?: "self" | "spouse" | "dependent" }) {
  return request<Person>("PATCH", `/api/people/${id}`, body);
}

export function deletePerson(id: string) {
  return request<void>("DELETE", `/api/people/${id}`);
}

// ── Income ──────────────────────────────────────────────────────────────────

export function listIncome(params: { limit?: number; offset?: number } = {}) {
  return request<IncomeSource[]>("GET", `/api/income${qs(params)}`);
}

export function createIncome(body: {
  personId: string;
  name: string;
  amount: number;
  frequency: "monthly" | "yearly" | "weekly" | "one_time";
  dueMonth?: number;
  notes?: string;
}) {
  return request<IncomeSource>("POST", "/api/income", body);
}

export function updateIncome(id: string, body: {
  personId?: string;
  name?: string;
  amount?: number;
  frequency?: "monthly" | "yearly" | "weekly" | "one_time";
  dueMonth?: number;
  notes?: string;
}) {
  return request<IncomeSource>("PATCH", `/api/income/${id}`, body);
}

export function deleteIncome(id: string) {
  return request<void>("DELETE", `/api/income/${id}`);
}

// ── Expenses ────────────────────────────────────────────────────────────────

export function listExpenses(params: { limit?: number; offset?: number } = {}) {
  return request<Expense[]>("GET", `/api/expenses${qs(params)}`);
}

export function createExpense(body: {
  name: string;
  amount: number;
  frequency: "monthly" | "yearly" | "weekly" | "one_time";
  dueMonth?: number;
  occurrenceDate?: string;
  type: "JOINT" | "PERSONAL";
  personId?: string;
  classification?: string;
  categoryId?: string;
  spendingTier?: "ESSENTIAL" | "CORE" | "DISCRETIONARY" | null;
  minimumAmount?: number | null;
  notes?: string;
  provider?: string;
  accountNumber?: string;
  taxCategory?: Expense["taxCategory"];
  deductiblePercent?: number;
}) {
  return request<Expense>("POST", "/api/expenses", body);
}

export function updateExpense(id: string, body: {
  name?: string;
  amount?: number;
  frequency?: "monthly" | "yearly" | "weekly" | "one_time";
  dueMonth?: number;
  occurrenceDate?: string | null;
  type?: "JOINT" | "PERSONAL";
  personId?: string;
  classification?: string;
  categoryId?: string;
  spendingTier?: "ESSENTIAL" | "CORE" | "DISCRETIONARY" | null;
  minimumAmount?: number | null;
  notes?: string;
  provider?: string;
  accountNumber?: string;
  taxCategory?: Expense["taxCategory"] | null;
  deductiblePercent?: number | null;
}) {
  return request<Expense>("PATCH", `/api/expenses/${id}`, body);
}

export function deleteExpense(id: string) {
  return request<void>("DELETE", `/api/expenses/${id}`);
}

// ── Categories ──────────────────────────────────────────────────────────────

export function listCategories(params: { limit?: number; offset?: number } = {}) {
  return request<Category[]>("GET", `/api/categories${qs(params)}`);
}

export function createCategory(body: { name: string; budgetTarget?: number }) {
  return request<Category>("POST", "/api/categories", body);
}

export function updateCategory(id: string, body: { name?: string; budgetTarget?: number }) {
  return request<Category>("PATCH", `/api/categories/${id}`, body);
}

export function deleteCategory(id: string) {
  return request<void>("DELETE", `/api/categories/${id}`);
}

// ── Loans (Borrowers) ───────────────────────────────────────────────────────

export function listLoans(params: { limit?: number; offset?: number } = {}) {
  return request<Borrower[]>("GET", `/api/loans${qs(params)}`);
}

export function createLoan(body: { name: string; notes?: string }) {
  return request<Borrower>("POST", "/api/loans", body);
}

export function updateLoan(id: string, body: { name?: string; notes?: string }) {
  return request<Borrower>("PATCH", `/api/loans/${id}`, body);
}

export function deleteLoan(id: string) {
  return request<void>("DELETE", `/api/loans/${id}`);
}

// ── Loan Transactions ───────────────────────────────────────────────────────

export function createLoanTransaction(
  loanId: string,
  body: {
    date: string;
    amount: number;
    type: "loan" | "payment" | "writeoff";
    description?: string;
  },
) {
  return request<LoanTransaction>("POST", `/api/loans/${loanId}/transactions`, body);
}

export function updateLoanTransaction(
  loanId: string,
  txId: string,
  body: {
    date?: string;
    amount?: number;
    type?: "loan" | "payment" | "writeoff";
    description?: string;
  },
) {
  return request<LoanTransaction>("PATCH", `/api/loans/${loanId}/transactions/${txId}`, body);
}

export function deleteLoanTransaction(loanId: string, txId: string) {
  return request<void>("DELETE", `/api/loans/${loanId}/transactions/${txId}`);
}

// ── Accounts ────────────────────────────────────────────────────────────────

export function listAccounts(params: { limit?: number; offset?: number } = {}) {
  return request<AccountRecord[]>("GET", `/api/accounts${qs(params)}`);
}

async function allPages<T>(load: (params: { limit: number; offset: number }) => Promise<T[]>): Promise<T[]> {
  const items: T[] = [];
  const limit = 250;
  const maxPages = 100;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
    const offset = pageNumber * limit;
    const page = await load({ limit, offset });
    items.push(...page);
    if (page.length < limit) return items;
  }
  throw new Error(`Pagination safety limit reached (${maxPages * limit} records)`);
}

export const listAllPeople = () => allPages(listPeople);
export const listAllIncome = () => allPages(listIncome);
export const listAllExpenses = () => allPages(listExpenses);
export const listAllCategories = () => allPages(listCategories);
export const listAllLoans = () => allPages(listLoans);
export const listAllAccounts = () => allPages(listAccounts);

export function createAccount(body: {
  institution: string;
  purpose: string;
  personId?: string | null;
  category: "banking" | "investment" | "retirement" | "property" | "insurance" | "other";
  accountNumber?: string;
  notes?: string;
  loginHint?: string;
  balance?: number | null; balanceAsOf?: string | null; includeInEmergencyFund?: boolean;
  website?: string | null; contactPhone?: string | null; documentLocation?: string | null;
  reviewDate?: string | null; beneficiaryStatus?: string | null; continuityNotes?: string | null;
}) {
  return request<AccountRecord>("POST", "/api/accounts", body);
}

export function updateAccount(id: string, body: {
  institution?: string;
  purpose?: string;
  personId?: string | null;
  category?: "banking" | "investment" | "retirement" | "property" | "insurance" | "other";
  accountNumber?: string;
  notes?: string;
  loginHint?: string;
  balance?: number | null; balanceAsOf?: string | null; includeInEmergencyFund?: boolean;
  website?: string | null; contactPhone?: string | null; documentLocation?: string | null;
  reviewDate?: string | null; beneficiaryStatus?: string | null; continuityNotes?: string | null;
}) {
  return request<AccountRecord>("PATCH", `/api/accounts/${id}`, body);
}

export function deleteAccount(id: string) {
  return request<void>("DELETE", `/api/accounts/${id}`);
}

export interface Liability { id: string; name: string; lender?: string; balance: number; annualRate: number; minimumPayment: number; scheduledPayment?: number; balanceAsOf?: string; notes?: string; }
export interface SavedScenario { id: string; name: string; incomeAdjustment: number; expenseAdjustment: number; notes?: string; }
export function listLiabilities() { return request<Liability[]>("GET", "/api/liabilities"); }
export function createLiability(body: Omit<Liability, "id">) { return request<Liability>("POST", "/api/liabilities", body); }
export function updateLiability(id: string, body: Partial<Omit<Liability, "id">>) { return request<Liability>("PATCH", `/api/liabilities/${id}`, body); }
export function deleteLiability(id: string) { return request<void>("DELETE", `/api/liabilities/${id}`); }
export function listScenarios() { return request<SavedScenario[]>("GET", "/api/scenarios"); }
export function createScenario(body: Omit<SavedScenario, "id">) { return request<SavedScenario>("POST", "/api/scenarios", body); }
export function updateScenario(id: string, body: Partial<Omit<SavedScenario, "id">>) { return request<SavedScenario>("PATCH", `/api/scenarios/${id}`, body); }
export function deleteScenario(id: string) { return request<void>("DELETE", `/api/scenarios/${id}`); }
