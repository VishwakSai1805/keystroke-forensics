/**
 * Original code snippets per language. Indentation uses spaces; the engine auto-indents after Enter.
 * @module core/corpus/code
 */
export const CODE_SNIPPETS = Object.freeze({
  javascript: [
    `function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}`,
    `const wpm = (chars, ms) => {
  if (ms <= 0) return 0;
  return (chars / 5) / (ms / 60000);
};`,
    `async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
  return res.json();
}`,
    `const counts = {};
for (const ch of text) {
  counts[ch] = (counts[ch] ?? 0) + 1;
}`,
    `export class Queue {
  #items = [];
  push(x) { this.#items.push(x); }
  shift() { return this.#items.shift(); }
  get size() { return this.#items.length; }
}`,
  ],
  python: [
    `def mean(values):
    if not values:
        return 0.0
    return sum(values) / len(values)`,
    `with open("access.log") as fh:
    for line in fh:
        if "Failed password" in line:
            print(line.strip())`,
    `def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a`,
    `scores = {"alice": 91, "bob": 78}
best = max(scores, key=scores.get)
print(f"{best}: {scores[best]}")`,
    `class Stack:
    def __init__(self):
        self.items = []

    def push(self, item):
        self.items.append(item)`,
  ],
  c: [
    `int sum(const int *a, size_t n) {
    int total = 0;
    for (size_t i = 0; i < n; i++) {
        total += a[i];
    }
    return total;
}`,
    `#include <stdio.h>

int main(void) {
    printf("hello, recorder\\n");
    return 0;
}`,
    `void swap(int *x, int *y) {
    int tmp = *x;
    *x = *y;
    *y = tmp;
}`,
    `size_t len(const char *s) {
    const char *p = s;
    while (*p) p++;
    return (size_t)(p - s);
}`,
  ],
  sql: [
    `SELECT user_id, MAX(net_wpm) AS best
FROM runs
WHERE status = 'verified'
GROUP BY user_id
ORDER BY best DESC
LIMIT 10;`,
    `CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  started_at TIMESTAMP DEFAULT NOW()
);`,
    `UPDATE accounts
SET locked = TRUE
WHERE failed_logins >= 5
  AND last_attempt > NOW() - INTERVAL '10 minutes';`,
    `SELECT src_ip, COUNT(*) AS hits
FROM firewall_log
WHERE action = 'DROP'
GROUP BY src_ip
HAVING COUNT(*) > 100;`,
  ],
});

/** Supported code languages. */
export const CODE_LANGUAGES = Object.freeze(Object.keys(CODE_SNIPPETS));
