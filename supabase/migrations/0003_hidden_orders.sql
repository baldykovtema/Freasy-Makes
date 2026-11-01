-- Убирает заявку со страницы «Заявки». У заказчика в «Моих играх» она остаётся.
alter table public.jobs add column hidden boolean not null default false;
