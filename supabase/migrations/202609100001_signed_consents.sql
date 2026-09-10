CREATE TABLE IF NOT EXISTS signed_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  version text NOT NULL,
  document_text text NOT NULL,
  signer_name text NOT NULL,
  signer_role text NOT NULL CHECK (signer_role IN ('adult','guardian')),
  signature jsonb NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE(user_id,version)
);
