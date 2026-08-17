-- GTO Insights - Convite com telefone/WhatsApp e rastreamento de origem
-- Scope: suporta o fluxo de convite em 2 etapas (dados do usuario + editor de mensagens
-- E-mail/WhatsApp) adicionado no front:
--   1. Coluna telefone em perfis (WhatsApp/contato, digitos DDD+numero, sem +55) - preenchida
--      pelo Admin na Etapa 1 do convite.
--   2. Coluna origem_convite ('email' | 'whatsapp') gravada pelo PROPRIO usuario convidado no
--      primeiro acesso, a partir do parametro ?utm_source= preservado no link de convite (o
--      Admin escolhe o canal no editor de mensagens da Etapa 2; o link de convite carrega esse
--      utm_source no redirect_to). Imutavel depois do primeiro valor gravado - e um dado
--      historico/analytics, nao um campo de autorizacao, entao ninguem (nem Admin) deve poder
--      reescrever depois de setado.

begin;

alter table public.perfis
  add column if not exists telefone text,
  add column if not exists origem_convite text;

alter table public.perfis
  drop constraint if exists perfis_telefone_formato_chk;
alter table public.perfis
  add constraint perfis_telefone_formato_chk
  check (telefone is null or telefone ~ '^\d{10,11}$');

alter table public.perfis
  drop constraint if exists perfis_origem_convite_valores_chk;
alter table public.perfis
  add constraint perfis_origem_convite_valores_chk
  check (origem_convite is null or origem_convite in ('email', 'whatsapp'));

comment on column public.perfis.telefone is
  'Telefone/WhatsApp em digitos (DDD + numero, sem +55), usado para disparar o convite via WhatsApp.';
comment on column public.perfis.origem_convite is
  'Canal usado no primeiro acesso apos o convite (email|whatsapp), gravado pelo proprio usuario a partir do utm_source do link de convite. Imutavel apos o primeiro valor gravado.';

-- Reafirma trg_perfis_bloquear_campos_sensiveis (20260807_021) incluindo a nova regra de
-- imutabilidade do origem_convite - aplicada a QUALQUER ator (Admin incluido), diferente do
-- bloqueio de email/cargo/ativo/marca_vinculada acima, que so vale para quem nao e Admin/Gestor.
create or replace function public.gto_perfis_bloquear_campos_sensiveis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.gto_eh_admin_ou_gestor() then
    new.email := old.email;
    new.cargo := old.cargo;
    new.ativo := old.ativo;
    new.marca_vinculada := old.marca_vinculada;
  end if;

  if old.origem_convite is not null then
    new.origem_convite := old.origem_convite;
  end if;

  return new;
end;
$$;

commit;
