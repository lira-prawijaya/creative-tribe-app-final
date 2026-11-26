-- Supabase PostgreSQL Schema for PT. Kreatif Kebanggaan Bangsa Finance Administration
-- Tables: investments, client_invoices, client_pos, purchase_orders, opex, audit_logs, boss_report_months

-- 1. Investments
create table if not exists public.investments (
  id uuid primary key,
  contract_number text not null default '',
  contract_date date,
  period_months integer not null default 1,
  interest_payment_day integer,
  interest_payment_date date,
  due_date date,
  investor_name text not null default '',
  loan_amount bigint not null default 0,
  monthly_interest bigint not null default 0,
  keterangan text not null default '',
  status text not null default 'Aktif',
  institution text not null default '-',
  category text not null default 'Pinjaman / Kredit',
  payment_method text not null default 'ANUITAS',
  fixed_principal_per_month bigint not null default 0,
  interest_input_type text not null default 'PERCENT',
  monthly_interest_rate double precision not null default 0,
  late_fee_input_type text not null default 'RP',
  late_fee_per_month_amount bigint not null default 0,
  late_fee_per_month_rate double precision not null default 0,
  bonus_input_type text not null default 'RP',
  bonus_amount bigint not null default 0,
  bonus_rate double precision not null default 0,
  bonus_date date,
  monthly_installment bigint not null default 0,
  start_month_key text not null default '',
  paid_months jsonb not null default '[]'::jsonb,
  month_realisasi jsonb not null default '{}'::jsonb,
  disbursement_realisasi_amount bigint,
  original_contract jsonb,
  addendums jsonb,
  cutoff_date date default '2026-02-01',
  legacy_late_fee_before_cutoff bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Client Invoices
create table if not exists public.client_invoices (
  id text primary key,
  invoice_number text not null default '',
  invoice_date text not null default '',
  client_name text not null default '',
  brand_name text not null default '',
  billing_address text not null default '',
  po_number text not null default '',
  grn_number text not null default '',
  show_grn boolean not null default false,
  include_ppn boolean not null default false,
  subtotal_amount bigint not null default 0,
  ppn_amount bigint not null default 0,
  show_system_generated_note boolean not null default true,
  project_name text not null default '',
  project_number text not null default '',
  items jsonb not null default '[]'::jsonb,
  total bigint not null default 0,
  grand_total bigint not null default 0,
  amount bigint not null default 0,
  total_amount bigint not null default 0,
  actual_amount bigint,
  realisasi_amount bigint,
  sent_date text not null default '',
  payment_terms_mode text,
  payment_terms_days integer,
  manual_due_date_note text not null default '',
  due_date text not null default '',
  status text not null default 'Draft',
  paid_date text not null default '',
  note text not null default '',
  is_voided boolean not null default false,
  void_status_label text not null default '',
  replaced_by_invoice_id text not null default '',
  replaced_by_invoice_number text not null default '',
  revision_sub_status text not null default '',
  previous_paid_amount bigint,
  revisions jsonb not null default '[]'::jsonb,
  is_deleted boolean not null default false,
  deleted_at text not null default '',
  deleted_by_name text not null default '',
  deleted_by_email text not null default '',
  delete_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Client Purchase Orders
create table if not exists public.client_pos (
  id text primary key,
  client_po_number text not null default '-',
  po_date text not null default '',
  client_name text not null default '-',
  brand_name text not null default '',
  project_name text not null default '-',
  project_number text not null default '-',
  amount bigint not null default 0,
  target_billing_date text not null default '',
  status text not null default 'Draft PO',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. Vendor Purchase Orders
create table if not exists public.purchase_orders (
  id text primary key,
  po_number text not null default '',
  po_date text not null default '',
  vendor_name text not null default '',
  vendor_address text not null default '',
  project_name text not null default '',
  project_number text not null default '',
  delivery_date text not null default '',
  items jsonb not null default '[]'::jsonb,
  total_amount bigint not null default 0,
  actual_amount bigint,
  realisasi_amount bigint,
  status text not null default 'Draft',
  invoice_date text not null default '',
  invoice_number text not null default '',
  invoice_file_url text not null default '',
  invoice_file_name text not null default '',
  payment_terms_mode text,
  payment_terms_days integer,
  manual_due_date_note text not null default '',
  due_date text not null default '',
  dpp_amount bigint not null default 0,
  ppn_rate double precision not null default 0,
  ppn_amount bigint not null default 0,
  gross_amount bigint not null default 0,
  pph_type text not null default 'NONE',
  pph_rate double precision not null default 0,
  pph_amount bigint not null default 0,
  pph_status text not null default '',
  pph_date text not null default '',
  net_akhir bigint not null default 0,
  note text not null default '',
  revision_sub_status text not null default '',
  previous_paid_amount bigint,
  revisions jsonb not null default '[]'::jsonb,
  voided_invoices jsonb not null default '[]'::jsonb,
  is_deleted boolean not null default false,
  deleted_at text not null default '',
  deleted_by_name text not null default '',
  deleted_by_email text not null default '',
  delete_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5. Operational Expenses (Opex)
create table if not exists public.opex (
  id text primary key,
  name text not null default '',
  category text not null default 'Operasional Lainnya',
  amount bigint not null default 0,
  actual_amount bigint,
  realisasi_amount bigint,
  month_key text not null default '',
  end_month_key text not null default '',
  due_day integer,
  source_account_id text,
  source_account_name text,
  is_recurring boolean not null default false,
  status text not null default 'Belum Bayar',
  month_statuses jsonb not null default '{}'::jsonb,
  month_realisasi jsonb not null default '{}'::jsonb,
  paid_dates jsonb not null default '{}'::jsonb,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 6. Audit Logs
create table if not exists public.audit_logs (
  id text primary key,
  actor_uid text not null default '',
  actor_name text not null default '',
  actor_email text not null default '',
  actor_role_id text not null default '',
  actor_role_name text not null default '',
  action text not null default '',
  entity_type text not null default 'PO',
  entity_id text not null default '',
  entity_label text not null default '',
  amount bigint not null default 0,
  summary text not null default '',
  timestamp_display text not null default '',
  date_iso text not null default '',
  created_at timestamptz not null default now()
);

-- 7. Boss Report Months (Cashflow Projection)
create table if not exists public.boss_report_months (
  month_key text primary key,
  as_of_date text not null default '',
  cutoff_global_date text not null default '',
  accounts jsonb not null default '[]'::jsonb,
  manual_opening_balance bigint,
  cash_in_manual jsonb not null default '[]'::jsonb,
  operasional jsonb not null default '[]'::jsonb,
  investment jsonb not null default '[]'::jsonb,
  project_cost_manual jsonb not null default '[]'::jsonb,
  auto_overrides jsonb not null default '[]'::jsonb,
  rescheduled_in jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- Enable Row Level Security (adjust policies to match your auth model)
alter table public.investments enable row level security;
alter table public.client_invoices enable row level security;
alter table public.client_pos enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.opex enable row level security;
alter table public.audit_logs enable row level security;
alter table public.boss_report_months enable row level security;

-- Permissive anon policies (replace with authenticated policies if Supabase Auth is added)
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'investments',
    'client_invoices',
    'client_pos',
    'purchase_orders',
    'opex',
    'audit_logs',
    'boss_report_months'
  ]
  loop
    execute format('drop policy if exists "Allow anon all on %I" on public.%I;', tbl, tbl);
    execute format('create policy "Allow anon all on %I" on public.%I for all to anon, authenticated using (true) with check (true);', tbl, tbl);
  end loop;
end $$;

-- Enable Supabase Realtime for all 7 tables
alter publication supabase_realtime add table
  public.investments,
  public.client_invoices,
  public.client_pos,
  public.purchase_orders,
  public.opex,
  public.audit_logs,
  public.boss_report_months;

-- 8. App Users (RBAC Profile)
create table if not exists public.app_users (
  id uuid primary key,
  email text not null unique,
  nama text not null default '',
  role text not null default 'staff',
  is_active boolean not null default true,
  last_seen_at timestamptz,
  is_online boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 9. App Permissions (Per-menu View & Edit RBAC)
create table if not exists public.app_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  menu_key text not null,
  can_view boolean not null default true,
  can_edit boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, menu_key)
);

-- Idempotent migration for existing databases missing cutoff or timestamp columns
alter table public.investments add column if not exists cutoff_date date default '2026-02-01';
alter table public.investments add column if not exists legacy_late_fee_before_cutoff bigint not null default 0;
alter table public.boss_report_months add column if not exists cutoff_global_date text not null default '';
alter table public.app_users add column if not exists created_at timestamptz default now();
alter table public.app_users add column if not exists updated_at timestamptz default now();
alter table public.app_users add column if not exists last_seen_at timestamptz;
alter table public.app_users add column if not exists is_online boolean not null default false;
alter table public.app_permissions add column if not exists created_at timestamptz default now();
alter table public.app_permissions add column if not exists updated_at timestamptz default now();
alter table public.purchase_orders add column if not exists dpp_amount bigint not null default 0;
alter table public.purchase_orders add column if not exists ppn_rate double precision not null default 0;
alter table public.purchase_orders add column if not exists ppn_amount bigint not null default 0;
alter table public.purchase_orders add column if not exists gross_amount bigint not null default 0;
alter table public.purchase_orders add column if not exists pph_type text not null default 'NONE';
alter table public.purchase_orders add column if not exists pph_rate double precision not null default 0;
alter table public.purchase_orders add column if not exists pph_amount bigint not null default 0;
alter table public.purchase_orders add column if not exists pph_status text not null default '';
alter table public.purchase_orders add column if not exists pph_date text not null default '';
alter table public.purchase_orders add column if not exists net_akhir bigint not null default 0;
alter table public.audit_logs add column if not exists amount bigint not null default 0;

alter table public.app_users enable row level security;
alter table public.app_permissions enable row level security;

drop policy if exists "Authenticated all on app_users" on public.app_users;
create policy "Authenticated all on app_users"
  on public.app_users
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated all on app_permissions" on public.app_permissions;
create policy "Authenticated all on app_permissions"
  on public.app_permissions
  for all
  to authenticated
  using (true)
  with check (true);

-- 10. Projection Manual Items (Sekali Pakai / Non-Rutin per Periode, terpisah dari data master Investment / Project / PO)
create table if not exists public.projection_manual_items (
  id text primary key,
  periode text not null default '',
  section text not null default 'INVESTMENT',
  nama_item text not null default '',
  nominal bigint not null default 0,
  keterangan text not null default '',
  project_id text,
  project_name text,
  vendor text,
  status_warna text not null default 'PUTIH',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_projection_manual_items_periode_section
  on public.projection_manual_items (periode, section);

alter table public.projection_manual_items enable row level security;

drop policy if exists "Allow anon all on projection_manual_items" on public.projection_manual_items;
create policy "Allow anon all on projection_manual_items"
  on public.projection_manual_items
  for all
  to anon, authenticated
  using (true)
  with check (true);

do $$
begin
  alter publication supabase_realtime add table public.projection_manual_items;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

