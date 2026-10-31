-- Portal domain schema. Foreign keys are DEFERRABLE so the circular
-- departments <-> employees references can be satisfied inside one transaction.

CREATE TABLE departments (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL DEFAULT '',
  parent_id TEXT,
  head_employee_id TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  personnel_number TEXT NOT NULL UNIQUE,
  last_name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  middle_name TEXT NOT NULL DEFAULT '',
  birth_date DATE NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  position TEXT NOT NULL,
  department_id TEXT NOT NULL,
  hire_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'probation', 'dismissed')),
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  work_phone TEXT NOT NULL DEFAULT '',
  registration_address JSONB NOT NULL,
  residential_address JSONB NOT NULL,
  passport JSONB NOT NULL,
  bank JSONB NOT NULL,
  emergency_contact JSONB NOT NULL,
  education TEXT NOT NULL DEFAULT '',
  hr_manager_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX employees_email_key ON employees (LOWER(email));
CREATE UNIQUE INDEX employees_personal_number_key ON employees ((passport ->> 'personalNumber'));
CREATE INDEX employees_department_id_idx ON employees (department_id);

ALTER TABLE departments
  ADD CONSTRAINT departments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES departments (id) DEFERRABLE INITIALLY IMMEDIATE,
  ADD CONSTRAINT departments_head_employee_id_fkey FOREIGN KEY (head_employee_id) REFERENCES employees (id) DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE employees
  ADD CONSTRAINT employees_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments (id) DEFERRABLE INITIALLY IMMEDIATE,
  ADD CONSTRAINT employees_hr_manager_id_fkey FOREIGN KEY (hr_manager_id) REFERENCES employees (id) DEFERRABLE INITIALLY IMMEDIATE;

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  permissions TEXT[] NOT NULL DEFAULT '{}',
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  employee_id TEXT NOT NULL UNIQUE REFERENCES employees (id) DEFERRABLE INITIALLY IMMEDIATE,
  role_ids TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  app TEXT NOT NULL CHECK (app IN ('admin', 'hr', 'it', 'vacation')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
  summary TEXT NOT NULL,
  changes JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_logs_app_created_at_idx ON audit_logs (app, created_at DESC);
CREATE INDEX audit_logs_entity_id_idx ON audit_logs (entity_id);

CREATE TABLE hardware (
  id TEXT PRIMARY KEY,
  inventory_number TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('laptop', 'desktop', 'monitor', 'printer', 'phone', 'mobile', 'tablet', 'peripheral', 'network', 'other')),
  manufacturer TEXT NOT NULL,
  model TEXT NOT NULL,
  serial_number TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('in_stock', 'assigned', 'repair', 'written_off')),
  employee_id TEXT REFERENCES employees (id) DEFERRABLE INITIALLY IMMEDIATE,
  assigned_at TIMESTAMPTZ,
  purchase_date DATE,
  warranty_until DATE,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX hardware_inventory_number_key ON hardware (LOWER(inventory_number));
CREATE INDEX hardware_employee_id_idx ON hardware (employee_id);

CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('hardware', 'software', 'network', 'access', 'other')),
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL CHECK (status IN ('new', 'in_progress', 'waiting_purchase', 'resolved', 'closed', 'cancelled')),
  requester_employee_id TEXT NOT NULL REFERENCES employees (id) DEFERRABLE INITIALLY IMMEDIATE,
  created_by_user_id TEXT NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY IMMEDIATE,
  department_id TEXT NOT NULL REFERENCES departments (id) DEFERRABLE INITIALLY IMMEDIATE,
  hardware_id TEXT REFERENCES hardware (id) DEFERRABLE INITIALLY IMMEDIATE,
  assignee_employee_id TEXT REFERENCES employees (id) DEFERRABLE INITIALLY IMMEDIATE,
  resolution TEXT NOT NULL DEFAULT '',
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  verified_by_user_id TEXT REFERENCES users (id) DEFERRABLE INITIALLY IMMEDIATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX tickets_created_at_idx ON tickets (created_at DESC);

CREATE TABLE ticket_comments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  user_id TEXT NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY IMMEDIATE,
  text TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ticket_comments_ticket_id_idx ON ticket_comments (ticket_id, created_at);

CREATE TABLE purchase_requests (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  ticket_id TEXT NOT NULL REFERENCES tickets (id) DEFERRABLE INITIALLY IMMEDIATE,
  requested_by_user_id TEXT NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY IMMEDIATE,
  items JSONB NOT NULL,
  justification TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'approved', 'rejected', 'delivered')),
  decided_by_user_id TEXT REFERENCES users (id) DEFERRABLE INITIALLY IMMEDIATE,
  decided_at TIMESTAMPTZ,
  decision_comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX purchase_requests_ticket_id_idx ON purchase_requests (ticket_id);

CREATE TABLE employee_documents (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees (id) DEFERRABLE INITIALLY IMMEDIATE,
  type TEXT NOT NULL CHECK (type IN ('passport', 'employment_contract', 'diploma', 'medical_certificate', 'military_id', 'insurance', 'photo', 'other')),
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  uploaded_by_user_id TEXT NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY IMMEDIATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX employee_documents_employee_id_idx ON employee_documents (employee_id);

CREATE TABLE leave_requests (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  employee_id TEXT NOT NULL REFERENCES employees (id) DEFERRABLE INITIALLY IMMEDIATE,
  type TEXT NOT NULL CHECK (type IN ('annual', 'sick', 'unpaid', 'study')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days INTEGER NOT NULL CHECK (days > 0),
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  head_approval JSONB NOT NULL,
  hr_approval JSONB NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY IMMEDIATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE INDEX leave_requests_employee_id_idx ON leave_requests (employee_id);
