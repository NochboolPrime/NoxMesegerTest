-- RLS policies for the calls table
-- Participants (caller or callee) can view their own calls
drop policy if exists "calls_select_participant" on public.calls;
create policy "calls_select_participant" on public.calls
  for select
  using (auth.uid() = caller_id or auth.uid() = callee_id);

-- Any authenticated user can insert a call (they become the caller)
drop policy if exists "calls_insert_caller" on public.calls;
create policy "calls_insert_caller" on public.calls
  for insert
  with check (auth.uid() = caller_id);

-- Participants can update call status (answer, end, decline)
drop policy if exists "calls_update_participant" on public.calls;
create policy "calls_update_participant" on public.calls
  for update
  using (auth.uid() = caller_id or auth.uid() = callee_id);

-- Only caller can delete the call record
drop policy if exists "calls_delete_caller" on public.calls;
create policy "calls_delete_caller" on public.calls
  for delete
  using (auth.uid() = caller_id);
