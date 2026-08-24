-- GTO Insights - Tabela de lojas/unidades por bandeira.
-- Scope: da ao card "Gerenciar Bandeiras" (Configuracoes) uma contagem real de lojas por marca,
-- no lugar do numero fixo (32/18/12) e do badge MANUTENCAO fixo que estavam so no codigo.
--
-- marca usa o enum public.bandeira_marca (ja existente desde a migration inicial) em vez de um
-- "text" solto como pedido originalmente - mesma convencao de toda tabela filtrada por marca no
-- projeto (dados_cartoes_credsystem, stage_*, etc.), evita valor de marca invalido/digitado errado
-- chegando na tabela.
--
-- regiao e o identificador de cada unidade na planilha de origem ("Enderecos das Lojas - 2026.xlsx",
-- uma aba por bandeira) - nao ha codigo de loja formal, entao regiao (ex.: "Planaltina (Setor
-- Norte)") e o que distingue duas lojas na mesma cidade.
--
-- Seed abaixo com os 94 enderecos reais da planilha (Tesoura de Ouro 43, Magazine da Economia 25,
-- Free Center Calcados 26) - google_maps_url foi reconstruido com encodeURIComponent a partir de
-- endereco+uf porque os links de "Abrir no Google Maps" da planilha original vieram com a
-- acentuacao corrompida (mojibake) na Target da hyperlink; a unica excecao e a loja "Tesoura Mais",
-- que tinha um link curto (maps.app.goo.gl) proprio, sem esse problema, preservado como veio.

begin;

create table if not exists public.lojas_unidades (
  id uuid primary key default gen_random_uuid(),
  marca public.bandeira_marca not null,
  regiao text not null,
  endereco text,
  uf text,
  telefone text,
  google_maps_url text,
  criada_em timestamptz not null default now(),

  constraint lojas_unidades_marca_regiao_uf_key unique (marca, regiao, uf)
);

create index if not exists idx_lojas_unidades_marca on public.lojas_unidades(marca);

comment on table public.lojas_unidades is 'Lista de lojas/unidades fisicas por bandeira - fonte da contagem exibida no card "Gerenciar Bandeiras" em Configuracoes.';
comment on column public.lojas_unidades.regiao is 'Nome da regiao/bairro usado como identificador da unidade na planilha de origem (nao ha codigo de loja formal).';

-- RLS --------------------------------------------------------------------------------------------
-- Mesmo padrao das demais tabelas filtradas por marca (ver dados_cartoes_credsystem, migration
-- 20260814_029): leitura liberada pra quem tem acesso aquela marca, ou Admin/Gestor (enxergam
-- tudo). Escrita restrita a Admin - lista de lojas e dado de referencia, gerenciado fora da UI
-- de Coordenador/Analista.
alter table public.lojas_unidades enable row level security;
alter table public.lojas_unidades force row level security;

drop policy if exists "lojas_unidades_select_por_marca" on public.lojas_unidades;
create policy "lojas_unidades_select_por_marca" on public.lojas_unidades
for select to authenticated
using ((select public.gto_eh_admin_ou_gestor()) or public.gto_tem_acesso_marca(marca));

drop policy if exists "lojas_unidades_insert_admin" on public.lojas_unidades;
create policy "lojas_unidades_insert_admin" on public.lojas_unidades
for insert to authenticated
with check ((select public.gto_eh_admin()));

drop policy if exists "lojas_unidades_update_admin" on public.lojas_unidades;
create policy "lojas_unidades_update_admin" on public.lojas_unidades
for update to authenticated
using ((select public.gto_eh_admin()))
with check ((select public.gto_eh_admin()));

drop policy if exists "lojas_unidades_delete_admin" on public.lojas_unidades;
create policy "lojas_unidades_delete_admin" on public.lojas_unidades
for delete to authenticated
using ((select public.gto_eh_admin()));

revoke all on public.lojas_unidades from anon;
grant select, insert, update, delete on public.lojas_unidades to authenticated;

-- Seed: 94 lojas reais extraidas de "Enderecos das Lojas - 2026.xlsx" -----------------------------
insert into public.lojas_unidades (marca, regiao, endereco, uf, telefone, google_maps_url)
values
  ('Tesoura de Ouro', 'Samambaia Norte', 'QN 208 Conjunto B Lote 02 Loja 04 - Samambaia Norte, Brasília', 'DF', '(61) 98427-4069', 'https://www.google.com/maps?q=QN%20208%20Conjunto%20B%20Lote%2002%20Loja%2004%20-%20Samambaia%20Norte%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Tesoura de Ouro', 'Águas Lindas', 'Rua 19 Quadra, 31 - lote 16/17 - Jardim Brasília, Águas Lindas de Goiás', 'GO', '(61) 98427-4085', 'https://www.google.com/maps?q=Rua%2019%20Quadra%2C%2031%20-%20lote%2016%2F17%20-%20Jardim%20Bras%C3%ADlia%2C%20%C3%81guas%20Lindas%20de%20Goi%C3%A1s%2C%20GO'),
  ('Tesoura de Ouro', 'Águas Lindas Shopping', 'Avenida SANTA LUZIA, QD 00, LT. 6-B-2 - MANSÕES CENTRO-OESTE, Águas Lindas de Goiás', 'GO', '(61) 99699-3634', 'https://www.google.com/maps?q=Avenida%20SANTA%20LUZIA%2C%20QD%2000%2C%20LT.%206-B-2%20-%20MANS%C3%95ES%20CENTRO-OESTE%2C%20%C3%81guas%20Lindas%20de%20Goi%C3%A1s%2C%20GO'),
  ('Tesoura de Ouro', 'Trindade', 'Av. Manoel Monteiro, Quadra 26 - Vila Pai Eterno, Trindade, 75388-238', 'GO', '(61) 99993-4853', 'https://www.google.com/maps?q=Av.%20Manoel%20Monteiro%2C%20Quadra%2026%20-%20Vila%20Pai%20Eterno%2C%20Trindade%2C%2075388-238%2C%20GO'),
  ('Tesoura de Ouro', 'Jataí', 'Av. Goiás, 1336 - Quadra 35 Lote 02 B - Vila Frei Domingos, Jataí, 75800-133', 'GO', '-', 'https://www.google.com/maps?q=Av.%20Goi%C3%A1s%2C%201336%20-%20Quadra%2035%20Lote%2002%20B%20-%20Vila%20Frei%20Domingos%2C%20Jata%C3%AD%2C%2075800-133%2C%20GO'),
  ('Tesoura de Ouro', 'Anápolis', 'R. Eng. Portela, 222 - St. Central, Anápolis', 'GO', '(61) 98177-0473', 'https://www.google.com/maps?q=R.%20Eng.%20Portela%2C%20222%20-%20St.%20Central%2C%20An%C3%A1polis%2C%20GO'),
  ('Tesoura de Ouro', 'Anápolis (Vila Jaiara)', 'Av. Fernando Costa, 49 - Vila Jaiara, Anápolis', 'GO', '(61) 99959-5819', 'https://www.google.com/maps?q=Av.%20Fernando%20Costa%2C%2049%20-%20Vila%20Jaiara%2C%20An%C3%A1polis%2C%20GO'),
  ('Tesoura de Ouro', 'Aparecida de Goiânia', 'Av. Independência Rua 22 Q.50 LT 8-10 e 15-18 Loja 3 e 4, Aparecida de Goiânia', 'GO', '(61) 98408-9438', 'https://www.google.com/maps?q=Av.%20Independ%C3%AAncia%20Rua%2022%20Q.50%20LT%208-10%20e%2015-18%20Loja%203%20e%204%2C%20Aparecida%20de%20Goi%C3%A2nia%2C%20GO'),
  ('Tesoura de Ouro', 'Aparecida de Goiânia (Garavelo)', 'Av. da Igualdade esquina da rua 21 quadra 116 lote 16/17 setor Garavelo S Garavelo, Aparecida de Goiânia', 'GO', '(61) 98220-1188', 'https://www.google.com/maps?q=Av.%20da%20Igualdade%20esquina%20da%20rua%2021%20quadra%20116%20lote%2016%2F17%20setor%20Garavelo%20S%20Garavelo%2C%20Aparecida%20de%20Goi%C3%A2nia%2C%20GO'),
  ('Tesoura de Ouro', 'Núcleo Bandeirante', 'Av. Central, lt 460 - Núcleo Bandeirante, Brasília', 'DF', '(61) 98427-4008', 'https://www.google.com/maps?q=Av.%20Central%2C%20lt%20460%20-%20N%C3%BAcleo%20Bandeirante%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Tesoura de Ouro', 'Brazlândia', 'Qd 04 Lt 05 Quadra 04 Lote 05, St. Norte - Brazlândia, Brasília', 'DF', '(61) 98427-4076', 'https://www.google.com/maps?q=Qd%2004%20Lt%2005%20Quadra%2004%20Lote%2005%2C%20St.%20Norte%20-%20Brazl%C3%A2ndia%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Tesoura de Ouro', 'Caldas Novas', 'Av. Cel. Bento de Godoy, 444 - Quadra 15 Lote 7 - Centro, Caldas Novas', 'GO', '(61) 99681-0133', 'https://www.google.com/maps?q=Av.%20Cel.%20Bento%20de%20Godoy%2C%20444%20-%20Quadra%2015%20Lote%207%20-%20Centro%2C%20Caldas%20Novas%2C%20GO'),
  ('Tesoura de Ouro', 'Ceilândia Centro', 'St. M QNM 18 - Ceilândia, Brasília', 'DF', '(61) 98427-8065', 'https://www.google.com/maps?q=St.%20M%20QNM%2018%20-%20Ceil%C3%A2ndia%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Tesoura de Ouro', 'Comercial Norte (Taguatinga Norte)', 'CNB 06 Lote 06 Loja 1 e 2, Av. Comercial, Brasília', 'DF', '(61) 98427-4005', 'https://www.google.com/maps?q=CNB%2006%20Lote%2006%20Loja%201%20e%202%2C%20Av.%20Comercial%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Tesoura de Ouro', 'Cristalina', 'R. Goiás, Quadra 29 - Lote 19 - Centro, Cristalina', 'GO', '(61) 99693-0063', 'https://www.google.com/maps?q=R.%20Goi%C3%A1s%2C%20Quadra%2029%20-%20Lote%2019%20-%20Centro%2C%20Cristalina%2C%20GO'),
  ('Tesoura de Ouro', 'Catalão', 'Av. Vinte de Agosto, Quadra 25 - Lote 20 - St. Central, Catalão, 75701-010', 'GO', '(61) 98408-0184', 'https://www.google.com/maps?q=Av.%20Vinte%20de%20Agosto%2C%20Quadra%2025%20-%20Lote%2020%20-%20St.%20Central%2C%20Catal%C3%A3o%2C%2075701-010%2C%20GO'),
  ('Tesoura de Ouro', 'Formosa', 'R. Visc. de Porto Seguro, 600 - Centro, Formosa', 'GO', '(61) 99929-0186', 'https://www.google.com/maps?q=R.%20Visc.%20de%20Porto%20Seguro%2C%20600%20-%20Centro%2C%20Formosa%2C%20GO'),
  ('Tesoura de Ouro', 'Gama', 'Bloco 06 - Lotes 42/60 - Térreo e Subsolo Comercial - Ed. Gama Center, St. Central - Gama, Brasília', 'DF', '(61) 98220-1212', 'https://www.google.com/maps?q=Bloco%2006%20-%20Lotes%2042%2F60%20-%20T%C3%A9rreo%20e%20Subsolo%20Comercial%20-%20Ed.%20Gama%20Center%2C%20St.%20Central%20-%20Gama%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Tesoura de Ouro', 'Goianésia', 'Avenida Goiás Norte nº1117, Quadra 82 Lote 34 Parte - Carrilho, Goianésia', 'GO', '(61) 99807-8594', 'https://www.google.com/maps?q=Avenida%20Goi%C3%A1s%20Norte%20n%C2%BA1117%2C%20Quadra%2082%20Lote%2034%20Parte%20-%20Carrilho%2C%20Goian%C3%A9sia%2C%20GO'),
  ('Tesoura de Ouro', 'Itumbiara', 'Praça da República N° 52 Setor Central - Centro, Itumbiara, 75503-260', 'GO', '(61) 99961-9328', 'https://www.google.com/maps?q=Pra%C3%A7a%20da%20Rep%C3%BAblica%20N%C2%B0%2052%20Setor%20Central%20-%20Centro%2C%20Itumbiara%2C%2075503-260%2C%20GO'),
  ('Tesoura de Ouro', 'Luziânia', 'Centro, Luziânia', 'GO', '(61) 99697-4496', 'https://www.google.com/maps?q=Centro%2C%20Luzi%C3%A2nia%2C%20GO'),
  ('Tesoura de Ouro', 'Novo Gama', 'Quadra SQ 16 Quadra 4 Lote 27 - Novo Gama, Centro', 'GO', '(61) 98435-0277', 'https://www.google.com/maps?q=Quadra%20SQ%2016%20Quadra%204%20Lote%2027%20-%20Novo%20Gama%2C%20Centro%2C%20GO'),
  ('Tesoura de Ouro', 'Novo Gama (Pedregal)', 'Quadra 482 lote 24 - Parque Estrela Dalva VI, Novo Gama', 'GO', '(61) 98427-4079', 'https://www.google.com/maps?q=Quadra%20482%20lote%2024%20-%20Parque%20Estrela%20Dalva%20VI%2C%20Novo%20Gama%2C%20GO'),
  ('Tesoura de Ouro', 'Paranoá', 'Avenida Paranoá, Quadra 12 Conjunto 11 Lotes 4,5 e 6 - Paranoá, Brasília', 'DF', '(61) 98427-4067', 'https://www.google.com/maps?q=Avenida%20Parano%C3%A1%2C%20Quadra%2012%20Conjunto%2011%20Lotes%204%2C5%20e%206%20-%20Parano%C3%A1%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Tesoura de Ouro', 'Planaltina', 'SDH Projeção Bloco K lote 01,02 e 03, Brasília', 'DF', '(61) 98427-4063', 'https://www.google.com/maps?q=SDH%20Proje%C3%A7%C3%A3o%20Bloco%20K%20lote%2001%2C02%20e%2003%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Tesoura de Ouro', 'Planaltina (Vila Buritis)', 'Vila buritis, Quadra 03 Conjunto J Lote 39/40 Loja 01, Brasília', 'DF', '(61) 98220-1188', 'https://www.google.com/maps?q=Vila%20buritis%2C%20Quadra%2003%20Conjunto%20J%20Lote%2039%2F40%20Loja%2001%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Tesoura de Ouro', 'Planaltina', 'QC 03 MC Lt 07B Loja 1 a 6 - St. Norte, Planaltina', 'GO', '(61) 98427-4003', 'https://www.google.com/maps?q=QC%2003%20MC%20Lt%2007B%20Loja%201%20a%206%20-%20St.%20Norte%2C%20Planaltina%2C%20GO'),
  ('Tesoura de Ouro', 'Planaltina (Setor Norte)', 'Qa 3 MC 4 lote 3 - Térreo - St. Norte, Planaltina', 'GO', '(61) 98427-4059', 'https://www.google.com/maps?q=Qa%203%20MC%204%20lote%203%20-%20T%C3%A9rreo%20-%20St.%20Norte%2C%20Planaltina%2C%20GO'),
  ('Tesoura de Ouro', 'Porangatu', 'Av. Adélino Américo de Azevedo, Quadra 28 Lote parte 01, Lote parte 02 - Centro, Porangatu - GO,', 'GO', '(61) 98427-4009', 'https://www.google.com/maps?q=Av.%20Ad%C3%A9lino%20Am%C3%A9rico%20de%20Azevedo%2C%20Quadra%2028%20Lote%20parte%2001%2C%20Lote%20parte%2002%20-%20Centro%2C%20Porangatu%20-%20GO%2C%2C%20GO'),
  ('Tesoura de Ouro', 'Recanto das Emas', 'Q 103 - Recanto das Emas, Brasília', 'DF', '(61) 98427-4064', 'https://www.google.com/maps?q=Q%20103%20-%20Recanto%20das%20Emas%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Tesoura de Ouro', 'Recanto das Emas (Recanto Shopping)', 'Quadra 103 Lote 17 Loja 10 Shopping Recanto Center - Recanto das Emas, Brasília', 'DF', '(61) 99972-4517', 'https://www.google.com/maps?q=Quadra%20103%20Lote%2017%20Loja%2010%20Shopping%20Recanto%20Center%20-%20Recanto%20das%20Emas%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Tesoura de Ouro', 'Riacho Fundo I', 'Bloco A - Lote 01 - Lojas 02/03, Riacho Fundo I Cln 7, Brasília', 'DF', '(61) 98419-8089', 'https://www.google.com/maps?q=Bloco%20A%20-%20Lote%2001%20-%20Lojas%2002%2F03%2C%20Riacho%20Fundo%20I%20Cln%207%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Tesoura de Ouro', 'Samambaia Sul', 'Qn 310 conjunto 01 loja 01 e 02 - Samambaia Sul, Brasília', 'DF', '(61) 99953-2051', 'https://www.google.com/maps?q=Qn%20310%20conjunto%2001%20loja%2001%20e%2002%20-%20Samambaia%20Sul%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Tesoura de Ouro', 'Santa Maria', 'CL 114 - Santa Maria, Brasília', 'DF', '(61) 98220-0777', 'https://www.google.com/maps?q=CL%20114%20-%20Santa%20Maria%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Tesoura de Ouro', 'Santo Antônio do Descoberto', 'Centro, Santo Antônio do Descoberto', 'GO', '(61) 98427-4065', 'https://www.google.com/maps?q=Centro%2C%20Santo%20Ant%C3%B4nio%20do%20Descoberto%2C%20GO'),
  ('Tesoura de Ouro', 'São Sebastião', 'Rua 48, 91 Centro - São Sebastião, Brasília', 'DF', '(61) 98427-4088', 'https://www.google.com/maps?q=Rua%2048%2C%2091%20Centro%20-%20S%C3%A3o%20Sebasti%C3%A3o%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Tesoura de Ouro', 'Senador Canedo', 'Av. Dom Emanuel, Qd 1H Lt 1 - Jardim de Todos Os Santos, Sen. Canedo', 'GO', '(61) 99803-2909', 'https://www.google.com/maps?q=Av.%20Dom%20Emanuel%2C%20Qd%201H%20Lt%201%20-%20Jardim%20de%20Todos%20Os%20Santos%2C%20Sen.%20Canedo%2C%20GO'),
  ('Tesoura de Ouro', 'Sobradinho', 'Quadra 12 CL 7A - Sobradinho, Brasília', 'DF', '(61) 98427-4007', 'https://www.google.com/maps?q=Quadra%2012%20CL%207A%20-%20Sobradinho%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Tesoura de Ouro', 'Taguacenter (Taguatinga)', 'St. G Norte CNG 4 - Taguatinga, Brasília', 'DF', '(61) 98220-1114', 'https://www.google.com/maps?q=St.%20G%20Norte%20CNG%204%20-%20Taguatinga%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Tesoura de Ouro', 'Taguatinga Centro', 'T 08 lote 07/08 Loja 1 - Taguatinga - Centro, Brasília', 'DF', '(61) 98117-8830', 'https://www.google.com/maps?q=T%2008%20lote%2007%2F08%20Loja%201%20-%20Taguatinga%20-%20Centro%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Tesoura de Ouro', 'Tesoura Mais', 'SDH Projeção Bloco K(Atrás da Nova Tesoura de Ouro da Rodoviária) - Planaltina', 'DF', null, 'https://maps.app.goo.gl/oxah5sZzvS2sF4KW6'),
  ('Tesoura de Ouro', 'Valparaíso', 'Lt 14, 15 E 16 - Rua 01 Qd 56 A 61, Jardim Oriente, Valparaíso de Goiás', 'GO', '(61) 98448-5185', 'https://www.google.com/maps?q=Lt%2014%2C%2015%20E%2016%20-%20Rua%2001%20Qd%2056%20A%2061%2C%20Jardim%20Oriente%2C%20Valpara%C3%ADso%20de%20Goi%C3%A1s%2C%20GO'),
  ('Tesoura de Ouro', 'Valparaíso Shopping', 'QD 01 lt 01 BR 040, Km 12, Gleba F loja 265 A - Shopping Sul - Parque Esplanada III, Valparaíso de Goiás', 'GO', '(61) 98437-8277', 'https://www.google.com/maps?q=QD%2001%20lt%2001%20BR%20040%2C%20Km%2012%2C%20Gleba%20F%20loja%20265%20A%20-%20Shopping%20Sul%20-%20Parque%20Esplanada%20III%2C%20Valpara%C3%ADso%20de%20Goi%C3%A1s%2C%20GO'),
  ('Magazine da Economia', 'Águas Lindas', 'Av. Jk, 19 - Quadra 27, Loja 17 - Jardim Brasília, Águas Lindas de Goiás', 'GO', '(61) 98220-0908', 'https://www.google.com/maps?q=Av.%20Jk%2C%2019%20-%20Quadra%2027%2C%20Loja%2017%20-%20Jardim%20Bras%C3%ADlia%2C%20%C3%81guas%20Lindas%20de%20Goi%C3%A1s%2C%20GO'),
  ('Magazine da Economia', 'Aparecida de Goiânia', 'Av. Independência, Quadra 56 Lote 01-8/13-16 Loja 05 - Bairro Independência, Aparecida de Goiânia', 'GO', '(61) 99694-6420', 'https://www.google.com/maps?q=Av.%20Independ%C3%AAncia%2C%20Quadra%2056%20Lote%2001-8%2F13-16%20Loja%2005%20-%20Bairro%20Independ%C3%AAncia%2C%20Aparecida%20de%20Goi%C3%A2nia%2C%20GO'),
  ('Magazine da Economia', 'Brazlândia', 'Qd. 01 Norte loja 02, St. Norte, 1 - Brazlândia, Brasília', 'DF', '(61) 98220-1009', 'https://www.google.com/maps?q=Qd.%2001%20Norte%20loja%2002%2C%20St.%20Norte%2C%201%20-%20Brazl%C3%A2ndia%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Magazine da Economia', 'Ceilândia', 'St. N QNN 02 Conjunto H Lote 03 - Ceilândia, Brasília', 'DF', '(61) 98220-0910', 'https://www.google.com/maps?q=St.%20N%20QNN%2002%20Conjunto%20H%20Lote%2003%20-%20Ceil%C3%A2ndia%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Magazine da Economia', 'Cidade Ocidental', 'Q SQ, 16 - QUADRA 7 - Centro, Cidade Ocidental', 'GO', '(61) 99695-3410', 'https://www.google.com/maps?q=Q%20SQ%2C%2016%20-%20QUADRA%207%20-%20Centro%2C%20Cidade%20Ocidental%2C%20GO'),
  ('Magazine da Economia', 'Cristalina', 'R. Goiás, 1068 - Centro, Cristalina', 'GO', '(61) 99959-7835', 'https://www.google.com/maps?q=R.%20Goi%C3%A1s%2C%201068%20-%20Centro%2C%20Cristalina%2C%20GO'),
  ('Magazine da Economia', 'Formosa', 'R. Visc. de Porto Seguro, 681 - Loja A - Centro, Formosa', 'GO', '(61) 98220-0700', 'https://www.google.com/maps?q=R.%20Visc.%20de%20Porto%20Seguro%2C%20681%20-%20Loja%20A%20-%20Centro%2C%20Formosa%2C%20GO'),
  ('Magazine da Economia', 'Gama', 'St Scc Projeção 10 Subsl, St. Central - Gama, Brasília', 'DF', '(61) 99961-9328', 'https://www.google.com/maps?q=St%20Scc%20Proje%C3%A7%C3%A3o%2010%20Subsl%2C%20St.%20Central%20-%20Gama%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Magazine da Economia', 'Garavelo', 'Avenida Iqualdade, esquina com a Rua, R. Garavelo, 01 - 19c Quadra 111 Lote, Aparecida de Goiânia', 'GO', '(61) 98437-8273', 'https://www.google.com/maps?q=Avenida%20Iqualdade%2C%20esquina%20com%20a%20Rua%2C%20R.%20Garavelo%2C%2001%20-%2019c%20Quadra%20111%20Lote%2C%20Aparecida%20de%20Goi%C3%A2nia%2C%20GO'),
  ('Magazine da Economia', 'Itapoã', 'Ql 04 Conjunto I casa 07, Condomínio Itapuã II, Brasília', 'DF', '(61) 98220-0807', 'https://www.google.com/maps?q=Ql%2004%20Conjunto%20I%20casa%2007%2C%20Condom%C3%ADnio%20Itapu%C3%A3%20II%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Magazine da Economia', 'Jardim Ingá', 'R. Brasília, S/N - Lote 10 - Jardim Ingá, Luziânia', 'GO', '(61) 98427-4075', 'https://www.google.com/maps?q=R.%20Bras%C3%ADlia%2C%20S%2FN%20-%20Lote%2010%20-%20Jardim%20Ing%C3%A1%2C%20Luzi%C3%A2nia%2C%20GO'),
  ('Magazine da Economia', 'Luziânia', 'R. do Comércio, 129 - Sala 01 - Centro, Luziânia', 'GO', '(61) 98220-0808', 'https://www.google.com/maps?q=R.%20do%20Com%C3%A9rcio%2C%20129%20-%20Sala%2001%20-%20Centro%2C%20Luzi%C3%A2nia%2C%20GO'),
  ('Magazine da Economia', 'Pedregal', 'Qd 490, Lt 04 - Parque Estrela Dalva VI, Novo Gama', 'GO', '(61) 98220-1118', 'https://www.google.com/maps?q=Qd%20490%2C%20Lt%2004%20-%20Parque%20Estrela%20Dalva%20VI%2C%20Novo%20Gama%2C%20GO'),
  ('Magazine da Economia', 'Planaltina', 'Setor de Hotéis e diversões, Projeção H1 Térreo - Loja A, Brasília', 'DF', '(61) 98220-0800', 'https://www.google.com/maps?q=Setor%20de%20Hot%C3%A9is%20e%20divers%C3%B5es%2C%20Proje%C3%A7%C3%A3o%20H1%20T%C3%A9rreo%20-%20Loja%20A%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Magazine da Economia', 'Planaltina', 'QA 04 MC lote 09 a 11 - St. Leste, Planaltina', 'GO', '(61) 99697-0753', 'https://www.google.com/maps?q=QA%2004%20MC%20lote%2009%20a%2011%20-%20St.%20Leste%2C%20Planaltina%2C%20GO'),
  ('Magazine da Economia', 'Paranoá', 'Paranoá - Q 17 Lote 08 loja 01 - Paranoá, Brasília, 71571-701', 'DF', '(61) 98117-8830', 'https://www.google.com/maps?q=Parano%C3%A1%20-%20Q%2017%20Lote%2008%20loja%2001%20-%20Parano%C3%A1%2C%20Bras%C3%ADlia%2C%2071571-701%2C%20DF'),
  ('Magazine da Economia', 'Riacho Fundo I', 'QN 7 Conjunto 02 Lote 20 e 22 - Riacho Fundo I, Brasília', 'DF', '(61) 98220-0999', 'https://www.google.com/maps?q=QN%207%20Conjunto%2002%20Lote%2020%20e%2022%20-%20Riacho%20Fundo%20I%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Magazine da Economia', 'Recanto das Emas', 'Quadra 104 lote 1 e 2 - Recanto das Emas, Brasília', 'DF', '(61) 98220-1001', 'https://www.google.com/maps?q=Quadra%20104%20lote%201%20e%202%20-%20Recanto%20das%20Emas%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Magazine da Economia', 'Santa Maria', 'Av. Alagados, CL 114 Lotes C D F - Santa Maria, Brasília', 'DF', '(61) 99952-0117', 'https://www.google.com/maps?q=Av.%20Alagados%2C%20CL%20114%20Lotes%20C%20D%20F%20-%20Santa%20Maria%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Magazine da Economia', 'Santo Antônio do Descoberto', 'Q Quadra 55 Lote 09 - Centro, Santo Antônio do Descoberto', 'GO', '(61) 98220-0900', 'https://www.google.com/maps?q=Q%20Quadra%2055%20Lote%2009%20-%20Centro%2C%20Santo%20Ant%C3%B4nio%20do%20Descoberto%2C%20GO'),
  ('Magazine da Economia', 'São Sebastião', 'Rua 48 Lote 230 e 210 01, e 02 - Centro, São Sebastião, Brasília', 'DF', '(61) 98220-0909', 'https://www.google.com/maps?q=Rua%2048%20Lote%20230%20e%20210%2001%2C%20e%2002%20-%20Centro%2C%20S%C3%A3o%20Sebasti%C3%A3o%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Magazine da Economia', 'Samambaia Norte', 'Qn 210 Conjunto A, Lote 1 - Samambaia Norte, Brasília', 'DF', '(61) 98220-0888', 'https://www.google.com/maps?q=Qn%20210%20Conjunto%20A%2C%20Lote%201%20-%20Samambaia%20Norte%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Magazine da Economia', 'Senador Canedo', 'Avenida Dom Emanuel Qd 1H Lt 23 - Jardim de Todos Os Santos, Sen. Canedo', 'GO', '(61) 99697-6275', 'https://www.google.com/maps?q=Avenida%20Dom%20Emanuel%20Qd%201H%20Lt%2023%20-%20Jardim%20de%20Todos%20Os%20Santos%2C%20Sen.%20Canedo%2C%20GO'),
  ('Magazine da Economia', 'Sobradinho', 'Q Quadra 8 Bloco 10, Lote Rua 1 a 3 - Sobradinho, Brasília', 'DF', '(61) 98220-0880', 'https://www.google.com/maps?q=Q%20Quadra%208%20Bloco%2010%2C%20Lote%20Rua%201%20a%203%20-%20Sobradinho%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Magazine da Economia', 'Valparaíso', 'Quadra 62 Lote14, loja 03 - Jardim Oriente, Valparaíso de Goiás', 'GO', '(61) 98220-0990', 'https://www.google.com/maps?q=Quadra%2062%20Lote14%2C%20loja%2003%20-%20Jardim%20Oriente%2C%20Valpara%C3%ADso%20de%20Goi%C3%A1s%2C%20GO'),
  ('Free Center Calçados', 'Águas Lindas (Jardim Brasília)', 'Quadra 27 Lote 18 - Jardim Brasília, Águas Lindas de Goiás', 'GO', '(61) 98220-1110', 'https://www.google.com/maps?q=Quadra%2027%20Lote%2018%20-%20Jardim%20Bras%C3%ADlia%2C%20%C3%81guas%20Lindas%20de%20Goi%C3%A1s%2C%20GO'),
  ('Free Center Calçados', 'Águas Lindas Shopping', 'BR-070 - Mansões Centroeste, Águas Lindas de Goiás', 'GO', '(61) 99693-1675', 'https://www.google.com/maps?q=BR-070%20-%20Mans%C3%B5es%20Centroeste%2C%20%C3%81guas%20Lindas%20de%20Goi%C3%A1s%2C%20GO'),
  ('Free Center Calçados', 'Caldas Novas', 'Av. Cel. Bento de Godoy, Quadra 23 - Lote 1A - Centro, Caldas Novas', 'GO', '(61) 98220-0706', 'https://www.google.com/maps?q=Av.%20Cel.%20Bento%20de%20Godoy%2C%20Quadra%2023%20-%20Lote%201A%20-%20Centro%2C%20Caldas%20Novas%2C%20GO'),
  ('Free Center Calçados', 'Ceilândia', 'St. M CNM 2 bl c Lote 05/06 - Ceilândia Centro, Brasília', 'DF', '(61) 98220-0770', 'https://www.google.com/maps?q=St.%20M%20CNM%202%20bl%20c%20Lote%2005%2F06%20-%20Ceil%C3%A2ndia%20Centro%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Free Center Calçados', 'Cidade Ocidental', 'Avenida dos Comércios SQ 18 Qd 01 Lt 35 Centro, Cidade Ocidental', 'GO', '(61) 99655-3089', 'https://www.google.com/maps?q=Avenida%20dos%20Com%C3%A9rcios%20SQ%2018%20Qd%2001%20Lt%2035%20Centro%2C%20Cidade%20Ocidental%2C%20GO'),
  ('Free Center Calçados', 'Cristalina', 'Rua Goiás s/n Quadra 22 Lote 09 Loja 34 Térreo - Centro, Cristalina', 'GO', '(61) 99632-7592', 'https://www.google.com/maps?q=Rua%20Goi%C3%A1s%20s%2Fn%20Quadra%2022%20Lote%2009%20Loja%2034%20T%C3%A9rreo%20-%20Centro%2C%20Cristalina%2C%20GO'),
  ('Free Center Calçados', 'Formosa', 'R. Visc. de Porto Seguro, 615 - Centro, Formosa', 'GO', '(61) 99929-0186', 'https://www.google.com/maps?q=R.%20Visc.%20de%20Porto%20Seguro%2C%20615%20-%20Centro%2C%20Formosa%2C%20GO'),
  ('Free Center Calçados', 'Gama', 'Bl 07 Lt 1A Lojas 1,3,5,7,9,11,13 - Gama, Brasília', 'DF', '(61) 98408-6164', 'https://www.google.com/maps?q=Bl%2007%20Lt%201A%20Lojas%201%2C3%2C5%2C7%2C9%2C11%2C13%20-%20Gama%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Free Center Calçados', 'Goianésia', 'Av. Goiás, 259 - Quadra. 82, Lote 26 - Carrilho, Goianésia', 'GO', '(62) 99814-6533', 'https://www.google.com/maps?q=Av.%20Goi%C3%A1s%2C%20259%20-%20Quadra.%2082%2C%20Lote%2026%20-%20Carrilho%2C%20Goian%C3%A9sia%2C%20GO'),
  ('Free Center Calçados', 'Luziânia', 'R. do Comércio, nº110 - Centro, Luziânia', 'GO', '(61) 99804-6514', 'https://www.google.com/maps?q=R.%20do%20Com%C3%A9rcio%2C%20n%C2%BA110%20-%20Centro%2C%20Luzi%C3%A2nia%2C%20GO'),
  ('Free Center Calçados', 'Núcleo Bandeirante', 'Avenida Central Bloco 227/359 Lote 323 loja 01 - Núcleo Bandeirante, Brasília', 'DF', '(61) 98220-1117', 'https://www.google.com/maps?q=Avenida%20Central%20Bloco%20227%2F359%20Lote%20323%20loja%2001%20-%20N%C3%BAcleo%20Bandeirante%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Free Center Calçados', 'Paranoá', 'Avenida Paranoá quadra 17 Conjunto 11 Lote 02 Loja 01 - Paranoá, Brasília', 'DF', '(61) 98220-1116', 'https://www.google.com/maps?q=Avenida%20Parano%C3%A1%20quadra%2017%20Conjunto%2011%20Lote%2002%20Loja%2001%20-%20Parano%C3%A1%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Free Center Calçados', 'Pedregal', 'Qd 490, Lt 04 - Parque Estrela Dalva VI, Novo Gama', 'GO', '(61) 98220-1118', 'https://www.google.com/maps?q=Qd%20490%2C%20Lt%2004%20-%20Parque%20Estrela%20Dalva%20VI%2C%20Novo%20Gama%2C%20GO'),
  ('Free Center Calçados', 'Planaltina (Buritis)', 'Q Quadra 4 Conjunto, Setor Residencial Leste - Buritís I Q 1 Cl Conjunto, 60 - Loja 01 E 02 - H, Brasília', 'DF', '(61) 99611-2784', 'https://www.google.com/maps?q=Q%20Quadra%204%20Conjunto%2C%20Setor%20Residencial%20Leste%20-%20Burit%C3%ADs%20I%20Q%201%20Cl%20Conjunto%2C%2060%20-%20Loja%2001%20E%2002%20-%20H%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Free Center Calçados', 'Planaltina (Via WL2)', 'QSHD SN Setor de Hoteis Loja 9-10-11-12, Brasília', 'DF', '(61) 98116-2395', 'https://www.google.com/maps?q=QSHD%20SN%20Setor%20de%20Hoteis%20Loja%209-10-11-12%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Free Center Calçados', 'Planaltina', 'Q QA 3 Mc Lote 03 e Mr Lotes 03, Sobreloja - St. Norte, Planaltina', 'GO', '(61) 98437-8208', 'https://www.google.com/maps?q=Q%20QA%203%20Mc%20Lote%2003%20e%20Mr%20Lotes%2003%2C%20Sobreloja%20-%20St.%20Norte%2C%20Planaltina%2C%20GO'),
  ('Free Center Calçados', 'Recanto das Emas', 'Qd 203 lote14 - Recanto das Emas, Brasília', 'DF', '(61) 98220-1113', 'https://www.google.com/maps?q=Qd%20203%20lote14%20-%20Recanto%20das%20Emas%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Free Center Calçados', 'Samambaia', 'QS 412 - Samambaia Norte, Brasília', 'DF', '(61) 98220-1112', 'https://www.google.com/maps?q=QS%20412%20-%20Samambaia%20Norte%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Free Center Calçados', 'São Sebastião', 'Rua 48, 210 - São Sebastião, Brasília', 'DF', '(61) 98220-1115', 'https://www.google.com/maps?q=Rua%2048%2C%20210%20-%20S%C3%A3o%20Sebasti%C3%A3o%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Free Center Calçados', 'Santa Maria', 'CL 114 - Santa Maria, Brasília', 'DF', '(61) 98220-1221', 'https://www.google.com/maps?q=CL%20114%20-%20Santa%20Maria%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Free Center Calçados', 'Shopping Conjunto Nacional', 'Setor de Diversões Norte Loja 20/23 - Térreo, Brasília', 'DF', '(61) 99690-4447', 'https://www.google.com/maps?q=Setor%20de%20Divers%C3%B5es%20Norte%20Loja%2020%2F23%20-%20T%C3%A9rreo%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Free Center Calçados', 'Shopping DF Plaza', 'Shopping DF Plaza, R. Copaíba, lote 01 - Térreo - Águas Claras, Brasília', 'DF', '(61) 99859-5741', 'https://www.google.com/maps?q=Shopping%20DF%20Plaza%2C%20R.%20Copa%C3%ADba%2C%20lote%2001%20-%20T%C3%A9rreo%20-%20%C3%81guas%20Claras%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Free Center Calçados', 'SIA', 'SIA Trecho 10 Lote nº 5, Sia, 35 - Loja 33, Brasília', 'DF', '(61) 99611-1149', 'https://www.google.com/maps?q=SIA%20Trecho%2010%20Lote%20n%C2%BA%205%2C%20Sia%2C%2035%20-%20Loja%2033%2C%20Bras%C3%ADlia%2C%20DF'),
  ('Free Center Calçados', 'Valparaíso', 'Rua 01 Quadra 63, 11 - Jardim Oriente, Valparaíso de Goiás', 'GO', '(61) 98177-0472', 'https://www.google.com/maps?q=Rua%2001%20Quadra%2063%2C%2011%20-%20Jardim%20Oriente%2C%20Valpara%C3%ADso%20de%20Goi%C3%A1s%2C%20GO'),
  ('Free Center Calçados', 'Valparaíso Shopping', 'BR-040, 262 - Parque Esplanada III, Valparaíso de Goiás', 'GO', '(61) 99973-6772', 'https://www.google.com/maps?q=BR-040%2C%20262%20-%20Parque%20Esplanada%20III%2C%20Valpara%C3%ADso%20de%20Goi%C3%A1s%2C%20GO'),
  ('Free Center Calçados', 'Sobradinho', 'Quadra Central Bloco 10 Lote 1 e 2 - Sobradinho, Brasília', 'DF', '(61) 98427-4092', 'https://www.google.com/maps?q=Quadra%20Central%20Bloco%2010%20Lote%201%20e%202%20-%20Sobradinho%2C%20Bras%C3%ADlia%2C%20DF')
on conflict (marca, regiao, uf) do nothing;

notify pgrst, 'reload schema';

commit;
