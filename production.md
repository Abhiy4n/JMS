# Local Development Setup Guide

Before starting the project, make sure you have the required versions of Node.js, npm, PostgreSQL, and Git installed.

## 1. Install Node.js

Install the **same Node.js major version used by the project**.

Check your version:

```bash
node -v
npm -v
```

> Do not randomly install the latest Node.js version if the project specifies a different version.

If the project contains a `.nvmrc` file, use that version:

```bash
nvm use
```

If you use `nvm` and the version is not installed:

```bash
nvm install
nvm use
```

---

## 2. Clone the Project

```bash
git clone <repository-url>
cd <project-folder>
```

Switch to the branch you are supposed to work on if necessary:

```bash
git checkout <branch-name>
```

---

## 3. Install Project Dependencies

Usually, you only need:

```bash
npm install
```

This installs everything listed in `package.json`.

You normally **do not need to manually run**:

```bash
npm install prisma --save-dev
npm install @prisma/client
```

if Prisma is already listed in `package.json`.

Only install them manually if they are missing from the project.

---

## 4. Prisma Setup

This project uses Prisma.

Check the installed Prisma version:

```bash
npx prisma -v
```

Make sure everyone is using the **same Prisma version as the project**.

The project should have the Prisma version defined in `package.json`, for example:

```json
{
  "devDependencies": {
    "prisma": "7.10.0"
  },
  "dependencies": {
    "@prisma/client": "7.10.0"
  }
}
```

Use the exact version specified by the project rather than installing the latest version.

If Prisma is missing:

```bash
npm install prisma@7.10.0 --save-dev
npm install @prisma/client@7.10.0
```

> Replace `7.10.0` with the version actually specified by this project.

---

## 5. Do NOT Run `prisma init` on an Existing Project

If the repository already contains:

```text
prisma/
  schema.prisma

prisma.config.ts
```

do **not** run:

```bash
npx prisma init
```

`prisma init` is normally used when creating Prisma in a new project.

The Prisma configuration should already be committed to Git.

---

## 6. Create Your Local Environment File

Create:

```text
.env
```

Use the database connection information provided by the project/team.

Example:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/jms"
```

Do **not** commit `.env` to Git.

Make sure `.env` is included in `.gitignore`.

---

## 7. PostgreSQL

Make sure PostgreSQL is installed and running locally.

Create the database specified by the project.

For example:

```text
Database: jms
Host: localhost
Port: 5432
```

The database itself can initially be empty.

---

## 8. Set Up the Database

### If the project already has Prisma migrations

Run:

```bash
npx prisma migrate dev
```

This applies the existing migrations to your local database.

Then generate Prisma Client:

```bash
npx prisma generate
```

### If this is a brand-new Prisma project

Define your models in:

```text
prisma/schema.prisma
```

Then create the first migration:

```bash
npx prisma migrate dev --name init
```

---

## 9. Important: `db pull` vs `migrate`

Do not use:

```bash
npx prisma db pull
```

just because Prisma is installed.

`db pull` is used when you already have an existing database with tables and want Prisma to read those tables.

```text
Existing Database
       ↓
   db pull
       ↓
schema.prisma
```

For a new project, the normal direction is:

```text
schema.prisma
       ↓
   migration
       ↓
PostgreSQL
```

Use:

```bash
npx prisma migrate dev --name init
```

---

## 10. Start the Next.js Project

After the setup is complete:

```bash
npm run dev
```

Then open the local development URL shown by Next.js, usually:

```text
http://localhost:3000
```

---

# Quick Setup

For a developer joining an already-configured project, the normal setup should be approximately:

```bash
git clone <repository-url>
cd <project-folder>

npm install

# Create your own .env
# Add DATABASE_URL

npx prisma migrate dev
npx prisma generate

npm run dev
```

Check versions if something does not work:

```bash
node -v
npm -v
npx prisma -v
```

---

# If `npm install` Does Not Work

First make sure you are using the correct Node.js version.

Then remove installed dependencies and reinstall:

```bash
rm -rf node_modules
npm install
```

If the project uses a committed `package-lock.json`, prefer:

```bash
npm ci
```

instead of:

```bash
npm install
```

`npm ci` installs the exact dependency versions recorded in the lockfile and is useful for keeping the development environment consistent.

---

# Version Consistency

All developers should use the versions specified by the project.

Check:

```bash
node -v
npm -v
npx prisma -v
```

The important versions should be documented in this README and/or enforced through:

```text
.nvmrc
package.json
package-lock.json
```

Do not upgrade Node.js, Prisma, Next.js, or other major dependencies individually without checking with the project team first.

---

# Common Prisma Commands

### Check Prisma version

```bash
npx prisma -v
```

### Generate Prisma Client

```bash
npx prisma generate
```

### Create and apply a migration during development

```bash
npx prisma migrate dev --name <migration-name>
```

Example:

```bash
npx prisma migrate dev --name add_users
```

### Inspect the database with Prisma Studio

```bash
npx prisma studio
```

### Pull an existing database into Prisma

```bash
npx prisma db pull
```

Use this only when the database already contains the tables you want Prisma to introspect.

---

# Important Team Rules

1. **Do not commit `.env`.**
2. **Do commit `package.json` and `package-lock.json`.**
3. **Do commit `prisma/schema.prisma`.**
4. **Do commit Prisma migrations.**
5. **Do not run `npx prisma init` on an already initialized project.**
6. **Do not randomly upgrade Prisma or Node.js.**
7. **Use the project's documented versions.**
8. **Run `npm install` or `npm ci` after pulling dependency changes.**
9. **Run migrations after pulling new database migrations.**
10. **Do not use `prisma db pull` unless you are intentionally introspecting an existing database.**
