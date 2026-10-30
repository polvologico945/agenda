PRAGMA foreign_keys = ON;
CREATE TABLE instructors (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 cpf_digest TEXT NOT NULL UNIQUE, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
 verified_at TEXT, verified_device TEXT, phone TEXT, categories TEXT NOT NULL DEFAULT 'A,B', photo_key TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT
);
CREATE TABLE tokens (
 token_digest TEXT PRIMARY KEY, instructor_id TEXT NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
 purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')), expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE sessions (
 token_digest TEXT PRIMARY KEY, instructor_id TEXT NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT(datetime('now')),
 device_label TEXT NOT NULL DEFAULT 'Dispositivo'
);
CREATE INDEX idx_sessions_instructor ON sessions(instructor_id);
CREATE TABLE rate_limits (
 key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, reset_at TEXT NOT NULL
);
CREATE TABLE students (
 id TEXT PRIMARY KEY, instructor_id TEXT NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
 name TEXT NOT NULL, search_name TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN ('A','B','C','D','E','AB','AC','AD','AE')),
 phone TEXT NOT NULL, cpf_cipher TEXT, cpf_digest TEXT, lessons_total INTEGER NOT NULL DEFAULT 0 CHECK(lessons_total >= 0 AND lessons_total <= 9999),
 lessons_done INTEGER NOT NULL DEFAULT 0 CHECK(lessons_done >= 0 AND lessons_done <= lessons_total),
 amount_total_cents INTEGER NOT NULL DEFAULT 0 CHECK(amount_total_cents >= 0),
 amount_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK(amount_paid_cents >= 0),
 status TEXT NOT NULL DEFAULT 'nao_iniciadas' CHECK(status IN ('nao_iniciadas','em_andamento','finalizada')),
 archived_at TEXT, deleted_at TEXT,
 created_at TEXT NOT NULL DEFAULT(datetime('now')), updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX idx_students_list ON students(instructor_id,deleted_at,archived_at,search_name,name,id);
CREATE UNIQUE INDEX idx_student_cpf_per_owner ON students(instructor_id,cpf_digest) WHERE cpf_digest IS NOT NULL AND deleted_at IS NULL;
CREATE TABLE lessons (
 id TEXT PRIMARY KEY, instructor_id TEXT NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
 student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
 start_local TEXT NOT NULL, end_local TEXT NOT NULL,
 notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT(datetime('now')),
 CHECK(end_local > start_local)
);
CREATE INDEX idx_lesson_schedule ON lessons(instructor_id,start_local,end_local);
-- Invariante de isolamento: nunca vincular aula a aluno de outro instrutor.
CREATE TRIGGER lessons_owner_insert BEFORE INSERT ON lessons
BEGIN SELECT RAISE(ABORT,'aluno de outro instrutor') WHERE NOT EXISTS
 (SELECT 1 FROM students s WHERE s.id=NEW.student_id AND s.instructor_id=NEW.instructor_id AND s.deleted_at IS NULL AND s.archived_at IS NULL AND s.status!='finalizada'); END;
CREATE TRIGGER lessons_owner_update BEFORE UPDATE ON lessons
BEGIN SELECT RAISE(ABORT,'aluno de outro instrutor') WHERE NOT EXISTS
 (SELECT 1 FROM students s WHERE s.id=NEW.student_id AND s.instructor_id=NEW.instructor_id AND s.deleted_at IS NULL AND s.archived_at IS NULL AND s.status!='finalizada'); END;
-- Triggers são a última barreira mesmo com requisições concorrentes.
CREATE TRIGGER lessons_no_overlap_insert BEFORE INSERT ON lessons
BEGIN SELECT RAISE(ABORT,'horario_conflitante') WHERE EXISTS (
 SELECT 1 FROM lessons l JOIN students s ON s.id=l.student_id
 WHERE l.instructor_id=NEW.instructor_id AND s.deleted_at IS NULL AND s.archived_at IS NULL AND s.status!='finalizada'
 AND NEW.start_local<l.end_local AND NEW.end_local>l.start_local); END;
CREATE TRIGGER lessons_no_overlap_update BEFORE UPDATE ON lessons
BEGIN SELECT RAISE(ABORT,'horario_conflitante') WHERE EXISTS (
 SELECT 1 FROM lessons l JOIN students s ON s.id=l.student_id
 WHERE l.id!=NEW.id AND l.instructor_id=NEW.instructor_id AND s.deleted_at IS NULL AND s.archived_at IS NULL AND s.status!='finalizada'
 AND NEW.start_local<l.end_local AND NEW.end_local>l.start_local); END;
-- Se uma matrícula reativada volta à agenda, deve continuar sem conflitos.
CREATE TRIGGER students_no_reactivate_overlap BEFORE UPDATE OF status,archived_at,deleted_at ON students
WHEN NEW.status!='finalizada' AND NEW.deleted_at IS NULL AND NEW.archived_at IS NULL
BEGIN SELECT RAISE(ABORT,'horario_conflitante') WHERE EXISTS (
 SELECT 1 FROM lessons own JOIN lessons other ON own.id!=other.id AND own.instructor_id=other.instructor_id
 JOIN students o ON o.id=other.student_id
 WHERE own.student_id=NEW.id AND o.id!=NEW.id AND o.deleted_at IS NULL AND o.archived_at IS NULL AND o.status!='finalizada'
 AND own.start_local<other.end_local AND own.end_local>other.start_local); END;
