import { Toast as Kobalte, toaster } from "@kobalte/core/toast"
import type { ToastRootProps, ToastCloseButtonProps, ToastTitleProps, ToastDescriptionProps } from "@kobalte/core/toast"
import type { ComponentProps, JSX } from "solid-js"
import { createSignal, For, onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useI18n } from "../context/i18n"
import { Icon, type IconProps } from "./icon"
import { IconButton } from "./icon-button"

export interface ToastRegionProps extends ComponentProps<typeof Kobalte.Region> {}

// Where the user dragged the toasts to, as an offset from their corner. Kept until the app reloads.
const [spot, setSpot] = createSignal({ x: 0, y: 0 })

function ToastRegion(props: ToastRegionProps) {
  const drag = (event: PointerEvent) => {
    if (event.button !== 0) return
    if ((event.target as Element).closest("button, a, input, textarea, select")) return
    const region = event.currentTarget as HTMLElement
    const rect = region.querySelector("[data-slot='toast-list']")!.getBoundingClientRect()
    const base = spot()
    const start = { x: event.clientX, y: event.clientY }
    // Keeps the whole stack on screen.
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
    const move = (e: PointerEvent) =>
      setSpot({
        x: clamp(base.x + e.clientX - start.x, base.x - rect.left, base.x + window.innerWidth - rect.right),
        y: clamp(base.y + e.clientY - start.y, base.y - rect.top, base.y + window.innerHeight - rect.bottom),
      })
    const stop = () => {
      region.removeAttribute("data-dragging")
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", stop)
    }
    region.setAttribute("data-dragging", "")
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", stop)
  }

  return (
    <Portal>
      <Kobalte.Region
        data-component="toast-region"
        // Dragging moves the toasts; it never swipes one away.
        swipeThreshold={Number.MAX_SAFE_INTEGER}
        style={{ transform: `translate(${spot().x}px, ${spot().y}px)` }}
        onPointerDown={drag}
        {...props}
      >
        <Kobalte.List data-slot="toast-list" />
      </Kobalte.Region>
    </Portal>
  )
}

export interface ToastRootComponentProps extends ToastRootProps {
  class?: string
  classList?: ComponentProps<"li">["classList"]
  children?: JSX.Element
}

function ToastRoot(props: ToastRootComponentProps) {
  return (
    <Kobalte
      data-component="toast"
      classList={{
        ...(props.classList ?? {}),
        [props.class ?? ""]: !!props.class,
      }}
      {...props}
    />
  )
}

function ToastIcon(props: { name: IconProps["name"] }) {
  return (
    <div data-slot="toast-icon">
      <Icon name={props.name} />
    </div>
  )
}

function ToastContent(props: ComponentProps<"div">) {
  return <div data-slot="toast-content" {...props} />
}

function ToastTitle(props: ToastTitleProps & ComponentProps<"div">) {
  return <Kobalte.Title data-slot="toast-title" {...props} />
}

function ToastDescription(props: ToastDescriptionProps & ComponentProps<"div">) {
  return <Kobalte.Description data-slot="toast-description" {...props} />
}

function ToastActions(props: ComponentProps<"div">) {
  return <div data-slot="toast-actions" {...props} />
}

function ToastCloseButton(props: ToastCloseButtonProps & ComponentProps<"button">) {
  const i18n = useI18n()
  return (
    <Kobalte.CloseButton
      data-slot="toast-close-button"
      as={IconButton}
      icon="close"
      variant="ghost"
      aria-label={i18n.t("ui.common.dismiss")}
      {...props}
    />
  )
}

function ToastProgressTrack(props: ComponentProps<typeof Kobalte.ProgressTrack>) {
  return <Kobalte.ProgressTrack data-slot="toast-progress-track" {...props} />
}

function ToastProgressFill(props: ComponentProps<typeof Kobalte.ProgressFill>) {
  return <Kobalte.ProgressFill data-slot="toast-progress-fill" {...props} />
}

export const Toast = Object.assign(ToastRoot, {
  Region: ToastRegion,
  Icon: ToastIcon,
  Content: ToastContent,
  Title: ToastTitle,
  Description: ToastDescription,
  Actions: ToastActions,
  CloseButton: ToastCloseButton,
  ProgressTrack: ToastProgressTrack,
  ProgressFill: ToastProgressFill,
})

export { toaster }

export type ToastVariant = "default" | "success" | "error" | "loading"

export interface ToastAction {
  label: string
  onClick: "dismiss" | (() => void)
}

export interface ToastOptions {
  title?: string
  description?: string
  icon?: IconProps["name"]
  variant?: ToastVariant
  duration?: number
  persistent?: boolean
  actions?: ToastAction[]
}

// Errors share one card: it shows the newest, and "+N" opens the earlier ones.
const [errors, setErrors] = createSignal<ToastOptions[]>([])
let stack: number | undefined

function ErrorStack(props: { toastId: number }) {
  const i18n = useI18n()
  const [open, setOpen] = createSignal(false)
  const last = () => errors()[errors().length - 1]
  const earlier = () => errors().slice(0, -1).reverse()
  onCleanup(() => {
    if (stack !== props.toastId) return
    stack = undefined
    setErrors([])
  })
  return (
    <Toast toastId={props.toastId} duration={last()?.duration} persistent={last()?.persistent} data-variant="error">
      <Show when={last()?.icon}>{(name) => <Toast.Icon name={name()} />}</Show>
      <Toast.Content>
        <Show when={last()?.title}>
          <Toast.Title>{last()?.title}</Toast.Title>
        </Show>
        <Show when={last()?.description}>
          <Toast.Description>{last()?.description}</Toast.Description>
        </Show>
        <Show when={open()}>
          <ul data-slot="toast-earlier">
            <For each={earlier()}>
              {(item) => (
                <li>
                  <Show when={item.title}>
                    <div data-slot="toast-earlier-title">{item.title}</div>
                  </Show>
                  <Show when={item.description}>
                    <div data-slot="toast-earlier-description">{item.description}</div>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Toast.Content>
      <Show when={earlier().length}>
        <button
          type="button"
          data-slot="toast-more"
          aria-expanded={open()}
          aria-label={i18n.t("ui.toast.earlier", { count: earlier().length })}
          onClick={() => setOpen((value) => !value)}
        >
          +{earlier().length}
        </button>
      </Show>
      <Toast.CloseButton />
    </Toast>
  )
}

export function showToast(options: ToastOptions | string) {
  const opts = typeof options === "string" ? { description: options } : options
  // An error with its own buttons keeps its own card so the buttons stay reachable.
  if (opts.variant === "error" && !opts.actions?.length) {
    setErrors((list) => [...list, opts].slice(-50))
    // A fresh card for each error, so the newest one gets the full time on screen.
    const prev = stack
    stack = toaster.show((props) => <ErrorStack toastId={props.toastId} />)
    if (prev !== undefined) toaster.dismiss(prev)
    return stack
  }
  return toaster.show((props) => (
    <Toast
      toastId={props.toastId}
      duration={opts.duration}
      persistent={opts.persistent}
      data-variant={opts.variant ?? "default"}
    >
      <Show when={opts.icon}>
        <Toast.Icon name={opts.icon!} />
      </Show>
      <Toast.Content>
        <Show when={opts.title}>
          <Toast.Title>{opts.title}</Toast.Title>
        </Show>
        <Show when={opts.description}>
          <Toast.Description>{opts.description}</Toast.Description>
        </Show>
        <Show when={opts.actions?.length}>
          <Toast.Actions>
            {opts.actions!.map((action) => (
              <button
                data-slot="toast-action"
                onClick={() => {
                  if (typeof action.onClick === "function") {
                    action.onClick()
                  }
                  toaster.dismiss(props.toastId)
                }}
              >
                {action.label}
              </button>
            ))}
          </Toast.Actions>
        </Show>
      </Toast.Content>
      <Toast.CloseButton />
    </Toast>
  ))
}

export interface ToastPromiseOptions<T, U = unknown> {
  loading?: JSX.Element
  success?: (data: T) => JSX.Element
  error?: (error: U) => JSX.Element
}

export function showPromiseToast<T, U = unknown>(
  promise: Promise<T> | (() => Promise<T>),
  options: ToastPromiseOptions<T, U>,
) {
  return toaster.promise(promise, (props) => (
    <Toast
      toastId={props.toastId}
      data-variant={props.state === "pending" ? "loading" : props.state === "fulfilled" ? "success" : "error"}
    >
      <Toast.Content>
        <Toast.Description>
          {props.state === "pending" && options.loading}
          {props.state === "fulfilled" && options.success?.(props.data!)}
          {props.state === "rejected" && options.error?.(props.error)}
        </Toast.Description>
      </Toast.Content>
      <Toast.CloseButton />
    </Toast>
  ))
}
