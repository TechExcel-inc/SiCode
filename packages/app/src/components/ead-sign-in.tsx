import { Show, createSignal, onMount } from "solid-js"
import { useParams } from "@solidjs/router"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useServer } from "@/context/server"
import { usePlatform } from "@/context/platform"
import { resetPassword, sendCode, signup, verifyCode } from "@/ead/api"
import { looksLikeProviderApiKey } from "@/ead/auth"
import { ensureEadMcp } from "@/ead/ensure-mcp"
import { eadHttp } from "@/ead/http"
import { KLOUD_WEB, signInWithKloud } from "@/ead/kloud-sign-in"
import { t } from "@/ead/i18n"
import { useEad } from "@/ead/settings"
import { decode64 } from "@/utils/base64"
import "@/ead/navigator.css"

type AuthTab =
  | "signin"
  | "signup-start"
  | "signup-verify"
  | "signup-create"
  | "forgot"
  | "forgot-reset"
  | "forgot-success"

const field = "ead-field"

function AuthPass(props: {
  value: string
  show: boolean
  placeholder: string
  onInput: (v: string) => void
  onToggle: () => void
  onEnter?: () => void
  name?: string
  complete?: string
}) {
  let el: HTMLInputElement | undefined
  const sync = () => {
    if (!el) return
    const next = el.value
    if (looksLikeProviderApiKey(next)) {
      el.value = props.value && !looksLikeProviderApiKey(props.value) ? props.value : ""
      return
    }
    if (next !== props.value) props.onInput(next)
  }
  onMount(() => {
    if (el && !el.value && props.value) el.value = props.value
    queueMicrotask(sync)
    requestAnimationFrame(sync)
  })
  return (
    <div class="auth-input-wrap">
      <input
        ref={el}
        type={props.show ? "text" : "password"}
        class={field}
        name={props.name}
        autocomplete={props.complete}
        placeholder={props.placeholder}
        onInput={sync}
        onChange={sync}
        onFocus={sync}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !props.onEnter) return
          e.preventDefault()
          sync()
          props.onEnter()
        }}
      />
      <button
        type="button"
        class="auth-eye"
        onClick={() => {
          const keep = el?.value ?? ""
          props.onToggle()
          queueMicrotask(() => {
            if (el && keep && el.value !== keep) el.value = keep
          })
        }}
      >
        {props.show ? "◌" : "◎"}
      </button>
    </div>
  )
}

/**
 * The EAD Pilot sign-in card: sign in, sign up with a verify code, and forgot/reset password.
 * It renders its own `data-ead-map` root so the EAD Map styles in navigator.css apply wherever it is
 * placed. `onSignedIn` gets the new token; errors it throws are shown on the card.
 */
export function EadSignInCard(props: {
  onSignedIn: (token: string) => void | Promise<void>
  initialTab?: "signin" | "signup"
  /** A message from the host (for example "session expired") shown until the card has its own error. */
  message?: string
}) {
  const ead = useEad()
  const platform = usePlatform()
  const http = () => eadHttp()
  const lang = () => ead.language()
  const tx = (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) => t(lang(), key, vars)

  const [busy, setBusy] = createSignal(false)
  const [err, setErr] = createSignal("")
  const [tab, setTab] = createSignal<AuthTab>(props.initialTab === "signup" ? "signup-start" : "signin")
  const [id, setId] = createSignal("")
  const [pass, setPass] = createSignal("")
  const [showPass, setShowPass] = createSignal(false)
  const [showConfirm, setShowConfirm] = createSignal(false)
  const [target, setTarget] = createSignal("")
  const [code, setCode] = createSignal("")
  const [username, setUsername] = createSignal("")
  const [signupToken, setSignupToken] = createSignal("")
  const [newPass, setNewPass] = createSignal("")
  const [confirmPass, setConfirmPass] = createSignal("")
  const [via, setVia] = createSignal<"email" | "phone">("email")

  const soon = (name: string) => {
    const msg = tx("comingSoon", { name })
    setErr(msg)
    showToast({ title: "EAD", description: msg })
  }

  const done = async (token: string) => {
    setPass("")
    setNewPass("")
    setConfirmPass("")
    setCode("")
    setSignupToken("")
    await props.onSignedIn(token)
  }

  const onLogin = async (user = id(), secret = pass()) => {
    const name = user.trim()
    if (looksLikeProviderApiKey(secret)) {
      setPass("")
      setErr(tx("notPassword"))
      return
    }
    setId(name)
    setPass(secret)
    setBusy(true)
    setErr("")
    try {
      // The Kloud master account; EAD Pilot signs on through it.
      const { eadToken } = await signInWithKloud(name, secret, http())
      await done(eadToken)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const submitLogin = (e: Event) => {
    e.preventDefault()
    const form = e.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const data = new FormData(form)
    void onLogin(String(data.get("username") ?? ""), String(data.get("password") ?? ""))
  }

  const onSendCode = async (intent: "signup" | "reset") => {
    setBusy(true)
    setErr("")
    try {
      const result = await sendCode(target(), intent, http())
      showToast({ title: "EAD", description: result.message, variant: "success" })
      if (result.code) setCode(result.code)
      setTab(intent === "signup" ? "signup-verify" : "forgot-reset")
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onVerify = async () => {
    setBusy(true)
    setErr("")
    try {
      setSignupToken(await verifyCode(target(), code(), http()))
      showToast({ title: "EAD", description: "Code verified.", variant: "success" })
      setTab("signup-create")
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onSignup = async () => {
    if (pass() !== confirmPass()) {
      setErr(tx("mismatch"))
      return
    }
    setBusy(true)
    setErr("")
    try {
      await done(
        await signup(
          {
            target: target(),
            username: username(),
            password: pass(),
            signupToken: signupToken(),
          },
          http(),
        ),
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onReset = async () => {
    if (newPass() !== confirmPass()) {
      setErr(tx("mismatch"))
      return
    }
    setBusy(true)
    setErr("")
    try {
      const message = await resetPassword(
        {
          target: target(),
          code: code(),
          password: newPass(),
        },
        http(),
      )
      showToast({ title: "EAD", description: message, variant: "success" })
      setTab("forgot-success")
      setId(target())
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-ead-map class="ead-sign-in">
      <div class="auth-card">
        <div class="auth-brand">
          <span aria-hidden="true">▣</span>
          <span>EAD-PFM</span>
          <span class="auth-top-actions">
            <span class="auth-chip">?</span>
            <span class="auth-chip">{lang().toUpperCase()}</span>
            <span class="auth-chip">◐</span>
          </span>
        </div>
        <Show when={tab() === "signin"}>
          <form class="auth-form" autocomplete="on" onSubmit={submitLogin}>
            <p class="auth-title">{tx("signInKloud")}</p>
            <p class="auth-hint">{tx("signInKloudHint")}</p>
            <div class="auth-label-row">
              <label class="auth-label">{tx("idPlaceholder")}</label>
            </div>
            <input
              class={field}
              name="username"
              autocomplete="username"
              placeholder={tx("idPlaceholder")}
              ref={(node) => {
                if (!node.value && id()) node.value = id()
              }}
              onInput={(e) => setId(e.currentTarget.value)}
              onChange={(e) => setId(e.currentTarget.value)}
            />
            <div class="auth-label-row">
              <label class="auth-label">{tx("password")}</label>
              <button type="button" class="auth-link" onClick={() => platform.openLink(`${KLOUD_WEB}/forgetPassworld`)}>
                {tx("forgot")}
              </button>
            </div>
            <AuthPass
              value={pass()}
              show={showPass()}
              placeholder={tx("password")}
              name="password"
              complete="current-password"
              onInput={setPass}
              onToggle={() => setShowPass((v) => !v)}
            />
            <button type="submit" class="auth-primary" disabled={busy()}>
              {tx("signIn")}
            </button>
          </form>
          <p class="auth-muted" style={{ "margin-top": "16px", "margin-bottom": 0 }}>
            {tx("noAccount")}{" "}
            <button type="button" class="auth-link" onClick={() => platform.openLink(`${KLOUD_WEB}/register`)}>
              {tx("signUp")}
            </button>
          </p>
        </Show>

        <Show when={tab() === "signup-start"}>
          <p class="auth-title">{tx("signUp")}</p>
          <p class="auth-hint">{tx("signUpHint")}</p>
          <div class="auth-actions-row" style={{ "margin-bottom": "12px" }}>
            <button
              type="button"
              class="auth-secondary"
              classList={{ "is-active": via() === "email" }}
              onClick={() => setVia("email")}
            >
              {tx("viaEmail")}
            </button>
            <button
              type="button"
              class="auth-secondary"
              classList={{ "is-active": via() === "phone" }}
              onClick={() => setVia("phone")}
            >
              {tx("viaPhone")}
            </button>
          </div>
          <input
            class={field}
            type={via() === "phone" ? "tel" : "email"}
            placeholder={tx("targetPlaceholder")}
            value={target()}
            onInput={(e) => setTarget(e.currentTarget.value)}
          />
          <button type="button" class="auth-primary" disabled={busy()} onClick={() => void onSendCode("signup")}>
            {tx("sendCode")}
          </button>
          <div class="auth-oauth">
            <button type="button" onClick={() => soon("Google")}>
              {tx("google")}
            </button>
            <button type="button" onClick={() => soon("GitHub")}>
              {tx("github")}
            </button>
          </div>
          <button type="button" class="auth-link self-start" onClick={() => setTab("signin")}>
            {tx("backSignIn")}
          </button>
        </Show>

        <Show when={tab() === "signup-verify"}>
          <p class="auth-title">{tx("verify")}</p>
          <p class="auth-hint">{tx("verifyHint", { target: target() })}</p>
          <p class="auth-code-hint">{tx("codePlaceholder")}</p>
          <input
            class={field}
            placeholder={tx("codePlaceholder")}
            value={code()}
            onInput={(e) => setCode(e.currentTarget.value)}
          />
          <button type="button" class="auth-primary" disabled={busy()} onClick={() => void onVerify()}>
            {tx("verify")}
          </button>
          <button
            type="button"
            class="auth-link self-start"
            onClick={() => setTab("signup-start")}
          >
            {tx("back")}
          </button>
        </Show>

        <Show when={tab() === "signup-create"}>
          <p class="auth-title">{tx("createAccount")}</p>
          <input
            class={field}
            placeholder={tx("username")}
            value={username()}
            onInput={(e) => setUsername(e.currentTarget.value)}
          />
          <AuthPass
            value={pass()}
            show={showPass()}
            placeholder={tx("password")}
            onInput={setPass}
            onToggle={() => setShowPass((v) => !v)}
            onEnter={() => void onSignup()}
          />
          <AuthPass
            value={confirmPass()}
            show={showConfirm()}
            placeholder={tx("confirmPassword")}
            onInput={setConfirmPass}
            onToggle={() => setShowConfirm((v) => !v)}
            onEnter={() => void onSignup()}
          />
          <button type="button" class="auth-primary" disabled={busy() || !signupToken()} onClick={() => void onSignup()}>
            {tx("create")}
          </button>
        </Show>

        <Show when={tab() === "forgot"}>
          <p class="auth-title">{tx("forgotTitle")}</p>
          <div class="auth-actions-row" style={{ "margin-bottom": "12px" }}>
            <button
              type="button"
              class="auth-secondary"
              classList={{ "is-active": via() === "email" }}
              onClick={() => setVia("email")}
            >
              {tx("viaEmail")}
            </button>
            <button
              type="button"
              class="auth-secondary"
              classList={{ "is-active": via() === "phone" }}
              onClick={() => setVia("phone")}
            >
              {tx("viaPhone")}
            </button>
          </div>
          <input
            class={field}
            type={via() === "phone" ? "tel" : "email"}
            placeholder={tx("targetPlaceholder")}
            value={target()}
            onInput={(e) => setTarget(e.currentTarget.value)}
          />
          <button type="button" class="auth-primary" disabled={busy()} onClick={() => void onSendCode("reset")}>
            {tx("sendCode")}
          </button>
          <button type="button" class="auth-link self-start" onClick={() => setTab("signin")}>
            {tx("backSignIn")}
          </button>
        </Show>

        <Show when={tab() === "forgot-reset"}>
          <p class="auth-title">{tx("resetTitle")}</p>
          <p class="auth-code-hint">{tx("verifyHint", { target: target() })}</p>
          <input
            class={field}
            placeholder={tx("codePlaceholder")}
            value={code()}
            onInput={(e) => setCode(e.currentTarget.value)}
          />
          <AuthPass
            value={newPass()}
            show={showPass()}
            placeholder={tx("newPassword")}
            onInput={setNewPass}
            onToggle={() => setShowPass((v) => !v)}
            onEnter={() => void onReset()}
          />
          <AuthPass
            value={confirmPass()}
            show={showConfirm()}
            placeholder={tx("confirmPassword")}
            onInput={setConfirmPass}
            onToggle={() => setShowConfirm((v) => !v)}
            onEnter={() => void onReset()}
          />
          <button type="button" class="auth-primary" disabled={busy()} onClick={() => void onReset()}>
            {tx("resetPassword")}
          </button>
        </Show>

        <Show when={tab() === "forgot-success"}>
          <p class="auth-title">{tx("passwordUpdated")}</p>
          <p class="auth-success">{tx("passwordUpdatedHint")}</p>
          <button type="button" class="auth-primary" onClick={() => setTab("signin")}>
            {tx("backSignIn")}
          </button>
        </Show>

        <Show when={err() || props.message}>
          <p class="auth-error">{err() || props.message}</p>
        </Show>
      </div>
    </div>
  )
}

/**
 * EAD Pilot sign-in as a small popup. Works inside and outside a project: the MCP setup uses the
 * open project's directory when there is one, like the EAD settings page does.
 */
export function DialogEadSignIn(props: { initialTab?: "signin" | "signup" }) {
  const language = useLanguage()
  const dialog = useDialog()
  const ead = useEad()
  const globalSDK = useGlobalSDK()
  const layout = useLayout()
  const server = useServer()
  const params = useParams()

  const worktree = () => {
    const fromUrl = params.dir ? decode64(params.dir) : ""
    if (fromUrl) return fromUrl
    const last = server.projects.last()
    if (last) return last
    return layout.projects.list()[0]?.worktree || "/"
  }

  const onSignedIn = async (token: string) => {
    ead.setToken(token)
    const dir = worktree()
    const entry = await ensureEadMcp({
      client: globalSDK.createClient({ directory: dir, throwOnError: true }),
      token,
      entry: ead.mcpEntry(),
      worktree: dir,
    }).catch((e) => {
      showToast({
        title: "MCP",
        description: e instanceof Error ? e.message : String(e),
        variant: "error",
      })
      return ""
    })
    if (entry) ead.setMcpEntry(entry)
    ead.bumpPilot()
    dialog.close()
  }

  return (
    <Dialog title={language.t("ead.signIn.title")} size="normal">
      <div class="dialog-ead-sign-in px-4 pb-4">
        <EadSignInCard onSignedIn={onSignedIn} initialTab={props.initialTab} />
      </div>
    </Dialog>
  )
}

/** Returns a function that opens the EAD Pilot sign-in popup from anywhere in the app. */
export function useEadSignIn() {
  const dialog = useDialog()
  return (initialTab?: "signin" | "signup") => {
    dialog.show(() => <DialogEadSignIn initialTab={initialTab} />)
  }
}
