-- Re-map issue locations to the new venue location list.
-- Run in Supabase SQL Editor after deploying the app update.

update public.issues set department = 'main_wall_tapwall' where department = 'main_wall';
update public.issues set department = 'outdoor_patio' where department = 'outdoor';
update public.issues set department = 'front_desk_entrance' where department = 'front_desk';
update public.issues set department = 'bathrooms' where department = 'bathroom';
update public.issues set department = 'offices' where department = 'break_room';
update public.issues set department = 'back_dock' where department = 'dock';
update public.issues set department = 'vip' where department in ('shuffleboard', 'foosball');
update public.issues set department = 'main_wall_tapwall' where department = 'beverage';
update public.issues set department = 'facilities_area' where department = 'cleaning';
