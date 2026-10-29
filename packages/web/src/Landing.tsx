const NETWORKS = [
  "AppLovin", "Unity Ads", "Google Ads", "Meta", "Mintegral", "ironSource", "TikTok / Pangle",
  "Vungle", "Liftoff", "Snapchat", "Moloco", "Chartboost", "DV360", "AdColony", "InMobi",
  "Tapjoy", "Fyber", "Smadex", "BigaBid", "Kayzen",
];

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function Landing({ onGetStarted, onSignIn }: { onGetStarted: () => void; onSignIn: () => void }) {
  return (
    <div className="fx" style={{ background: "var(--ink)", minHeight: "100%" }}>
      {/* nav */}
      <nav className="fx-nav">
        <a className="fx-logo" href="https://factorialstudio.com">
          <img src="/logo.png" alt="Factorial Studio" style={{ width: 42, height: 42, objectFit: "contain" }} />
          <b>FACTORIAL<em>ADLAB</em></b>
        </a>
        <div className="fx-nav-actions">
          <a href="https://factorialstudio.com" className="fx-navback" style={{ color: "var(--muted)", fontWeight: 500, fontSize: ".9rem" }}>
            ← Factorial Studio
          </a>
          <button className="btn btn-ghost" onClick={onSignIn}>Sign in</button>
          <button className="btn btn-gold" onClick={onGetStarted}>Get started</button>
        </div>
      </nav>

      {/* hero */}
      <header className="fx-hero">
        <div className="wrap fx-hero-grid">
          <div>
            <span className="fx-tag">Playable ads · one build, every network</span>
            <h1>
              One build in.
              <em>Every network out.</em>
            </h1>
            <p>
              Factorial AdLab turns a single playable into a correct, size-checked ad for{" "}
              <b>AppLovin, Meta, Mintegral, Unity Ads</b> and 20+ networks — the call-to-action, MRAID hooks and
              per-network size caps handled for you.
            </p>
            <ul className="fx-checks">
              <li><Check /> No manual re-exporting, no per-network guesswork</li>
              <li><Check /> Every file checked against that network's size cap</li>
              <li><Check /> MRAID wrapping &amp; CTA wired per network</li>
            </ul>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 26 }}>
              <button className="btn btn-gold" onClick={onGetStarted}>Get started free</button>
              <a className="btn btn-ghost" href="#how">See how it works</a>
            </div>
          </div>

          {/* live playable-ad demos — running in mobile frames */}
          <div className="fx-demos">
            <div className="fx-demos-eyebrow">▶ Live playable ads</div>
            <div className="fx-phones">
              <div className="fx-phone">
                <span className="fx-phone-notch" />
                <iframe className="fx-phone-screen" src="/demos/block-blast.html" title="Block Blast playable ad" loading="lazy" />
                <div className="fx-phone-cap"><b>Block Blast</b><span>Puzzle</span></div>
              </div>
              <div className="fx-phone">
                <span className="fx-phone-notch" />
                <iframe className="fx-phone-screen" src="/demos/snack-io.html" title="Snack.IO playable ad" loading="lazy" />
                <div className="fx-phone-cap"><b>Snack.IO</b><span>Arcade .io</span></div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* how it works */}
      <section className="fx-section cream" id="how">
        <div className="wrap">
          <div className="fx-eyebrow">How it works</div>
          <h2 className="disp">From one playable to <em>every network</em> in three steps</h2>
          <p className="fx-lead">No per-network re-exporting. Upload once, export clean.</p>
          <div className="fx-steps">
            <div className="fx-step"><span className="n">1</span><div><h4>Upload your playable</h4><p>Drop a single HTML5 playable (a <b>.zip</b> or one <b>.html</b>) — or build straight from your engine.</p></div></div>
            <div className="fx-step"><span className="n">2</span><div><h4>Pick the networks</h4><p>Choose from 20+ networks. AdLab wires the CTA, injects MRAID where needed, and checks every file against that network's cap.</p></div></div>
            <div className="fx-step"><span className="n">3</span><div><h4>Preview &amp; export</h4><p>Preview on a device frame, then download one correct, validated package per network — or grab them all as a zip.</p></div></div>
          </div>
        </div>
      </section>

      {/* networks */}
      <section className="fx-section">
        <div className="wrap">
          <div className="fx-eyebrow">Networks</div>
          <h2 className="disp">One export button. <em>Every destination.</em></h2>
          <p className="fx-lead">Each export is packaged the way that network's review team expects — single HTML, zip, or MRAID.</p>
          <div className="fx-netgrid">
            {NETWORKS.map((n) => <span className="fx-chip" key={n}>{n}</span>)}
            <span className="fx-chip" style={{ color: "var(--gold)", borderColor: "var(--gold2)" }}>+ more</span>
          </div>
        </div>
      </section>

      {/* pricing */}
      <section className="fx-section cream" id="pricing">
        <div className="wrap">
          <div className="fx-eyebrow">Pricing</div>
          <h2 className="disp">Plans that scale with your <em>export volume</em></h2>
          <p className="fx-lead">Every export counts one network. Start free, upgrade when you ship more.</p>
          <div className="fx-pricing">
            <div className="fx-plan">
              <h3>Free</h3><div className="price">$0</div><div className="per">to try it out</div>
              <ul><li>Unlimited Unity Ads exports</li><li>Device-frame preview</li><li>No card required</li></ul>
              <button className="btn btn-ghost" onClick={onGetStarted}>Start free</button>
            </div>
            <div className="fx-plan">
              <h3>Starter</h3><div className="price">$49</div><div className="per">/ month</div>
              <ul><li>30 exports / 30 days</li><li>All 20+ networks</li><li>Custom CTA &amp; store links</li></ul>
              <button className="btn btn-ghost" onClick={onGetStarted}>Choose Starter</button>
            </div>
            <div className="fx-plan pop">
              <span className="fx-pop-tag">Most popular</span>
              <h3>Studio</h3><div className="price">$199</div><div className="per">/ month</div>
              <ul><li>150 exports / 30 days</li><li>All networks</li><li>Team workspace</li><li>Priority support</li></ul>
              <button className="btn btn-gold" onClick={onGetStarted}>Choose Studio</button>
            </div>
            <div className="fx-plan">
              <h3>Enterprise</h3><div className="price">Custom</div><div className="per">volume &amp; SLA</div>
              <ul><li>Unlimited exports</li><li>Custom network ordering</li><li>Dedicated support</li></ul>
              <a className="btn btn-ghost" href="mailto:contact@factorialstudio.com">Contact sales</a>
            </div>
          </div>
        </div>
      </section>

      {/* comparison */}
      <section className="fx-section">
        <div className="wrap">
          <div className="fx-eyebrow">Why AdLab</div>
          <h2 className="disp">Stop re-exporting <em>by hand</em></h2>
          <div className="fx-vs">
            <div className="fx-vs-col fx-vs-a">
              <h3>Doing it manually</h3>
              <ul>
                <li>✗ Re-export and re-package for every network</li>
                <li>✗ Guess each network's size cap &amp; format</li>
                <li>✗ Wire MRAID / CTA by hand, hope it passes review</li>
                <li>✗ Rejections after you've already shipped</li>
              </ul>
            </div>
            <div className="fx-vs-col fx-vs-b">
              <h3>Factorial AdLab</h3>
              <ul>
                <li>✓ Upload once, export to every network</li>
                <li>✓ Every file checked against its cap before you ship</li>
                <li>✓ MRAID + CTA wired per network automatically</li>
                <li>✓ Validated output, device-frame preview, one-click download</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* faq */}
      <section className="fx-section cream">
        <div className="wrap">
          <div className="fx-eyebrow">Questions</div>
          <h2 className="disp">Everything you need <em>before you start</em></h2>
          <div className="fx-faq">
            <div className="fx-fq"><h4>What exactly does Factorial AdLab do?</h4><p>You upload one HTML5 playable and pick your networks. AdLab inlines it into a self-contained file, wires the call-to-action, injects MRAID where the network needs it, and checks every file against that network's size cap — one correct package per network, out.</p></div>
            <div className="fx-fq"><h4>Which ad networks are supported?</h4><p>AppLovin, Unity Ads, Google, Meta, TikTok/Pangle, Mintegral, ironSource, Vungle, Liftoff, Snapchat, Moloco and more — 20+ today, each validated against its current spec.</p></div>
            <div className="fx-fq"><h4>Do I need a special plugin?</h4><p>No. Any HTML5 playable (a .zip or a single .html) works. Upload it in the dashboard and export — a game-engine plugin is on the way for one-click build &amp; upload.</p></div>
            <div className="fx-fq"><h4>Will my exports pass each network's validator?</h4><p>That's the point of the pipeline. Exports are shaped to match what each network's review tool accepts — size, format, orientation and the callbacks it requires.</p></div>
            <div className="fx-fq"><h4>Can I try it before paying?</h4><p>Yes — sign up free and export unlimited Unity Ads playables, no card required.</p></div>
          </div>
        </div>
      </section>

      {/* cta */}
      <section className="fx-cta">
        <div className="wrap">
          <h2>Ship your next playable to <em>every network</em></h2>
          <p>Start free — no card required to explore the tool.</p>
          <div className="row">
            <button className="btn btn-gold" onClick={onGetStarted}>Get started free</button>
            <button className="btn btn-ghost" onClick={onSignIn}>Sign in</button>
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="fx-footer">
        <div className="wrap">
          <div className="fl">
            <a href="https://factorialstudio.com">Factorial Studio</a>
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="https://factorialstudio.com/development/">Development</a>
            <a href="https://factorialstudio.com/marketing/">Marketing</a>
          </div>
          <p style={{ marginBottom: 10 }}>
            <a href="mailto:contact@factorialstudio.com" style={{ color: "var(--gold)", fontWeight: 600 }}>contact@factorialstudio.com</a>
            <span style={{ opacity: 0.45, margin: "0 10px" }}>·</span>
            <a href="tel:+923224695140" style={{ color: "var(--gold)", fontWeight: 600 }}>+92 322 469 5140</a>
          </p>
          <p>© 2026 Factorial Studio Private Limited · Lahore, Pakistan · Factorial AdLab</p>
        </div>
      </footer>
    </div>
  );
}
