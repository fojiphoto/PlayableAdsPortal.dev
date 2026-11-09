import { useEffect, useState } from "react";
import { getDomain, setDomain as apiSetDomain, checkDomain } from "../api";
import type { DomainStatus } from "../types";
import { Icon } from "./icons";
import { Msg, PageHead } from "./pageKit";

export function Domain() {
  const [st, setSt] = useState<DomainStatus | null>(null);
  const [domain, setDomainInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getDomain()
      .then((d) => {
        setSt(d);
        if (d.domain) setDomainInput(d.domain);
      })
      .catch(() => {});
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      setSt(await apiSetDomain(domain));
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await checkDomain();
      setSt((s) => (s ? { ...s, verified: r.verified } : s));
      setMsg(
        r.verified
          ? { ok: true, text: "Verified! Your domain ownership is confirmed." }
          : { ok: false, text: "Not found yet. DNS or the file can take a few minutes to propagate. Try again shortly." },
      );
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHead
        icon={<Icon.Globe />}
        title="Verify your domain"
        sub="Ad networks only accept playables from a verified publisher. Prove you own your company's website once; exports unlock right after."
        actions={
          st?.token &&
          (st.verified ? (
            <span className="pg-tag ok">
              <Icon.Check /> Verified
            </span>
          ) : (
            <span className="pg-tag warn">Not verified</span>
          ))
        }
      />

      <div className="pg-settings">
        <section className="pg-card">
          <h2 className="pg-h">Company domain</h2>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (domain.trim()) void save();
            }}
          >
            <input
              className="pg-input mono min-w-[200px] flex-1"
              value={domain}
              onChange={(e) => setDomainInput(e.target.value)}
              placeholder="yourstudio.com"
              aria-label="Company domain"
            />
            <button type="submit" disabled={busy || !domain.trim()} className="pg-btn pg-btn-primary">
              Save
            </button>
          </form>
          {!st?.token && msg && (
            <div className="mt-3">
              <Msg kind="err">{msg.text}</Msg>
            </div>
          )}
        </section>

        {st?.token && (
          <section className="pg-card">
            <h2 className="pg-h">Prove ownership: do either one</h2>
            <ol className="grid gap-5">
              <li className="flex gap-3.5">
                <span className="setup-step-n">1</span>
                <div className="min-w-0 flex-1">
                  <div className="setup-step-t">Upload a verification file</div>
                  <p className="setup-step-d" style={{ marginBottom: 8 }}>
                    Create <code>https://{st.domain}/{st.verifyFile}</code> containing only:
                  </p>
                  <code className="pg-codeblock">{st.token}</code>
                </div>
              </li>
              <li className="flex gap-3.5">
                <span className="setup-step-n">2</span>
                <div className="min-w-0 flex-1">
                  <div className="setup-step-t">Or add a line to app-ads.txt</div>
                  <p className="setup-step-d" style={{ marginBottom: 8 }}>
                    Add this comment to <code>https://{st.domain}/app-ads.txt</code>. Ad networks ignore lines starting with <code>#</code>.
                  </p>
                  <code className="pg-codeblock"># {st.token}</code>
                </div>
              </li>
            </ol>

            {msg && (
              <div className="mt-5">
                <Msg kind={msg.ok ? "success" : "warn"}>{msg.text}</Msg>
              </div>
            )}

            <div className="mt-5 border-t border-line pt-4">
              <button onClick={check} disabled={busy} className="pg-btn pg-btn-primary">
                <Icon.Refresh />
                {busy ? "Checking…" : "Check now"}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
