# BluePrint Web API Endpoints

This document summarizes all HTTP endpoints defined in `src/web/server.js`, including API routes and public page routes.

---

## Authentication Endpoints

### `POST /api/auth/login`
- Access: Public
- Rate limiting: 10 requests per 15 minutes per email+IP
- Description: Authenticates a web user (teacher or administrator) by email/password.
- Request body: `{ email, password }`
- Response: `200` JWT token and user profile on success.

### `POST /api/auth/logout`
- Access: Authenticated
- Description: Destroys the current session and logs out the web user.
- Response: `200` success.

### `GET /api/auth/me`
- Access: Authenticated
- Description: Returns the current authenticated user profile from the database.
- Response: `200` user record.


## Student App / Scanner Encryption Endpoints

### `POST /api/app/auth/login`
- Access: Public
- Description: Authenticates a student app user with `student_id`, `password`, and `uuid`.
- Request body: `{ student_id, password, uuid }`
- Response: `200` JWT token and student info.

### `POST /api/app/encrypt_student_id`
- Access: Authenticated students
- Description: Encrypts a student ID using the current daily AES key for QR payload generation.
- Request body: `{ student_id }`
- Response: `{ encryptedData, iv, authTag, date }`.

### `POST /api/scanner/decrypt`
- Access: Authenticated scanner
- Description: Decrypts a scanner payload created by the mobile app.
- Request body: `{ encryptedData, iv, authTag, date }`
- Response: `{ student_id }`.

### `POST /api/app/students/:id/reset_uuid`
- Access: Administrator only
- Description: Clears a student's bound device UUID so they can sign in from another device.
- URL param: `id` student database ID.
- Response: `200` success.


## Student Management Endpoints

### `POST /api/students`
- Access: Administrator only
- Description: Creates a new student account.
- Request body: `{ student_id, first_name, last_name, password, uuid? }`
- Response: `201` created student.

### `POST /api/students/bulk`
- Access: Administrator only
- Description: Creates multiple student accounts from an array.
- Request body: `{ students: [...] }`
- Response: `201` success with inserted count.

### `GET /api/students`
- Access: Administrator only
- Description: Retrieves all students.
- Response: `200` array of student records.

### `GET /api/students/search`
- Access: Authenticated
- Description: Searches students by partial student ID, first name, or last name.
- Query: `q`
- Response: `200` matching student list.

### `GET /api/students/:id`
- Access: Administrator only
- Description: Gets a specific student by database ID.
- URL param: `id`
- Response: `200` student record.

### `PUT /api/students/:id`
- Access: Administrator only
- Description: Updates student fields such as student ID, name, or password.
- Request body: any of `{ student_id, first_name, last_name, password }`
- Response: `200` updated student.

### `DELETE /api/students/:id`
- Access: Administrator only
- Description: Deletes a student record.
- URL param: `id`
- Response: `200` success.


## Scanner Management Endpoints

### `POST /api/scanners`
- Access: Administrator only
- Description: Creates a new scanner account.
- Request body: `{ SCANNER_ID, SCANNER_LOCATION, SCANNER_PASSWORD }`
- Response: `201` created scanner.

### `POST /api/scanners/bulk`
- Access: Administrator only
- Description: Creates multiple scanners in bulk.
- Request body: `{ scanners: [...] }`
- Response: `201` success with inserted count.

### `GET /api/scanners`
- Access: Administrator only
- Description: Retrieves all scanner accounts and status information.
- Response: `200` scanner list.

### `GET /api/scanners/:id`
- Access: Administrator only
- Description: Gets a single scanner by database ID.
- URL param: `id`
- Response: `200` scanner record.

### `PUT /api/scanners/:id`
- Access: Administrator only
- Description: Updates scanner metadata or password.
- Request body: any of `{ scanner_id, scanner_location, scanner_password }`
- Response: `200` updated scanner.

### `DELETE /api/scanners/:id`
- Access: Administrator only
- Description: Deletes a scanner account.
- URL param: `id`
- Response: `200` success.

### `POST /api/scanner/auth/login`
- Access: Public
- Description: Authenticates a scanner device and issues a scanner JWT token.
- Request body: `{ SCANNER_ID, SCANNER_LOCATION, SCANNER_PASSWORD }`
- Response: `200` token and scanner info.

### `GET /api/scanner/key_me`
- Access: Authenticated
- Description: Returns the current daily key used for scanner decryption.
- Response: `200` `{ key }`.

### `POST /api/scanners/:id/terminal`
- Access: Administrator only
- Description: Sends a terminal command to a scanner or queues it while offline.
- Request body: `{ command }`
- Response: `200` confirmation.

### `GET /api/scanners/:id/terminal`
- Access: Authenticated
- Description: Scanner poll endpoint for next queued command.
- Response: `200` next command and session mode.

### `POST /api/scanners/:id/heartbeat`
- Access: Authenticated
- Description: Updates scanner online status and battery level.
- Request body: `{ battery_level? }`
- Response: `200` success.

### `POST /api/scanners/:id/terminal/output`
- Access: Authenticated
- Description: Receives scanner terminal output and updates session history.
- Request body: `{ output, mode, commandId? }`
- Response: `200` success.

### `GET /api/scanners/:id/terminal/output`
- Access: Administrator only
- Description: Polls scanner terminal output history and current mode.
- Query: `afterVersion` optional
- Response: `200` output metadata.


## Web User Management Endpoints

### `POST /api/users`
- Access: Administrator only
- Description: Creates a new web user (teacher or administrator).
- Request body: `{ email, first_name, last_name, password, role, courses? }`
- Response: `201` created user.

### `POST /api/users/bulk`
- Access: Administrator only
- Description: Bulk creates multiple web users.
- Request body: `{ users: [...] }`
- Response: `201` success with inserted count.

### `GET /api/users`
- Access: Administrator only
- Description: Returns all web users.
- Response: `200` user list.

### `GET /api/users/:id`
- Access: Administrator only
- Description: Returns a single user by ID.
- Response: `200` user record.

### `PUT /api/users/:id`
- Access: Administrator only
- Description: Updates user fields and course assignments.
- Request body: any of `{ email, first_name, last_name, password, role, courses }`
- Response: `200` updated user.

### `DELETE /api/users/:id`
- Access: Administrator only
- Description: Deletes a web user.
- Response: `200` success.


## Map Layout Endpoints

### `POST /api/map-layout`
- Access: Authenticated
- Description: Saves or updates the campus map layout.
- Request body: map layout object.
- Response: `200` success.

### `GET /api/map-layout`
- Access: Authenticated
- Description: Retrieves the saved campus map layout.
- Response: `200` map data object.


## Courses Endpoints

### `POST /api/courses`
- Access: Administrator only
- Description: Creates a new course with room and period.
- Request body: `{ room, period }`
- Response: `201` created course.

### `GET /api/courses`
- Access: Authenticated
- Description: Returns courses visible to the current user.
- Response: `200` course list.

### `DELETE /api/courses/:id`
- Access: Administrator only
- Description: Deletes a course and removes it from teacher assignments.
- Response: `200` success.

### `PUT /api/courses/:id`
- Access: Administrator only
- Description: Updates course room/period.
- Request body: `{ room, period }`
- Response: `200` updated course.


## Calendar Endpoints

### `GET /api/calendar/today`
- Access: Public
- Description: Returns today's calendar schedule and cached metadata.
- Response: `200` `{ events, lastUpdated, date }`.


## Logs Endpoints

### `GET /api/logs`
- Access: Authenticated
- Description: Returns attendance logs visible to the current user.
- Response: `200` logs array.

### `GET /api/logs/csv`
- Access: Authenticated
- Description: Exports visible logs as CSV.
- Response: `200` CSV file attachment.

### `POST /api/logs`
- Access: Authenticated
- Description: Creates a new attendance log entry.
- Request body: log object.
- Response: `201` success.

### `POST /api/logs/bulk`
- Access: Authenticated
- Description: Bulk inserts attendance logs from a CSV payload.
- Request body: `{ logs: [...] }`
- Response: `201` success with inserted count.

### `DELETE /api/logs/:id`
- Access: Authenticated
- Description: Deletes a log entry, with teacher scope checks.
- Response: `200` success.

### `POST /api/admin/logs/clear`
- Access: Administrator only
- Description: Deletes all attendance logs.
- Response: `200` success with deleted count.

### `POST /api/admin/reindex`
- Access: Administrator only
- Description: Executes a database reindex using configured DB name.
- Response: `200` success.

### `POST /api/logs/assign-periods`
- Access: Authenticated
- Description: Manually triggers assignment of missing periods for logs.
- Response: `200` success.

### `POST /api/logs/assign-statuses`
- Access: Authenticated
- Description: Manually triggers assignment of missing attendance statuses.
- Response: `200` success.

### `GET /api/logs/analytics`
- Access: Authenticated
- Description: Returns aggregated attendance analytics for visible logs.
- Response: `200` analytics array.

### `GET /api/logs/:room`
- Access: Authenticated
- Description: Returns visible logs filtered by room.
- Response: `200` log list.

### `GET /api/logs/:room/:period`
- Access: Authenticated
- Description: Returns visible logs filtered by room and period.
- Response: `200` log list.

### `GET /api/logs/:room/:period/:date`
- Access: Authenticated
- Description: Returns visible logs filtered by room, period, and date.
- Response: `200` log list.


## Settings Endpoints

### `GET /api/settings/grace-period`
- Access: Administrator only
- Description: Returns the current attendance grace period setting.
- Response: `200` `{ value: number }`.

### `PUT /api/settings/grace-period`
- Access: Administrator only
- Description: Updates the attendance grace period and persists it.
- Request body: `{ value }`
- Response: `200` success.


## Public Page Routes

### `GET /login`
- Description: Serves the login page.

### `GET /`
- Description: Serves the main dashboard page for authenticated users.

### `GET /room`
- Description: Serves the room overview page.

### `GET /profile`
- Description: Serves the user profile page.

### `GET /analytics`
- Description: Serves the attendance analytics page.

### `GET /master_logs`
- Access: Administrator only
- Description: Serves the master logs management page.

### `GET /my_logs`
- Description: Serves the teacher logs page.

### `GET /calendar`
- Description: Serves the calendar page.

### `GET /map`
- Description: Serves the current class map page.

### `GET /lookup`
- Description: Serves the student lookup page.

### `GET /scanners`
- Description: Serves the connected scanners management page.

### `GET /app_settings`
- Description: Serves the app settings page.

### `GET /admin`
- Access: Administrator only
- Description: Serves the administrator dashboard page.

---

## Notes

- Most API endpoints require `Authorization: Bearer <token>`.
- Administrator-only routes additionally require the authenticated user to have the `administrator` role.
- Static assets are served from `src/web/public` via `express.static`.
