# Production database checklist

Written for the handover: the production Supabase project should be a paid plan and separate from dev.

1. **Separate projects.** Dev and prod currently share one database. Create a production project, apply every file in
   `supabase/migrations` in order, then point the production Vercel and Railway environments at it.
2. **Compute size.** Free-plan compute has the smallest disk-read budget. Choose a size from the Supabase Reports
   (Database, Disk IO budget) after a week of real use; upgrade when the budget chart dips below about 20%.
3. **Indexes.** `20261213000100_itp_detail_perf.sql` and `20261214000200_prod_indexes.sql` add the remaining indexes.
   `20261214000100_journey_facts.sql` replaces about 25 count queries on the Workflow page with one function.
4. **Caching already in the app:** organisation chrome (2 min), licence map, master disciplines (5 min), header project
   list, and terminology (1 hour, expired immediately when an Admin saves a change).
5. **Slow queries.** Every month, open Query Performance, sort by total time, and fix anything in the top 10.
6. **Background worker.** Set its poll interval to 15 to 30 seconds and the sweep to 15 to 30 minutes; watch the
   Disk IO chart for a day after the first deploy.
7. **Backups.** Turn on daily backups (point-in-time recovery on a paid plan) before the first real data goes in.
8. **Connection pooling.** Use the pooled connection string (port 6543) for Vercel, and the direct string only for
   migrations.
