# Security Specification — PT. KREATIF KEBANGGAAN BANGSA Purchase Order & RBAC System

## 1. Data Invariants
1. **Mandatory Authentication & Active User Gate**: All operational collections (`po_kkb`, `client_invoices_kkb`, `cashflow_settings_kkb`, `boss_report_months_kkb`, `roles_kkb`, `users_kkb`, `audit_logs_kkb`) strictly deny unauthenticated requests (`request.auth != null`) and deactivated user accounts (`users_kkb/{uid}.active == true`).
2. **Server-Authoritative RBAC Permission Enforcement**: Every privileged write/delete operation enforces live role permission lookups (`roles_kkb/{roleId}.permissions[perm] == true`) on Firestore:
   - `create_po`: creating PO / Draft Client Invoice
   - `edit_po_draft`: editing Draft/Sent POs and Draft/Unpaid Client Invoices
   - `revise_invoiced`: revising Invoiced / Unpaid / Overdue documents
   - `revise_paid`: revising Paid (`LUNAS`) documents with mandatory append-only revision history
   - `soft_delete_po`: soft-deleting (`isDeleted: true`) or restoring PO / Client Invoice records
   - `permanent_delete_po`: permanent document deletion (`allow delete`)
   - `send_invoice`: marking PO as Invoiced or sending Client Invoice
   - `mark_paid`: marking PO or Client Invoice as Paid
   - `view_reports`: modifying Boss Report ledgers (`boss_report_months_kkb`) and cashflow settings (`cashflow_settings_kkb`)
   - `manage_users`: reading other users' PII profiles and creating/updating/deactivating users in `users_kkb`
   - `manage_roles`: creating/editing/deleting custom roles and permissions in `roles_kkb`
3. **Privilege Escalation Prevention & One-Time Bootstrap**: Users CANNOT modify their own `roleId`, `roleName`, or `active` status in `users_kkb`. Self-update is restricted strictly to `lastLoginAt` and `updatedAt`. First-time Super Admin bootstrap is allowed ONCE only while `/app_meta_kkb/bootstrap` does not exist and enforces atomic `existsAfter(/app_meta_kkb/bootstrap)` batch creation.
4. **Schema & Bounds Integrity**: All required fields across PO, ClientInvoice, AppRole, AppUser, AuditLogEntry, CashflowSettings, and BossReportMonth MUST satisfy strict `hasAll` + `hasOnly`, data types, enums, regex (`YYYY-MM-DD`), and max-length constraints.
5. **Temporal Integrity & Immutable Audit Logs**: `createdAt` and `updatedAt` MUST equal `request.time` on create; `createdAt` is immutable on update; `audit_logs_kkb` records `actorUid == request.auth.uid` on create and forbids `update` and `delete` permanently.
6. **Audited Revision & Voided Proof Integrity**: Direct edits to `Paid` documents remain blocked; revisions require appending to `revisions` and archiving voided invoices (`voidedInvoices` / `isVoided: true`).
7. **Path ID Hardening & PII Isolation**: Single-document reads/writes validate `isValidId()` (`^[a-zA-Z0-9_\-]+$`, max 128 chars). Non-admin users can only read their own `users_kkb/{uid}` document.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Access**: Attempting `get`, `list`, `create`, `update`, or `delete` on `po_kkb` without Firebase Auth credentials (`request.auth == null`).
2. **Deactivated User Access**: User with `users_kkb/{uid}.active == false` attempting to read or write any document.
3. **Self Role Escalation**: A `staff_inputer` user attempting to update `users_kkb/{ownUid}` with `{ roleId: 'super_admin' }`.
4. **Viewer Write Attempt**: A `viewer` user (all permissions `false`) attempting to create or edit a PO in `po_kkb`.
5. **Unauthorized Paid Revision**: A user with `revise_invoiced: true` but `revise_paid: false` attempting to revise a `Paid` PO or Client Invoice.
6. **Unauthorized Permanent Delete**: A user with `soft_delete_po: true` but `permanent_delete_po: false` attempting `delete` on `/po_kkb/{poId}`.
7. **Unauthorized Role Mutation**: A non-admin (`manage_roles: false`) attempting to mutate permissions in `/roles_kkb/viewer`.
8. **Audit Log Tampering / Spoofing**: Attempting to `create` an audit log with `actorUid != request.auth.uid`, or attempting to `update`/`delete` an existing `/audit_logs_kkb/{logId}`.
9. **PII Scraping**: A non-admin (`manage_users: false`) attempting `get` or `list` on another user's `/users_kkb/{otherUid}`.
10. **Shadow / Ghost Field Injection**: Sending undocumented fields (e.g., `isAdminOverride: true`) in `po_kkb`, `roles_kkb`, or `users_kkb`.
11. **Bootstrap Replay Attack**: Attempting to re-create `/app_meta_kkb/bootstrap` or self-assign `super_admin` after `/app_meta_kkb/bootstrap` already exists.
12. **Client Timestamp Forgery**: Setting `createdAt` or `updatedAt` to a client timestamp instead of `request.time`.
