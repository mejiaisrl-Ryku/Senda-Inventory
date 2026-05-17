// Set env vars before any module is loaded — jwt.ts throws at module level if these are absent.
process.env.JWT_SECRET = "test-jwt-secret-for-jest-minimum-32-chars!!";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-for-jest-minimum-32!!";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test_senda";
process.env.NODE_ENV = "test";
