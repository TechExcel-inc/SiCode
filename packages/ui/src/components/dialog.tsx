import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { ComponentProps, For, JSXElement, Match, ParentProps, Show, Switch } from "solid-js"
import { useI18n } from "../context/i18n"
import { IconButton } from "./icon-button"

export interface DialogProps extends ParentProps {
  title?: JSXElement
  description?: JSXElement
  action?: JSXElement
  /** Shown in the header, beside the close button. */
  tools?: JSXElement
  /** Lets the user drag the dialog's edges and corners between `min` and the window's size. */
  resize?: {
    width: number
    height: number
    min: { width: number; height: number }
    onResize: (size: { width: number; height: number }) => void
  }
  size?: "normal" | "large" | "x-large"
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
  fit?: boolean
  transition?: boolean
}

const grips = [-1, 0, 1].flatMap((x) => [-1, 0, 1].filter((y) => x || y).map((y) => [x, y] as const))

export function Dialog(props: DialogProps) {
  const i18n = useI18n()
  // The dialog stays centered, so its size changes by twice the drag and the dragged edge follows the pointer.
  const drag = (e: PointerEvent, x: number, y: number) => {
    const el = e.currentTarget as HTMLElement
    const box = el.closest('[data-slot="dialog-container"]')?.getBoundingClientRect()
    if (e.button || !box) return
    e.preventDefault()
    const fit = (size: number, min: number, room: number) => Math.max(min, Math.min(size, room - 32))
    const move = (ev: PointerEvent) => {
      const resize = props.resize
      if (!resize) return
      resize.onResize({
        width: x ? fit(box.width + 2 * x * (ev.clientX - e.clientX), resize.min.width, innerWidth) : resize.width,
        height: y ? fit(box.height + 2 * y * (ev.clientY - e.clientY), resize.min.height, innerHeight) : resize.height,
      })
    }
    el.setPointerCapture(e.pointerId)
    el.addEventListener("pointermove", move)
    el.addEventListener("lostpointercapture", () => el.removeEventListener("pointermove", move), { once: true })
  }
  return (
    <div
      data-component="dialog"
      data-fit={props.fit ? true : undefined}
      data-size={props.size || "normal"}
      data-transition={props.transition ? true : undefined}
      data-resizable={props.resize ? true : undefined}
    >
      <div
        data-slot="dialog-container"
        style={
          props.resize && {
            width: `min(calc(100vw - 32px), ${props.resize.width}px)`,
            height: `min(calc(100vh - 32px), ${props.resize.height}px)`,
          }
        }
      >
        <Kobalte.Content
          data-slot="dialog-content"
          data-no-header={!props.title && !props.action ? "" : undefined}
          classList={{
            ...(props.classList ?? {}),
            [props.class ?? ""]: !!props.class,
          }}
          onOpenAutoFocus={(e) => {
            const target = e.currentTarget as HTMLElement | null
            const autofocusEl = target?.querySelector("[autofocus]") as HTMLElement | null
            if (autofocusEl) {
              e.preventDefault()
              autofocusEl.focus()
            }
          }}
        >
          <Show when={props.title || props.action}>
            <div data-slot="dialog-header">
              <Show when={props.title}>
                <Kobalte.Title data-slot="dialog-title">{props.title}</Kobalte.Title>
              </Show>
              <Switch>
                <Match when={props.action}>{props.action}</Match>
                <Match when={true}>
                  <div data-slot="dialog-tools">
                    {props.tools}
                    <Kobalte.CloseButton
                      data-slot="dialog-close-button"
                      as={IconButton}
                      icon="close"
                      variant="ghost"
                      aria-label={i18n.t("ui.common.close")}
                    />
                  </div>
                </Match>
              </Switch>
            </div>
          </Show>
          <Show when={props.description}>
            <Kobalte.Description data-slot="dialog-description" style={{ "margin-left": "-4px" }}>
              {props.description}
            </Kobalte.Description>
          </Show>
          <div data-slot="dialog-body">{props.children}</div>
          <Show when={props.resize}>
            <For each={grips}>
              {([x, y]) => (
                <div data-slot="dialog-grip" data-x={x} data-y={y} onPointerDown={(e) => drag(e, x, y)} />
              )}
            </For>
          </Show>
        </Kobalte.Content>
      </div>
    </div>
  )
}
