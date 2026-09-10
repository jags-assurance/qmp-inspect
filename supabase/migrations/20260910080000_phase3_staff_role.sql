-- Splits the flat is_jags_staff boolean into two real personas, matching the prototype's original
-- design (Maya Patel "Jags Admin" vs Priya Nair/Ravi Kapoor "Senior Inspector"): an admin handles
-- client/project setup, numbering, and master-library approval, while an inspector runs the
-- day-to-day field work (ITP activities, checklists, inspections, NCRs, sign-offs). staff_role is
-- only meaningful when is_jags_staff is true; null is treated as admin-equivalent by the app for
-- backward compatibility with the existing seeded admin account, which predates this column.
alter table public.users
  add column staff_role text check (staff_role in ('admin', 'inspector'));

comment on column public.users.staff_role is
  'Only meaningful when is_jags_staff = true. NULL (legacy accounts) behaves as admin.';

-- Mirrors the users-table check into the auth-user bootstrap trigger so a new staff account created
-- with a staff_role in its sign-up metadata gets it carried over, same pattern as is_jags_staff.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, is_jags_staff, staff_role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    coalesce((new.raw_user_meta_data ->> 'is_jags_staff')::boolean, false),
    new.raw_user_meta_data ->> 'staff_role'
  );
  return new;
end;
$$;
