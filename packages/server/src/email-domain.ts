/**
 * Company-email domain verification: a verified mailbox at a company domain proves the account can act
 * for that domain, so it counts as domain verification (the app-ads.txt / file check is then not
 * needed). Free and consumer mail providers never count.
 */
const FREE_PROVIDERS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "rocketmail.com", "hotmail.com", "outlook.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "aim.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.net", "gmx.de",
  "mail.com", "email.com", "yandex.com", "yandex.ru", "ya.ru", "zoho.com", "zohomail.com", "qq.com", "163.com", "126.com", "yeah.net",
  "sina.com", "sohu.com", "naver.com", "daum.net", "hanmail.net", "web.de", "t-online.de", "freenet.de", "orange.fr", "wanadoo.fr",
  "free.fr", "laposte.net", "libero.it", "virgilio.it", "tiscali.it", "rediffmail.com", "mail.ru", "inbox.ru", "list.ru", "bk.ru",
  "rambler.ru", "seznam.cz", "wp.pl", "o2.pl", "interia.pl", "onet.pl", "tutanota.com", "tuta.io", "fastmail.com", "hey.com",
  "duck.com", "hushmail.com", "mailinator.com", "example.com", "example.test", "test.com",
]);
// country / regional variants of the big consumer providers (yahoo.co.uk, hotmail.fr, outlook.de, live.co.uk…)
const FREE_PATTERNS = [/^(yahoo|hotmail|outlook|live|msn|aol|gmx|yandex|icloud)\.[a-z.]{2,8}$/];

/** The company domain of an email address, or null for free/consumer providers and malformed input. */
export function companyDomainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return null;
  if (FREE_PROVIDERS.has(domain) || FREE_PATTERNS.some((p) => p.test(domain))) return null;
  return domain;
}
