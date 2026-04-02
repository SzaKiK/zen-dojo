-- Seed training sessions with real DHKSE schedule
-- day_of_week: 1=Monday, 2=Tuesday, 4=Thursday, 5=Friday
INSERT INTO training_sessions (title, instructor_name, level, day_of_week, start_time, end_time, capacity, current_bookings)
VALUES
  ('Kempo', 'Shihan Metzger Antal', 'Gyerek és felnőtt', 1, '18:00', '19:30', 25, 0),
  ('Cross Fitness', 'Shihan Metzger Antal', 'Összes szint', 2, '18:00', '19:00', 20, 0),
  ('Kempo Versenyző', 'Sensei Farkas Zoltán', 'Versenyző', 2, '19:00', '20:00', 15, 0),
  ('Kempo', 'Sensei Rácz Richárd', 'Gyerek és felnőtt', 2, '18:15', '19:30', 20, 0),
  ('Kempo Kezdő', 'Shihan Metzger Antal', 'Gyerek és kezdő felnőtt', 4, '18:00', '19:30', 25, 0),
  ('Kempo', 'Sensei Rácz Richárd', 'Gyerek és felnőtt', 5, '17:30', '19:00', 20, 0)
ON CONFLICT DO NOTHING;
