CREATE TABLE public.devorchestra_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Untitled project',
  requirement TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'orchestra',
  provider TEXT NOT NULL DEFAULT 'lovable',
  model TEXT NOT NULL DEFAULT '',
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.devorchestra_runs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.devorchestra_runs TO authenticated;
GRANT ALL ON public.devorchestra_runs TO service_role;

ALTER TABLE public.devorchestra_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Prototype open access to runs" ON public.devorchestra_runs FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_devorchestra_runs_updated_at BEFORE UPDATE ON public.devorchestra_runs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();