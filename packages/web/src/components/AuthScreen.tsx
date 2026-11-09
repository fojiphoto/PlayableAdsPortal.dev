import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  login,
  signup,
  setToken,
  forgotPassword,
  checkResetToken,
  resetPassword,
} from "../api";
import type { AuthUser } from "../types";
import { Turnstile, useCaptchaSiteKey } from "./Turnstile";
import { AuthShowcase } from "./AuthShowcase";
import { ChatBubble } from "./ChatBubble";
import "../auth.css";

export type AuthMode = "login" | "signup" | "forgot" | "reset";
type Mode = AuthMode;

/* lucide-style icons, stroke 1.7 */
const ico = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;
const Chevron = () => (
  <svg {...ico} aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
);
const AlertIcon = () => (
  <svg {...ico} aria-hidden="true">
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);
const CheckIcon = () => (
  <svg {...ico} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </svg>
);
const InfoIcon = () => (
  <svg {...ico} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
);
const Eye = () => (
  <svg {...ico} aria-hidden="true">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const EyeOff = () => (
  <svg {...ico} aria-hidden="true">
    <path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.6 3.5M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
  </svg>
);

/** Server errors arrive lower-case ("invalid credentials"); show them as sentences. */
function sentence(msg: string): string {
  const m = msg.trim();
  return m
    ? m.charAt(0).toUpperCase() + m.slice(1)
    : "Something went wrong. Try again.";
}

function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div className="au-err" role="alert">
      <AlertIcon />
      <span>{children}</span>
    </div>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  show,
  onToggle,
  placeholder,
  autoComplete,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle?: () => void;
  placeholder: string;
  autoComplete: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="au-pw">
      <input
        id={id}
        className="au-input"
        type={show ? "text" : "password"}
        required
        minLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
      />
      {onToggle && (
        <button
          type="button"
          className="au-eye"
          onClick={onToggle}
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff /> : <Eye />}
        </button>
      )}
    </div>
  );
}

export function AuthScreen({
  mode: initialMode = "login",
  onMode,
  notice,
  onAuth,
  onBack,
  resetToken,
  onResetDone,
}: {
  /** which screen; comes from the URL (/login, /signup, /forgot), or "reset" from a ?reset= link */
  mode?: Mode;
  /** switch screens by URL (the parent re-mounts this with the new mode) */
  onMode?: (m: Mode) => void;
  /** a message from the parent, e.g. who an invitation is for */
  notice?: string | null;
  onAuth: (u: AuthUser) => void;
  onBack?: () => void;
  /** present when the user arrived via a password-reset email link (?reset=…) */
  resetToken?: string;
  onResetDone?: () => void;
}) {
  const [mode, setMode] = useState<Mode>(resetToken ? "reset" : initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  /** forgot: the link was sent; reset: the new password was saved */
  const [done, setDone] = useState(false);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  // bot check on the public forms (sign-up, forgot password) when the server has Turnstile keys
  const siteKey = useCaptchaSiteKey();
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaRun, setCaptchaRun] = useState(0);
  const captchaForm = mode === "signup" || mode === "forgot";
  const needsCaptcha = captchaForm && !!siteKey;

  // validate the reset link before showing the form
  useEffect(() => {
    if (!resetToken) return;
    checkResetToken(resetToken)
      .then((r) => setTokenValid(r.valid))
      .catch(() => setTokenValid(false));
  }, [resetToken]);

  function switchMode(m: Mode) {
    if (onMode) {
      // leaving a ?reset= link: drop the token first, or the parent keeps showing the reset screen
      if (mode === "reset" && m !== "reset") onResetDone?.();
      return onMode(m);
    }
    setMode(m);
    setCaptcha(null);
    setErr(null);
    setInfo(null);
    setDone(false);
  }

  /** leave the two-factor step and show email + password again */
  function backToPassword() {
    setNeedCode(false);
    setCode("");
    setErr(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setInfo(null);
    if (
      mode !== "reset" &&
      !needCode &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ) {
      setErr(
        mode === "forgot"
          ? "Enter the email you sign in with."
          : "Enter a valid email address.",
      );
      return;
    }
    if (mode === "login" && !needCode && !password) {
      setErr("Enter your password.");
      return;
    }
    if ((mode === "signup" || mode === "reset") && password.length < 6) {
      setErr("Password must be at least 6 characters.");
      return;
    }
    if ((mode === "signup" || mode === "reset") && password !== password2) {
      setErr("Those passwords don't match.");
      return;
    }
    if (needCode && code.length !== 6) {
      setErr("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "forgot") {
        await forgotPassword(email, captcha ?? undefined);
        setDone(true);
      } else if (mode === "reset") {
        await resetPassword(resetToken!, password);
        setPassword("");
        setPassword2("");
        setDone(true);
      } else {
        const { token, user } =
          mode === "login"
            ? await login(email, password, needCode ? code : undefined)
            : await signup(email, password, captcha ?? undefined);
        setToken(token);
        onAuth(user);
      }
    } catch (e) {
      const c = (e as { code?: string }).code;
      if (c === "2fa-required") {
        setNeedCode(true); // the two-factor screen explains what to enter
      } else if (c === "2fa-invalid") {
        setErr(
          "That code isn't right. Check your authenticator app and try again.",
        );
        setCode("");
      } else {
        setErr(sentence((e as Error).message));
      }
    } finally {
      setBusy(false);
      if (needsCaptcha) setCaptchaRun((n) => n + 1); // the token is single-use
    }
  }

  const twoFactor = mode === "login" && needCode;
  const title = twoFactor
    ? "Two-factor check"
    : mode === "login"
      ? "Sign in"
      : mode === "signup"
        ? "Create your account"
        : mode === "forgot"
          ? "Reset your password"
          : "Choose a new password";
  const subtitle: ReactNode = twoFactor ? (
    <>
      Enter the 6-digit code from your authenticator app for <b>{email}</b>.
    </>
  ) : mode === "login" ? (
    "Enter your email and password to open the studio."
  ) : mode === "signup" ? (
    "Free to start, no card needed."
  ) : mode === "forgot" ? (
    done ? (
      "The link works once, for 1 hour. Check your spam folder if it doesn't arrive."
    ) : (
      "Enter the email you sign in with and we'll send you a link to set a new password."
    )
  ) : done ? (
    "Your new password is saved. Sign in with it to continue."
  ) : tokenValid === false ? (
    "Reset links work once and expire after an hour."
  ) : tokenValid === null ? (
    "Checking your reset link…"
  ) : (
    "Pick a new password for your Factorial AdLab account."
  );
  const buttonLabel = twoFactor
    ? "Verify and continue"
    : mode === "login"
      ? "Sign in"
      : mode === "signup"
        ? "Create account"
        : mode === "forgot"
          ? "Send reset link"
          : "Save new password";

  const resetBroken = mode === "reset" && tokenValid === false;
  const resetChecking = mode === "reset" && tokenValid === null;
  const submitDisabled =
    busy ||
    resetChecking ||
    (captchaForm && siteKey === undefined) ||
    (needsCaptcha && !captcha);

  let content: ReactNode;
  if (mode === "forgot" && done) {
    content = (
      <>
        <div className="au-notice" role="status">
          <CheckIcon />
          <span>
            If an account uses that email, a reset link is on its way.
          </span>
        </div>
        <button
          type="button"
          className="au-btn"
          onClick={() => switchMode("login")}
        >
          Back to sign in
        </button>
      </>
    );
  } else if (mode === "reset" && done) {
    content = (
      <>
        <div className="au-notice" role="status">
          <CheckIcon />
          <span>Password changed.</span>
        </div>
        <button
          type="button"
          className="au-btn"
          onClick={() => (onResetDone ? onResetDone() : switchMode("login"))}
        >
          Sign in
        </button>
      </>
    );
  } else if (resetChecking) {
    content = (
      <div className="au-loading">
        <span className="au-spin au-dark" aria-label="Checking the link" />
      </div>
    );
  } else if (resetBroken) {
    content = (
      <>
        <ErrorBox>
          This reset link has expired or was already used. Ask for a new one.
        </ErrorBox>
        <button
          type="button"
          className="au-btn"
          onClick={() => switchMode("forgot")}
        >
          Request a new link
        </button>
        <p className="au-alt">
          <button
            type="button"
            className="au-link"
            onClick={() => switchMode("login")}
          >
            Back to sign in
          </button>
        </p>
      </>
    );
  } else {
    content = (
      <form onSubmit={submit} noValidate>
        {notice && !twoFactor && (
          <div className="au-notice au-info" role="status">
            <InfoIcon />
            <span>{notice}</span>
          </div>
        )}
        {info && (
          <div className="au-notice" role="status">
            <CheckIcon />
            <span>{info}</span>
          </div>
        )}
        {err && <ErrorBox>{err}</ErrorBox>}

        {twoFactor ? (
          <div className="au-field">
            <label htmlFor="au-code">Authentication code</label>
            <input
              id="au-code"
              className="au-input au-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              autoFocus
              required
            />
          </div>
        ) : (
          <>
            {mode !== "reset" && (
              <div className="au-field">
                <label htmlFor="au-email">Email</label>
                <input
                  id="au-email"
                  className="au-input"
                  type="email"
                  required
                  autoComplete={mode === "signup" ? "email" : "username"}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@studio.com"
                  autoFocus
                />
              </div>
            )}

            {mode !== "forgot" && (
              <div className="au-field">
                <label htmlFor="au-pw">
                  {mode === "reset" ? "New password" : "Password"}
                </label>
                <PasswordInput
                  id="au-pw"
                  value={password}
                  onChange={setPassword}
                  show={showPw}
                  onToggle={() => setShowPw((s) => !s)}
                  placeholder={
                    mode === "login"
                      ? "Enter your password"
                      : "At least 6 characters"
                  }
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  autoFocus={mode === "reset"}
                />
              </div>
            )}

            {(mode === "signup" || mode === "reset") && (
              <div className="au-field">
                <label htmlFor="au-pw2">
                  {mode === "reset"
                    ? "Repeat the new password"
                    : "Confirm password"}
                </label>
                <PasswordInput
                  id="au-pw2"
                  value={password2}
                  onChange={setPassword2}
                  show={showPw}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                />
              </div>
            )}

            {mode === "login" && (
              <p className="au-forgot">
                <button
                  type="button"
                  className="au-link"
                  onClick={() => switchMode("forgot")}
                >
                  Forgot your password?
                </button>
              </p>
            )}
          </>
        )}

        {needsCaptcha && siteKey && (
          <div className="au-captcha">
            <Turnstile
              key={mode}
              siteKey={siteKey}
              action={mode as "signup" | "forgot"}
              onToken={setCaptcha}
              resetSignal={captchaRun}
            />
          </div>
        )}

        <button type="submit" className="au-btn" disabled={submitDisabled}>
          {busy ? (
            <span className="au-spin" aria-label="Working" />
          ) : (
            buttonLabel
          )}
        </button>

        {twoFactor ? (
          <button type="button" className="au-return" onClick={backToPassword}>
            ← Back to sign in
          </button>
        ) : mode === "login" ? (
          <p className="au-alt">
            New to Factorial AdLab?{" "}
            <button
              type="button"
              className="au-link"
              onClick={() => switchMode("signup")}
            >
              Create an account
            </button>
          </p>
        ) : mode === "signup" ? (
          <p className="au-alt">
            Already have an account?{" "}
            <button
              type="button"
              className="au-link"
              onClick={() => switchMode("login")}
            >
              Sign in
            </button>
          </p>
        ) : (
          <p className="au-alt">
            <button
              type="button"
              className="au-link"
              onClick={() => switchMode("login")}
            >
              Back to sign in
            </button>
          </p>
        )}
      </form>
    );
  }

  // the reset link page is a single column, like the original; every other screen has the showcase
  const withPanel = mode !== "reset";

  return (
    <>
      <div className={withPanel ? "au-wrap" : "au-wrap au-single"}>
        {withPanel && (
          <AuthShowcase
            variant={mode === "signup" ? "signup" : "login"}
            onBack={onBack}
          />
        )}
        <main className="au-side">
          {/* key: re-run the entrance stagger when the step changes (e.g. into the two-factor check) */}
          <div className="au-form" key={`${mode}-${twoFactor}-${done}`}>
            {onBack && (
              <button
                type="button"
                className="au-back"
                onClick={() => {
                  // leaving a ?reset= link: drop the token, or the parent keeps showing this screen
                  if (mode === "reset") onResetDone?.();
                  onBack();
                }}
              >
                <Chevron />
                Back to home
              </button>
            )}
            <h2 className="au-title">{title}</h2>
            <p className="au-sub">{subtitle}</p>
            {content}
          </div>
        </main>
      </div>
      <ChatBubble signedIn={false} />
    </>
  );
}
