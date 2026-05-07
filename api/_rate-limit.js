// TMC_PATCH3_RATE_LIMIT_HELPER
// TapMyCar — fixed-window rate limiter backed by Supabase.
//
// IMPORTANT: This helper FAILS OPEN. If the rate_limits table is missing
// or the DB query errors out, every check returns "ok: true" and the
// request proceeds. The reasoning: a broken rate-limit table should
// never lock legitimate users out of signup or contact. We're protecting
// against bots, not building a strict quota system.
//
// Usage:
//   const { rateLimit } = require('./_rate-limit');
//   const allowed = await rateLimit(req, res, [
//     { key: 'send-otp:ip:' + getClientIp(req), max: 5, windowSeconds: 60 },
//     { key: 'send-otp:email:' + email, max: 3, windowSeconds: 3600 },
//   ]);
//   if (!allowed) return; // 429 already sent

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function getClientIp(req) {
  // Vercel forwards the real client IP in x-forwarded-for, possibly
  // followed by proxy hops. The first IP is the real client.
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  const xri = req.headers['x-real-ip'];
  if (xri) return String(xri).trim();
  if (req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
  return 'unknown';
}

// Returns { ok: bool, retryAfter: seconds, count: number }
async function checkRateLimit(key, max, windowSeconds) {
  try {
    // Read existing row
    const { data: row, error: readErr } = await supabase
      .from('rate_limits')
      .select('count, window_start, window_seconds')
      .eq('key', key)
      .maybeSingle();

    // Fail-open on DB read errors
    if (readErr) {
      // Common case: table missing. Don't spam logs.
      if (!String(readErr.message || '').toLowerCase().includes('does not exist')) {
        console.error('rate_limits read error:', readErr.message);
      }
      return { ok: true, retryAfter: 0, count: 0 };
    }

    const now = Date.now();

    if (!row) {
      // First request for this key — insert a fresh window
      const { error: insErr } = await supabase
        .from('rate_limits')
        .insert({
          key,
          count: 1,
          window_start: new Date(now).toISOString(),
          window_seconds: windowSeconds
        });
      // Race condition: someone else may have inserted concurrently.
      // Fail-open in either case.
      return { ok: true, retryAfter: 0, count: 1 };
    }

    const windowStart = new Date(row.window_start).getTime();
    const windowEnd = windowStart + (row.window_seconds || windowSeconds) * 1000;

    if (now >= windowEnd) {
      // Window expired — reset
      const { error: updErr } = await supabase
        .from('rate_limits')
        .update({
          count: 1,
          window_start: new Date(now).toISOString(),
          window_seconds: windowSeconds,
          updated_at: new Date(now).toISOString()
        })
        .eq('key', key);
      return { ok: true, retryAfter: 0, count: 1 };
    }

    // Within window — increment and check
    const newCount = (row.count || 0) + 1;

    if (newCount > max) {
      const retryAfter = Math.max(1, Math.ceil((windowEnd - now) / 1000));
      return { ok: false, retryAfter, count: newCount };
    }

    await supabase
      .from('rate_limits')
      .update({ count: newCount, updated_at: new Date(now).toISOString() })
      .eq('key', key);
    return { ok: true, retryAfter: 0, count: newCount };

  } catch (e) {
    console.error('checkRateLimit fatal:', e.message);
    return { ok: true, retryAfter: 0, count: 0 };
  }
}

// Convenience: checks a list of rules, returns true if all pass,
// or sends a 429 and returns false on first violation.
async function rateLimit(req, res, rules) {
  for (const rule of rules) {
    if (!rule.key || !rule.max || !rule.windowSeconds) continue;
    const result = await checkRateLimit(rule.key, rule.max, rule.windowSeconds);
    if (!result.ok) {
      const minutes = Math.ceil(result.retryAfter / 60);
      const human = result.retryAfter < 60
        ? result.retryAfter + ' second' + (result.retryAfter === 1 ? '' : 's')
        : minutes + ' minute' + (minutes === 1 ? '' : 's');
      res.setHeader('Retry-After', String(result.retryAfter));
      res.status(429).json({
        error: 'Too many requests. Please try again in ' + human + '.',
        retry_after_seconds: result.retryAfter
      });
      return false;
    }
  }
  return true;
}

module.exports = { getClientIp, checkRateLimit, rateLimit };
