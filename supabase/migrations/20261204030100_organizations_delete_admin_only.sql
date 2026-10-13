-- P4 (checklist): deleting an organisation cascades to its projects, grants, notifications, audit
-- rows and more, yet organizations_staff_delete let ANY active JAGS staff member (including an
-- inspector with access to the organisation) delete it. Only a JAGS Admin may delete an
-- organisation, matching the INSERT/UPDATE policies (is_admin_staff()) and projects_d.
-- The app has no organisation-delete action, so no screen changes behaviour.
-- Idempotent: drop-if-exists then recreate.
drop policy if exists organizations_staff_delete on public.organizations;

create policy organizations_staff_delete on public.organizations
  for delete
  using (public.is_admin_staff());
