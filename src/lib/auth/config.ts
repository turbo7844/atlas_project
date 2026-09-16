export type AuthConfig = {
  adminEmail: string;
  adminPassword: string;
  othersPassword: string;
  sessionSecret: string;
};

export function getAuthConfig(): AuthConfig {
  const adminPassword = process.env.ADMIN_PASSWORD ?? "";
  const othersPassword = process.env.OTHERS_PASSWORD ?? "";

  return {
    adminEmail: (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase(),
    adminPassword,
    othersPassword,
    sessionSecret:
      process.env.AUTH_SESSION_SECRET?.trim() ||
      `${adminPassword}\u0000${othersPassword}`,
  };
}

export function isAuthConfigured(config = getAuthConfig()) {
  return Boolean(
    config.adminEmail && config.adminPassword && config.othersPassword,
  );
}
