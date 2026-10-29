// RunStore implementation backed by Postgres (service role). Mirrors server/memoryStore.js.

export function createSupabaseStore(admin, { url, serviceKey }) {
  const must = ({ data, error }) => {
    if (error) throw Object.assign(new Error(error.message), { status: 500 });
    return data;
  };
  return {
    async hit(key, windowMs) {
      return must(await admin.rpc('rate_hit', { p_bucket: key, p_window_ms: windowMs }));
    },
    async saveToken(t) {
      must(
        await admin.from('run_tokens').insert({
          run_id: t.runId,
          user_id: t.userId,
          mode_id: t.modeId,
          options: t.options,
          policy: t.policy,
          seed: t.seed,
          text_hash: t.textHash,
          nonce: t.nonce,
          signature: t.signature,
          issued_at: t.issuedAt,
          expires_at: t.expiresAt,
        }),
      );
    },
    async getToken(runId) {
      const rows = must(await admin.from('run_tokens').select('*').eq('run_id', runId).limit(1));
      const r = rows && rows[0];
      if (!r) return null;
      return {
        runId: r.run_id,
        userId: r.user_id,
        modeId: r.mode_id,
        options: r.options,
        policy: r.policy,
        seed: Number(r.seed),
        textHash: r.text_hash,
        nonce: r.nonce,
        signature: r.signature,
        issuedAt: Number(r.issued_at),
        expiresAt: Number(r.expires_at),
      };
    },
    async consumeToken(runId) {
      return Boolean(must(await admin.rpc('consume_run_token', { p_run_id: runId })));
    },
    async history(userId, board, n) {
      const rows = must(await admin.from('runs').select('score').eq('user_id', userId).eq('board_key', board).eq('status', 'verified').order('created_at', { ascending: false }).limit(n));
      return (rows || []).map((r) => Number(r.score));
    },
    async saveRun(run, entries) {
      must(
        await admin.from('runs').insert({
          id: run.id,
          user_id: run.userId,
          board_key: run.board,
          mode_id: run.modeId,
          language: run.language,
          seed: run.seed,
          net_wpm: run.netWpm,
          gross_wpm: run.grossWpm,
          raw_accuracy: run.rawAccuracy,
          final_accuracy: run.finalAccuracy,
          consistency: run.consistency,
          score: run.score,
          duration_ms: Math.round(run.durationMs),
          chars: run.chars,
          status: run.status,
          flags: run.flags,
        }),
      );
      must(await admin.from('run_logs').insert({ run_id: run.id, entries }));
    },
    async notify(board) {
      await fetch(`${url}/realtime/v1/api/broadcast`, {
        method: 'POST',
        headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ topic: 'leaderboard', event: 'update', payload: { board } }] }),
      }).catch(() => {});
    },
  };
}
