-- Cover image per post: the owner picks a frame of the video (or uploads his
-- own picture) in the dashboard. It is saved next to the video as
-- <video>.cover.jpg and sent to each network by social-publish.

update storage.buckets
set allowed_mime_types = array['video/mp4', 'video/quicktime', 'image/jpeg']
where id = 'social-videos';

-- Picking another cover before approving overwrites the file (upsert).
drop policy if exists "owner updates social videos" on storage.objects;
create policy "owner updates social videos" on storage.objects
  for update to authenticated
  using (bucket_id = 'social-videos' and (select auth.jwt() ->> 'email') = 'adir2112@gmail.com')
  with check (bucket_id = 'social-videos' and (select auth.jwt() ->> 'email') = 'adir2112@gmail.com');
