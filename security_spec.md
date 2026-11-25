# Security Specification (`security_spec.md`)

## 1. Data Invariants

1. **Workspace Identity Invariant**: Only valid household workspace IDs matching `^[a-zA-Z0-9_\-]+$` (bounded to `<= 64` chars) and specifically the authorized family workspace (`domus_family`) may be read or written.
2. **Schema & Key Whitelisting (`hasAll` & `hasOnly`)**:
   - `HouseholdWorkspace` documents must contain only `['householdId', 'activeMonthKey', 'lastAction', 'updatedAt']`.
   - `MonthLedger` documents must contain required keys `['householdId', 'monthKey', 'label', 'year', 'month', 'incomes', 'expenses', 'updatedAt']` and only allowed optional keys `['generatedFrom', 'completedInstallmentsFromPrev']`.
3. **Immutability Invariant**: `householdId` and `monthKey` cannot be modified during an `update` operation (`incoming().householdId == existing().householdId` and `incoming().monthKey == existing().monthKey`).
4. **Temporal Integrity Invariant**: `updatedAt` must always equal the server timestamp `request.time` on both `create` and `update`.
5. **Bounded Collections & Arrays**: `incomes` array size `<= 100`, `expenses` array size `<= 300`, `completedInstallmentsFromPrev` array size `<= 50`.

## 2. The "Dirty Dozen" Payloads

1. **Shadow Field Injection on Workspace**: `{ householdId: "domus_family", activeMonthKey: "2026-10", lastAction: "init", updatedAt: SERVER_TIME, isAdmin: true }` -> Rejected by `hasOnly`.
2. **Oversized `activeMonthKey`**: `{ householdId: "domus_family", activeMonthKey: "2026-10-EXTRA-LONG-STRING-ATTACK", lastAction: "init", updatedAt: SERVER_TIME }` -> Rejected by `.size() <= 16` and regex pattern.
3. **Client Timestamp Forgery**: `{ householdId: "domus_family", activeMonthKey: "2026-10", lastAction: "init", updatedAt: "2020-01-01T00:00:00Z" }` -> Rejected by `incoming().updatedAt == request.time`.
4. **ID Poisoning on Path**: Path `/households/invalid$id!@#` -> Rejected by `isValidId(householdId)`.
5. **Unauthorized Household ID**: Path `/households/other_family` -> Rejected by `householdId == 'domus_family'`.
6. **Immutable Field Mutation on Update**: Updating `householdId` from `"domus_family"` to `"hacked"` -> Rejected by `incoming().householdId == existing().householdId` and `affectedKeys().hasOnly(...)`.
7. **Unbounded Expenses Array DoS**: `MonthLedger` with `expenses` array of 500 elements -> Rejected by `data.expenses.size() <= 300`.
8. **Type Poisoning on `incomes`**: `MonthLedger` with `incomes: "not-a-list"` -> Rejected by `data.incomes is list`.
9. **Invalid Month Range**: `MonthLedger` with `month: 15` -> Rejected by `data.month >= 1 && data.month <= 12`.
10. **Parent Mismatch on Subcollection**: Creating `/households/domus_family/ledgers/2026-10` where `incoming().monthKey == "2026-11"` -> Rejected by `incoming().monthKey == monthKey`.
11. **Shadow Field on Ledger Update**: Updating `/households/domus_family/ledgers/2026-10` with an extra field `hacked: 123` -> Rejected by `affectedKeys().hasOnly(...)` and `isValidMonthLedger(incoming())`.
12. **Arbitrary Root Collection Write**: Writing to `/randomCollection/doc1` -> Rejected by default-deny catch-all `match /{document=**} { allow read, write: if false; }`.
