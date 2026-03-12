-- Partner/marketplace inquiry form
CREATE TABLE IF NOT EXISTS partner_inquiries (
  id SERIAL PRIMARY KEY,
  shop_name VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255) NOT NULL,
  contact_email VARCHAR(255) NOT NULL,
  website VARCHAR(500),
  location VARCHAR(255),
  monthly_volume VARCHAR(100),
  message TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'interested', 'declined', 'onboarded')),
  notes TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_inquiries_status ON partner_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_partner_inquiries_email ON partner_inquiries(contact_email);
