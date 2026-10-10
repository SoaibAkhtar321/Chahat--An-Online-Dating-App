\set ON_ERROR_STOP on
-- Fails the run (non-zero exit) if any check failed or if the suite looks empty.
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name, left(detail, 80) AS detail
FROM public.t_results ORDER BY ok, name;
DO $$
DECLARE failed int; total int;
BEGIN
  SELECT count(*) FILTER (WHERE NOT ok), count(*) INTO failed, total FROM public.t_results;
  IF total < 50 THEN RAISE EXCEPTION 'suite looks incomplete: only % checks recorded', total; END IF;
  IF failed > 0 THEN RAISE EXCEPTION '% of % checks FAILED', failed, total; END IF;
  RAISE NOTICE 'ALL % CHECKS PASSED', total;
END $$;
