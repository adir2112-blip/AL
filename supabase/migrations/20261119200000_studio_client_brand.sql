-- Studio AL: a saved client can carry its brand, so a deck made for it
-- comes out in its colours, with its logo and cover photos:
-- {color, dark, logo, logo_dark, images[], site}. Logos and photos are
-- small data URLs, scaled down in the browser before they are saved.
alter table public.studio_clients add column if not exists brand jsonb
  check (brand is null or (jsonb_typeof(brand) = 'object' and pg_column_size(brand) <= 2500000));
