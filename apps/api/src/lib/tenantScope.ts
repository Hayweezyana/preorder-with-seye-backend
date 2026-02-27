export type TenantScopedDocument = {
  tenantId: string;
};

export function assertTenantScope<T extends TenantScopedDocument>(tenantId: string, items: T[]): T[] {
  return items.filter((item) => item.tenantId === tenantId);
}
