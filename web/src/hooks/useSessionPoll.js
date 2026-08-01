import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../lib/apiClient.js';

// Polls GET /api/sessions/:shareToken every 3s (§9.1 — the most-called
// endpoint). Reused by every later live view (options, job monitor).
// Clears the interval on unmount — a leaked poller is the easiest way to
// spam a demo's network tab and desync state after navigating away.
export function useSessionPoll(shareToken, intervalMs = 3000) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const cancelledRef = useRef(false);

  const refetch = useCallback(async () => {
    try {
      const result = await apiClient.get(`/api/sessions/${shareToken}`);
      if (!cancelledRef.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (!cancelledRef.current) setError(err.message);
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [shareToken]);

  useEffect(() => {
    cancelledRef.current = false;
    refetch();
    const id = setInterval(refetch, intervalMs);
    return () => {
      cancelledRef.current = true;
      clearInterval(id);
    };
  }, [refetch, intervalMs]);

  return { data, loading, error, refetch };
}
