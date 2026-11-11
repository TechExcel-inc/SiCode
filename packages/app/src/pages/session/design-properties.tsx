import { createMemo, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Select } from "@opencode-ai/ui/select"
import { TextField } from "@opencode-ai/ui/text-field"
import { useCowork } from "@/context/cowork"
import { useLanguage } from "@/context/language"
import { loadProducts, type Product } from "@/ead/api"
import { useEad } from "@/ead/settings"

export type Home = { dir: string; name: string; group: "current" | "related" | "other" }

/**
 * A design's properties: its name and the project it belongs to, and that project's Product and Primary
 * Repository, the chain SiCode uses to know which product a design is for. Saving links the product first
 * (it may be refused, see linkProduct), then renames or moves the design.
 */
export function DesignProperties(props: {
  name: string
  home: string
  homes: Home[]
  onSave: (next: { name: string; home: string }) => Promise<string | undefined>
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const cowork = useCowork()
  const ead = useEad()
  const [state, setState] = createStore({
    name: props.name,
    home: props.home,
    // The product picked here; undefined keeps the project's own.
    product: undefined as number | undefined,
    products: [] as Product[],
    error: "",
    busy: false,
  })

  onMount(() => {
    const token = ead.token()
    if (!token) return
    void loadProducts(token)
      .then((list) => setState("products", list))
      .catch(() => undefined)
  })

  const label = (item: Home) =>
    language.t(
      item.group === "current"
        ? "design.props.current"
        : item.group === "related"
          ? "design.props.related"
          : "design.props.other",
      { name: item.name },
    )
  const linked = () => !!cowork.projectOf(state.home)
  const current = () => cowork.productOf(state.home) ?? 0
  const chosen = () => state.product ?? current()
  const products = createMemo(() => {
    const list = [{ productId: 0, name: language.t("design.props.product.none") }, ...state.products]
    const id = current()
    return id && !list.some((item) => item.productId === id) ? [...list, { productId: id, name: `#${id}` }] : list
  })
  const named = (id: number) => products().find((item) => item.productId === id)?.name ?? `#${id}`

  const save = async () => {
    const name = state.name.trim()
    if (!name || state.busy) return
    setState({ busy: true, error: "" })
    if (linked() && state.product !== undefined && state.product !== current()) {
      const res = await cowork
        .linkProduct(state.home, state.product || null)
        .catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }))
      if ("error" in res && res.error) return setState({ busy: false, error: res.error })
      if ("taken" in res && res.taken)
        return setState({
          busy: false,
          error: language.t("design.props.taken", { repo: res.repo ?? "", product: named(res.taken) }),
        })
    }
    const error = await props.onSave({ name, home: state.home })
    if (error) return setState({ busy: false, error })
    dialog.close()
  }

  return (
    <Dialog title={language.t("design.props.title")} fit>
      <div data-component="design-properties" class="flex flex-col gap-4 pl-6 pr-2.5 pb-3 w-[440px] max-w-full">
        <TextField
          autofocus
          type="text"
          label={language.t("design.props.name")}
          value={state.name}
          onChange={(value) => setState({ name: value, error: "" })}
          data-action="design-props-name"
        />
        <div class="flex flex-col gap-1.5">
          <span class="text-12-medium text-text-weak">{language.t("design.props.project")}</span>
          <Select
            data-action="design-props-project"
            options={props.homes}
            current={props.homes.find((item) => item.dir === state.home)}
            value={(item) => item.dir}
            label={label}
            onSelect={(item) => item && setState({ home: item.dir, product: undefined, error: "" })}
            variant="secondary"
            size="small"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <span class="text-12-medium text-text-weak">{language.t("design.props.product")}</span>
          <Show
            when={cowork.signedIn() && linked()}
            fallback={
              <span class="text-13-regular text-text-weak">
                {language.t(cowork.signedIn() ? "design.props.unlinked" : "design.props.signin")}
              </span>
            }
          >
            <Select
              data-action="design-props-product"
              options={products()}
              current={products().find((item) => item.productId === chosen())}
              value={(item) => String(item.productId)}
              label={(item) => item.name}
              onSelect={(item) => item && setState({ product: item.productId, error: "" })}
              variant="secondary"
              size="small"
            />
          </Show>
        </div>
        <div class="flex flex-col gap-1.5">
          <span class="text-12-medium text-text-weak">{language.t("design.props.primary")}</span>
          <span data-slot="design-props-primary" class="text-13-regular text-text-strong">
            {cowork.repoOf(state.home) ?? language.t("design.props.primary.none")}
          </span>
        </div>
        <Show when={state.error}>
          <span data-slot="design-props-error" class="text-12-regular text-text-diff-delete-base">
            {state.error}
          </span>
        </Show>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="large"
            data-action="design-props-save"
            disabled={state.busy || !state.name.trim()}
            onClick={() => void save()}
          >
            {language.t("common.save")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
