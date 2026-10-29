/**
 * Cybersecurity corpora: CLI commands, SIEM-style log generators, encoded payloads and
 * a phishing URL generator. All hosts use reserved/fictional names (RFC 2606 / RFC 6761)
 * and documentation IP ranges (RFC 5737), so nothing points at a real system.
 * @module core/corpus/security
 */
import { createRng } from '../prng.js';

/** Real-world command syntax for CLI drills. */
export const COMMANDS = Object.freeze({
  shell: [
    'ls -la /var/log',
    'grep -rn "Failed password" /var/log/auth.log',
    'tail -f /var/log/syslog | grep sshd',
    'find / -perm -4000 -type f 2>/dev/null',
    'chmod 600 ~/.ssh/id_ed25519',
    'ps aux --sort=-%mem | head -n 10',
    'ss -tulpn | grep LISTEN',
    'sha256sum release.tar.gz',
    'journalctl -u nginx --since "1 hour ago"',
    "awk '{print $1}' access.log | sort | uniq -c | sort -nr",
  ],
  nmap: [
    'nmap -sV -p 1-1000 192.0.2.10',
    'nmap -sS -T4 198.51.100.0/24',
    'nmap -Pn -p 22,80,443 scanme.example.com',
    'nmap -sU --top-ports 50 203.0.113.5',
    'nmap -A -oN report.txt 192.0.2.20',
    'nmap --script vuln -p 443 web.example.test',
  ],
  iptables: [
    'iptables -A INPUT -p tcp --dport 22 -j ACCEPT',
    'iptables -A INPUT -s 203.0.113.0/24 -j DROP',
    'iptables -P INPUT DROP',
    'iptables -L -n -v --line-numbers',
    'iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT',
    'iptables -I INPUT 1 -i lo -j ACCEPT',
  ],
  git: [
    'git log --oneline --graph --decorate',
    'git rebase -i HEAD~3',
    'git commit -S -m "fix: validate nonce expiry"',
    'git bisect start HEAD v1.2.0',
    'git stash push -m "wip parser"',
    'git diff --stat main...feature/anti-cheat',
    'git reset --soft HEAD~1',
  ],
});

const USERS = ['root', 'admin', 'deploy', 'analyst', 'svc_backup', 'guest', 'oracle'];
const HOSTS = ['web01', 'db02', 'fw-edge', 'vpn-gw', 'siem01'];
const TEST_NETS = ['192.0.2.', '198.51.100.', '203.0.113.'];

/**
 * Generate SIEM-style log lines deterministically.
 * @param {number} seed Seed.
 * @param {number} count Number of lines.
 * @returns {string[]}
 */
export function generateLogLines(seed, count) {
  const rng = createRng(seed);
  const lines = [];
  for (let i = 0; i < count; i++) {
    const ip = rng.pick(TEST_NETS) + (1 + rng.int(254));
    const hh = String(rng.int(24)).padStart(2, '0');
    const mm = String(rng.int(60)).padStart(2, '0');
    const ss = String(rng.int(60)).padStart(2, '0');
    const host = rng.pick(HOSTS);
    const user = rng.pick(USERS);
    const port = 1024 + rng.int(64000);
    const kind = rng.int(5);
    if (kind === 0) {
      lines.push(`Oct 30 ${hh}:${mm}:${ss} ${host} sshd[${1000 + rng.int(9000)}]: Failed password for ${user} from ${ip} port ${port} ssh2`);
    } else if (kind === 1) {
      lines.push(`${ip} - - [30/Oct/2026:${hh}:${mm}:${ss} +0000] "GET /admin/login.php HTTP/1.1" 404 ${200 + rng.int(800)}`);
    } else if (kind === 2) {
      lines.push(`kernel: [UFW BLOCK] IN=eth0 SRC=${ip} DST=10.0.0.${2 + rng.int(200)} PROTO=TCP DPT=${rng.pick([22, 23, 445, 3389])}`);
    } else if (kind === 3) {
      lines.push(`EventID=4625 Account=${user} Source=${ip} LogonType=${rng.pick([3, 10])} Status=0xC000006D`);
    } else {
      lines.push(`alert tcp ${ip} any -> $HOME_NET ${rng.pick([80, 443, 8080])} (msg:"SQLi attempt"; sid:${100000 + rng.int(9000)};)`);
    }
  }
  return lines;
}

const HEX = '0123456789abcdef';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Generate hex and base64 payload strings deterministically.
 * @param {number} seed Seed.
 * @param {number} count Number of payloads.
 * @returns {string[]}
 */
export function generatePayloads(seed, count) {
  const rng = createRng(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (rng.chance(0.5)) {
      let s = '0x';
      const n = 8 + rng.int(9) * 2;
      for (let j = 0; j < n; j++) s += HEX[rng.int(16)];
      out.push(s);
    } else {
      let s = '';
      const n = 12 + rng.int(4) * 4;
      for (let j = 0; j < n; j++) s += B64[rng.int(64)];
      const pad = rng.int(3);
      out.push(s.slice(0, s.length - pad) + '='.repeat(pad));
    }
  }
  return out;
}

/**
 * Phishing URL templates. `flags` explain the red flags shown after the run.
 * Legitimate entries use example.com/.org/.net; suspicious ones use .test/.example/.invalid,
 * documentation IPs, or deceptive structure.
 */
const LEGIT = [
  'https://accounts.example.com/login',
  'https://www.example.org/help/reset-password',
  'https://mail.example.net/inbox',
  'https://example.com/billing/invoices',
  'https://docs.example.org/security/2fa',
  'https://portal.example.com/settings/profile',
  'https://shop.example.net/orders/track',
  'https://example.org/careers',
];

const SUSPICIOUS = [
  { url: 'http://examp1e.test/login', flags: ['Typosquat: digit 1 replaces letter l', 'Plain HTTP on a login page'] },
  { url: 'https://example.com.secure-verify.test/account', flags: ['Real brand used as a subdomain of another domain (secure-verify.test)'] },
  { url: 'http://192.0.2.44/paypal/update', flags: ['Raw IP address instead of a domain', 'Brand name buried in the path'] },
  { url: 'https://example.com@login-check.test/session', flags: ['The @ sign makes the browser ignore everything before it; real host is login-check.test'] },
  { url: 'https://xn--exmple-cua.test/signin', flags: ['Punycode host that renders as a look-alike of example'] },
  { url: 'https://accounts-example.test/verify?urgent=1', flags: ['Hyphenated look-alike domain', 'Urgency parameter in the URL'] },
  { url: 'https://example.co.invalid/reset', flags: ['Wrong TLD chain (.co.invalid) mimicking the real domain'] },
  { url: 'http://203.0.113.9:8080/wallet/restore', flags: ['Raw IP with non-standard port', 'Wallet restore lure'] },
  { url: 'https://micr0soft-support.example/ticket', flags: ['Zero replaces o in a brand name', 'Support-scam pattern'] },
  { url: 'https://bit-ly.test/3xY9q', flags: ['Imitation URL shortener hides the destination'] },
  { url: 'https://example.com-auth.test/oauth', flags: ['Domain is example.com-auth.test, not example.com'] },
  { url: 'https://login.examplle.test/mfa', flags: ['Doubled letter typosquat (examplle)'] },
];

/**
 * Build a seeded list of URLs for the phishing-spot mode.
 * @param {number} seed Seed.
 * @param {number} [count=10] Number of URLs.
 * @returns {{url:string,suspicious:boolean,flags:string[]}[]}
 */
export function generatePhishingSet(seed, count = 10) {
  const rng = createRng(seed);
  const nSusp = Math.max(1, Math.round(count * (0.4 + rng.next() * 0.2)));
  const susp = rng
    .shuffle(SUSPICIOUS)
    .slice(0, nSusp)
    .map((s) => ({ url: s.url, suspicious: true, flags: s.flags }));
  const legit = rng
    .shuffle(LEGIT)
    .slice(0, count - nSusp)
    .map((url) => ({ url, suspicious: false, flags: ['HTTPS, expected domain, no deceptive structure'] }));
  return rng.shuffle([...susp, ...legit]);
}
