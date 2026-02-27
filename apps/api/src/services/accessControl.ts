export type AccessLevel = "owner" | "manager" | "staff";

export function resolveRole(accessLevel: AccessLevel): "admin" | "staff" {
  return accessLevel === "staff" ? "staff" : "admin";
}

export function resolvePermissions(accessLevel: AccessLevel) {
  if (accessLevel === "owner") {
    return [
      "orders:read",
      "orders:write",
      "users:read",
      "users:manage",
      "reports:view",
      "campaigns:manage",
      "inventory:manage"
    ];
  }

  if (accessLevel === "manager") {
    return ["orders:read", "orders:write", "users:read", "reports:view", "inventory:manage"];
  }

  return ["orders:read", "orders:write"];
}
