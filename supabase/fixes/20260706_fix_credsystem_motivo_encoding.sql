-- GTO Insights - Fix common mojibake in CredSystem proposal reasons
-- Safe data cleanup for already imported Windows-1252 CSV rows decoded as UTF-8.

begin;

update public.stage_credsystem_propostas
set motivo = replace(motivo, 'POL�TICA', 'POLÍTICA')
where motivo like '%POL�TICA%';

update public.stage_credsystem_propostas
set motivo = replace(motivo, 'REDIGITA��O', 'REDIGITAÇÃO')
where motivo like '%REDIGITA��O%';

update public.stage_credsystem_propostas
set motivo = replace(motivo, 'N�O', 'NÃO')
where motivo like '%N�O%';

update public.stage_credsystem_propostas
set motivo = replace(motivo, 'INFORMA��O', 'INFORMAÇÃO')
where motivo like '%INFORMA��O%';

commit;
