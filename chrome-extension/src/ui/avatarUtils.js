// Deterministic avatar color palette (12 distinct colors)
const AVATAR_COLORS = [
  '#e84393', '#e84b4b', '#e87c43', '#d4a017',
  '#43a876', '#0ea5a5', '#2563eb', '#7c3aed',
  '#9d3aed', '#db2777', '#0284c7', '#059669',
];

/**
 * Returns 1–2 character initials from a display name.
 * "Alice B." → "AB", "alice" → "AL", "" → "?"
 */
export function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  const word = parts[0] || '';
  return word.slice(0, 2).toUpperCase() || '?';
}

/**
 * Returns a stable hex color string for a given userId.
 * Deterministic: same userId always yields same color.
 */
export function getAvatarColor(userId) {
  if (!userId) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
