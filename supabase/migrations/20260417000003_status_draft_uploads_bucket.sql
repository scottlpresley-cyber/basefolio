-- Sprint 1: private bucket for Status Draft uploads. 10 MB cap enforced at
-- the storage layer; MIME type filtering is deliberately left off because
-- browsers report .csv under several MIME types and server-side filtering
-- causes false rejections. Real validation happens in the upload route.
-- No storage.objects policies: the upload route uses the service role.

insert into storage.buckets (id, name, public, file_size_limit)
values ('status-draft-uploads', 'status-draft-uploads', false, 10485760)
on conflict (id) do nothing;
