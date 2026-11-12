-- Картинки и видео заказчиков — до 50 МБ каждый файл (предел одного файла на бесплатном тарифе Supabase).
-- Синхронно с LIMITS в supabase/functions/_shared/plans.js. Скрипт можно запускать повторно.
update storage.buckets set file_size_limit = 52428800 where id = 'uploads';
