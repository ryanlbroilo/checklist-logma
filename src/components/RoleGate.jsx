export default function RoleGate({ allow = [], userRoles = [], children, fallback = null }) {
  const ok = allow.some(r => userRoles.includes(r));
  return ok ? children : fallback;
}
