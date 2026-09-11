begin;

-- New staff uploads are photos only and stay below Vercel/browser memory
-- limits. Existing migrated objects remain readable regardless of size.
update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array[
    'image/heic',
    'image/heif',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
where id = 'issue-photos';

commit;
