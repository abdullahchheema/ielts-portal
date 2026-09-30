/** Roles that reach the admin panel. Used for MFA enforcement and shorter session lifetimes (spec §63). */
export const ADMIN_ROLES = ['SUPER_ADMIN', 'ACADEMIC_ADMIN', 'CONTENT_MANAGER', 'FINANCE_ADMIN', 'SUPPORT_AGENT', 'MARKETING'] as const;

export const isAdminRole = (roles: readonly string[]) => roles.some((r) => (ADMIN_ROLES as readonly string[]).includes(r));
