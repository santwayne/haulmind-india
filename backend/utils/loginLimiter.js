// Stops password guessing on /auth/login.
// Counts FAILED logins only, in memory (the API runs as ONE process – see deploy/ecosystem.config.cjs).
//   - 8 wrong passwords for the same username from the same IP  → that pair waits 15 minutes
//   - 30 wrong passwords from one IP (any usernames)            → that IP waits 15 minutes
// A successful login clears the username's counter for that IP.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_USER = 8;
const MAX_PER_IP = 30;

const hits = new Map(); // key -> { count, first }

const live = (key, now) => {
  const h = hits.get(key);
  if (!h) return null;
  if (now - h.first > WINDOW_MS) {
    hits.delete(key);
    return null;
  }
  return h;
};

const bump = (key, now) => {
  const h = live(key, now);
  if (h) h.count += 1;
  else hits.set(key, { count: 1, first: now });
};

const keys = (ip, username) => ({ user: `u:${ip}:${String(username || '').toLowerCase().trim()}`, ip: `ip:${ip}` });

/** Minutes left if this ip/username is locked out, else 0 */
export const lockedFor = (ip, username, now = Date.now()) => {
  const k = keys(ip, username);
  for (const [key, max] of [[k.user, MAX_PER_USER], [k.ip, MAX_PER_IP]]) {
    const h = live(key, now);
    if (h && h.count >= max) return Math.max(1, Math.ceil((h.first + WINDOW_MS - now) / 60000));
  }
  return 0;
};

export const recordFailure = (ip, username, now = Date.now()) => {
  const k = keys(ip, username);
  bump(k.user, now);
  bump(k.ip, now);
};

export const recordSuccess = (ip, username) => {
  hits.delete(keys(ip, username).user);
};

// Keep memory small: drop expired entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const key of hits.keys()) live(key, now);
}, 10 * 60 * 1000).unref();
