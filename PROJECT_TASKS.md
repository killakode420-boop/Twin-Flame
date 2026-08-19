# Bees in a Trap - Project Tasks & Integration

## Project Overview
**Repository:** Twin-Flame (renamed to Bees in a Trap)  
**Contact:** killercode420@gmail.com  
**CI/CD:** GitHub Actions (`.github/workflows/ci.yml`)

## Task Management (Manus Integration)

### Active Tasks
- [x] Set up CI pipeline with GitHub Actions
- [x] Rename project from Twin Flame to Bees in a Trap
- [x] Configure email notifications for CI failures
- [ ] Connect all API integrations
- [ ] Set up SDK connectors
- [ ] Complete Manus task automation

### CI Pipeline Tasks
- Build & type check on every push/PR
- Automated test execution
- Email notification on failure to killercode420@gmail.com

## Connectors & Integrations

### APIs
| Service | SDK/Package | Status |
|---------|-------------|--------|
| AWS S3 | @aws-sdk/client-s3 | ✅ Connected |
| AWS S3 Presigner | @aws-sdk/s3-request-presigner | ✅ Connected |
| tRPC | @trpc/client, @trpc/server | ✅ Connected |
| TanStack Query | @tanstack/react-query | ✅ Connected |
| Drizzle ORM | drizzle-orm | ✅ Connected |
| MySQL | mysql2 | ✅ Connected |
| Express | express | ✅ Connected |
| Axios | axios | ✅ Connected |

### SDKs Integrated
- **AWS SDK v3** - S3 file storage and presigned URLs
- **tRPC** - End-to-end typesafe API layer
- **Drizzle ORM** - Database schema and migrations
- **React 19** - Frontend framework
- **Vite 7** - Build tooling
- **Framer Motion** - Animations
- **Recharts** - Data visualization

### GitHub Repository Connection
- **Repo:** killakode420-boop/Twin-Flame
- **Branch Strategy:** main (protected)
- **CI Trigger:** Push to main, Pull Requests to main
- **Notifications:** killercode420@gmail.com

## Manus Configuration

### Email Task Assignment
- **Email:** killercode420@gmail.com
- **Purpose:** Task notifications and CI failure alerts
- **Integration:** GitHub Actions email notification on pipeline failure

### Project File Structure
```
bees-in-a-trap/
├── .github/workflows/ci.yml    # CI Pipeline
├── client/                      # Frontend (React)
├── server/                      # Backend (Express + tRPC)
├── shared/                      # Shared types
├── drizzle/                     # Database migrations
├── PROJECT_TASKS.md             # This file
└── package.json                 # Project config
```

## Setup Instructions

1. **Clone & Install:**
   ```bash
   git clone <repo-url>
   pnpm install
   ```

2. **Configure Secrets (GitHub):**
   - `EMAIL_USERNAME` - Gmail account for notifications
   - `EMAIL_PASSWORD` - Gmail app password
   - `DATABASE_URL` - MySQL connection string

3. **Run Development:**
   ```bash
   pnpm dev
   ```

4. **Deploy:**
   ```bash
   pnpm build
   pnpm start
   ```
