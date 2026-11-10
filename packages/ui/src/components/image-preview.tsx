import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { createSignal } from "solid-js"
import { useI18n } from "../context/i18n"
import { Button } from "./button"
import { IconButton } from "./icon-button"

export interface ImagePreviewProps {
  src: string
  alt?: string
}

/**
 * An image opened large: it fills the window (wide designs use the full width), and Actual size shows it at
 * its own pixels to scroll around in. Clicking the image switches between the two.
 */
export function ImagePreview(props: ImagePreviewProps) {
  const i18n = useI18n()
  const [actual, setActual] = createSignal(false)
  return (
    <div data-component="image-preview">
      <div data-slot="image-preview-container">
        <Kobalte.Content data-slot="image-preview-content">
          <div data-slot="image-preview-header">
            <Button variant="ghost" size="small" data-action="image-preview-zoom" onClick={() => setActual((v) => !v)}>
              {i18n.t(actual() ? "ui.imagePreview.fit" : "ui.imagePreview.actual")}
            </Button>
            <Kobalte.CloseButton
              data-slot="image-preview-close"
              as={IconButton}
              icon="close"
              variant="ghost"
              aria-label={i18n.t("ui.common.close")}
            />
          </div>
          <div data-slot="image-preview-body" data-actual={actual() || undefined}>
            <img
              src={props.src}
              alt={props.alt ?? i18n.t("ui.imagePreview.alt")}
              data-slot="image-preview-image"
              onClick={() => setActual((v) => !v)}
            />
          </div>
        </Kobalte.Content>
      </div>
    </div>
  )
}
